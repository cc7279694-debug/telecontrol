import React from "react";
import Link from "next/link";
import type { RemoteThreadSummary } from "@codex-remote/protocol";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";

export function ThreadList({
  threads,
  loading,
  loadingMore,
  nextCursor,
  error,
  hostId,
  onSelect,
  onLoadMore,
}: {
  threads: RemoteThreadSummary[];
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  error: string | null;
  hostId: string;
  onSelect: (thread: RemoteThreadSummary) => void;
  onLoadMore: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3" aria-label="正在读取任务">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  }
  if (threads.length === 0) {
    return (
      <p className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600">
        还没有任务
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {threads.map((thread) => (
        <Card key={thread.id}>
          <CardContent className="flex items-center gap-3">
            <button
              className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              type="button"
              onClick={() => onSelect(thread)}
            >
              <span className="block truncate font-semibold text-zinc-950">
                {thread.title || "未命名任务"}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{formatThreadState(thread)}</span>
                {thread.readOnly ? (
                  <Badge tone="warning">电脑端正在运行 / 只读</Badge>
                ) : null}
              </span>
            </button>
            <Link
              className="sr-only"
              href={`/hosts/${hostId}/threads/${thread.id}`}
            >
              打开 {thread.title || "未命名任务"}
            </Link>
          </CardContent>
        </Card>
      ))}
      {nextCursor ? (
        <Button
          className="w-full"
          variant="secondary"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "正在加载…" : "加载更多"}
        </Button>
      ) : null}
    </div>
  );
}

function formatThreadState(thread: RemoteThreadSummary): string {
  if (thread.state === "running") return "运行中";
  if (thread.state === "idle") return "空闲";
  return "状态未知";
}
