import { describe, expect, it } from "vitest";
import {
  deriveAesSessionKey,
  generateP256KeyPair,
  openRemotePayload,
  sealRemotePayload,
} from "./index.js";

async function createSessionKey(): Promise<CryptoKey> {
  const host = await generateP256KeyPair();
  const device = await generateP256KeyPair();
  return deriveAesSessionKey(host.privateKey, device.publicKey);
}

describe("sealed remote payloads", () => {
  it("round-trips a command through a browser-safe protocol import", async () => {
    const key = await createSessionKey();
    const command = {
      type: "thread.list" as const,
      workspaceId: "workspace-1",
    };

    const envelope = await sealRemotePayload({
      key,
      hostId: "host-1",
      deviceId: "device-1",
      payload: command,
      ttlMs: 30_000,
    });

    await expect(openRemotePayload({ key, envelope })).resolves.toEqual(
      command,
    );
  });

  it("rejects a changed host id before accepting the plaintext", async () => {
    const key = await createSessionKey();
    const envelope = await sealRemotePayload({
      key,
      hostId: "host-1",
      deviceId: "device-1",
      payload: { type: "host.snapshot" as const },
      ttlMs: 30_000,
    });

    await expect(
      openRemotePayload({
        key,
        envelope: { ...envelope, hostId: "host-2" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a changed kind before accepting the plaintext", async () => {
    const key = await createSessionKey();
    const envelope = await sealRemotePayload({
      key,
      hostId: "host-1",
      deviceId: "device-1",
      payload: { type: "thread.list" as const, workspaceId: "workspace-1" },
      ttlMs: 30_000,
    });

    await expect(
      openRemotePayload({
        key,
        envelope: { ...envelope, kind: "thread.list.result" },
      }),
    ).rejects.toThrow();
  });

  it("rejects an expired envelope before decrypting it", async () => {
    const key = await createSessionKey();
    const envelope = await sealRemotePayload({
      key,
      hostId: "host-1",
      deviceId: "device-1",
      payload: { type: "host.snapshot" as const },
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });

    await expect(openRemotePayload({ key, envelope })).rejects.toThrow(
      "Remote envelope has expired",
    );
  });
});
