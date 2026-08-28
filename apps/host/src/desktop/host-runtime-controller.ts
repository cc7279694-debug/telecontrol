import type { AuthorizedWorkspace } from "../codex-app-server-adapter.js";
import type { CodexCliResolution } from "./codex-cli-resolver.js";
import type {
  HostNotificationSink,
  RemoteCommandAdapter,
} from "../remote-command-runner.js";
import type {
  LinkedDevice,
  PairingRequest,
  SupabaseTransportStatus,
  TransportContext,
} from "../supabase-transport.js";
import type { RuntimeSession } from "./supabase-auth-controller.js";

export type HostRuntimePhase =
  "stopped" | "starting" | "running" | "degraded" | "stopping" | "error";

export type HostRuntimeReason =
  | "awaiting-pairing"
  | "transport-offline"
  | "codex-restarting"
  | "doctor-required"
  | null;

export type RuntimeErrorCode =
  | "not_signed_in"
  | "host_not_registered"
  | "no_authorized_workspace"
  | "credentials_unavailable"
  | "codex_cli_missing"
  | "codex_version_mismatch"
  | "codex_initialize_failed"
  | "transport_connect_failed"
  | "multiple_active_devices"
  | "command_runner_failed"
  | "app_server_exited"
  | "unknown_runtime_error";

export type HostRuntimeSnapshot = {
  phase: HostRuntimePhase;
  reason: HostRuntimeReason;
  activeRemoteTurns: number;
  lastObservedAt: string | null;
  errorCode: RuntimeErrorCode | null;
  appServerRestartAttempt: number;
};

export type RuntimeActionResult = { ok: boolean; message: string };

export type RuntimePrerequisites = {
  signedIn: boolean;
  hostId: string | null;
  hostName: string;
  ownerId: string | null;
  authSessionId: string | null;
  accessToken: string | null;
  hostPrivateKey: CryptoKey | null;
  authorizedWorkspaces: AuthorizedWorkspace[];
  activeRemoteTurns: () => number;
  markRunningUnknown: () => void;
  subscribeActivity?: (handler: () => void) => () => void;
};

export type CodexRuntimeInput = {
  executablePath: string;
  authorizedWorkspaces: AuthorizedWorkspace[];
};

export type CodexRuntime = {
  adapter: RemoteCommandAdapter;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
  onExit: (handler: () => void) => () => void;
  onError: (handler: () => void) => () => void;
};

export type RuntimeTransport = {
  setPairingHostId: (hostId: string) => void;
  findActiveLinkedDevice: (hostId: string) => Promise<LinkedDevice | null>;
  connect: (context: TransportContext) => Promise<void>;
  disconnect: () => Promise<void>;
  heartbeat: () => Promise<void>;
  subscribeStatus: (
    handler: (status: SupabaseTransportStatus) => void,
  ) => () => void;
  refreshAccessToken: (accessToken: string) => Promise<void>;
  createPairingRequest: () => Promise<PairingRequest>;
};

export type RuntimeRunner = {
  start: () => void;
  stop: () => void;
  publishAuthoritativeSnapshot: (device: LinkedDevice) => Promise<void>;
  reconcileRecoverable: () => Promise<void>;
};

export type CancelSchedule = () => void;

export type HostRuntimePorts = {
  loadPrerequisites: () => Promise<RuntimePrerequisites>;
  resolveCodexCli: () => Promise<CodexCliResolution>;
  createCodexRuntime: (input: CodexRuntimeInput) => Promise<CodexRuntime>;
  createTransport: (session: RuntimeSession) => RuntimeTransport;
  createRunner: (input: {
    adapter: RemoteCommandAdapter;
    transport: RuntimeTransport;
    hostId: string;
    hostName: string;
    hostPrivateKey: CryptoKey;
    authorizedWorkspaces: AuthorizedWorkspace[];
    notificationSink?: HostNotificationSink;
  }) => RuntimeRunner;
  createNotificationSink: (
    session: RuntimeSession,
  ) => HostNotificationSink | undefined;
  schedule: (delayMs: number, task: () => void) => CancelSchedule;
  logger: {
    info: (event: string, details?: Record<string, unknown>) => void;
    warn: (event: string, details?: Record<string, unknown>) => void;
    error: (event: string, details?: Record<string, unknown>) => void;
  };
};

export type HostRuntimeController = {
  start: () => Promise<RuntimeActionResult>;
  stop: (input: { force: boolean }) => Promise<RuntimeActionResult>;
  createPairingRequest: () => Promise<PairingRequest>;
  handleSessionChanged: (session: RuntimeSession) => Promise<void>;
  handleNetworkOnline: () => Promise<void>;
  handleSystemResume: () => Promise<void>;
  markDoctorPassed: () => void;
  checkAppServer: () => Promise<void>;
  getSnapshot: () => HostRuntimeSnapshot;
  subscribe: (handler: (snapshot: HostRuntimeSnapshot) => void) => () => void;
  dispose: () => Promise<void>;
};

const initialSnapshot: HostRuntimeSnapshot = {
  phase: "stopped",
  reason: null,
  activeRemoteTurns: 0,
  lastObservedAt: null,
  errorCode: null,
  appServerRestartAttempt: 0,
};

const restartDelays = [1_000, 2_000, 4_000] as const;
const heartbeatIntervalMs = 10_000;
const transportReconnectDelayMs = 5_000;

export function createHostRuntimeController(
  ports: HostRuntimePorts,
): HostRuntimeController {
  let snapshot = { ...initialSnapshot };
  let prerequisites: RuntimePrerequisites | undefined;
  let currentSession: RuntimeSession | undefined;
  let codex: CodexRuntime | undefined;
  let transport: RuntimeTransport | undefined;
  let runner: RuntimeRunner | undefined;
  let removeCodexExitListener: (() => void) | undefined;
  let removeCodexErrorListener: (() => void) | undefined;
  let linkedDevice: LinkedDevice | undefined;
  let startPromise: Promise<RuntimeActionResult> | undefined;
  let pairingPollCancel: CancelSchedule | undefined;
  let restartCancel: CancelSchedule | undefined;
  let heartbeatCancel: CancelSchedule | undefined;
  let transportReconnectCancel: CancelSchedule | undefined;
  let removeTransportStatusListener: (() => void) | undefined;
  let removeActivityListener: (() => void) | undefined;
  let pairingExpiresAt: string | undefined;
  let doctorPassed = false;
  let disposed = false;
  let intentionalClose = false;
  let reconnecting = false;
  const subscribers = new Set<(value: HostRuntimeSnapshot) => void>();

  function activeRemoteTurns() {
    try {
      return prerequisites?.activeRemoteTurns() ?? 0;
    } catch {
      return 0;
    }
  }

  function publish(next: Partial<HostRuntimeSnapshot>) {
    snapshot = {
      ...snapshot,
      ...next,
      activeRemoteTurns: activeRemoteTurns(),
      lastObservedAt: new Date().toISOString(),
    };
    const copy = { ...snapshot };
    for (const subscriber of subscribers) subscriber(copy);
  }

  function runtimeErrorCode(error: unknown): RuntimeErrorCode {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (
      code === "UNSUPPORTED_PLATFORM" ||
      code === "PACKAGE_METADATA_MISSING" ||
      code === "EXECUTABLE_MISSING" ||
      code === "UNSAFE_EXECUTABLE_PATH"
    ) {
      return "codex_cli_missing";
    }
    if (code === "VERSION_MISMATCH") return "codex_version_mismatch";
    if (code === "MULTIPLE_ACTIVE_DEVICES") {
      return "multiple_active_devices";
    }
    return "unknown_runtime_error";
  }

  function cancelPairingPoll() {
    pairingPollCancel?.();
    pairingPollCancel = undefined;
  }

  function cancelRestart() {
    restartCancel?.();
    restartCancel = undefined;
  }

  function cancelHeartbeat() {
    heartbeatCancel?.();
    heartbeatCancel = undefined;
  }

  function cancelTransportReconnect() {
    transportReconnectCancel?.();
    transportReconnectCancel = undefined;
  }

  async function closeConnectedResources() {
    cancelHeartbeat();
    cancelTransportReconnect();
    const activeRunner = runner;
    runner = undefined;
    activeRunner?.stop();

    const activeTransport = transport;
    transport = undefined;
    linkedDevice = undefined;
    if (activeTransport)
      await activeTransport.disconnect().catch(() => undefined);

    const activeCodex = codex;
    codex = undefined;
    removeCodexExitListener?.();
    removeCodexErrorListener?.();
    removeCodexExitListener = undefined;
    removeCodexErrorListener = undefined;
    removeTransportStatusListener?.();
    removeTransportStatusListener = undefined;
    if (activeCodex) await activeCodex.close().catch(() => undefined);
  }

  function installCodexListeners(runtime: CodexRuntime) {
    removeCodexExitListener = runtime.onExit(() => {
      void handleUnexpectedCodexExit();
    });
    removeCodexErrorListener = runtime.onError(() => {
      ports.logger.warn("codex_process_error");
    });
  }

  async function connectDevice(device: LinkedDevice): Promise<void> {
    if (!prerequisites || !currentSession || !transport || !codex) {
      throw new Error("runtime prerequisites unavailable");
    }
    publish({ phase: "starting", reason: null, errorCode: null });
    const context: TransportContext = {
      hostId: prerequisites.hostId!,
      deviceId: device.id,
      ownerId: currentSession.ownerId,
      leaseOwner: currentSession.authSessionId ?? currentSession.ownerId,
    };
    await transport.connect(context);
    await transport.heartbeat();
    const notificationSink = ports.createNotificationSink(currentSession);
    const nextRunner = ports.createRunner({
      adapter: codex.adapter,
      transport,
      hostId: prerequisites.hostId!,
      hostName: prerequisites.hostName,
      hostPrivateKey: prerequisites.hostPrivateKey!,
      authorizedWorkspaces: prerequisites.authorizedWorkspaces,
      notificationSink,
    });
    await nextRunner.reconcileRecoverable();
    await nextRunner.publishAuthoritativeSnapshot(device);
    nextRunner.start();
    runner = nextRunner;
    linkedDevice = device;
    publish({
      phase: "running",
      reason: null,
      errorCode: null,
      appServerRestartAttempt: 0,
    });
    scheduleHeartbeat();
  }

  function scheduleHeartbeat() {
    cancelHeartbeat();
    if (disposed || !transport || !runner || snapshot.phase !== "running") {
      return;
    }
    heartbeatCancel = ports.schedule(heartbeatIntervalMs, () => {
      heartbeatCancel = undefined;
      void sendHeartbeat();
    });
  }

  async function sendHeartbeat() {
    if (
      disposed ||
      !transport ||
      !runner ||
      snapshot.phase === "stopped" ||
      snapshot.phase === "stopping"
    ) {
      return;
    }
    try {
      await transport.heartbeat();
      scheduleHeartbeat();
    } catch {
      handleTransportOffline();
    }
  }

  function scheduleTransportReconnect() {
    if (
      transportReconnectCancel ||
      disposed ||
      intentionalClose ||
      snapshot.phase === "stopped" ||
      snapshot.phase === "stopping"
    ) {
      return;
    }
    transportReconnectCancel = ports.schedule(transportReconnectDelayMs, () => {
      transportReconnectCancel = undefined;
      void reconnectTransport();
    });
  }

  function handleTransportOffline() {
    if (
      disposed ||
      intentionalClose ||
      reconnecting ||
      snapshot.phase === "stopped" ||
      snapshot.phase === "stopping"
    ) {
      return;
    }
    cancelHeartbeat();
    runner?.stop();
    runner = undefined;
    publish({
      phase: "degraded",
      reason: "transport-offline",
      errorCode: "transport_connect_failed",
    });
    scheduleTransportReconnect();
  }

  function installTransportStatusListener(nextTransport: RuntimeTransport) {
    removeTransportStatusListener?.();
    removeTransportStatusListener = nextTransport.subscribeStatus((status) => {
      if (status === "offline") handleTransportOffline();
    });
  }

  function installActivityListener(nextPrerequisites: RuntimePrerequisites) {
    removeActivityListener?.();
    removeActivityListener = nextPrerequisites.subscribeActivity?.(() => {
      publish({});
    });
  }

  function scheduleCodexRestart(
    nextAttempt: number,
    errorCode: RuntimeErrorCode,
  ) {
    if (nextAttempt > restartDelays.length) {
      publish({
        phase: "error",
        reason: "doctor-required",
        errorCode,
        appServerRestartAttempt: nextAttempt,
      });
      return;
    }
    publish({
      phase: "degraded",
      reason: "codex-restarting",
      errorCode,
      appServerRestartAttempt: nextAttempt,
    });
    cancelRestart();
    restartCancel = ports.schedule(restartDelays[nextAttempt - 1]!, () => {
      restartCancel = undefined;
      void start();
    });
  }

  async function startImpl(): Promise<RuntimeActionResult> {
    if (disposed) return { ok: false, message: "Host 已退出" };
    if (snapshot.phase === "running")
      return { ok: true, message: "Host 已运行" };
    if (snapshot.phase === "degraded" && codex) {
      return {
        ok: true,
        message:
          snapshot.reason === "awaiting-pairing"
            ? "Codex 已启动，等待手机配对"
            : "Host 正在等待网络恢复",
      };
    }
    if (snapshot.phase === "error" && !doctorPassed) {
      return { ok: false, message: "请先运行 Doctor 并修复问题" };
    }

    let loaded: RuntimePrerequisites;
    try {
      loaded = await ports.loadPrerequisites();
    } catch {
      publish({
        phase: "error",
        reason: null,
        errorCode: "unknown_runtime_error",
      });
      return { ok: false, message: "无法读取 Host 配置" };
    }
    prerequisites = loaded;
    installActivityListener(loaded);
    if (!loaded.signedIn) {
      publish({ phase: "error", reason: null, errorCode: "not_signed_in" });
      return { ok: false, message: "请先登录 Host" };
    }
    if (!loaded.hostId) {
      publish({
        phase: "error",
        reason: null,
        errorCode: "host_not_registered",
      });
      return { ok: false, message: "Host 尚未登记，请重新登录" };
    }
    if (!loaded.ownerId || !loaded.authSessionId || !loaded.hostPrivateKey) {
      publish({
        phase: "error",
        reason: null,
        errorCode: "credentials_unavailable",
      });
      return { ok: false, message: "Host 凭据不可用，请重新登录" };
    }
    if (loaded.authorizedWorkspaces.length === 0) {
      publish({
        phase: "error",
        reason: null,
        errorCode: "no_authorized_workspace",
      });
      return { ok: false, message: "请先授权至少一个项目目录" };
    }

    const restarting = snapshot.reason === "codex-restarting";
    publish({ phase: "starting", reason: null, errorCode: null });
    currentSession = {
      accessToken: loaded.accessToken!,
      ownerId: loaded.ownerId,
      authSessionId: loaded.authSessionId,
    };
    try {
      const resolution = await ports.resolveCodexCli();
      codex = await ports.createCodexRuntime({
        executablePath: resolution.executablePath,
        authorizedWorkspaces: loaded.authorizedWorkspaces,
      });
      installCodexListeners(codex);
      await codex.initialize();
      transport = ports.createTransport(currentSession);
      installTransportStatusListener(transport);
      transport.setPairingHostId(loaded.hostId);
      const device = await transport.findActiveLinkedDevice(loaded.hostId);
      if (!device) {
        publish({
          phase: "degraded",
          reason: "awaiting-pairing",
          errorCode: null,
        });
        return { ok: true, message: "Codex 已启动，等待手机配对" };
      }
      await connectDevice(device);
      return { ok: true, message: "Host 已运行" };
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message.includes("initialize")
          ? "codex_initialize_failed"
          : runtimeErrorCode(error);
      await closeConnectedResources();
      if (restarting) {
        scheduleCodexRestart(snapshot.appServerRestartAttempt + 1, errorCode);
      } else {
        publish({ phase: "error", reason: null, errorCode });
      }
      ports.logger.error("host_runtime_start_failed", { errorCode });
      return { ok: false, message: "Host 启动失败，请运行 Doctor" };
    }
  }

  async function start(): Promise<RuntimeActionResult> {
    if (startPromise) return startPromise;
    startPromise = startImpl().finally(() => {
      startPromise = undefined;
    });
    return startPromise;
  }

  async function pollForPairing() {
    pairingPollCancel = undefined;
    if (
      disposed ||
      snapshot.phase !== "degraded" ||
      snapshot.reason !== "awaiting-pairing" ||
      !transport ||
      !prerequisites?.hostId
    ) {
      return;
    }
    if (pairingExpiresAt && Date.parse(pairingExpiresAt) <= Date.now()) return;
    try {
      const device = await transport.findActiveLinkedDevice(
        prerequisites.hostId,
      );
      if (!device) {
        pairingPollCancel = ports.schedule(2_000, () => {
          void pollForPairing();
        });
        return;
      }
      await connectDevice(device);
    } catch {
      publish({
        phase: "error",
        reason: null,
        errorCode: "multiple_active_devices",
      });
      await closeConnectedResources();
    }
  }

  async function createPairingRequest(): Promise<PairingRequest> {
    if (
      snapshot.phase !== "degraded" ||
      snapshot.reason !== "awaiting-pairing" ||
      !transport
    ) {
      throw new Error("配对功能尚未就绪");
    }
    cancelPairingPoll();
    const pairing = await transport.createPairingRequest();
    pairingExpiresAt = pairing.expiresAt;
    pairingPollCancel = ports.schedule(2_000, () => {
      void pollForPairing();
    });
    return pairing;
  }

  async function reconnectTransport() {
    if (
      disposed ||
      !transport ||
      !codex ||
      !prerequisites?.hostId ||
      !currentSession ||
      snapshot.phase === "stopped" ||
      snapshot.phase === "stopping"
    ) {
      return;
    }
    if (reconnecting) return;
    reconnecting = true;
    cancelTransportReconnect();
    cancelHeartbeat();
    runner?.stop();
    runner = undefined;
    try {
      await transport.disconnect();
      const device = await transport.findActiveLinkedDevice(
        prerequisites.hostId,
      );
      if (!device) {
        publish({
          phase: "degraded",
          reason: "awaiting-pairing",
          errorCode: null,
        });
        return;
      }
      await connectDevice(device);
    } catch {
      publish({
        phase: "degraded",
        reason: "transport-offline",
        errorCode: "transport_connect_failed",
      });
      scheduleTransportReconnect();
    } finally {
      reconnecting = false;
    }
  }

  async function handleSessionChanged(session: RuntimeSession) {
    if (disposed) return;
    currentSession = { ...session };
    if (transport) await transport.refreshAccessToken(session.accessToken);
    if (!runner || !linkedDevice || !codex || !prerequisites) return;
    const previousRunner = runner;
    previousRunner.stop();
    const nextRunner = ports.createRunner({
      adapter: codex.adapter,
      transport: transport!,
      hostId: prerequisites.hostId!,
      hostName: prerequisites.hostName,
      hostPrivateKey: prerequisites.hostPrivateKey!,
      authorizedWorkspaces: prerequisites.authorizedWorkspaces,
      notificationSink: ports.createNotificationSink(session),
    });
    await nextRunner.publishAuthoritativeSnapshot(linkedDevice);
    nextRunner.start();
    runner = nextRunner;
  }

  async function handleUnexpectedCodexExit() {
    if (intentionalClose || disposed || snapshot.phase === "stopped") return;
    prerequisites?.markRunningUnknown();
    await closeConnectedResources();
    scheduleCodexRestart(
      snapshot.appServerRestartAttempt + 1,
      "app_server_exited",
    );
  }

  async function stop(input: { force: boolean }): Promise<RuntimeActionResult> {
    if (snapshot.phase === "stopped") {
      return { ok: true, message: "Host 已停止" };
    }
    if (!input.force && activeRemoteTurns() > 0) {
      return { ok: false, message: "当前有活动任务，请确认后再停止" };
    }
    intentionalClose = true;
    cancelPairingPoll();
    cancelRestart();
    publish({ phase: "stopping", reason: null, errorCode: null });
    await closeConnectedResources();
    removeActivityListener?.();
    removeActivityListener = undefined;
    currentSession = undefined;
    prerequisites = undefined;
    intentionalClose = false;
    publish({
      phase: "stopped",
      reason: null,
      errorCode: null,
      appServerRestartAttempt: 0,
    });
    return { ok: true, message: "Host 已停止" };
  }

  function markDoctorPassed() {
    doctorPassed = true;
    if (snapshot.phase === "error") {
      publish({
        phase: "stopped",
        reason: null,
        errorCode: null,
        appServerRestartAttempt: 0,
      });
    }
  }

  async function checkAppServer(): Promise<void> {
    const loaded = prerequisites ?? (await ports.loadPrerequisites());
    const resolution = await ports.resolveCodexCli();
    const runtime = await ports.createCodexRuntime({
      executablePath: resolution.executablePath,
      authorizedWorkspaces: loaded.authorizedWorkspaces,
    });
    try {
      await runtime.initialize();
    } finally {
      await runtime.close();
    }
  }

  function subscribe(handler: (value: HostRuntimeSnapshot) => void) {
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    await stop({ force: true });
    subscribers.clear();
  }

  return {
    start,
    stop,
    createPairingRequest,
    handleSessionChanged,
    handleNetworkOnline: reconnectTransport,
    handleSystemResume: reconnectTransport,
    markDoctorPassed,
    checkAppServer,
    getSnapshot: () => ({
      ...snapshot,
      activeRemoteTurns: activeRemoteTurns(),
    }),
    subscribe,
    dispose,
  };
}
