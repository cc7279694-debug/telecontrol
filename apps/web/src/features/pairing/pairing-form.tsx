"use client";

import React, { FormEvent, useState } from "react";

export interface PairingFormProps {
  consume(input: { hostId: string; code: string }): Promise<unknown>;
  onSuccess?: (result: unknown) => void;
}

export function PairingForm({ consume, onSuccess }: PairingFormProps) {
  const [hostId, setHostId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedHostId = hostId.trim();
    if (!trimmedHostId) {
      setError("请填写电脑 ID");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("请输入6位数字配对码");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await consume({ hostId: trimmedHostId, code });
      onSuccess?.(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "配对失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="pair-host-id">
          电脑 ID
        </label>
        <input
          className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-300"
          id="pair-host-id"
          value={hostId}
          onChange={(event) => setHostId(event.target.value)}
          autoComplete="off"
          placeholder="从 Windows Host 窗口复制"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="pair-code">
          配对码
        </label>
        <input
          className="mt-2 h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-center text-lg tracking-[0.4em] outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-300"
          id="pair-code"
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
        />
      </div>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="h-11 w-full rounded-xl bg-zinc-950 px-4 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        type="submit"
        disabled={loading}
      >
        {loading ? "正在配对…" : "开始配对"}
      </button>
    </form>
  );
}
