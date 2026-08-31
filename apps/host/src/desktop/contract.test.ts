import { describe, expect, it } from "vitest";
import {
  ActionResultSchema,
  BeginDataResetResultSchema,
  DesktopStateSchema,
  confirmDataResetInputSchema,
  desktopApiMethodNames,
  removeWorkspaceInputSchema,
  requestOtpInputSchema,
  setOpenAtLoginInputSchema,
  stopHostInputSchema,
  verifyOtpInputSchema,
} from "./contract.js";

const validState = {
  phase: "ready",
  authStatus: "signed-out",
  hostStatus: "stopped",
  runtimeReason: null,
  activeRemoteTurns: 0,
  lastObservedAt: null,
  lastErrorCode: null,
  openAtLogin: false,
  workspaces: [],
  pairing: null,
  notice: "此功能尚未启用",
} as const;

describe("desktop contract", () => {
  it("accepts the safe desktop state and rejects secret-bearing or raw payload fields", () => {
    expect(DesktopStateSchema.parse(validState)).toEqual(validState);

    for (const forbiddenState of [
      { ...validState, accessToken: "secret" },
      { ...validState, refreshToken: "secret" },
      { ...validState, session: { user: { id: "user-1" } } },
      { ...validState, privateJwk: { d: "secret" } },
      { ...validState, publicJwk: { x: "value" } },
      { ...validState, row: { id: "database-row" } },
      { ...validState, error: new Error("raw") },
      { ...validState, readFile: () => undefined },
    ]) {
      expect(DesktopStateSchema.safeParse(forbiddenState).success).toBe(false);
    }
  });

  it("keeps action and reset results small and strict", () => {
    expect(
      ActionResultSchema.parse({ ok: false, message: "此功能尚未启用" }),
    ).toEqual({
      ok: false,
      message: "此功能尚未启用",
    });
    expect(
      BeginDataResetResultSchema.parse({ phrase: "RESET HOST DATA" }),
    ).toEqual({
      phrase: "RESET HOST DATA",
    });
    expect(
      ActionResultSchema.safeParse({
        ok: false,
        message: "失败",
        error: new Error("raw"),
      }).success,
    ).toBe(false);
    expect(
      BeginDataResetResultSchema.safeParse({
        phrase: "RESET",
        path: "C:\\Users",
      }).success,
    ).toBe(false);
  });

  it("exposes only local workspace labels and short-lived pairing display data", () => {
    const state = DesktopStateSchema.parse({
      ...validState,
      workspaces: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "项目",
          path: "C:\\Users\\demo\\Projects\\project",
        },
      ],
      pairing: {
        code: "123456",
        expiresAt: "2026-08-27T00:05:00.000Z",
      },
    });
    expect(state.workspaces[0]?.path).toContain("C:\\Users");
    expect(state.pairing?.code).toBe("123456");
    expect(
      DesktopStateSchema.safeParse({
        ...validState,
        pairing: { code: "secret", expiresAt: "2026-08-27T00:05:00.000Z" },
      }).success,
    ).toBe(false);
  });

  it("strictly validates every input-bearing request", () => {
    expect(requestOtpInputSchema.parse({ email: "user@example.com" })).toEqual({
      email: "user@example.com",
    });
    expect(
      requestOtpInputSchema.safeParse({ email: "invalid", token: "extra" })
        .success,
    ).toBe(false);
    expect(
      verifyOtpInputSchema.safeParse({ email: "user@example.com", token: "" })
        .success,
    ).toBe(false);
    expect(
      verifyOtpInputSchema.safeParse({
        email: "user@example.com",
        token: "12345",
      }).success,
    ).toBe(false);
    expect(
      verifyOtpInputSchema.safeParse({
        email: "user@example.com",
        token: "123456",
      }).success,
    ).toBe(true);
    expect(
      verifyOtpInputSchema.safeParse({
        email: "user@example.com",
        token: "12345678",
      }).success,
    ).toBe(true);
    for (const token of ["12345", "12345678901", "12345a"]) {
      expect(
        verifyOtpInputSchema.safeParse({
          email: "user@example.com",
          token,
        }).success,
      ).toBe(false);
    }
    expect(
      removeWorkspaceInputSchema.safeParse({ workspaceId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      setOpenAtLoginInputSchema.safeParse({ enabled: "yes" }).success,
    ).toBe(false);
    expect(stopHostInputSchema.parse({ force: false })).toEqual({
      force: false,
    });
    expect(stopHostInputSchema.safeParse({ force: "yes" }).success).toBe(false);
    expect(confirmDataResetInputSchema.safeParse({ phrase: "" }).success).toBe(
      false,
    );
  });

  it("accepts degraded runtime state with a safe reason and counters", () => {
    const state = DesktopStateSchema.parse({
      ...validState,
      hostStatus: "degraded",
      runtimeReason: "awaiting-pairing",
      activeRemoteTurns: 2,
      lastObservedAt: "2026-08-28T00:00:00.000Z",
      lastErrorCode: "transport_connect_failed",
    });

    expect(state.hostStatus).toBe("degraded");
    expect(state.runtimeReason).toBe("awaiting-pairing");
    expect(state.activeRemoteTurns).toBe(2);
  });

  it("defines only the approved preload method names", () => {
    expect(desktopApiMethodNames).toEqual([
      "getDesktopState",
      "requestOtp",
      "verifyOtp",
      "signOut",
      "chooseWorkspace",
      "removeWorkspace",
      "createPairingCode",
      "startHost",
      "stopHost",
      "runDoctor",
      "setOpenAtLogin",
      "openLogFolder",
      "beginDataReset",
      "confirmDataReset",
      "subscribeDesktopState",
    ]);
  });
});
