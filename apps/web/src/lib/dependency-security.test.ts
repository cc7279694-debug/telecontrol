import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

describe("Next.js production dependency policy", () => {
  it("keeps Next 15 and pins the audited transitive fixes", () => {
    const rootPackage = readJson("package.json") as {
      overrides?: Record<string, unknown>;
    };
    const webPackage = readJson("apps/web/package.json") as {
      dependencies?: Record<string, string>;
    };

    expect(webPackage.dependencies?.next).toBe("15.5.24");
    expect(rootPackage.overrides).toEqual({
      "next@15.5.24": {
        postcss: "8.5.26",
        sharp: "0.35.3",
      },
    });
    expect(webPackage.dependencies).not.toHaveProperty("postcss");
    expect(webPackage.dependencies).not.toHaveProperty("sharp");
  });
});
