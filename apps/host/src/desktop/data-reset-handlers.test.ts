import { describe, expect, it, vi } from "vitest";
import { createDataResetHandlers } from "./data-reset-handlers.js";

describe("data reset desktop handlers", () => {
  it("delegates both IPC operations to the local reset controller", async () => {
    const controller = {
      begin: vi.fn(() => ({ phrase: "确认删除-7314" })),
      confirm: vi.fn(async ({ phrase }: { phrase: string }) => {
        if (phrase === "确认删除-7314") {
          return { ok: true as const, message: "本机数据已删除" };
        }
        return { ok: false as const, message: "确认短语不正确" };
      }),
    };

    const handlers = createDataResetHandlers(controller);

    await expect(handlers.beginDataReset()).resolves.toEqual({
      phrase: "确认删除-7314",
    });
    await expect(
      handlers.confirmDataReset({ phrase: "确认删除-7314" }),
    ).resolves.toEqual({
      ok: true,
      message: "本机数据已删除",
    });
    expect(controller.begin).toHaveBeenCalledOnce();
    expect(controller.confirm).toHaveBeenCalledWith({
      phrase: "确认删除-7314",
    });
  });
});
