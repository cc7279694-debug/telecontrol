"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useRemote } from "../remote/remote-client-context";
import { ApprovalCard } from "./approval-card";
import { ThreadComposer } from "./thread-composer";
import { ThreadTimeline } from "./thread-timeline";
import { useThreadController } from "./use-thread-controller";
import { StopTurnDialog } from "./stop-turn-dialog";

export function ThreadScreen({
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

  if (!snapshot) {
    return (
      <AppShell action={false}>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-zinc-600">
              {controller.error ?? "正在读取任务…"}
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center"
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
      <div className="flex min-h-[calc(100dvh-5rem)] flex-col">
        <header className="mb-4 flex items-center gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            href="/hosts"
          >
            返回
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-zinc-950">
              {snapshot.title || "未命名任务"}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {snapshot.state === "running"
                ? "运行中"
                : snapshot.state === "idle"
                  ? "空闲"
                  : "状态未知"}
            </p>
          </div>
          <Badge
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
            className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            role="status"
          >
            电脑端正在运行，此任务暂时只能查看。
          </p>
        ) : null}
        {snapshot.readOnly && snapshot.state === "idle" ? (
          <Card className="mb-4">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <p className="text-sm text-zinc-600">
                这是历史任务，恢复后可以继续操作。
              </p>
              <Button
                disabled={!remoteState.online || controller.pending}
                onClick={() => void controller.resume()}
              >
                {controller.pending ? "正在恢复…" : "恢复并继续"}
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {controller.error ? (
          <p className="mb-3 text-sm text-red-700" role="alert">
            {controller.error}
          </p>
        ) : null}
        <ScrollArea className="flex-1 pb-4">
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
        <div className="mt-3 flex items-center justify-end gap-2">
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
          disabled={!canControl || snapshot.readOnly}
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
