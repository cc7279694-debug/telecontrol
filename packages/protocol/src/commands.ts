import { z } from "zod";

const workspaceId = z.string().min(1);
const threadId = z.string().min(1);
const turnId = z.string().min(1);

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

export const remoteEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("host.presence"),
      hostId: z.string().min(1),
      online: z.boolean(),
      observedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal("thread.snapshot"),
      threadId,
      snapshot: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("stream.delta"),
      threadId,
      turnId,
      sequence: z.number().int().nonnegative(),
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("turn.status"),
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
      requestId: z.union([z.string().min(1), z.number().int().nonnegative()]),
      method: z.string().min(1),
      params: z.unknown(),
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
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export type RemoteEvent = z.infer<typeof remoteEventSchema>;
