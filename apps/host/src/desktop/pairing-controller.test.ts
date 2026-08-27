import { describe, expect, it, vi } from "vitest";
import {
  PairingControllerError,
  createPairingController,
} from "./pairing-controller.js";

function createFixture() {
  let now = Date.parse("2026-08-27T00:00:00.000Z");
  const createPairingRequest = vi.fn(async () => ({
    pairingId: "pairing-1",
    code: "123456",
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
  }));
  const transport = {
    isReady: () => true,
    createPairingRequest,
  };
  const controller = createPairingController({
    isSignedIn: () => true,
    isHostActive: () => true,
    transport,
    now: () => now,
  });
  return {
    controller,
    createPairingRequest,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("pairing controller", () => {
  it("creates a five-minute pairing display without persisting the code", async () => {
    const { controller } = createFixture();

    await expect(controller.create()).resolves.toEqual({
      ok: true,
      message: "配对码已生成",
      pairing: {
        code: "123456",
        expiresAt: "2026-08-27T00:05:00.000Z",
      },
    });
    expect(controller.getSnapshot()).toEqual({
      code: "123456",
      expiresAt: "2026-08-27T00:05:00.000Z",
    });
    expect(controller.getSnapshot()).not.toHaveProperty("pairingId");
  });

  it("expires the local display after five minutes and permits regeneration", async () => {
    const { controller, createPairingRequest, advance } = createFixture();

    await controller.create();
    advance(5 * 60_000);
    expect(controller.getSnapshot()).toBeNull();
    await controller.create();
    expect(createPairingRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects when the Host is not signed in, active, or transport-ready", async () => {
    const cases = [
      { isSignedIn: () => false, message: "请先登录 Host" },
      { isHostActive: () => false, message: "Host 当前不可用" },
      { isTransportReady: () => false, message: "安全连接尚未就绪" },
    ];

    for (const current of cases) {
      const fixture = createFixture();
      const guarded = createPairingController({
        isSignedIn: current.isSignedIn ?? (() => true),
        isHostActive: current.isHostActive ?? (() => true),
        transport: {
          isReady: current.isTransportReady ?? (() => true),
          createPairingRequest: fixture.createPairingRequest,
        },
      });
      await expect(guarded.create()).resolves.toEqual({
        ok: false,
        message: current.message,
        pairing: null,
      });
    }
  });

  it("prevents concurrent pairing requests", async () => {
    let resolveRequest:
      | ((value: {
          pairingId: string;
          code: string;
          expiresAt: string;
        }) => void)
      | undefined;
    const fixture = createFixture();
    fixture.createPairingRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = fixture.controller.create();
    await expect(fixture.controller.create()).resolves.toEqual({
      ok: false,
      message: "配对码正在生成，请稍候",
      pairing: null,
    });
    resolveRequest?.({
      pairingId: "pairing-1",
      code: "123456",
      expiresAt: "2026-08-27T00:05:00.000Z",
    });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("maps transport failures without exposing provider details", async () => {
    const fixture = createFixture();
    fixture.createPairingRequest.mockRejectedValueOnce(
      new Error("secret rpc detail"),
    );

    await expect(fixture.controller.create()).resolves.toEqual({
      ok: false,
      message: "配对码生成失败，请稍后重试",
      pairing: null,
    });
    expect(() => {
      throw new PairingControllerError("PAIRING_NOT_READY");
    }).toThrow("PAIRING_NOT_READY");
  });
});
