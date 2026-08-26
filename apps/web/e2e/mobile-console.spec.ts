import { expect, test } from "@playwright/test";
import {
  createDisposableAuthUser,
  loadLocalSupabaseEnv,
  waitForEmailOtp,
} from "./helpers/local-supabase";
import { EncryptedFakeHost } from "./helpers/encrypted-fake-host";

test("登录入口在桌面和 Android 宽度没有横向溢出", async ({ page }) => {
  await page.goto("/login");
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.getByLabel("邮箱").focus();
  await expect(page.getByLabel("邮箱")).toBeFocused();
  const buttonBox = await page
    .getByRole("button", { name: "发送验证码" })
    .boundingBox();
  expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("完整加密控制台闭环在本地环境开启后运行", async ({ page }) => {
  const env = loadLocalSupabaseEnv();
  test.skip(
    !env || process.env.CODEX_REMOTE_E2E_CONSOLE !== "1",
    "需要本地 Supabase、Mailpit，并显式设置 CODEX_REMOTE_E2E_CONSOLE=1",
  );
  const user = await createDisposableAuthUser(env!);
  const fakeHost = new EncryptedFakeHost({ env: env!, ownerId: user.userId });
  await fakeHost.prepare();
  try {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(user.email);
    await page.getByRole("button", { name: "发送验证码" }).click();
    const otp = await waitForEmailOtp(env!, user.email);
    await page.getByLabel("验证码").fill(otp);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/hosts$/);

    const accessToken = await page.evaluate(() => {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        try {
          const parsed = JSON.parse(value) as { access_token?: unknown };
          if (typeof parsed.access_token === "string")
            return parsed.access_token;
        } catch {
          // Ignore unrelated local storage values.
        }
      }
      return null;
    });
    if (!accessToken) throw new Error("本地验收未找到登录会话");
    await fakeHost.createPairingRequest(accessToken);
    const hostReady = fakeHost.start();

    await page.goto("/pair");
    await page.getByLabel("电脑 ID").fill(fakeHost.hostId);
    await page.getByLabel("配对码").fill(fakeHost.pairingCode);
    await page.getByRole("button", { name: "开始配对" }).click();
    await expect(page).toHaveURL(/\/hosts$/);
    await hostReady;
    await expect(page.getByText("演示电脑")).toBeVisible();
    await expect(page.getByLabel("授权项目")).toHaveValue(fakeHost.workspaceId);
    await expect(page.getByRole("button", { name: "历史任务" })).toBeVisible();
    await page.getByRole("button", { name: "加载更多" }).click();
    await expect(page.getByText("还没有任务")).not.toBeVisible();
  } finally {
    await fakeHost.stop();
    await user.remove();
  }
});
