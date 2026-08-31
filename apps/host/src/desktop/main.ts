import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
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
import { createConfigStore, type HostConfig } from "./config-store.js";
import {
  createWorkspaceAuthorizer,
  WorkspaceAuthorizerError,
} from "./workspace-authorizer.js";
import { createRedactedLogger } from "./redacted-logger.js";
import { createDoctor } from "./doctor.js";
import { createHostRuntimeController } from "./host-runtime-controller.js";
import { resolveCodexCli } from "./codex-cli-resolver.js";
import {
  createE2eFixture,
  resolveE2eMode,
  type E2eControl,
} from "./e2e-mode.js";
import { CodexAppServerAdapter } from "../codex-app-server-adapter.js";
import { createCodexAppServerProcess } from "../codex-process.js";
import { RemoteCommandRunner } from "../remote-command-runner.js";
import { RemoteThreadStore } from "../remote-thread-store.js";
import { createRotatingWebhookNotificationSink } from "../webhook-notification-sink.js";
import {
  asSupabaseTransportClient,
  SupabaseTransport,
} from "../supabase-transport.js";
import type { RuntimeTransport } from "./host-runtime-controller.js";

declare global {
  var __codexRemoteE2e: E2eControl | undefined;
}

registerAppScheme(protocol);

const e2eMode = resolveE2eMode({
  isPackaged: app.isPackaged,
  source: process.env,
  tempDir: os.tmpdir(),
});
if (e2eMode) {
  app.setPath("userData", e2eMode.userDataDir);
  globalThis.__codexRemoteE2e = undefined;
}

async function runPackageSmoke(): Promise<void> {
  try {
    if (!app.isPackaged) throw new Error("package smoke is packaged-only");
    await app.whenReady();
    const desktopDir = path.dirname(fileURLToPath(import.meta.url));
    installAppProtocol(protocol, path.resolve(desktopDir, "..", "renderer"));
    loadPublicRuntimeConfig({
      source: process.env,
      isPackaged: true,
      resourcePath: path.join(process.resourcesPath, "public-runtime.json"),
    });
    resolveCodexCli({
      isPackaged: true,
      resourcesPath: process.resourcesPath,
    });
    app.exit(0);
  } catch {
    app.exit(1);
  }
}

if (process.argv.includes("--package-smoke")) {
  void runPackageSmoke();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    const desktopDir = path.dirname(fileURLToPath(import.meta.url));
    const rendererRoot = path.resolve(desktopDir, "..", "renderer");
    const trustedPreloadPath = path.resolve(desktopDir, "preload.cjs");
    const startHidden = process.argv.includes("--hidden");
    const loginItemController = e2eMode ? null : createLoginItemController(app);
    const windowManager = createWindowManager({
      createBrowserWindow: (options): ManagedWindow => {
        const electronWindow = new BrowserWindow(options);

        return {
          webContents: {
            sender: electronWindow.webContents,
            get mainFrame() {
              return electronWindow.webContents.mainFrame;
            },
            send: (channel, state) => {
              electronWindow.webContents.send(channel, state);
            },
            on: (event, listener) => {
              electronWindow.webContents.on(event, listener);
            },
            once: (event, listener) => {
              electronWindow.webContents.once(event, listener);
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
      runtimeReason: null,
      activeRemoteTurns: 0,
      lastObservedAt: null,
      lastErrorCode: null,
      openAtLogin: false,
      workspaces: [],
      pairing: null,
      notice: "此功能尚未启用",
    });
    let e2eTrayMenuLabels: readonly string[] = [];
    let ipcController: ReturnType<typeof registerIpcController> | undefined;
    let trayController: ReturnType<typeof createTrayController> | undefined;
    let authController:
      ReturnType<typeof createSupabaseAuthController> | undefined;
    let hostRegistry: ReturnType<typeof createHostRegistry> | undefined;
    let configStore: ReturnType<typeof createConfigStore> | undefined;
    let localConfig: HostConfig | null = null;
    let hostKeyManager: ReturnType<typeof createHostKeyManager> | undefined;
    let workspaceAuthorizer:
      ReturnType<typeof createWorkspaceAuthorizer> | undefined;
    let runtimeController:
      ReturnType<typeof createHostRuntimeController> | undefined;
    let runtimeConfig: ReturnType<typeof loadPublicRuntimeConfig> | undefined;
    let threadStore: RemoteThreadStore | undefined;
    let redactedLogger: ReturnType<typeof createRedactedLogger> | undefined;
    const unavailableAction = async () => unavailableActionResult;
    const unavailableDataResetHandlers: DataResetDesktopHandlers = {
      beginDataReset: async () => ({ phrase: "此功能尚未启用" }),
      confirmDataReset: unavailableAction,
    };
    let dataResetHandlers = unavailableDataResetHandlers;

    function runtimeStatePatch() {
      const runtime = runtimeController?.getSnapshot();
      return runtime
        ? {
            hostStatus: runtime.phase,
            runtimeReason: runtime.reason,
            activeRemoteTurns: runtime.activeRemoteTurns,
            lastObservedAt: runtime.lastObservedAt,
            lastErrorCode: runtime.errorCode,
          }
        : {};
    }

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
      const controller = authController;
      const snapshot = controller?.getSnapshot();
      if (
        !controller ||
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

        if (configStore && hostKeyManager) {
          const keyPair = await hostKeyManager.getOrCreate();
          localConfig = {
            schemaVersion: 1,
            host: {
              id: host.id,
              name: host.name,
              publicKey: JSON.stringify(keyPair.publicKeyJwk),
              protocolVersion: host.protocolVersion,
            },
            workspaces: localConfig?.workspaces ?? [],
            openAtLogin: localConfig?.openAtLogin ?? false,
            installedVersion: localConfig?.installedVersion ?? "0.1.0",
            doctorSummary: localConfig?.doctorSummary ?? null,
          };
          await configStore.write(localConfig);
        }

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

    const e2eFixture = e2eMode
      ? createE2eFixture({
          mode: e2eMode,
          publishState: updateDesktopState,
          holdOtp: true,
          schedule: (task) => {
            setTimeout(task, 250);
          },
        })
      : undefined;
    if (e2eFixture) {
      desktopState = e2eFixture.state;
      globalThis.__codexRemoteE2e = e2eFixture.control;
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
            await runtimeController?.stop({ force: true });
            updateDesktopState({
              ...desktopState,
              ...authStatePatch(),
              host: null,
              pairing: null,
              notice: result.message,
            });
          }
          return result;
        } catch {
          return { ok: false, message: "退出登录失败，请稍后重试" };
        }
      },
      chooseWorkspace: async () => {
        if (!workspaceAuthorizer) return unavailableActionResult;
        if (!desktopState.host) {
          const registration = await registerCurrentHost();
          if (!registration.ok) return registration;
        }
        const selected = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
        if (selected.canceled || !selected.filePaths[0]) {
          return { ok: false, message: "已取消添加项目" };
        }
        try {
          await workspaceAuthorizer.addDirectory(selected.filePaths[0]);
          updateDesktopState({
            ...desktopState,
            workspaces: workspaceAuthorizer.list(),
            notice: "项目已添加",
          });
          return { ok: true, message: "项目已添加" };
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof WorkspaceAuthorizerError
                ? error.message
                : "添加项目失败，请稍后重试",
          };
        }
      },
      removeWorkspace: async ({ workspaceId }) => {
        if (!workspaceAuthorizer) return unavailableActionResult;
        try {
          await workspaceAuthorizer.removeWorkspace(workspaceId);
          updateDesktopState({
            ...desktopState,
            workspaces: workspaceAuthorizer.list(),
            notice: "项目已移除",
          });
          return { ok: true, message: "项目已移除" };
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof WorkspaceAuthorizerError
                ? error.message
                : "移除项目失败，请稍后重试",
          };
        }
      },
      createPairingCode: async () => {
        if (!runtimeController) return unavailableActionResult;
        try {
          const pairing = await runtimeController.createPairingRequest();
          updateDesktopState({
            ...desktopState,
            pairing: { code: pairing.code, expiresAt: pairing.expiresAt },
            notice: "配对码已生成",
          });
          return { ok: true, message: "配对码已生成" };
        } catch {
          return { ok: false, message: "配对码生成失败，请先启动 Host" };
        }
      },
      startHost: async () => {
        if (!runtimeController) return unavailableActionResult;
        const result = await runtimeController.start();
        updateDesktopState({
          ...desktopState,
          ...runtimeStatePatch(),
          notice: result.message,
        });
        return result;
      },
      stopHost: async (input) => {
        if (!runtimeController) return unavailableActionResult;
        const result = await runtimeController.stop(input);
        updateDesktopState({
          ...desktopState,
          ...runtimeStatePatch(),
          notice: result.message,
        });
        return result;
      },
      runDoctor: async () => {
        if (!runtimeConfig || !workspaceAuthorizer || !redactedLogger) {
          return unavailableActionResult;
        }
        const report = await createDoctor({
          appVersion: app.getVersion(),
          checks: [
            {
              id: "platform",
              label: "Windows x64",
              critical: true,
              run: async () =>
                process.platform === "win32" && process.arch === "x64"
                  ? { status: "pass", message: "系统受支持" }
                  : { status: "fail", message: "仅支持 Windows x64" },
            },
            {
              id: "safe-storage",
              label: "本机凭据保护",
              critical: true,
              run: async () =>
                safeStorage.isEncryptionAvailable()
                  ? { status: "pass", message: "凭据保护可用" }
                  : { status: "fail", message: "Windows 凭据保护不可用" },
            },
            {
              id: "session",
              label: "登录状态",
              critical: true,
              run: async () =>
                (await authController?.getRuntimeSession())
                  ? { status: "pass", message: "已登录" }
                  : { status: "fail", message: "请先登录 Host" },
            },
            {
              id: "host-registration",
              label: "Host 登记",
              critical: true,
              run: async () =>
                desktopState.host
                  ? { status: "pass", message: "Host 已登记" }
                  : { status: "fail", message: "Host 尚未登记" },
            },
            {
              id: "workspaces",
              label: "项目目录",
              critical: true,
              run: async () =>
                workspaceAuthorizer!.list().length > 0
                  ? { status: "pass", message: "已有授权项目" }
                  : { status: "fail", message: "请先授权项目目录" },
            },
            {
              id: "codex-cli",
              label: "Codex CLI",
              critical: true,
              run: async () => {
                try {
                  const resolution = resolveCodexCli({
                    isPackaged: app.isPackaged,
                    resourcesPath: process.resourcesPath,
                  });
                  return {
                    status: "pass",
                    message: `版本 ${resolution.version}`,
                  };
                } catch {
                  return {
                    status: "fail",
                    message: "固定版本 Codex CLI 不可用",
                  };
                }
              },
            },
            {
              id: "supabase",
              label: "云端连接配置",
              critical: true,
              run: async () => ({ status: "pass", message: "公共配置可用" }),
            },
            {
              id: "device",
              label: "安卓设备",
              critical: false,
              run: async () => ({
                status: "warning",
                message: "设备状态需启动 Host 后检查",
              }),
            },
            {
              id: "app-server",
              label: "Codex App Server",
              critical: true,
              run: async () => {
                const controller = runtimeController;
                if (!controller) {
                  return { status: "fail", message: "Host 运行时未就绪" };
                }
                try {
                  await controller.checkAppServer();
                  return { status: "pass", message: "App Server 握手成功" };
                } catch {
                  return { status: "fail", message: "App Server 握手失败" };
                }
              },
            },
            {
              id: "login-item",
              label: "开机启动",
              critical: false,
              run: async () => ({
                status: "pass",
                message: "登录启动配置可读取",
              }),
            },
            {
              id: "notifications",
              label: "通知配置",
              critical: false,
              run: async () =>
                runtimeConfig!.webOrigin
                  ? { status: "pass", message: "通知地址可用" }
                  : { status: "warning", message: "未配置通知地址" },
            },
            {
              id: "recent-errors",
              label: "最近运行错误",
              critical: false,
              run: async () =>
                desktopState.lastErrorCode
                  ? { status: "warning", message: "最近存在运行错误" }
                  : { status: "pass", message: "没有最近运行错误" },
            },
          ],
        }).run();
        if (configStore && localConfig) {
          localConfig = { ...localConfig, doctorSummary: report.summary };
          await configStore.write(localConfig);
        }
        if (report.criticalPassed) runtimeController?.markDoctorPassed();
        const message =
          report.summary.status === "passed"
            ? "Doctor 检查通过"
            : report.summary.status === "warning"
              ? "Doctor 检查完成，存在提醒"
              : "Doctor 检查发现问题，请先修复";
        updateDesktopState({ ...desktopState, notice: message });
        redactedLogger.info("doctor_completed", {
          result: report.summary.status === "failed" ? "failed" : "succeeded",
        });
        return { ok: report.summary.status !== "failed", message };
      },
      setOpenAtLogin: async ({ enabled }) => {
        if (loginItemController?.setEnabled(enabled) !== true) {
          return { ok: false, message: "无法更新开机启动设置" };
        }

        updateDesktopState({ ...desktopState, openAtLogin: enabled });
        return {
          ok: true,
          message: enabled ? "已启用开机启动" : "已关闭开机启动",
        };
      },
      openLogFolder: async () => {
        const logPath = path.join(app.getPath("userData"), "logs");
        const error = await shell.openPath(logPath);
        return error
          ? { ok: false, message: "无法打开日志目录" }
          : { ok: true, message: "已打开日志目录" };
      },
      beginDataReset: () => dataResetHandlers.beginDataReset(),
      confirmDataReset: (input) => dataResetHandlers.confirmDataReset(input),
    };

    let isQuitting = false;
    app.on("before-quit", (event) => {
      windowManager.prepareForShutdown();
      if (isQuitting || !runtimeController) return;
      event.preventDefault();
      isQuitting = true;
      void runtimeController.dispose().finally(() => app.quit());
    });

    app.on("second-instance", () => {
      windowManager.show();
    });

    app.on("activate", () => {
      windowManager.show();
    });

    void app.whenReady().then(async () => {
      installAppProtocol(protocol, rendererRoot);
      if (e2eFixture) {
        globalThis.__codexRemoteE2e = {
          ...e2eFixture.control,
          getTrayMenuLabels: () => e2eTrayMenuLabels,
        };
        ipcController = registerIpcController({
          ipcMain,
          getManagementWindow: () => windowManager.getWindow(),
          handlers: e2eFixture.handlers,
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
            buildFromTemplate: (template: TrayMenuItem[]) => {
              e2eTrayMenuLabels = template.map(
                (item) => item.label ?? item.type ?? "",
              );
              return Menu.buildFromTemplate(
                template as MenuItemConstructorOptions[],
              );
            },
          },
          trayImage,
          getState: () => desktopState,
          callbacks: {
            openWindow: () => windowManager.show(),
            startHost: () => e2eFixture.handlers.startHost(),
            stopHost: () => e2eFixture.handlers.stopHost({ force: false }),
            runDoctor: () => e2eFixture.handlers.runDoctor(),
            setOpenAtLogin: (enabled) =>
              e2eFixture.handlers.setOpenAtLogin({ enabled }),
            exit: () => {
              windowManager.prepareForShutdown();
              app.quit();
            },
          },
        });
        trayController.create();
        windowManager.create({ startHidden });
        return;
      }
      dataResetHandlers = createDataResetHandlers(
        createDataResetController({ userDataDir: app.getPath("userData") }),
      );
      try {
        runtimeConfig = loadPublicRuntimeConfig({
          source: process.env,
          isPackaged: app.isPackaged,
          resourcePath: path.join(process.resourcesPath, "public-runtime.json"),
        });
        threadStore = new RemoteThreadStore(
          path.join(app.getPath("userData"), "remote-threads.v1.json"),
        );
        redactedLogger = createRedactedLogger({
          directory: path.join(app.getPath("userData"), "logs"),
          appVersion: app.getVersion(),
        });
        configStore = createConfigStore({
          filePath: path.join(app.getPath("userData"), "config.v1.json"),
        });
        localConfig = await configStore.read();
        workspaceAuthorizer = createWorkspaceAuthorizer({
          initialWorkspaces: localConfig?.workspaces ?? [],
          save: async (workspaces) => {
            if (!configStore || !desktopState.host || !hostKeyManager) {
              throw new Error("Host 尚未登录");
            }
            const keyPair = await hostKeyManager.getOrCreate();
            localConfig = {
              schemaVersion: 1,
              host: {
                id: desktopState.host.id,
                name: desktopState.host.name,
                publicKey: JSON.stringify(keyPair.publicKeyJwk),
                protocolVersion: desktopState.host.protocolVersion,
              },
              workspaces,
              openAtLogin: localConfig?.openAtLogin ?? false,
              installedVersion:
                localConfig?.installedVersion ?? app.getVersion(),
              doctorSummary: localConfig?.doctorSummary ?? null,
            };
            await configStore.write(localConfig);
          },
          isWorkspaceInUse: (workspaceId) =>
            threadStore?.hasActiveTurn(workspaceId) ?? false,
        });
        const credentialStore = createCredentialStore({
          filePath: path.join(app.getPath("userData"), "credentials.v1.bin"),
          safeStorage: {
            isAsyncEncryptionAvailable: async () =>
              safeStorage.isEncryptionAvailable(),
            encryptStringAsync: async (value) =>
              safeStorage.encryptString(value),
            decryptStringAsync: async (value) => ({
              result: safeStorage.decryptString(value),
              shouldReEncrypt: false,
            }),
          },
        });
        hostKeyManager = createHostKeyManager({ credentialStore });
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
        runtimeController = createHostRuntimeController({
          loadPrerequisites: async () => {
            const runtimeSession = await authController!.getRuntimeSession();
            const keyPair = await hostKeyManager!.getOrCreate();
            const hostPrivateKey = runtimeSession
              ? await crypto.subtle.importKey(
                  "jwk",
                  keyPair.privateKeyJwk as JsonWebKey,
                  { name: "ECDH", namedCurve: "P-256" },
                  false,
                  ["deriveBits"],
                )
              : null;
            return {
              signedIn: runtimeSession !== null,
              hostId: desktopState.host?.id ?? null,
              hostName: desktopState.host?.name ?? "Windows Host",
              ownerId: runtimeSession?.ownerId ?? null,
              authSessionId: runtimeSession?.authSessionId ?? null,
              accessToken: runtimeSession?.accessToken ?? null,
              hostPrivateKey,
              authorizedWorkspaces: workspaceAuthorizer!.list(),
              activeRemoteTurns: () => threadStore?.activeTurnCount() ?? 0,
              markRunningUnknown: () => threadStore?.markRunningUnknown(),
              subscribeActivity: (handler) =>
                threadStore?.subscribe(handler) ?? (() => undefined),
            };
          },
          resolveCodexCli: async () =>
            resolveCodexCli({
              isPackaged: app.isPackaged,
              resourcesPath: process.resourcesPath,
            }),
          createCodexRuntime: async ({
            executablePath,
            authorizedWorkspaces,
          }) => {
            const processHandle = createCodexAppServerProcess(executablePath);
            const adapter = new CodexAppServerAdapter(processHandle.client, {
              authorizedWorkspaces,
            });
            return {
              adapter,
              initialize: async () => {
                await adapter.initialize();
              },
              close: async () => {
                processHandle.close();
              },
              onExit: (handler) => processHandle.onExit(() => handler()),
              onError: (handler) => processHandle.onError(() => handler()),
            };
          },
          createTransport: () =>
            new SupabaseTransport(
              asSupabaseTransportClient(authController!.getClient()),
            ) as unknown as RuntimeTransport,
          createRunner: ({
            adapter,
            transport,
            hostId,
            hostName,
            hostPrivateKey,
            authorizedWorkspaces,
            notificationSink,
          }) =>
            new RemoteCommandRunner(transport as never, adapter, {
              hostId,
              hostName,
              hostPrivateKey,
              authorizedWorkspaces,
              threadStore: threadStore!,
              notificationSink,
            }),
          createNotificationSink: (session) =>
            createRotatingWebhookNotificationSink({
              endpoint: `${runtimeConfig!.webOrigin}/api/push/notify`,
              accessToken: session.accessToken,
            }),
          schedule: (delayMs, task) => {
            const timer = setTimeout(task, delayMs);
            return () => clearTimeout(timer);
          },
          logger: redactedLogger!,
        });
        runtimeController.subscribe((runtime) => {
          updateDesktopState({
            ...desktopState,
            ...runtimeStatePatch(),
            hostStatus: runtime.phase,
            runtimeReason: runtime.reason,
            activeRemoteTurns: runtime.activeRemoteTurns,
            lastObservedAt: runtime.lastObservedAt,
            lastErrorCode: runtime.errorCode,
          });
        });
        powerMonitor?.on("resume", () => {
          void runtimeController?.handleSystemResume();
        });
        authController.onRuntimeSessionChanged((session) => {
          if (!session) {
            void runtimeController?.stop({ force: true });
            return;
          }
          void runtimeController?.handleSessionChanged(session).catch(() => {
            redactedLogger?.warn("session_refresh_failed", {
              result: "failed",
              errorCode: "transport_connect_failed",
            });
          });
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
        workspaces: workspaceAuthorizer?.list() ?? [],
        openAtLogin: loginItemController?.isEnabled() ?? false,
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
          stopHost: () => handlers.stopHost({ force: false }),
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
}
