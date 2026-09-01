import { realpathSync } from "node:fs";
import path from "node:path";
import {
  DesktopStateSchema,
  type DesktopState,
  type ActionResult,
} from "./contract.js";
import type { DesktopIpcHandlers } from "./ipc-controller.js";

export type E2eScenario = "signed-out" | "ready" | "offline" | "codex-failed";

export type E2eMode = {
  scenario: E2eScenario;
  userDataDir: string;
};

export type E2eControl = {
  setScenario(scenario: E2eScenario): void;
  setPairingState(): void;
  setActiveRemoteTurns(count: number): void;
  releaseOtp(): void;
  setRawErrorMessage(): void;
  getTrayMenuLabels(): readonly string[];
  getActionCalls(): readonly string[];
};

export type E2eModeErrorCode = "E2E_MODE_FORBIDDEN" | "E2E_MODE_INVALID";

export class E2eModeError extends Error {
  constructor(readonly code: E2eModeErrorCode) {
    super(code);
    this.name = "E2eModeError";
  }
}

export type E2eFixture = {
  control: E2eControl;
  handlers: DesktopIpcHandlers;
  state: DesktopState;
};

const allowedScenarios = new Set<E2eScenario>([
  "signed-out",
  "ready",
  "offline",
  "codex-failed",
]);

function containsE2eVariable(source: NodeJS.ProcessEnv): boolean {
  return Object.keys(source).some(
    (key) => key === "CODEX_REMOTE_E2E" || key.startsWith("CODEX_REMOTE_E2E_"),
  );
}

function pathsEqual(left: string, right: string) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveExistingPath(input: string) {
  try {
    return realpathSync.native(input);
  } catch {
    return null;
  }
}

export function resolveE2eMode(input: {
  isPackaged: boolean;
  source: NodeJS.ProcessEnv;
  tempDir: string;
}): E2eMode | null {
  const containsFixtureConfig = containsE2eVariable(input.source);
  if (input.isPackaged) {
    if (containsFixtureConfig) throw new E2eModeError("E2E_MODE_FORBIDDEN");
    return null;
  }

  if (!containsFixtureConfig) return null;
  if (input.source.CODEX_REMOTE_E2E !== "1") {
    throw new E2eModeError("E2E_MODE_INVALID");
  }

  const rawScenario = input.source.CODEX_REMOTE_E2E_SCENARIO;
  if (!rawScenario || !allowedScenarios.has(rawScenario as E2eScenario)) {
    throw new E2eModeError("E2E_MODE_INVALID");
  }

  const rawUserDataDir = input.source.CODEX_REMOTE_E2E_USER_DATA;
  if (!rawUserDataDir || !path.isAbsolute(rawUserDataDir)) {
    throw new E2eModeError("E2E_MODE_INVALID");
  }

  const temporaryRoot = path.resolve(input.tempDir);
  const userDataDir = path.resolve(rawUserDataDir);
  const resolvedTemporaryRoot =
    resolveExistingPath(temporaryRoot) ?? temporaryRoot;
  const resolvedUserDataDir = resolveExistingPath(userDataDir);
  if (resolvedUserDataDir && !pathsEqual(resolvedUserDataDir, userDataDir)) {
    throw new E2eModeError("E2E_MODE_INVALID");
  }

  const checkedUserDataDir = resolvedUserDataDir ?? userDataDir;
  if (
    !pathsEqual(path.dirname(checkedUserDataDir), resolvedTemporaryRoot) ||
    !path.basename(userDataDir).startsWith("codex-remote-e2e-")
  ) {
    throw new E2eModeError("E2E_MODE_INVALID");
  }

  return {
    scenario: rawScenario as E2eScenario,
    userDataDir,
  };
}

const fixtureHost = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "测试 Windows Host",
  protocolVersion: 1,
} as const;

const fixtureWorkspace = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "示例项目",
  path: "C:\\CodexRemoteFixture\\Project",
} as const;

function stateForScenario(scenario: E2eScenario): DesktopState {
  const signedIn = scenario !== "signed-out";
  const base = {
    phase: "ready" as const,
    authStatus: signedIn ? ("signed-in" as const) : ("signed-out" as const),
    maskedEmail: signedIn ? "测试账号" : null,
    host: signedIn ? fixtureHost : null,
    hostStatus: "stopped" as const,
    runtimeReason: null,
    activeRemoteTurns: 0,
    lastObservedAt: null,
    lastErrorCode: null,
    openAtLogin: false,
    workspaces: signedIn ? [fixtureWorkspace] : [],
    pairing: null,
    notice: signedIn ? "测试模式已就绪" : "请输入邮箱登录 Host",
  } satisfies DesktopState;

  if (scenario === "ready") {
    return DesktopStateSchema.parse({
      ...base,
      hostStatus: "running",
    });
  }
  if (scenario === "offline") {
    return DesktopStateSchema.parse({
      ...base,
      hostStatus: "degraded",
      runtimeReason: "transport-offline",
      notice: "中转连接暂时不可用",
    });
  }
  if (scenario === "codex-failed") {
    return DesktopStateSchema.parse({
      ...base,
      hostStatus: "error",
      runtimeReason: "doctor-required",
      lastErrorCode: "codex_app_server_failed",
      notice: "Codex App Server 启动失败",
    });
  }
  return DesktopStateSchema.parse(base);
}

export function createE2eFixture(input: {
  mode: E2eMode;
  publishState: (state: DesktopState) => void;
  schedule?: (task: () => void) => void;
  holdOtp?: boolean;
}): E2eFixture {
  let state = stateForScenario(input.mode.scenario);
  let currentScenario = input.mode.scenario;
  let generation = 0;
  const actionCalls: string[] = [];
  let releasePendingOtp: (() => void) | undefined;
  let rawErrorMessage = false;
  const schedule = input.schedule ?? ((task) => setTimeout(task, 25));

  function publish(nextState: DesktopState) {
    state = DesktopStateSchema.parse(nextState);
    input.publishState(state);
  }

  function record(action: string) {
    actionCalls.push(action);
  }

  function setScenario(scenario: E2eScenario) {
    const scenarioGeneration = generation + 1;
    generation = scenarioGeneration;
    currentScenario = scenario;
    if (scenario !== "codex-failed") {
      publish(stateForScenario(scenario));
      return;
    }

    publish({
      ...stateForScenario("ready"),
      hostStatus: "degraded",
      runtimeReason: "codex-restarting",
      notice: "Codex App Server 正在重启（1/3）",
    });
    schedule(() => {
      if (
        currentScenario !== "codex-failed" ||
        generation !== scenarioGeneration
      ) {
        return;
      }
      publish({
        ...stateForScenario("ready"),
        hostStatus: "degraded",
        runtimeReason: "codex-restarting",
        notice: "Codex App Server 正在重启（2/3）",
      });
      schedule(() => {
        if (
          currentScenario === "codex-failed" &&
          generation === scenarioGeneration
        ) {
          publish(stateForScenario("codex-failed"));
        }
      });
    });
  }

  function setPairingState() {
    generation += 1;
    currentScenario = "ready";
    publish({
      ...stateForScenario("ready"),
      hostStatus: "degraded",
      runtimeReason: "awaiting-pairing",
      notice: "等待手机配对",
    });
  }

  function setActiveRemoteTurns(count: number) {
    publish({ ...state, activeRemoteTurns: Math.max(0, Math.floor(count)) });
  }

  function releaseOtp() {
    releasePendingOtp?.();
    releasePendingOtp = undefined;
  }

  function setRawErrorMessage() {
    rawErrorMessage = true;
  }

  const success = (message: string): ActionResult => ({
    ok: true,
    message,
  });

  const handlers: DesktopIpcHandlers = {
    getDesktopState: async () => state,
    requestOtp: async () => {
      record("requestOtp");
      if (input.holdOtp) {
        await new Promise<void>((resolve) => {
          releasePendingOtp = resolve;
        });
      }
      return success("验证码已发送");
    },
    verifyOtp: async () => {
      record("verifyOtp");
      currentScenario = "ready";
      publish(stateForScenario("ready"));
      return success("登录成功");
    },
    signInWithPassword: async () => {
      record("signInWithPassword");
      currentScenario = "ready";
      publish(stateForScenario("ready"));
      return success("登录成功");
    },
    signOut: async () => {
      record("signOut");
      currentScenario = "signed-out";
      publish(stateForScenario("signed-out"));
      return success("已退出登录");
    },
    chooseWorkspace: async () => {
      record("chooseWorkspace");
      return { ok: false, message: "已取消添加项目" };
    },
    removeWorkspace: async () => {
      record("removeWorkspace");
      publish({ ...state, workspaces: [], notice: "项目已移除" });
      return success("项目已移除");
    },
    createPairingCode: async () => {
      record("createPairingCode");
      publish({
        ...state,
        hostStatus: "degraded",
        runtimeReason: "awaiting-pairing",
        pairing: {
          code: "000000",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        notice: "配对码已生成",
      });
      return success("配对码已生成");
    },
    startHost: async () => {
      record("startHost");
      publish({
        ...state,
        hostStatus: "running",
        runtimeReason: null,
        pairing: null,
        notice: "Host 已运行",
      });
      return success("Host 已运行");
    },
    stopHost: async ({ force }) => {
      record(force ? "stopHost:force" : "stopHost");
      publish({
        ...state,
        hostStatus: "stopped",
        runtimeReason: null,
        pairing: null,
        notice: "Host 已停止",
      });
      return success("Host 已停止");
    },
    runDoctor: async () => {
      record("runDoctor");
      const failed = currentScenario === "codex-failed";
      const safeMessage = failed
        ? "Doctor 检查发现问题，请先修复"
        : "Doctor 检查通过";
      const message = rawErrorMessage
        ? "Error: C:\\Users\\fixture\\secret access_token=fixture-token private@example.com code=123456"
        : safeMessage;
      publish({
        ...state,
        notice: rawErrorMessage ? "Doctor 检查失败，请稍后重试" : safeMessage,
      });
      return { ok: !failed && !rawErrorMessage, message };
    },
    setOpenAtLogin: async ({ enabled }) => {
      record("setOpenAtLogin");
      publish({
        ...state,
        openAtLogin: enabled,
        notice: enabled ? "已启用开机启动" : "已关闭开机启动",
      });
      return success(enabled ? "已启用开机启动" : "已关闭开机启动");
    },
    openLogFolder: async () => {
      record("openLogFolder");
      return success("测试模式不会打开日志目录");
    },
    beginDataReset: async () => {
      record("beginDataReset");
      return { phrase: "确认清除本机数据" };
    },
    confirmDataReset: async ({ phrase }) => {
      record("confirmDataReset");
      if (phrase !== "确认清除本机数据") {
        return { ok: false, message: "确认内容不正确" };
      }
      currentScenario = "signed-out";
      publish(stateForScenario("signed-out"));
      return success("本机数据已清除");
    },
  };

  return {
    handlers,
    control: {
      setScenario,
      setPairingState,
      setActiveRemoteTurns,
      releaseOtp,
      setRawErrorMessage,
      getTrayMenuLabels: () => [],
      getActionCalls: () => Object.freeze([...actionCalls]),
    },
    state,
  };
}
