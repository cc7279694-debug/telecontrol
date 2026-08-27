// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PairingScreen } from "./pairing-screen.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PairingScreen", () => {
  it("shows the computer ID alongside the pairing code", () => {
    render(
      <PairingScreen
        host={{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Windows Host",
          protocolVersion: 1,
        }}
        pairing={{
          code: "123456",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }}
        disabled={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("电脑 ID")).toBeInTheDocument();
    expect(
      screen.getByText("11111111-1111-4111-8111-111111111111"),
    ).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
  });

  it("hides an expired pairing code and shows a live countdown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T00:00:00.000Z"));
    render(
      <PairingScreen
        host={null}
        pairing={{
          code: "123456",
          expiresAt: "2026-08-27T00:05:00.000Z",
        }}
        disabled={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/剩余 05:00/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(screen.getByText("配对码已过期，请重新生成")).toBeInTheDocument();
  });
});
