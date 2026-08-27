import type { DesktopState } from "./contract.js";

export type TrayMenuItem = {
  label?: string;
  type?: "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  click?: (menuItem?: { checked: boolean }) => void;
};

type TrayLike = {
  setToolTip: (toolTip: string) => void;
  setContextMenu: (menu: unknown) => void;
  on: (event: "double-click", listener: () => void) => void;
};

type TrayCallbacks = {
  openWindow: () => unknown;
  startHost: () => unknown;
  stopHost: () => unknown;
  runDoctor: () => unknown;
  setOpenAtLogin: (enabled: boolean) => unknown;
  exit: () => unknown;
};

type CreateTrayControllerOptions<TTray extends TrayLike> = {
  createTray: (image: unknown) => TTray;
  Menu: {
    buildFromTemplate: (template: TrayMenuItem[]) => unknown;
  };
  trayImage: unknown;
  getState: () => Pick<DesktopState, "hostStatus" | "openAtLogin">;
  callbacks: TrayCallbacks;
};

const hostStatusLabels: Record<DesktopState["hostStatus"], string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "异常",
};

function runAction(action: () => unknown) {
  void Promise.resolve(action()).catch(() => undefined);
}

export function createTrayController<TTray extends TrayLike>({
  createTray,
  Menu,
  trayImage,
  getState,
  callbacks,
}: CreateTrayControllerOptions<TTray>) {
  let tray: TTray | undefined;

  function buildMenu() {
    const state = getState();
    const shouldStopHost =
      state.hostStatus === "running" || state.hostStatus === "starting";
    const hostTransitioning =
      state.hostStatus === "starting" || state.hostStatus === "stopping";

    return Menu.buildFromTemplate([
      {
        label: `状态：Host ${hostStatusLabels[state.hostStatus]}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "打开管理窗口",
        click: () => runAction(callbacks.openWindow),
      },
      {
        label: shouldStopHost ? "停止 Host" : "启动 Host",
        enabled: !hostTransitioning,
        click: () =>
          runAction(shouldStopHost ? callbacks.stopHost : callbacks.startHost),
      },
      {
        label: "运行 Doctor",
        click: () => runAction(callbacks.runDoctor),
      },
      {
        label: "开机时启动",
        type: "checkbox",
        checked: state.openAtLogin,
        click: (menuItem) =>
          runAction(() => callbacks.setOpenAtLogin(Boolean(menuItem?.checked))),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => runAction(callbacks.exit),
      },
    ]);
  }

  function refresh() {
    if (!tray) {
      return;
    }

    tray.setContextMenu(buildMenu());
  }

  function create() {
    if (tray) {
      return tray;
    }

    tray = createTray(trayImage);
    tray.setToolTip("Codex Remote Host");
    tray.on("double-click", () => runAction(callbacks.openWindow));
    refresh();
    return tray;
  }

  return {
    create,
    getTray: () => tray,
    refresh,
  };
}

export type TrayController = ReturnType<typeof createTrayController>;
