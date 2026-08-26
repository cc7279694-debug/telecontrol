import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createAdminSupabaseClient } from "../../../../lib/supabase/admin";
import { parsePushSubscription } from "../../../../features/notifications/push-subscription";

interface SubscriptionRequest {
  deviceId?: unknown;
  subscription?: unknown;
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: SubscriptionRequest;
  try {
    body = (await request.json()) as SubscriptionRequest;
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return NextResponse.json({ error: "设备信息无效" }, { status: 400 });
  }

  let subscription;
  try {
    subscription = parsePushSubscription(body.subscription);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "订阅信息无效" },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient();
  const device = await admin
    .from("devices")
    .select("id")
    .eq("id", body.deviceId)
    .eq("owner_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (device.error || !device.data) {
    return NextResponse.json({ error: "设备不存在或已撤销" }, { status: 403 });
  }

  const saved = await admin.schema("private").from("push_subscriptions").upsert(
    {
      owner_id: user.id,
      device_id: body.deviceId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      expires_at: subscription.expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,endpoint" },
  );
  if (saved.error) {
    return NextResponse.json({ error: "Push 订阅保存失败" }, { status: 500 });
  }
  await admin
    .from("devices")
    .update({
      notifications_enabled: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.deviceId)
    .eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: SubscriptionRequest;
  try {
    body = (await request.json()) as SubscriptionRequest;
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  if (
    typeof body.deviceId !== "string" ||
    typeof body.subscription !== "object"
  ) {
    return NextResponse.json({ error: "设备信息无效" }, { status: 400 });
  }

  let subscription;
  try {
    subscription = parsePushSubscription(body.subscription);
  } catch {
    return NextResponse.json({ error: "订阅信息无效" }, { status: 400 });
  }
  const admin = createAdminSupabaseClient();
  const deleted = await admin
    .schema("private")
    .from("push_subscriptions")
    .delete()
    .eq("owner_id", user.id)
    .eq("device_id", body.deviceId)
    .eq("endpoint", subscription.endpoint);
  if (deleted.error) {
    return NextResponse.json({ error: "Push 订阅删除失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function getUser() {
  const supabase = await createServerSupabaseClient();
  const response = await supabase.auth.getUser();
  return response.data.user;
}
