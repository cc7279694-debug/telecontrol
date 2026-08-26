// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteEvent } from "@codex-remote/protocol";
import { useThreadList } from "./use-thread-list";

const useRemote = vi.fn();
vi.mock("../remote/remote-client-context", () => ({
  useRemote: () => useRemote(),
}));

afterEach(cleanup);

describe("useThreadList", () => {
  it("loads the selected workspace and ignores a different workspace response", async () => {
    let handler: ((event: RemoteEvent) => void) | undefined;
    const client = {
      subscribe: vi.fn((next: (event: RemoteEvent) => void) => {
        handler = next;
        return () => {
          handler = undefined;
        };
      }),
      enqueue: vi.fn(async () => {
        handler?.({
          type: "thread.list.result",
          requestMessageId: "request-1",
          workspaceId: "workspace-2",
          threads: [],
        });
        queueMicrotask(() =>
          handler?.({
            type: "thread.list.result",
            requestMessageId: "request-1",
            workspaceId: "workspace-1",
            threads: [
              {
                id: "thread-1",
                workspaceId: "workspace-1",
                title: "修复登录问题",
                updatedAt: "2026-08-26T01:00:00.000Z",
                state: "idle",
                readOnly: false,
              },
            ],
          }),
        );
        return { messageId: "request-1", status: "queued", duplicate: false };
      }),
    };
    useRemote.mockReturnValue({ state: { online: true }, client });

    const view = renderHook(() => useThreadList("workspace-1"));

    await waitFor(() => expect(view.result.current.threads).toHaveLength(1));
    expect(view.result.current.threads[0]?.id).toBe("thread-1");
    expect(client.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.list",
        workspaceId: "workspace-1",
        limit: 30,
      }),
      {},
    );
  });

  it("does not enqueue while the Host is offline", async () => {
    const client = { enqueue: vi.fn(), subscribe: vi.fn() };
    useRemote.mockReturnValue({ state: { online: false }, client });

    renderHook(() => useThreadList("workspace-1"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.enqueue).not.toHaveBeenCalled();
  });
});
