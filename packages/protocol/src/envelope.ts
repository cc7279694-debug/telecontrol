import { randomUUID } from "node:crypto";
import { z } from "zod";

export const remoteEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  messageId: z.string().uuid(),
  hostId: z.string().min(1),
  deviceId: z.string().min(1),
  kind: z.string().min(1),
  sentAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
});

export type RemoteEnvelope = z.infer<typeof remoteEnvelopeSchema>;

export type RemoteEnvelopeInput = Omit<
  RemoteEnvelope,
  "protocolVersion" | "messageId" | "sentAt"
>;

export function createEnvelope(input: RemoteEnvelopeInput): RemoteEnvelope {
  return remoteEnvelopeSchema.parse({
    protocolVersion: 1,
    messageId: randomUUID(),
    sentAt: new Date().toISOString(),
    ...input,
  });
}
