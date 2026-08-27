import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  Tray,
  type NativeImage,
  type MenuItemConstructorOptions,
} from "electron";
import { installAppProtocol, registerAppScheme } from "./app-protocol.js";
import {
  DesktopStateSchema,
  unavailableActionResult,
  type DesktopState,
} from "./contract.js";
import {
  registerIpcController,
  type DesktopIpcHandlers,
} from "./ipc-controller.js";
import { createLoginItemController } from "./login-item.js";
import { createTrayController, type TrayMenuItem } from "./tray-controller.js";
import { createWindowManager, type ManagedWindow } from "./window-manager.js";

registerAppScheme(protocol);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const desktopDir = path.dirname(fileURLToPath(import.meta.url));
  const rendererRoot = path.resolve(desktopDir, "..", "renderer");
  const trustedPreloadPath = path.resolve(desktopDir, "preload.js");
  const startHidden = process.argv.includes("--hidden");
  const loginItemController = createLoginItemController(app);
  const windowManager = createWindowManager({
    createBrowserWindow: (options): ManagedWindow => {
      const electronWindow = new BrowserWindow(options);

      return {
        webContents: {
          mainFrame: electronWindow.webContents.mainFrame,
          send: (channel, state) => {
            electronWindow.webContents.send(channel, state);
          },
          on: (event, listener) => {
            electronWindow.webContents.on(event, listener);
          },
          setWindowOpenHandler: (handler) => {
            electronWindow.webContents.setWindowOpenHandler(handler);
          },
        },
        focus: () => electronWindow.focus(),
        hide: () => electronWindow.hide(),
        isDestroyed: () => electronWindow.isDestroyed(),
        loadURL: (url) => electronWindow.loadURL(url),
        on: (event, listener) => {
          if (event === "close") {
            electronWindow.on(
              "close",
              listener as (event: Electron.Event) => void,
            );
          } else {
            electronWindow.on("closed", listener as () => void);
          }
        },
        once: (event, listener) => {
          electronWindow.once(event, listener);
        },
        setMenuBarVisibility: (visible) =>
          electronWindow.setMenuBarVisibility(visible),
        show: () => electronWindow.show(),
      };
    },
    trustedPreloadPath,
    isPackaged: app.isPackaged,
  });

  let desktopState: DesktopState = DesktopStateSchema.parse({
    phase: "ready",
    authStatus: "signed-out",
    hostStatus: "stopped",
    openAtLogin: false,
    workspace: null,
    notice: "此功能尚未启用",
  });
  let ipcController: ReturnType<typeof registerIpcController> | undefined;
  let trayController: ReturnType<typeof createTrayController> | undefined;

  function updateDesktopState(nextState: DesktopState) {
    desktopState = DesktopStateSchema.parse(nextState);
    ipcController?.publishDesktopState(desktopState);
    trayController?.refresh();
  }

  const unavailableAction = async () => unavailableActionResult;
  const handlers: DesktopIpcHandlers = {
    getDesktopState: async () => desktopState,
    requestOtp: unavailableAction,
    verifyOtp: unavailableAction,
    signOut: unavailableAction,
    chooseWorkspace: unavailableAction,
    removeWorkspace: unavailableAction,
    createPairingCode: unavailableAction,
    startHost: unavailableAction,
    stopHost: unavailableAction,
    runDoctor: unavailableAction,
    setOpenAtLogin: async ({ enabled }) => {
      if (!loginItemController.setEnabled(enabled)) {
        return { ok: false, message: "无法更新开机启动设置" };
      }

      updateDesktopState({ ...desktopState, openAtLogin: enabled });
      return {
        ok: true,
        message: enabled ? "已启用开机启动" : "已关闭开机启动",
      };
    },
    openLogFolder: unavailableAction,
    beginDataReset: async () => ({ phrase: "此功能尚未启用" }),
    confirmDataReset: unavailableAction,
  };

  app.on("before-quit", () => {
    windowManager.prepareForShutdown();
  });

  app.on("second-instance", () => {
    windowManager.show();
  });

  app.on("activate", () => {
    windowManager.show();
  });

  void app.whenReady().then(async () => {
    installAppProtocol(protocol, rendererRoot);
    updateDesktopState({
      ...desktopState,
      openAtLogin: loginItemController.isEnabled(),
    });

    ipcController = registerIpcController({
      ipcMain,
      getManagementWindow: () => windowManager.getWindow(),
      handlers,
    });

    const trayImage = await app.getFileIcon(process.execPath, {
      size: "small",
    });
    trayController = createTrayController({
      createTray: (image) => {
        const electronTray = new Tray(image as string | NativeImage);
        return {
          setToolTip: (toolTip: string) => electronTray.setToolTip(toolTip),
          setContextMenu: (menu: unknown) =>
            electronTray.setContextMenu(menu as Electron.Menu | null),
          on: (event: "double-click", listener: () => void) =>
            electronTray.on(event, listener),
        };
      },
      Menu: {
        buildFromTemplate: (template: TrayMenuItem[]) =>
          Menu.buildFromTemplate(template as MenuItemConstructorOptions[]),
      },
      trayImage,
      getState: () => desktopState,
      callbacks: {
        openWindow: () => windowManager.show(),
        startHost: () => handlers.startHost(),
        stopHost: () => handlers.stopHost(),
        runDoctor: () => handlers.runDoctor(),
        setOpenAtLogin: (enabled) => handlers.setOpenAtLogin({ enabled }),
        exit: () => {
          windowManager.prepareForShutdown();
          app.quit();
        },
      },
    });
    trayController.create();
    windowManager.create({ startHidden });
  });
}
