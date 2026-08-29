import {
  expect,
  getActionCalls,
  releaseOtp,
  setActiveRemoteTurns,
  setPairingState,
  setRawErrorMessage,
  setScenario,
  test,
} from "./fixtures.js";

test.describe("signed-out Host flow", () => {
  test.use({ scenario: "signed-out" });

  test("locks the login flow and enters the signed-in overview", async ({
    page,
    electronApp,
  }) => {
    await page.getByLabel("邮箱").fill("private@example.com");
    const sendOtpButton = page.locator('form button[type="submit"]');
    const sendOtp = sendOtpButton.click();
    await expect
      .poll(async () => getActionCalls(electronApp))
      .toContain("requestOtp");
    await expect(sendOtpButton).toBeDisabled();
    await releaseOtp(electronApp);
    await sendOtp;
    await expect(page.getByLabel("邮箱验证码")).toBeVisible();
    await page.getByLabel("邮箱验证码").fill("123456");
    await page.getByRole("button", { name: "完成登录" }).click();
    await expect(
      page.getByRole("heading", { name: "Host 已登录" }),
    ).toBeVisible();
    await expect(page.getByText("示例项目")).toBeVisible();
    const notices = await page.locator("p.notice").allTextContents();
    expect(notices.join("\n")).not.toMatch(
      /C:\\Users|accessToken|private@example\.com|123456/i,
    );
  });
});

test.describe("signed-in Host flow", () => {
  test.use({ scenario: "ready" });

  test("controls the Host and reports a cancelled directory selection", async ({
    page,
    electronApp,
  }) => {
    await expect(page.getByText("Host 运行中")).toBeVisible();
    await page.getByRole("button", { name: "停止 Host" }).click();
    await expect(page.locator("p.status")).toHaveText("Host 已停止");
    await page.getByRole("button", { name: "启动 Host" }).click();
    await expect(page.getByText("Host 运行中")).toBeVisible();

    await page.getByRole("button", { name: "添加项目" }).click();
    await expect(page.getByText("已取消添加项目")).toBeVisible();
    await expect
      .poll(async () => getActionCalls(electronApp))
      .toContain("chooseWorkspace");
  });

  test("runs maintenance actions and requires the reset phrase", async ({
    page,
    electronApp,
  }) => {
    await page.getByRole("button", { name: "运行 Doctor" }).click();
    await expect(
      page.getByText("Doctor 检查通过", { exact: true }).last(),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "开机时启动" }).check();
    await expect(page.getByText("开机启动：开启")).toBeVisible();
    await page.getByRole("button", { name: "打开日志目录" }).click();
    await expect(page.getByText("测试模式不会打开日志目录")).toBeVisible();

    await page.getByRole("button", { name: "清除本机数据" }).click();
    await expect(page.getByText("确认清除本机数据")).toBeVisible();
    await page.getByLabel("确认内容").fill("确认清除本机数据");
    await page.getByRole("button", { name: "确认清除" }).click();
    await expect(
      page.getByRole("heading", { name: "登录 Windows Host" }),
    ).toBeVisible();
    await expect
      .poll(async () => getActionCalls(electronApp))
      .toContain("confirmDataReset");
  });

  test("shows pairing code and confirms stopping active work", async ({
    page,
    electronApp,
  }) => {
    await setPairingState(electronApp);
    await page.getByRole("button", { name: "生成配对码" }).click();
    await expect(page.getByLabel("当前配对码")).toContainText("000000");

    await setActiveRemoteTurns(electronApp, 1);
    let dialogDismissed = false;
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("确定要强制停止 Host 吗");
      dialogDismissed = true;
      await dialog.dismiss();
    });
    await page.getByRole("button", { name: "停止 Host" }).click();
    expect(dialogDismissed).toBe(true);
    expect(await getActionCalls(electronApp)).not.toContain("stopHost");

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("确定要强制停止 Host 吗");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "停止 Host" }).click();
    await expect(page.locator("p.status")).toHaveText("Host 已停止");
    expect(await getActionCalls(electronApp)).toContain("stopHost:force");
  });

  test("shows a Doctor failure and supports signing out", async ({
    page,
    electronApp,
  }) => {
    await setScenario(electronApp, "codex-failed");
    await page.getByRole("button", { name: "运行 Doctor" }).click();
    await expect(
      page.getByText("Doctor 检查发现问题，请先修复", { exact: true }).last(),
    ).toBeVisible();

    await setScenario(electronApp, "ready");
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录 Windows Host" }),
    ).toBeVisible();
  });

  test("redacts raw error details from visible messages", async ({
    page,
    electronApp,
  }) => {
    await setRawErrorMessage(electronApp);
    await page.getByRole("button", { name: "运行 Doctor" }).click();

    await expect(
      page.getByText("Doctor 检查失败，请稍后重试", { exact: true }).last(),
    ).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /C:\\Users|access_token|private@example\.com|123456/i,
    );
  });
});
