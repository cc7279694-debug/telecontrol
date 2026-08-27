import { randomInt } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import path from "node:path";

const resetTargetNames = [
  "config.v1.json",
  "credentials.v1.bin",
  "thread-state.v1.json",
  "idempotency.v1.json",
  "logs",
] as const;

const defaultPhraseParts = [
  "确认",
  "删除",
  "本机",
  "数据",
  "现在",
  "继续",
] as const;

type ResetFileSystem = {
  realpath: (filePath: string) => Promise<string>;
  remove: (
    filePath: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
};

export type DataResetErrorCode = "RESET_TARGET_UNSAFE" | "RESET_FAILED";

export class DataResetError extends Error {
  constructor(readonly code: DataResetErrorCode) {
    super(
      code === "RESET_TARGET_UNSAFE"
        ? "本机数据位置校验失败，未执行删除"
        : "本机数据删除失败，请稍后重试",
    );
    this.name = "DataResetError";
  }
}

const defaultFileSystem: ResetFileSystem = {
  realpath,
  remove: rm,
};

function createDefaultPhrase() {
  const parts = Array.from(
    { length: 3 },
    () => defaultPhraseParts[randomInt(defaultPhraseParts.length)],
  );
  return `${parts.join("")}-${String(randomInt(10_000)).padStart(4, "0")}`;
}

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createDataResetController({
  userDataDir,
  fileSystem = defaultFileSystem,
  now = () => Date.now(),
  createPhrase = createDefaultPhrase,
  ttlMs = 5 * 60 * 1_000,
}: {
  userDataDir: string;
  fileSystem?: ResetFileSystem;
  now?: () => number;
  createPhrase?: () => string;
  ttlMs?: number;
}) {
  const resolvedUserDataDir = path.resolve(userDataDir);
  let pending: { phrase: string; expiresAt: number } | undefined;

  function begin() {
    const phrase = createPhrase();
    pending = { phrase, expiresAt: now() + ttlMs };
    return { phrase };
  }

  async function resolveApprovedTargets() {
    const approvedTargets: Array<{ path: string; recursive: boolean }> = [];

    for (const targetName of resetTargetNames) {
      const targetPath = path.resolve(resolvedUserDataDir, targetName);
      if (
        path.dirname(targetPath) !== resolvedUserDataDir ||
        path.basename(targetPath) !== targetName
      ) {
        throw new DataResetError("RESET_TARGET_UNSAFE");
      }

      let realTargetPath: string;
      try {
        realTargetPath = await fileSystem.realpath(targetPath);
      } catch (error) {
        if (isMissingFile(error)) {
          continue;
        }
        throw new DataResetError("RESET_TARGET_UNSAFE");
      }

      if (
        path.dirname(realTargetPath) !== resolvedUserDataDir ||
        path.basename(realTargetPath) !== targetName
      ) {
        throw new DataResetError("RESET_TARGET_UNSAFE");
      }

      approvedTargets.push({
        path: targetPath,
        recursive: targetName === "logs",
      });
    }

    return approvedTargets;
  }

  async function confirm({ phrase }: { phrase: string }) {
    if (!pending || pending.phrase !== phrase) {
      return { ok: false, message: "确认短语不正确" } as const;
    }
    if (now() >= pending.expiresAt) {
      pending = undefined;
      return { ok: false, message: "确认短语已过期" } as const;
    }

    try {
      const approvedTargets = await resolveApprovedTargets();
      pending = undefined;
      for (const target of approvedTargets) {
        await fileSystem.remove(target.path, {
          recursive: target.recursive,
          force: true,
        });
      }
      return { ok: true, message: "本机数据已删除" } as const;
    } catch (error) {
      if (error instanceof DataResetError) {
        pending = undefined;
        return { ok: false, message: error.message } as const;
      }
      pending = undefined;
      return { ok: false, message: "本机数据删除失败，请稍后重试" } as const;
    }
  }

  return { begin, confirm };
}

export type DataResetController = ReturnType<typeof createDataResetController>;
