import { describe, expect, it, vi } from "vitest";
import type { DeviceIdentityStore } from "../device/device-key-store";
import { PairedHostRegistry } from "./paired-host-registry";

function createQuery<T>(
  data: T | null,
  error: { message: string } | null = null,
) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return query;
}

function createFixture(options?: {
  claims?: Record<string, unknown>;
  identity?: object | null;
  link?: object | null;
  host?: object | null;
  linkError?: { message: string } | null;
}) {
  const link = Object.hasOwn(options ?? {}, "link")
    ? (options?.link ?? null)
    : { host_id: "host-1", device_id: "device-1", revoked_at: null };
  const host = Object.hasOwn(options ?? {}, "host")
    ? (options?.host ?? null)
    : { id: "host-1", name: "开发电脑", protocol_version: 1, revoked_at: null };
  const linkQuery = createQuery(link, options?.linkError ?? null);
  const hostQuery = createQuery(host);
  const client = {
    auth: {
      getClaims: vi.fn(async () => ({
        data: { claims: options?.claims ?? { sub: "owner-1" } },
        error: null,
      })),
    },
    from: vi.fn((table: string) =>
      table === "host_device_links" ? linkQuery : hostQuery,
    ),
  };
  const store = {
    load: vi.fn(async () =>
      Object.hasOwn(options ?? {}, "identity")
        ? (options?.identity ?? null)
        : { deviceId: "device-1" },
    ),
  } as unknown as DeviceIdentityStore;
  return { client, store, linkQuery, hostQuery };
}

describe("PairedHostRegistry", () => {
  it("loads the current account's active Host link", async () => {
    const fixture = createFixture();

    await expect(
      new PairedHostRegistry(fixture.client as never, fixture.store).load(),
    ).resolves.toEqual({
      hostId: "host-1",
      hostName: "开发电脑",
      deviceId: "device-1",
      protocolVersion: 1,
    });
    expect(fixture.client.from).toHaveBeenNthCalledWith(1, "host_device_links");
    expect(fixture.client.from).toHaveBeenNthCalledWith(2, "hosts");
  });

  it("returns no pair when the device or link is unavailable", async () => {
    const noDevice = createFixture({ identity: null });
    await expect(
      new PairedHostRegistry(noDevice.client as never, noDevice.store).load(),
    ).resolves.toBeNull();

    const noLink = createFixture({ link: null });
    await expect(
      new PairedHostRegistry(noLink.client as never, noLink.store).load(),
    ).resolves.toBeNull();

    const revokedLink = createFixture({
      link: {
        host_id: "host-1",
        device_id: "device-1",
        revoked_at: new Date().toISOString(),
      },
    });
    await expect(
      new PairedHostRegistry(
        revokedLink.client as never,
        revokedLink.store,
      ).load(),
    ).resolves.toBeNull();
  });

  it("rejects an invalid session, revoked Host, or protocol mismatch", async () => {
    const noClaims = createFixture({ claims: {} });
    await expect(
      new PairedHostRegistry(noClaims.client as never, noClaims.store).load(),
    ).rejects.toThrow("登录会话无效");

    const revokedHost = createFixture({
      host: {
        id: "host-1",
        name: "开发电脑",
        protocol_version: 1,
        revoked_at: new Date().toISOString(),
      },
    });
    await expect(
      new PairedHostRegistry(
        revokedHost.client as never,
        revokedHost.store,
      ).load(),
    ).resolves.toBeNull();

    const incompatibleHost = createFixture({
      host: {
        id: "host-1",
        name: "开发电脑",
        protocol_version: 2,
        revoked_at: null,
      },
    });
    await expect(
      new PairedHostRegistry(
        incompatibleHost.client as never,
        incompatibleHost.store,
      ).load(),
    ).rejects.toThrow("协议版本不兼容");
  });
});
