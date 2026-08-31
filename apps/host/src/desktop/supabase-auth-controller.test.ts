import { describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import type { CredentialPayload } from "./credential-store.js";
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

const sessionWithFallbackClaim = {
  ...session,
  access_token: `header.${Buffer.from(
    JSON.stringify({ session_id: "session-fallback" }),
  ).toString("base64url")}.signature`,
} as Session;

function createFixture() {
  let storedSession: Session | null = null;
  let authStateChangeCallback:
    ((event: string, session: Session | null) => void) | undefined;
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
    setSession: vi.fn(async () => {
      storedSession = session;
      return { data: { session }, error: null };
    }),
    signOut: vi.fn(async () => ({ error: null })),
    getClaims: vi.fn(async () => ({
      data: { claims: { sub: user.id, session_id: "session-1" } },
      error: null,
    })),
    onAuthStateChange: vi.fn((callback) => {
      authStateChangeCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  const credentialStore = {
    read: vi.fn(async (): Promise<CredentialPayload | null> => null),
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
    emitAuthStateChange: (event: string, nextSession: Session | null) =>
      authStateChangeCallback?.(event, nextSession),
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
        storageKey: "codex-remote.host.session",
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

  it("rejects replacing credentials with a different account", async () => {
    const fixture = createFixture();
    const oldCredentials: CredentialPayload = {
      schemaVersion: 1,
      ownerId: "another-owner",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      hostPrivateKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
        d: "private-d",
      },
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    fixture.credentialStore.read.mockResolvedValue(oldCredentials);

    await expect(
      fixture.controller.verifyOtp("demo@example.com", "123456"),
    ).resolves.toEqual({
      ok: false,
      message: "检测到其他账号的本机凭据，请先清除本机数据后重试",
    });
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fixture.credentialStore.write).toHaveBeenCalledWith(oldCredentials);
  });

  it("clears a revoked session instead of restoring it", async () => {
    const fixture = createFixture();
    fixture.credentialStore.read.mockResolvedValue({
      schemaVersion: 1,
      accessToken: "revoked-access-token",
      refreshToken: "revoked-refresh-token",
      hostPrivateKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
        d: "private-d",
      },
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    fixture.auth.setSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error("revoked") as never,
    } as never);

    await expect(fixture.controller.restore()).resolves.toEqual({
      ok: false,
      message: "登录状态已失效，请重新登录",
    });
    expect(fixture.credentialStore.remove).toHaveBeenCalledOnce();
  });

  it("restores DPAPI tokens through Supabase setSession", async () => {
    const fixture = createFixture();
    fixture.credentialStore.read.mockResolvedValue({
      schemaVersion: 1,
      accessToken: "stored-access-token",
      refreshToken: "stored-refresh-token",
      hostPrivateKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
        d: "private-d",
      },
      updatedAt: "2026-08-27T00:00:00.000Z",
    });

    await expect(fixture.controller.restore()).resolves.toEqual({
      ok: true,
      message: "已恢复登录状态",
    });
    expect(fixture.auth.setSession).toHaveBeenCalledWith({
      access_token: "stored-access-token",
      refresh_token: "stored-refresh-token",
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

  it("keeps the verified session when the JWKS claims lookup times out", async () => {
    const fixture = createFixture();
    fixture.auth.getClaims.mockRejectedValue(new Error("JWKS request timeout"));
    fixture.auth.verifyOtp.mockResolvedValueOnce({
      data: { user, session: sessionWithFallbackClaim },
      error: null,
    });

    await expect(
      fixture.controller.verifyOtp("demo@example.com", "123456"),
    ).resolves.toEqual({ ok: true, message: "登录成功" });
    await expect(fixture.controller.getRuntimeSession()).resolves.toMatchObject(
      {
        ownerId: "user-1",
        authSessionId: "session-fallback",
      },
    );
  });

  it("exposes a main-process-only runtime session and refresh notifications", async () => {
    const fixture = createFixture();
    const listener = vi.fn();
    fixture.controller.onRuntimeSessionChanged(listener);

    await fixture.controller.verifyOtp("demo@example.com", "123456");
    const runtimeSession = await fixture.controller.getRuntimeSession();

    expect(runtimeSession).toEqual({
      accessToken: "access-token",
      ownerId: "user-1",
      authSessionId: "session-1",
    });

    fixture.emitAuthStateChange("TOKEN_REFRESHED", {
      ...session,
      access_token: "refreshed-access-token",
    });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenLastCalledWith({
        accessToken: "refreshed-access-token",
        ownerId: "user-1",
        authSessionId: "session-1",
      });
    });

    fixture.emitAuthStateChange("SIGNED_OUT", null);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(null));
  });
});
