import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serviceWorkerPath = resolve(process.cwd(), "apps/web/public/sw.js");

describe("service worker cache policy", () => {
  it("keeps authenticated and Supabase requests network-only", () => {
    const source = readFileSync(serviceWorkerPath, "utf8");

    expect(source).toContain("/hosts");
    expect(source).toContain("/login");
    expect(source).toContain("/pair");
    expect(source).toContain("/realtime/v1");
    expect(source).toContain("network-only");
    expect(source).toContain("codex-remote-shell-v1");
  });
});
