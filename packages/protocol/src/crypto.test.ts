import { describe, expect, it } from "vitest";
import {
  decryptJson,
  deriveAesSessionKey,
  encryptJson,
  generateP256KeyPair,
  hashPairingCode,
} from "./crypto.js";

describe("device encryption", () => {
  it("hashes pairing codes as lowercase SHA-256 hex", async () => {
    await expect(hashPairingCode("123456")).resolves.toBe(
      "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
    );
  });

  it("derives the same AES key on both devices and round-trips JSON", async () => {
    const alice = await generateP256KeyPair();
    const bob = await generateP256KeyPair();
    expect(alice.privateKey.extractable).toBe(false);
    expect(bob.privateKey.extractable).toBe(false);
    const aliceKey = await deriveAesSessionKey(alice.privateKey, bob.publicKey);
    const bobKey = await deriveAesSessionKey(bob.privateKey, alice.publicKey);

    const encrypted = await encryptJson(
      aliceKey,
      { type: "turn.start", text: "检查状态" },
      "host:host-1",
    );

    await expect(
      decryptJson(bobKey, encrypted, "host:host-1"),
    ).resolves.toEqual({ type: "turn.start", text: "检查状态" });
  });

  it("rejects modified ciphertext and mismatched additional data", async () => {
    const alice = await generateP256KeyPair();
    const bob = await generateP256KeyPair();
    const aliceKey = await deriveAesSessionKey(alice.privateKey, bob.publicKey);
    const bobKey = await deriveAesSessionKey(bob.privateKey, alice.publicKey);
    const encrypted = await encryptJson(aliceKey, { value: 42 }, "device-1");
    const modified = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext[0] === "A" ? "B" : "A"}${encrypted.ciphertext.slice(1)}`,
    };

    await expect(decryptJson(bobKey, modified, "device-1")).rejects.toThrow();
    await expect(decryptJson(bobKey, encrypted, "device-2")).rejects.toThrow();
  });
});
