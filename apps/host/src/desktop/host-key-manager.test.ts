import { describe, expect, it, vi } from "vitest";
import type { CredentialPayload } from "./credential-store.js";
import { createHostKeyManager } from "./host-key-manager.js";

const payload: CredentialPayload = {
  schemaVersion: 1,
  accessToken: "access-token",
  refreshToken: "refresh-token",
  hostPrivateKeyJwk: {
    kty: "EC",
    crv: "P-256",
    x: "public-x",
    y: "public-y",
    d: "private-d",
  },
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("host key manager", () => {
  it("generates a P-256 key and reuses the persisted private key", async () => {
    const credentialStore = {
      read: vi.fn(async () => null),
    };
    const manager = createHostKeyManager({ credentialStore });

    const first = await manager.getOrCreate();
    const second = await manager.getOrCreate();

    expect(first.privateKeyJwk.kty).toBe("EC");
    expect(first.privateKeyJwk.crv).toBe("P-256");
    expect(first.privateKeyJwk.d).toBeTruthy();
    expect(first.publicKeyJwk).toMatchObject({
      kty: "EC",
      crv: "P-256",
      x: first.privateKeyJwk.x,
      y: first.privateKeyJwk.y,
    });
    expect(second).toEqual(first);
  });

  it("loads the private key from encrypted credentials", async () => {
    const manager = createHostKeyManager({
      credentialStore: { read: vi.fn(async () => payload) },
    });

    await expect(manager.getOrCreate()).resolves.toEqual({
      privateKeyJwk: payload.hostPrivateKeyJwk,
      publicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
      },
    });
  });
});
