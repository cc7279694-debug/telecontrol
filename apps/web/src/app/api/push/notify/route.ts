import { NextResponse } from "next/server";
import {
  buildPushNotificationFromMeta,
  type PushNotificationMetaKind,
} from "../../../../features/notifications/notification-policy";
import { sendPushNotificationToOwner } from "../../../../features/notifications/push-server";
import { createAdminSupabaseClient } from "../../../../lib/supabase/admin";
import { createBearerSupabaseClient } from "../../../../lib/supabase/server";

interface NotificationRequest {
  hostId?: unknown;
  kind?: unknown;
  eventId?: unknown;
}

const kinds = new Set<PushNotificationMetaKind>([
  "approval",
  "completed",
  "failed",
]);

export async function POST(request: Request) {
  const accessToken = bearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const supabase = createBearerSupabaseClient(accessToken);
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: NotificationRequest;
  try {
    body = (await request.json()) as NotificationRequest;
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (
    typeof body.hostId !== "string" ||
    typeof body.kind !== "string" ||
    !kinds.has(body.kind as PushNotificationMetaKind) ||
    typeof body.eventId !== "string"
  ) {
    return NextResponse.json({ error: "通知信息无效" }, { status: 400 });
  }

  const notification = buildPushNotificationFromMeta(
    body.hostId,
    body.kind as PushNotificationMetaKind,
    body.eventId,
  );
  if (!notification) {
    return NextResponse.json({ error: "通知信息无效" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const host = await admin
    .from("hosts")
    .select("id")
    .eq("id", body.hostId)
    .eq("owner_id", auth.data.user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (host.error || !host.data) {
    return NextResponse.json({ error: "电脑不存在或已撤销" }, { status: 403 });
  }

  try {
    const result = await sendPushNotificationToOwner({
      ownerId: auth.data.user.id,
      notification,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "通知发送失败" }, { status: 502 });
  }
}

function bearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}
