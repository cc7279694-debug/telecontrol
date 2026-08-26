import type { RemoteEvent } from "@codex-remote/protocol";

export type PushNotificationKind = "approval" | "completed" | "failed";

export interface PushNotification {
  kind: PushNotificationKind;
  title: string;
  body: string;
  data: {
    hostId: string;
    eventId: string;
  };
}

export function buildPushNotification(
  hostId: string,
  event: RemoteEvent,
): PushNotification | null {
  if (!hostId.trim()) return null;

  if (event.type === "approval.request") {
    return createNotification(
      "approval",
      "Codex Remote 需要审批",
      "有一个任务正在等待你的决定",
      hostId,
      event.requestMessageId,
    );
  }

  if (event.type === "turn.status" && event.status === "completed") {
    return createNotification(
      "completed",
      "Codex Remote 任务完成",
      "远程任务已完成",
      hostId,
      event.requestMessageId,
    );
  }

  if (event.type === "turn.status" && event.status === "failed") {
    return createNotification(
      "failed",
      "Codex Remote 任务失败",
      "远程任务执行失败",
      hostId,
      event.requestMessageId,
    );
  }

  return null;
}

function createNotification(
  kind: PushNotificationKind,
  title: string,
  body: string,
  hostId: string,
  eventId: string,
): PushNotification {
  return { kind, title, body, data: { hostId, eventId } };
}
