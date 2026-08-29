import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createE2eFixture,
  E2eModeError,
  resolveE2eMode,
  type E2eScenario,
} from "./e2e-mode.js";

const temporaryRoot = path.resolve("C:\\Temp");

function validSource(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CODEX_REMOTE_E2E: "1",
    CODEX_REMOTE_E2E_SCENARIO: "ready",
    CODEX_REMOTE_E2E_USER_DATA: path.join(
      temporaryRoot,
      "codex-remote-e2e-fixture",
    ),
    ...overrides,
  };
}

describe("resolveE2eMode", () => {
  it("keeps normal development inert when no E2E flag is present", () => {
    expect(
      resolveE2eMode({
        isPackaged: false,
        source: {},
        tempDir: temporaryRoot,
      }),
    ).toBeNull();
  });

  it.each([
    ["flag", { CODEX_REMOTE_E2E: "1" }],
    ["scenario", { CODEX_REMOTE_E2E_SCENARIO: "ready" }],
    [
      "user data",
      {
        CODEX_REMOTE_E2E_USER_DATA: path.join(
          temporaryRoot,
          "codex-remote-e2e-fixture",
        ),
      },
    ],
  ])(
    "forbids packaged launches containing the E2E %s variable",
    (_name, source) => {
      expect(() =>
        resolveE2eMode({
          isPackaged: true,
          source,
          tempDir: temporaryRoot,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<E2eModeError>>({
          code: "E2E_MODE_FORBIDDEN",
        }),
      );
    },
  );

  it("rejects an enabled fixture without a user-data path", () => {
    expect(() =>
      resolveE2eMode({
        isPackaged: false,
        source: validSource({ CODEX_REMOTE_E2E_USER_DATA: undefined }),
        tempDir: temporaryRoot,
      }),
    ).toThrow(E2eModeError);
  });

  it.each([
    ["relative", "codex-remote-e2e-fixture"],
    ["outside temp", path.resolve("C:\\Other\\codex-remote-e2e-fixture")],
    ["wrong prefix", path.join(temporaryRoot, "host-fixture")],
    [
      "nested prefix",
      path.join(
        temporaryRoot,
        "codex-remote-e2e-parent",
        "codex-remote-e2e-child",
      ),
    ],
  ])("rejects a %s user-data path", (_name, userDataDir) => {
    expect(() =>
      resolveE2eMode({
        isPackaged: false,
        source: validSource({ CODEX_REMOTE_E2E_USER_DATA: userDataDir }),
        tempDir: temporaryRoot,
      }),
    ).toThrow(E2eModeError);
  });

  it("rejects an unknown fixture scenario", () => {
    expect(() =>
      resolveE2eMode({
        isPackaged: false,
        source: validSource({ CODEX_REMOTE_E2E_SCENARIO: "admin" }),
        tempDir: temporaryRoot,
      }),
    ).toThrow(E2eModeError);
  });

  it.each<E2eScenario>(["signed-out", "ready", "offline", "codex-failed"])(
    "accepts the %s scenario in a dedicated temporary directory",
    (scenario) => {
      const userDataDir = path.join(
        temporaryRoot,
        `codex-remote-e2e-${scenario}`,
      );

      expect(
        resolveE2eMode({
          isPackaged: false,
          source: validSource({
            CODEX_REMOTE_E2E_SCENARIO: scenario,
            CODEX_REMOTE_E2E_USER_DATA: userDataDir,
          }),
          tempDir: temporaryRoot,
        }),
      ).toEqual({ scenario, userDataDir });
    },
  );
});

describe("createE2eFixture", () => {
  it("returns a schema-valid signed-out state without sensitive fixture data", async () => {
    const published: unknown[] = [];
    const fixture = createE2eFixture({
      mode: {
        scenario: "signed-out",
        userDataDir: path.join(temporaryRoot, "codex-remote-e2e-signed-out"),
      },
      publishState: (state) => published.push(state),
    });

    expect(await fixture.handlers.getDesktopState()).toMatchObject({
      authStatus: "signed-out",
      hostStatus: "stopped",
      host: null,
      workspaces: [],
    });
    expect(
      JSON.stringify(await fixture.handlers.getDesktopState()),
    ).not.toMatch(/token|secret|@|C:\\Users/i);
    expect(published).toEqual([]);
  });

  it("mutates only inert state and records action names without request values", async () => {
    const published: unknown[] = [];
    const fixture = createE2eFixture({
      mode: {
        scenario: "ready",
        userDataDir: path.join(temporaryRoot, "codex-remote-e2e-ready"),
      },
      publishState: (state) => published.push(state),
    });

    await expect(
      fixture.handlers.requestOtp({ email: "private@example.com" }),
    ).resolves.toEqual({ ok: true, message: "验证码已发送" });
    await expect(
      fixture.handlers.verifyOtp({
        email: "private@example.com",
        token: "123456",
      }),
    ).resolves.toEqual({ ok: true, message: "登录成功" });
    await fixture.handlers.setOpenAtLogin({ enabled: true });
    await fixture.handlers.startHost();
    await fixture.handlers.stopHost({ force: false });

    expect(fixture.control.getActionCalls()).toEqual([
      "requestOtp",
      "verifyOtp",
      "setOpenAtLogin",
      "startHost",
      "stopHost",
    ]);
    expect(JSON.stringify(fixture.control.getActionCalls())).not.toMatch(
      /private|123456|@/,
    );
    expect(await fixture.handlers.getDesktopState()).toMatchObject({
      authStatus: "signed-in",
      hostStatus: "stopped",
      openAtLogin: true,
    });
    expect(published.length).toBeGreaterThanOrEqual(4);
  });

  it("publishes offline, bounded restart failure, and recovered states", async () => {
    const published: Array<{
      hostStatus: string;
      runtimeReason: string | null;
    }> = [];
    const scheduled: Array<() => void> = [];
    const fixture = createE2eFixture({
      mode: {
        scenario: "ready",
        userDataDir: path.join(temporaryRoot, "codex-remote-e2e-recovery"),
      },
      publishState: (state) => published.push(state),
      schedule: (task) => scheduled.push(task),
    });

    fixture.control.setScenario("offline");
    fixture.control.setScenario("codex-failed");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    fixture.control.setScenario("ready");

    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hostStatus: "degraded",
          runtimeReason: "transport-offline",
        }),
        expect.objectContaining({
          hostStatus: "degraded",
          runtimeReason: "codex-restarting",
        }),
        expect.objectContaining({
          hostStatus: "error",
          runtimeReason: "doctor-required",
        }),
        expect.objectContaining({
          hostStatus: "running",
          runtimeReason: null,
        }),
      ]),
    );
  });
});
