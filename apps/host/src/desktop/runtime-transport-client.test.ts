import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedSupabaseTransport } from "./runtime-transport-client.js";

describe("authenticated runtime transport", () => {
  it("creates the transport with the current runtime access token", () => {
    const client = { realtime: { setAuth: vi.fn() } };
    const createClient = vi.fn(() => client);

    const transport = createAuthenticatedSupabaseTransport(
      { accessToken: "current-access-token" },
      createClient,
    );

    expect(createClient).toHaveBeenCalledWith("current-access-token");
    expect(transport).toBeDefined();
  });
});
