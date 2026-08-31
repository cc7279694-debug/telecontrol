import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { CredentialPayload, CredentialStore } from "./credential-store.js";
import type { HostKeyPair } from "./host-key-manager.js";
import type { PublicRuntimeConfig } from "./public-runtime-config.js";

type AuthErrorLike = { message?: string } | null;
type AuthResponse<T> = { data: T; error: AuthErrorLike };
type SupabaseAuthLike = {
  signInWithOtp: (input: {
    email: string;
    options: { shouldCreateUser: boolean };
  }) => Promise<AuthResponse<{ user: User | null; session: Session | null }>>;
  verifyOtp: (input: {
    email: string;
    token: string;
    type: "email";
  }) => Promise<AuthResponse<{ user: User | null; session: Session | null }>>;
  getSession: () => Promise<AuthResponse<{ session: Session | null }>>;
  getUser: () => Promise<AuthResponse<{ user: User | null }>>;
  refreshSession: () => Promise<AuthResponse<{ session: Session | null }>>;
  setSession?: (input: {
    access_token: string;
    refresh_token: string;
  }) => Promise<AuthResponse<{ session: Session | null }>>;
  signOut: (options?: { scope: "global" | "local" | "others" }) => Promise<{
    error: AuthErrorLike;
  }>;
  getClaims?: () => Promise<AuthResponse<{ claims?: Record<string, unknown> }>>;
  onAuthStateChange: (
    callback: (event: string, session: Session | null) => void,
  ) => {
    data: { subscription: { unsubscribe: () => void } };
  };
};

type AuthClient = { auth: SupabaseAuthLike };
type AuthClientFactory = (
  url: string,
  key: string,
  options: Record<string, unknown>,
) => AuthClient;

export type AuthSnapshot = {
  signedIn: boolean;
  maskedEmail: string | null;
  ownerId: string | null;
  authSessionId: string | null;
};

export type AuthActionResult = { ok: boolean; message: string };

export type RuntimeSession = {
  accessToken: string;
  ownerId: string;
  authSessionId: string | null;
};

const storageKey = "codex-remote.host.session";

function emptySnapshot(): AuthSnapshot {
  return {
    signedIn: false,
    maskedEmail: null,
    ownerId: null,
    authSessionId: null,
  };
}

function maskEmail(email: string | undefined) {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function authMessage(error: AuthErrorLike, fallback: string) {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("expired") || message.includes("invalid")) {
    return "验证码无效或已过期";
  }
  return fallback;
}

function parseSession(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Session>;
    if (
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

function tokenClaims(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createSupabaseAuthController({
  runtimeConfig,
  credentialStore,
  hostKeyManager,
  clientFactory = (url, key, options) =>
    createClient(
      url,
      key,
      options as Parameters<typeof createClient>[2],
    ) as unknown as AuthClient,
}: {
  runtimeConfig: PublicRuntimeConfig;
  credentialStore: Pick<CredentialStore, "read" | "write" | "remove">;
  hostKeyManager: Pick<
    { getOrCreate: () => Promise<HostKeyPair> },
    "getOrCreate"
  >;
  clientFactory?: AuthClientFactory;
}) {
  let snapshot = emptySnapshot();
  let runtimeSession: RuntimeSession | null = null;
  const runtimeSessionHandlers = new Set<
    (session: RuntimeSession | null) => void
  >();
  const storage = {
    getItem: async (key: string) => {
      if (key !== storageKey) return null;
      const credentials = await credentialStore.read();
      if (!credentials) return null;
      return JSON.stringify({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
      });
    },
    setItem: async (key: string, value: string) => {
      if (key !== storageKey) return;
      const session = parseSession(value);
      if (!session) return;
      const hostKey = await hostKeyManager.getOrCreate();
      const existing = await credentialStore.read();
      const sessionOwnerId = tokenClaims(session.access_token).sub;
      if (
        existing?.ownerId &&
        sessionOwnerId &&
        sessionOwnerId !== existing.ownerId
      ) {
        return;
      }
      const payload: CredentialPayload = {
        schemaVersion: 1,
        ownerId: existing?.ownerId,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        hostPrivateKeyJwk: {
          kty: "EC",
          crv: "P-256",
          x: hostKey.privateKeyJwk.x,
          y: hostKey.privateKeyJwk.y,
          d: hostKey.privateKeyJwk.d,
        },
        updatedAt: new Date().toISOString(),
      };
      await credentialStore.write(payload);
    },
    removeItem: async (key: string) => {
      if (key === storageKey) await credentialStore.remove();
    },
  };
  const client = clientFactory(
    runtimeConfig.supabaseUrl,
    runtimeConfig.publishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey,
        detectSessionInUrl: false,
        storage,
      },
    },
  );

  async function getIdentity(session: Session) {
    const fallbackClaims = tokenClaims(session.access_token);
    let claims = fallbackClaims;
    if (client.auth.getClaims) {
      try {
        const result = await client.auth.getClaims();
        if (!result.error && result.data.claims) claims = result.data.claims;
      } catch {
        // 某些网络环境无法及时访问 JWKS，使用已由 Auth 服务验证的会话载荷。
      }
    }
    const ownerId =
      session.user.id || (typeof claims.sub === "string" ? claims.sub : null);
    const authSessionId =
      typeof claims.session_id === "string" ? claims.session_id : null;
    return { ownerId, authSessionId };
  }

  async function applySession(session: Session | null) {
    if (!session) {
      snapshot = emptySnapshot();
      runtimeSession = null;
      for (const handler of runtimeSessionHandlers) handler(null);
      return snapshot;
    }
    const identity = await getIdentity(session);
    snapshot = {
      signedIn: true,
      maskedEmail: maskEmail(session.user.email),
      ownerId: identity.ownerId,
      authSessionId: identity.authSessionId,
    };
    if (identity.ownerId) {
      const nextRuntimeSession: RuntimeSession = {
        accessToken: session.access_token,
        ownerId: identity.ownerId,
        authSessionId: identity.authSessionId,
      };
      runtimeSession = nextRuntimeSession;
      for (const handler of runtimeSessionHandlers) {
        handler({ ...nextRuntimeSession });
      }
    } else {
      runtimeSession = null;
      for (const handler of runtimeSessionHandlers) handler(null);
    }
    return snapshot;
  }

  client.auth.onAuthStateChange((_event, session) => {
    void applySession(session).catch(() => {
      snapshot = emptySnapshot();
      runtimeSession = null;
      for (const handler of runtimeSessionHandlers) handler(null);
    });
  });

  async function persistSession(session: Session) {
    const identity = await getIdentity(session);
    const existing = await credentialStore.read();
    if (existing?.ownerId && existing.ownerId !== identity.ownerId) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      await credentialStore.write(existing);
      snapshot = emptySnapshot();
      runtimeSession = null;
      for (const handler of runtimeSessionHandlers) handler(null);
      return false;
    }
    const hostKey = await hostKeyManager.getOrCreate();
    await credentialStore.write({
      schemaVersion: 1,
      ownerId: identity.ownerId ?? undefined,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      hostPrivateKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: hostKey.privateKeyJwk.x,
        y: hostKey.privateKeyJwk.y,
        d: hostKey.privateKeyJwk.d,
      },
      updatedAt: new Date().toISOString(),
    });
    await applySession(session);
    return true;
  }

  async function requestOtp(email: string): Promise<AuthActionResult> {
    const result = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (result.error)
      return {
        ok: false,
        message: authMessage(result.error, "验证码发送失败，请稍后重试"),
      };
    return { ok: true, message: "验证码已发送" };
  }

  async function verifyOtp(
    email: string,
    token: string,
  ): Promise<AuthActionResult> {
    const result = await client.auth.verifyOtp({ email, token, type: "email" });
    if (result.error)
      return {
        ok: false,
        message: authMessage(result.error, "登录失败，请检查验证码"),
      };
    if (!result.data.session)
      return { ok: false, message: "登录失败，未获取到登录状态" };
    if (!(await persistSession(result.data.session))) {
      return {
        ok: false,
        message: "检测到其他账号的本机凭据，请先清除本机数据后重试",
      };
    }
    return { ok: true, message: "登录成功" };
  }

  async function restore(): Promise<AuthActionResult> {
    const credentials = await credentialStore.read();
    if (credentials && client.auth.setSession) {
      const restored = await client.auth.setSession({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
      });
      if (restored.error || !restored.data.session) {
        await credentialStore.remove();
        snapshot = emptySnapshot();
        return { ok: false, message: "登录状态已失效，请重新登录" };
      }
      const restoredIdentity = await getIdentity(restored.data.session);
      if (
        credentials.ownerId &&
        credentials.ownerId !== restoredIdentity.ownerId
      ) {
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        await credentialStore.remove();
        snapshot = emptySnapshot();
        return { ok: false, message: "登录状态已失效，请重新登录" };
      }
      await applySession(restored.data.session);
      return { ok: true, message: "已恢复登录状态" };
    }
    const result = await client.auth.getSession();
    if (result.error) return { ok: false, message: "无法恢复登录状态" };
    if (!result.data.session) {
      snapshot = emptySnapshot();
      return { ok: true, message: "当前未登录" };
    }
    await applySession(result.data.session);
    return { ok: true, message: "已恢复登录状态" };
  }

  async function refresh(): Promise<AuthActionResult> {
    const result = await client.auth.refreshSession();
    if (result.error || !result.data.session)
      return { ok: false, message: "登录状态已失效，请重新登录" };
    if (!(await persistSession(result.data.session))) {
      return {
        ok: false,
        message: "检测到其他账号的本机凭据，请先清除本机数据后重试",
      };
    }
    return { ok: true, message: "登录状态已更新" };
  }

  async function signOut(): Promise<AuthActionResult> {
    const result = await client.auth.signOut();
    if (result.error) return { ok: false, message: "退出登录失败，请稍后重试" };
    await credentialStore.remove();
    snapshot = emptySnapshot();
    runtimeSession = null;
    for (const handler of runtimeSessionHandlers) handler(null);
    return { ok: true, message: "已退出登录" };
  }

  async function getRuntimeSession(): Promise<RuntimeSession | null> {
    if (runtimeSession) return { ...runtimeSession };
    const result = await client.auth.getSession();
    if (result.error || !result.data.session) return null;
    await applySession(result.data.session);
    const identity = await getIdentity(result.data.session);
    if (!identity.ownerId) return null;
    return {
      accessToken: result.data.session.access_token,
      ownerId: identity.ownerId,
      authSessionId: identity.authSessionId,
    };
  }

  function onRuntimeSessionChanged(
    handler: (session: RuntimeSession | null) => void,
  ) {
    runtimeSessionHandlers.add(handler);
    return () => runtimeSessionHandlers.delete(handler);
  }

  return {
    requestOtp,
    verifyOtp,
    restore,
    refresh,
    signOut,
    getRuntimeSession,
    onRuntimeSessionChanged,
    getSnapshot: () => snapshot,
    getClient: () => client,
  };
}
