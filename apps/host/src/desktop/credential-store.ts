import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";

const CredentialPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    accessToken: z.string().min(1).max(8_192),
    refreshToken: z.string().min(1).max(8_192),
    hostPrivateKeyJwk: z
      .object({
        kty: z.literal("EC"),
        crv: z.literal("P-256"),
        x: z.string().min(1).max(512),
        y: z.string().min(1).max(512),
        d: z.string().min(1).max(512),
        alg: z.string().max(64).optional(),
        ext: z.boolean().optional(),
        key_ops: z.array(z.string().max(32)).max(8).optional(),
        use: z.string().max(32).optional(),
      })
      .strict(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CredentialPayload = z.infer<typeof CredentialPayloadSchema>;

export type SafeStoragePort = {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (plainText: string) => Promise<Buffer>;
  decryptStringAsync: (
    encrypted: Buffer,
  ) => Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export type CredentialFileSystem = {
  readFile: (filePath: string) => Promise<Buffer>;
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};

export type CredentialStoreErrorCode =
  | "SAFE_STORAGE_UNAVAILABLE"
  | "CREDENTIALS_CORRUPTED"
  | "CREDENTIALS_IO_FAILED"
  | "INVALID_CREDENTIALS";

export class CredentialStoreError extends Error {
  constructor(readonly code: CredentialStoreErrorCode) {
    super(
      {
        SAFE_STORAGE_UNAVAILABLE: "Windows 安全存储不可用",
        CREDENTIALS_CORRUPTED: "本地凭据已损坏或无法解密",
        CREDENTIALS_IO_FAILED: "本地凭据文件无法访问",
        INVALID_CREDENTIALS: "凭据格式无效",
      }[code],
    );
    this.name = "CredentialStoreError";
  }
}

const defaultFileSystem: CredentialFileSystem = {
  readFile: (filePath) => readFile(filePath),
  writeFile: (filePath, data) => writeFile(filePath, data),
  rename,
  unlink,
};

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function parsePayload(raw: unknown) {
  const result = CredentialPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw new CredentialStoreError("CREDENTIALS_CORRUPTED");
  }
  return result.data;
}

export function createCredentialStore({
  filePath,
  safeStorage,
  fileSystem = defaultFileSystem,
}: {
  filePath: string;
  safeStorage: SafeStoragePort;
  fileSystem?: CredentialFileSystem;
}) {
  async function assertEncryptionAvailable() {
    let available = false;
    try {
      available = await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      throw new CredentialStoreError("SAFE_STORAGE_UNAVAILABLE");
    }
    if (!available) {
      throw new CredentialStoreError("SAFE_STORAGE_UNAVAILABLE");
    }
  }

  async function write(payload: CredentialPayload) {
    const parsedPayload = CredentialPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      throw new CredentialStoreError("INVALID_CREDENTIALS");
    }

    await assertEncryptionAvailable();

    let encrypted: Buffer;
    try {
      encrypted = await safeStorage.encryptStringAsync(
        JSON.stringify(parsedPayload.data),
      );
    } catch {
      throw new CredentialStoreError("CREDENTIALS_IO_FAILED");
    }

    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fileSystem.writeFile(temporaryPath, Buffer.from(encrypted));
      await fileSystem.rename(temporaryPath, filePath);
    } catch {
      await fileSystem.unlink(temporaryPath).catch(() => undefined);
      throw new CredentialStoreError("CREDENTIALS_IO_FAILED");
    } finally {
      encrypted.fill(0);
    }
  }

  async function read() {
    let encrypted: Buffer;
    try {
      encrypted = await fileSystem.readFile(filePath);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw new CredentialStoreError("CREDENTIALS_IO_FAILED");
    }

    await assertEncryptionAvailable();

    try {
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const payload = parsePayload(JSON.parse(decrypted.result) as unknown);
      if (decrypted.shouldReEncrypt) {
        await write(payload);
      }
      return payload;
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        throw error;
      }
      throw new CredentialStoreError("CREDENTIALS_CORRUPTED");
    } finally {
      encrypted.fill(0);
    }
  }

  async function remove() {
    await fileSystem.unlink(filePath).catch((error: unknown) => {
      if (!isMissingFile(error)) {
        throw new CredentialStoreError("CREDENTIALS_IO_FAILED");
      }
    });
  }

  return { read, write, remove };
}

export type CredentialStore = ReturnType<typeof createCredentialStore>;
