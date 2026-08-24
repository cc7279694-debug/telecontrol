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
});
