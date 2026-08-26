import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

export const hostRoot = path.resolve(desktopDir, "..", "..");

export type WatchCommandPlan = {
  name: "protocol" | "host-core" | "desktop" | "renderer";
  args: string[];
};

export type RelaunchWatchPlan = {
  rootRelativePath: string;
  triggers: string[];
};

export const initialBuildCommand = ["run", "build"] as const;

export const persistentWatchCommands: WatchCommandPlan[] = [
  {
    name: "protocol",
    args: [
      "exec",
      "--",
      "tsc",
      "-p",
      "../../packages/protocol/tsconfig.json",
      "-w",
      "--preserveWatchOutput",
    ],
  },
  {
    name: "host-core",
    args: ["exec", "--", "tsc", "-p", "tsconfig.json", "-w", "--preserveWatchOutput"],
  },
  {
    name: "desktop",
    args: [
      "exec",
      "--",
      "tsc",
      "-p",
      "tsconfig.desktop.json",
      "-w",
      "--preserveWatchOutput",
    ],
  },
  {
    name: "renderer",
    args: ["exec", "--", "vite", "build", "--watch", "--emptyOutDir", "false"],
  },
];

export const relaunchWatchPlans: RelaunchWatchPlan[] = [
  {
    rootRelativePath: "dist",
    triggers: ["desktop/", "renderer/index.html", "renderer/assets/"],
  },
  {
    rootRelativePath: "../../packages/protocol/dist",
    triggers: ["."],
  },
];
