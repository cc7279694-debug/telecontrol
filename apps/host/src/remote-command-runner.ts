import {
  deriveAesSessionKey,
  openRemotePayload,
  sealRemotePayload,
  type RemoteCommand,
  type RemoteEnvelope,
  type RemoteEvent,
} from "@codex-remote/protocol";
import { randomUUID } from "node:crypto";
import type {
  ApprovalResponse,
  AuthorizedWorkspace,
  InterruptTurnInput,
  ListThreadsInput,
  ReadThreadInput,
  StartThreadInput,
  StartTurnInput,
  SteerTurnInput,
  ThreadSnapshot,
  ThreadSummary,
  TurnHandle,
} from "./codex-app-server-adapter.js";
import { CodexEventMapper } from "./codex-event-mapper.js";
import type {
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "./json-rpc-client.js";
import { RemoteThreadStore } from "./remote-thread-store.js";
import type { ClaimedCommand, LinkedDevice } from "./supabase-transport.js";

export interface RemoteCommandAdapter {
  listThreads(input: ListThreadsInput): Promise<ThreadSummary[]>;
  readThread(input: ReadThreadInput): Promise<ThreadSnapshot>;
  startThread(input: StartThreadInput): Promise<ThreadSnapshot>;
  resumeThread(input: ReadThreadInput): Promise<ThreadSnapshot>;
  startTurn(input: StartTurnInput): Promise<TurnHandle>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;
  resolveApproval(input: ApprovalResponse): Promise<void>;
  onApprovalRequest(
    handler: (request: JsonRpcServerRequest) => Promise<void>,
  ): () => void;
  onNotification(
    handler: (notification: JsonRpcNotification) => void,
  ): () => void;
}

export interface RemoteRunnerTransport {
  claimNextCommand(): Promise<ClaimedCommand | null>;
  getLinkedDevice(deviceId: string): Promise<LinkedDevice | null>;
  sendEvent(envelope: RemoteEnvelope): Promise<void>;
  completeCommand(input: {
    messageId: string;
    status: "completed" | "failed" | "expired";
    result?: { nonce: string; ciphertext: string };
    errorCode?: string;
  }): Promise<void>;
}

export type HostNotificationKind = "approval" | "completed" | "failed";

export interface HostNotificationMetadata {
  hostId: string;
  kind: HostNotificationKind;
  eventId: string;
}

export interface HostNotificationSink {
  notify(metadata: HostNotificationMetadata): Promise<void>;
}

export interface RemoteCommandRunnerOptions {
  hostId: string;
  hostName: string;
  hostPrivateKey: CryptoKey;
  authorizedWorkspaces: AuthorizedWorkspace[];
  threadStore: RemoteThreadStore;
  pollIntervalMs?: number;
  notificationSink?: HostNotificationSink;
}

interface ActiveSession {
  key: CryptoKey;
  deviceId: string;
  requestMessageId: string;
}

interface StreamBuffer {
  threadId: string;
  turnId: string;
  requestMessageId: string;
  delta: string;
  sequence: number;
  timer: ReturnType<typeof setTimeout>;
}

export class RemoteCommandRunner {
  private readonly seenMessageIds = new Set<string>();
  private readonly mapper = new CodexEventMapper();
  private readonly streamSequences = new Map<string, number>();
  private readonly streamBuffers = new Map<string, StreamBuffer>();
  private readonly removeApprovalHandler: () => void;
  private readonly removeNotificationHandler: () => void;
  private activeSession: ActiveSession | undefined;
  private running = false;

  constructor(
    private readonly transport: RemoteRunnerTransport,
    private readonly adapter: RemoteCommandAdapter,
    private readonly options: RemoteCommandRunnerOptions,
  ) {
    this.removeApprovalHandler = adapter.onApprovalRequest((request) =>
      this.forwardApproval(request),
    );
    this.removeNotificationHandler = adapter.onNotification((notification) => {
      void this.forwardNotification(notification);
    });
  }

  async publishAuthoritativeSnapshot(
    linkedDevice: LinkedDevice,
  ): Promise<void> {
    const key = await deriveAesSessionKey(
      this.options.hostPrivateKey,
      parsePublicKey(linkedDevice.public_key),
    );
    const payload = {
      type: "host.snapshot.result" as const,
      requestMessageId: randomUUID(),
      snapshot: this.mapper.hostSnapshot({
        hostId: this.options.hostId,
        name: this.options.hostName,
        online: true,
        workspaces: this.options.authorizedWorkspaces.map(({ id, name }) => ({
          id,
          name: name ?? id,
        })),
      }),
    };
    const envelope = await sealRemotePayload({
      key,
      hostId: this.options.hostId,
      deviceId: linkedDevice.id,
      payload,
      ttlMs: 60_000,
    });
    await this.transport.sendEvent(envelope);
  }

  async reconcileRecoverable(): Promise<void> {
    for (const entry of this.options.threadStore.listRecoverable()) {
      try {
        const snapshot = await this.adapter.readThread({
          workspaceId: entry.workspaceId,
          threadId: entry.threadId,
        });
        const mapped = this.mapper.threadSnapshot(snapshot, {
          workspaceId: entry.workspaceId,
          readOnly: false,
        });
        if (mapped.state === "running") {
          this.options.threadStore.markHostOwned(
            mapped.id,
            mapped.workspaceId,
            "running",
            mapped.activeTurnId,
          );
        } else if (mapped.state === "idle") {
          this.options.threadStore.updateState(mapped.id, "idle");
        }
      } catch {
        // Keep the thread unknown when the authoritative state cannot be read.
      }
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.removeApprovalHandler();
    this.removeNotificationHandler();
    for (const buffer of this.streamBuffers.values()) {
      clearTimeout(buffer.timer);
    }
    this.streamBuffers.clear();
  }

  async runOnce(): Promise<void> {
    const claimed = await this.transport.claimNextCommand();
    if (!claimed) {
      return;
    }
    if (this.seenMessageIds.has(claimed.message_id)) {
      await this.transport.completeCommand({
        messageId: claimed.message_id,
        status: "failed",
        errorCode: "duplicate_message_id",
      });
      return;
    }
    this.seenMessageIds.add(claimed.message_id);

    const linkedDevice = await this.transport.getLinkedDevice(
      claimed.device_id,
    );
    if (!linkedDevice) {
      await this.transport.completeCommand({
        messageId: claimed.message_id,
        status: "failed",
        errorCode: "device_not_linked",
      });
      return;
    }

    let key: CryptoKey;
    try {
      key = await deriveAesSessionKey(
        this.options.hostPrivateKey,
        parsePublicKey(linkedDevice.public_key),
      );
    } catch {
      await this.transport.completeCommand({
        messageId: claimed.message_id,
        status: "failed",
        errorCode: "device_key_invalid",
      });
      return;
    }

    const envelope = envelopeFromClaim(claimed);
    let command: RemoteCommand;
    try {
      command = await openRemotePayload<RemoteCommand>({ key, envelope });
    } catch (error) {
      const expired =
        error instanceof Error &&
        error.message === "Remote envelope has expired";
      await this.transport.completeCommand({
        messageId: claimed.message_id,
        status: expired ? "expired" : "failed",
        errorCode: expired ? "command_expired" : "invalid_envelope",
      });
      return;
    }

    this.activeSession = {
      key,
      deviceId: claimed.device_id,
      requestMessageId: claimed.message_id,
    };
    try {
      const response = await this.dispatch(command);
      const responseEnvelope = await this.sendResponse(
        key,
        claimed.device_id,
        response,
      );
      await this.transport.completeCommand({
        messageId: claimed.message_id,
        status: "completed",
        result: {
          nonce: responseEnvelope.nonce,
          ciphertext: responseEnvelope.ciphertext,
        },
      });
    } catch (error) {
      const response = {
        type: "error" as const,
        requestMessageId: claimed.message_id,
        code: errorCode(error),
        message: "远程操作未完成",
      } satisfies Extract<RemoteEvent, { type: "error" }>;
      try {
        const responseEnvelope = await this.sendResponse(
          key,
          claimed.device_id,
          response,
        );
        await this.transport.completeCommand({
          messageId: claimed.message_id,
          status: "failed",
          errorCode: errorCode(error),
          result: {
            nonce: responseEnvelope.nonce,
            ciphertext: responseEnvelope.ciphertext,
          },
        });
      } catch {
        await this.transport.completeCommand({
          messageId: claimed.message_id,
          status: "failed",
          errorCode: errorCode(error),
        });
      }
    }
  }

  private async dispatch(command: RemoteCommand): Promise<RemoteEvent> {
    switch (command.type) {
      case "host.snapshot":
        return {
          type: "host.snapshot.result",
          requestMessageId: this.requireSession().requestMessageId,
          snapshot: this.mapper.hostSnapshot({
            hostId: this.options.hostId,
            name: this.options.hostName,
            online: true,
            workspaces: this.options.authorizedWorkspaces.map(
              ({ id, name }) => ({
                id,
                name: name ?? id,
              }),
            ),
          }),
        };
      case "thread.list": {
        const threads = await this.adapter.listThreads({
          workspaceId: command.workspaceId,
          ...(command.limit ? { limit: command.limit } : {}),
          ...(command.cursor ? { cursor: command.cursor } : {}),
        });
        return {
          type: "thread.list.result",
          requestMessageId: this.requireSession().requestMessageId,
          workspaceId: command.workspaceId,
          threads: threads.map((thread) =>
            this.mapper.threadSummary(thread, {
              workspaceId: command.workspaceId,
              readOnly: !this.options.threadStore.canWrite(threadIdOf(thread)),
            }),
          ),
        };
      }
      case "thread.read": {
        const snapshot = await this.adapter.readThread({
          workspaceId: command.workspaceId,
          threadId: command.threadId,
        });
        return this.threadSnapshotEvent(command, snapshot);
      }
      case "thread.start": {
        const snapshot = await this.adapter.startThread({
          workspaceId: command.workspaceId,
        });
        const mapped = this.mapper.threadSnapshot(snapshot, {
          workspaceId: command.workspaceId,
          readOnly: false,
        });
        this.options.threadStore.markHostOwned(
          mapped.id,
          mapped.workspaceId,
          mapped.state,
          mapped.activeTurnId,
        );
        return {
          type: "thread.snapshot",
          requestMessageId: this.requireSession().requestMessageId,
          snapshot: mapped,
        };
      }
      case "thread.resume": {
        const snapshot = await this.adapter.resumeThread({
          workspaceId: command.workspaceId,
          threadId: command.threadId,
        });
        const mapped = this.mapper.threadSnapshot(snapshot, {
          workspaceId: command.workspaceId,
          readOnly: false,
        });
        this.options.threadStore.markHostOwned(
          mapped.id,
          mapped.workspaceId,
          mapped.state,
          mapped.activeTurnId,
        );
        return {
          type: "thread.snapshot",
          requestMessageId: this.requireSession().requestMessageId,
          snapshot: mapped,
        };
      }
      case "turn.start": {
        this.requireWritable(command.threadId);
        const turn = await this.adapter.startTurn({
          workspaceId: command.workspaceId,
          threadId: command.threadId,
          text: command.text,
        });
        this.options.threadStore.updateState(
          command.threadId,
          "running",
          turn.id,
        );
        return this.turnStatus(command.threadId, turn.id, "inProgress");
      }
      case "turn.steer":
        this.requireWritable(command.threadId);
        await this.adapter.steerTurn({
          workspaceId: command.workspaceId,
          threadId: command.threadId,
          turnId: command.turnId,
          text: command.text,
        });
        return this.turnStatus(command.threadId, command.turnId, "inProgress");
      case "turn.interrupt":
        this.requireWritable(command.threadId);
        await this.adapter.interruptTurn({
          threadId: command.threadId,
          turnId: command.turnId,
        });
        this.options.threadStore.updateState(command.threadId, "idle");
        return this.turnStatus(command.threadId, command.turnId, "interrupted");
      case "approval.respond":
        await this.adapter.resolveApproval({
          requestId: command.requestId,
          decision: command.decision,
        } satisfies ApprovalResponse);
        return {
          type: "command.receipt",
          messageId: this.requireSession().requestMessageId,
          status: "completed",
        };
    }
  }

  private threadSnapshotEvent(
    command: ReadThreadInput,
    raw: ThreadSnapshot,
  ): Extract<RemoteEvent, { type: "thread.snapshot" }> {
    const known = this.options.threadStore.get(command.threadId);
    const snapshot = this.mapper.threadSnapshot(raw, {
      workspaceId: command.workspaceId,
      readOnly: known ? known.owner !== "host" : true,
    });
    if (known?.owner === "host" && snapshot.state === "running") {
      this.options.threadStore.markHostOwned(
        command.threadId,
        command.workspaceId,
        "running",
        snapshot.activeTurnId,
      );
    } else if (known?.owner === "host" && snapshot.state === "idle") {
      this.options.threadStore.updateState(command.threadId, "idle");
    } else if (known?.owner === "external" && snapshot.state === "running") {
      this.options.threadStore.markExternalRunning(
        command.threadId,
        command.workspaceId,
      );
    }
    return {
      type: "thread.snapshot",
      requestMessageId: this.requireSession().requestMessageId,
      snapshot,
    };
  }

  private turnStatus(
    threadId: string,
    turnId: string,
    status: "queued" | "inProgress" | "completed" | "failed" | "interrupted",
  ): Extract<RemoteEvent, { type: "turn.status" }> {
    return {
      type: "turn.status",
      requestMessageId: this.requireSession().requestMessageId,
      threadId,
      turnId,
      status,
    };
  }

  private async sendResponse(
    key: CryptoKey,
    deviceId: string,
    payload: RemoteEvent,
  ): Promise<RemoteEnvelope> {
    const envelope = await sealRemotePayload({
      key,
      hostId: this.options.hostId,
      deviceId,
      payload,
      ttlMs: 60_000,
    });
    await this.transport.sendEvent(envelope);
    return envelope;
  }

  private async forwardApproval(request: JsonRpcServerRequest): Promise<void> {
    const session = this.activeSession;
    if (!session) {
      return;
    }
    const display = this.mapper.approvalRequest(request);
    if (!display) {
      await this.adapter.resolveApproval({
        requestId: request.id,
        decision: "cancel",
      });
      return;
    }
    await this.sendResponse(session.key, session.deviceId, {
      type: "approval.request",
      requestMessageId: session.requestMessageId,
      ...display,
    });
    await this.notifySafely({
      hostId: this.options.hostId,
      kind: "approval",
      eventId: session.requestMessageId,
    });
  }

  private async forwardNotification(
    notification: JsonRpcNotification,
  ): Promise<void> {
    const session = this.activeSession;
    if (!session) {
      return;
    }
    const delta = this.mapper.streamDelta(notification);
    if (delta) {
      this.bufferDelta(session, delta);
      return;
    }
    const status = this.mapper.turnStatus(notification);
    if (status) {
      if (status.status === "inProgress") {
        this.options.threadStore.updateState(
          status.threadId,
          "running",
          status.turnId,
        );
      } else if (
        status.status === "completed" ||
        status.status === "failed" ||
        status.status === "interrupted"
      ) {
        this.options.threadStore.updateState(status.threadId, "idle");
      }
      await this.sendResponse(session.key, session.deviceId, {
        type: "turn.status",
        requestMessageId: session.requestMessageId,
        ...status,
      });
      if (status.status === "completed" || status.status === "failed") {
        await this.notifySafely({
          hostId: this.options.hostId,
          kind: status.status,
          eventId: session.requestMessageId,
        });
      }
    }
  }

  private async notifySafely(
    metadata: HostNotificationMetadata,
  ): Promise<void> {
    if (!this.options.notificationSink) return;
    try {
      await this.options.notificationSink.notify(metadata);
    } catch {
      // Notification delivery is best effort and must not break Codex control.
    }
  }

  private bufferDelta(
    session: ActiveSession,
    delta: { threadId: string; turnId: string; delta: string },
  ): void {
    const key = `${delta.threadId}:${delta.turnId}`;
    const existing = this.streamBuffers.get(key);
    if (existing) {
      existing.delta += delta.delta;
      if (existing.delta.length >= 16 * 1024) {
        clearTimeout(existing.timer);
        void this.flushDelta(key);
      }
      return;
    }
    const sequence = this.streamSequences.get(key) ?? 0;
    const buffer: StreamBuffer = {
      ...delta,
      requestMessageId: session.requestMessageId,
      delta: delta.delta,
      sequence,
      timer: setTimeout(() => void this.flushDelta(key), 100),
    };
    this.streamBuffers.set(key, buffer);
  }

  private async flushDelta(key: string): Promise<void> {
    const buffer = this.streamBuffers.get(key);
    const session = this.activeSession;
    if (!buffer || !session) {
      return;
    }
    this.streamBuffers.delete(key);
    this.streamSequences.set(key, buffer.sequence + 1);
    await this.sendResponse(session.key, session.deviceId, {
      type: "stream.delta",
      requestMessageId: buffer.requestMessageId,
      threadId: buffer.threadId,
      turnId: buffer.turnId,
      sequence: buffer.sequence,
      delta: buffer.delta,
    });
  }

  private requireWritable(threadId: string): void {
    if (!this.options.threadStore.canWrite(threadId)) {
      throw new Error("thread_read_only");
    }
  }

  private requireSession(): ActiveSession {
    if (!this.activeSession) {
      throw new Error("No active remote command");
    }
    return this.activeSession;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch {
        // A transient Supabase or network error must not permanently stop the
        // Host command loop. The next poll retries the claim safely.
      }
      if (this.running) {
        await delay(this.options.pollIntervalMs ?? 250);
      }
    }
  }
}

function envelopeFromClaim(claimed: ClaimedCommand): RemoteEnvelope {
  return {
    protocolVersion: claimed.protocol_version as 1,
    messageId: claimed.message_id,
    hostId: claimed.host_id,
    deviceId: claimed.device_id,
    kind: claimed.kind,
    sentAt: claimed.sent_at,
    expiresAt: claimed.expires_at,
    nonce: claimed.nonce,
    ciphertext: claimed.ciphertext,
  };
}

function parsePublicKey(value: string): JsonWebKey {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { kty?: unknown }).kty !== "EC"
  ) {
    throw new Error("Invalid device public key");
  }
  return parsed as JsonWebKey;
}

function threadIdOf(thread: ThreadSummary): string {
  const record = thread as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : "unknown";
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "adapter_failed";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
