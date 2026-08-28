import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

export const CODEX_CLI_VERSION = "0.149.0" as const;
export const CODEX_WINDOWS_X64_PACKAGE_VERSION = "0.149.0-win32-x64" as const;
const WINDOWS_X64_TRIPLE = "x86_64-pc-windows-msvc";

export type CodexCliResolution = {
  executablePath: string;
  version: typeof CODEX_CLI_VERSION;
  source: "workspace-package" | "packaged-resource";
};

export type CodexCliResolverOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  packageRoot?: string;
  entryPackageJsonPath?: string;
  executablePathOverride?: string;
};

export type CodexCliResolverErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "PACKAGE_METADATA_MISSING"
  | "VERSION_MISMATCH"
  | "EXECUTABLE_MISSING"
  | "UNSAFE_EXECUTABLE_PATH";

export class CodexCliResolverError extends Error {
  constructor(
    readonly code: CodexCliResolverErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexCliResolverError";
  }
}

export function resolveCodexCli(
  options: CodexCliResolverOptions = {},
): CodexCliResolution {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "win32" || arch !== "x64") {
    throw new CodexCliResolverError(
      "UNSUPPORTED_PLATFORM",
      "仅支持 Windows x64",
    );
  }

  const isPackaged = options.isPackaged ?? false;
  const packageRoot =
    options.packageRoot ??
    (isPackaged
      ? path.join(options.resourcesPath ?? process.resourcesPath, "codex")
      : resolveInstalledPlatformPackageRoot());
  const source = isPackaged ? "packaged-resource" : "workspace-package";
  const platformPackageJsonPath = path.join(packageRoot, "package.json");
  const entryPackageJsonPath =
    options.entryPackageJsonPath ??
    (isPackaged
      ? path.join(packageRoot, "codex-cli-package.json")
      : resolveInstalledCodexPackageJson());

  const platformPackage = readPackageMetadata(platformPackageJsonPath);
  const entryPackage = readPackageMetadata(entryPackageJsonPath);
  if (
    entryPackage.version !== CODEX_CLI_VERSION ||
    platformPackage.version !== CODEX_WINDOWS_X64_PACKAGE_VERSION
  ) {
    throw new CodexCliResolverError("VERSION_MISMATCH", "Codex CLI 版本不匹配");
  }

  const executablePath =
    options.executablePathOverride ??
    path.join(packageRoot, "vendor", WINDOWS_X64_TRIPLE, "bin", "codex.exe");
  assertSafeExecutablePath(executablePath);

  if (!existsSync(executablePath)) {
    throw new CodexCliResolverError(
      "EXECUTABLE_MISSING",
      "未找到固定版本的 Codex CLI",
    );
  }

  let resolvedExecutablePath: string;
  try {
    resolvedExecutablePath = realpathSync(executablePath);
  } catch {
    throw new CodexCliResolverError(
      "EXECUTABLE_MISSING",
      "无法读取固定版本的 Codex CLI",
    );
  }
  assertSafeExecutablePath(resolvedExecutablePath);

  return {
    executablePath: resolvedExecutablePath,
    version: CODEX_CLI_VERSION,
    source,
  };
}

function readPackageMetadata(filePath: string): { version: string } {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      version?: unknown;
    };
    if (typeof parsed.version !== "string") throw new Error("version missing");
    return { version: parsed.version };
  } catch {
    throw new CodexCliResolverError(
      "PACKAGE_METADATA_MISSING",
      "Codex CLI 安装信息不完整",
    );
  }
}

function assertSafeExecutablePath(filePath: string): void {
  if (/windowsapps/i.test(filePath)) {
    throw new CodexCliResolverError(
      "UNSAFE_EXECUTABLE_PATH",
      "不允许使用 WindowsApps 中的 Codex 路径",
    );
  }
  if (!path.isAbsolute(filePath)) {
    throw new CodexCliResolverError(
      "UNSAFE_EXECUTABLE_PATH",
      "Codex CLI 路径必须是绝对路径",
    );
  }
}

function resolveInstalledPlatformPackageRoot(): string {
  try {
    return path.dirname(
      require.resolve("@openai/codex-win32-x64/package.json"),
    );
  } catch {
    throw new CodexCliResolverError(
      "PACKAGE_METADATA_MISSING",
      "未找到固定版本的 Codex CLI 安装包",
    );
  }
}

function resolveInstalledCodexPackageJson(): string {
  try {
    return require.resolve("@openai/codex/package.json");
  } catch {
    throw new CodexCliResolverError(
      "PACKAGE_METADATA_MISSING",
      "未找到 Codex CLI 主安装包信息",
    );
  }
}
