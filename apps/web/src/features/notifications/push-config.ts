export interface PushConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export function getPushConfig(
  source: Record<string, string | undefined> = process.env,
): PushConfig | null {
  const subject = source.WEB_PUSH_VAPID_SUBJECT?.trim();
  const publicKey = source.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = source.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}
