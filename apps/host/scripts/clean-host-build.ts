import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

await Promise.all([
  rm(path.join(hostRoot, "dist"), { recursive: true, force: true }),
  rm(path.join(hostRoot, "tsconfig.build.tsbuildinfo"), {
    force: true,
  }),
  rm(path.join(hostRoot, "tsconfig.desktop.build.tsbuildinfo"), {
    force: true,
  }),
]);
