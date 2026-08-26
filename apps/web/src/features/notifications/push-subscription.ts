export interface ParsedPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expiresAt: string | null;
}

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_KEY_LENGTH = 512;

export function parsePushSubscription(input: unknown): ParsedPushSubscription {
  if (!isRecord(input) || typeof input.endpoint !== "string") {
    throw new Error("订阅信息无效");
  }

  const endpoint = input.endpoint.trim();
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("订阅地址无效");
  }
  if (
    parsedEndpoint.protocol !== "https:" ||
    endpoint.length === 0 ||
    endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error("订阅地址无效");
  }

  const keys = input.keys;
  if (!isRecord(keys)) throw new Error("订阅密钥无效");
  const p256dh = readBoundedString(keys.p256dh, MAX_KEY_LENGTH);
  const auth = readBoundedString(keys.auth, MAX_KEY_LENGTH);
  const expiresAt = readExpiration(input.expirationTime);
  return { endpoint, p256dh, auth, expiresAt };
}

function readBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("订阅密钥无效");
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new Error("订阅密钥无效");
  }
  return result;
}

function readExpiration(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("订阅有效期无效");
  }
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
