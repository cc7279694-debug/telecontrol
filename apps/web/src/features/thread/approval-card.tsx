"use client";

import React, { useState } from "react";
import type { RemoteEvent } from "@codex-remote/protocol";
import { Button } from "../../components/ui/button";

const approvalLabels = {
  accept: "允许一次",
  acceptForSession: "本次任务允许",
  decline: "拒绝",
  cancel: "取消",
} as const;

type Approval = Extract<RemoteEvent, { type: "approval.request" }>;

export function ApprovalCard({
  approval,
  expired = false,
  onDecision,
}: {
  approval: Approval;
  expired?: boolean;
  onDecision: (
    requestId: string | number,
    decision: Approval["allowedDecisions"][number],
  ) => Promise<void>;
}) {
  const [submitted, setSubmitted] = useState(false);
  const locked = expired || submitted;

  async function decide(decision: Approval["allowedDecisions"][number]) {
    if (locked) return;
    setSubmitted(true);
    await onDecision(approval.requestId, decision);
  }

  return (
    <section
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
      aria-label="需要确认操作"
    >
      <p className="font-semibold text-amber-950">
        {expired ? "审批已失效" : approval.display.title}
      </p>
      {approval.display.detail ? (
        <p className="mt-2 text-sm leading-6 text-amber-900">
          {approval.display.detail}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {approval.allowedDecisions.map((decision) => (
          <Button
            key={decision}
            variant={
              decision === "decline" || decision === "cancel"
                ? "secondary"
                : "primary"
            }
            disabled={locked}
            onClick={() => void decide(decision)}
          >
            {approvalLabels[decision]}
          </Button>
        ))}
      </div>
    </section>
  );
}
