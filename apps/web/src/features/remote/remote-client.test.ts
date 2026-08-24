// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  deriveAesSessionKey,
  generateP256KeyPair,
  sealRemotePayload,
} from "@codex-remote/protocol";
import type { DeviceIdentityStore } from "../device/device-key-store";
import { BrowserRemoteClient } from "./remote-client";

function createChannel() {
  let broadcastHandler: ((payload: unknown) => void) | undefined;
  let statusHandler: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn(
      (
        _type: string,
        _filter: Record<string, unknown>,
        handler: (payload: unknown) => void,
      ) => {
        broadcastHandler = handler;
        return channel;
      },
    ),
    subscribe: vi.fn((handler: (status: string) => void) => {
      statusHandler = handler;
      queueMicrotask(() => handler("SUBSCRIBED"));
      return channel;
    }),
    unsubscribe: vi.fn(async () => "ok"),
    emit(payload: unknown) {
      broadcastHandler?.(payload);
    },
    status(status: string) {
      statusHandler?.(status);
    },
  };
  return channel;
}

async function createFixture() {
  const device = await generateP256KeyPair();
  const host = await generateP256KeyPair();
  const channel = createChannel();
  const hostQuery = {
    select: vi.fn(() => hostQuery),
    eq: vi.fn(() => hostQuery),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: "host-1",
        name: "开发电脑",
        public_key: JSON.stringify(host.publicKey),
        revoked_at: null,
      },
      error: null,
    })),
  };
  type CommandResponse = {
    data: { message_id: string; status: string } | null;
    error: { code?: string; message: string } | null;
  };
  const commandQuery = {
    insert: vi.fn((row: Record<string, unknown>) => {
      void row;
      return commandQuery;
    }),
    select: vi.fn((columns?: string) => {
      void columns;
      return commandQuery;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      void column;
      void value;
      return commandQuery;
    }),
    single: vi.fn<() => Promise<CommandResponse>>(async () => ({
      data: { message_id: "message-1", status: "queued" },
      error: null,
    })),
    maybeSingle: vi.fn<() => Promise<CommandResponse>>(async () => ({
      data: null,
      error: null,
    })),
  };
  const client = {
    auth: {
      getClaims: vi.fn(async () => ({
        data: { claims: { sub: "owner-1" } },
        error: null,
      })),
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "access-token" } },
        error: null,
      })),
    },
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn(() => channel),
    from: vi.fn((table: string) =>
      table === "hosts" ? hostQuery : commandQuery,
    ),
  };
  const store = {
    load: vi.fn(async () => ({
      ownerId: "owner-1",
      deviceId: "device-1",
      privateKey: device.privateKey,
      publicKey: device.publicKey,
    })),
  } as unknown as DeviceIdentityStore;
  return { client, channel, store, device, host, commandQuery };
}

describe("BrowserRemoteClient", () => {
  it("sets Realtime auth and subscribes to a private host channel", async () => {
    const fixture = await createFixture();
    const remote = new BrowserRemoteClient(
      fixture.client as never,
      fixture.store,
    );

    await remote.connect({ hostId: "host-1", deviceId: "device-1" });

    expect(fixture.client.realtime.setAuth).toHaveBeenCalledWith(
      "access-token",
    );
    expect(fixture.client.channel).toHaveBeenCalledWith("host:host-1", {
      config: { private: true },
    });
  });

  it("encrypts commands before inserting them and returns duplicate receipts", async () => {
    const fixture = await createFixture();
    const remote = new BrowserRemoteClient(
      fixture.client as never,
      fixture.store,
    );
    await remote.connect({ hostId: "host-1", deviceId: "device-1" });

    const receipt = await remote.enqueue({ type: "host.snapshot" });

    expect(receipt).toEqual({
      messageId: "message-1",
      status: "queued",
      duplicate: false,
    });
    const inserted = fixture.commandQuery.insert.mock.calls[0]?.[0] ?? {};
    expect(inserted).toMatchObject({
      owner_id: "owner-1",
      host_id: "host-1",
      device_id: "device-1",
      kind: "host.snapshot",
      status: "queued",
    });
    expect(inserted.ciphertext).not.toContain("snapshot");

    fixture.commandQuery.single.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    fixture.commandQuery.maybeSingle.mockResolvedValueOnce({
      data: { message_id: "message-existing", status: "queued" },
      error: null,
    });
    await expect(remote.enqueue({ type: "host.snapshot" })).resolves.toEqual({
      messageId: "message-existing",
      status: "queued",
      duplicate: true,
    });
  });

  it("delivers valid events, ignores wrong devices and decryption failures", async () => {
    const fixture = await createFixture();
    const remote = new BrowserRemoteClient(
      fixture.client as never,
      fixture.store,
    );
    const handler = vi.fn();
    remote.subscribe(handler);
    await remote.connect({ hostId: "host-1", deviceId: "device-1" });
    const key = await deriveAesSessionKey(
      fixture.host.privateKey,
      fixture.device.publicKey,
    );
    const event = {
      type: "host.presence" as const,
      hostId: "host-1",
      online: true,
      observedAt: new Date().toISOString(),
    };
    const envelope = await sealRemotePayload({
      key,
      hostId: "host-1",
      deviceId: "device-1",
      payload: event,
    });

    fixture.channel.emit({ payload: envelope });
    fixture.channel.emit({ payload: { ...envelope, deviceId: "device-2" } });
    fixture.channel.emit({
      payload: { ...envelope, ciphertext: `${envelope.ciphertext}x` },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("rejects new commands while offline and disconnects the channel", async () => {
    const fixture = await createFixture();
    const remote = new BrowserRemoteClient(
      fixture.client as never,
      fixture.store,
    );
    await remote.connect({ hostId: "host-1", deviceId: "device-1" });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    await expect(remote.enqueue({ type: "host.snapshot" })).rejects.toThrow(
      "当前处于离线状态",
    );
    await remote.disconnect();
    expect(fixture.channel.unsubscribe).toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });
});
