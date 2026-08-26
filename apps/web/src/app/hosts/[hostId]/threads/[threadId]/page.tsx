"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ThreadScreen } from "../../../../../features/thread/thread-screen";

export default function ThreadPage() {
  const params = useParams<{ hostId: string; threadId: string }>();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return <p className="p-6 text-sm text-red-700">缺少项目，无法读取任务。</p>;
  }
  return (
    <ThreadScreen
      hostId={params.hostId}
      threadId={params.threadId}
      workspaceId={workspaceId}
    />
  );
}
