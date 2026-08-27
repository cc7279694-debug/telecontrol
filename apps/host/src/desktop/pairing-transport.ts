import { randomInt } from "node:crypto";
import { hashPairingCode } from "@codex-remote/protocol";
import type { PairingTransport } from "./pairing-controller.js";

type PairingRpcClient = {
  rpc: <T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: T | null; error: { message?: string } | null }>;
};

export function createSupabasePairingTransport({
  client,
  getHostId,
  isSessionReady,
}: {
  client: PairingRpcClient;
  getHostId: () => string | null;
  isSessionReady: () => boolean;
}): PairingTransport {
  return {
    isReady: () => isSessionReady() && getHostId() !== null,
    createPairingRequest: async () => {
      const hostId = getHostId();
      if (!hostId || !isSessionReady()) {
        throw new Error("Pairing transport is unavailable");
      }
      return createSupabasePairingRequest({ client, hostId });
    },
  };
}

export async function createSupabasePairingRequest({
  client,
  hostId,
}: {
  client: PairingRpcClient;
  hostId: string;
}) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const response = await client.rpc<string>("create_pairing_request", {
    p_host_id: hostId,
    p_code_hash: await hashPairingCode(code),
    p_expires_at: expiresAt,
  });
  if (response.error || !response.data) {
    throw new Error(
      response.error?.message ?? "Failed to create pairing request",
    );
  }
  return { pairingId: response.data, code, expiresAt };
}
