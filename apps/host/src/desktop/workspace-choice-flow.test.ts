import { describe, expect, it, vi } from "vitest";
import { runWorkspaceChoice } from "./workspace-choice-flow.js";

describe("workspace choice flow", () => {
  it("opens the directory picker before registering the host", async () => {
    const events: string[] = [];

    const result = await runWorkspaceChoice({
      showDirectoryDialog: async () => {
        events.push("dialog");
        return { canceled: false, filePaths: ["C:\\project"] };
      },
      hasRegisteredHost: () => false,
      registerHost: async () => {
        events.push("register");
        return { ok: true, message: "Host 已连接到账号" };
      },
      addDirectory: async () => {
        events.push("add");
        return { ok: true, message: "项目已添加" };
      },
    });

    expect(result).toEqual({ ok: true, message: "项目已添加" });
    expect(events).toEqual(["dialog", "register", "add"]);
  });

  it("does not register or add a workspace when the picker is cancelled", async () => {
    const registerHost = vi.fn(async () => ({ ok: true, message: "已连接" }));
    const addDirectory = vi.fn(async () => ({ ok: true, message: "已添加" }));

    const result = await runWorkspaceChoice({
      showDirectoryDialog: async () => ({ canceled: true, filePaths: [] }),
      hasRegisteredHost: () => false,
      registerHost,
      addDirectory,
    });

    expect(result).toEqual({ ok: false, message: "已取消添加项目" });
    expect(registerHost).not.toHaveBeenCalled();
    expect(addDirectory).not.toHaveBeenCalled();
  });

  it("returns registration errors after the user selected a directory", async () => {
    const addDirectory = vi.fn(async () => ({ ok: true, message: "已添加" }));

    const result = await runWorkspaceChoice({
      showDirectoryDialog: async () => ({
        canceled: false,
        filePaths: ["C:\\project"],
      }),
      hasRegisteredHost: () => false,
      registerHost: async () => ({
        ok: false,
        message: "无法保存 Host 注册状态",
      }),
      addDirectory,
    });

    expect(result).toEqual({ ok: false, message: "无法保存 Host 注册状态" });
    expect(addDirectory).not.toHaveBeenCalled();
  });
});
