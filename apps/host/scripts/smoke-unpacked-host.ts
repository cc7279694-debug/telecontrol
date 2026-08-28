import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;

export type SmokeProcess = {
  once(event: "error", listener: () => void): SmokeProcess;
  once(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): SmokeProcess;
  kill(): boolean;
  killed?: boolean;
};

export type SmokeProcessSpawner = (
  executablePath: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean },
) => SmokeProcess;

export type UnpackedHostSmokeInput = {
  releaseDir: string;
  userDataDir: string;
  timeoutMs?: number;
  spawnProcess?: SmokeProcessSpawner;
};

export async function runUnpackedHostSmoke(
  input: UnpackedHostSmokeInput,
): Promise<void> {
  const releaseRoot = await resolveDirectory(input.releaseDir);
  const unpackedRoot = path.join(releaseRoot, "win-unpacked");
  const executablePath = path.join(unpackedRoot, "Codex Remote Host.exe");
  await requireExecutable(executablePath, releaseRoot);

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_TIMEOUT_MS
  ) {
    throw new Error("烟雾测试超时时间无效");
  }
  const userDataDir = path.resolve(input.userDataDir);
  const temporaryRoot = await realpath(os.tmpdir());
  if (!isStrictDescendant(userDataDir, temporaryRoot)) {
    throw new Error("烟雾测试用户数据目录必须位于临时目录内");
  }

  let child: SmokeProcess | undefined;
  let shouldCleanup = false;
  try {
    await mkdir(userDataDir, { recursive: true });
    const resolvedUserDataDir = await realpath(userDataDir);
    if (!isStrictDescendant(resolvedUserDataDir, temporaryRoot)) {
      throw new Error("烟雾测试用户数据目录无法验证");
    }
    shouldCleanup = true;
    const spawnProcess = input.spawnProcess ?? defaultSpawn;
    child = spawnProcess(
      executablePath,
      ["--hidden", "--package-smoke", "--user-data-dir", resolvedUserDataDir],
      { cwd: unpackedRoot, windowsHide: true },
    );
    await waitForExit(child, timeoutMs);
  } finally {
    if (child && !child.killed) child.kill();
    if (shouldCleanup) {
      await rm(userDataDir, { recursive: true, force: true });
    }
  }
}

async function resolveDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error("安装包目录无效");
  try {
    const resolved = await realpath(directory);
    if (!(await lstat(resolved)).isDirectory())
      throw new Error("not directory");
    return resolved;
  } catch {
    throw new Error("找不到解包版 Host");
  }
}

async function requireExecutable(
  executablePath: string,
  releaseRoot: string,
): Promise<void> {
  try {
    const stats = await lstat(executablePath);
    const resolved = await realpath(executablePath);
    if (!stats.isFile() || !isDescendantOrEqual(resolved, releaseRoot)) {
      throw new Error("invalid executable");
    }
  } catch {
    throw new Error("找不到解包版 Host 可执行文件");
  }
}

function defaultSpawn(
  executablePath: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean },
): SmokeProcess {
  return spawn(executablePath, args, options);
}

function waitForExit(child: SmokeProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("解包版 Host 烟雾测试超时"));
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("解包版 Host 启动失败"));
    });
    child.once("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("解包版 Host 烟雾测试失败"));
      }
    });
  });
}

function isStrictDescendant(child: string, parent: string): boolean {
  const relativePath = path.relative(parent, child);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function isDescendantOrEqual(child: string, parent: string): boolean {
  const relativePath = path.relative(parent, child);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

async function main(): Promise<void> {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const smokeUserDataDir = await mkdtemp(
    path.join(os.tmpdir(), "codex-remote-package-smoke-"),
  );
  await runUnpackedHostSmoke({
    releaseDir: path.resolve(scriptDirectory, "..", "release"),
    userDataDir: smokeUserDataDir,
  });
  console.log("Windows Host 解包版烟雾测试通过");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch(() => {
    console.error("Windows Host 解包版烟雾测试失败");
    process.exitCode = 1;
  });
}
