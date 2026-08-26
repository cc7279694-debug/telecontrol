import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const rendererEntry = path.resolve(desktopDir, "..", "renderer", "index.html");
const preloadEntry = path.resolve(desktopDir, "preload.js");

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadEntry,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  void mainWindow.loadFile(rendererEntry);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
