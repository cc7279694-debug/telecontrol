import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type RemoteThreadOwner = "host" | "external";
export type RemoteThreadState = "idle" | "running" | "unknown";

export interface RemoteThreadOwnership {
  threadId: string;
  workspaceId: string;
  owner: RemoteThreadOwner;
  state: RemoteThreadState;
  activeTurnId?: string;
}

interface PersistedStore {
  version: 1;
  threads: RemoteThreadOwnership[];
}

export class RemoteThreadStore {
  private readonly threads = new Map<string, RemoteThreadOwnership>();
  private readonly subscribers = new Set<() => void>();

  constructor(private readonly filePath?: string) {
    this.load();
  }

  get(threadId: string): RemoteThreadOwnership | undefined {
    const entry = this.threads.get(threadId);
    return entry ? { ...entry } : undefined;
  }

  canWrite(threadId: string): boolean {
    const entry = this.threads.get(threadId);
    return entry?.owner === "host" && entry.state !== "unknown";
  }

  hasActiveTurn(workspaceId: string): boolean {
    return Array.from(this.threads.values()).some(
      (entry) =>
        entry.owner === "host" &&
        entry.workspaceId === workspaceId &&
        (entry.state === "running" || entry.state === "unknown"),
    );
  }

  activeTurnCount(): number {
    return Array.from(this.threads.values()).filter(
      (entry) =>
        entry.owner === "host" &&
        (entry.state === "running" || entry.state === "unknown"),
    ).length;
  }

  listRecoverable(): RemoteThreadOwnership[] {
    return Array.from(this.threads.values())
      .filter(
        (entry) =>
          entry.owner === "host" &&
          (entry.state === "running" || entry.state === "unknown"),
      )
      .map((entry) => ({ ...entry }));
  }

  subscribe(handler: () => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  markRunningUnknown(): void {
    for (const entry of this.threads.values()) {
      if (entry.owner === "host" && entry.state === "running") {
        this.set({ ...entry, state: "unknown" });
      }
    }
  }

  markHostOwned(
    threadId: string,
    workspaceId: string,
    state: RemoteThreadState,
    activeTurnId?: string,
  ): void {
    this.set({
      threadId,
      workspaceId,
      owner: "host",
      state,
      ...(activeTurnId ? { activeTurnId } : {}),
    });
  }

  markExternalRunning(threadId: string, workspaceId: string): void {
    this.set({
      threadId,
      workspaceId,
      owner: "external",
      state: "running",
    });
  }

  updateState(
    threadId: string,
    state: RemoteThreadState,
    activeTurnId?: string,
  ): void {
    const existing = this.threads.get(threadId);
    if (!existing) {
      return;
    }
    const next: RemoteThreadOwnership = {
      ...existing,
      state,
    };
    if (activeTurnId) {
      next.activeTurnId = activeTurnId;
    } else {
      delete next.activeTurnId;
    }
    this.set(next);
  }

  private set(entry: RemoteThreadOwnership): void {
    this.threads.set(entry.threadId, entry);
    this.persist();
    for (const subscriber of this.subscribers) subscriber();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, "utf8"),
      ) as PersistedStore;
      if (parsed.version !== 1 || !Array.isArray(parsed.threads)) {
        return;
      }
      for (const entry of parsed.threads) {
        if (
          typeof entry.threadId === "string" &&
          typeof entry.workspaceId === "string" &&
          (entry.owner === "host" || entry.owner === "external") &&
          (entry.state === "idle" ||
            entry.state === "running" ||
            entry.state === "unknown")
        ) {
          this.threads.set(entry.threadId, { ...entry });
        }
      }
    } catch {
      this.threads.clear();
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const document: PersistedStore = {
      version: 1,
      threads: Array.from(this.threads.values()),
    };
    writeFileSync(this.filePath, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows ACLs are managed by the containing user profile directory.
    }
  }
}
