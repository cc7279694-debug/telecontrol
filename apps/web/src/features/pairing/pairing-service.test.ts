// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  deriveAesSessionKey,
  generateP256KeyPair,
  hashPairingCode,
} from "@codex-remote/protocol";
import { PairingService } from "./pairing-service";

describe("PairingService", () => {
  it("consumes a one-time code, derives the host session key, and calls the snapshot hook", async () => {
    const device = await generateP256KeyPair();
    const host = await generateP256KeyPair();
    const rpc = vi.fn(async () => ({
      data: { host_id: "host-1", device_id: "device-1" },
      error: null,
    }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "host-1",
          name: "开发电脑",
          public_key: JSON.stringify(host.publicKey),
          protocol_version: 1,
          revoked_at: null,
        },
        error: null,
      })),
    };
    const client = {
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: "owner-1", session_id: "session-1" } },
          error: null,
        })),
      },
      rpc,
      from: vi.fn(() => query),
    };
    const registry = {
      ensureRegistered: vi.fn(async () => ({
        ownerId: "owner-1",
        deviceId: "device-1",
        privateKey: device.privateKey,
        publicKey: device.publicKey,
      })),
    } as never;
    const onPaired = vi.fn(async () => undefined);
    const service = new PairingService(client as never, registry, onPaired);

    const result = await service.consume({
      hostId: "host-1",
      code: "123456",
      deviceId: "device-1",
    });

    expect(rpc).toHaveBeenCalledWith("consume_pairing_request", {
      p_host_id: "host-1",
      p_code_hash: await hashPairingCode("123456"),
      p_device_id: "device-1",
    });
    await expect(
      deriveAesSessionKey(device.privateKey, host.publicKey),
    ).resolves.toBeInstanceOf(CryptoKey);
    expect(result.hostId).toBe("host-1");
    expect(result.sessionKey).toBeInstanceOf(CryptoKey);
    expect(onPaired).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-1", deviceId: "device-1" }),
    );
  });

  it("rejects malformed and expired pairing codes with concise Chinese errors", async () => {
    const registry = { ensureRegistered: vi.fn() } as never;
    const service = new PairingService({} as never, registry);

    await expect(
      service.consume({
        hostId: "host-1",
        code: "12345",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("请输入6位数字配对码");
  });

  it("maps an expired server pairing error", async () => {
    const registry = {
      ensureRegistered: vi.fn(async () => ({ deviceId: "device-1" })),
    } as never;
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "Pairing request is invalid or expired" },
      })),
    };
    const service = new PairingService(client as never, registry);

    await expect(
      service.consume({
        hostId: "host-1",
        code: "123456",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("配对码无效或已过期");
  });

  it("maps a transport failure without exposing provider details", async () => {
    const registry = {
      ensureRegistered: vi.fn(async () => ({ deviceId: "device-1" })),
    } as never;
    const client = {
      rpc: vi.fn(async () => {
        throw new Error("fetch failed: https://sensitive.example");
      }),
    };
    const service = new PairingService(client as never, registry);

    await expect(
      service.consume({
        hostId: "host-1",
        code: "123456",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("网络连接失败，请稍后重试");
  });
});
