import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  safeStorage,
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
import {
  createDataResetHandlers,
  type DataResetDesktopHandlers,
} from "./data-reset-handlers.js";
import { createDataResetController } from "./data-reset.js";
import { createLoginItemController } from "./login-item.js";
import { createTrayController, type TrayMenuItem } from "./tray-controller.js";
import { createWindowManager, type ManagedWindow } from "./window-manager.js";
import { createCredentialStore } from "./credential-store.js";
import { createHostKeyManager } from "./host-key-manager.js";
import { createHostRegistry, HostRegistryError } from "./host-registry.js";
import { loadPublicRuntimeConfig } from "./public-runtime-config.js";
import { createSupabaseAuthController } from "./supabase-auth-controller.js";

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
  let authController:
    ReturnType<typeof createSupabaseAuthController> | undefined;
  let hostRegistry: ReturnType<typeof createHostRegistry> | undefined;
  const unavailableAction = async () => unavailableActionResult;
  const unavailableDataResetHandlers: DataResetDesktopHandlers = {
    beginDataReset: async () => ({ phrase: "此功能尚未启用" }),
    confirmDataReset: unavailableAction,
  };
  let dataResetHandlers = unavailableDataResetHandlers;

  function authStatePatch() {
    const snapshot = authController?.getSnapshot();
    return {
      authStatus: snapshot?.signedIn
        ? ("signed-in" as const)
        : ("signed-out" as const),
      maskedEmail: snapshot?.maskedEmail ?? null,
    };
  }

  async function registerCurrentHost() {
    const snapshot = authController?.getSnapshot();
    if (
      !snapshot?.signedIn ||
      !snapshot.ownerId ||
      !snapshot.authSessionId ||
      !hostRegistry
    ) {
      return { ok: false as const, message: "登录状态不完整，请重新登录" };
    }
    try {
      const host = await hostRegistry.ensureRegistered({
        ownerId: snapshot.ownerId,
        authSessionId: snapshot.authSessionId,
      });
      updateDesktopState({
        ...desktopState,
        ...authStatePatch(),
        host: {
          id: host.id,
          name: host.name,
          protocolVersion: host.protocolVersion,
        },
        notice: "Host 已连接到账号",
      });
      return { ok: true as const, message: "登录成功" };
    } catch (error) {
      const message =
        error instanceof HostRegistryError
          ? error.message
          : "无法登记 Host，请稍后重试";
      updateDesktopState({
        ...desktopState,
        ...authStatePatch(),
        host: null,
        notice: message,
      });
      return { ok: false as const, message };
    }
  }

  function updateDesktopState(nextState: DesktopState) {
    desktopState = DesktopStateSchema.parse(nextState);
    ipcController?.publishDesktopState(desktopState);
    trayController?.refresh();
  }

  const handlers: DesktopIpcHandlers = {
    getDesktopState: async () => desktopState,
    requestOtp: async ({ email }) => {
      if (!authController) return unavailableActionResult;
      try {
        return await authController.requestOtp(email);
      } catch {
        return { ok: false, message: "验证码发送失败，请稍后重试" };
      }
    },
    verifyOtp: async ({ email, token }) => {
      if (!authController) return unavailableActionResult;
      try {
        const result = await authController.verifyOtp(email, token);
        if (!result.ok) return result;
        return await registerCurrentHost();
      } catch {
        return { ok: false, message: "登录失败，请稍后重试" };
      }
    },
    signOut: async () => {
      if (!authController) return unavailableActionResult;
      try {
        const result = await authController.signOut();
        if (result.ok) {
          updateDesktopState({
            ...desktopState,
            ...authStatePatch(),
            host: null,
            notice: result.message,
          });
        }
        return result;
      } catch {
        return { ok: false, message: "退出登录失败，请稍后重试" };
      }
    },
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
    beginDataReset: () => dataResetHandlers.beginDataReset(),
    confirmDataReset: (input) => dataResetHandlers.confirmDataReset(input),
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
    dataResetHandlers = createDataResetHandlers(
      createDataResetController({ userDataDir: app.getPath("userData") }),
    );
    try {
      const runtimeConfig = loadPublicRuntimeConfig({
        source: process.env,
        isPackaged: app.isPackaged,
        resourcePath: path.join(process.resourcesPath, "public-runtime.json"),
      });
      const credentialStore = createCredentialStore({
        filePath: path.join(app.getPath("userData"), "credentials.v1.bin"),
        safeStorage: {
          isAsyncEncryptionAvailable: async () =>
            safeStorage.isEncryptionAvailable(),
          encryptStringAsync: async (value) => safeStorage.encryptString(value),
          decryptStringAsync: async (value) => ({
            result: safeStorage.decryptString(value),
            shouldReEncrypt: false,
          }),
        },
      });
      const hostKeyManager = createHostKeyManager({ credentialStore });
      authController = createSupabaseAuthController({
        runtimeConfig,
        credentialStore,
        hostKeyManager,
      });
      hostRegistry = createHostRegistry({
        client: authController.getClient() as never,
        hostKeyManager,
        hostName: "Windows Host",
        version: app.getVersion(),
        protocolVersion: 1,
      });
      await authController.restore();
      if (authController.getSnapshot().signedIn) {
        await registerCurrentHost();
      } else {
        updateDesktopState({
          ...desktopState,
          ...authStatePatch(),
          host: null,
          notice: "请输入邮箱登录 Host",
        });
      }
    } catch {
      updateDesktopState({
        ...desktopState,
        notice: "尚未配置 Supabase 公共参数，请联系项目管理员",
      });
    }
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
