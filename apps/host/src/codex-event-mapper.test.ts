import { describe, expect, it } from "vitest";
import { CodexEventMapper } from "./codex-event-mapper.js";

describe("CodexEventMapper", () => {
  it("normalizes a known idle thread into a writable summary", () => {
    const mapper = new CodexEventMapper();

    expect(
      mapper.threadSummary(
        {
          id: "thread-1",
          title: "修复登录问题",
          status: "completed",
        },
        { workspaceId: "workspace-1", readOnly: false },
      ),
    ).toEqual({
      id: "thread-1",
      workspaceId: "workspace-1",
      title: "修复登录问题",
      updatedAt: expect.any(String),
      state: "idle",
      readOnly: false,
    });
  });

  it("marks unknown or externally running threads read-only", () => {
    const mapper = new CodexEventMapper();

    expect(
      mapper.threadSummary(
        { id: "thread-2", status: "something-new" },
        { workspaceId: "workspace-1", readOnly: false },
      ),
    ).toMatchObject({ state: "unknown", readOnly: true });

    expect(
      mapper.threadSummary(
        { id: "thread-3", status: "in_progress" },
        { workspaceId: "workspace-1", readOnly: true },
      ),
    ).toMatchObject({ state: "running", readOnly: true });
  });

  it("only exposes sanitized approval display metadata", () => {
    const mapper = new CodexEventMapper();

    expect(
      mapper.approvalRequest({
        id: 42,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          command: "type secret.txt",
          cwd: "C:\\private",
          reason: "Need access",
        },
      }),
    ).toEqual({
      requestId: 42,
      threadId: "thread-1",
      turnId: "turn-1",
      method: "item/commandExecution/requestApproval",
      display: { title: "需要确认操作" },
      allowedDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    });
  });

  it("fails closed when an approval has no task ownership", () => {
    const mapper = new CodexEventMapper();

    expect(
      mapper.approvalRequest({
        id: 43,
        method: "item/commandExecution/requestApproval",
        params: { threadId: "thread-1" },
      }),
    ).toBeNull();
  });
});
