import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(testDir, "..", "..");
const repoRoot = path.resolve(hostRoot, "..", "..");

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("Windows installer package policy", () => {
  it("locks the current-user x64 NSIS policy", () => {
    const builderConfig = readFileSync(
      path.join(hostRoot, "electron-builder.yml"),
      "utf8",
    );

    expect(builderConfig).toContain("appId: com.codexremote.host");
    expect(builderConfig).toContain("productName: Codex Remote Host");
    expect(builderConfig).toContain("target: nsis");
    expect(builderConfig).toContain("- x64");
    expect(builderConfig).toContain("requestedExecutionLevel: asInvoker");
    expect(builderConfig).toContain("oneClick: true");
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).not.toContain("allowToChangeInstallationDirectory");
    expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
  });

  it("defines the package scripts and keeps the web E2E entry unchanged", () => {
    const hostPackage = readJsonFile<{
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(hostRoot, "package.json"));
    const rootPackage = readJsonFile<{
      scripts?: Record<string, string>;
    }>(path.join(repoRoot, "package.json"));

    expect(hostPackage.scripts).toMatchObject({
      "package:prepare": expect.any(String),
      "package:dir": expect.any(String),
      "package:win": expect.any(String),
      "package:verify": expect.any(String),
    });
    expect(hostPackage.devDependencies).toMatchObject({
      "@electron/asar": "3.4.1",
      "@playwright/test": "1.62.1",
      playwright: "1.62.1",
    });
    expect(hostPackage.devDependencies).not.toHaveProperty("electron-updater");
    expect(hostPackage.scripts?.["test:e2e"]).toBe(
      "playwright test --config playwright.config.ts",
    );

    const packageWin = hostPackage.scripts?.["package:win"] ?? "";
    expect(packageWin.indexOf("npm run build")).toBeGreaterThanOrEqual(0);
    expect(packageWin.indexOf("generate-public-runtime")).toBeGreaterThan(
      packageWin.indexOf("npm run build"),
    );
    expect(packageWin.indexOf("package:prepare")).toBeGreaterThan(
      packageWin.indexOf("generate-public-runtime"),
    );
    expect(packageWin.indexOf("electron-builder")).toBeGreaterThan(
      packageWin.indexOf("package:prepare"),
    );

    expect(rootPackage.scripts).toMatchObject({
      "package:host": expect.any(String),
      "verify:host-package": expect.any(String),
    });
    expect(rootPackage.scripts?.["test:e2e"]).toBe(
      "npm run test:e2e --workspace @codex-remote/web",
    );
  });
});
