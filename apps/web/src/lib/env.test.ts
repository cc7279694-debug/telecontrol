// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getPublicEnv } from "./env";

describe("web public environment", () => {
  it("requires the Supabase URL and publishable key", () => {
    expect(() => getPublicEnv({})).toThrow("缺少 Supabase 公共配置");
  });

  it("rejects server-only key names from browser configuration", () => {
    expect(() =>
      getPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used",
      }),
    ).toThrow("浏览器配置包含服务端密钥");
  });

  it("returns only the two public Supabase values", () => {
    expect(
      getPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
      }),
    ).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-key",
    });
  });
});
