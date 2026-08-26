import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  deriveAesSessionKey,
  generateP256KeyPair,
  hashPairingCode,
  openRemotePayload,
  sealRemotePayload,
  type HostSnapshot,
  type RemoteCommand,
  type RemoteEnvelope,
  type RemoteEvent,
  type RemoteThreadSnapshot,
  type RemoteThreadSummary,
} from "@codex-remote/protocol";
import type { LocalSupabaseEnv } from "./local-supabase";

interface CommandRow {
  id: string;
  message_id: string;
  host_id: string;
  device_id: string;
  protocol_version: number;
  kind: string;
  sent_at: string;
  expires_at: string;
  nonce: string;
  ciphertext: string;
}

interface DeviceRow {
  id: string;
  public_key: string;
}

interface Channel {
  send(input: {
    type: "broadcast";
    event: string;
    payload: unknown;
  }): Promise<string>;
  subscribe(callback: (status: string) => void): Channel;
  unsubscribe(): Promise<string>;
}

export interface EncryptedFakeHostOptions {
  env: LocalSupabaseEnv;
  ownerId: string;
}

export class EncryptedFakeHost {
  readonly hostId = crypto.randomUUID();
  readonly workspaceId = "workspace-e2e";
  readonly pairingCode = String(Math.floor(100000 + Math.random() * 900000));

  private readonly admin: SupabaseClient;
  private readonly hostKeysPromise = generateP256KeyPair();
  private readonly apiUrl: string;
  private readonly publishableKey: string;
  private deviceId: string | undefined;
  private sessionKey: CryptoKey | undefined;
  private channel: Channel | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly ownerId: string;
  private approvalThreadId = "thread-idle";
  private approvalTurnId = "turn-e2e";
  private readonly threads = new Map<string, RemoteThreadSnapshot>();

  constructor(options: EncryptedFakeHostOptions) {
    this.admin = createClient(options.env.apiUrl, options.env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.apiUrl = options.env.apiUrl;
    this.publishableKey = options.env.publishableKey;
    this.ownerId = options.ownerId;
    this.threads.set(
      "thread-idle",
      this.snapshot("thread-idle", "历史任务", true),
    );
    this.threads.set(
      "thread-running",
      this.snapshot("thread-running", "电脑端任务", true, "turn-desktop"),
    );
  }

  async prepare(): Promise<void> {
    const hostKeys = await this.hostKeysPromise;
    const host = await this.admin
      .from("hosts")
      .insert({
        id: this.hostId,
        owner_id: this.ownerId,
        auth_session_id: `fake-host-${this.hostId}`,
        name: "演示电脑",
        public_key: JSON.stringify(hostKeys.publicKey),
        version: "e2e",
        protocol_version: 1,
        last_online_at: new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (host.error || !host.data) throw new Error("Fake Host 创建失败");
  }

  async createPairingRequest(accessToken: string): Promise<void> {
    const sessionId = readSessionId(accessToken);
    if (!sessionId) throw new Error("Fake Host 无法读取浏览器会话");
    const host = await this.admin
      .from("hosts")
      .update({ auth_session_id: sessionId })
      .eq("id", this.hostId);
    if (host.error) throw new Error("Fake Host 会话准备失败");

    const userClient = createClient(this.apiUrl, this.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const response = await userClient.rpc("create_pairing_request", {
      p_host_id: this.hostId,
      p_code_hash: await hashPairingCode(this.pairingCode),
      p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (response.error) throw new Error("Fake Host 配对请求创建失败");
  }

  async start(): Promise<void> {
    await this.waitForDevice();
    this.channel = this.admin.channel(`host:${this.hostId}`, {
      config: { private: true },
    }) as unknown as Channel;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Fake Host 频道启动超时")),
        10_000,
      );
      this.channel?.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error("Fake Host 频道启动失败"));
        }
      });
    });
    this.timer = setInterval(() => void this.processOne(), 100);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.channel?.unsubscribe();
    await this.admin.from("hosts").delete().eq("id", this.hostId);
  }

  private async waitForDevice(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await this.admin
        .from("devices")
        .select("id,public_key")
        .eq("owner_id", this.ownerId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle<DeviceRow>();
      if (result.data) {
        this.deviceId = result.data.id;
        const hostKeys = await this.hostKeysPromise;
        this.sessionKey = await deriveAesSessionKey(
          hostKeys.privateKey,
          JSON.parse(result.data.public_key) as JsonWebKey,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Fake Host 等待浏览器设备超时");
  }

  private async processOne(): Promise<void> {
    if (!this.deviceId || !this.sessionKey || !this.channel) return;
    const result = await this.admin
      .from("remote_commands")
      .select("*")
      .eq("host_id", this.hostId)
      .eq("device_id", this.deviceId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<CommandRow>();
    if (result.error || !result.data) return;
    const row = result.data;
    const leaseOwner = `fake-host-${this.hostId}`;
    const leased = await this.admin
      .from("remote_commands")
      .update({
        status: "leased",
        lease_owner: leaseOwner,
        lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
        started_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "queued");
    if (leased.error) return;

    let command: RemoteCommand;
    try {
      command = await openRemotePayload<RemoteCommand>({
        key: this.sessionKey,
        envelope: row as unknown as RemoteEnvelope,
      });
      for (const event of this.eventsFor(command, row.message_id)) {
        await this.publish(event);
      }
      await this.complete(row.id, leaseOwner, "completed");
    } catch {
      await this.complete(row.id, leaseOwner, "failed", "fake_host_error");
    }
  }

  private async publish(event: RemoteEvent): Promise<void> {
    if (!this.deviceId || !this.sessionKey || !this.channel) return;
    const envelope = await sealRemotePayload({
      key: this.sessionKey,
      hostId: this.hostId,
      deviceId: this.deviceId,
      payload: event,
      ttlMs: 30_000,
    });
    await this.channel.send({
      type: "broadcast",
      event: "host.event",
      payload: envelope,
    });
  }

  private async complete(
    id: string,
    leaseOwner: string,
    status: "completed" | "failed",
    errorCode?: string,
  ): Promise<void> {
    await this.admin
      .from("remote_commands")
      .update({
        status,
        lease_owner: leaseOwner,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        error_code: errorCode ?? null,
      })
      .eq("id", id)
      .eq("status", "leased");
  }

  private *eventsFor(
    command: RemoteCommand,
    messageId: string,
  ): Iterable<RemoteEvent> {
    switch (command.type) {
      case "host.snapshot":
        yield {
          type: "host.snapshot.result",
          requestMessageId: messageId,
          snapshot: this.hostSnapshot(),
        };
        return;
      case "thread.list": {
        const threads: RemoteThreadSummary[] = [
          {
            id: "thread-idle",
            workspaceId: this.workspaceId,
            title: "历史任务",
            updatedAt: new Date().toISOString(),
            state: "idle",
            readOnly: true,
          },
          {
            id: "thread-running",
            workspaceId: this.workspaceId,
            title: "电脑端任务",
            updatedAt: new Date().toISOString(),
            state: "running",
            readOnly: true,
          },
        ];
        yield {
          type: "thread.list.result",
          requestMessageId: messageId,
          workspaceId: command.workspaceId,
          threads: command.cursor ? [] : threads,
          ...(command.cursor ? {} : { nextCursor: "page-2" }),
        };
        return;
      }
      case "thread.read":
      case "thread.resume":
        yield {
          type: "thread.snapshot",
          requestMessageId: messageId,
          snapshot:
            this.threads.get(command.threadId) ??
            this.snapshot(command.threadId, "新任务", false),
        };
        return;
      case "thread.start": {
        const id = "thread-new";
        const snapshot = this.snapshot(id, "新建任务", false);
        this.threads.set(id, snapshot);
        yield {
          type: "thread.snapshot",
          requestMessageId: messageId,
          snapshot,
        };
        return;
      }
      case "turn.start":
        yield* this.turnEvents(
          command.threadId,
          "turn-e2e",
          messageId,
          command.text,
        );
        return;
      case "turn.steer":
        yield {
          type: "stream.delta",
          requestMessageId: messageId,
          threadId: command.threadId,
          turnId: command.turnId,
          sequence: 0,
          delta: "追加内容已处理。",
        };
        return;
      case "turn.interrupt":
        this.threads.set(
          command.threadId,
          this.snapshot(command.threadId, "历史任务", false),
        );
        yield {
          type: "turn.status",
          requestMessageId: messageId,
          threadId: command.threadId,
          turnId: command.turnId,
          status: "interrupted",
        };
        yield {
          type: "thread.snapshot",
          requestMessageId: messageId,
          snapshot: this.threads.get(command.threadId)!,
        };
        return;
      case "approval.respond":
        this.threads.set(
          this.approvalThreadId,
          this.snapshot(this.approvalThreadId, "历史任务", false),
        );
        yield {
          type: "turn.status",
          requestMessageId: messageId,
          threadId: this.approvalThreadId,
          turnId: this.approvalTurnId,
          status: "completed",
        };
        yield {
          type: "thread.snapshot",
          requestMessageId: messageId,
          snapshot: this.threads.get(this.approvalThreadId)!,
        };
        return;
    }
  }

  private *turnEvents(
    threadId: string,
    turnId: string,
    messageId: string,
    text: string,
  ): Iterable<RemoteEvent> {
    const running = this.snapshot(threadId, "历史任务", false, turnId);
    this.threads.set(threadId, running);
    yield {
      type: "thread.snapshot",
      requestMessageId: messageId,
      snapshot: running,
    };
    yield {
      type: "turn.status",
      requestMessageId: messageId,
      threadId,
      turnId,
      status: "inProgress",
    };
    yield {
      type: "stream.delta",
      requestMessageId: messageId,
      threadId,
      turnId,
      sequence: 0,
      delta: `已收到：${text}`,
    };
    if (text.includes("审批")) {
      this.approvalThreadId = threadId;
      this.approvalTurnId = turnId;
      yield {
        type: "approval.request",
        requestMessageId: messageId,
        requestId: "approval-e2e",
        threadId,
        turnId,
        method: "commandExecution",
        display: { title: "需要你的确认", detail: "测试 Host 请求一次性允许" },
        allowedDecisions: ["accept", "decline", "cancel"],
      };
    }
  }

  private hostSnapshot(): HostSnapshot {
    return {
      hostId: this.hostId,
      name: "演示电脑",
      online: true,
      observedAt: new Date().toISOString(),
      workspaces: [{ id: this.workspaceId, name: "演示项目" }],
    };
  }

  private snapshot(
    id: string,
    title: string,
    readOnly: boolean,
    activeTurnId?: string,
  ): RemoteThreadSnapshot {
    return {
      id,
      workspaceId: this.workspaceId,
      title,
      state: activeTurnId ? "running" : "idle",
      readOnly,
      ...(activeTurnId ? { activeTurnId } : {}),
      items: [
        {
          id: `${id}-item`,
          role: "user",
          kind: "text",
          text: "历史任务已准备好。",
        },
      ],
    };
  }
}

function readSessionId(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      Buffer.from(normalized, "base64url").toString("utf8"),
    ) as { session_id?: unknown };
    return typeof decoded.session_id === "string" ? decoded.session_id : null;
  } catch {
    return null;
  }
}
