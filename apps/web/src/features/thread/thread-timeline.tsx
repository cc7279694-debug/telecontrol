import React from "react";
import type { RemoteTimelineItem } from "@codex-remote/protocol";

export function ThreadTimeline({
  items,
  streamText,
}: {
  items: RemoteTimelineItem[];
  streamText: string;
}) {
  if (items.length === 0 && !streamText) {
    return (
      <div
        className="rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-5 py-10 text-center dark:border-white/10 dark:bg-zinc-900/60"
        role="status"
      >
        <p className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
          暂无任务内容
        </p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          在下方输入指令，开始与 Codex 协作
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4 pb-2" aria-live="polite">
      {items.map((item) => (
        <TimelineItem key={item.id} item={item} />
      ))}
      {streamText ? (
        <article className="max-w-[min(92%,42rem)] break-words whitespace-pre-wrap rounded-3xl rounded-bl-md border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-900 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 sm:px-5 sm:py-4">
          {streamText}
        </article>
      ) : null}
    </div>
  );
}

function TimelineItem({ item }: { item: RemoteTimelineItem }) {
  if (item.kind === "text" && item.role === "user") {
    return (
      <article className="ml-auto max-w-[min(92%,42rem)] break-words whitespace-pre-wrap rounded-3xl rounded-br-md bg-blue-600 px-4 py-3 text-sm leading-6 text-white shadow-sm sm:px-5 sm:py-4">
        {item.text}
      </article>
    );
  }
  if (item.kind === "text") {
    return (
      <article className="max-w-[min(92%,42rem)] break-words whitespace-pre-wrap rounded-3xl rounded-bl-md border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-900 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 sm:px-5 sm:py-4">
        {item.text}
      </article>
    );
  }
  const labels = {
    reasoning: "分析摘要",
    command: "命令状态",
    fileChange: "文件变更",
    status: "任务状态",
  };
  return (
    <details className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-300">
      <summary className="cursor-pointer font-semibold text-zinc-900 outline-none marker:text-zinc-400 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-100">
        {labels[item.kind]}
      </summary>
      <p className="mt-3 break-words whitespace-pre-wrap leading-6">
        {item.text}
      </p>
      {item.status ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {formatStatus(item.status)}
        </p>
      ) : null}
    </details>
  );
}

function formatStatus(status: NonNullable<RemoteTimelineItem["status"]>) {
  return {
    inProgress: "进行中",
    completed: "已完成",
    failed: "失败",
    interrupted: "已中断",
  }[status];
}
