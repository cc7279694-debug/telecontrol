import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import { loadPublicRuntimeConfig } from "../src/desktop/public-runtime-config.js";

const EXPECTED_APP_VERSION = "0.1.0" as const;
const EXPECTED_CLI_VERSION = "0.149.0" as const;
const EXPECTED_PLATFORM_VERSION = "0.149.0-win32-x64" as const;
const EXPECTED_PROTOCOL_VERSION = "0.1.0" as const;
const REQUIRED_ASAR_FILES = [
  "dist/desktop/main.js",
  "dist/desktop/preload.cjs",
  "dist/renderer/index.html",
  "node_modules/@codex-remote/protocol/package.json",
] as const;
const REQUIRED_CODEX_FILES = [
  "vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  "vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe",
  "vendor/x86_64-pc-windows-msvc/codex-path/rg.exe",
  "vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe",
  "vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe",
] as const;
const ALLOWED_RUNTIME_KEYS = new Set([
  "supabaseUrl",
  "publishableKey",
  "webOrigin",
  "protocolVersion",
]);
const EXPECTED_INSTALLER_NAME = (version: string) =>
  `Codex-Remote-Host-${version}-Windows-x64.exe`;

export type PackageVerificationInput = {
  releaseDir: string;
  expectedVersion: typeof EXPECTED_APP_VERSION;
  requireInstaller: boolean;
};

export type PackageVerificationResult = {
  installerName: string | null;
  installerSha256: string | null;
  architecture: "x64";
  signingStatus: "unsigned" | "signed";
  checkedFileCount: number;
};

export type PackageVerificationErrorCode =
  | "INVALID_RELEASE"
  | "REQUIRED_FILE_MISSING"
  | "VERSION_MISMATCH"
  | "INVALID_ARCHITECTURE"
  | "FORBIDDEN_FILE"
  | "INVALID_PUBLIC_CONFIG"
  | "INVALID_INSTALLER";

export class PackageVerificationError extends Error {
  constructor(
    readonly code: PackageVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PackageVerificationError";
  }
}

type ReleaseFile = {
  absolutePath: string;
  relativePath: string;
  contents?: Buffer;
};

export async function verifyPackage(
  input: PackageVerificationInput,
): Promise<PackageVerificationResult> {
  if (input.expectedVersion !== EXPECTED_APP_VERSION) {
    throw new PackageVerificationError(
      "VERSION_MISMATCH",
      "Windows Host 版本不是当前固定版本",
    );
  }

  const releaseRoot = await resolveDirectory(input.releaseDir);
  const files = await collectReleaseFiles(releaseRoot);
  for (const file of files) assertAllowedArtifactPath(file.relativePath);

  const unpackedRoot = path.join(releaseRoot, "win-unpacked");
  const resourcesRoot = path.join(unpackedRoot, "resources");
  const appAsarPath = path.join(resourcesRoot, "app.asar");
  const appAsarFiles = await readAsarFiles(appAsarPath);
  for (const requiredFile of REQUIRED_ASAR_FILES) {
    if (!appAsarFiles.has(requiredFile)) {
      throw new PackageVerificationError(
        "REQUIRED_FILE_MISSING",
        "安装包缺少必要的应用文件",
      );
    }
  }
  for (const file of appAsarFiles) assertAllowedArtifactPath(file);

  assertAsarVersion(
    readAsarJson(appAsarPath, "package.json"),
    EXPECTED_APP_VERSION,
  );
  assertAsarVersion(
    readAsarJson(
      appAsarPath,
      "node_modules/@codex-remote/protocol/package.json",
    ),
    EXPECTED_PROTOCOL_VERSION,
  );
  await verifyPublicRuntimeConfig(
    path.join(resourcesRoot, "public-runtime.json"),
  );

  const codexRoot = path.join(resourcesRoot, "codex");
  const codexMetadata = await readJsonFile(
    path.join(codexRoot, "package.json"),
  );
  const cliMetadata = await readJsonFile(
    path.join(codexRoot, "codex-cli-package.json"),
  );
  assertAsarVersion(codexMetadata, EXPECTED_PLATFORM_VERSION);
  assertAsarVersion(cliMetadata, EXPECTED_CLI_VERSION);
  for (const relativePath of REQUIRED_CODEX_FILES) {
    await requireRegularFile(path.join(codexRoot, relativePath));
  }

  const x64ExecutablePaths = [
    path.join(unpackedRoot, "Codex Remote Host.exe"),
    ...REQUIRED_CODEX_FILES.filter((file) => file.endsWith(".exe")).map(
      (file) => path.join(codexRoot, file),
    ),
  ];
  for (const executablePath of x64ExecutablePaths) {
    await requireRegularFile(executablePath);
    assertX64Pe(await readFile(executablePath));
  }

  const installer = findInstaller(
    files,
    input.requireInstaller,
    input.expectedVersion,
  );
  const installerContents = installer
    ? (installer.contents ?? (await readFile(installer.absolutePath)))
    : null;
  if (installerContents) assertPe(installerContents);

  const signingTarget =
    installerContents ??
    (await readFile(path.join(unpackedRoot, "Codex Remote Host.exe")));

  return {
    installerName: installer?.relativePath ?? null,
    installerSha256: installerContents
      ? createHash("sha256").update(installerContents).digest("hex")
      : null,
    architecture: "x64",
    signingStatus: hasEmbeddedSignature(signingTarget) ? "signed" : "unsigned",
    checkedFileCount: files.length,
  };
}

async function resolveDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) {
    throw new PackageVerificationError(
      "INVALID_RELEASE",
      "安装包目录必须是绝对路径",
    );
  }
  try {
    const resolved = await realpath(directory);
    if (!(await lstat(resolved)).isDirectory())
      throw new Error("not directory");
    return resolved;
  } catch {
    throw new PackageVerificationError(
      "INVALID_RELEASE",
      "找不到 Windows Host 安装包目录",
    );
  }
}

async function collectReleaseFiles(
  releaseRoot: string,
): Promise<ReleaseFile[]> {
  const files: ReleaseFile[] = [];
  await walkDirectory(releaseRoot, releaseRoot, files);
  return files;
}

async function walkDirectory(
  releaseRoot: string,
  currentDirectory: string,
  files: ReleaseFile[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDirectory, { withFileTypes: true });
  } catch {
    throw new PackageVerificationError("INVALID_RELEASE", "无法读取安装包目录");
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    const relativePath = normalizeRelativePath(
      path.relative(releaseRoot, absolutePath),
    );
    const stats = await lstat(absolutePath).catch(() => null);
    if (!stats || stats.isSymbolicLink()) {
      throw new PackageVerificationError(
        "INVALID_RELEASE",
        "安装包不能包含符号链接",
      );
    }
    if (stats.isDirectory()) {
      await walkDirectory(releaseRoot, absolutePath, files);
      continue;
    }
    if (!stats.isFile()) {
      throw new PackageVerificationError(
        "INVALID_RELEASE",
        "安装包包含无法识别的文件",
      );
    }
    const resolvedPath = await realpath(absolutePath).catch(() => null);
    if (!resolvedPath || !isDescendantOrEqual(resolvedPath, releaseRoot)) {
      throw new PackageVerificationError(
        "INVALID_RELEASE",
        "安装包文件越过了验证目录",
      );
    }
    files.push({ absolutePath, relativePath });
  }
}

async function readAsarFiles(asarPath: string): Promise<Set<string>> {
  try {
    const stats = await lstat(asarPath);
    if (!stats.isFile()) throw new Error("asar is not a file");
    return new Set(
      listPackage(asarPath, { isPack: false }).map(normalizeRelativePath),
    );
  } catch {
    throw new PackageVerificationError(
      "REQUIRED_FILE_MISSING",
      "安装包缺少应用归档",
    );
  }
}

function readAsarJson(
  asarPath: string,
  filePath: string,
): Record<string, unknown> {
  try {
    return JSON.parse(
      extractFile(asarPath, filePath.split("/").join(path.sep)).toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
  } catch {
    throw new PackageVerificationError(
      "REQUIRED_FILE_MISSING",
      "安装包元数据不完整",
    );
  }
}

async function readJsonFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) throw new Error("metadata is not a file");
    return JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new PackageVerificationError(
      "REQUIRED_FILE_MISSING",
      "Codex 资源元数据不完整",
    );
  }
}

async function requireRegularFile(filePath: string): Promise<void> {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error("not file");
  } catch {
    throw new PackageVerificationError(
      "REQUIRED_FILE_MISSING",
      "Codex Windows 资源不完整",
    );
  }
}

function assertAsarVersion(
  metadata: Record<string, unknown>,
  expectedVersion: string,
): void {
  if (metadata.version !== expectedVersion) {
    throw new PackageVerificationError(
      "VERSION_MISMATCH",
      "安装包内版本信息不匹配",
    );
  }
}

async function verifyPublicRuntimeConfig(filePath: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new PackageVerificationError(
      "INVALID_PUBLIC_CONFIG",
      "安装包公共配置无效",
    );
  }
  if (
    Object.keys(parsed).some((key) => !ALLOWED_RUNTIME_KEYS.has(key)) ||
    Object.keys(parsed).length !== ALLOWED_RUNTIME_KEYS.size
  ) {
    throw new PackageVerificationError(
      "INVALID_PUBLIC_CONFIG",
      "安装包公共配置字段不受支持",
    );
  }
  try {
    loadPublicRuntimeConfig({
      isPackaged: true,
      resourcePath: filePath,
      readResource: () => JSON.stringify(parsed),
    });
  } catch {
    throw new PackageVerificationError(
      "INVALID_PUBLIC_CONFIG",
      "安装包公共配置无效",
    );
  }
}

function findInstaller(
  files: ReleaseFile[],
  requireInstaller: boolean,
  version: string,
): ReleaseFile | null {
  const releaseRootExecutables = files.filter(
    (file) =>
      !file.relativePath.includes("/") && file.relativePath.endsWith(".exe"),
  );
  const expectedName = EXPECTED_INSTALLER_NAME(version);
  if (releaseRootExecutables.length > 1) {
    throw new PackageVerificationError(
      "INVALID_INSTALLER",
      "安装包目录包含多个安装程序",
    );
  }
  const installer = releaseRootExecutables[0] ?? null;
  if (!installer) {
    if (requireInstaller) {
      throw new PackageVerificationError(
        "INVALID_INSTALLER",
        "缺少 Windows 安装程序",
      );
    }
    return null;
  }
  if (installer.relativePath !== expectedName) {
    throw new PackageVerificationError(
      "INVALID_INSTALLER",
      "Windows 安装程序文件名不符合约定",
    );
  }
  return installer;
}

function assertX64Pe(contents: Buffer): void {
  assertPe(contents);
  const peOffset = contents.readUInt32LE(0x3c);
  if (contents.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new PackageVerificationError(
      "INVALID_ARCHITECTURE",
      "安装包必须是 Windows x64 架构",
    );
  }
}

function assertPe(contents: Buffer): void {
  if (contents.length < 0x86 || contents.readUInt16LE(0) !== 0x5a4d) {
    throw new PackageVerificationError(
      "INVALID_ARCHITECTURE",
      "安装包包含无法识别的 Windows 可执行文件",
    );
  }
  const peOffset = contents.readUInt32LE(0x3c);
  if (
    peOffset + 6 > contents.length ||
    contents.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  ) {
    throw new PackageVerificationError(
      "INVALID_ARCHITECTURE",
      "安装包包含无法识别的 Windows 可执行文件",
    );
  }
}

function hasEmbeddedSignature(contents: Buffer): boolean {
  try {
    const peOffset = contents.readUInt32LE(0x3c);
    const optionalHeaderOffset = peOffset + 24;
    const magic = contents.readUInt16LE(optionalHeaderOffset);
    const dataDirectoryOffset =
      optionalHeaderOffset + (magic === 0x20b ? 112 : 96);
    const certificateOffset = contents.readUInt32LE(dataDirectoryOffset + 32);
    const certificateSize = contents.readUInt32LE(dataDirectoryOffset + 36);
    return certificateOffset > 0 && certificateSize > 0;
  } catch {
    return false;
  }
}

function assertAllowedArtifactPath(relativePath: string): void {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  const segments = normalized.split("/");
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".map") ||
    basename.includes("service_role") ||
    basename.includes("service-role") ||
    basename.includes("vapid-private") ||
    basename.includes("vapid_private") ||
    /(^|[-_.])credentials([._-]|$)/.test(basename) ||
    basename.includes("secret") ||
    basename.endsWith(".log") ||
    /\.(test|spec)\.[^/]+$/.test(basename) ||
    segments.includes(".git") ||
    segments.includes("logs") ||
    segments.includes("playwright-report")
  ) {
    throw new PackageVerificationError(
      "FORBIDDEN_FILE",
      "安装包包含不允许发布的文件",
    );
  }
}

function normalizeRelativePath(filePath: string): string {
  return filePath
    .split(path.sep)
    .join("/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
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
  const allowMissingInstaller = process.argv.includes(
    "--allow-missing-installer",
  );
  const releaseDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "release",
  );
  const result = await verifyPackage({
    releaseDir,
    expectedVersion: EXPECTED_APP_VERSION,
    requireInstaller: !allowMissingInstaller,
  });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    if (error instanceof PackageVerificationError) {
      console.error(error.message);
    } else {
      console.error("Windows Host 安装包检查失败");
    }
    process.exitCode = 1;
  });
}
