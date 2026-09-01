// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadComposer } from "./thread-composer";
import type { RemoteModelSummary } from "@codex-remote/protocol";

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

  it("lets the user choose a model and reasoning effort for a new turn", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => undefined);
    const models: RemoteModelSummary[] = [
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "通用模型",
        isDefault: true,
        defaultReasoningEffort: "medium",
        reasoningEfforts: [
          { reasoningEffort: "medium", description: "平衡" },
          { reasoningEffort: "high", description: "更深入" },
        ],
      },
    ];
    render(
      <ThreadComposer
        disabled={false}
        pending={false}
        activeTurn={false}
        models={models}
        onSend={onSend}
      />,
    );

    expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue(
      "gpt-5.5",
    );
    expect(screen.getByRole("combobox", { name: "思考程度" })).toHaveValue(
      "medium",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "思考程度" }),
      "high",
    );
    await user.type(
      screen.getByRole("textbox", { name: "输入指令" }),
      "检查状态",
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("检查状态", {
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
  });
});
