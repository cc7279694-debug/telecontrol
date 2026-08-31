"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { PushNotificationSettings } from "../../components/push-notification-settings";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { useRemote } from "../remote/remote-client-context";
import { useRemoteSession } from "../session/remote-session-context";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { NewThreadDialog } from "../threads/new-thread-dialog";
import { ThreadList } from "../threads/thread-list";
import { useThreadList } from "../threads/use-thread-list";
import type { RemoteEvent, RemoteThreadSummary } from "@codex-remote/protocol";
import { enqueueAndWaitForEvent } from "../remote/remote-command-service";

export function HostsDashboard() {
  const { state: session, retryConnection } = useRemoteSession();
  if (session.status === "unpaired") {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-zinc-500">Codex Remote</p>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-950">
              还没有连接电脑
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              先在 Windows Host 窗口获取电脑 ID 和配对码。
            </p>
            <Link
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
              href="/pair"
            >
              添加 Windows 电脑
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (session.status === "error") {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-red-700" role="alert">
              {session.message}
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900"
              href="/pair"
            >
              重新配对
            </Link>
            <Button className="ml-3" onClick={retryConnection}>
              重新连接
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (session.status === "loading") {
    return (
      <AppShell>
        <p className="text-sm text-zinc-600">正在读取电脑信息…</p>
      </AppShell>
    );
  }
  return (
    <ConnectedDashboard
      host={session.host}
      offline={session.status === "offline"}
      offlineMessage={session.status === "offline" ? session.message : null}
    />
  );
}

function ConnectedDashboard({
  host,
  offline,
  offlineMessage,
}: {
  host: { hostId: string; hostName: string; deviceId: string };
  offline: boolean;
  offlineMessage: string | null;
}) {
  const router = useRouter();
  const { state, client } = useRemote();
  const workspaces = state.hostSnapshot?.workspaces ?? [];
  const [savedWorkspaceId, setSavedWorkspaceId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedWorkspaceId =
    workspaces.find((workspace) => workspace.id === savedWorkspaceId)?.id ??
    workspaces[0]?.id ??
    null;
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    null;
  const threadList = useThreadList(selectedWorkspaceId);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    window.localStorage.setItem(
      `codex-remote:last-workspace:${host.hostId}`,
      selectedWorkspaceId,
    );
  }, [host.hostId, selectedWorkspaceId]);

  useEffect(() => {
    const value = window.localStorage.getItem(
      `codex-remote:last-workspace:${host.hostId}`,
    );
    if (value) setSavedWorkspaceId(value);
  }, [host.hostId]);

  async function openThread(thread: RemoteThreadSummary) {
    if (offline || openingId) return;
    setOpeningId(thread.id);
    setActionError(null);
    try {
      await enqueueAndWaitForEvent(
        client,
        {
          type: "thread.read",
          workspaceId: thread.workspaceId,
          threadId: thread.id,
        },
        (
          candidate,
        ): candidate is Extract<RemoteEvent, { type: "thread.snapshot" }> =>
          candidate.type === "thread.snapshot" &&
          candidate.snapshot.id === thread.id,
      );
      router.push(
        `/hosts/${host.hostId}/threads/${thread.id}?workspaceId=${encodeURIComponent(thread.workspaceId)}`,
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "任务读取失败");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-zinc-500">Windows 电脑</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
                  {host.hostName}
                </h1>
              </div>
              <Badge tone={offline ? "warning" : "success"}>
                {offline ? "离线" : "在线"}
              </Badge>
            </div>
            {offlineMessage ? (
              <p className="mt-3 text-sm text-amber-800" role="status">
                {offlineMessage}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            {workspaces.length > 0 ? (
              <WorkspaceSwitcher
                workspaces={workspaces}
                value={selectedWorkspaceId ?? ""}
                onChange={setSavedWorkspaceId}
              />
            ) : (
              <p className="text-sm text-zinc-600">
                Windows Host 还没有授权项目。
              </p>
            )}
            <PushNotificationSettings deviceId={host.deviceId} />
          </CardContent>
        </Card>
        <section aria-labelledby="thread-list-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="thread-list-title"
              className="text-lg font-semibold text-zinc-950"
            >
              任务
            </h2>
            <Button
              variant="secondary"
              disabled={offline || !selectedWorkspace}
              onClick={() => threadList.reload()}
            >
              刷新
            </Button>
          </div>
          {actionError ? (
            <p className="mb-3 text-sm text-red-700" role="alert">
              {actionError}
            </p>
          ) : null}
          <ThreadList
            {...threadList}
            hostId={host.hostId}
            onSelect={openThread}
            onLoadMore={threadList.loadMore}
          />
          <Button
            className="mt-4 w-full"
            disabled={offline || !selectedWorkspace}
            onClick={() => setNewThreadOpen(true)}
          >
            新建任务
          </Button>
        </section>
      </div>
      <NewThreadDialog
        open={newThreadOpen}
        online={!offline && state.online}
        workspace={selectedWorkspace}
        client={client}
        onClose={() => setNewThreadOpen(false)}
        onCreated={(threadId) =>
          router.push(
            `/hosts/${host.hostId}/threads/${threadId}?workspaceId=${encodeURIComponent(selectedWorkspace?.id ?? "")}`,
          )
        }
      />
    </AppShell>
  );
}
