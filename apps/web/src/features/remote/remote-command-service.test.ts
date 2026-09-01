import { describe, expect, it, vi } from "vitest";
import type { RemoteEvent, RemoteThreadSnapshot } from "@codex-remote/protocol";
import type { RemoteClient } from "./remote-client";
import {
  enqueueAndWaitForEvent,
  REMOTE_COMMAND_RESPONSE_TIMEOUT_MS,
} from "./remote-command-service";

const snapshot: RemoteThreadSnapshot = {
  id: "thread-1",
  workspaceId: "workspace-1",
  title: "修复登录问题",
  state: "idle",
  readOnly: false,
  items: [],
};

function createClient(options?: {
  receipt?: string;
  emitOnEnqueue?: RemoteEvent;
}) {
  let handler: ((event: RemoteEvent) => void) | undefined;
  const enqueue = vi.fn(async () => {
    if (options?.emitOnEnqueue) {
      handler?.(options.emitOnEnqueue);
    }
    return {
      messageId: options?.receipt ?? "request-1",
      status: "queued",
      duplicate: false,
    };
  });
  const client = {
    enqueue,
    subscribe: vi.fn((next: (event: RemoteEvent) => void) => {
      handler = next;
      return () => {
        handler = undefined;
      };
    }),
  } as unknown as RemoteClient;
  return { client, enqueue, emit: (event: RemoteEvent) => handler?.(event) };
}

function acceptsSnapshot(
  event: RemoteEvent,
): event is Extract<RemoteEvent, { type: "thread.snapshot" }> {
  return event.type === "thread.snapshot";
}

describe("enqueueAndWaitForEvent", () => {
  it("subscribes before sending and accepts the matching early response", async () => {
    const fixture = createClient({
      emitOnEnqueue: {
        type: "thread.snapshot",
        requestMessageId: "request-1",
        snapshot,
      },
    });

    await expect(
      enqueueAndWaitForEvent(
        fixture.client,
        {
          type: "thread.read",
          workspaceId: "workspace-1",
          threadId: "thread-1",
        },
        acceptsSnapshot,
      ),
    ).resolves.toMatchObject({ requestMessageId: "request-1" });
    expect(fixture.client.subscribe).toHaveBeenCalledTimes(1);
  });

  it("ignores an unrelated response and resolves the correlated event", async () => {
    const fixture = createClient();
    const waiting = enqueueAndWaitForEvent(
      fixture.client,
      { type: "thread.read", workspaceId: "workspace-1", threadId: "thread-1" },
      acceptsSnapshot,
      { timeoutMs: 1_000, idempotencyKey: "retry-1" },
    );

    fixture.emit({
      type: "thread.snapshot",
      requestMessageId: "other-request",
      snapshot,
    });
    fixture.emit({
      type: "thread.snapshot",
      requestMessageId: "request-1",
      snapshot,
    });

    await expect(waiting).resolves.toMatchObject({
      requestMessageId: "request-1",
    });
    expect(fixture.enqueue).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "retry-1",
    });
  });

  it("cleans up and rejects after the response timeout", async () => {
    const fixture = createClient();

    await expect(
      enqueueAndWaitForEvent(
        fixture.client,
        {
          type: "thread.read",
          workspaceId: "workspace-1",
          threadId: "thread-1",
        },
        acceptsSnapshot,
        { timeoutMs: 1 },
      ),
    ).rejects.toThrow("响应超时");

    expect(fixture.client.subscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting for a slow Host response beyond ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const fixture = createClient();
      const waiting = enqueueAndWaitForEvent(
        fixture.client,
        {
          type: "thread.read",
          workspaceId: "workspace-1",
          threadId: "thread-1",
        },
        acceptsSnapshot,
      );

      await vi.advanceTimersByTimeAsync(10_001);
      fixture.emit({
        type: "thread.snapshot",
        requestMessageId: "request-1",
        snapshot,
      });

      await expect(waiting).resolves.toMatchObject({
        requestMessageId: "request-1",
      });
      expect(REMOTE_COMMAND_RESPONSE_TIMEOUT_MS).toBeGreaterThan(10_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
