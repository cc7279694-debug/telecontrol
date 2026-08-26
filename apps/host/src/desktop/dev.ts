import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(desktopDir, "..", "..");
const distRoot = path.join(hostRoot, "dist");
const desktopEntry = path.join(distRoot, "desktop", "main.js");
const rendererEntry = path.join(distRoot, "renderer", "index.html");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
  await waitForExit(spawnCommand(["run", "build"], false));

  spawnCommand(
    ["exec", "--", "tsc", "-p", "tsconfig.json", "-w", "--preserveWatchOutput"],
    true,
  );
  spawnCommand(
    [
      "exec",
      "--",
      "tsc",
      "-p",
      "tsconfig.desktop.json",
      "-w",
      "--preserveWatchOutput",
    ],
    true,
  );
  spawnCommand(
    ["exec", "--", "vite", "build", "--watch", "--emptyOutDir", "false"],
    true,
  );

  launchElectron();

  watch(distRoot, { recursive: true }, (_eventType, fileName) => {
    if (!fileName) {
      return;
    }

    const changedPath = fileName.toString().replaceAll("\\", "/");

    if (
      changedPath.startsWith("desktop/") ||
      changedPath === "renderer/index.html" ||
      changedPath.startsWith("renderer/assets/")
    ) {
      restartElectron();
    }
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  shutdown();
  process.exit(1);
});
