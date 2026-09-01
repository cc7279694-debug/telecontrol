import { describe, expect, it, vi } from "vitest";
import {
  deriveAesSessionKey,
  generateP256KeyPair,
  sealRemotePayload,
  type RemoteCommand,
  type RemoteEnvelope,
} from "@codex-remote/protocol";
import {
  RemoteCommandRunner,
  type RemoteCommandAdapter,
  type HostNotificationSink,
} from "./remote-command-runner.js";
import type {
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "./json-rpc-client.js";
import { RemoteThreadStore } from "./remote-thread-store.js";
import type { ClaimedCommand, LinkedDevice } from "./supabase-transport.js";

class FakeTransport {
  claimed: ClaimedCommand | null = null;
  readonly completed: Array<Record<string, unknown>> = [];
  readonly sentEvents: RemoteEnvelope[] = [];
  linkedDevice: LinkedDevice | null;

  constructor(public readonly devicePublicKey: JsonWebKey) {
    this.linkedDevice = {
      id: "device-1",
      public_key: JSON.stringify(devicePublicKey),
      revoked_at: null,
    };
  }

  async claimNextCommand(): Promise<ClaimedCommand | null> {
    return this.claimed;
  }

  async getLinkedDevice(): Promise<LinkedDevice | null> {
    return this.linkedDevice;
  }

  async sendEvent(envelope: RemoteEnvelope): Promise<void> {
    this.sentEvents.push(envelope);
  }

  async completeCommand(input: Record<string, unknown>): Promise<void> {
    this.completed.push(input);
  }
}

function createAdapter(): RemoteCommandAdapter & {
  approvalHandler?: (request: JsonRpcServerRequest) => Promise<void>;
  notificationHandler?: (notification: JsonRpcNotification) => void;
} {
  const adapter: RemoteCommandAdapter & {
    approvalHandler?: (request: JsonRpcServerRequest) => Promise<void>;
    notificationHandler?: (notification: JsonRpcNotification) => void;
  } = {
    listThreads: vi.fn().mockResolvedValue([]),
    readThread: vi
      .fn()
      .mockResolvedValue({ id: "thread-1", status: "completed" }),
    startThread: vi
      .fn()
      .mockResolvedValue({ id: "thread-1", status: "completed" }),
    resumeThread: vi
      .fn()
      .mockResolvedValue({ id: "thread-1", status: "completed" }),
    startTurn: vi.fn().mockResolvedValue({ id: "turn-1" }),
    listModels: vi.fn().mockResolvedValue([]),
    steerTurn: vi.fn().mockResolvedValue(undefined),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
    resolveApproval: vi.fn().mockResolvedValue(undefined),
    onApprovalRequest: vi.fn(
      (handler: (request: JsonRpcServerRequest) => Promise<void>) => {
        adapter.approvalHandler = handler;
        return () => undefined;
      },
    ),
    onNotification: vi.fn(
      (handler: (notification: JsonRpcNotification) => void) => {
        adapter.notificationHandler = handler;
        return () => undefined;
      },
    ),
  };
  return adapter;
}

async function prepareCommand(
  transport: FakeTransport,
  hostPrivateKey: CryptoKey,
  payload: RemoteCommand,
  expiresAt?: string,
): Promise<void> {
  const deviceKey = await deriveAesSessionKey(
    hostPrivateKey,
    transport.devicePublicKey,
  );
  const envelope = await sealRemotePayload({
    key: deviceKey,
    hostId: "host-1",
    deviceId: "device-1",
    payload,
    ...(expiresAt ? { expiresAt } : { ttlMs: 30_000 }),
  });
  transport.claimed = {
    id: "row-1",
    message_id: envelope.messageId,
    host_id: envelope.hostId,
    device_id: envelope.deviceId,
    protocol_version: envelope.protocolVersion,
    kind: envelope.kind,
    sent_at: envelope.sentAt,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    expires_at: envelope.expiresAt,
    status: "leased",
    lease_owner: "host-session",
    lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
  };
}

async function createRunner(
  payload: RemoteCommand,
  configure?: (
    store: RemoteThreadStore,
    adapter: RemoteCommandAdapter,
    transport: FakeTransport,
  ) => void,
  expiresAt?: string,
  notificationSink?: HostNotificationSink,
) {
  const host = await generateP256KeyPair();
  const device = await generateP256KeyPair();
  const transport = new FakeTransport(device.publicKey);
  const adapter = createAdapter();
  const store = new RemoteThreadStore();
  configure?.(store, adapter, transport);
  await prepareCommand(transport, host.privateKey, payload, expiresAt);
  const runner = new RemoteCommandRunner(transport, adapter, {
    hostId: "host-1",
    hostPrivateKey: host.privateKey,
    threadStore: store,
    authorizedWorkspaces: [
      { id: "workspace-1", name: "项目", path: "C:\\authorized-project" },
    ],
    hostName: "开发电脑",
    ...(notificationSink ? { notificationSink } : {}),
  });
  return { runner, transport, adapter, store };
}

describe("RemoteCommandRunner", () => {
  it("reconciles an unknown Host thread from the App Server snapshot", async () => {
    const result = await createRunner(
      {
        type: "thread.read",
        workspaceId: "workspace-1",
        threadId: "thread-1",
      },
      (store) => store.markHostOwned("thread-1", "workspace-1", "unknown"),
    );

    await result.runner.reconcileRecoverable();

    expect(result.adapter.readThread).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });
    expect(result.store.get("thread-1")).toMatchObject({
      owner: "host",
      state: "idle",
    });
  });

  it("heals an unknown Host thread when a direct read confirms it is idle", async () => {
    const result = await createRunner(
      {
        type: "thread.read",
        workspaceId: "workspace-1",
        threadId: "thread-1",
      },
      (store) => store.markHostOwned("thread-1", "workspace-1", "unknown"),
    );

    await result.runner.runOnce();

    expect(result.store.get("thread-1")).toMatchObject({
      owner: "host",
      state: "idle",
    });
    expect(result.store.canWrite("thread-1")).toBe(true);
  });

  it("dispatches turn.start only for a Host-owned thread and completes it", async () => {
    const { runner, transport, adapter } = await createRunner(
      {
        type: "turn.start",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        text: "继续修复",
      },
      (store) => store.markHostOwned("thread-1", "workspace-1", "idle"),
    );

    await runner.runOnce();

    expect(adapter.startTurn).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
      text: "继续修复",
    });
    expect(transport.completed).toMatchObject([
      { messageId: transport.claimed?.message_id, status: "completed" },
    ]);
    expect(transport.sentEvents).toHaveLength(1);
  });

  it("forwards selected model settings to a new Codex turn", async () => {
    const { runner, adapter } = await createRunner(
      {
        type: "turn.start",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        text: "使用更深入的思考检查",
        model: "gpt-5.5",
        reasoningEffort: "high",
      },
      (store) => store.markHostOwned("thread-1", "workspace-1", "idle"),
    );

    await runner.runOnce();

    expect(adapter.startTurn).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
      text: "使用更深入的思考检查",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
  });

  it("loads the model catalog when publishing a Host snapshot", async () => {
    const result = await createRunner(
      { type: "host.snapshot" },
      (_store, adapter) => {
        vi.mocked(adapter.listModels!).mockResolvedValue([
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "通用模型",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "平衡" },
            ],
          },
        ]);
      },
    );

    await result.runner.runOnce();

    expect(result.adapter.listModels).toHaveBeenCalledOnce();
    expect(result.transport.sentEvents).toHaveLength(1);
  });

  it("rejects an external running thread without calling the adapter", async () => {
    const { runner, transport, adapter } = await createRunner(
      {
        type: "turn.start",
        workspaceId: "workspace-1",
        threadId: "thread-2",
        text: "不应执行",
      },
      (store) => store.markExternalRunning("thread-2", "workspace-1"),
    );

    await runner.runOnce();

    expect(adapter.startTurn).not.toHaveBeenCalled();
    expect(transport.completed).toMatchObject([
      { status: "failed", errorCode: "thread_read_only" },
    ]);
  });

  it("reads an idle history thread and handles interrupt commands", async () => {
    const read = await createRunner({
      type: "thread.read",
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });
    await read.runner.runOnce();
    expect(read.adapter.readThread).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });

    const interrupt = await createRunner(
      { type: "turn.interrupt", threadId: "thread-1", turnId: "turn-1" },
      (store) =>
        store.markHostOwned("thread-1", "workspace-1", "running", "turn-1"),
    );
    await interrupt.runner.runOnce();
    expect(interrupt.adapter.interruptTurn).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("dispatches new, resumed, steered, and approval response commands", async () => {
    const started = await createRunner({
      type: "thread.start",
      workspaceId: "workspace-1",
    });
    await started.runner.runOnce();
    expect(started.adapter.startThread).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
    });

    const resumed = await createRunner({
      type: "thread.resume",
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });
    await resumed.runner.runOnce();
    expect(resumed.adapter.resumeThread).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });

    const steered = await createRunner(
      {
        type: "turn.steer",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        turnId: "turn-1",
        text: "补充检查",
      },
      (store) =>
        store.markHostOwned("thread-1", "workspace-1", "running", "turn-1"),
    );
    await steered.runner.runOnce();
    expect(steered.adapter.steerTurn).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "thread-1",
      turnId: "turn-1",
      text: "补充检查",
    });

    const approval = await createRunner({
      type: "approval.respond",
      requestId: "approval-1",
      decision: "decline",
    });
    await approval.runner.runOnce();
    expect(approval.adapter.resolveApproval).toHaveBeenCalledWith({
      requestId: "approval-1",
      decision: "decline",
    });
  });

  it("rejects a duplicate message id without invoking Codex twice", async () => {
    const { runner, transport, adapter } = await createRunner({
      type: "host.snapshot",
    });

    await runner.runOnce();
    await runner.runOnce();

    expect(adapter.listThreads).not.toHaveBeenCalled();
    expect(transport.completed).toMatchObject([
      { status: "completed" },
      { status: "failed", errorCode: "duplicate_message_id" },
    ]);
  });

  it("marks malformed or expired commands without retrying them", async () => {
    const malformed = await createRunner({ type: "host.snapshot" });
    malformed.transport.claimed!.ciphertext = "broken";
    await malformed.runner.runOnce();
    expect(malformed.transport.completed).toMatchObject([
      { status: "failed", errorCode: "invalid_envelope" },
    ]);

    const expired = await createRunner(
      { type: "host.snapshot" },
      undefined,
      new Date(Date.now() - 1_000).toISOString(),
    );
    await expired.runner.runOnce();
    expect(expired.transport.completed).toMatchObject([
      { status: "expired", errorCode: "command_expired" },
    ]);
  });

  it("fails closed when the device is no longer linked", async () => {
    const { runner, transport } = await createRunner({ type: "host.snapshot" });
    transport.linkedDevice = null;

    await runner.runOnce();

    expect(transport.completed).toMatchObject([
      { status: "failed", errorCode: "device_not_linked" },
    ]);
  });

  it("turns adapter failures into a terminal failed receipt", async () => {
    const { runner, transport, adapter } = await createRunner({
      type: "thread.list",
      workspaceId: "workspace-1",
    });
    vi.mocked(adapter.listThreads).mockRejectedValueOnce(
      new Error("Codex unavailable"),
    );

    await runner.runOnce();

    expect(transport.completed).toMatchObject([
      { status: "failed", errorCode: "adapter_failed" },
    ]);
  });

  it("forwards approval metadata to the notification sink", async () => {
    const notificationSink = { notify: vi.fn().mockResolvedValue(undefined) };
    const { runner, adapter, transport } = await createRunner(
      { type: "host.snapshot" },
      undefined,
      undefined,
      notificationSink,
    );
    await runner.runOnce();

    await adapter.approvalHandler?.({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        detail: "C:\\Users\\secret\\run.ps1",
      },
    });

    expect(notificationSink.notify).toHaveBeenCalledWith({
      hostId: "host-1",
      kind: "approval",
      eventId: transport.claimed?.message_id,
    });
  });

  it("notifies only for completed or failed turn events", async () => {
    const notificationSink = { notify: vi.fn().mockResolvedValue(undefined) };
    const { runner, adapter, transport } = await createRunner(
      { type: "host.snapshot" },
      undefined,
      undefined,
      notificationSink,
    );
    await runner.runOnce();

    adapter.notificationHandler?.({
      method: "turn/status",
      params: { threadId: "thread-1", turnId: "turn-1", status: "inProgress" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notificationSink.notify).not.toHaveBeenCalled();

    adapter.notificationHandler?.({
      method: "turn/status",
      params: { threadId: "thread-1", turnId: "turn-1", status: "completed" },
    });
    await vi.waitFor(() => {
      expect(notificationSink.notify).toHaveBeenCalledWith({
        hostId: "host-1",
        kind: "completed",
        eventId: transport.claimed?.message_id,
      });
    });

    adapter.notificationHandler?.({
      method: "turn/status",
      params: { threadId: "thread-1", turnId: "turn-1", status: "failed" },
    });
    await vi.waitFor(() => {
      expect(notificationSink.notify).toHaveBeenCalledWith({
        hostId: "host-1",
        kind: "failed",
        eventId: transport.claimed?.message_id,
      });
    });
  });

  it("releases the workspace when a remote turn reaches a terminal status", async () => {
    const started = await createRunner(
      {
        type: "turn.start",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        text: "执行测试",
      },
      (store) => store.markHostOwned("thread-1", "workspace-1", "idle"),
    );

    await started.runner.runOnce();
    expect(started.store.hasActiveTurn("workspace-1")).toBe(true);
    expect(started.store.get("thread-1")).toMatchObject({
      state: "running",
      activeTurnId: "turn-1",
    });

    started.adapter.notificationHandler?.({
      method: "turn/status",
      params: { threadId: "thread-1", turnId: "turn-1", status: "completed" },
    });

    await vi.waitFor(() => {
      expect(started.store.hasActiveTurn("workspace-1")).toBe(false);
      expect(started.store.get("thread-1")).toMatchObject({ state: "idle" });
    });
  });

  it("keeps remote event forwarding working when notification fails", async () => {
    const notificationSink = {
      notify: vi.fn().mockRejectedValue(new Error("notification offline")),
    };
    const { runner, adapter, transport } = await createRunner(
      { type: "host.snapshot" },
      undefined,
      undefined,
      notificationSink,
    );
    await runner.runOnce();

    adapter.notificationHandler?.({
      method: "turn/status",
      params: { threadId: "thread-1", turnId: "turn-1", status: "completed" },
    });
    await vi.waitFor(() => expect(notificationSink.notify).toHaveBeenCalled());
    expect(transport.sentEvents).toHaveLength(2);
  });

  it("keeps polling after a transient command-claim failure", async () => {
    const result = await createRunner({
      type: "thread.list",
      workspaceId: "workspace-1",
    });
    vi.spyOn(result.transport, "claimNextCommand")
      .mockRejectedValueOnce(new Error("temporary transport failure"))
      .mockResolvedValueOnce(result.transport.claimed)
      .mockResolvedValue(null);

    try {
      result.runner.start();
      await vi.waitFor(() => {
        expect(result.adapter.listThreads).toHaveBeenCalledTimes(1);
      });
    } finally {
      result.runner.stop();
    }
  });

  it("publishes an authoritative encrypted snapshot for a linked device", async () => {
    const { runner, transport } = await createRunner({ type: "host.snapshot" });

    await runner.publishAuthoritativeSnapshot(transport.linkedDevice!);

    expect(transport.sentEvents).toHaveLength(1);
    expect(transport.sentEvents[0]).toMatchObject({
      hostId: "host-1",
      deviceId: "device-1",
      kind: "host.snapshot.result",
    });
    expect(transport.sentEvents[0]?.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
