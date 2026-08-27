import { describe, expect, it, vi } from "vitest";
import { createDataResetController } from "./data-reset.js";

const userDataDir = "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote";

class MemoryResetFileSystem {
  readonly realPaths = new Map<string, string>();
  readonly removed: Array<{ path: string; recursive: boolean }> = [];

  async realpath(filePath: string) {
    const resolved = this.realPaths.get(filePath);
    if (!resolved) {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return resolved;
  }

  async remove(
    filePath: string,
    options: { recursive: boolean; force: boolean },
  ) {
    this.removed.push({ path: filePath, recursive: options.recursive });
  }
}

function createController(fileSystem: MemoryResetFileSystem, now = 1_000) {
  return createDataResetController({
    userDataDir,
    fileSystem,
    now: () => now,
    createPhrase: () => "确认删除-7314",
  });
}

function addResetFiles(fileSystem: MemoryResetFileSystem) {
  for (const name of [
    "config.v1.json",
    "credentials.v1.bin",
    "thread-state.v1.json",
    "idempotency.v1.json",
    "logs",
  ]) {
    const filePath = `${userDataDir}\\${name}`;
    fileSystem.realPaths.set(filePath, filePath);
  }
}

describe("data reset", () => {
  it("requires the generated phrase and removes only approved direct children", async () => {
    const fileSystem = new MemoryResetFileSystem();
    addResetFiles(fileSystem);
    const controller = createController(fileSystem);

    const reset = controller.begin();
    await expect(controller.confirm({ phrase: "错误短语" })).resolves.toEqual({
      ok: false,
      message: "确认短语不正确",
    });
    await expect(controller.confirm({ phrase: reset.phrase })).resolves.toEqual(
      {
        ok: true,
        message: "本机数据已删除",
      },
    );

    expect(fileSystem.removed).toEqual([
      { path: `${userDataDir}\\config.v1.json`, recursive: false },
      { path: `${userDataDir}\\credentials.v1.bin`, recursive: false },
      { path: `${userDataDir}\\thread-state.v1.json`, recursive: false },
      { path: `${userDataDir}\\idempotency.v1.json`, recursive: false },
      { path: `${userDataDir}\\logs`, recursive: true },
    ]);
  });

  it("expires the phrase and prevents replay", async () => {
    const fileSystem = new MemoryResetFileSystem();
    const now = vi.fn(() => 1_000);
    const controller = createDataResetController({
      userDataDir,
      fileSystem,
      now,
      createPhrase: () => "确认删除-7314",
      ttlMs: 5_000,
    });
    const reset = controller.begin();
    now.mockReturnValue(6_001);

    await expect(controller.confirm({ phrase: reset.phrase })).resolves.toEqual(
      {
        ok: false,
        message: "确认短语已过期",
      },
    );
    now.mockReturnValue(1_001);
    const next = controller.begin();
    await expect(controller.confirm({ phrase: next.phrase })).resolves.toEqual({
      ok: true,
      message: "本机数据已删除",
    });
    await expect(
      controller.confirm({ phrase: next.phrase }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });

  it("fails closed when an approved target resolves outside userData", async () => {
    const fileSystem = new MemoryResetFileSystem();
    addResetFiles(fileSystem);
    fileSystem.realPaths.set(
      `${userDataDir}\\logs`,
      "C:\\Users\\demo\\Projects",
    );
    const controller = createController(fileSystem);
    const reset = controller.begin();

    await expect(controller.confirm({ phrase: reset.phrase })).resolves.toEqual(
      {
        ok: false,
        message: "本机数据位置校验失败，未执行删除",
      },
    );
    expect(fileSystem.removed).toHaveLength(0);
  });
});
