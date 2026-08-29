import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const hostRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist/desktop",
    emptyOutDir: false,
    lib: {
      entry: path.join(hostRoot, "src", "desktop", "preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
