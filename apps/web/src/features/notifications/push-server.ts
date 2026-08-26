import "server-only";
import webpush from "web-push";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import type { PushNotification } from "./notification-policy";
import { getPushConfig } from "./push-config";

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushDeliveryResult {
  sent: number;
  removed: number;
  configured: boolean;
}

export async function sendPushNotificationToOwner(input: {
  ownerId: string;
  notification: PushNotification;
}): Promise<PushDeliveryResult> {
  const config = getPushConfig();
  if (!config) return { sent: 0, removed: 0, configured: false };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const admin = createAdminSupabaseClient();
  const subscriptions = await admin
    .schema("private")
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("owner_id", input.ownerId)
    .returns<StoredSubscription[]>();
  if (subscriptions.error) throw new Error("Push 订阅读取失败");

  let sent = 0;
  let removed = 0;
  for (const subscription of subscriptions.data ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(input.notification),
      );
      sent += 1;
    } catch (error) {
      if (!isExpiredSubscription(error)) throw error;
      const deleted = await admin
        .schema("private")
        .from("push_subscriptions")
        .delete()
        .eq("id", subscription.id);
      if (deleted.error) throw new Error("失效 Push 订阅清理失败");
      removed += 1;
    }
  }
  return { sent, removed, configured: true };
}

export function isExpiredSubscription(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    ((error as { statusCode?: unknown }).statusCode === 404 ||
      (error as { statusCode?: unknown }).statusCode === 410)
  );
}
