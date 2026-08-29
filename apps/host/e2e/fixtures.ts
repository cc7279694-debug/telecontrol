import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import type { E2eScenario } from "../src/desktop/e2e-mode.js";

type E2eFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

type E2eOptions = {
  scenario: E2eScenario;
  startHidden: boolean;
};

const hostRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mainEntry = path.join(hostRoot, "dist", "desktop", "main.js");

export const test = base.extend<E2eFixtures & E2eOptions>({
  scenario: ["ready", { option: true }],
  startHidden: [false, { option: true }],
  electronApp: async ({ scenario, startHidden }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "codex-remote-e2e-"));
    const env = {
      ...process.env,
      CODEX_REMOTE_E2E: "1",
      CODEX_REMOTE_E2E_SCENARIO: scenario,
      CODEX_REMOTE_E2E_USER_DATA: userDataDir,
    };
    const args = [mainEntry];
    if (startHidden) args.push("--hidden");

    const app = await electron.launch({
      args,
      cwd: hostRoot,
      env,
    });
    try {
      await use(app);
    } finally {
      await app.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
});

export { expect };

export async function setScenario(
  electronApp: ElectronApplication,
  scenario: E2eScenario,
): Promise<void> {
  await electronApp.evaluate((_electron, requestedScenario) => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: {
          setScenario: (next: E2eScenario) => void;
        };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    control.setScenario(requestedScenario);
  }, scenario);
}

export async function getActionCalls(
  electronApp: ElectronApplication,
): Promise<readonly string[]> {
  return electronApp.evaluate(() => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: {
          getActionCalls: () => readonly string[];
        };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    return [...control.getActionCalls()];
  });
}

export async function getTrayMenuLabels(
  electronApp: ElectronApplication,
): Promise<readonly string[]> {
  return electronApp.evaluate(() => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: {
          getTrayMenuLabels: () => readonly string[];
        };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    return [...control.getTrayMenuLabels()];
  });
}

export async function setPairingState(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(() => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: { setPairingState: () => void };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    control.setPairingState();
  });
}

export async function setActiveRemoteTurns(
  electronApp: ElectronApplication,
  count: number,
): Promise<void> {
  await electronApp.evaluate((_electron, requestedCount) => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: {
          setActiveRemoteTurns: (nextCount: number) => void;
        };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    control.setActiveRemoteTurns(requestedCount);
  }, count);
}

export async function releaseOtp(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(() => {
    const control = (
      globalThis as typeof globalThis & {
        __codexRemoteE2e?: { releaseOtp: () => void };
      }
    ).__codexRemoteE2e;
    if (!control) throw new Error("E2E control unavailable");
    control.releaseOtp();
  });
}

export async function isWindowVisible(
  electronApp: ElectronApplication,
): Promise<boolean> {
  return electronApp.evaluate(({ BrowserWindow }) =>
    Boolean(BrowserWindow.getAllWindows()[0]?.isVisible()),
  );
}
