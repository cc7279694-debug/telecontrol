import { describe, expect, it, vi } from "vitest";
import {
  createSupabasePairingRequest,
  createSupabasePairingTransport,
} from "./pairing-transport.js";

describe("Supabase pairing transport", () => {
  it("sends only the hashed code and returns the short-lived display data", async () => {
    const rpc = vi.fn(async () => ({ data: "pairing-1", error: null }));

    const result = await createSupabasePairingRequest({
      client: { rpc },
      hostId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.pairingId).toBe("pairing-1");
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(rpc).toHaveBeenCalledWith(
      "create_pairing_request",
      expect.objectContaining({
        p_host_id: "11111111-1111-4111-8111-111111111111",
        p_expires_at: result.expiresAt,
      }),
    );
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_code_hash).not.toBe(result.code);
    expect(String(args.p_code_hash)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports readiness from the pairing transport instead of login state alone", () => {
    let ready = false;
    const transport = createSupabasePairingTransport({
      client: { rpc: vi.fn() },
      getHostId: () => "11111111-1111-4111-8111-111111111111",
      isSessionReady: () => ready,
    });

    expect(transport.isReady()).toBe(false);
    ready = true;
    expect(transport.isReady()).toBe(true);
    expect(transport.createPairingRequest).toBeTypeOf("function");
  });
});
