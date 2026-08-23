const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DeviceKeyPair {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

export interface EncryptedPayload {
  nonce: string;
  ciphertext: string;
}

export async function generateP256KeyPair(): Promise<DeviceKeyPair> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const nonExportablePrivateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );

  return {
    privateKey: nonExportablePrivateKey,
    publicKey: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

export async function deriveAesSessionKey(
  privateKey: CryptoKey,
  peerPublicKey: JsonWebKey,
): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    peerPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("codex-remote/protocol-v1"),
      info: encoder.encode("device-session/aes-256-gcm"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  additionalData: string,
): Promise<EncryptedPayload> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonceBytes,
      additionalData: encoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return {
    nonce: bytesToBase64Url(nonceBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson<T>(
  key: CryptoKey,
  payload: EncryptedPayload,
  additionalData: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(payload.nonce) as unknown as BufferSource,
      additionalData: encoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    base64UrlToBytes(payload.ciphertext) as unknown as BufferSource,
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
