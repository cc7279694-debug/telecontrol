// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadList } from "./thread-list";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

const baseProps = {
  loading: false,
  loadingMore: false,
  nextCursor: null,
  error: null,
  hostId: "host-1",
  onSelect: vi.fn(),
  onLoadMore: vi.fn(),
};

describe("ThreadList", () => {
  it("shows an empty state without leaking local paths", () => {
    render(<ThreadList {...baseProps} threads={[]} />);

    expect(screen.getByText("还没有任务")).toBeTruthy();
    expect(screen.queryByText(/C:\\|\//)).toBeNull();
  });

  it("shows state and read-only labels for task rows", () => {
    render(
      <ThreadList
        {...baseProps}
        threads={[
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            title: "电脑上的任务",
            updatedAt: "2026-08-26T01:00:00.000Z",
            state: "running",
            readOnly: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("电脑上的任务")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("电脑端正在运行 / 只读")).toBeTruthy();
  });

  it("shows pagination only when a next cursor exists", () => {
    render(
      <ThreadList
        {...baseProps}
        nextCursor="cursor-2"
        threads={[
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            title: "第一批任务",
            updatedAt: "2026-08-26T01:00:00.000Z",
            state: "idle",
            readOnly: false,
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "加载更多" })).toBeTruthy();
  });
});
