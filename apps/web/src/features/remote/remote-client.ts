import {
  deriveAesSessionKey,
  openRemotePayload,
  sealRemotePayload,
  type RemoteCommand,
  type RemoteEnvelope,
  type RemoteEvent,
  type HostSnapshot,
} from "@codex-remote/protocol";
import type { DeviceIdentityStore } from "../device/device-key-store";
import { REMOTE_COMMAND_RESPONSE_TIMEOUT_MS } from "./remote-timeouts";

export interface CommandReceipt {
  messageId: string;
  status: string;
  duplicate: boolean;
}

export interface HostPresence {
  hostId: string;
  online: boolean;
  observedAt: string;
}

export interface EnqueueOptions {
  idempotencyKey?: string;
}

interface QueryResponse<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

interface RemoteQuery {
  insert(row: Record<string, unknown>): RemoteQuery;
  select(columns?: string): RemoteQuery;
  eq(column: string, value: unknown): RemoteQuery;
  single<T = unknown>(): Promise<QueryResponse<T>>;
  maybeSingle<T = unknown>(): Promise<QueryResponse<T | null>>;
}

interface RemoteSupabaseClient {
  auth: {
    getClaims(): Promise<{
      data: { claims?: Record<string, unknown> } | null;
      error: { message: string } | null;
    }>;
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
  };
  realtime: { setAuth(jwt: string): Promise<void> | void };
  channel(topic: string, options: Record<string, unknown>): RemoteChannel;
  from(table: string): RemoteQuery;
}

interface RemoteChannel {
  on(
    event: "broadcast",
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): RemoteChannel;
  subscribe(callback: (status: string) => void): RemoteChannel;
  unsubscribe(): Promise<string>;
}

interface HostKeyRow {
  id: string;
  public_key: string;
  revoked_at: string | null;
}

interface PresenceRow {
  id: string;
  last_online_at: string | null;
  revoked_at: string | null;
}

interface ConnectionContext {
  ownerId: string;
  hostId: string;
  deviceId: string;
  key: CryptoKey;
}

export interface RemoteClient {
  connect(input: { hostId: string; deviceId: string }): Promise<void>;
  disconnect(): Promise<void>;
  enqueue(
    command: RemoteCommand,
    options?: EnqueueOptions,
  ): Promise<CommandReceipt>;
  subscribe(handler: (event: RemoteEvent) => void): () => void;
  getPresence(hostId: string): Promise<HostPresence>;
  requestSnapshot(): Promise<CommandReceipt>;
  requestSnapshotAndWait(timeoutMs?: number): Promise<HostSnapshot>;
}

const PRESENCE_WINDOW_MS = 30_000;

export class BrowserRemoteClient implements RemoteClient {
  private context: ConnectionContext | undefined;
  private channel: RemoteChannel | undefined;
  private readonly handlers = new Set<(event: RemoteEvent) => void>();
  private readonly sequences = new Map<string, number>();
  private recovering = false;
  private connected = false;
  private connectAttempt = 0;
  private connectionInput: { hostId: string; deviceId: string } | undefined;
  private lifecycleListeners:
    { onOnline: () => void; onVisibilityChange: () => void } | undefined;

  constructor(
    private readonly client: RemoteSupabaseClient,
    private readonly deviceStore: DeviceIdentityStore,
    private readonly commandTtlMs = 30_000,
  ) {}

  async connect(input: { hostId: string; deviceId: string }): Promise<void> {
    const attempt = ++this.connectAttempt;
    await this.disconnectInternal();
    this.assertCurrentAttempt(attempt);
    this.connectionInput = input;
    const claimsResponse = await this.client.auth.getClaims();
    this.assertCurrentAttempt(attempt);
    const ownerId = claimsResponse.data?.claims?.sub;
    if (claimsResponse.error || typeof ownerId !== "string") {
      throw new Error("登录会话无效，请重新登录");
    }

    const identity = await this.deviceStore.load(ownerId);
    this.assertCurrentAttempt(attempt);
    if (!identity || identity.deviceId !== input.deviceId) {
      throw new Error("设备未注册，请先完成配对");
    }

    const hostResponse = await this.client
      .from("hosts")
      .select("id,public_key,revoked_at")
      .eq("id", input.hostId)
      .maybeSingle<HostKeyRow>();
    this.assertCurrentAttempt(attempt);
    if (
      hostResponse.error ||
      !hostResponse.data ||
      hostResponse.data.revoked_at !== null
    ) {
      throw new Error("电脑不存在或已撤销");
    }

    let hostPublicKey: JsonWebKey;
    try {
      hostPublicKey = JSON.parse(hostResponse.data.public_key) as JsonWebKey;
    } catch {
      throw new Error("电脑密钥无效，请重新配对");
    }
    const key = await deriveAesSessionKey(identity.privateKey, hostPublicKey);
    const sessionResponse = await this.client.auth.getSession();
    this.assertCurrentAttempt(attempt);
    const accessToken = sessionResponse.data.session?.access_token;
    if (sessionResponse.error || !accessToken) {
      throw new Error("登录会话已失效，请重新登录");
    }
    await this.client.realtime.setAuth(accessToken);
    this.assertCurrentAttempt(attempt);

    const channel = this.client.channel(`host:${input.hostId}`, {
      config: { private: true },
    });
    channel.on("broadcast", { event: "host.event" }, (payload) => {
      void this.handleBroadcast(payload);
    });
    this.context = {
      ownerId,
      hostId: input.hostId,
      deviceId: input.deviceId,
      key,
    };
    this.channel = channel;

    try {
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            this.connected = true;
            this.attachLifecycleListeners();
            resolve();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) {
              void this.recoverConnection();
            } else {
              reject(new Error(`实时连接失败：${status}`));
            }
          }
        });
      });
      this.assertCurrentAttempt(attempt);
    } catch (error) {
      if (attempt !== this.connectAttempt) {
        await channel.unsubscribe();
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    ++this.connectAttempt;
    await this.disconnectInternal();
  }

  private async disconnectInternal(): Promise<void> {
    const channel = this.channel;
    this.channel = undefined;
    this.context = undefined;
    this.connected = false;
    this.connectionInput = undefined;
    this.removeLifecycleListeners();
    this.sequences.clear();
    if (channel) {
      await channel.unsubscribe();
    }
  }

  private assertCurrentAttempt(attempt: number): void {
    if (attempt !== this.connectAttempt) {
      throw new Error("远程连接已被新的连接请求替代");
    }
  }

  async enqueue(
    command: RemoteCommand,
    options?: EnqueueOptions,
  ): Promise<CommandReceipt> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("当前处于离线状态，请联网后重试");
    }
    const context = this.requireContext();
    const envelope = await sealRemotePayload({
      key: context.key,
      hostId: context.hostId,
      deviceId: context.deviceId,
      payload: command,
      ttlMs: this.commandTtlMs,
    });
    const idempotencyKey =
      options?.idempotencyKey ?? `web:${envelope.messageId}`;
    return this.insertEnvelope(envelope, idempotencyKey);
  }

  subscribe(handler: (event: RemoteEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async getPresence(hostId: string): Promise<HostPresence> {
    const response = await this.client
      .from("hosts")
      .select("id,last_online_at,revoked_at")
      .eq("id", hostId)
      .maybeSingle<PresenceRow>();
    const observedAt = new Date().toISOString();
    if (response.error || !response.data) {
      return { hostId, online: false, observedAt };
    }
    const lastOnline = response.data.last_online_at
      ? Date.parse(response.data.last_online_at)
      : Number.NaN;
    return {
      hostId,
      online:
        response.data.revoked_at === null &&
        Number.isFinite(lastOnline) &&
        Date.now() - lastOnline <= PRESENCE_WINDOW_MS,
      observedAt,
    };
  }

  async requestSnapshot(): Promise<CommandReceipt> {
    return this.enqueue({ type: "host.snapshot" });
  }

  requestSnapshotAndWait(
    timeoutMs = REMOTE_COMMAND_RESPONSE_TIMEOUT_MS,
  ): Promise<HostSnapshot> {
    return new Promise<HostSnapshot>((resolve, reject) => {
      let requestMessageId: string | undefined;
      let earlyResponse:
        Extract<RemoteEvent, { type: "host.snapshot.result" }> | undefined;
      let settled = false;
      let unsubscribe: () => void = () => undefined;

      const cleanup = () => {
        unsubscribe();
        if (timer) {
          clearTimeout(timer);
        }
      };
      const succeed = (snapshot: HostSnapshot) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("快照获取失败"));
      };

      unsubscribe = this.subscribe((event) => {
        if (event.type !== "host.snapshot.result") {
          return;
        }
        if (!requestMessageId) {
          earlyResponse = event;
          return;
        }
        if (event.requestMessageId === requestMessageId) {
          succeed(event.snapshot);
        }
      });
      const timer = setTimeout(
        () => fail(new Error("电脑快照响应超时，请重试")),
        timeoutMs,
      );

      void this.requestSnapshot()
        .then((receipt) => {
          requestMessageId = receipt.messageId;
          if (earlyResponse?.requestMessageId === requestMessageId) {
            succeed(earlyResponse.snapshot);
          }
        })
        .catch(fail);
    });
  }

  private async insertEnvelope(
    envelope: RemoteEnvelope,
    idempotencyKey: string,
  ): Promise<CommandReceipt> {
    const context = this.requireContext();
    const response = await this.client
      .from("remote_commands")
      .insert({
        owner_id: context.ownerId,
        host_id: context.hostId,
        device_id: context.deviceId,
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
      throw new Error(response.error?.message ?? "命令发送失败，请重试");
    }

    const duplicate = await this.client
      .from("remote_commands")
      .select("message_id,status")
      .eq("host_id", context.hostId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle<{ message_id: string; status: string }>();
    if (duplicate.error || !duplicate.data) {
      throw new Error("重复命令状态无法确认，请稍后查看电脑状态");
    }
    return {
      messageId: duplicate.data.message_id,
      status: duplicate.data.status,
      duplicate: true,
    };
  }

  private async handleBroadcast(payload: unknown): Promise<void> {
    const envelope = unwrapEnvelope(payload);
    const context = this.context;
    if (
      !context ||
      !envelope ||
      envelope.hostId !== context.hostId ||
      envelope.deviceId !== context.deviceId
    ) {
      return;
    }
    try {
      const event = await openRemotePayload<RemoteEvent>({
        key: context.key,
        envelope,
      });
      if (event.type === "stream.delta") {
        const sequenceKey = `${event.threadId}:${event.turnId}`;
        const previous = this.sequences.get(sequenceKey);
        if (previous !== undefined && event.sequence > previous + 1) {
          void this.recoverSnapshot();
        }
        if (previous !== undefined && event.sequence <= previous) {
          return;
        }
        this.sequences.set(sequenceKey, event.sequence);
      }
      for (const handler of this.handlers) {
        handler(event);
      }
    } catch {
      // Invalid, expired, or tampered Broadcast events are ignored.
    }
  }

  private async recoverSnapshot(): Promise<void> {
    if (this.recovering) {
      return;
    }
    this.recovering = true;
    try {
      await this.requestSnapshot();
    } catch {
      // The next reconnect or tab-resume attempt will retry recovery.
    } finally {
      this.recovering = false;
    }
  }

  private async recoverConnection(): Promise<void> {
    if (this.recovering || !this.connectionInput) {
      return;
    }
    this.recovering = true;
    const input = this.connectionInput;
    try {
      if (!this.connected || !this.channel) {
        await this.connect(input);
      }
      await this.requestSnapshot();
    } catch {
      // The next online or tab-resume event can retry recovery.
    } finally {
      this.recovering = false;
    }
  }

  private attachLifecycleListeners(): void {
    if (typeof window === "undefined" || this.lifecycleListeners) {
      return;
    }
    const onOnline = () => void this.recoverConnection();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void this.recoverConnection();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    this.lifecycleListeners = { onOnline, onVisibilityChange };
  }

  private removeLifecycleListeners(): void {
    if (typeof window === "undefined" || !this.lifecycleListeners) {
      return;
    }
    const { onOnline, onVisibilityChange } = this.lifecycleListeners;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    this.lifecycleListeners = undefined;
  }

  private requireContext(): ConnectionContext {
    if (!this.context || !this.channel) {
      throw new Error("尚未连接电脑");
    }
    return this.context;
  }
}

function unwrapEnvelope(payload: unknown): RemoteEnvelope | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = "payload" in payload ? payload.payload : payload;
  return candidate && typeof candidate === "object"
    ? (candidate as RemoteEnvelope)
    : null;
}
