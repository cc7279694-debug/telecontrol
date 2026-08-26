import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostRoot,
  initialBuildCommand,
  persistentWatchCommands,
  relaunchWatchPlans,
} from "./dev-plan.js";

const distRoot = path.join(hostRoot, "dist");
const desktopEntry = path.join(distRoot, "desktop", "main.js");
const rendererEntry = path.join(distRoot, "renderer", "index.html");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const activeWatchers = new Set<FSWatcher>();
const longRunningProcesses = new Set<ChildProcess>();
let electronProcess: ChildProcess | undefined;
let restartTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;

function spawnCommand(args: string[], persistent = false) {
  const child = spawn(npmCommand, args, {
    cwd: hostRoot,
    stdio: "inherit",
  });

  if (persistent) {
    longRunningProcesses.add(child);
    child.once("exit", (code) => {
      longRunningProcesses.delete(child);

      if (!isShuttingDown && code && code !== 0) {
        process.exitCode = code;
        shutdown();
      }
    });
  }

  return child;
}

function waitForExit(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command exited with code ${code ?? "unknown"}.`));
    });

    child.once("error", reject);
  });
}

function hasLaunchArtifacts() {
  return existsSync(desktopEntry) && existsSync(rendererEntry);
}

function launchElectron() {
  if (!hasLaunchArtifacts() || isShuttingDown) {
    return;
  }

  electronProcess = spawnCommand(["exec", "--", "electron", "."], false);
  electronProcess.once("exit", () => {
    electronProcess = undefined;
  });
}

function restartElectron() {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    if (electronProcess) {
      electronProcess.once("exit", () => {
        launchElectron();
      });
      electronProcess.kill();
      return;
    }

    launchElectron();
  }, 150);
}

function trackWatcher(watcher: FSWatcher) {
  activeWatchers.add(watcher);
  watcher.once("close", () => {
    activeWatchers.delete(watcher);
  });
}

function startRelaunchWatchers() {
  for (const plan of relaunchWatchPlans) {
    const watcher = watch(
      path.resolve(hostRoot, plan.rootRelativePath),
      { recursive: true },
      (_eventType, fileName) => {
        if (!fileName) {
          return;
        }

        const changedPath = fileName.toString().replaceAll("\\", "/");

        if (
          plan.triggers.includes(".") ||
          plan.triggers.some((trigger) => changedPath.startsWith(trigger))
        ) {
          restartElectron();
        }
      },
    );

    trackWatcher(watcher);
  }
}

function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  for (const child of longRunningProcesses) {
    child.kill();
  }

  for (const watcher of activeWatchers) {
    watcher.close();
  }

  if (electronProcess) {
    electronProcess.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(process.exitCode ?? 0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(process.exitCode ?? 0);
});

async function main() {
  await waitForExit(spawnCommand([...initialBuildCommand], false));

  for (const command of persistentWatchCommands) {
    spawnCommand(command.args, true);
  }

  launchElectron();
  startRelaunchWatchers();
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    console.error(error);
    shutdown();
    process.exit(1);
  });
}
