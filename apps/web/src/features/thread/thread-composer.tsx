"use client";

import React, { useState } from "react";
import type { RemoteModelSummary } from "@codex-remote/protocol";
import { Button } from "../../components/ui/button";
import type { TurnOptions } from "./use-thread-controller";

export function ThreadComposer({
  disabled,
  pending,
  activeTurn = false,
  models = [],
  onSend,
}: {
  disabled: boolean;
  pending: boolean;
  activeTurn?: boolean;
  models?: RemoteModelSummary[];
  onSend: (text: string, options?: TurnOptions) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");

  const selectedModelDetails = models.find(
    (candidate) => candidate.model === selectedModel,
  );
  const effectiveModel =
    selectedModelDetails ??
    models.find((candidate) => candidate.isDefault) ??
    models[0];
  const effectiveModelValue = effectiveModel?.model ?? "";
  const reasoningEfforts = effectiveModel?.reasoningEfforts ?? [];
  const effectiveReasoningEffort = reasoningEfforts.some(
    (candidate) => candidate.reasoningEffort === selectedReasoningEffort,
  )
    ? selectedReasoningEffort
    : (effectiveModel?.defaultReasoningEffort ??
      reasoningEfforts[0]?.reasoningEffort ??
      "");

  React.useEffect(() => {
    if (effectiveModelValue && selectedModel !== effectiveModelValue) {
      setSelectedModel(effectiveModelValue);
    }
    if (
      effectiveReasoningEffort &&
      selectedReasoningEffort !== effectiveReasoningEffort
    ) {
      setSelectedReasoningEffort(effectiveReasoningEffort);
    }
  }, [
    effectiveModelValue,
    effectiveReasoningEffort,
    selectedModel,
    selectedReasoningEffort,
  ]);

  async function submit() {
    if (disabled || pending || !value.trim()) {
      return;
    }
    setError(null);
    try {
      if (effectiveModelValue || effectiveReasoningEffort) {
        await onSend(value, {
          ...(effectiveModelValue ? { model: effectiveModelValue } : {}),
          ...(effectiveReasoningEffort
            ? { reasoningEffort: effectiveReasoningEffort }
            : {}),
        });
      } else {
        await onSend(value);
      }
      setValue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败，请重试");
    }
  }

  const helperText = disabled
    ? "连接主机或恢复任务后可继续操作"
    : pending
      ? "正在发送，请稍候"
      : activeTurn
        ? "当前任务运行中，模型设置将在下一条新任务生效"
        : "Enter 发送 · Shift+Enter 换行";

  return (
    <div className="sticky bottom-0 -mx-1 border-t border-zinc-200 bg-zinc-100/95 px-1 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95">
      {error ? (
        <p className="mb-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {models.length > 0 ? (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            模型
            <select
              aria-label="模型"
              className="mt-1.5 min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/50 dark:disabled:bg-zinc-900/60"
              disabled={disabled || pending || activeTurn}
              value={effectiveModelValue}
              onChange={(event) => {
                setSelectedModel(event.target.value);
                const nextModel = models.find(
                  (candidate) => candidate.model === event.target.value,
                );
                setSelectedReasoningEffort(
                  nextModel?.defaultReasoningEffort ??
                    nextModel?.reasoningEfforts[0]?.reasoningEffort ??
                    "",
                );
              }}
            >
              {models.map((candidate) => (
                <option key={candidate.id} value={candidate.model}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            思考程度
            <select
              aria-label="思考程度"
              className="mt-1.5 min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/50 dark:disabled:bg-zinc-900/60"
              disabled={
                disabled ||
                pending ||
                activeTurn ||
                reasoningEfforts.length === 0
              }
              value={effectiveReasoningEffort}
              onChange={(event) =>
                setSelectedReasoningEffort(event.target.value)
              }
            >
              {reasoningEfforts.map((candidate) => (
                <option
                  key={candidate.reasoningEffort}
                  value={candidate.reasoningEffort}
                >
                  {candidate.reasoningEffort} · {candidate.description}
                </option>
              ))}
            </select>
          </label>
        </div>
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
