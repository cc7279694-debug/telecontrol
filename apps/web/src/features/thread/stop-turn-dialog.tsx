"use client";

import React from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";

export function StopTurnDialog({
  open,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogContent>
        <h2 className="text-xl font-semibold text-zinc-950">停止任务？</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          停止后，本次正在生成的内容会中断
        </p>
        <div className="mt-6 flex gap-3">
          <Button
            className="flex-1"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="flex-1"
            variant="danger"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? "正在停止…" : "确认停止"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
