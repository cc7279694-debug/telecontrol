import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface LocalSupabaseEnv {
  apiUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  mailUrl: string;
}

export interface DisposableAuthUser {
  email: string;
  userId: string;
  admin: SupabaseClient;
  remove: () => Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function loadLocalSupabaseEnv(): LocalSupabaseEnv | null {
  let output: string;
  try {
    output = execFileSync("supabase.cmd", ["status", "-o", "env"], {
      cwd: process.cwd().split(`${String.raw`apps\web`}`)[0],
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }

  const values = parseEnvOutput(output);
  const apiUrl = values.API_URL ?? values.SUPABASE_URL;
  const publishableKey = values.ANON_KEY ?? values.PUBLISHABLE_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  const mailUrl =
    values.INBUCKET_URL ?? values.MAILPIT_URL ?? "http://127.0.0.1:54324";
  if (!apiUrl || !publishableKey || !serviceRoleKey || !mailUrl) {
    return null;
  }
  if (![apiUrl, mailUrl].every(isLoopbackUrl)) {
    return null;
  }
  return { apiUrl, publishableKey, serviceRoleKey, mailUrl };
}

export function createLocalAdmin(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createDisposableAuthUser(
  env: LocalSupabaseEnv,
): Promise<DisposableAuthUser> {
  const admin = createLocalAdmin(env);
  const email = `codex-remote-e2e-${Date.now()}@example.test`;
  const response = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (response.error || !response.data.user) {
    throw new Error("本地验收账号创建失败");
  }
  const userId = response.data.user.id;
  return {
    email,
    userId,
    admin,
    remove: async () => {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

export async function waitForEmailOtp(
  env: LocalSupabaseEnv,
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await findLatestMessage(env.mailUrl, email);
    const code = message?.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("本地验证码读取超时");
}

async function findLatestMessage(
  mailUrl: string,
  email: string,
): Promise<string | null> {
  const encoded = encodeURIComponent(email);
  try {
    const mailbox = await fetch(`${mailUrl}/api/v1/mailbox/${encoded}`);
    if (mailbox.ok) {
      const payload = (await mailbox.json()) as Array<{ body?: string }>;
      return payload[0]?.body ?? null;
    }
    const search = await fetch(
      `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (!search.ok) return null;
    const result = (await search.json()) as {
      messages?: Array<{ ID?: string; id?: string }>;
    };
    const id = result.messages?.[0]?.ID ?? result.messages?.[0]?.id;
    if (!id) return null;
    const message = await fetch(`${mailUrl}/api/v1/message/${id}`);
    if (!message.ok) return null;
    const detail = (await message.json()) as { Text?: string; body?: string };
    return detail.Text ?? detail.body ?? null;
  } catch {
    return null;
  }
}

function parseEnvOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return values;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}
