import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createWindowManager } from "./window-manager.js";

class FakeWebContents extends EventEmitter {
  readonly mainFrame = {
    url: "app://host/index.html",
    isDestroyed: () => false,
  };
  readonly send = vi.fn();
  windowOpenHandler?: (details: { url: string }) => {
    action: "allow" | "deny";
  };

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "allow" | "deny" },
  ) {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = [];

  readonly webContents = new FakeWebContents();
  readonly loadURL = vi.fn(async () => undefined);
  readonly show = vi.fn();
  readonly hide = vi.fn();
  readonly focus = vi.fn();
  readonly setMenuBarVisibility = vi.fn();
  readonly options: Record<string, unknown>;
  destroyed = false;

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() {
    return this.destroyed;
  }
}

function createManager(options: { isPackaged?: boolean } = {}) {
  FakeBrowserWindow.instances = [];
  return createWindowManager({
    createBrowserWindow: (windowOptions) =>
      new FakeBrowserWindow(windowOptions),
    trustedPreloadPath: "C:\\trusted\\preload.js",
    isPackaged: options.isPackaged ?? true,
  });
}

describe("window manager", () => {
  it("creates the management window with hardened preferences and the local URL", () => {
    const manager = createManager();

    const window = manager.create();

    expect(window.options).toMatchObject({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: "C:\\trusted\\preload.js",
        devTools: false,
      },
    });
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(window.loadURL).toHaveBeenCalledWith("app://host/index.html");
  });

  it("denies navigation outside app://host and denies every new window", () => {
    const manager = createManager();
    const window = manager.create();
    const externalEvent = { preventDefault: vi.fn() };
    const localEvent = { preventDefault: vi.fn() };

    window.webContents.emit(
      "will-navigate",
      externalEvent,
      "https://example.com",
    );
    window.webContents.emit("will-navigate", localEvent, "app://host/settings");

    expect(externalEvent.preventDefault).toHaveBeenCalledOnce();
    expect(localEvent.preventDefault).not.toHaveBeenCalled();
    expect(
      window.webContents.windowOpenHandler?.({ url: "app://host/popup" }),
    ).toEqual({
      action: "deny",
    });
    expect(
      window.webContents.windowOpenHandler?.({ url: "https://example.com" }),
    ).toEqual({
      action: "deny",
    });
  });

  it("retains one window and hides normal closes without blocking shutdown", () => {
    const manager = createManager();
    const window = manager.create();

    expect(manager.create()).toBe(window);
    expect(manager.getWindow()).toBe(window);

    const closeEvent = { preventDefault: vi.fn() };
    window.emit("close", closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    manager.prepareForShutdown();
    const shutdownCloseEvent = { preventDefault: vi.fn() };
    window.emit("close", shutdownCloseEvent);

    expect(shutdownCloseEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps hidden launches in the tray until explicitly opened", () => {
    const manager = createManager({ isPackaged: false });
    const window = manager.create({ startHidden: true });

    window.emit("ready-to-show");
    expect(window.show).not.toHaveBeenCalled();

    manager.show();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
});
