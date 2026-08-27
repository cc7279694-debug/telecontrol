import { describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseAuthController } from "./supabase-auth-controller.js";

const user = { id: "user-1", email: "demo@example.com" } as User;
const session = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_in: 3_600,
  expires_at: 1_900_000_000,
  token_type: "bearer",
  user,
} as Session;

function createFixture() {
  let storedSession: Session | null = null;
  const auth = {
    signInWithOtp: vi.fn(async () => ({
      data: { user: null, session: null },
      error: null,
    })),
    verifyOtp: vi.fn(async () => {
      storedSession = session;
      return { data: { user, session }, error: null };
    }),
    getSession: vi.fn(async () => ({
      data: { session: storedSession },
      error: null,
    })),
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    refreshSession: vi.fn(async () => ({
      data: { session: storedSession },
      error: null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
    getClaims: vi.fn(async () => ({
      data: { claims: { sub: user.id, session_id: "session-1" } },
      error: null,
    })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  };
  const credentialStore = {
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  let clientOptions: unknown;
  const controller = createSupabaseAuthController({
    runtimeConfig: {
      supabaseUrl: "https://demo.supabase.co",
      publishableKey: "sb_publishable_demo",
      webOrigin: "https://remote.example.com",
      protocolVersion: 1,
    },
    credentialStore,
    hostKeyManager: {
      getOrCreate: vi.fn(async () => ({
        privateKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: "public-x",
          y: "public-y",
          d: "private-d",
        },
        publicKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: "public-x",
          y: "public-y",
        },
      })),
    },
    clientFactory: (_url, _key, options) => {
      clientOptions = options;
      return { auth };
    },
  });
  return {
    auth,
    controller,
    credentialStore,
    getClientOptions: () => clientOptions,
  };
}

describe("supabase auth controller", () => {
  it("uses credential storage instead of browser Local Storage", async () => {
    const fixture = createFixture();
    await expect(
      fixture.controller.requestOtp("demo@example.com"),
    ).resolves.toEqual({
      ok: true,
      message: "验证码已发送",
    });
    await expect(
      fixture.controller.verifyOtp("demo@example.com", "123456"),
    ).resolves.toEqual({ ok: true, message: "登录成功" });

    expect(fixture.getClientOptions()).toMatchObject({
      auth: {
        persistSession: true,
        detectSessionInUrl: false,
        storage: expect.any(Object),
      },
    });
    expect(fixture.credentialStore.write).toHaveBeenCalled();
    expect(fixture.controller.getSnapshot()).toEqual({
      signedIn: true,
      maskedEmail: "d***@example.com",
      ownerId: "user-1",
      authSessionId: "session-1",
    });
  });

  it("maps auth errors, restores a session, refreshes, and signs out", async () => {
    const fixture = createFixture();
    fixture.auth.signInWithOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new Error("rate limit") as never,
    });
    await expect(
      fixture.controller.requestOtp("demo@example.com"),
    ).resolves.toEqual({
      ok: false,
      message: "验证码发送失败，请稍后重试",
    });

    await fixture.controller.verifyOtp("demo@example.com", "123456");
    await expect(fixture.controller.restore()).resolves.toEqual({
      ok: true,
      message: "已恢复登录状态",
    });
    await expect(fixture.controller.refresh()).resolves.toEqual({
      ok: true,
      message: "登录状态已更新",
    });
    await expect(fixture.controller.signOut()).resolves.toEqual({
      ok: true,
      message: "已退出登录",
    });
    expect(fixture.credentialStore.remove).toHaveBeenCalled();
  });
});
