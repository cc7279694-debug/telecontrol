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

  return (
    <div className="border-t border-zinc-200 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
      {error ? (
        <p className="mb-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="输入指令"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-300 disabled:bg-zinc-100"
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
          disabled={disabled || pending || !value.trim()}
          onClick={() => void submit()}
        >
          {pending ? "发送中" : "发送"}
        </Button>
      </div>
    </div>
  );
}
