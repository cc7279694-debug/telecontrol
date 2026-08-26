// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteEvent } from "@codex-remote/protocol";
import { ApprovalCard } from "./approval-card";

afterEach(cleanup);

const approval: Extract<RemoteEvent, { type: "approval.request" }> = {
  type: "approval.request",
  requestMessageId: "request-1",
  requestId: "approval-1",
  threadId: "thread-1",
  turnId: "turn-1",
  method: "item/commandExecution/requestApproval",
  display: { title: "需要确认操作" },
  allowedDecisions: ["accept", "decline"],
};

describe("ApprovalCard", () => {
  it("renders only allowed decisions and locks after selection", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn(async () => undefined);
    render(<ApprovalCard approval={approval} onDecision={onDecision} />);

    expect(screen.getByText("需要确认操作")).toBeTruthy();
    expect(screen.getByRole("button", { name: "允许一次" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "本次任务允许" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "允许一次" }));

    expect(onDecision).toHaveBeenCalledWith("approval-1", "accept");
    expect(
      (screen.getByRole("button", { name: "允许一次" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows an inert expired card", () => {
    render(<ApprovalCard approval={approval} expired onDecision={vi.fn()} />);
    expect(screen.getByText("审批已失效")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "允许一次" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
