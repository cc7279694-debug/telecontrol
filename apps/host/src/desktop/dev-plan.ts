import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

export const hostRoot = path.resolve(desktopDir, "..", "..");

export type WatchCommandPlan = {
  name: "typescript" | "renderer";
  args: string[];
  rebuilds: Array<"protocol" | "host-core" | "desktop" | "renderer">;
};

export type RelaunchWatchPlan = {
  rootRelativePath: string;
  triggers: string[];
};

export const initialBuildCommand = ["run", "build"] as const;

export const persistentWatchCommands: WatchCommandPlan[] = [
  {
    name: "typescript",
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
    rebuilds: ["protocol", "host-core", "desktop"],
  },
  {
    name: "renderer",
    args: ["exec", "--", "vite", "build", "--watch", "--emptyOutDir", "false"],
    rebuilds: ["renderer"],
  },
];

export const relaunchWatchPlans: RelaunchWatchPlan[] = [
  {
    rootRelativePath: "dist",
    triggers: [
      "desktop/main.js",
      "desktop/preload.cjs",
      "renderer/index.html",
      "renderer/assets/",
    ],
  },
];
