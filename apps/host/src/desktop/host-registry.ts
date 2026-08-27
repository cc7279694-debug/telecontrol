import type { HostKeyPair } from "./host-key-manager.js";

type HostRow = {
  id: string;
  name: string;
  public_key: string;
  version?: string | null;
  protocol_version: number;
  revoked_at?: string | null;
};

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  is: (column: string, value: null) => Query;
  limit: (count: number) => Promise<{ data: HostRow[] | null; error: unknown }>;
  update: (values: Record<string, unknown>) => Query;
  insert: (values: Record<string, unknown>) => Query;
  single: () => Promise<{ data: HostRow | null; error: unknown }>;
};

type RegistryClient = { from: (table: "hosts") => unknown };

export type RegisteredHost = {
  id: string;
  name: string;
  publicKey: {
    kty: "EC";
    crv: "P-256";
    x: string;
    y: string;
  };
  protocolVersion: number;
};

export type HostRegistryErrorCode =
  | "HOST_QUERY_FAILED"
  | "HOST_MULTIPLE_ACTIVE"
  | "HOST_KEY_MISMATCH"
  | "HOST_PROTOCOL_MISMATCH"
  | "HOST_WRITE_FAILED";

export class HostRegistryError extends Error {
  constructor(readonly code: HostRegistryErrorCode) {
    super(
      {
        HOST_QUERY_FAILED: "无法读取 Host 注册状态",
        HOST_MULTIPLE_ACTIVE: "账号下存在多个活动 Host，请先撤销旧 Host",
        HOST_KEY_MISMATCH: "本机 Host 密钥与云端记录不一致",
        HOST_PROTOCOL_MISMATCH: "Host 协议版本不匹配",
        HOST_WRITE_FAILED: "无法保存 Host 注册状态",
      }[code],
    );
    this.name = "HostRegistryError";
  }
}

function parsePublicKey(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.kty !== "EC" ||
      parsed.crv !== "P-256" ||
      typeof parsed.x !== "string" ||
      typeof parsed.y !== "string"
    ) {
      return null;
    }
    return {
      kty: "EC" as const,
      crv: "P-256" as const,
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return null;
  }
}

function toRegisteredHost(row: HostRow): RegisteredHost {
  const publicKey = parsePublicKey(row.public_key);
  if (!publicKey) {
    throw new HostRegistryError("HOST_KEY_MISMATCH");
  }
  return {
    id: row.id,
    name: row.name,
    publicKey,
    protocolVersion: row.protocol_version,
  };
}

export function createHostRegistry({
  client,
  hostKeyManager,
  hostName,
  version,
  protocolVersion,
}: {
  client: RegistryClient;
  hostKeyManager: Pick<
    { getOrCreate: () => Promise<HostKeyPair> },
    "getOrCreate"
  >;
  hostName: string;
  version: string;
  protocolVersion: 1;
}) {
  async function ensureRegistered({
    ownerId,
    authSessionId,
  }: {
    ownerId: string;
    authSessionId: string;
  }) {
    const keyPair = await hostKeyManager.getOrCreate();
    const query = (client.from("hosts") as Query)
      .select("id,name,public_key,version,protocol_version,revoked_at")
      .eq("owner_id", ownerId)
      .is("revoked_at", null);
    const listed = await query.limit(2);
    if (listed.error) {
      throw new HostRegistryError("HOST_QUERY_FAILED");
    }
    const rows = listed.data ?? [];
    if (rows.length > 1) {
      throw new HostRegistryError("HOST_MULTIPLE_ACTIVE");
    }

    const existing = rows[0];
    if (existing) {
      if (existing.protocol_version !== protocolVersion) {
        throw new HostRegistryError("HOST_PROTOCOL_MISMATCH");
      }
      const existingKey = parsePublicKey(existing.public_key);
      if (
        !existingKey ||
        existingKey.x !== keyPair.publicKeyJwk.x ||
        existingKey.y !== keyPair.publicKeyJwk.y
      ) {
        throw new HostRegistryError("HOST_KEY_MISMATCH");
      }
      const updated = await query
        .update({ auth_session_id: authSessionId, version })
        .eq("id", existing.id);
      if (updated && "error" in updated && updated.error) {
        throw new HostRegistryError("HOST_WRITE_FAILED");
      }
      return toRegisteredHost(existing);
    }

    const inserted = await (client.from("hosts") as Query)
      .insert({
        owner_id: ownerId,
        auth_session_id: authSessionId,
        name: hostName,
        public_key: JSON.stringify(keyPair.publicKeyJwk),
        version,
        protocol_version: protocolVersion,
      })
      .select("id,name,public_key,version,protocol_version,revoked_at")
      .single();
    if (inserted.error || !inserted.data) {
      throw new HostRegistryError("HOST_WRITE_FAILED");
    }
    return toRegisteredHost(inserted.data);
  }

  return { ensureRegistered };
}
