import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const WorkspaceConfigSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(32_767),
  })
  .strict();

const DoctorSummarySchema = z
  .object({
    status: z.enum(["passed", "warning", "failed"]),
    checkedAt: z.string().datetime({ offset: true }),
    passed: z.number().int().nonnegative().max(100),
    warnings: z.number().int().nonnegative().max(100),
    failed: z.number().int().nonnegative().max(100),
  })
  .strict();

export const HostConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    host: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        publicKey: z.string().trim().min(1).max(4_096),
        protocolVersion: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    workspaces: z.array(WorkspaceConfigSchema).max(100),
    openAtLogin: z.boolean(),
    installedVersion: z.string().trim().min(1).max(64),
    doctorSummary: DoctorSummarySchema.nullable(),
  })
  .strict();

export type HostConfig = z.infer<typeof HostConfigSchema>;

export type ConfigFileSystem = {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
  syncFile?: (filePath: string) => Promise<void>;
};

export type ConfigStoreErrorCode =
  "UNSUPPORTED_CONFIG_VERSION" | "INVALID_CONFIG" | "CONFIG_IO_FAILED";

export class ConfigStoreError extends Error {
  constructor(readonly code: ConfigStoreErrorCode) {
    super(
      {
        UNSUPPORTED_CONFIG_VERSION: "本地配置版本过新，无法安全读取",
        INVALID_CONFIG: "本地配置格式无效",
        CONFIG_IO_FAILED: "本地配置文件无法访问",
      }[code],
    );
    this.name = "ConfigStoreError";
  }
}

const defaultFileSystem: ConfigFileSystem = {
  readFile: (filePath) => readFile(filePath, "utf8"),
  writeFile: (filePath, data) => writeFile(filePath, data, "utf8"),
  rename,
  unlink,
  syncFile: async (filePath) => {
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function validateWorkspacePath(workspacePath: string) {
  if (workspacePath.includes("\0")) {
    return false;
  }

  const normalizedPath = path.win32.normalize(workspacePath.trim());
  if (!path.win32.isAbsolute(normalizedPath)) {
    return false;
  }

  return path.win32.parse(normalizedPath).root !== normalizedPath;
}

function normalizedWorkspacePath(workspacePath: string) {
  const normalizedPath = path.win32.normalize(workspacePath.trim());
  return normalizedPath.replace(/[\\/]+$/, "").toLowerCase();
}

function parseConfig(raw: unknown): HostConfig {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    typeof raw.schemaVersion === "number" &&
    raw.schemaVersion > 1
  ) {
    throw new ConfigStoreError("UNSUPPORTED_CONFIG_VERSION");
  }

  const result = HostConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigStoreError("INVALID_CONFIG");
  }

  const workspaceIds = new Set<string>();
  const workspacePaths = new Set<string>();
  for (const workspace of result.data.workspaces) {
    if (!validateWorkspacePath(workspace.path)) {
      throw new ConfigStoreError("INVALID_CONFIG");
    }

    const normalizedPath = normalizedWorkspacePath(workspace.path);
    if (workspaceIds.has(workspace.id) || workspacePaths.has(normalizedPath)) {
      throw new ConfigStoreError("INVALID_CONFIG");
    }
    workspaceIds.add(workspace.id);
    workspacePaths.add(normalizedPath);
  }

  return result.data;
}

export function createConfigStore({
  filePath,
  fileSystem = defaultFileSystem,
}: {
  filePath: string;
  fileSystem?: ConfigFileSystem;
}) {
  async function write(config: HostConfig) {
    const validatedConfig = parseConfig(config);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(validatedConfig, null, 2)}\n`;

    try {
      await fileSystem.writeFile(temporaryPath, serialized);
      await fileSystem.syncFile?.(temporaryPath);
      await fileSystem.rename(temporaryPath, filePath);
    } catch {
      await fileSystem.unlink(temporaryPath).catch(() => undefined);
      throw new ConfigStoreError("CONFIG_IO_FAILED");
    }
  }

  async function read() {
    let serialized: string;
    try {
      serialized = await fileSystem.readFile(filePath);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw new ConfigStoreError("CONFIG_IO_FAILED");
    }

    try {
      return parseConfig(JSON.parse(serialized) as unknown);
    } catch (error) {
      if (error instanceof ConfigStoreError) {
        throw error;
      }
      throw new ConfigStoreError("INVALID_CONFIG");
    }
  }

  return { read, write };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;
