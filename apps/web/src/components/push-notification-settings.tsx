"use client";

import React, { useState } from "react";

export function PushNotificationSettings({ deviceId }: { deviceId: string }) {
  const [status, setStatus] = useState<
    "idle" | "loading" | "enabled" | "unsupported" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function enable() {
    setMessage(null);
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      setMessage("当前浏览器不支持锁屏通知");
      return;
    }
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("error");
        setMessage("你没有允许通知，请在浏览器设置中开启");
        return;
      }
      const keyResponse = await fetch("/api/push/vapid-public-key", {
        cache: "no-store",
      });
      if (!keyResponse.ok) throw new Error("通知服务尚未配置");
      const keyBody = (await keyResponse.json()) as { publicKey?: unknown };
      if (typeof keyBody.publicKey !== "string") {
        throw new Error("通知服务配置无效");
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(keyBody.publicKey),
        }));
      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, subscription }),
      });
      if (!response.ok) throw new Error("通知订阅保存失败");
      setStatus("enabled");
      setMessage("已开启审批、完成和失败通知");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "通知开启失败");
    }
  }

  async function disable() {
    setMessage(null);
    setStatus("loading");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceId, subscription }),
        });
        await subscription.unsubscribe();
      }
      setStatus("idle");
      setMessage("已关闭锁屏通知");
    } catch {
      setStatus("error");
      setMessage("通知关闭失败，请稍后重试");
    }
  }

  return (
    <div className="mt-5 border-t border-zinc-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-900">锁屏通知</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            只提醒审批、完成和失败，不显示命令、路径或代码。
          </p>
        </div>
        {status === "enabled" ? (
          <button
            className="min-h-11 rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
            type="button"
            onClick={() => void disable()}
          >
            关闭
          </button>
        ) : (
          <button
            className="min-h-11 rounded-xl bg-zinc-950 px-3 text-sm font-semibold text-white disabled:bg-zinc-400"
            type="button"
            onClick={() => void enable()}
            disabled={status === "loading"}
          >
            {status === "loading" ? "处理中…" : "开启"}
          </button>
        )}
      </div>
      {message ? (
        <p className="mt-2 text-xs text-zinc-600" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
    .buffer as ArrayBuffer;
}
