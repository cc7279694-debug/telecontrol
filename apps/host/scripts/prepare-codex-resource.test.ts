import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCodexResource } from "./prepare-codex-resource.js";

const REQUIRED_VENDOR_FILES = [
  "vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  "vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe",
  "vendor/x86_64-pc-windows-msvc/codex-path/rg.exe",
  "vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe",
  "vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe",
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(options: {
  entryVersion?: string;
  platformVersion?: string;
  missingFiles?: readonly string[];
}) {
  const root = mkdtempSync(join(tmpdir(), "codex-resource-"));
  temporaryDirectories.push(root);

  const platformPackageRoot = join(root, "platform-package");
  mkdirSync(platformPackageRoot, { recursive: true });
  writeFileSync(
    join(platformPackageRoot, "package.json"),
    JSON.stringify({
      name: "@openai/codex",
      version: options.platformVersion ?? "0.149.0-win32-x64",
    }),
  );
  const entryPackageJsonPath = join(root, "codex-package.json");
  writeFileSync(
    entryPackageJsonPath,
    JSON.stringify({
      name: "@openai/codex",
      version: options.entryVersion ?? "0.149.0",
    }),
  );

  for (const file of REQUIRED_VENDOR_FILES) {
    if (options.missingFiles?.includes(file)) continue;
    const filePath = join(platformPackageRoot, file);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, `fixture:${file}`);
  }

  const allowedOutputParent = join(root, "allowed-resources");
  const outputRoot = join(allowedOutputParent, "codex");
  return {
    allowedOutputParent,
    entryPackageJsonPath,
    outputRoot,
    platformPackageRoot,
    root,
  };
}

function prepareInput(fixture: ReturnType<typeof createFixture>) {
  return {
    allowedOutputParent: fixture.allowedOutputParent,
    entryPackageJsonPath: fixture.entryPackageJsonPath,
    outputRoot: fixture.outputRoot,
    platformPackageRoot: fixture.platformPackageRoot,
  };
}

describe("Codex resource preparation", () => {
  it("copies the complete pinned resource tree and metadata", async () => {
    const fixture = createFixture({});

    const result = await prepareCodexResource(prepareInput(fixture));

    expect(result).toEqual({
      outputRoot: fixture.outputRoot,
      executablePath: join(
        fixture.outputRoot,
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe",
      ),
      cliVersion: "0.149.0",
      platformVersion: "0.149.0-win32-x64",
    });
    expect(
      JSON.parse(
        readFileSync(join(fixture.outputRoot, "package.json"), "utf8"),
      ),
    ).toMatchObject({
      version: "0.149.0-win32-x64",
    });
    expect(
      JSON.parse(
        readFileSync(
          join(fixture.outputRoot, "codex-cli-package.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ version: "0.149.0" });
    for (const file of REQUIRED_VENDOR_FILES) {
      expect(existsSync(join(fixture.outputRoot, file))).toBe(true);
    }
  });

  it.each([
    ["missing codex executable", "vendor/x86_64-pc-windows-msvc/bin/codex.exe"],
    [
      "missing code-mode helper",
      "vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe",
    ],
    [
      "missing ripgrep helper",
      "vendor/x86_64-pc-windows-msvc/codex-path/rg.exe",
    ],
    [
      "missing command runner",
      "vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe",
    ],
    [
      "missing sandbox setup helper",
      "vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe",
    ],
  ])("rejects %s before copying", async (_description, missingFile) => {
    const fixture = createFixture({ missingFiles: [missingFile] });

    await expect(prepareCodexResource(prepareInput(fixture))).rejects.toThrow();
    expect(existsSync(fixture.outputRoot)).toBe(false);
  });

  it.each([
    ["wrong entry version", { entryVersion: "0.148.0" }],
    ["wrong platform version", { platformVersion: "0.148.0-win32-x64" }],
  ])(
    "rejects %s without deleting existing output",
    async (_description, options) => {
      const fixture = createFixture(options);
      mkdirSync(fixture.outputRoot, { recursive: true });
      const sentinel = join(fixture.outputRoot, "sentinel.txt");
      writeFileSync(sentinel, "keep me");

      await expect(
        prepareCodexResource(prepareInput(fixture)),
      ).rejects.toThrow();
      expect(readFileSync(sentinel, "utf8")).toBe("keep me");
    },
  );

  it("rejects output roots outside the explicit allowed parent", async () => {
    const fixture = createFixture({});
    const outsideOutputRoot = join(fixture.root, "outside", "codex");

    await expect(
      prepareCodexResource({
        ...prepareInput(fixture),
        outputRoot: outsideOutputRoot,
      }),
    ).rejects.toThrow();
    expect(relative(fixture.allowedOutputParent, outsideOutputRoot)).toMatch(
      /^\.\./,
    );
    expect(existsSync(outsideOutputRoot)).toBe(false);
  });

  it("rejects the allowed parent itself as an output root", async () => {
    const fixture = createFixture({});

    await expect(
      prepareCodexResource({
        ...prepareInput(fixture),
        outputRoot: fixture.allowedOutputParent,
      }),
    ).rejects.toThrow();
  });
});
