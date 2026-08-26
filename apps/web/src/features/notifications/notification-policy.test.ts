import { describe, expect, it } from "vitest";
import type { RemoteEvent } from "@codex-remote/protocol";
import { buildPushNotification } from "./notification-policy";
import { parsePushSubscription } from "./push-subscription";

describe("notification policy", () => {
  it("creates a generic approval notification with an opaque event id", () => {
    const event: Extract<RemoteEvent, { type: "approval.request" }> = {
      type: "approval.request",
      requestMessageId: "message-approval-1",
      requestId: "approval-1",
      threadId: "thread-1",
      turnId: "turn-1",
      method: "commandExecution",
      display: {
        title: "run command",
        detail: "C:\\Users\\secret\\project\\build.ps1",
      },
      allowedDecisions: ["accept", "decline", "cancel"],
    };

    expect(buildPushNotification("host-1", event)).toEqual({
      kind: "approval",
      title: "Codex Remote 需要审批",
      body: "有一个任务正在等待你的决定",
      data: { hostId: "host-1", eventId: "message-approval-1" },
    });
    expect(
      JSON.stringify(buildPushNotification("host-1", event)),
    ).not.toContain("secret");
  });

  it("only notifies for terminal turn states", () => {
    const base = {
      requestMessageId: "message-turn-1",
      threadId: "thread-1",
      turnId: "turn-1",
    };

    expect(
      buildPushNotification("host-1", {
        type: "turn.status",
        ...base,
        status: "inProgress",
      }),
    ).toBeNull();
    expect(
      buildPushNotification("host-1", {
        type: "turn.status",
        ...base,
        status: "completed",
      }),
    ).toMatchObject({ kind: "completed" });
    expect(
      buildPushNotification("host-1", {
        type: "turn.status",
        ...base,
        status: "failed",
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("accepts only bounded Web Push subscription fields", () => {
    expect(
      parsePushSubscription({
        endpoint: "https://push.example.test/subscription",
        keys: { p256dh: "public-key", auth: "auth-secret" },
        expirationTime: null,
      }),
    ).toEqual({
      endpoint: "https://push.example.test/subscription",
      p256dh: "public-key",
      auth: "auth-secret",
      expiresAt: null,
    });

    expect(() =>
      parsePushSubscription({
        endpoint: "http://not-tls.example.test/subscription",
        keys: { p256dh: "public-key", auth: "auth-secret" },
      }),
    ).toThrow("订阅地址无效");
  });
});
