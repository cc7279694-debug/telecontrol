// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RemoteTimelineItem } from "@codex-remote/protocol";
import { ThreadTimeline } from "./thread-timeline";

afterEach(cleanup);

describe("ThreadTimeline", () => {
  it("renders structured items and the current stream without raw JSON", () => {
    const items: RemoteTimelineItem[] = [
      { id: "user-1", role: "user", kind: "text", text: "请检查" },
      { id: "assistant-1", role: "assistant", kind: "text", text: "正在检查" },
      {
        id: "reasoning-1",
        role: "assistant",
        kind: "reasoning",
        text: "分析中",
      },
      {
        id: "command-1",
        role: "tool",
        kind: "command",
        text: "运行检查",
        status: "inProgress",
      },
    ];

    render(<ThreadTimeline items={items} streamText="新的输出" />);

    expect(screen.getByText("请检查")).toBeTruthy();
    expect(screen.getByText("正在检查")).toBeTruthy();
    expect(screen.getByText("分析中")).toBeTruthy();
    expect(screen.getByText("运行检查")).toBeTruthy();
    expect(screen.getByText("新的输出")).toBeTruthy();
    expect(screen.queryByText(/assistant-1/)).toBeNull();
  });

  it("shows an empty state when no task content exists", () => {
    render(<ThreadTimeline items={[]} streamText="" />);
    const emptyState = screen.getByRole("status");
    expect(emptyState).toHaveTextContent("暂无任务内容");
    expect(emptyState).toHaveTextContent("在下方输入指令，开始与 Codex 协作");
  });

  it("keeps long messages readable inside bounded bubbles", () => {
    render(
      <ThreadTimeline
        items={[{ id: "user-1", role: "user", kind: "text", text: "请检查" }]}
        streamText=""
      />,
    );

    expect(screen.getByText("请检查")).toHaveClass("break-words");
  });
});
