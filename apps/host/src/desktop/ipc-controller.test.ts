import { describe, expect, it, vi } from "vitest";
import {
  desktopApiMethodNames,
  desktopChannels,
  unavailableActionResult,
  type DesktopApi,
  type DesktopState,
} from "./contract.js";
import {
  registerIpcController,
  type DesktopIpcHandlers,
  type IpcEvent,
  type IpcMainBoundary,
} from "./ipc-controller.js";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

type IpcHandler = (event: IpcEvent, ...args: unknown[]) => Promise<unknown>;

class FakeIpcMain implements IpcMainBoundary {
  readonly handlers = new Map<string, IpcHandler>();

  handle(channel: string, handler: IpcHandler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }
}

const desktopState: DesktopState = {
  phase: "ready",
  authStatus: "signed-out",
  hostStatus: "stopped",
  runtimeReason: null,
  activeRemoteTurns: 0,
  lastObservedAt: null,
  lastErrorCode: null,
  openAtLogin: false,
  workspaces: [],
  pairing: null,
  notice: "此功能尚未启用",
};

function createHandlers(
  overrides: Partial<DesktopIpcHandlers> = {},
): DesktopIpcHandlers {
  const unavailable = vi.fn(async () => unavailableActionResult);

  return {
    getDesktopState: vi.fn(async () => desktopState),
    requestOtp: unavailable,
    verifyOtp: unavailable,
    signInWithPassword: unavailable,
    signOut: unavailable,
    chooseWorkspace: unavailable,
    removeWorkspace: unavailable,
    createPairingCode: unavailable,
    startHost: unavailable,
    stopHost: unavailable,
    runDoctor: unavailable,
    setOpenAtLogin: unavailable,
    openLogFolder: unavailable,
    beginDataReset: vi.fn(async () => ({ phrase: "此功能尚未启用" })),
    confirmDataReset: unavailable,
    ...overrides,
  };
}

function setup(overrides: Partial<DesktopIpcHandlers> = {}) {
  const ipcMain = new FakeIpcMain();
  const frame = {
    url: "app://host/index.html",
    isDestroyed: vi.fn(() => false),
  };
  const webContents = {
    mainFrame: frame,
    send: vi.fn(),
  };
  const managementWindow = {
    isDestroyed: vi.fn(() => false),
    webContents,
  };
  const handlers = createHandlers(overrides);
  const controller = registerIpcController({
    ipcMain,
    getManagementWindow: () => managementWindow,
    handlers,
  });
  const event: IpcEvent = { sender: webContents, senderFrame: frame };

  return {
    controller,
    event,
    frame,
    handlers,
    ipcMain,
    managementWindow,
    webContents,
  };
}

describe("IPC controller", () => {
  it("registers every approved invoke channel", () => {
    const { ipcMain } = setup();

    expect([...ipcMain.handlers.keys()]).toEqual([
      desktopChannels.getDesktopState,
      desktopChannels.requestOtp,
      desktopChannels.verifyOtp,
      desktopChannels.signInWithPassword,
      desktopChannels.signOut,
      desktopChannels.chooseWorkspace,
      desktopChannels.removeWorkspace,
      desktopChannels.createPairingCode,
      desktopChannels.startHost,
      desktopChannels.stopHost,
      desktopChannels.runDoctor,
      desktopChannels.setOpenAtLogin,
      desktopChannels.openLogFolder,
      desktopChannels.beginDataReset,
      desktopChannels.confirmDataReset,
    ]);
  });

  it("validates an authorized request and its safe result", async () => {
    const setOpenAtLogin = vi.fn(async () => ({ ok: true, message: "已更新" }));
    const { event, ipcMain } = setup({ setOpenAtLogin });
    const invoke = ipcMain.handlers.get(desktopChannels.setOpenAtLogin);

    await expect(invoke?.(event, { enabled: true })).resolves.toEqual({
      ok: true,
      message: "已更新",
    });
    expect(setOpenAtLogin).toHaveBeenCalledWith({ enabled: true });
  });

  it.each([
    "different-window",
    "destroyed-frame",
    "child-frame",
    "unexpected-origin",
  ])("rejects sender boundary violation: %s", async (violation) => {
    const { event, frame, ipcMain, webContents } = setup();
    const invoke = ipcMain.handlers.get(desktopChannels.getDesktopState);
    const invalidEvent = { ...event };

    if (violation === "different-window") {
      invalidEvent.sender = { ...webContents };
    } else if (violation === "destroyed-frame") {
      frame.isDestroyed.mockReturnValue(true);
    } else if (violation === "child-frame") {
      invalidEvent.senderFrame = { ...frame };
    } else {
      frame.url = "https://example.com";
    }

    await expect(invoke?.(invalidEvent)).rejects.toThrow(
      "Unauthorized desktop IPC sender",
    );
  });

  it("rejects malformed inputs before invoking the injected handler", async () => {
    const requestOtp = vi.fn(async () => unavailableActionResult);
    const { event, ipcMain } = setup({ requestOtp });
    const invoke = ipcMain.handlers.get(desktopChannels.requestOtp);

    await expect(
      invoke?.(event, { email: "not-an-email", accessToken: "secret" }),
    ).rejects.toThrow();
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it("rejects unsafe handler output instead of forwarding it", async () => {
    const startHost = vi.fn(async () => ({
      ok: false,
      message: "失败",
      accessToken: "secret",
    }));
    const { event, ipcMain } = setup({ startHost });
    const invoke = ipcMain.handlers.get(desktopChannels.startHost);

    await expect(invoke?.(event)).rejects.toThrow();
  });

  it("publishes only validated state to the current management window", () => {
    const { controller, webContents } = setup();

    controller.publishDesktopState(desktopState);

    expect(webContents.send).toHaveBeenCalledWith(
      desktopChannels.stateChanged,
      desktopState,
    );
    expect(() =>
      controller.publishDesktopState({
        ...desktopState,
        accessToken: "secret",
      } as DesktopState),
    ).toThrow();
  });
});

describe("preload surface", () => {
  it("exposes only frozen wrappers and cleans up only the subscribing listener", async () => {
    electronMocks.exposeInMainWorld.mockReset();
    electronMocks.invoke.mockReset();
    electronMocks.on.mockReset();
    electronMocks.removeListener.mockReset();
    electronMocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === desktopChannels.getDesktopState) {
        return desktopState;
      }
      if (channel === desktopChannels.beginDataReset) {
        return { phrase: "此功能尚未启用" };
      }
      return unavailableActionResult;
    });

    await import("./preload.js");

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledOnce();
    const [globalName, exposedApi] = electronMocks.exposeInMainWorld.mock
      .calls[0] as [string, DesktopApi];
    expect(globalName).toBe("codexRemoteHost");
    expect(Object.keys(exposedApi)).toEqual(desktopApiMethodNames);
    expect(Object.isFrozen(exposedApi)).toBe(true);
    expect("ipcRenderer" in exposedApi).toBe(false);
    expect("channels" in exposedApi).toBe(false);

    await expect(exposedApi.getDesktopState()).resolves.toEqual(desktopState);
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      desktopChannels.getDesktopState,
    );

    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const unsubscribeFirst = exposedApi.subscribeDesktopState(firstHandler);
    exposedApi.subscribeDesktopState(secondHandler);
    const firstListener = electronMocks.on.mock.calls[0]?.[1] as (
      event: unknown,
      state: DesktopState,
    ) => void;
    const secondListener = electronMocks.on.mock.calls[1]?.[1];

    firstListener({}, desktopState);
    expect(firstHandler).toHaveBeenCalledWith(desktopState);
    unsubscribeFirst();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      desktopChannels.stateChanged,
      firstListener,
    );
    expect(electronMocks.removeListener).not.toHaveBeenCalledWith(
      desktopChannels.stateChanged,
      secondListener,
    );
  });
});
