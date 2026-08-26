import { describe, expect, it } from "vitest";
import type { PairedHostRecord } from "./paired-host-registry";
import {
  initialRemoteSessionState,
  remoteSessionReducer,
} from "./remote-session-state";

const host: PairedHostRecord = {
  hostId: "host-1",
  hostName: "开发电脑",
  deviceId: "device-1",
  protocolVersion: 1,
};

describe("remoteSessionReducer", () => {
  it("moves from loading to unpaired when no Host link exists", () => {
    expect(
      remoteSessionReducer(initialRemoteSessionState, {
        type: "pair.missing",
      }),
    ).toEqual({ status: "unpaired" });
  });

  it("keeps a paired Host visible while it connects", () => {
    expect(
      remoteSessionReducer(initialRemoteSessionState, {
        type: "pair.found",
        host,
      }),
    ).toEqual({ status: "connecting", host });
  });

  it("distinguishes a ready Host from a reachable but offline Host", () => {
    const connecting = remoteSessionReducer(initialRemoteSessionState, {
      type: "pair.found",
      host,
    });
    expect(
      remoteSessionReducer(connecting, { type: "connection.ready" }),
    ).toEqual({ status: "ready", host });
    expect(
      remoteSessionReducer(connecting, {
        type: "connection.offline",
        message: "电脑当前离线",
      }),
    ).toEqual({ status: "offline", host, message: "电脑当前离线" });
  });

  it("records an error without inventing a Host pair", () => {
    expect(
      remoteSessionReducer(initialRemoteSessionState, {
        type: "session.error",
        message: "登录会话无效，请重新登录",
      }),
    ).toEqual({ status: "error", message: "登录会话无效，请重新登录" });
  });
});
