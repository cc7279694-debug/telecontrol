"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteThreadSummary, RemoteEvent } from "@codex-remote/protocol";
import { useRemote } from "../remote/remote-client-context";
import { enqueueAndWaitForEvent } from "../remote/remote-command-service";

export interface ThreadListState {
  threads: RemoteThreadSummary[];
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  error: string | null;
  reload: () => void;
  loadMore: () => void;
}

export function useThreadList(workspaceId: string | null): ThreadListState {
  const { state, client } = useRemote();
  const [threads, setThreads] = useState<RemoteThreadSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(
    async (append: boolean, cursor: string | null = null) => {
      if (!workspaceId || !state.online) {
        return;
      }
      if (append && !cursor) {
        return;
      }
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      const version = ++requestVersion.current;
      setError(null);
      try {
        const event = await enqueueAndWaitForEvent(
          client,
          {
            type: "thread.list",
            workspaceId,
            limit: 30,
            ...(append && cursor ? { cursor } : {}),
          },
          (
            candidate,
          ): candidate is Extract<
            RemoteEvent,
            { type: "thread.list.result" }
          > =>
            candidate.type === "thread.list.result" &&
            candidate.workspaceId === workspaceId,
        );
        if (requestVersion.current !== version) {
          return;
        }
        setThreads((current) => {
          if (!append) {
            return event.threads;
          }
          const merged = new Map(current.map((thread) => [thread.id, thread]));
          for (const thread of event.threads) {
            merged.set(thread.id, thread);
          }
          return [...merged.values()];
        });
        setNextCursor(event.nextCursor ?? null);
      } catch (caught) {
        if (requestVersion.current !== version) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "任务列表读取失败");
      } finally {
        if (requestVersion.current === version) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [client, state.online, workspaceId],
  );

  useEffect(() => {
    requestVersion.current += 1;
    setThreads([]);
    setNextCursor(null);
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId && state.online) {
      void load(false);
    }
  }, [load, state.online, workspaceId]);

  return {
    threads,
    loading,
    loadingMore,
    nextCursor,
    error,
    reload: () => void load(false),
    loadMore: () => void load(true, nextCursor),
  };
}
