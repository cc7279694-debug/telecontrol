// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PairingForm } from "./pairing-form";

describe("PairingForm", () => {
  afterEach(() => cleanup());

  it("submits host id and six-digit code", async () => {
    const user = userEvent.setup();
    const consume = vi.fn(async () => ({ hostId: "host-1" }));
    render(<PairingForm consume={consume} />);

    await user.type(screen.getByLabelText("电脑 ID"), "host-1");
    await user.type(screen.getByLabelText("配对码"), "123456");
    await user.click(screen.getByRole("button", { name: "开始配对" }));

    expect(consume).toHaveBeenCalledWith({ hostId: "host-1", code: "123456" });
  });

  it("shows a local validation message before calling the service", async () => {
    const user = userEvent.setup();
    const consume = vi.fn();
    render(<PairingForm consume={consume} />);

    await user.click(screen.getByRole("button", { name: "开始配对" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请填写电脑 ID");
    expect(consume).not.toHaveBeenCalled();
  });
});
