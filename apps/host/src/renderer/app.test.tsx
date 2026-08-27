// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, DesktopState } from "../desktop/contract.js";
import { App } from "./app.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const stoppedState: DesktopState = {
  phase: "ready",
  authStatus: "signed-out",
  hostStatus: "stopped",
  openAtLogin: false,
  workspace: null,
  notice: "此功能尚未启用",
};

afterEach(() => {
  cleanup();
});

describe("Host renderer", () => {
  it("reads and subscribes to the safe desktop state", async () => {
    let stateListener: ((state: DesktopState) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = {
      getDesktopState: vi.fn(async () => stoppedState),
      subscribeDesktopState: vi.fn((handler: (state: DesktopState) => void) => {
        stateListener = handler;
        return unsubscribe;
      }),
    } as unknown as DesktopApi;
    Object.defineProperty(window, "codexRemoteHost", {
      configurable: true,
      value: api,
    });

    const view = render(<App />);

    expect(await screen.findByText("Host 已停止")).toBeInTheDocument();
    expect(screen.getByText("开机启动：关闭")).toBeInTheDocument();
    stateListener?.({
      ...stoppedState,
      hostStatus: "running",
      openAtLogin: true,
    });
    expect(await screen.findByText("Host 运行中")).toBeInTheDocument();
    expect(screen.getByText("开机启动：开启")).toBeInTheDocument();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
