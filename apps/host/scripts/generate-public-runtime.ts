import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicRuntimeConfig } from "../src/desktop/public-runtime-config.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDirectory, "..", "public-runtime.json");
const config = loadPublicRuntimeConfig({ source: process.env });

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Generated public Host runtime config at ${outputPath}`);
