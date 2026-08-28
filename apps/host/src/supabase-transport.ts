import { hashPairingCode, type RemoteEnvelope } from "@codex-remote/protocol";

export interface SupabaseTransportError {
  code?: string;
  message: string;
}

export interface SupabaseTransportResponse<T> {
  data: T | null;
  error: SupabaseTransportError | null;
}

export interface SupabaseTransportQuery {
  insert(row: Record<string, unknown>): SupabaseTransportQuery;
  update(row: Record<string, unknown>): SupabaseTransportQuery;
  select(columns?: string): SupabaseTransportQuery;
  eq(column: string, value: unknown): SupabaseTransportQuery;
  is(column: string, value: unknown): SupabaseTransportQuery;
  single<T = unknown>(): Promise<SupabaseTransportResponse<T>>;
  maybeSingle<T = unknown>(): Promise<SupabaseTransportResponse<T | null>>;
}

export interface SupabaseTransportRealtime {
  setAuth(accessToken: string): Promise<void>;
}

export interface SupabaseTransportChannel {
  on(
    event: "broadcast" | "postgres_changes",
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): SupabaseTransportChannel;
  subscribe(callback: (status: string) => void): SupabaseTransportChannel;
  send(message: unknown): Promise<string>;
  unsubscribe(): Promise<string>;
}

export interface SupabaseTransportClient {
  channel(
    topic: string,
    options: Record<string, unknown>,
  ): SupabaseTransportChannel;
  from(table: string): SupabaseTransportQuery;
  rpc<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<SupabaseTransportResponse<T>>;
  realtime: SupabaseTransportRealtime;
}

export function asSupabaseTransportClient(
  client: unknown,
): SupabaseTransportClient {
  return client as unknown as SupabaseTransportClient;
}

export interface TransportContext {
  hostId: string;
  deviceId: string;
  ownerId: string;
  /** Supabase Auth JWT session_id used to bind host leases and completions. */
  leaseOwner: string;
}

export interface EnqueueInput {
  envelope: RemoteEnvelope;
  idempotencyKey: string;
}

export interface CommandReceipt {
  messageId: string;
  status: string;
  duplicate: boolean;
}

export interface ClaimedCommand {
  id: string;
  message_id: string;
  host_id: string;
  device_id: string;
  protocol_version: number;
  kind: string;
  sent_at: string;
  nonce: string;
  ciphertext: string;
  expires_at: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
}

export interface HostPresence {
  hostId: string;
  online: boolean;
  observedAt: string;
}

export type SupabaseTransportStatus = "connected" | "offline";

export const TRANSPORT_OFFLINE_CODE = "TRANSPORT_OFFLINE";

export interface PairingRequest {
  pairingId: string;
  code: string;
  expiresAt: string;
}

export interface LinkedDevice {
  id: string;
  public_key: string;
  revoked_at: string | null;
}

export type HostEventHandler = (event: unknown) => void;

const PRESENCE_WINDOW_MS = 30_000;

function transportOfflineError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), {
    code: TRANSPORT_OFFLINE_CODE,
  });
}

export class SupabaseTransport {
  private readonly handlers = new Set<HostEventHandler>();
  private readonly statusHandlers = new Set<
    (status: SupabaseTransportStatus) => void
  >();
  private context: TransportContext | undefined;
  private channel: SupabaseTransportChannel | undefined;
  private pairingHostId: string | undefined;

  constructor(private readonly client: SupabaseTransportClient) {}

  setPairingHostId(hostId: string): void {
    this.pairingHostId = hostId;
  }

  async connect(context: TransportContext): Promise<void> {
    if (this.channel) {
      await this.disconnect();
    }

    this.context = context;
    const channel = this.client.channel(`host:${context.hostId}`, {
      config: { private: true },
    });
    channel.on("broadcast", { event: "host.event" }, (payload) => {
      this.emit(this.unwrapBroadcastPayload(payload));
    });
    this.channel = channel;

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.emitStatus("connected");
          resolve();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          this.emitStatus("offline");
          reject(
            transportOfflineError(
              `Supabase channel subscription failed: ${status}`,
            ),
          );
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    const channel = this.channel;
    this.channel = undefined;
    this.context = undefined;
    if (channel) {
      await channel.unsubscribe();
    }
  }

  async enqueue(input: EnqueueInput): Promise<CommandReceipt> {
    const context = this.requireContext();
    const { envelope, idempotencyKey } = input;

    if (
      envelope.hostId !== context.hostId ||
      envelope.deviceId !== context.deviceId
    ) {
      throw new Error("Envelope recipient does not match transport context");
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      throw new Error("Envelope has expired");
    }
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) {
      throw new Error("Idempotency key must be between 1 and 200 characters");
    }

    const response = await this.client
      .from("remote_commands")
      .insert({
        owner_id: context.ownerId,
        host_id: envelope.hostId,
        device_id: envelope.deviceId,
        message_id: envelope.messageId,
        protocol_version: envelope.protocolVersion,
        kind: envelope.kind,
        sent_at: envelope.sentAt,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        idempotency_key: idempotencyKey,
        status: "queued",
        expires_at: envelope.expiresAt,
      })
      .select("message_id,status")
      .single<{ message_id: string; status: string }>();

    if (!response.error && response.data) {
      return {
        messageId: response.data.message_id,
        status: response.data.status,
        duplicate: false,
      };
    }

    if (response.error?.code !== "23505") {
      throw new Error(response.error?.message ?? "Failed to enqueue command");
    }

    const duplicate = await this.client
      .from("remote_commands")
      .select("message_id,status")
      .eq("host_id", context.hostId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle<{ message_id: string; status: string }>();
    if (duplicate.error || !duplicate.data) {
      throw new Error(
        duplicate.error?.message ?? "Duplicate command could not be read",
      );
    }
    return {
      messageId: duplicate.data.message_id,
      status: duplicate.data.status,
      duplicate: true,
    };
  }

  subscribe(handler: HostEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeStatus(
    handler: (status: SupabaseTransportStatus) => void,
  ): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  async sendEvent(envelope: RemoteEnvelope): Promise<void> {
    const context = this.requireContext();
    if (
      envelope.hostId !== context.hostId ||
      envelope.deviceId !== context.deviceId
    ) {
      throw new Error("Event recipient does not match transport context");
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      throw new Error("Event envelope has expired");
    }
    const result = await this.requireChannel().send({
      type: "broadcast",
      event: "host.event",
      payload: envelope,
    });
    if (result !== "ok") {
      throw new Error(`Supabase broadcast failed: ${result}`);
    }
  }

  async heartbeat(): Promise<void> {
    const context = this.requireContext();
    const now = new Date().toISOString();
    const response = await this.client
      .from("hosts")
      .update({ last_online_at: now, updated_at: now })
      .eq("id", context.hostId)
      .select("id")
      .single<{ id: string }>();
    if (response.error) {
      throw transportOfflineError(response.error.message);
    }
  }

  async getPresence(hostId: string): Promise<HostPresence> {
    const response = await this.client
      .from("hosts")
      .select("id,last_online_at,revoked_at")
      .eq("id", hostId)
      .maybeSingle<{
        id: string;
        last_online_at: string | null;
        revoked_at: string | null;
      }>();
    if (response.error) {
      throw new Error(response.error.message);
    }
    const row = response.data;
    const observedAt = new Date().toISOString();
    if (!row) {
      return { hostId, online: false, observedAt };
    }
    return {
      hostId,
      online:
        row.revoked_at === null &&
        row.last_online_at !== null &&
        Date.now() - Date.parse(row.last_online_at) <= PRESENCE_WINDOW_MS,
      observedAt,
    };
  }

  async getLinkedDevice(deviceId: string): Promise<LinkedDevice | null> {
    const context = this.requireContext();
    const linkResponse = await this.client
      .from("host_device_links")
      .select("device_id,revoked_at")
      .eq("host_id", context.hostId)
      .eq("device_id", deviceId)
      .maybeSingle<{ device_id: string; revoked_at: string | null }>();
    if (linkResponse.error) {
      if (linkResponse.error.code === "PGRST116") {
        throw Object.assign(new Error("Multiple active devices"), {
          code: "MULTIPLE_ACTIVE_DEVICES",
        });
      }
      throw transportOfflineError(linkResponse.error.message);
    }
    if (!linkResponse.data || linkResponse.data.revoked_at !== null) {
      return null;
    }

    const deviceResponse = await this.client
      .from("devices")
      .select("id,public_key,revoked_at")
      .eq("id", deviceId)
      .maybeSingle<LinkedDevice>();
    if (deviceResponse.error) {
      throw transportOfflineError(deviceResponse.error.message);
    }
    if (!deviceResponse.data || deviceResponse.data.revoked_at !== null) {
      return null;
    }
    return deviceResponse.data;
  }

  async findActiveLinkedDevice(hostId: string): Promise<LinkedDevice | null> {
    const linkResponse = await this.client
      .from("host_device_links")
      .select("device_id,revoked_at")
      .eq("host_id", hostId)
      .is("revoked_at", null)
      .maybeSingle<{ device_id: string; revoked_at: string | null }>();
    if (linkResponse.error) {
      if (linkResponse.error.code === "PGRST116") {
        throw Object.assign(new Error("Multiple active devices"), {
          code: "MULTIPLE_ACTIVE_DEVICES",
        });
      }
      throw transportOfflineError(linkResponse.error.message);
    }
    if (!linkResponse.data || linkResponse.data.revoked_at !== null) {
      return null;
    }

    const deviceResponse = await this.client
      .from("devices")
      .select("id,public_key,revoked_at")
      .eq("id", linkResponse.data.device_id)
      .maybeSingle<LinkedDevice>();
    if (deviceResponse.error) {
      throw transportOfflineError(deviceResponse.error.message);
    }
    if (!deviceResponse.data || deviceResponse.data.revoked_at !== null) {
      return null;
    }
    return deviceResponse.data;
  }

  async refreshAccessToken(accessToken: string): Promise<void> {
    const token = accessToken.trim();
    if (!token) {
      throw new Error("Supabase access token is empty");
    }
    await this.client.realtime.setAuth(token);
  }

  async createPairingRequest(): Promise<PairingRequest> {
    const resolvedHostId = this.context?.hostId ?? this.pairingHostId;
    if (!resolvedHostId) {
      throw new Error("Supabase transport Host is not configured");
    }
    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const response = await this.client.rpc<string>("create_pairing_request", {
      p_host_id: resolvedHostId,
      p_code_hash: await hashPairingCode(code),
      p_expires_at: expiresAt,
    });
    if (response.error || !response.data) {
      throw new Error(
        response.error?.message ?? "Failed to create pairing request",
      );
    }
    return { pairingId: response.data, code, expiresAt };
  }

  async claimNextCommand(): Promise<ClaimedCommand | null> {
    const context = this.requireContext();
    const response = await this.client.rpc<ClaimedCommand[]>(
      "claim_remote_command",
      {
        p_host_id: context.hostId,
        p_lease_owner: context.leaseOwner,
        p_lease_seconds: 30,
      },
    );
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.data?.[0] ?? null;
  }

  async completeCommand(input: {
    messageId: string;
    status: "completed" | "failed" | "expired";
    result?: { nonce: string; ciphertext: string };
    errorCode?: string;
  }): Promise<void> {
    const context = this.requireContext();
    const response = await this.client.rpc("complete_remote_command", {
      p_host_id: context.hostId,
      p_message_id: input.messageId,
      p_lease_owner: context.leaseOwner,
      p_status: input.status,
      p_result_nonce: input.result?.nonce ?? null,
      p_result_ciphertext: input.result?.ciphertext ?? null,
      p_error_code: input.errorCode ?? null,
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
  }

  private requireContext(): TransportContext {
    if (!this.context || !this.channel) {
      throw new Error("Supabase transport is not connected");
    }
    return this.context;
  }

  private requireChannel(): SupabaseTransportChannel {
    if (!this.channel) {
      throw new Error("Supabase transport is not connected");
    }
    return this.channel;
  }

  private emit(event: unknown): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private emitStatus(status: SupabaseTransportStatus): void {
    for (const handler of this.statusHandlers) handler(status);
  }

  private unwrapBroadcastPayload(payload: unknown): unknown {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "payload" in payload
    ) {
      return (payload as { payload: unknown }).payload;
    }
    return payload;
  }
}

function createPairingCode(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(random % 1_000_000).padStart(6, "0");
}
