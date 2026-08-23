import { describe, expect, it } from "vitest";
import {
  createEnvelope,
  type RemoteEnvelope,
} from "../../../packages/protocol/src/index.js";
import {
  SupabaseTransport,
  type SupabaseTransportChannel,
  type SupabaseTransportClient,
  type SupabaseTransportQuery,
  type SupabaseTransportResponse,
} from "./supabase-transport.js";

class FakeChannel implements SupabaseTransportChannel {
  readonly topic: string;
  readonly options: Record<string, unknown>;
  private readonly handlers = new Map<string, (payload: unknown) => void>();
  subscribed = false;
  unsubscribed = false;
  readonly sentMessages: unknown[] = [];

  constructor(topic: string, options: Record<string, unknown>) {
    this.topic = topic;
    this.options = options;
  }

  on(
    event: "broadcast" | "postgres_changes",
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): SupabaseTransportChannel {
    this.handlers.set(`${event}:${String(filter.event ?? "")}`, callback);
    return this;
  }

  subscribe(callback: (status: string) => void): SupabaseTransportChannel {
    this.subscribed = true;
    callback("SUBSCRIBED");
    return this;
  }

  async unsubscribe(): Promise<string> {
    this.unsubscribed = true;
    return "ok";
  }

  async send(message: unknown): Promise<string> {
    this.sentMessages.push(message);
    return "ok";
  }

  pushBroadcast(payload: unknown): void {
    this.handlers.get("broadcast:host.event")?.(payload);
  }
}

class FakeQuery implements SupabaseTransportQuery {
  readonly updates: Record<string, unknown>[] = [];
  readonly inserts: Record<string, unknown>[] = [];
  response: SupabaseTransportResponse<unknown> = { data: null, error: null };
  readonly responses: SupabaseTransportResponse<unknown>[] = [];

  insert(row: Record<string, unknown>): SupabaseTransportQuery {
    this.inserts.push(row);
    return this;
  }

  update(row: Record<string, unknown>): SupabaseTransportQuery {
    this.updates.push(row);
    return this;
  }

  select(): SupabaseTransportQuery {
    return this;
  }

  eq(_column: string, _value: unknown): SupabaseTransportQuery {
    void _column;
    void _value;
    return this;
  }

  async single<T>(): Promise<SupabaseTransportResponse<T>> {
    return (this.responses.shift() ??
      this.response) as SupabaseTransportResponse<T>;
  }

  async maybeSingle<T>(): Promise<SupabaseTransportResponse<T | null>> {
    return (this.responses.shift() ??
      this.response) as SupabaseTransportResponse<T | null>;
  }
}

class FakeClient implements SupabaseTransportClient {
  readonly query = new FakeQuery();
  lastChannel: FakeChannel | undefined;
  rpcResponse: SupabaseTransportResponse<unknown> = { data: null, error: null };
  lastRpc: { name: string; args: Record<string, unknown> } | undefined;

  channel(
    topic: string,
    options: Record<string, unknown>,
  ): SupabaseTransportChannel {
    const channel = new FakeChannel(topic, options);
    this.lastChannel = channel;
    return channel;
  }

  from(): SupabaseTransportQuery {
    return this.query;
  }

  async rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<SupabaseTransportResponse<T>> {
    this.lastRpc = { name, args };
    return this.rpcResponse as SupabaseTransportResponse<T>;
  }
}

const envelope: RemoteEnvelope = createEnvelope({
  hostId: "host-1",
  deviceId: "device-1",
  kind: "turn.start",
  nonce: "nonce",
  ciphertext: "ciphertext",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

describe("SupabaseTransport", () => {
  it("joins a private host channel and enqueues an encrypted command", async () => {
    const client = new FakeClient();
    client.query.response = {
      data: { message_id: envelope.messageId, status: "queued" },
      error: null,
    };
    const transport = new SupabaseTransport(client);

    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "host-process-1",
    });
    const receipt = await transport.enqueue({
      envelope,
      idempotencyKey: "command-1",
    });

    expect(receipt).toEqual({
      messageId: envelope.messageId,
      status: "queued",
      duplicate: false,
    });
    expect(client.query.inserts[0]).toMatchObject({
      owner_id: "owner-1",
      host_id: "host-1",
      device_id: "device-1",
      message_id: envelope.messageId,
      idempotency_key: "command-1",
      kind: "turn.start",
      nonce: "nonce",
      ciphertext: "ciphertext",
      status: "queued",
    });
  });

  it("rejects an envelope addressed to another host or device", async () => {
    const transport = new SupabaseTransport(new FakeClient());
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "host-process-1",
    });

    await expect(
      transport.enqueue({
        envelope: { ...envelope, hostId: "host-2" },
        idempotencyKey: "command-1",
      }),
    ).rejects.toThrow("Envelope recipient does not match transport context");
  });

  it("returns the existing receipt for a duplicate idempotency key", async () => {
    const client = new FakeClient();
    client.query.responses.push(
      { data: null, error: { code: "23505", message: "duplicate key" } },
      {
        data: { message_id: envelope.messageId, status: "queued" },
        error: null,
      },
    );
    const transport = new SupabaseTransport(client);
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "host-process-1",
    });

    await expect(
      transport.enqueue({ envelope, idempotencyKey: "command-1" }),
    ).resolves.toEqual({
      messageId: envelope.messageId,
      status: "queued",
      duplicate: true,
    });
  });

  it("claims the next command with the host lease owner", async () => {
    const client = new FakeClient();
    client.rpcResponse = {
      data: [
        {
          id: "row-1",
          message_id: envelope.messageId,
          host_id: "host-1",
          device_id: "device-1",
          kind: "turn.start",
          nonce: "nonce",
          ciphertext: "ciphertext",
          expires_at: envelope.expiresAt,
          status: "leased",
          lease_owner: "host-process-1",
          lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
        },
      ],
      error: null,
    };
    const transport = new SupabaseTransport(client);
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "host-process-1",
    });

    await expect(transport.claimNextCommand()).resolves.toMatchObject({
      message_id: envelope.messageId,
      status: "leased",
    });
    expect(client.lastRpc).toEqual({
      name: "claim_remote_command",
      args: {
        p_host_id: "host-1",
        p_lease_owner: "host-process-1",
        p_lease_seconds: 30,
      },
    });
  });

  it("sends encrypted events and records a host heartbeat", async () => {
    const client = new FakeClient();
    client.query.response = { data: { id: "host-1" }, error: null };
    const transport = new SupabaseTransport(client);
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "session-host-1",
    });

    const eventEnvelope = createEnvelope({
      hostId: "host-1",
      deviceId: "device-1",
      kind: "stream.delta",
      nonce: "event-nonce",
      ciphertext: "event-ciphertext",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await transport.sendEvent(eventEnvelope);
    await transport.heartbeat();

    expect(client.lastChannel?.sentMessages).toEqual([
      {
        type: "broadcast",
        event: "host.event",
        payload: eventEnvelope,
      },
    ]);
    expect(client.query.updates[0]).toMatchObject({
      last_online_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("completes a command through the guarded host RPC", async () => {
    const client = new FakeClient();
    client.rpcResponse = {
      data: { message_id: envelope.messageId },
      error: null,
    };
    const transport = new SupabaseTransport(client);
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "session-host-1",
    });

    await transport.completeCommand({
      messageId: envelope.messageId,
      status: "completed",
      result: { nonce: "result-nonce", ciphertext: "result-ciphertext" },
    });

    expect(client.lastRpc).toEqual({
      name: "complete_remote_command",
      args: {
        p_host_id: "host-1",
        p_message_id: envelope.messageId,
        p_lease_owner: "session-host-1",
        p_status: "completed",
        p_result_nonce: "result-nonce",
        p_result_ciphertext: "result-ciphertext",
        p_error_code: null,
      },
    });
  });

  it("creates a short-lived pairing request through the guarded host RPC", async () => {
    const client = new FakeClient();
    client.rpcResponse = { data: "pairing-1", error: null };
    const transport = new SupabaseTransport(client);
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "session-host-1",
    });

    const pairing = await transport.createPairingRequest();

    expect(pairing).toMatchObject({
      pairingId: "pairing-1",
      code: expect.stringMatching(/^\d{6}$/),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(pairing.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(pairing.expiresAt)).toBeLessThanOrEqual(
      Date.now() + 5 * 60_000,
    );
    expect(client.lastRpc?.name).toBe("create_pairing_request");
    expect(client.lastRpc?.args).toMatchObject({
      p_host_id: "host-1",
      p_expires_at: pairing.expiresAt,
    });
    expect(client.lastRpc?.args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("forwards broadcast events and closes the private channel", async () => {
    const client = new FakeClient();
    const transport = new SupabaseTransport(client);
    const events: unknown[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.connect({
      hostId: "host-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      leaseOwner: "host-process-1",
    });

    const channel = client.lastChannel;
    if (!channel) {
      throw new Error("Expected a Supabase channel");
    }
    channel.pushBroadcast({ type: "stream.delta", sequence: 1 });
    await transport.disconnect();

    expect(events).toEqual([{ type: "stream.delta", sequence: 1 }]);
    expect(channel.unsubscribed).toBe(true);
  });
});
