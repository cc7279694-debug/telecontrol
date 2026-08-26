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
      <p className="rounded-2xl bg-zinc-50 p-5 text-sm text-zinc-600">
        暂无任务内容
      </p>
    );
  }
  return (
    <div className="space-y-3" aria-live="polite">
      {items.map((item) => (
        <TimelineItem key={item.id} item={item} />
      ))}
      {streamText ? (
        <article className="max-w-[92%] rounded-2xl rounded-bl-md bg-zinc-100 p-4 text-sm leading-6 text-zinc-900">
          {streamText}
        </article>
      ) : null}
    </div>
  );
}

function TimelineItem({ item }: { item: RemoteTimelineItem }) {
  if (item.kind === "text" && item.role === "user") {
    return (
      <article className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-zinc-950 p-4 text-sm leading-6 text-white">
        {item.text}
      </article>
    );
  }
  if (item.kind === "text") {
    return (
      <article className="max-w-[92%] rounded-2xl rounded-bl-md bg-zinc-100 p-4 text-sm leading-6 text-zinc-900">
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
    <details className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
      <summary className="cursor-pointer font-semibold">
        {labels[item.kind]}
      </summary>
      <p className="mt-3 whitespace-pre-wrap leading-6">{item.text}</p>
      {item.status ? (
        <p className="mt-2 text-xs text-zinc-500">
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
