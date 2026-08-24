import { describe, expect, it } from "vitest";
import { assertLoopbackSupabaseUrl } from "./local-remote-host-harness.js";

describe("local remote Host harness", () => {
  it("fails closed for hosted Supabase URLs", () => {
    expect(() =>
      assertLoopbackSupabaseUrl("https://example.supabase.co"),
    ).toThrow("本地开发 Host 只允许连接回环地址");
  });

  it("accepts localhost and IPv4 loopback URLs", () => {
    expect(() =>
      assertLoopbackSupabaseUrl("http://localhost:54321"),
    ).not.toThrow();
    expect(() =>
      assertLoopbackSupabaseUrl("http://127.0.0.1:54321"),
    ).not.toThrow();
  });
});
