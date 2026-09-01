// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacesScreen } from "./workspaces-screen.js";

afterEach(cleanup);

describe("WorkspacesScreen", () => {
  it("shows an explicit confirmation and removes a workspace after confirmation", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <WorkspacesScreen
        workspaces={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "演示项目",
            path: "C:\\Projects\\demo",
          },
        ]}
        disabled={false}
        onChoose={vi.fn()}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "移除" }));
    expect(screen.getByText("确定移除“演示项目”？")).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认移除" }));
    expect(onRemove).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
