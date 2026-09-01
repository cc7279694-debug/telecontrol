"use client";

import React, { useState } from "react";
import { Button } from "../../components/ui/button";

export function ThreadComposer({
  disabled,
  pending,
  onSend,
}: {
  disabled: boolean;
  pending: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (disabled || pending || !value.trim()) {
      return;
    }
    setError(null);
    try {
      await onSend(value);
      setValue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败，请重试");
    }
  }

  const helperText = disabled
    ? "连接主机或恢复任务后可继续操作"
    : pending
      ? "正在发送，请稍候"
      : "Enter 发送 · Shift+Enter 换行";

  return (
    <div className="sticky bottom-0 -mx-1 border-t border-zinc-200 bg-zinc-100/95 px-1 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95">
      {error ? (
        <p className="mb-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <p
        className="mb-2 text-xs text-zinc-500 dark:text-zinc-400"
        id="thread-composer-help"
      >
        {helperText}
      </p>
      <div className="flex items-end gap-2 sm:gap-3">
        <textarea
          aria-label="输入指令"
          aria-describedby="thread-composer-help"
          className="min-w-0 max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 text-zinc-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/50 dark:disabled:bg-zinc-900/60"
          disabled={disabled || pending}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={disabled ? "当前任务不可操作" : "输入下一步指令…"}
          rows={1}
        />
        <Button
          className="min-w-[72px] shrink-0 sm:min-w-20"
          disabled={disabled || pending || !value.trim()}
          onClick={() => void submit()}
        >
          {pending ? "发送中" : "发送"}
        </Button>
      </div>
    </div>
  );
}
