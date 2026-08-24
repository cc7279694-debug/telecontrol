import {
  remoteCommandSchema,
  remoteEventSchema,
  type RemoteCommand,
  type RemoteEvent,
} from "./commands.js";
import { decryptJson, encryptJson, type EncryptedPayload } from "./crypto.js";
import {
  createEnvelope,
  remoteEnvelopeSchema,
  type RemoteEnvelope,
} from "./envelope.js";

type RemotePayload = RemoteCommand | RemoteEvent;

export interface SealRemotePayloadInput<T extends RemotePayload> {
  key: CryptoKey;
  hostId: string;
  deviceId: string;
  payload: T;
  ttlMs?: number;
  expiresAt?: string;
}

export interface OpenRemotePayloadInput {
  key: CryptoKey;
  envelope: RemoteEnvelope;
}

const commandKinds = new Set<string>([
  "host.snapshot",
  "thread.list",
  "thread.read",
  "thread.start",
  "thread.resume",
  "turn.start",
  "turn.steer",
  "turn.interrupt",
  "approval.respond",
]);

export function remoteEnvelopeAdditionalData(
  envelope: Pick<
    RemoteEnvelope,
    | "protocolVersion"
    | "messageId"
    | "hostId"
    | "deviceId"
    | "kind"
    | "sentAt"
    | "expiresAt"
  >,
): string {
  return JSON.stringify([
    envelope.protocolVersion,
    envelope.messageId,
    envelope.hostId,
    envelope.deviceId,
    envelope.kind,
    envelope.sentAt,
    envelope.expiresAt,
  ]);
}

export async function sealRemotePayload<T extends RemotePayload>(
  input: SealRemotePayloadInput<T>,
): Promise<RemoteEnvelope> {
  const parsedCommand = remoteCommandSchema.safeParse(input.payload);
  const parsedEvent = remoteEventSchema.safeParse(input.payload);
  if (!parsedCommand.success && !parsedEvent.success) {
    throw new Error("Unsupported remote payload");
  }

  const expiresAt =
    input.expiresAt ??
    new Date(Date.now() + (input.ttlMs ?? 30_000)).toISOString();
  const draft = createEnvelope({
    hostId: input.hostId,
    deviceId: input.deviceId,
    kind: input.payload.type,
    expiresAt,
    nonce: "pending",
    ciphertext: "pending",
  });
  const encrypted = await encryptJson(
    input.key,
    input.payload,
    remoteEnvelopeAdditionalData(draft),
  );

  return remoteEnvelopeSchema.parse({ ...draft, ...encrypted });
}

export async function openRemotePayload<T extends RemotePayload>(
  input: OpenRemotePayloadInput,
): Promise<T> {
  const envelope = remoteEnvelopeSchema.parse(input.envelope);
  if (Date.parse(envelope.expiresAt) <= Date.now()) {
    throw new Error("Remote envelope has expired");
  }

  const plaintext = await decryptJson<unknown>(
    input.key,
    envelope as EncryptedPayload,
    remoteEnvelopeAdditionalData(envelope),
  );
  const parsed = commandKinds.has(envelope.kind)
    ? remoteCommandSchema.safeParse(plaintext)
    : remoteEventSchema.safeParse(plaintext);
  if (!parsed.success || parsed.data.type !== envelope.kind) {
    throw new Error("Remote payload does not match envelope kind");
  }

  return parsed.data as T;
}
