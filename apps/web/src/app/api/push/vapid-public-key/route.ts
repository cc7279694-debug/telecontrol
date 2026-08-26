import { NextResponse } from "next/server";
import { getPushConfig } from "../../../../features/notifications/push-config";

export function GET() {
  const config = getPushConfig();
  if (!config) {
    return NextResponse.json({ error: "Push 通知尚未配置" }, { status: 503 });
  }
  return NextResponse.json({ publicKey: config.publicKey });
}
