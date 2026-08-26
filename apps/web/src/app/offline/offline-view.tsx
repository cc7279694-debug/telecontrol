"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { Card, CardContent } from "../../components/ui/card";
import {
  loadOfflineStatus,
  type OfflineStatus,
} from "../../features/pwa/offline-status";

export function OfflineView() {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setStatus(loadOfflineStatus());
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <AppShell action={false}>
      <Card>
        <CardContent className="p-6">
          <p className="text-sm font-medium text-zinc-500">Codex Remote</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
            当前无法连接电脑
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {online
              ? "连接正在恢复，请返回任务页面重试。"
              : "手机当前处于离线状态。恢复网络后即可继续操作。"}
          </p>
          {status ? (
            <p className="mt-4 text-xs text-zinc-500">
              最后状态：{status.lastTurnStatus ?? "暂无运行记录"}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
