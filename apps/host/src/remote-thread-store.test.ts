import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteThreadStore } from "./remote-thread-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RemoteThreadStore", () => {
  it("notifies subscribers when activity changes", () => {
    const store = new RemoteThreadStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.markHostOwned("thread-1", "workspace-1", "running", "turn-1");

    expect(listener).toHaveBeenCalledOnce();
  });
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

  it("tracks active workspaces and treats unknown host turns as in use", () => {
    const store = new RemoteThreadStore();
    store.markHostOwned("thread-running", "workspace-1", "running", "turn-1");
    store.markHostOwned("thread-idle", "workspace-1", "idle");
    store.markExternalRunning("thread-external", "workspace-2");

    expect(store.hasActiveTurn("workspace-1")).toBe(true);
    expect(store.hasActiveTurn("workspace-2")).toBe(false);
    expect(store.activeTurnCount()).toBe(1);

    store.markRunningUnknown();

    expect(store.get("thread-running")).toMatchObject({ state: "unknown" });
    expect(store.hasActiveTurn("workspace-1")).toBe(true);
    expect(store.canWrite("thread-running")).toBe(false);
  });

  it("returns recoverable host threads as defensive copies", () => {
    const store = new RemoteThreadStore();
    store.markHostOwned("thread-1", "workspace-1", "unknown", "turn-1");
    store.markHostOwned("thread-2", "workspace-2", "idle");
    store.markExternalRunning("thread-3", "workspace-3");

    const recoverable = store.listRecoverable();
    expect(recoverable).toEqual([
      {
        threadId: "thread-1",
        workspaceId: "workspace-1",
        owner: "host",
        state: "unknown",
        activeTurnId: "turn-1",
      },
    ]);

    recoverable[0]!.state = "idle";
    expect(store.get("thread-1")?.state).toBe("unknown");
  });
});
