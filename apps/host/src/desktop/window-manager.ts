type PreventableEvent = {
  preventDefault: () => void;
};

type ManagedWebContents = {
  sender?: unknown;
  mainFrame: {
    url: string;
    isDestroyed: () => boolean;
  };
  send: (channel: string, state: unknown) => void;
  on: (
    event: "will-navigate",
    listener: (event: PreventableEvent, url: string) => void,
  ) => unknown;
  setWindowOpenHandler: (
    handler: (details: { url: string }) => { action: "deny" },
  ) => void;
};

export type ManagedWindow = {
  webContents: ManagedWebContents;
  focus: () => void;
  hide: () => void;
  isDestroyed: () => boolean;
  loadURL: (url: string) => Promise<unknown> | unknown;
  on: (
    event: "close" | "closed",
    listener: ((event: PreventableEvent) => void) | (() => void),
  ) => unknown;
  once: (event: "ready-to-show", listener: () => void) => unknown;
  setMenuBarVisibility: (visible: boolean) => void;
  show: () => void;
};

type BrowserWindowOptions = {
  width: number;
  height: number;
  show: boolean;
  autoHideMenuBar: boolean;
  webPreferences: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    webSecurity: true;
    preload: string;
    devTools: boolean;
  };
};

type WindowManagerDependencies<TWindow extends ManagedWindow> = {
  createBrowserWindow: (options: BrowserWindowOptions) => TWindow;
  trustedPreloadPath: string;
  isPackaged: boolean;
};

function isTrustedManagementUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.protocol === "app:" &&
      parsedUrl.hostname === "host" &&
      parsedUrl.username === "" &&
      parsedUrl.password === "" &&
      parsedUrl.port === ""
    );
  } catch {
    return false;
  }
}

export function createWindowManager<TWindow extends ManagedWindow>({
  createBrowserWindow,
  trustedPreloadPath,
  isPackaged,
}: WindowManagerDependencies<TWindow>) {
  let managementWindow: TWindow | undefined;
  let applicationIsShuttingDown = false;

  function create(options: { startHidden?: boolean } = {}) {
    if (managementWindow && !managementWindow.isDestroyed()) {
      return managementWindow;
    }

    const window = createBrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: trustedPreloadPath,
        devTools: !isPackaged,
      },
    });

    managementWindow = window;
    window.setMenuBarVisibility(false);
    window.webContents.on("will-navigate", (event, url) => {
      if (!isTrustedManagementUrl(url)) {
        event.preventDefault();
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.on("close", (event) => {
      if (applicationIsShuttingDown) {
        return;
      }

      event.preventDefault();
      window.hide();
    });
    window.on("closed", () => {
      if (managementWindow === window) {
        managementWindow = undefined;
      }
    });
    window.once("ready-to-show", () => {
      if (!options.startHidden) {
        window.show();
      }
    });
    void window.loadURL("app://host/index.html");

    return window;
  }

  return {
    create,
    getWindow: () => managementWindow,
    prepareForShutdown: () => {
      applicationIsShuttingDown = true;
    },
    show: () => {
      const window = create();
      window.show();
      window.focus();
    },
  };
}

export type WindowManager = ReturnType<typeof createWindowManager>;
