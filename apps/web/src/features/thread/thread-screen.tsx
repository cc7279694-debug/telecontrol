"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useRemote } from "../remote/remote-client-context";
import { useRemoteSession } from "../session/remote-session-context";
import { ApprovalCard } from "./approval-card";
import { ThreadComposer } from "./thread-composer";
import { isThreadComposerDisabled } from "./thread-control-state";
import {
  isNearThreadScrollBottom,
  scrollThreadToLatest,
} from "./thread-scroll";
import { ThreadTimeline } from "./thread-timeline";
import { useThreadController } from "./use-thread-controller";
import { StopTurnDialog } from "./stop-turn-dialog";

export const THREAD_SCREEN_LAYOUT_CLASS =
  "flex h-[calc(100dvh-8rem)] min-h-0 flex-col overflow-hidden";

export function ThreadScreen({
  hostId,
  threadId,
  workspaceId,
}: {
  hostId: string;
  threadId: string;
  workspaceId: string;
}) {
  const { state: session, retryConnection } = useRemoteSession();

  if (session.status === "loading") {
    return (
      <AppShell action={false}>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <p
              className="text-sm text-zinc-600 dark:text-zinc-400"
              role="status"
            >
              正在连接电脑…
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (session.status === "unpaired") {
    return (
      <AppShell action={false}>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              还没有连接电脑
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              href="/pair"
            >
              添加电脑
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (session.status === "error") {
    return (
      <AppShell action={false}>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {session.message}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={retryConnection}>重新连接</Button>
              <Link
                className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                href="/pair"
              >
                重新配对
              </Link>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <ConnectedThreadScreen
      hostId={hostId}
      threadId={threadId}
      workspaceId={workspaceId}
    />
  );
}

function ConnectedThreadScreen({
  hostId,
  threadId,
  workspaceId,
}: {
  hostId: string;
  threadId: string;
  workspaceId: string;
}) {
  const { state: remoteState } = useRemote();
  const controller = useThreadController({ hostId, threadId, workspaceId });
  const [stopOpen, setStopOpen] = useState(false);
  const snapshot = controller.snapshot;
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousThreadIdRef = useRef(threadId);

  useEffect(() => {
    if (previousThreadIdRef.current === threadId) return;

    previousThreadIdRef.current = threadId;
    followLatestRef.current = true;
  }, [threadId]);

  useEffect(() => {
    if (!followLatestRef.current || !threadScrollRef.current) return;

    scrollThreadToLatest(threadScrollRef.current);
  }, [
    controller.approvals.length,
    controller.streamText,
    snapshot?.items.length,
    threadId,
  ]);

  if (!snapshot) {
    return (
      <AppShell action={false}>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {controller.error ?? "正在读取任务…"}
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40"
              href="/hosts"
            >
              返回任务列表
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const externalRunning = snapshot.readOnly && snapshot.state === "running";
  const canControl =
    remoteState.online && !controller.pending && !externalRunning;

  return (
    <AppShell action={false}>
      <div className={THREAD_SCREEN_LAYOUT_CLASS}>
        <header className="mb-5 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-2 shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
          <Link
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
            href="/hosts"
          >
            返回
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50 sm:text-lg">
              {snapshot.title || "未命名任务"}
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {snapshot.state === "running"
                ? "运行中"
                : snapshot.state === "idle"
                  ? "空闲"
                  : "状态未知"}
            </p>
          </div>
          <Badge
            className="shrink-0"
            tone={
              externalRunning
                ? "warning"
                : snapshot.state === "running"
                  ? "success"
                  : "neutral"
            }
          >
            {externalRunning
              ? "只读"
              : snapshot.state === "running"
                ? "运行中"
                : "空闲"}
          </Badge>
        </header>
        {externalRunning ? (
          <p
            className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            电脑端正在运行，此任务暂时只能查看。
          </p>
        ) : null}
        {snapshot.readOnly && snapshot.state === "idle" ? (
          <Card className="mb-5">
            <CardContent className="flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                这是历史任务，可以直接输入；发送时会自动恢复。
              </p>
              <Button
                disabled={!remoteState.online || controller.pending}
                onClick={() => void controller.resume()}
              >
                {controller.pending ? "正在恢复…" : "立即恢复"}
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {controller.error ? (
          <p
            className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            {controller.error}
          </p>
        ) : null}
        <ScrollArea
          ref={threadScrollRef}
          className="flex-1 px-1 pb-4 sm:px-2"
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatestRef.current = isNearThreadScrollBottom({
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop,
            });
          }}
        >
          <ThreadTimeline
            items={snapshot.items}
            streamText={controller.streamText}
          />
          <div className="mt-4 space-y-3">
            {controller.approvals.map((approval) => (
              <ApprovalCard
                key={String(approval.requestId)}
                approval={approval}
                expired={snapshot.state !== "running"}
                onDecision={controller.respondApproval}
              />
            ))}
          </div>
        </ScrollArea>
        <div className="mt-3 flex items-center justify-end gap-2 pt-1">
          {snapshot.activeTurnId && !externalRunning ? (
            <Button
              variant="danger"
              disabled={!canControl}
              onClick={() => setStopOpen(true)}
            >
              停止任务
            </Button>
          ) : null}
        </div>
        <ThreadComposer
          disabled={isThreadComposerDisabled({
            online: remoteState.online,
            pending: controller.pending,
            readOnly: snapshot.readOnly,
            state: snapshot.state,
          })}
          pending={controller.pending}
          onSend={controller.send}
        />
      </div>
      <StopTurnDialog
        open={stopOpen}
        pending={controller.pending}
        onCancel={() => setStopOpen(false)}
        onConfirm={async () => {
          await controller.stop();
          setStopOpen(false);
        }}
      />
    </AppShell>
  );
}
