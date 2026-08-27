import { describe, expect, it, vi } from "vitest";
import { createTrayController, type TrayMenuItem } from "./tray-controller.js";

class FakeTray {
  static instances: FakeTray[] = [];

  readonly setToolTip = vi.fn();
  readonly setContextMenu = vi.fn();
  readonly on = vi.fn();
  readonly destroy = vi.fn();

  constructor(readonly image: unknown) {
    FakeTray.instances.push(this);
  }
}

function setup() {
  FakeTray.instances = [];
  let hostStatus: "stopped" | "running" = "stopped";
  let openAtLogin = true;
  const templates: TrayMenuItem[][] = [];
  const callbacks = {
    openWindow: vi.fn(),
    startHost: vi.fn(),
    stopHost: vi.fn(),
    runDoctor: vi.fn(),
    setOpenAtLogin: vi.fn(),
    exit: vi.fn(),
  };
  const controller = createTrayController({
    createTray: (image) => new FakeTray(image),
    Menu: {
      buildFromTemplate: (template) => {
        templates.push(template);
        return template;
      },
    },
    trayImage: { name: "local-tray-image" },
    getState: () => ({ hostStatus, openAtLogin }),
    callbacks,
  });

  return {
    callbacks,
    controller,
    latestTemplate: () => templates.at(-1) ?? [],
    setHostStatus: (status: "stopped" | "running") => {
      hostStatus = status;
    },
    setOpenAtLogin: (enabled: boolean) => {
      openAtLogin = enabled;
    },
  };
}

describe("tray controller", () => {
  it("retains one Tray reference and installs the complete stopped-state menu", () => {
    const { controller, latestTemplate } = setup();

    const tray = controller.create();

    expect(controller.create()).toBe(tray);
    expect(controller.getTray()).toBe(tray);
    expect(FakeTray.instances).toHaveLength(1);
    expect(tray.setToolTip).toHaveBeenCalledWith("Codex Remote Host");
    expect(latestTemplate().map((item) => item.label ?? item.type)).toEqual([
      "状态：Host 已停止",
      "separator",
      "打开管理窗口",
      "启动 Host",
      "运行 Doctor",
      "开机时启动",
      "separator",
      "退出",
    ]);
    expect(latestTemplate()[0]).toMatchObject({ enabled: false });
    expect(latestTemplate()[5]).toMatchObject({
      type: "checkbox",
      checked: true,
    });
  });

  it("wires menu actions without implementing later-task behavior", () => {
    const { callbacks, controller, latestTemplate } = setup();
    controller.create();
    const template = latestTemplate();

    template[2]?.click?.();
    template[3]?.click?.();
    template[4]?.click?.();
    template[5]?.click?.({ checked: false });
    template[7]?.click?.();

    expect(callbacks.openWindow).toHaveBeenCalledOnce();
    expect(callbacks.startHost).toHaveBeenCalledOnce();
    expect(callbacks.runDoctor).toHaveBeenCalledOnce();
    expect(callbacks.setOpenAtLogin).toHaveBeenCalledWith(false);
    expect(callbacks.exit).toHaveBeenCalledOnce();
  });

  it("refreshes the menu to expose stop Host and the current login setting", () => {
    const {
      callbacks,
      controller,
      latestTemplate,
      setHostStatus,
      setOpenAtLogin,
    } = setup();
    controller.create();
    setHostStatus("running");
    setOpenAtLogin(false);

    controller.refresh();
    const template = latestTemplate();
    template[3]?.click?.();

    expect(template[0]?.label).toBe("状态：Host 运行中");
    expect(template[3]?.label).toBe("停止 Host");
    expect(template[5]).toMatchObject({ checked: false });
    expect(callbacks.stopHost).toHaveBeenCalledOnce();
  });
});
