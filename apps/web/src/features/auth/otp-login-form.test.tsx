// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtpLoginForm } from "./otp-login-form";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const routerPush = vi.fn();

vi.mock("../../lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOtp, verifyOtp },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

describe("OtpLoginForm", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    routerPush.mockReset();
  });

  it("rejects an invalid email before requesting a code", async () => {
    const user = userEvent.setup();
    render(<OtpLoginForm />);

    await user.type(screen.getByLabelText("邮箱"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(screen.getByText("请输入有效的邮箱地址")).toBeInTheDocument();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("requests an OTP without creating a new account", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<OtpLoginForm />);

    await user.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.com",
      options: { shouldCreateUser: false },
    });
    expect(screen.getByLabelText("验证码")).toBeInTheDocument();
  });

  it("verifies a six digit code and navigates to hosts", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<OtpLoginForm />);

    await user.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(verifyOtp).toHaveBeenCalledWith({
      email: "owner@example.com",
      token: "123456",
      type: "email",
    });
    expect(routerPush).toHaveBeenCalledWith("/hosts");
  });

  it("translates rate limit errors into a concise Chinese message", async () => {
    signInWithOtp.mockResolvedValue({
      error: {
        message:
          "For security purposes, you can only request this after 60 seconds",
      },
    });
    const user = userEvent.setup();
    render(<OtpLoginForm />);

    await user.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(screen.getByText("请求过于频繁，请稍后再试")).toBeInTheDocument();
  });

  it("shows a loading state while the OTP request is pending", async () => {
    let resolveRequest!: (value: { error: null }) => void;
    signInWithOtp.mockReturnValue(
      new Promise((resolve) => (resolveRequest = resolve)),
    );
    const user = userEvent.setup();
    render(<OtpLoginForm />);

    await user.type(screen.getByLabelText("邮箱"), "owner@example.com");
    const button = screen.getByRole("button", { name: "发送验证码" });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(screen.getByText("发送中…")).toBeInTheDocument();
    resolveRequest({ error: null });
  });
});
