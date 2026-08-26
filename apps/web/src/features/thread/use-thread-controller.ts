"use client";

import { useEffect, useState } from "react";
import type { RemoteEvent, RemoteThreadSnapshot } from "@codex-remote/protocol";
import { useRemote } from "../remote/remote-client-context";
import { enqueueAndWaitForEvent } from "../remote/remote-command-service";

export interface ThreadControllerInput {
  hostId: string;
  threadId: string;
  workspaceId: string;
}

export interface ThreadControllerState {
  snapshot: RemoteThreadSnapshot | null;
  streamText: string;
  approvals: Extract<RemoteEvent, { type: "approval.request" }>[];
  pending: boolean;
  error: string | null;
  refresh: () => Promise<RemoteThreadSnapshot>;
  resume: () => Promise<RemoteThreadSnapshot>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  respondApproval: (
    requestId: string | number,
    decision: Extract<
      RemoteEvent,
      { type: "approval.request" }
    >["allowedDecisions"][number],
  ) => Promise<void>;
}

export function useThreadController(
  input: ThreadControllerInput,
): ThreadControllerState {
  const { state, client } = useRemote();
  const snapshot = state.threadSnapshots[input.threadId] ?? null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !state.online ||
      snapshot ||
      state.threadSummaries.some((thread) => thread.id === input.threadId)
    ) {
      return;
    }
    void readThread();
    // The current snapshot and online state intentionally control the first read.
  }, [input.threadId, input.workspaceId, state.online, snapshot]);

  async function readThread(): Promise<RemoteThreadSnapshot> {
    setPending(true);
    setError(null);
    try {
      const event = await enqueueAndWaitForEvent(
        client,
        {
          type: "thread.read",
          workspaceId: input.workspaceId,
          threadId: input.threadId,
        },
        (
          candidate,
        ): candidate is Extract<RemoteEvent, { type: "thread.snapshot" }> =>
          candidate.type === "thread.snapshot" &&
          candidate.snapshot.id === input.threadId,
      );
      return event.snapshot;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "任务读取失败";
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }

  async function refresh(): Promise<RemoteThreadSnapshot> {
    if (!state.online) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    return readThread();
  }

  async function resume(): Promise<RemoteThreadSnapshot> {
    if (!state.online) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    if (!snapshot) {
      throw new Error("任务尚未加载，请稍候");
    }
    setPending(true);
    setError(null);
    try {
      const event = await enqueueAndWaitForEvent(
        client,
        {
          type: "thread.resume",
          workspaceId: input.workspaceId,
          threadId: input.threadId,
        },
        (
          candidate,
        ): candidate is Extract<RemoteEvent, { type: "thread.snapshot" }> =>
          candidate.type === "thread.snapshot" &&
          candidate.snapshot.id === input.threadId,
      );
      return event.snapshot;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "恢复任务失败";
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("请输入内容");
    }
    if (!state.online) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    if (!snapshot) {
      throw new Error("任务尚未加载，请稍候");
    }
    if (snapshot.readOnly && snapshot.state === "running") {
      throw new Error("电脑端正在运行，当前任务只读");
    }

    setPending(true);
    setError(null);
    try {
      const controlSnapshot = snapshot.readOnly ? await resume() : snapshot;
      if (controlSnapshot.activeTurnId) {
        await client.enqueue({
          type: "turn.steer",
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          turnId: controlSnapshot.activeTurnId,
          text: trimmed,
        });
      } else {
        await client.enqueue({
          type: "turn.start",
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          text: trimmed,
        });
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "发送失败，请重试";
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }

  async function stop(): Promise<void> {
    if (!state.online) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    if (!snapshot?.activeTurnId) {
      throw new Error("当前没有正在运行的任务");
    }
    setPending(true);
    setError(null);
    try {
      await client.enqueue({
        type: "turn.interrupt",
        threadId: input.threadId,
        turnId: snapshot.activeTurnId,
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "停止任务失败，请重试";
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }

  async function respondApproval(
    requestId: string | number,
    decision: Extract<
      RemoteEvent,
      { type: "approval.request" }
    >["allowedDecisions"][number],
  ): Promise<void> {
    if (!state.online) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    setPending(true);
    setError(null);
    try {
      await client.enqueue({ type: "approval.respond", requestId, decision });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "审批提交失败，请重试";
      setError(message);
      throw new Error(message);
    } finally {
      setPending(false);
    }
  }

  const activeTurnId = snapshot?.activeTurnId;
  const streamText = activeTurnId
    ? (state.streams[`${input.threadId}:${activeTurnId}`]?.text ?? "")
    : "";
  const approvals = Object.values(state.pendingApprovals).filter(
    (approval) =>
      approval.threadId === input.threadId &&
      (!activeTurnId || approval.turnId === activeTurnId),
  );

  return {
    snapshot,
    streamText,
    approvals,
    pending,
    error,
    refresh,
    resume,
    send,
    stop,
    respondApproval,
  };
}
