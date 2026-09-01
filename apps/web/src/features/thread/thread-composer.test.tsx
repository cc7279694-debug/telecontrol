// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadComposer } from "./thread-composer";

afterEach(cleanup);

describe("ThreadComposer", () => {
  it("sends with Enter and keeps a newline with Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    render(<ThreadComposer disabled={false} pending={false} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "输入指令" });

    await user.type(input, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "第二行");
    expect((input as HTMLTextAreaElement).value).toBe("第一行\n第二行");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("第一行\n第二行");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("disables input and send while offline or pending", () => {
    render(<ThreadComposer disabled pending onSend={vi.fn()} />);
    expect(
      (screen.getByRole("textbox", { name: "输入指令" }) as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "发送中" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains why a read-only composer cannot be used", () => {
    render(<ThreadComposer disabled={true} pending={false} onSend={vi.fn()} />);

    expect(
      screen.getByText("连接主机或恢复任务后可继续操作"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass(
      "min-w-[72px]",
    );
  });

  it("shows keyboard guidance when the composer is writable", () => {
    render(
      <ThreadComposer disabled={false} pending={false} onSend={vi.fn()} />,
    );

    expect(
      screen.getByText("Enter 发送 · Shift+Enter 换行"),
    ).toBeInTheDocument();
  });
});
