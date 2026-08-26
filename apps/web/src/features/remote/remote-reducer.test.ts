import { describe, expect, it } from "vitest";
import {
  initialRemoteState,
  remoteReducer,
  type RemoteAction,
} from "./remote-reducer";

describe("remoteReducer", () => {
  it("marks a sequence gap for authoritative snapshot recovery", () => {
    const first: RemoteAction = {
      type: "stream.delta",
      event: {
        type: "stream.delta",
        requestMessageId: "00000000-0000-4000-8000-000000000001",
        threadId: "thread-1",
        turnId: "turn-1",
        sequence: 0,
        delta: "你好",
      },
    };
    const gap: RemoteAction = {
      type: "stream.delta",
      event: { ...first.event, sequence: 2, delta: "世界" },
    };

    const state = remoteReducer(remoteReducer(initialRemoteState, first), gap);

    expect(state.needsSnapshot).toBe(true);
    expect(state.streams["thread-1:turn-1"]).toEqual({
      sequence: 0,
      text: "你好",
    });
  });

  it("replaces stale host data with an authoritative snapshot", () => {
    const state = remoteReducer(
      { ...initialRemoteState, needsSnapshot: true },
      {
        type: "host.snapshot.result",
        event: {
          type: "host.snapshot.result",
          requestMessageId: "00000000-0000-4000-8000-000000000002",
          snapshot: {
            hostId: "host-1",
            name: "开发电脑",
            online: true,
            observedAt: new Date().toISOString(),
            workspaces: [{ id: "workspace-1", name: "项目" }],
          },
        },
      },
    );

    expect(state.needsSnapshot).toBe(false);
    expect(state.hostSnapshot?.workspaces).toHaveLength(1);
  });

  it("stores an approval and removes it when its turn ends", () => {
    const approval: RemoteAction = {
      type: "approval.request",
      event: {
        type: "approval.request",
        requestMessageId: "00000000-0000-4000-8000-000000000003",
        requestId: "approval-1",
        threadId: "thread-1",
        turnId: "turn-1",
        method: "item/commandExecution/requestApproval",
        display: { title: "需要确认操作" },
        allowedDecisions: ["accept", "decline"],
      },
    };
    const pending = remoteReducer(initialRemoteState, approval);
    expect(pending.pendingApprovals["approval-1"]).toEqual(approval.event);

    const completed = remoteReducer(pending, {
      type: "turn.status",
      event: {
        type: "turn.status",
        requestMessageId: "00000000-0000-4000-8000-000000000004",
        threadId: "thread-1",
        turnId: "turn-1",
        status: "completed",
      },
    });
    expect(completed.pendingApprovals).toEqual({});
  });

  it("records command receipts by message ID", () => {
    const receipt: RemoteAction = {
      type: "command.receipt",
      event: {
        type: "command.receipt",
        messageId: "00000000-0000-4000-8000-000000000005",
        status: "completed",
      },
    };

    const state = remoteReducer(initialRemoteState, receipt);

    expect(
      state.commandReceipts["00000000-0000-4000-8000-000000000005"],
    ).toEqual(receipt.event);
  });
});
