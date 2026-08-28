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

  it("uses a structured dev watch plan that rebuilds protocol through desktop before relaunch", async () => {
    const packageJson = readJsonFile<{
      scripts?: Record<string, string>;
    }>(path.join(hostRoot, "package.json"));
    const devPlanModule = await import(
      pathToFileURL(path.join(hostRoot, "src", "desktop", "dev-plan.ts")).href
    );

    const devScript = packageJson.scripts?.dev;
    const persistentWatchCommands =
      devPlanModule.persistentWatchCommands as Array<{
        name: string;
        args: string[];
        rebuilds?: string[];
      }>;
    const relaunchWatchPlans = devPlanModule.relaunchWatchPlans as Array<{
      rootRelativePath: string;
      triggers: string[];
    }>;

    expect(devScript).toBe("tsx src/desktop/dev.ts --watch-electron");
    expect(persistentWatchCommands).toEqual([
      {
        name: "typescript",
        rebuilds: ["protocol", "host-core", "desktop"],
        args: [
          "exec",
          "--",
          "tsc",
          "-b",
          "../../packages/protocol/tsconfig.json",
          "tsconfig.json",
          "tsconfig.desktop.json",
          "-w",
          "--preserveWatchOutput",
        ],
      },
      {
        name: "renderer",
        rebuilds: ["renderer"],
        args: [
          "exec",
          "--",
          "vite",
          "build",
          "--watch",
          "--emptyOutDir",
          "false",
        ],
      },
    ]);
    expect(relaunchWatchPlans).toEqual([
      {
        rootRelativePath: "dist",
        triggers: [
          "desktop/main.js",
          "desktop/preload.js",
          "renderer/index.html",
          "renderer/assets/",
        ],
      },
    ]);
  });

  it("keeps the renderer build config local and deterministic", async () => {
    const viteConfigPath = path.join(hostRoot, "vite.config.ts");

    expect(existsSync(viteConfigPath)).toBe(true);

    const viteConfigModule = await import(pathToFileURL(viteConfigPath).href);
    const viteConfig =
      typeof viteConfigModule.default === "function"
        ? await viteConfigModule.default({ command: "build", mode: "test" })
        : viteConfigModule.default;

    expect(viteConfig.base).toBe("./");
    expect(viteConfig.build?.outDir).toBe("dist/renderer");
    expect(viteConfig.build?.emptyOutDir).toBe(false);
    expect(viteConfig.build?.rollupOptions?.input).toBe(
      path.join(hostRoot, "index.html"),
    );
  }, 60_000);

  it("does not depend on electron-updater", () => {
    const packageJson = readJsonFile<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(hostRoot, "package.json"));

    expect(packageJson.dependencies?.["electron-updater"]).toBeUndefined();
    expect(packageJson.devDependencies?.["electron-updater"]).toBeUndefined();
  });

  it("keeps desktop and preload entries separated for Electron", () => {
    const desktopTsconfig = readJsonFile<{
      compilerOptions?: { outDir?: string; rootDir?: string };
      include?: string[];
    }>(path.join(hostRoot, "tsconfig.desktop.json"));
    const desktopBuildTsconfig = readJsonFile<{
      exclude?: string[];
      include?: string[];
    }>(path.join(hostRoot, "tsconfig.desktop.build.json"));

    expect(desktopTsconfig.compilerOptions?.rootDir).toBe("src");
    expect(desktopTsconfig.compilerOptions?.outDir).toBe("dist/desktop");
    expect(desktopTsconfig.include).toEqual(["src/desktop/**/*.ts"]);
    expect(desktopBuildTsconfig.exclude).toEqual([
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ]);
    expect(desktopBuildTsconfig.include).toEqual([
      "src/desktop/**/*.ts",
      "src/supabase-transport.ts",
    ]);
    expect(existsSync(path.join(hostRoot, "src", "desktop", "main.ts"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(hostRoot, "src", "desktop", "preload.ts")),
    ).toBe(true);
  });

  it("typechecks tests while keeping test files out of production builds", () => {
    const hostTsconfig = readJsonFile<{
      exclude?: string[];
    }>(path.join(hostRoot, "tsconfig.json"));
    const testTsconfig = readJsonFile<{
      compilerOptions?: { noEmit?: boolean; jsx?: string; rootDir?: string };
      include?: string[];
      exclude?: string[];
    }>(path.join(hostRoot, "tsconfig.test.json"));
    const buildTsconfig = readJsonFile<{
      exclude?: string[];
    }>(path.join(hostRoot, "tsconfig.build.json"));

    expect(hostTsconfig.exclude).toEqual([
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ]);
    expect(testTsconfig.compilerOptions).toMatchObject({
      noEmit: true,
      jsx: "react-jsx",
      rootDir: "../..",
    });
    expect(testTsconfig.include).toEqual([
      "src/**/*.ts",
      "src/**/*.tsx",
      "../../packages/protocol/src/**/*.ts",
    ]);
    expect(testTsconfig.exclude).toEqual([]);
    expect(buildTsconfig.exclude).toEqual([
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ]);
  });
});
