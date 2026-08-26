import { expect, test } from "@playwright/test";
import {
  createDisposableAuthUser,
  loadLocalSupabaseEnv,
  waitForEmailOtp,
} from "./helpers/local-supabase";

test("登录页拒绝无效邮箱并保持移动端可用", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "连接你的开发电脑" }),
  ).toBeVisible();
  await page.getByLabel("邮箱").fill("not-an-email");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.locator("#auth-error")).toHaveText("请输入有效的邮箱地址");
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    page.viewportSize()?.width,
  );
});

test("未登录访问电脑页会回到登录页", async ({ page }) => {
  await page.goto("/hosts");
  await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/);
});

test("本地 OTP 登录闭环", async ({ page }) => {
  const env = loadLocalSupabaseEnv();
  test.skip(!env, "Docker Desktop 或本地 Supabase 未运行");
  const user = await createDisposableAuthUser(env!);
  try {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(user.email);
    await page.getByRole("button", { name: "发送验证码" }).click();
    await expect(page.getByText("验证码已发送至")).toBeVisible();
    const otp = await waitForEmailOtp(env!, user.email);
    await page.getByLabel("验证码").fill(otp);
    await page.getByRole("button", { name: "登录" }).click();
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).some(({ name }) =>
            /^sb-.+-auth-token(?:\.\d+)?$/.test(name),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.goto("/hosts");
    await expect(page).toHaveURL(/\/hosts$/);
  } finally {
    await user.remove();
  }
});
