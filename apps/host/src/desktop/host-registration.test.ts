import { describe, expect, it } from "vitest";
import { resolveHostRegistrationSession } from "./host-registration.js";

describe("host registration session", () => {
  it("uses the runtime session instead of stale UI session data", () => {
    expect(
      resolveHostRegistrationSession({
        signedIn: true,
        snapshotOwnerId: "owner-stale",
        snapshotAuthSessionId: "session-stale",
        runtimeSession: {
          ownerId: "owner-current",
          authSessionId: "session-current",
          accessToken: "token-current",
        },
      }),
    ).toEqual({
      ownerId: "owner-current",
      authSessionId: "session-current",
      accessToken: "token-current",
    });
  });
});
