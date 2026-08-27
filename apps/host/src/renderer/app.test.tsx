// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { DesktopApi, DesktopState } from "../desktop/contract.js";
import { App } from "./app.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const stoppedState: DesktopState = {
  phase: "ready",
  authStatus: "signed-out",
  hostStatus: "stopped",
  openAtLogin: false,
  workspaces: [],
  pairing: null,
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

  it("locks the OTP button while the request is pending", async () => {
    let resolveOtp:
      ((result: { ok: boolean; message: string }) => void) | undefined;
    const api = {
      getDesktopState: vi.fn(async () => stoppedState),
      subscribeDesktopState: vi.fn(() => vi.fn()),
      requestOtp: vi.fn(
        () =>
          new Promise<{ ok: boolean; message: string }>((resolve) => {
            resolveOtp = resolve;
          }),
      ),
    } as unknown as DesktopApi;
    Object.defineProperty(window, "codexRemoteHost", {
      configurable: true,
      value: api,
    });

    render(<App />);
    const user = userEvent.setup();
    const emailInput = await screen.findByLabelText("邮箱");
    await user.type(emailInput, "demo@example.com");
    const button = screen.getByRole("button", { name: "发送验证码" });
    await user.click(button);

    expect(button).toBeDisabled();
    resolveOtp?.({ ok: true, message: "验证码已发送" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "完成登录" })).toBeEnabled(),
    );
  });

  it("shows authorized projects and the pairing code controls for a signed-in Host", async () => {
    const signedInState: DesktopState = {
      ...stoppedState,
      authStatus: "signed-in",
      host: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Windows Host",
        protocolVersion: 1,
      },
      workspaces: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "演示项目",
          path: "C:\\Projects\\demo",
        },
      ],
      pairing: null,
    };
    const api = {
      getDesktopState: vi.fn(async () => signedInState),
      subscribeDesktopState: vi.fn(() => vi.fn()),
      createPairingCode: vi.fn(async () => ({
        ok: true,
        message: "配对码已生成",
      })),
    } as unknown as DesktopApi;
    Object.defineProperty(window, "codexRemoteHost", {
      configurable: true,
      value: api,
    });

    render(<App />);

    expect(await screen.findByText("演示项目")).toBeInTheDocument();
    expect(screen.getByText("C:\\Projects\\demo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "生成配对码" }),
    ).toBeInTheDocument();
  });

  it("renders a pairing code and expiry when the Host publishes one", async () => {
    const pairingState: DesktopState = {
      ...stoppedState,
      authStatus: "signed-in",
      host: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Windows Host",
        protocolVersion: 1,
      },
      pairing: {
        code: "123456",
        expiresAt: "2026-08-27T00:05:00.000Z",
      },
    };
    const api = {
      getDesktopState: vi.fn(async () => pairingState),
      subscribeDesktopState: vi.fn(() => vi.fn()),
    } as unknown as DesktopApi;
    Object.defineProperty(window, "codexRemoteHost", {
      configurable: true,
      value: api,
    });

    render(<App />);

    expect(await screen.findByText("123456")).toBeInTheDocument();
    expect(screen.getByText(/配对码有效期/)).toBeInTheDocument();
  });
});
