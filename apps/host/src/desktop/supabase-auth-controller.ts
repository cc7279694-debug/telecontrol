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
  signOut: () => Promise<{ error: AuthErrorLike }>;
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

function sessionToStoredValue(session: Session) {
  return JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
    provider_token: session.provider_token,
    provider_refresh_token: session.provider_refresh_token,
  });
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
      const payload: CredentialPayload = {
        schemaVersion: 1,
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
        detectSessionInUrl: false,
        storage,
      },
    },
  );

  async function getIdentity(session: Session) {
    const fallbackClaims = tokenClaims(session.access_token);
    let claims = fallbackClaims;
    if (client.auth.getClaims) {
      const result = await client.auth.getClaims();
      if (!result.error && result.data.claims) claims = result.data.claims;
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
      return snapshot;
    }
    const identity = await getIdentity(session);
    snapshot = {
      signedIn: true,
      maskedEmail: maskEmail(session.user.email),
      ownerId: identity.ownerId,
      authSessionId: identity.authSessionId,
    };
    return snapshot;
  }

  client.auth.onAuthStateChange((_event, session) => {
    if (!session) snapshot = emptySnapshot();
    else {
      snapshot = {
        signedIn: true,
        maskedEmail: maskEmail(session.user.email),
        ownerId: session.user.id,
        authSessionId: null,
      };
    }
  });

  async function persistSession(session: Session) {
    await storage.setItem(storageKey, sessionToStoredValue(session));
    await applySession(session);
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
    await persistSession(result.data.session);
    return { ok: true, message: "登录成功" };
  }

  async function restore(): Promise<AuthActionResult> {
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
    await persistSession(result.data.session);
    return { ok: true, message: "登录状态已更新" };
  }

  async function signOut(): Promise<AuthActionResult> {
    const result = await client.auth.signOut();
    if (result.error) return { ok: false, message: "退出登录失败，请稍后重试" };
    await credentialStore.remove();
    snapshot = emptySnapshot();
    return { ok: true, message: "已退出登录" };
  }

  return {
    requestOtp,
    verifyOtp,
    restore,
    refresh,
    signOut,
    getSnapshot: () => snapshot,
    getClient: () => client,
  };
}
