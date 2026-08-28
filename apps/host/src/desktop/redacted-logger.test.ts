import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SafeLogRecordSchema,
  createRedactedLogger,
} from "./redacted-logger.js";

describe("redacted logger", () => {
  it("accepts only the documented safe fields", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "codex-remote-log-"),
    );
    const logger = createRedactedLogger({ directory, appVersion: "0.1.0" });

    await logger.write({
      timestamp: "2026-08-28T00:00:00.000Z",
      level: "error",
      event: "runtime_failed",
      result: "failed",
      errorCode: "codex_cli_missing",
      appVersion: "0.1.0",
    });
    const lines = (await readFile(path.join(directory, "host.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(SafeLogRecordSchema.parse(JSON.parse(lines[0]!))).toMatchObject({
      errorCode: "codex_cli_missing",
    });
    expect(() =>
      SafeLogRecordSchema.parse({
        timestamp: "2026-08-28T00:00:00.000Z",
        level: "error",
        event: "runtime_failed",
        result: "failed",
        prompt: "secret prompt",
      }),
    ).toThrow();
  });

  it("rotates large files and never keeps more than five log files", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "codex-remote-log-"),
    );
    const logger = createRedactedLogger({ directory, appVersion: "0.1.0" });
    const record = {
      timestamp: "2026-08-28T00:00:00.000Z",
      level: "info" as const,
      event: "heartbeat",
      result: "succeeded" as const,
      appVersion: "0.1.0",
    };

    for (let index = 0; index < 120; index += 1) {
      await logger.write(record);
    }

    const fileNames = (await import("node:fs/promises")).readdir(directory);
    expect(
      (await fileNames).filter((name) => name.endsWith(".jsonl")).length,
    ).toBeLessThanOrEqual(5);
  });

  it("removes only old direct log files", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "codex-remote-log-"),
    );
    await writeFile(path.join(directory, "host.4.jsonl"), "old");
    await utimes(
      path.join(directory, "host.4.jsonl"),
      new Date(0),
      new Date(0),
    );
    const logger = createRedactedLogger({ directory, appVersion: "0.1.0" });

    await logger.cleanup();

    await expect(
      readFile(path.join(directory, "host.4.jsonl")),
    ).rejects.toThrow();
  });
});
