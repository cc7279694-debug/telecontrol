import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(testDir, "..", "..");

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("Windows Host build contract", () => {
  it("publishes the compiled desktop main entry and required scripts", () => {
    const packageJson = readJsonFile<{
      main?: string;
      scripts?: Record<string, string>;
    }>(path.join(hostRoot, "package.json"));

    expect(packageJson.main).toBe("dist/desktop/main.js");
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      typecheck: expect.any(String),
      "test:e2e": expect.any(String),
      "package:win": expect.any(String),
    });
  });

  it("does not depend on electron-updater", () => {
    const packageJson = readJsonFile<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(hostRoot, "package.json"));

    expect(packageJson.dependencies?.["electron-updater"]).toBeUndefined();
    expect(packageJson.devDependencies?.["electron-updater"]).toBeUndefined();
  });

  it("builds the renderer into dist/renderer with local assets only", async () => {
    const viteConfigPath = path.join(hostRoot, "vite.config.ts");

    expect(existsSync(viteConfigPath)).toBe(true);

    const viteConfigModule = await import(pathToFileURL(viteConfigPath).href);
    const viteConfig =
      typeof viteConfigModule.default === "function"
        ? await viteConfigModule.default({ command: "build", mode: "test" })
        : viteConfigModule.default;

    expect(viteConfig.build?.outDir).toBe("dist/renderer");
    expect(viteConfig.base).toBe("./");
  });

  it("keeps desktop and preload entries separated for Electron", () => {
    const desktopTsconfig = readJsonFile<{
      compilerOptions?: { outDir?: string; rootDir?: string };
      include?: string[];
    }>(path.join(hostRoot, "tsconfig.desktop.json"));

    expect(desktopTsconfig.compilerOptions?.rootDir).toBe("src/desktop");
    expect(desktopTsconfig.compilerOptions?.outDir).toBe("dist/desktop");
    expect(desktopTsconfig.include).toEqual(["src/desktop/**/*.ts"]);
    expect(existsSync(path.join(hostRoot, "src", "desktop", "main.ts"))).toBe(true);
    expect(existsSync(path.join(hostRoot, "src", "desktop", "preload.ts"))).toBe(true);
  });
});
