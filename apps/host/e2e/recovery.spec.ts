import { expect, setScenario, test } from "./fixtures.js";

test.use({ scenario: "ready" });

test("presents offline, bounded Codex restart, and recovered states", async ({
  page,
  electronApp,
}) => {
  await setScenario(electronApp, "offline");
  await expect(
    page.getByText("中转连接暂时不可用", { exact: true }),
  ).toBeVisible();

  await setScenario(electronApp, "codex-failed");
  await expect(
    page.getByText("Codex App Server 正在重启（1/3）"),
  ).toBeVisible();
  await expect(
    page.getByText("Codex App Server 正在重启（2/3）"),
  ).toBeVisible();
  await expect(page.getByText("Codex App Server 启动失败")).toBeVisible();

  await setScenario(electronApp, "ready");
  await expect(page.getByText("Host 运行中")).toBeVisible();
  await page.getByRole("button", { name: "运行 Doctor" }).click();
  await expect(
    page.getByText("Doctor 检查通过", { exact: true }).last(),
  ).toBeVisible();
});

test("does not overflow common mobile viewport widths", async ({ page }) => {
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
