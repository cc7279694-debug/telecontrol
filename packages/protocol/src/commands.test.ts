import { describe, expect, it } from "vitest";
import { remoteCommandSchema, remoteEventSchema } from "./commands.js";

describe("remote commands", () => {
  it("accepts a turn command that addresses a workspace by id", () => {
    expect(
      remoteCommandSchema.parse({
        type: "turn.start",
        workspaceId: "workbench",
        threadId: "thread-1",
        text: "检查项目状态",
      }),
    ).toEqual({
      type: "turn.start",
      workspaceId: "workbench",
      threadId: "thread-1",
      text: "检查项目状态",
    });
  });

  it("rejects a command that tries to submit a local path", () => {
    expect(() =>
      remoteCommandSchema.parse({
        type: "thread.list",
        workspaceId: "workbench",
        cwd: "C:\\Users\\private",
      }),
    ).toThrow();
  });

  it("rejects unknown command types", () => {
    expect(() => remoteCommandSchema.parse({ type: "shell.exec" })).toThrow();
  });

  it("parses every normalized event variant without raw Codex payloads", () => {
    const requestMessageId = "00000000-0000-4000-8000-000000000001";
    const observedAt = new Date().toISOString();
    const snapshot = {
      id: "thread-1",
      workspaceId: "workspace-1",
      title: "修复登录问题",
      state: "idle" as const,
      readOnly: false,
      items: [
        {
          id: "item-1",
          role: "assistant" as const,
          kind: "text" as const,
          text: "已完成",
          status: "completed" as const,
        },
      ],
    };

    const events = [
      {
        type: "host.presence" as const,
        hostId: "host-1",
        online: true,
        observedAt,
      },
      {
        type: "host.snapshot.result" as const,
        requestMessageId,
        snapshot: {
          hostId: "host-1",
          name: "开发电脑",
          online: true,
          observedAt,
          workspaces: [{ id: "workspace-1", name: "项目" }],
        },
      },
      {
        type: "thread.list.result" as const,
        requestMessageId,
        workspaceId: "workspace-1",
        threads: [
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            title: "修复登录问题",
            updatedAt: observedAt,
            state: "idle" as const,
            readOnly: false,
          },
        ],
      },
      { type: "thread.snapshot" as const, requestMessageId, snapshot },
      {
        type: "stream.delta" as const,
        requestMessageId,
        threadId: "thread-1",
        turnId: "turn-1",
        sequence: 0,
        delta: "继续检查",
      },
      {
        type: "turn.status" as const,
        requestMessageId,
        threadId: "thread-1",
        turnId: "turn-1",
        status: "inProgress" as const,
      },
      {
        type: "approval.request" as const,
        requestMessageId,
        requestId: "approval-1",
        method: "item/commandExecution/requestApproval",
        display: { title: "需要确认操作" },
        allowedDecisions: ["accept", "decline"] as const,
      },
      {
        type: "command.receipt" as const,
        messageId: requestMessageId,
        status: "completed" as const,
      },
      {
        type: "error" as const,
        requestMessageId,
        code: "adapter_failed",
        message: "本机 Codex 处理失败",
      },
    ];

    expect(events.map((event) => remoteEventSchema.parse(event))).toEqual(
      events,
    );
  });
});
