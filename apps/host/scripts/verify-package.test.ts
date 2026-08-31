import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPackage } from "./verify-package.js";

const temporaryDirectories: string[] = [];
const EXPECTED_VERSION = "0.1.11" as const;
const EXPECTED_INSTALLER = "Codex-Remote-Host-0.1.11-Windows-x64.exe" as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeX64Pe(): Buffer {
  const buffer = Buffer.alloc(512);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\0\0", 0x80, "ascii");
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(0x20b, 0x98);
  return buffer;
}

function makePe(machine: number): Buffer {
  const buffer = makeX64Pe();
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

async function createFixture(options: {
  appAsarFiles?: Record<string, string | Buffer | undefined>;
  resourceFiles?: Record<string, string | Buffer | undefined>;
  runtimeConfig?: Record<string, unknown>;
  runtimeConfigRaw?: string;
  installerName?: string;
  installerMachine?: number;
  forbiddenReleasePath?: string;
  omitInstaller?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), "codex-package-"));
  temporaryDirectories.push(root);
  const releaseDir = join(root, "release");
  const unpackedDir = join(releaseDir, "win-unpacked");
  const appSourceDir = join(root, "app-source");
  const resourcesDir = join(unpackedDir, "resources");
  const codexDir = join(resourcesDir, "codex");
  mkdirSync(appSourceDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });

  const appAsarFiles: Record<string, string | Buffer> = {
    "package.json": JSON.stringify({
      name: "@codex-remote/host",
      version: "0.1.11",
    }),
    "dist/desktop/main.js": "export {};",
    "dist/desktop/preload.cjs": "module.exports = {};",
    "dist/renderer/index.html": "<!doctype html>",
    "node_modules/@codex-remote/protocol/package.json": JSON.stringify({
      name: "@codex-remote/protocol",
      version: "0.1.0",
    }),
    ...(options.appAsarFiles ?? {}),
  };
  for (const [relativePath, content] of Object.entries(appAsarFiles)) {
    if (content === undefined) continue;
    const filePath = join(appSourceDir, relativePath);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
  await createPackage(appSourceDir, join(resourcesDir, "app.asar"));

  const resourceFiles: Record<string, string | Buffer> = {
    "package.json": JSON.stringify({
      name: "@openai/codex-win32-x64",
      version: "0.149.0-win32-x64",
    }),
    "codex-cli-package.json": JSON.stringify({
      name: "@openai/codex",
      version: "0.149.0",
    }),
    "vendor/x86_64-pc-windows-msvc/bin/codex.exe": makeX64Pe(),
    "vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe": makeX64Pe(),
    "vendor/x86_64-pc-windows-msvc/codex-path/rg.exe": makeX64Pe(),
    "vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe":
      makeX64Pe(),
    "vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe":
      makeX64Pe(),
    ...(options.resourceFiles ?? {}),
  };
  for (const [relativePath, content] of Object.entries(resourceFiles)) {
    if (content === undefined) continue;
    const filePath = join(codexDir, relativePath);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }

  writeFileSync(join(unpackedDir, "Codex Remote Host.exe"), makeX64Pe());
  writeFileSync(
    join(resourcesDir, "public-runtime.json"),
    options.runtimeConfigRaw ??
      JSON.stringify(
        options.runtimeConfig ?? {
          supabaseUrl: "http://127.0.0.1:54321",
          publishableKey: "public-key",
          webOrigin: "http://127.0.0.1:3000",
          protocolVersion: 1,
        },
      ),
  );

  if (options.forbiddenReleasePath) {
    const forbiddenPath = join(releaseDir, options.forbiddenReleasePath);
    mkdirSync(join(forbiddenPath, ".."), { recursive: true });
    writeFileSync(forbiddenPath, "forbidden");
  }

  if (!options.omitInstaller) {
    writeFileSync(
      join(releaseDir, options.installerName ?? EXPECTED_INSTALLER),
      makePe(options.installerMachine ?? 0x8664),
    );
  }

  return { releaseDir, root };
}

describe("Windows Host package verification", { timeout: 15_000 }, () => {
  it("accepts a complete x64 unpacked package and installer", async () => {
    const fixture = await createFixture({});

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).resolves.toMatchObject({
      installerName: EXPECTED_INSTALLER,
      architecture: "x64",
      signingStatus: "unsigned",
    });
  });

  it.each([
    ["main entry", "dist/desktop/main.js"],
    ["preload entry", "dist/desktop/preload.cjs"],
    ["renderer entry", "dist/renderer/index.html"],
  ])("rejects an app.asar missing the %s", async (_label, missingPath) => {
    const fixture = await createFixture({
      appAsarFiles: { [missingPath]: undefined },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a package without the production protocol package", async () => {
    const fixture = await createFixture({
      appAsarFiles: {
        "node_modules/@codex-remote/protocol/package.json": undefined,
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects mismatched Codex metadata", async () => {
    const fixture = await createFixture({
      resourceFiles: {
        "codex-cli-package.json": JSON.stringify({
          name: "@openai/codex",
          version: "0.148.0",
        }),
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a missing Codex helper resource", async () => {
    const fixture = await createFixture({
      resourceFiles: {
        "vendor/x86_64-pc-windows-msvc/codex-path/rg.exe": undefined,
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["x86", 0x14c],
    ["ARM", 0xaa64],
  ])("rejects an %s Codex core executable", async (_label, machine) => {
    const fixture = await createFixture({
      resourceFiles: {
        "vendor/x86_64-pc-windows-msvc/bin/codex.exe": makePe(machine),
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("accepts the 32-bit NSIS bootstrapper when the packaged application is x64", async () => {
    const fixture = await createFixture({ installerMachine: 0x14c });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).resolves.toMatchObject({ architecture: "x64" });
  });

  it.each([
    [".env", ".env"],
    ["service role name", "service_role.txt"],
    ["VAPID private key", "vapid-private-key.txt"],
    ["source map", "source.map"],
    ["test file", "dist/example.test.js"],
    ["git metadata", ".git/config"],
    ["log file", "logs/host.log"],
    ["credentials", "credentials.v1.bin"],
  ])("rejects a release containing %s", async (_label, forbiddenPath) => {
    const fixture = await createFixture({
      forbiddenReleasePath: forbiddenPath,
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("allows production credential-handling code in app.asar", async () => {
    const fixture = await createFixture({
      appAsarFiles: {
        "dist/desktop/credential-store.js": "export {};",
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).resolves.toMatchObject({ architecture: "x64" });
  });

  it("rejects malformed public runtime config", async () => {
    const fixture = await createFixture({ runtimeConfigRaw: "{" });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown public runtime config keys", async () => {
    const fixture = await createFixture({
      runtimeConfig: {
        supabaseUrl: "http://127.0.0.1:54321",
        publishableKey: "public-key",
        webOrigin: "http://127.0.0.1:3000",
        protocolVersion: 1,
        serviceRole: "must-not-ship",
      },
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects an unexpected installer filename", async () => {
    const fixture = await createFixture({
      installerName: "Other-Host-0.1.0-Windows-x64.exe",
    });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });

  it("allows unpacked verification when the installer is intentionally absent", async () => {
    const fixture = await createFixture({ omitInstaller: true });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: false,
      }),
    ).resolves.toMatchObject({
      installerName: null,
      installerSha256: null,
    });
    expect(existsSync(join(fixture.releaseDir, EXPECTED_INSTALLER))).toBe(
      false,
    );
  });

  it("rejects a missing installer when it is required", async () => {
    const fixture = await createFixture({ omitInstaller: true });

    await expect(
      verifyPackage({
        releaseDir: fixture.releaseDir,
        expectedVersion: EXPECTED_VERSION,
        requireInstaller: true,
      }),
    ).rejects.toThrow();
  });
});
