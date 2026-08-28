import { describe, expect, it, vi } from "vitest";
import { createSupabasePairingTransport } from "./pairing-transport.js";

describe("Supabase pairing transport", () => {
  it("delegates pairing creation to the existing Supabase transport", async () => {
    const createPairingRequest = vi.fn(async () => ({
      pairingId: "pairing-1",
      code: "123456",
      expiresAt: "2026-08-27T00:05:00.000Z",
    }));
    const transport = createSupabasePairingTransport({
      transport: { createPairingRequest },
      getHostId: () => "11111111-1111-4111-8111-111111111111",
      isSessionReady: () => true,
    });

    await expect(transport.createPairingRequest()).resolves.toMatchObject({
      pairingId: "pairing-1",
      code: "123456",
    });
    expect(createPairingRequest).toHaveBeenCalledOnce();
  });

  it("reports readiness from the pairing transport instead of login state alone", () => {
    let ready = false;
    const transport = createSupabasePairingTransport({
      transport: { createPairingRequest: vi.fn() },
      getHostId: () => "11111111-1111-4111-8111-111111111111",
      isSessionReady: () => ready,
    });

    expect(transport.isReady()).toBe(false);
    ready = true;
    expect(transport.isReady()).toBe(true);
    expect(transport.createPairingRequest).toBeTypeOf("function");
  });
});
