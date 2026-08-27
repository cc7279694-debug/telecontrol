import { describe, expect, it, vi } from "vitest";
import {
  createCredentialStore,
  type CredentialPayload,
} from "./credential-store.js";

const payload: CredentialPayload = {
  schemaVersion: 1,
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  hostPrivateKeyJwk: {
    kty: "EC",
    crv: "P-256",
    x: "public-x",
    y: "public-y",
    d: "private-d",
  },
  updatedAt: "2026-08-27T00:00:00.000Z",
};

class MemoryCredentialFileSystem {
  readonly files = new Map<string, Buffer>();
  readonly writes: Array<{ path: string; data: Buffer }> = [];
  readonly renames: Array<{ from: string; to: string }> = [];
  failRead = false;

  async readFile(filePath: string) {
    if (this.failRead) {
      throw new Error("disk read failed");
    }

    const data = this.files.get(filePath);
    if (!data) {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return Buffer.from(data);
  }

  async writeFile(filePath: string, data: Buffer) {
    this.writes.push({ path: filePath, data: Buffer.from(data) });
    this.files.set(filePath, Buffer.from(data));
  }

  async rename(from: string, to: string) {
    const data = this.files.get(from);
    if (!data) throw new Error("temporary file missing");
    this.files.set(to, data);
    this.files.delete(from);
    this.renames.push({ from, to });
  }

  async unlink(filePath: string) {
    this.files.delete(filePath);
  }
}

function createSafeStorage() {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (plainText: string) =>
      Buffer.from(
        `encrypted:${Buffer.from(plainText, "utf8").toString("base64")}`,
        "utf8",
      ),
    ),
    decryptStringAsync: vi.fn(async (encrypted: Buffer) => ({
      result: Buffer.from(
        encrypted.toString("utf8").replace(/^encrypted:/, ""),
        "base64",
      ).toString("utf8"),
      shouldReEncrypt: false,
    })),
  };
}

function createStore(
  fileSystem: MemoryCredentialFileSystem,
  safeStorage = createSafeStorage(),
) {
  return createCredentialStore({
    filePath:
      "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\credentials.v1.bin",
    fileSystem,
    safeStorage,
  });
}

describe("credential store", () => {
  it("writes and reads only encrypted credential bytes", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    const store = createStore(fileSystem);

    await store.write(payload);
    await expect(store.read()).resolves.toEqual(payload);

    expect(fileSystem.writes).toHaveLength(1);
    expect(fileSystem.writes[0]?.data.toString("utf8")).not.toContain(
      payload.accessToken,
    );
    expect(fileSystem.writes[0]?.data.toString("utf8")).not.toContain(
      payload.hostPrivateKeyJwk.d,
    );
    expect(fileSystem.renames[0]?.to).toContain("credentials.v1.bin");
  });

  it("updates the existing encrypted record", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    const store = createStore(fileSystem);
    const updated = { ...payload, accessToken: "updated-access-token" };

    await store.write(payload);
    await store.write(updated);

    await expect(store.read()).resolves.toEqual(updated);
    expect(fileSystem.writes).toHaveLength(2);
  });

  it("returns null when the credential file is missing", async () => {
    const store = createStore(new MemoryCredentialFileSystem());

    await expect(store.read()).resolves.toBeNull();
  });

  it("fails closed when encryption is unavailable", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    const safeStorage = createSafeStorage();
    safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const store = createStore(fileSystem, safeStorage);

    await expect(store.write(payload)).rejects.toMatchObject({
      code: "SAFE_STORAGE_UNAVAILABLE",
    });
    expect(fileSystem.writes).toHaveLength(0);
  });

  it("hides decryption and schema errors without echoing plaintext", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    fileSystem.files.set("C:\\credentials.v1.bin", Buffer.from("corrupted"));
    const safeStorage = createSafeStorage();
    safeStorage.decryptStringAsync.mockRejectedValue(
      new Error(payload.accessToken),
    );
    const store = createCredentialStore({
      filePath: "C:\\credentials.v1.bin",
      fileSystem,
      safeStorage,
    });

    await expect(store.read()).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof Error &&
        "code" in error &&
        error.code === "CREDENTIALS_CORRUPTED" &&
        !error.message.includes(payload.accessToken)
      );
    });
  });

  it("re-encrypts a valid payload after safe-storage key rotation", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    const safeStorage = createSafeStorage();
    safeStorage.decryptStringAsync.mockResolvedValue({
      result: JSON.stringify(payload),
      shouldReEncrypt: true,
    });
    const store = createStore(fileSystem, safeStorage);
    fileSystem.files.set(
      "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\credentials.v1.bin",
      Buffer.from("old"),
    );

    await expect(store.read()).resolves.toEqual(payload);
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledOnce();
  });

  it("rejects a decrypted payload with an invalid schema", async () => {
    const fileSystem = new MemoryCredentialFileSystem();
    const safeStorage = createSafeStorage();
    safeStorage.decryptStringAsync.mockResolvedValue({
      result: JSON.stringify({
        ...payload,
        hostPrivateKeyJwk: { d: "private-d" },
      }),
      shouldReEncrypt: false,
    });
    const store = createStore(fileSystem, safeStorage);
    fileSystem.files.set(
      "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\credentials.v1.bin",
      Buffer.from("invalid-encrypted-record"),
    );

    await expect(store.read()).rejects.toMatchObject({
      code: "CREDENTIALS_CORRUPTED",
    });
  });
});
