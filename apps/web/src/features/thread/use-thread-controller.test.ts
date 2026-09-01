// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteThreadSnapshot } from "@codex-remote/protocol";
import type { RemoteClient } from "../remote/remote-client";
import { useThreadController } from "./use-thread-controller";

const useRemote = vi.fn();
const enqueueAndWaitForEvent = vi.fn();
vi.mock("../remote/remote-client-context", () => ({
  useRemote: () => useRemote(),
}));
vi.mock("../remote/remote-command-service", () => ({
  enqueueAndWaitForEvent: (...args: unknown[]) =>
    enqueueAndWaitForEvent(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const idleSnapshot: RemoteThreadSnapshot = {
  id: "thread-1",
  workspaceId: "workspace-1",
  title: "修复登录问题",
  state: "idle",
  readOnly: false,
  items: [],
};

function createRemote(snapshot: RemoteThreadSnapshot | null = idleSnapshot) {
  return {
    state: {
      online: true,
      threadSummaries: [],
      threadSnapshots: snapshot ? { [snapshot.id]: snapshot } : {},
      streams: {},
      turnStatuses: {},
      pendingApprovals: {},
      error: null,
    },
    client: {
      enqueue: vi.fn(async () => ({
        messageId: "command-1",
        status: "queued",
        duplicate: false,
      })),
    } as unknown as RemoteClient,
  };
}

describe("useThreadController", () => {
  it("reads a thread even when its summary was loaded first", async () => {
    const remote = createRemote(null);
    const remoteWithSummary = {
      ...remote,
      state: {
        ...remote.state,
        threadSummaries: [{ id: "thread-1" }],
      },
    };
    useRemote.mockReturnValue(remoteWithSummary);
    enqueueAndWaitForEvent.mockResolvedValue({
      type: "thread.snapshot",
      requestMessageId: "read-1",
      snapshot: idleSnapshot,
    });

    renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await waitFor(() => {
      expect(enqueueAndWaitForEvent).toHaveBeenCalledWith(
        remote.client,
        {
          type: "thread.read",
          workspaceId: "workspace-1",
          threadId: "thread-1",
        },
        expect.any(Function),
      );
    });
  });

  it("starts a new turn when the task is idle", async () => {
    const remote = createRemote();
    useRemote.mockReturnValue(remote);
    const view = renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await view.result.current.send("请继续检查");

    expect(remote.client.enqueue).toHaveBeenCalledWith({
      type: "turn.start",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      text: "请继续检查",
    });
  });

  it("steers an active turn instead of starting another turn", async () => {
    const snapshot: RemoteThreadSnapshot = {
      ...idleSnapshot,
      state: "running",
      readOnly: false,
      activeTurnId: "turn-1",
    };
    const remote = createRemote(snapshot);
    useRemote.mockReturnValue(remote);
    const view = renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await view.result.current.send("补充检查边界条件");

    expect(remote.client.enqueue).toHaveBeenCalledWith({
      type: "turn.steer",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      turnId: "turn-1",
      text: "补充检查边界条件",
    });
  });

  it("rejects writes to an external running task", async () => {
    const snapshot: RemoteThreadSnapshot = {
      ...idleSnapshot,
      state: "running",
      readOnly: true,
      activeTurnId: "turn-1",
    };
    const remote = createRemote(snapshot);
    useRemote.mockReturnValue(remote);
    const view = renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await expect(view.result.current.send("不能发送")).rejects.toThrow(
      "电脑端正在运行",
    );
    expect(remote.client.enqueue).not.toHaveBeenCalled();
  });

  it("resumes an idle historical task before enabling control", async () => {
    const remote = createRemote({ ...idleSnapshot, readOnly: true });
    useRemote.mockReturnValue(remote);
    enqueueAndWaitForEvent.mockResolvedValue({
      type: "thread.snapshot",
      requestMessageId: "resume-1",
      snapshot: { ...idleSnapshot, readOnly: false },
    });
    const view = renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await expect(view.result.current.resume()).resolves.toMatchObject({
      id: "thread-1",
    });
    expect(enqueueAndWaitForEvent).toHaveBeenCalledWith(
      remote.client,
      {
        type: "thread.resume",
        workspaceId: "workspace-1",
        threadId: "thread-1",
      },
      expect.any(Function),
    );
  });

  it("rejects blank text and interrupts the active turn", async () => {
    const snapshot: RemoteThreadSnapshot = {
      ...idleSnapshot,
      state: "running",
      activeTurnId: "turn-1",
    };
    const remote = createRemote(snapshot);
    useRemote.mockReturnValue(remote);
    const view = renderHook(() =>
      useThreadController({
        hostId: "host-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
      }),
    );

    await expect(view.result.current.send("  ")).rejects.toThrow("请输入内容");
    await view.result.current.stop();
    expect(remote.client.enqueue).toHaveBeenCalledWith({
      type: "turn.interrupt",
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });
});
