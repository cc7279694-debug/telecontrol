import { describe, expect, it, vi } from "vitest";
import { createLoginItemController } from "./login-item.js";

describe("login item", () => {
  it("sets current-user login startup with the executable and hidden argument", () => {
    const setLoginItemSettings = vi.fn();
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: true }));
    const controller = createLoginItemController(
      { setLoginItemSettings, getLoginItemSettings },
      "C:\\Program Files\\Codex Remote Host\\Host.exe",
    );

    expect(controller.setEnabled(true)).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: "C:\\Program Files\\Codex Remote Host\\Host.exe",
      args: ["--hidden"],
    });
    expect(getLoginItemSettings).toHaveBeenCalledWith({
      path: "C:\\Program Files\\Codex Remote Host\\Host.exe",
      args: ["--hidden"],
    });
  });

  it("uses the same path and args when reading or disabling startup", () => {
    const setLoginItemSettings = vi.fn();
    const getLoginItemSettings = vi
      .fn()
      .mockReturnValueOnce({ openAtLogin: true })
      .mockReturnValueOnce({ openAtLogin: false });
    const controller = createLoginItemController(
      { setLoginItemSettings, getLoginItemSettings },
      "C:\\Host.exe",
    );

    expect(controller.isEnabled()).toBe(true);
    expect(controller.setEnabled(false)).toBe(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      path: "C:\\Host.exe",
      args: ["--hidden"],
    });
    expect(getLoginItemSettings).toHaveBeenNthCalledWith(1, {
      path: "C:\\Host.exe",
      args: ["--hidden"],
    });
    expect(getLoginItemSettings).toHaveBeenNthCalledWith(2, {
      path: "C:\\Host.exe",
      args: ["--hidden"],
    });
  });

  it("reports verification failure when Windows does not apply the requested state", () => {
    const controller = createLoginItemController(
      {
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      },
      "C:\\Host.exe",
    );

    expect(controller.setEnabled(true)).toBe(false);
  });
});
