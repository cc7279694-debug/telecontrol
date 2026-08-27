import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppProtocolHandler,
  installAppProtocol,
  registerAppScheme,
} from "./app-protocol.js";

const temporaryDirectories: string[] = [];

async function createRendererFixture() {
  const rendererRoot = await mkdtemp(
    path.join(tmpdir(), "codex-remote-renderer-"),
  );
  temporaryDirectories.push(rendererRoot);
  await mkdir(path.join(rendererRoot, "assets"));
  await writeFile(
    path.join(rendererRoot, "index.html"),
    "<main>Host shell</main>",
  );
  await writeFile(
    path.join(rendererRoot, "assets", "app.js"),
    "export const ready = true;",
  );
  return rendererRoot;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("app protocol", () => {
  it("registers app as a secure standard scheme before readiness", () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerAppScheme({ registerSchemesAsPrivileged });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "app",
        privileges: {
          secure: true,
          standard: true,
          supportFetchAPI: true,
        },
      },
    ]);
  });

  it("installs the handler only for the app scheme", async () => {
    const rendererRoot = await createRendererFixture();
    const handle = vi.fn();

    installAppProtocol({ handle }, rendererRoot);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toBe("app");
    expect(handle.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });

  it("serves bundled files for GET and omits the body for HEAD", async () => {
    const handler = createAppProtocolHandler(await createRendererFixture());

    const getResponse = await handler(new Request("app://host/assets/app.js"));
    const headResponse = await handler(
      new Request("app://host/assets/app.js", { method: "HEAD" }),
    );

    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toBe("export const ready = true;");
    expect(getResponse.headers.get("content-type")).toContain(
      "text/javascript",
    );
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");
  });

  it("rejects non-read methods and unexpected hosts", async () => {
    const handler = createAppProtocolHandler(await createRendererFixture());

    const postResponse = await handler(
      new Request("app://host/index.html", { method: "POST" }),
    );
    const hostResponse = await handler(
      new Request("app://attacker/index.html"),
    );

    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.get("allow")).toBe("GET, HEAD");
    expect(hostResponse.status).toBe(403);
  });

  it.each([
    "app://host/%2e%2e%2fsecret.txt",
    "app://host/assets%2f..%2fsecret.txt",
    "app://host/%5c..%5csecret.txt",
    "app://host/%00index.html",
  ])("rejects encoded or traversal path %s", async (url) => {
    const handler = createAppProtocolHandler(await createRendererFixture());

    const response = await handler(new Request(url));

    expect(response.status).toBe(400);
  });

  it("falls back to index.html for routes but returns 404 for missing files", async () => {
    const handler = createAppProtocolHandler(await createRendererFixture());

    const routeResponse = await handler(
      new Request("app://host/settings/security"),
    );
    const missingFileResponse = await handler(
      new Request("app://host/assets/missing.js"),
    );

    expect(routeResponse.status).toBe(200);
    expect(await routeResponse.text()).toBe("<main>Host shell</main>");
    expect(missingFileResponse.status).toBe(404);
  });

  it("registers the scheme before readiness and honors a hidden startup", async () => {
    const lifecycle: string[] = [];
    const registerSchemesAsPrivileged = vi.fn(() =>
      lifecycle.push("register-scheme"),
    );
    const handle = vi.fn();

    class BootstrapWindow extends EventEmitter {
      static instances: BootstrapWindow[] = [];
      static getAllWindows = () => BootstrapWindow.instances;

      readonly webContents = {
        mainFrame: { url: "app://host/index.html", isDestroyed: () => false },
        on: vi.fn(),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      };
      readonly show = vi.fn();
      readonly hide = vi.fn();
      readonly focus = vi.fn();
      readonly loadFile = vi.fn(async () => undefined);
      readonly loadURL = vi.fn(async () => undefined);
      readonly setMenuBarVisibility = vi.fn();

      constructor(readonly options: Record<string, unknown>) {
        super();
        BootstrapWindow.instances.push(this);
      }

      isDestroyed() {
        return false;
      }
    }

    class BootstrapTray {
      setToolTip() {}
      setContextMenu() {}
      on() {}
    }

    const appEvents = new Map<string, (...args: unknown[]) => void>();
    const appMock = {
      isPackaged: true,
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      whenReady: vi.fn(() => {
        lifecycle.push("when-ready");
        return Promise.resolve();
      }),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        appEvents.set(event, listener);
      }),
      getFileIcon: vi.fn(async () => ({ name: "app-icon" })),
      getPath: vi.fn(() => "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote"),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      setLoginItemSettings: vi.fn(),
    };

    vi.resetModules();
    vi.doMock("electron", () => ({
      app: appMock,
      BrowserWindow: BootstrapWindow,
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
      Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
      protocol: { registerSchemesAsPrivileged, handle },
      Tray: BootstrapTray,
    }));

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--hidden"];
    try {
      await import("./main.js");
      await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce());
    } finally {
      process.argv = originalArgv;
      vi.doUnmock("electron");
    }

    expect(lifecycle.slice(0, 2)).toEqual(["register-scheme", "when-ready"]);
    const window = BootstrapWindow.instances[0];
    expect(window).toBeDefined();
    window?.emit("ready-to-show");
    expect(window?.show).not.toHaveBeenCalled();
  });
});
