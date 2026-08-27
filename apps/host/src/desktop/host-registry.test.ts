import { describe, expect, it, vi } from "vitest";
import { createHostRegistry, HostRegistryError } from "./host-registry.js";

const publicKey = {
  kty: "EC",
  crv: "P-256",
  x: "public-x",
  y: "public-y",
};

function createFixture(rows: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: undefined,
  } as Record<string, ReturnType<typeof vi.fn> | undefined>;
  query.limit = vi.fn(async () => ({ data: rows, error: null }));
  query.single = vi.fn(async () => ({
    data: {
      id: "host-new",
      name: "Windows Host",
      public_key: JSON.stringify(publicKey),
      protocol_version: 1,
      revoked_at: null,
    },
    error: null,
  }));
  return { client: { from: vi.fn(() => query) }, query };
}

function createRegistry(rows: unknown[]) {
  const fixture = createFixture(rows);
  const registry = createHostRegistry({
    client: fixture.client,
    hostKeyManager: {
      getOrCreate: vi.fn(async () => ({
        privateKeyJwk: { ...publicKey, d: "private-d" },
        publicKeyJwk: publicKey,
      })),
    },
    hostName: "Windows Host",
    version: "0.1.0",
    protocolVersion: 1,
  });
  return { fixture, registry };
}

describe("host registry", () => {
  it("registers the first active Host with its public key", async () => {
    const { fixture, registry } = createRegistry([]);

    await expect(
      registry.ensureRegistered({
        ownerId: "owner-1",
        authSessionId: "session-1",
      }),
    ).resolves.toMatchObject({ id: "host-new", protocolVersion: 1 });
    expect(fixture.query.insert).toHaveBeenCalledWith({
      owner_id: "owner-1",
      auth_session_id: "session-1",
      name: "Windows Host",
      public_key: JSON.stringify(publicKey),
      version: "0.1.0",
      protocol_version: 1,
    });
  });

  it("rejects a second active Host with a different local key", async () => {
    const { registry } = createRegistry([
      {
        id: "host-existing",
        name: "Old Host",
        public_key: JSON.stringify({ ...publicKey, x: "other-x" }),
        protocol_version: 1,
        revoked_at: null,
      },
    ]);

    await expect(
      registry.ensureRegistered({
        ownerId: "owner-1",
        authSessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      code: "HOST_KEY_MISMATCH",
    } satisfies Partial<HostRegistryError>);
  });

  it("rejects protocol mismatch and multiple active Hosts", async () => {
    const mismatch = createRegistry([
      {
        id: "host-existing",
        name: "Old Host",
        public_key: JSON.stringify(publicKey),
        protocol_version: 2,
        revoked_at: null,
      },
    ]);
    await expect(
      mismatch.registry.ensureRegistered({
        ownerId: "owner-1",
        authSessionId: "session-1",
      }),
    ).rejects.toMatchObject({ code: "HOST_PROTOCOL_MISMATCH" });

    const multiple = createRegistry([
      {
        id: "host-1",
        public_key: JSON.stringify(publicKey),
        protocol_version: 1,
      },
      {
        id: "host-2",
        public_key: JSON.stringify(publicKey),
        protocol_version: 1,
      },
    ]);
    await expect(
      multiple.registry.ensureRegistered({
        ownerId: "owner-1",
        authSessionId: "session-1",
      }),
    ).rejects.toMatchObject({ code: "HOST_MULTIPLE_ACTIVE" });
  });
});
