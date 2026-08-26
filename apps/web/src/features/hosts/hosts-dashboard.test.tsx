// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostsDashboard } from "./hosts-dashboard";

const useRemoteSession = vi.fn();
const useRemote = vi.fn();
const useThreadList = vi.fn();

vi.mock("../session/remote-session-context", () => ({
  useRemoteSession: () => useRemoteSession(),
}));
vi.mock("../remote/remote-client-context", () => ({
  useRemote: () => useRemote(),
}));
vi.mock("../threads/use-thread-list", () => ({
  useThreadList: () => useThreadList(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const host = {
  hostId: "host-1",
  hostName: "开发电脑",
  deviceId: "device-1",
  protocolVersion: 1,
};

const baseRemoteState = {
  hostSnapshot: {
    hostId: "host-1",
    name: "开发电脑",
    online: true,
    observedAt: "2026-08-26T01:00:00.000Z",
    workspaces: [{ id: "workspace-1", name: "远程项目" }],
  },
  online: true,
  observedAt: "2026-08-26T01:00:00.000Z",
  error: null,
};

describe("HostsDashboard", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useRemoteSession.mockReset();
    useRemote.mockReset();
    useThreadList.mockReset();
    useThreadList.mockReturnValue({
      threads: [],
      loading: false,
      loadingMore: false,
      nextCursor: null,
      error: null,
      reload: vi.fn(),
      loadMore: vi.fn(),
    });
  });

  it("guides the user to pair a computer when no active pair exists", () => {
    useRemoteSession.mockReturnValue({ state: { status: "unpaired" } });

    render(<HostsDashboard />);

    expect(screen.getByText("还没有连接电脑")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "添加 Windows 电脑" })
        .getAttribute("href"),
    ).toBe("/pair");
  });

  it("shows the Host, workspace, and empty task state when ready", () => {
    useRemoteSession.mockReturnValue({ state: { status: "ready", host } });
    useRemote.mockReturnValue({ state: baseRemoteState, client: {} });

    render(<HostsDashboard />);

    expect(screen.getByText("开发电脑")).toBeTruthy();
    expect(screen.getByText("在线")).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: "授权项目" }) as HTMLSelectElement)
        .value,
    ).toBe("workspace-1");
    expect(screen.getByText("还没有任务")).toBeTruthy();
  });

  it("disables new task creation while the Host is offline", () => {
    useRemoteSession.mockReturnValue({
      state: { status: "offline", host, message: "电脑当前离线" },
    });
    useRemote.mockReturnValue({
      state: { ...baseRemoteState, online: false },
      client: {},
    });

    render(<HostsDashboard />);

    expect(screen.getByText("电脑当前离线")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "新建任务" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
