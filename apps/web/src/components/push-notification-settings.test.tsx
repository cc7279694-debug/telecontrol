// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushNotificationSettings } from "./push-notification-settings";

describe("PushNotificationSettings", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn().mockResolvedValue({
              toJSON: () => ({ endpoint: "https://push.example" }),
            }),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ publicKey: "public-key" }),
      }),
    );
  });

  it("renders a horizontal accessible switch without a wrapping action label", () => {
    render(<PushNotificationSettings deviceId="device-1" />);

    const switchControl = screen.getByRole("switch", { name: "锁屏通知" });

    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(switchControl).toHaveAttribute("data-state", "unchecked");
    expect(switchControl).toHaveClass("shrink-0");
    expect(switchControl).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("未开启")).toBeInTheDocument();
    expect(screen.queryByText("开启", { selector: "button" })).toBeNull();
  });

  it("updates the switch state after the push subscription is saved", async () => {
    const user = userEvent.setup();
    render(<PushNotificationSettings deviceId="device-1" />);

    await user.click(screen.getByRole("switch", { name: "锁屏通知" }));

    expect(screen.getByRole("switch", { name: "锁屏通知" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "锁屏通知" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByText("已开启")).toBeInTheDocument();
  });

  it("disables the switch while notification setup is in progress", async () => {
    let resolvePermission = (permission: NotificationPermission) => {
      void permission;
    };
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn(
        () =>
          new Promise<NotificationPermission>((resolve) => {
            resolvePermission = resolve;
          }),
      ),
    });
    const user = userEvent.setup();
    render(<PushNotificationSettings deviceId="device-1" />);

    const switchControl = screen.getByRole("switch", { name: "锁屏通知" });
    await user.click(switchControl);

    expect(switchControl).toBeDisabled();
    expect(screen.getByText("处理中")).toBeInTheDocument();

    resolvePermission("denied");
  });
});
