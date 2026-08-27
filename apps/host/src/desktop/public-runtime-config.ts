export type PublicRuntimeConfig = {
  supabaseUrl: string;
  publishableKey: string;
  webOrigin: string;
  protocolVersion: 1;
};

export class PublicRuntimeConfigError extends Error {
  constructor(message = "Host 公共配置无效") {
    super(message);
    this.name = "PublicRuntimeConfigError";
  }
}

type RuntimeSource = Record<string, string | undefined>;

const privateFieldPattern =
  /(service[_-]?role|secret|database|vapid[_-]?private)/i;

function readRequired(source: RuntimeSource, name: string) {
  const value = source[name]?.trim();
  if (!value) {
    throw new PublicRuntimeConfigError(`缺少公共配置：${name}`);
  }
  return value;
}

function parsePublicUrl(value: string, fieldName: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicRuntimeConfigError(`${fieldName} 不是有效网址`);
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  const allowedProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && isLoopback);

  if (
    !allowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new PublicRuntimeConfigError(`${fieldName} 必须使用安全的公共网址`);
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

export function loadPublicRuntimeConfig({
  source = process.env,
}: {
  source?: RuntimeSource;
} = {}): PublicRuntimeConfig {
  for (const [name, value] of Object.entries(source)) {
    if (
      value &&
      name.startsWith("CODEX_REMOTE_") &&
      privateFieldPattern.test(name)
    ) {
      throw new PublicRuntimeConfigError(`禁止把私密配置放入 Host：${name}`);
    }
  }

  const supabaseUrl = parsePublicUrl(
    readRequired(source, "CODEX_REMOTE_SUPABASE_URL"),
    "Supabase 地址",
  );
  const publishableKey = readRequired(
    source,
    "CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY",
  );
  if (
    /^(sb_secret_|service_role)/i.test(publishableKey) ||
    /secret|service[_-]?role/i.test(publishableKey)
  ) {
    throw new PublicRuntimeConfigError("Supabase 配置必须是公开密钥");
  }

  const webOrigin = parsePublicUrl(
    readRequired(source, "CODEX_REMOTE_WEB_ORIGIN"),
    "Web 地址",
  );
  const protocolVersion = readRequired(source, "CODEX_REMOTE_PROTOCOL_VERSION");
  if (protocolVersion !== "1") {
    throw new PublicRuntimeConfigError("协议版本不受支持");
  }

  return {
    supabaseUrl,
    publishableKey,
    webOrigin,
    protocolVersion: 1,
  };
}
