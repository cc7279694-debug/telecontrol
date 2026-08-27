import { describe, expect, it } from "vitest";
import {
  loadPublicRuntimeConfig,
  PublicRuntimeConfigError,
} from "./public-runtime-config.js";

describe("public runtime config", () => {
  it("accepts only public HTTPS configuration", () => {
    expect(
      loadPublicRuntimeConfig({
        source: {
          CODEX_REMOTE_SUPABASE_URL: "https://demo.supabase.co/",
          CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo",
          CODEX_REMOTE_WEB_ORIGIN: "https://remote.example.com",
          CODEX_REMOTE_PROTOCOL_VERSION: "1",
        },
      }),
    ).toEqual({
      supabaseUrl: "https://demo.supabase.co",
      publishableKey: "sb_publishable_demo",
      webOrigin: "https://remote.example.com",
      protocolVersion: 1,
    });
  });

  it("allows loopback HTTP only for local development", () => {
    expect(
      loadPublicRuntimeConfig({
        source: {
          CODEX_REMOTE_SUPABASE_URL: "http://127.0.0.1:54321",
          CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
          CODEX_REMOTE_WEB_ORIGIN: "http://localhost:3000",
          CODEX_REMOTE_PROTOCOL_VERSION: "1",
        },
      }).supabaseUrl,
    ).toBe("http://127.0.0.1:54321");
  });

  it("allows a legacy public anon JWT key", () => {
    expect(
      loadPublicRuntimeConfig({
        source: {
          CODEX_REMOTE_SUPABASE_URL: "https://demo.supabase.co",
          CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY:
            "eyJhbGciOiJIUzI1NiJ9.public-anon-key",
          CODEX_REMOTE_WEB_ORIGIN: "https://remote.example.com",
          CODEX_REMOTE_PROTOCOL_VERSION: "1",
        },
      }).publishableKey,
    ).toContain("eyJ");
  });

  it("loads the generated public resource in packaged mode", () => {
    expect(
      loadPublicRuntimeConfig({
        isPackaged: true,
        resourcePath: "public-runtime.json",
        readResource: () =>
          JSON.stringify({
            supabaseUrl: "https://demo.supabase.co",
            publishableKey: "sb_publishable_demo",
            webOrigin: "https://remote.example.com",
            protocolVersion: 1,
          }),
      }),
    ).toMatchObject({
      supabaseUrl: "https://demo.supabase.co",
      publishableKey: "sb_publishable_demo",
      webOrigin: "https://remote.example.com",
      protocolVersion: 1,
    });
  });

  it.each([
    "CODEX_REMOTE_SUPABASE_SERVICE_ROLE",
    "CODEX_REMOTE_DATABASE_URL",
    "CODEX_REMOTE_VAPID_PRIVATE_KEY",
  ])("rejects private deployment field %s", (field) => {
    expect(() =>
      loadPublicRuntimeConfig({
        source: {
          [field]: "do-not-ship",
        },
      }),
    ).toThrow(PublicRuntimeConfigError);
  });

  it("rejects missing fields and non-loopback HTTP", () => {
    expect(() =>
      loadPublicRuntimeConfig({
        source: {
          CODEX_REMOTE_SUPABASE_URL: "http://remote.example.com",
          CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
          CODEX_REMOTE_WEB_ORIGIN: "https://remote.example.com",
          CODEX_REMOTE_PROTOCOL_VERSION: "1",
        },
      }),
    ).toThrow(PublicRuntimeConfigError);
  });
});
