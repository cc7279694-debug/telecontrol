import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteThreadStore } from "./remote-thread-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RemoteThreadStore", () => {
  it("persists only thread ownership and running state", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-remote-store-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "threads.json");
    const store = new RemoteThreadStore(filePath);

    store.markHostOwned("thread-1", "workspace-1", "running", "turn-1");
    store.markExternalRunning("thread-2", "workspace-1");

    const persisted = readFileSync(filePath, "utf8");
    expect(persisted).toContain("thread-1");
    expect(persisted).toContain("workspace-1");
    expect(persisted).not.toContain("secret");
    expect(persisted).not.toContain("C:\\\\");

    const restored = new RemoteThreadStore(filePath);
    expect(restored.canWrite("thread-1")).toBe(true);
    expect(restored.canWrite("thread-2")).toBe(false);
    expect(restored.get("thread-2")).toMatchObject({
      state: "running",
      owner: "external",
    });

    restored.updateState("thread-1", "idle");
    expect(restored.get("thread-1")).not.toHaveProperty("activeTurnId");
  });

  it("does not grant write ownership to an unknown thread", () => {
    const store = new RemoteThreadStore();
    expect(store.canWrite("missing-thread")).toBe(false);
  });
});
