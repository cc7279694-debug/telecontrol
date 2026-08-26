// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { loadOfflineStatus, saveOfflineStatus } from "./offline-status";

describe("offline status", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips only the non-sensitive status fields", () => {
    saveOfflineStatus({
      online: false,
      observedAt: "2026-08-26T01:00:00.000Z",
      lastTurnStatus: "completed",
    });

    expect(loadOfflineStatus()).toEqual({
      online: false,
      observedAt: "2026-08-26T01:00:00.000Z",
      lastTurnStatus: "completed",
    });
  });

  it("rejects malformed or sensitive cached values", () => {
    localStorage.setItem(
      "codex-remote:offline-status:v1",
      JSON.stringify({
        online: true,
        observedAt: "2026-08-26T01:00:00.000Z",
        lastTurnStatus: null,
        prompt: "不要保存",
      }),
    );
    expect(loadOfflineStatus()).toBeNull();
  });
});
