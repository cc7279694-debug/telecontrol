import { cp, lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CODEX_CLI_VERSION,
  CODEX_WINDOWS_X64_PACKAGE_VERSION,
} from "../src/desktop/codex-cli-resolver.js";

const require = createRequire(import.meta.url);
const HOST_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PRODUCTION_ALLOWED_OUTPUT_PARENT = path.join(
  HOST_ROOT,
  ".package-resources",
);
const WINDOWS_X64_TRIPLE = "x86_64-pc-windows-msvc";
const REQUIRED_VENDOR_FILES = [
  "bin/codex.exe",
  "bin/codex-code-mode-host.exe",
  "codex-path/rg.exe",
  "codex-resources/codex-command-runner.exe",
  "codex-resources/codex-windows-sandbox-setup.exe",
] as const;

export type PrepareCodexResourceInput = {
  platformPackageRoot: string;
  entryPackageJsonPath: string;
  allowedOutputParent: string;
  outputRoot: string;
};

export type PreparedCodexResource = {
  outputRoot: string;
  executablePath: string;
  cliVersion: typeof CODEX_CLI_VERSION;
  platformVersion: typeof CODEX_WINDOWS_X64_PACKAGE_VERSION;
};

export type CodexResourcePreparationErrorCode =
  | "INVALID_PATH"
  | "PACKAGE_METADATA_MISSING"
  | "VERSION_MISMATCH"
  | "RESOURCE_MISSING"
  | "COPY_FAILED";

export class CodexResourcePreparationError extends Error {
  constructor(
    readonly code: CodexResourcePreparationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexResourcePreparationError";
  }
}

export async function prepareCodexResource(
  input: PrepareCodexResourceInput,
): Promise<PreparedCodexResource> {
  const platformPackageRoot = requireAbsolutePath(input.platformPackageRoot);
  const entryPackageJsonPath = requireAbsolutePath(input.entryPackageJsonPath);
  const allowedOutputParent = requireAbsolutePath(input.allowedOutputParent);
  const outputRoot = requireAbsolutePath(input.outputRoot);

  assertStrictDescendant(outputRoot, allowedOutputParent);

  const platformVersion = await readPackageVersion(
    path.join(platformPackageRoot, "package.json"),
    "平台包信息不完整",
  );
  const cliVersion = await readPackageVersion(
    entryPackageJsonPath,
    "Codex CLI 信息不完整",
  );
  if (platformVersion !== CODEX_WINDOWS_X64_PACKAGE_VERSION) {
    throw new CodexResourcePreparationError(
      "VERSION_MISMATCH",
      "Codex Windows 资源版本不匹配",
    );
  }
  if (cliVersion !== CODEX_CLI_VERSION) {
    throw new CodexResourcePreparationError(
      "VERSION_MISMATCH",
      "Codex CLI 版本不匹配",
    );
  }

  const vendorRoot = path.join(
    platformPackageRoot,
    "vendor",
    WINDOWS_X64_TRIPLE,
  );
  await assertSourceTree(platformPackageRoot, vendorRoot, "directory");
  for (const relativePath of REQUIRED_VENDOR_FILES) {
    await assertSourceTree(
      platformPackageRoot,
      path.join(vendorRoot, relativePath),
      "file",
    );
  }
  await assertOutputPathIsSafe(allowedOutputParent, outputRoot);

  try {
    await rm(outputRoot, { force: true, recursive: true });
    await mkdir(outputRoot, { recursive: true });
    await cp(vendorRoot, path.join(outputRoot, "vendor", WINDOWS_X64_TRIPLE), {
      force: true,
      recursive: true,
    });
    await cp(
      path.join(platformPackageRoot, "package.json"),
      path.join(outputRoot, "package.json"),
    );
    await cp(
      entryPackageJsonPath,
      path.join(outputRoot, "codex-cli-package.json"),
    );
  } catch {
    throw new CodexResourcePreparationError(
      "COPY_FAILED",
      "Codex Windows 资源复制失败",
    );
  }

  return {
    outputRoot,
    executablePath: path.join(
      outputRoot,
      "vendor",
      WINDOWS_X64_TRIPLE,
      "bin",
      "codex.exe",
    ),
    cliVersion: CODEX_CLI_VERSION,
    platformVersion: CODEX_WINDOWS_X64_PACKAGE_VERSION,
  };
}

async function readPackageVersion(
  filePath: string,
  message: string,
): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      version?: unknown;
    };
    if (typeof parsed.version !== "string") throw new Error("version missing");
    return parsed.version;
  } catch {
    throw new CodexResourcePreparationError(
      "PACKAGE_METADATA_MISSING",
      message,
    );
  }
}

async function assertSourceTree(
  packageRoot: string,
  targetPath: string,
  expectedType: "directory" | "file",
): Promise<void> {
  const resolvedPackageRoot = await safeRealpath(packageRoot);
  const resolvedTarget = await safeRealpath(targetPath);
  if (!isDescendantOrEqual(resolvedTarget, resolvedPackageRoot)) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 资源路径越过安装包目录",
    );
  }
  try {
    const stats = await lstat(targetPath);
    const typeMatches =
      expectedType === "directory" ? stats.isDirectory() : stats.isFile();
    if (!typeMatches) throw new Error("resource type mismatch");
  } catch {
    throw new CodexResourcePreparationError(
      "RESOURCE_MISSING",
      "Codex Windows 辅助资源不完整",
    );
  }
}

async function assertOutputPathIsSafe(
  allowedOutputParent: string,
  outputRoot: string,
): Promise<void> {
  assertAllowedOutputParent(allowedOutputParent);
  const resolvedAllowedParent =
    await realpathWithMissingTail(allowedOutputParent);
  const resolvedOutput = await realpathWithMissingTail(outputRoot);
  if (!isDescendantOrEqual(resolvedOutput, resolvedAllowedParent)) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 输出目录越过授权资源目录",
    );
  }
  if (await isSymbolicLink(outputRoot)) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 输出目录不能是符号链接",
    );
  }
}

function assertAllowedOutputParent(allowedOutputParent: string): void {
  if (allowedOutputParent === PRODUCTION_ALLOWED_OUTPUT_PARENT) return;

  const temporaryRoot = path.resolve(tmpdir());
  const relativePath = path.relative(temporaryRoot, allowedOutputParent);
  const isTemporaryChild =
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);
  if (!isTemporaryChild) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 输出边界只能使用生产资源目录或测试临时目录",
    );
  }
}

function requireAbsolutePath(value: string): string {
  if (!path.isAbsolute(value)) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 资源路径必须是绝对路径",
    );
  }
  const resolved = path.resolve(value);
  if (path.dirname(resolved) === resolved) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "不允许使用磁盘根目录作为 Codex 资源目录",
    );
  }
  return resolved;
}

function assertStrictDescendant(child: string, parent: string): void {
  const relativePath = path.relative(parent, child);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new CodexResourcePreparationError(
      "INVALID_PATH",
      "Codex 输出目录必须位于授权资源目录内",
    );
  }
}

async function safeRealpath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    throw new CodexResourcePreparationError(
      "RESOURCE_MISSING",
      "Codex Windows 资源目录不存在",
    );
  }
}

async function realpathWithMissingTail(filePath: string): Promise<string> {
  const missingTail: string[] = [];
  let current = filePath;
  while (true) {
    try {
      const resolved = await realpath(current);
      return missingTail.reduceRight(
        (parent, segment) => path.join(parent, segment),
        resolved,
      );
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new CodexResourcePreparationError(
          "INVALID_PATH",
          "Codex 资源目录无法解析",
        );
      }
      missingTail.push(path.basename(current));
      current = parent;
    }
  }
}

async function isSymbolicLink(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isSymbolicLink();
  } catch {
    return false;
  }
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
  const platformPackageRoot = path.dirname(
    require.resolve("@openai/codex-win32-x64/package.json"),
  );
  const entryPackageJsonPath = require.resolve("@openai/codex/package.json");
  await prepareCodexResource({
    platformPackageRoot,
    entryPackageJsonPath,
    allowedOutputParent: PRODUCTION_ALLOWED_OUTPUT_PARENT,
    outputRoot: path.join(PRODUCTION_ALLOWED_OUTPUT_PARENT, "codex"),
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error: unknown) => {
    if (error instanceof CodexResourcePreparationError) {
      console.error(error.message);
    } else {
      console.error("Codex Windows 资源准备失败");
    }
    process.exitCode = 1;
  });
}
