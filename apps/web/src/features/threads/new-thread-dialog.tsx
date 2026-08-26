"use client";

import React, { useState } from "react";
import type { RemoteEvent, WorkspaceSummary } from "@codex-remote/protocol";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import type { RemoteClient } from "../remote/remote-client";
import { enqueueAndWaitForEvent } from "../remote/remote-command-service";

export function NewThreadDialog({
  open,
  online,
  workspace,
  client,
  onClose,
  onCreated,
}: {
  open: boolean;
  online: boolean;
  workspace: WorkspaceSummary | null;
  client: RemoteClient;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createThread() {
    if (!workspace || !online || loading) return;
    setLoading(true);
    setError(null);
    try {
      const event = await enqueueAndWaitForEvent(
        client,
        { type: "thread.start", workspaceId: workspace.id },
        (
          candidate,
        ): candidate is Extract<RemoteEvent, { type: "thread.snapshot" }> =>
          candidate.type === "thread.snapshot" &&
          candidate.snapshot.workspaceId === workspace.id,
      );
      onCreated(event.snapshot.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新建任务失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <h2 className="text-xl font-semibold text-zinc-950">新建任务</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          将在“{workspace?.name ?? "未选择项目"}”中启动一个新的 Codex 任务。
        </p>
        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            className="flex-1"
            disabled={!online || !workspace || loading}
            onClick={() => void createThread()}
          >
            {loading ? "正在创建…" : "开始任务"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
