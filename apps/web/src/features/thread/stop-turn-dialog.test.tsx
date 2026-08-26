// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StopTurnDialog } from "./stop-turn-dialog";

afterEach(cleanup);

describe("StopTurnDialog", () => {
  it("requires a second confirmation before stopping", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    render(
      <StopTurnDialog
        open
        pending={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("停止后，本次正在生成的内容会中断")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认停止" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
