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

  const enabled = status === "enabled";
  const busy = status === "loading";
  const displayStatus = busy ? "处理中" : enabled ? "已开启" : "未开启";

  return (
    <div className="mt-6 border-t border-zinc-200/80 pt-5 dark:border-white/10">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-sm font-semibold text-zinc-950 dark:text-zinc-100"
            id="push-notification-label"
          >
            锁屏通知
          </p>
          <p
            className="mt-1 max-w-xl text-xs leading-5 text-zinc-500 dark:text-zinc-400"
            id="push-notification-description"
          >
            只提醒审批、完成和失败，不显示命令、路径或代码。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className="whitespace-nowrap text-xs font-semibold text-zinc-500 dark:text-zinc-400"
            aria-live="polite"
          >
            {displayStatus}
          </span>
          <button
            aria-checked={enabled}
            aria-describedby="push-notification-description"
            aria-labelledby="push-notification-label"
            className="relative inline-flex min-h-11 min-w-[52px] shrink-0 items-center justify-center rounded-full whitespace-nowrap outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-60 dark:focus-visible:ring-offset-zinc-900"
            data-state={enabled ? "checked" : "unchecked"}
            disabled={busy}
            role="switch"
            type="button"
            onClick={() => {
              if (enabled) {
                void disable();
              } else {
                void enable();
              }
            }}
          >
            <span
              aria-hidden="true"
              className={`relative block h-7 w-12 rounded-full p-1 transition-colors ${
                enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
      {message ? (
        <p
          className="mt-3 text-xs text-zinc-600 dark:text-zinc-400"
          role="status"
        >
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
