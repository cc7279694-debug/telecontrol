import { generateKeyPairSync } from "node:crypto";
import type { CredentialStore } from "./credential-store.js";

export type HostKeyPair = {
  privateKeyJwk: {
    kty: string;
    crv: string;
    x: string;
    y: string;
    d: string;
  };
  publicKeyJwk: {
    kty: string;
    crv: string;
    x: string;
    y: string;
  };
};

function publicKeyFromPrivate(
  privateKeyJwk: HostKeyPair["privateKeyJwk"],
): HostKeyPair["publicKeyJwk"] {
  return {
    kty: privateKeyJwk.kty,
    crv: privateKeyJwk.crv,
    x: privateKeyJwk.x,
    y: privateKeyJwk.y,
  };
}

function generateHostKeyPair(): HostKeyPair {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const exported = privateKey.export({ format: "jwk" }) as JsonWebKey;
  if (
    exported.kty !== "EC" ||
    exported.crv !== "P-256" ||
    typeof exported.x !== "string" ||
    typeof exported.y !== "string" ||
    typeof exported.d !== "string"
  ) {
    throw new Error("无法生成 P-256 Host 密钥");
  }

  const privateKeyJwk = {
    kty: "EC",
    crv: "P-256",
    x: exported.x,
    y: exported.y,
    d: exported.d,
  };
  return { privateKeyJwk, publicKeyJwk: publicKeyFromPrivate(privateKeyJwk) };
}

export function createHostKeyManager({
  credentialStore,
}: {
  credentialStore: Pick<CredentialStore, "read">;
}) {
  let cached: HostKeyPair | undefined;

  async function getOrCreate() {
    if (cached) {
      return cached;
    }

    const credentials = await credentialStore.read();
    if (credentials) {
      cached = {
        privateKeyJwk: credentials.hostPrivateKeyJwk,
        publicKeyJwk: publicKeyFromPrivate(credentials.hostPrivateKeyJwk),
      };
      return cached;
    }

    cached = generateHostKeyPair();
    return cached;
  }

  return { getOrCreate };
}
