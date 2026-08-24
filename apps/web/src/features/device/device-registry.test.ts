// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { generateP256KeyPair } from "@codex-remote/protocol";
import type { DeviceIdentityStore } from "./device-key-store";
import { DeviceRegistry } from "./device-registry";

function createClient(options: {
  claims?: Record<string, unknown>;
  insertId?: string;
  existing?: {
    id: string;
    public_key: string;
    revoked_at: string | null;
  } | null;
}) {
  const state = { updated: [] as Record<string, unknown>[] };
  const query = {
    insert: vi.fn(() => query),
    update: vi.fn((values: Record<string, unknown>) => {
      state.updated.push(values);
      return query;
    }),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({
      data: {
        id: options.insertId ?? "device-new",
        public_key: '{"kty":"EC"}',
        revoked_at: null,
      },
      error: null,
    })),
    maybeSingle: vi.fn(async () => ({
      data: options.existing ?? null,
      error: null,
    })),
  };
  return {
    state,
    client: {
      auth: {
        getClaims: vi.fn(async () => ({
          data: {
            claims: options.claims ?? {
              sub: "owner-1",
              session_id: "session-1",
            },
          },
          error: null,
        })),
      },
      from: vi.fn(() => query),
    },
  };
}

function createStore(initial: Awaited<ReturnType<typeof generateP256KeyPair>>) {
  let stored: {
    ownerId: string;
    deviceId: string;
    privateKey: CryptoKey;
    publicKey: JsonWebKey;
  } | null = null;
  return {
    store: {
      load: vi.fn(async () => stored),
      save: vi.fn(async (identity) => {
        stored = identity;
      }),
      clear: vi.fn(async () => {
        stored = null;
      }),
    } as unknown as DeviceIdentityStore,
    keyPair: initial,
  };
}

describe("DeviceRegistry", () => {
  it("registers a new browser device with only its public JWK", async () => {
    const keyPair = await generateP256KeyPair();
    const { client } = createClient({ insertId: "device-1" });
    const { store } = createStore(keyPair);
    const registry = new DeviceRegistry(
      client as never,
      store,
      async () => keyPair,
    );

    const identity = await registry.ensureRegistered();

    expect(identity).toMatchObject({
      ownerId: "owner-1",
      deviceId: "device-1",
    });
    expect(identity.privateKey.extractable).toBe(false);
    expect(client.from).toHaveBeenCalledWith("devices");
  });

  it("rebinds an existing device to the verified OTP session", async () => {
    const keyPair = await generateP256KeyPair();
    const { client, state } = createClient({
      existing: {
        id: "device-1",
        public_key: JSON.stringify(keyPair.publicKey),
        revoked_at: null,
      },
    });
    const { store } = createStore(keyPair);
    await store.save({
      ownerId: "owner-1",
      deviceId: "device-1",
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    });
    const registry = new DeviceRegistry(client as never, store);

    await registry.ensureRegistered();

    expect(state.updated).toEqual([
      expect.objectContaining({ auth_session_id: "session-1" }),
    ]);
  });
});
