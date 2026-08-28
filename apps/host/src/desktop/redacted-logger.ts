import {
  appendFile,
  mkdir,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const SafeLogRecordSchema = z
  .object({
    timestamp: z.string().datetime(),
    level: z.enum(["info", "warning", "error"]),
    event: z.string().max(100),
    result: z.enum(["started", "succeeded", "failed", "ignored"]),
    errorCode: z.string().max(100).optional(),
    protocolVersion: z.number().int().optional(),
    appVersion: z.string().max(50).optional(),
    hostIdSuffix: z.string().max(12).optional(),
    workspaceId: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
  })
  .strict();

export type SafeLogRecord = z.infer<typeof SafeLogRecordSchema>;

type LogDetails = Pick<
  SafeLogRecord,
  | "errorCode"
  | "protocolVersion"
  | "appVersion"
  | "hostIdSuffix"
  | "workspaceId"
  | "messageId"
> & { result?: SafeLogRecord["result"] };

export type RedactedLogger = {
  write: (record: SafeLogRecord) => Promise<void>;
  cleanup: () => Promise<void>;
  info: (event: string, details?: LogDetails) => void;
  warn: (event: string, details?: LogDetails) => void;
  error: (event: string, details?: LogDetails) => void;
};

const maxFileBytes = 2 * 1024 * 1024;
const maxFiles = 5;
const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
const safeFilePattern = /^host(?:\.[1-4])?\.jsonl$/;

export function createRedactedLogger({
  directory,
  appVersion,
  now = () => Date.now(),
}: {
  directory: string;
  appVersion: string;
  now?: () => number;
}): RedactedLogger {
  const baseDirectory = path.resolve(directory);
  const filePath = path.join(baseDirectory, "host.jsonl");
  let resolvedDirectoryPromise: Promise<string> | undefined;

  async function getResolvedDirectory() {
    if (!resolvedDirectoryPromise) {
      resolvedDirectoryPromise = (async () => {
        await mkdir(baseDirectory, { recursive: true });
        return realpath(baseDirectory);
      })();
    }
    return resolvedDirectoryPromise;
  }

  function assertDirectLogPath(candidate: string, resolvedDirectory: string) {
    if (path.dirname(path.resolve(candidate)) !== resolvedDirectory) {
      throw new Error("日志路径不在日志目录内");
    }
  }

  async function cleanup() {
    try {
      const resolvedDirectory = await getResolvedDirectory();
      const names = await readdir(resolvedDirectory);
      for (const name of names) {
        if (!safeFilePattern.test(name)) continue;
        const candidate = path.join(resolvedDirectory, name);
        assertDirectLogPath(candidate, resolvedDirectory);
        try {
          const details = await stat(candidate);
          if (now() - details.mtimeMs > maxAgeMs) await unlink(candidate);
        } catch {
          // A concurrent cleanup or rotation is harmless.
        }
      }
    } catch {
      // Diagnostics must never terminate the Host.
    }
  }

  async function rotateIfNeeded(payload: string, resolvedDirectory: string) {
    assertDirectLogPath(filePath, resolvedDirectory);
    let currentSize = 0;
    try {
      currentSize = (await stat(filePath)).size;
    } catch {
      return;
    }
    if (currentSize + Buffer.byteLength(payload, "utf8") <= maxFileBytes)
      return;

    const oldest = path.join(resolvedDirectory, `host.${maxFiles - 1}.jsonl`);
    assertDirectLogPath(oldest, resolvedDirectory);
    await unlink(oldest).catch(() => undefined);
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      const from = path.join(resolvedDirectory, `host.${index}.jsonl`);
      const to = path.join(resolvedDirectory, `host.${index + 1}.jsonl`);
      assertDirectLogPath(from, resolvedDirectory);
      assertDirectLogPath(to, resolvedDirectory);
      await rename(from, to).catch(() => undefined);
    }
    const firstRotation = path.join(resolvedDirectory, "host.1.jsonl");
    assertDirectLogPath(firstRotation, resolvedDirectory);
    await rename(filePath, firstRotation).catch(() => undefined);
  }

  async function write(record: SafeLogRecord) {
    try {
      const validated = SafeLogRecordSchema.parse(record);
      const resolvedDirectory = await getResolvedDirectory();
      const payload = `${JSON.stringify(validated)}\n`;
      await rotateIfNeeded(payload, resolvedDirectory);
      await appendFile(filePath, payload, { encoding: "utf8", mode: 0o600 });
      await cleanup();
    } catch {
      // Logging is deliberately best effort and never part of Host control flow.
    }
  }

  function record(
    level: SafeLogRecord["level"],
    event: string,
    details: LogDetails = {},
  ) {
    void write({
      timestamp: new Date(now()).toISOString(),
      level,
      event,
      result: details.result ?? (level === "error" ? "failed" : "succeeded"),
      appVersion,
      ...(details.errorCode ? { errorCode: details.errorCode } : {}),
      ...(details.protocolVersion
        ? { protocolVersion: details.protocolVersion }
        : {}),
      ...(details.hostIdSuffix ? { hostIdSuffix: details.hostIdSuffix } : {}),
      ...(details.workspaceId ? { workspaceId: details.workspaceId } : {}),
      ...(details.messageId ? { messageId: details.messageId } : {}),
    });
  }

  return {
    write,
    cleanup,
    info: (event, details) => record("info", event, details),
    warn: (event, details) => record("warning", event, details),
    error: (event, details) => record("error", event, details),
  };
}
