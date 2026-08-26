import { expect, test } from "@playwright/test";

test("PWA 清单、图标和离线页可访问", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const body = await manifest.json();
  expect(body.name).toBe("Codex Remote 远程控制");
  expect(body.start_url).toBe("/hosts");
  expect(body.display).toBe("standalone");
  expect(body.icons).toHaveLength(3);

  for (const icon of [
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
  ]) {
    const response = await request.get(icon);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  await page.goto("/offline");
  await expect(
    page.getByRole("heading", { name: "当前无法连接电脑" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("提示词");
  const themeButton = page.getByRole("button", { name: "切换主题" });
  await expect(themeButton).toHaveText(/浅色|深色/);
  const initialTheme = await page.locator("html").getAttribute("class");
  await themeButton.click();
  await expect(page.locator("html")).not.toHaveClass(
    new RegExp(initialTheme ?? "^$"),
  );

  const pushKey = await request.get("/api/push/vapid-public-key");
  expect(pushKey.status()).toBe(503);
  const unauthenticatedSubscribe = await request.post(
    "/api/push/subscription",
    {
      data: {
        deviceId: "00000000-0000-4000-8000-000000000001",
        subscription: {
          endpoint: "https://push.example.test/subscription",
          keys: { p256dh: "public-key", auth: "auth-secret" },
        },
      },
    },
  );
  expect(unauthenticatedSubscribe.status()).toBe(401);
});

test("Service Worker 只接管静态壳，不缓存受保护页面", async ({ page }) => {
  await page.goto("/offline");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(
    async () =>
      Boolean((await navigator.serviceWorker.getRegistration("/"))?.active),
    undefined,
    { timeout: 10_000 },
  );
  const registration = await page.evaluate(async () => {
    const result = await navigator.serviceWorker.getRegistration("/");
    return result?.active?.scriptURL ?? null;
  });
  expect(registration).toContain("/sw.js");
  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(
      keys.map(async (key) => (await caches.open(key)).keys()),
    );
    return entries.flat().map((request) => request.url);
  });
  expect(cachedUrls.some((url) => url.includes("/hosts"))).toBeFalsy();
  expect(cachedUrls.some((url) => url.includes("/login"))).toBeFalsy();
  expect(cachedUrls.some((url) => url.includes("/rest/v1"))).toBeFalsy();
  expect(cachedUrls.some((url) => url.includes("/realtime/v1"))).toBeFalsy();
});
