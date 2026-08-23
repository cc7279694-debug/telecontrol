import { describe, expect, it } from "vitest";
import { createEnvelope, remoteEnvelopeSchema } from "./envelope.js";

describe("remote envelope", () => {
  it("creates a versioned envelope with message metadata", () => {
    const envelope = createEnvelope({
      hostId: "host-1",
      deviceId: "device-1",
      kind: "turn.start",
      nonce: "nonce",
      ciphertext: "ciphertext",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(envelope.protocolVersion).toBe(1);
    expect(envelope.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(envelope.sentAt).toEqual(expect.any(String));
    expect(remoteEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects unsupported protocol versions", () => {
    expect(() =>
      remoteEnvelopeSchema.parse({
        protocolVersion: 2,
        messageId: "message-1",
        hostId: "host-1",
        deviceId: "device-1",
        kind: "turn.start",
        sentAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        nonce: "nonce",
        ciphertext: "ciphertext",
      }),
    ).toThrow();
  });
});

