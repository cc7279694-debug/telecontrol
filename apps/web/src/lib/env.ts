export interface PublicEnvSource {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  [key: string]: string | undefined;
}

export interface PublicEnv {
  supabaseUrl: string;
  publishableKey: string;
}

export function getPublicEnv(source: PublicEnvSource = process.env): PublicEnv {
  if (
    Object.keys(source).some(
      (key) => key.startsWith("NEXT_PUBLIC_") && /service|secret/i.test(key),
    )
  ) {
    throw new Error("浏览器配置包含服务端密钥");
  }
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) {
    throw new Error("缺少 Supabase 公共配置");
  }
  return { supabaseUrl, publishableKey };
}
