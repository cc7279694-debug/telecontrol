// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { generateP256KeyPair } from "@codex-remote/protocol";

import { DeviceIdentityStore } from "./device-key-store";

describe("DeviceIdentityStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a non-exportable private CryptoKey by owner", async () => {
    const store = new DeviceIdentityStore();
    const keyPair = await generateP256KeyPair();
    const identity = {
      ownerId: "owner-1",
      deviceId: "device-1",
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    };

    await store.save(identity);
    const loaded = await store.load("owner-1");

    expect(loaded?.deviceId).toBe("device-1");
    expect(loaded?.privateKey).not.toBe(keyPair.privateKey);
    expect(loaded?.privateKey.extractable).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("does not cross owner boundaries and clears an identity explicitly", async () => {
    const store = new DeviceIdentityStore();
    const keyPair = await generateP256KeyPair();
    await store.save({
      ownerId: "owner-1",
      deviceId: "device-1",
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    });

    await expect(store.load("owner-2")).resolves.toBeNull();
    await store.clear("owner-1");
    await expect(store.load("owner-1")).resolves.toBeNull();
  });
});
