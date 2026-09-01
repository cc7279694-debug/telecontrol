import { describe, expect, it, vi } from "vitest";
import type {
  DeviceIdentity,
  DeviceIdentityStore,
} from "../device/device-key-store";
import { PairedHostRegistry } from "./paired-host-registry";

function createQuery<T>(
  data: T | null,
  error: { message: string } | null = null,
) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
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
  const identity = Object.hasOwn(options ?? {}, "identity")
    ? (options?.identity ?? null)
    : { deviceId: "device-1" };
  const store = {
    load: vi.fn(async () => identity),
  } as unknown as DeviceIdentityStore;
  return {
    client,
    store,
    linkQuery,
    hostQuery,
    refreshedIdentity: identity
      ? ({ ...identity, ownerId: "owner-1" } as DeviceIdentity)
      : null,
  };
}

function createRegistry(
  fixture: ReturnType<typeof createFixture>,
  refreshSession = vi.fn(async () => fixture.refreshedIdentity),
) {
  return Reflect.construct(PairedHostRegistry, [
    fixture.client,
    fixture.store,
    { refreshSession },
  ]) as PairedHostRegistry;
}

describe("PairedHostRegistry", () => {
  it("refreshes the device session before loading a paired Host", async () => {
    const fixture = createFixture();
    const refreshSession = vi.fn(async () => fixture.refreshedIdentity);
    const registry = createRegistry(fixture, refreshSession);

    await registry.load();

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("loads the current account's active Host link", async () => {
    const fixture = createFixture();

    await expect(createRegistry(fixture).load()).resolves.toEqual({
      hostId: "host-1",
      hostName: "开发电脑",
      deviceId: "device-1",
      protocolVersion: 1,
    });
    expect(fixture.client.from).toHaveBeenNthCalledWith(1, "host_device_links");
    expect(fixture.client.from).toHaveBeenNthCalledWith(2, "hosts");
  });

  it("limits the device lookup to the newest active link", async () => {
    const fixture = createFixture({
      link: { host_id: "host-new", device_id: "device-1", revoked_at: null },
      host: {
        id: "host-new",
        name: "最新开发电脑",
        protocol_version: 1,
        revoked_at: null,
      },
    });

    await expect(createRegistry(fixture).load()).resolves.toMatchObject({
      hostId: "host-new",
      hostName: "最新开发电脑",
    });

    expect(fixture.linkQuery.is).toHaveBeenCalledWith("revoked_at", null);
    expect(fixture.linkQuery.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(fixture.linkQuery.limit).toHaveBeenCalledWith(1);
  });

  it("returns no pair when the device or link is unavailable", async () => {
    const noDevice = createFixture({ identity: null });
    await expect(createRegistry(noDevice).load()).resolves.toBeNull();

    const noLink = createFixture({ link: null });
    await expect(createRegistry(noLink).load()).resolves.toBeNull();

    const revokedLink = createFixture({
      link: {
        host_id: "host-1",
        device_id: "device-1",
        revoked_at: new Date().toISOString(),
      },
    });
    await expect(createRegistry(revokedLink).load()).resolves.toBeNull();
  });

  it("rejects an invalid session, revoked Host, or protocol mismatch", async () => {
    const noClaims = createFixture({ claims: {} });
    await expect(
      createRegistry(
        noClaims,
        vi.fn(async () => {
          throw new Error("登录会话无效，请重新登录");
        }),
      ).load(),
    ).rejects.toThrow("登录会话无效");

    const revokedHost = createFixture({
      host: {
        id: "host-1",
        name: "开发电脑",
        protocol_version: 1,
        revoked_at: new Date().toISOString(),
      },
    });
    await expect(createRegistry(revokedHost).load()).resolves.toBeNull();

    const incompatibleHost = createFixture({
      host: {
        id: "host-1",
        name: "开发电脑",
        protocol_version: 2,
        revoked_at: null,
      },
    });
    await expect(createRegistry(incompatibleHost).load()).rejects.toThrow(
      "协议版本不兼容",
    );
  });
});
