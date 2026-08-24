import { z } from "zod";

const workspaceId = z.string().min(1);
const threadId = z.string().min(1);
const turnId = z.string().min(1);
const requestMessageId = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

export const remoteCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host.snapshot") }).strict(),
  z
    .object({
      type: z.literal("thread.list"),
      workspaceId,
      limit: z.number().int().positive().max(100).optional(),
      cursor: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ type: z.literal("thread.read"), workspaceId, threadId }).strict(),
  z.object({ type: z.literal("thread.start"), workspaceId }).strict(),
  z
    .object({ type: z.literal("thread.resume"), workspaceId, threadId })
    .strict(),
  z
    .object({
      type: z.literal("turn.start"),
      workspaceId,
      threadId,
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("turn.steer"),
      workspaceId,
      threadId,
      turnId,
      text: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal("turn.interrupt"), threadId, turnId }).strict(),
  z
    .object({
      type: z.literal("approval.respond"),
      requestId: z.union([z.string().min(1), z.number().int().nonnegative()]),
      decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
    })
    .strict(),
]);

export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteCommandKind = RemoteCommand["type"];

export const workspaceSummarySchema = z
  .object({ id: z.string().min(1), name: z.string().min(1) })
  .strict();
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const remoteThreadSummarySchema = z
  .object({
    id: threadId,
    workspaceId,
    title: z.string(),
    updatedAt: isoDate,
    state: z.enum(["idle", "running", "unknown"]),
    readOnly: z.boolean(),
  })
  .strict();
export type RemoteThreadSummary = z.infer<typeof remoteThreadSummarySchema>;

export const remoteTimelineItemSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant", "tool", "system"]),
    kind: z.enum(["text", "reasoning", "command", "fileChange", "status"]),
    text: z.string(),
    status: z
      .enum(["inProgress", "completed", "failed", "interrupted"])
      .optional(),
  })
  .strict();
export type RemoteTimelineItem = z.infer<typeof remoteTimelineItemSchema>;

export const remoteThreadSnapshotSchema = z
  .object({
    id: threadId,
    workspaceId,
    title: z.string(),
    state: z.enum(["idle", "running", "unknown"]),
    readOnly: z.boolean(),
    activeTurnId: turnId.optional(),
    items: z.array(remoteTimelineItemSchema),
  })
  .strict();
export type RemoteThreadSnapshot = z.infer<typeof remoteThreadSnapshotSchema>;

export const hostSnapshotSchema = z
  .object({
    hostId: z.string().min(1),
    name: z.string().min(1),
    online: z.boolean(),
    observedAt: isoDate,
    workspaces: z.array(workspaceSummarySchema),
  })
  .strict();
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>;

const approvalDecisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

export const remoteEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("host.presence"),
      hostId: z.string().min(1),
      online: z.boolean(),
      observedAt: isoDate,
    })
    .strict(),
  z
    .object({
      type: z.literal("host.snapshot.result"),
      requestMessageId,
      snapshot: hostSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("thread.list.result"),
      requestMessageId,
      workspaceId,
      threads: z.array(remoteThreadSummarySchema),
      nextCursor: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("thread.snapshot"),
      requestMessageId,
      snapshot: remoteThreadSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("stream.delta"),
      requestMessageId,
      threadId,
      turnId,
      sequence: z.number().int().nonnegative(),
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("turn.status"),
      requestMessageId,
      threadId,
      turnId,
      status: z.enum([
        "queued",
        "inProgress",
        "completed",
        "failed",
        "interrupted",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval.request"),
      requestMessageId,
      requestId: z.union([z.string().min(1), z.number().int().nonnegative()]),
      method: z.string().min(1),
      display: z
        .object({ title: z.string().min(1), detail: z.string().optional() })
        .strict(),
      allowedDecisions: z.array(approvalDecisionSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("command.receipt"),
      messageId: z.string().uuid(),
      status: z.enum(["queued", "leased", "completed", "failed", "expired"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      requestMessageId,
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export type RemoteEvent = z.infer<typeof remoteEventSchema>;
