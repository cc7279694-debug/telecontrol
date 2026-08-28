import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliResolverError,
  resolveCodexCli,
} from "./codex-cli-resolver.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPackageFixture(options: {
  entryVersion?: string;
  platformVersion?: string;
  packageName?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "codex-cli-resolver-"));
  temporaryDirectories.push(root);
  const packageRoot = join(root, "@openai", "codex-win32-x64");
  const vendorRoot = join(
    packageRoot,
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
  );
  mkdirSync(vendorRoot, { recursive: true });
  writeFileSync(
    join(root, "entry-package.json"),
    JSON.stringify({
      name: "@openai/codex",
      version: options.entryVersion ?? "0.149.0",
    }),
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: options.packageName ?? "@openai/codex",
      version: options.platformVersion ?? "0.149.0-win32-x64",
    }),
  );
  const executablePath = join(vendorRoot, "codex.exe");
  writeFileSync(executablePath, "test binary");
  return {
    entryPackageJsonPath: join(root, "entry-package.json"),
    packageRoot,
    root,
  };
}

describe("Codex CLI resolver", () => {
  it("resolves the bundled executable from packaged resources", () => {
    const fixture = createPackageFixture({});
    const resourcesRoot = join(fixture.root, "resources");
    const packagedRoot = join(resourcesRoot, "codex");
    const packagedVendorRoot = join(
      packagedRoot,
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
    );
    mkdirSync(packagedVendorRoot, { recursive: true });
    writeFileSync(
      join(packagedRoot, "package.json"),
      JSON.stringify({ version: "0.149.0-win32-x64" }),
    );
    writeFileSync(
      join(packagedRoot, "codex-cli-package.json"),
      JSON.stringify({ version: "0.149.0" }),
    );
    const executablePath = join(packagedVendorRoot, "codex.exe");
    writeFileSync(executablePath, "packaged test binary");

    expect(
      resolveCodexCli({
        platform: "win32",
        arch: "x64",
        isPackaged: true,
        resourcesPath: resourcesRoot,
      }),
    ).toMatchObject({
      version: "0.149.0",
      source: "packaged-resource",
      executablePath,
    });
  });

  it("resolves the pinned Windows x64 executable from the package resource", () => {
    const fixture = createPackageFixture({});

    expect(
      resolveCodexCli({
        platform: "win32",
        arch: "x64",
        packageRoot: fixture.packageRoot,
        entryPackageJsonPath: fixture.entryPackageJsonPath,
      }),
    ).toMatchObject({
      version: "0.149.0",
      source: "workspace-package",
      executablePath: expect.stringMatching(/codex\.exe$/i),
    });
  });

  it("rejects missing, wrong-version, and unsupported package resources", () => {
    const missing = createPackageFixture({});
    rmSync(
      join(
        missing.packageRoot,
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe",
      ),
    );
    expect(() =>
      resolveCodexCli({
        platform: "win32",
        arch: "x64",
        packageRoot: missing.packageRoot,
        entryPackageJsonPath: missing.entryPackageJsonPath,
      }),
    ).toThrowError(CodexCliResolverError);

    const wrongVersion = createPackageFixture({
      platformVersion: "0.148.0-win32-x64",
    });
    expect(() =>
      resolveCodexCli({
        platform: "win32",
        arch: "x64",
        packageRoot: wrongVersion.packageRoot,
        entryPackageJsonPath: wrongVersion.entryPackageJsonPath,
      }),
    ).toThrowError("Codex CLI 版本不匹配");

    const unsupported = createPackageFixture({});
    expect(() =>
      resolveCodexCli({
        platform: "linux",
        arch: "x64",
        packageRoot: unsupported.packageRoot,
        entryPackageJsonPath: unsupported.entryPackageJsonPath,
      }),
    ).toThrowError("仅支持 Windows x64");
  });

  it("does not accept the WindowsApps alias or an unknown global fallback", () => {
    const fixture = createPackageFixture({});

    expect(() =>
      resolveCodexCli({
        platform: "win32",
        arch: "x64",
        packageRoot: fixture.packageRoot,
        entryPackageJsonPath: fixture.entryPackageJsonPath,
        executablePathOverride:
          "C:\\Program Files\\WindowsApps\\OpenAI.Codex_0.149.0\\codex.exe",
      }),
    ).toThrowError("不允许使用 WindowsApps 中的 Codex 路径");
  });
});
