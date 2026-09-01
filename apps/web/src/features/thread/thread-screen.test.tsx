// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { RemoteClient } from "../remote/remote-client";
import {
  RemoteSessionProvider,
  type RemoteSessionDependencies,
} from "../session/remote-session-context";
import { THREAD_SCREEN_LAYOUT_CLASS, ThreadScreen } from "./thread-screen";

function createDependencies(): RemoteSessionDependencies {
  return {
    loadPair: vi.fn(async () => null),
    createClient: vi.fn(() => ({}) as RemoteClient),
  };
}

describe("ThreadScreen", () => {
  it("keeps the timeline in a bounded viewport so the latest message can be shown", () => {
    expect(THREAD_SCREEN_LAYOUT_CLASS).toContain("h-[calc(100dvh-8rem)]");
    expect(THREAD_SCREEN_LAYOUT_CLASS).toContain("min-h-0");
    expect(THREAD_SCREEN_LAYOUT_CLASS).toContain("overflow-hidden");
  });

  it("waits for the session provider before reading remote thread state", async () => {
    const view = render(
      <RemoteSessionProvider dependencies={createDependencies()}>
        <ThreadScreen
          hostId="host-1"
          threadId="thread-1"
          workspaceId="workspace-1"
        />
      </RemoteSessionProvider>,
    );

    await waitFor(() => expect(view.getByText("还没有连接电脑")).toBeVisible());
    expect(
      view.queryByText("useRemote 必须在 RemoteProvider 内使用"),
    ).toBeNull();
  });
});
