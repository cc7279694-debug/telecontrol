import { describe, expect, it, vi } from "vitest";
import type { AuthorizedWorkspace } from "../codex-app-server-adapter.js";
import type { RemoteCommandAdapter } from "../remote-command-runner.js";
import type { LinkedDevice, PairingRequest } from "../supabase-transport.js";
import {
  createHostRuntimeController,
  type HostRuntimePorts,
  type RuntimePrerequisites,
} from "./host-runtime-controller.js";

const workspace: AuthorizedWorkspace = {
  id: "workspace-1",
  path: "C:\\Projects\\demo",
  name: "demo",
};
const device: LinkedDevice = {
  id: "device-1",
  public_key: JSON.stringify({
    kty: "EC",
    crv: "P-256",
    x: "public-x",
    y: "public-y",
  }),
  revoked_at: null,
};
const session = {
  accessToken: "access-token",
  ownerId: "owner-1",
  authSessionId: "session-1",
};

function createFixture({
  linkedDevice = device,
  activeRemoteTurns = 0,
}: {
  linkedDevice?: LinkedDevice | null;
  activeRemoteTurns?: number;
} = {}) {
  const order: string[] = [];
  let exitHandler: () => void = () => {};
  const schedules: Array<{
    delayMs: number;
    task: () => void;
    cancelled: boolean;
  }> = [];
  const runner = {
    start: vi.fn(() => order.push("runner.start")),
    stop: vi.fn(() => order.push("runner.stop")),
    publishAuthoritativeSnapshot: vi.fn(async () => {
      order.push("runner.snapshot");
    }),
  };
  const transport = {
    setPairingHostId: vi.fn(),
    findActiveLinkedDevice: vi.fn(async () => linkedDevice),
    connect: vi.fn(async () => {
      order.push("transport.connect");
    }),
    disconnect: vi.fn(async () => {
      order.push("transport.disconnect");
    }),
    heartbeat: vi.fn(async () => {
      order.push("transport.heartbeat");
    }),
    refreshAccessToken: vi.fn(async () => {
      order.push("transport.refresh");
    }),
    createPairingRequest: vi.fn(async (): Promise<PairingRequest> => ({
      pairingId: "pairing-1",
      code: "123456",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    })),
  };
  const codex = {
    adapter: {} as RemoteCommandAdapter,
    initialize: vi.fn(async () => {
      order.push("codex.initialize");
    }),
    close: vi.fn(async () => {
      order.push("codex.close");
    }),
    onExit: vi.fn((handler: () => void) => {
      exitHandler = handler;
      return () => {
        exitHandler = () => {};
      };
    }),
    onError: vi.fn(() => () => undefined),
  };
  const ports: HostRuntimePorts = {
    loadPrerequisites: vi.fn(async (): Promise<RuntimePrerequisites> => ({
      signedIn: true,
      hostId: "11111111-1111-4111-8111-111111111111",
      hostName: "Windows Host",
      ownerId: session.ownerId,
      authSessionId: session.authSessionId,
      accessToken: session.accessToken,
      hostPrivateKey: {} as CryptoKey,
      authorizedWorkspaces: [workspace],
      activeRemoteTurns: () => activeRemoteTurns,
      markRunningUnknown: vi.fn(),
    })),
    resolveCodexCli: vi.fn(async () => ({
      executablePath: "C:\\Codex\\codex.exe",
      version: "0.149.0" as const,
      source: "workspace-package" as const,
    })),
    createCodexRuntime: vi.fn(async () => codex),
    createTransport: vi.fn(() => transport),
    createRunner: vi.fn(() => runner),
    createNotificationSink: vi.fn(() => undefined),
    schedule: vi.fn((delayMs: number, task: () => void) => {
      const entry = { delayMs, task, cancelled: false };
      schedules.push(entry);
      return () => {
        entry.cancelled = true;
      };
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  const controller = createHostRuntimeController(ports);
  return {
    controller,
    ports,
    runner,
    transport,
    codex,
    order,
    schedules,
    triggerCodexExit: () => exitHandler(),
  };
}

describe("HostRuntimeController", () => {
  it("rejects start when the Host is not signed in", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.ports.loadPrerequisites).mockResolvedValueOnce({
      signedIn: false,
      hostId: null,
      hostName: "Windows Host",
      ownerId: null,
      authSessionId: null,
      accessToken: null,
      hostPrivateKey: null,
      authorizedWorkspaces: [],
      activeRemoteTurns: () => 0,
      markRunningUnknown: vi.fn(),
    });

    await expect(fixture.controller.start()).resolves.toEqual({
      ok: false,
      message: "请先登录 Host",
    });
    expect(fixture.ports.createCodexRuntime).not.toHaveBeenCalled();
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "error",
      errorCode: "not_signed_in",
    });
  });

  it("initializes Codex then waits for pairing without starting remote commands", async () => {
    const fixture = createFixture({ linkedDevice: null });

    await expect(fixture.controller.start()).resolves.toEqual({
      ok: true,
      message: "Codex 已启动，等待手机配对",
    });

    expect(fixture.order).toEqual(["codex.initialize"]);
    expect(fixture.runner.start).not.toHaveBeenCalled();
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "degraded",
      reason: "awaiting-pairing",
      errorCode: null,
    });
  });

  it("connects a paired device, publishes a snapshot, and starts once", async () => {
    const fixture = createFixture();

    await expect(fixture.controller.start()).resolves.toEqual({
      ok: true,
      message: "Host 已运行",
    });
    await expect(fixture.controller.start()).resolves.toEqual({
      ok: true,
      message: "Host 已运行",
    });

    expect(fixture.order).toEqual([
      "codex.initialize",
      "transport.connect",
      "transport.heartbeat",
      "runner.snapshot",
      "runner.start",
    ]);
    expect(vi.mocked(fixture.ports.createCodexRuntime)).toHaveBeenCalledOnce();
    expect(fixture.ports.createRunner).toHaveBeenCalledOnce();
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "running",
      reason: null,
    });
  });

  it("starts pairing polling and connects when a device appears", async () => {
    const fixture = createFixture({ linkedDevice: null });
    vi.mocked(fixture.transport.findActiveLinkedDevice)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(device);

    await fixture.controller.start();
    await expect(fixture.controller.createPairingRequest()).resolves.toEqual({
      pairingId: "pairing-1",
      code: "123456",
      expiresAt: expect.any(String),
    });
    expect(fixture.schedules[0]?.delayMs).toBe(2_000);

    fixture.schedules[0]?.task();
    await vi.waitFor(() => expect(fixture.runner.start).toHaveBeenCalledOnce());
    expect(fixture.controller.getSnapshot().phase).toBe("running");
  });

  it("refuses a normal stop while a remote turn is active", async () => {
    const fixture = createFixture({ activeRemoteTurns: 1 });
    await fixture.controller.start();

    await expect(fixture.controller.stop({ force: false })).resolves.toEqual({
      ok: false,
      message: "当前有活动任务，请确认后再停止",
    });
    expect(fixture.runner.stop).not.toHaveBeenCalled();
  });

  it("stops in reverse dependency order and is idempotent", async () => {
    const fixture = createFixture();
    await fixture.controller.start();

    await expect(fixture.controller.stop({ force: true })).resolves.toEqual({
      ok: true,
      message: "Host 已停止",
    });
    await expect(fixture.controller.stop({ force: true })).resolves.toEqual({
      ok: true,
      message: "Host 已停止",
    });

    expect(fixture.order.slice(-3)).toEqual([
      "runner.stop",
      "transport.disconnect",
      "codex.close",
    ]);
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "stopped",
      activeRemoteTurns: 0,
    });
  });

  it("refreshes transport credentials without restarting Codex", async () => {
    const fixture = createFixture();
    await fixture.controller.start();
    const createCodexRuntime = vi.mocked(fixture.ports.createCodexRuntime);
    const initialCodexCount = createCodexRuntime.mock.calls.length;

    await fixture.controller.handleSessionChanged({
      ...session,
      accessToken: "refreshed-access-token",
    });

    expect(fixture.transport.refreshAccessToken).toHaveBeenCalledWith(
      "refreshed-access-token",
    );
    expect(createCodexRuntime).toHaveBeenCalledTimes(initialCodexCount);
    expect(fixture.ports.createRunner).toHaveBeenCalledTimes(2);
    expect(fixture.runner.start).toHaveBeenCalled();
  });

  it("reconnects only the transport after a temporary network failure", async () => {
    const fixture = createFixture();
    await fixture.controller.start();
    fixture.transport.connect.mockRejectedValueOnce(new Error("offline"));

    await fixture.controller.handleNetworkOnline();

    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "degraded",
      reason: "transport-offline",
      errorCode: "transport_connect_failed",
    });
    expect(fixture.ports.createCodexRuntime).toHaveBeenCalledOnce();

    await fixture.controller.handleNetworkOnline();

    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "running",
      reason: null,
    });
  });

  it("marks a crashed App Server degraded and schedules bounded restart", async () => {
    const fixture = createFixture();
    await fixture.controller.start();

    fixture.triggerCodexExit();
    await vi.waitFor(() => expect(fixture.schedules[0]?.delayMs).toBe(1_000));

    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "degraded",
      reason: "codex-restarting",
      errorCode: "app_server_exited",
      appServerRestartAttempt: 1,
    });
    expect(fixture.ports.loadPrerequisites).toHaveBeenCalledOnce();
  });
});
