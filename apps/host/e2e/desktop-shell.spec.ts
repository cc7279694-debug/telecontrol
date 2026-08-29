import { test, expect, isWindowVisible } from "./fixtures.js";

test("keeps the renderer on the trusted local app protocol", async ({
  page,
}) => {
  expect(page.url()).toMatch(/^app:\/\/host\//);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        process: typeof (window as unknown as { process?: unknown }).process,
        require: typeof (window as unknown as { require?: unknown }).require,
        ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown })
          .ipcRenderer,
      })),
    )
    .toEqual({
      process: "undefined",
      require: "undefined",
      ipcRenderer: "undefined",
    });
});

test("denies external navigation and new windows", async ({
  page,
  electronApp,
}) => {
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.click();
    window.open("https://example.com");
  });
  await page.waitForTimeout(100);
  expect(page.url()).toMatch(/^app:\/\/host\//);
  expect(electronApp.windows()).toHaveLength(1);
});

test("shows a normal launch and keeps a hidden launch hidden", async ({
  electronApp,
}) => {
  await expect.poll(() => isWindowVisible(electronApp)).toBe(true);
});

test.describe("hidden startup", () => {
  test.use({ startHidden: true });

  test("does not show the management window", async ({ electronApp }) => {
    await expect.poll(() => isWindowVisible(electronApp)).toBe(false);
  });
});

test("hides on close and reopens for a second instance", async ({
  electronApp,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await expect.poll(() => isWindowVisible(electronApp)).toBe(false);

  await electronApp.evaluate(({ app }) => {
    app.emit("second-instance", [], "", "");
  });
  await expect.poll(() => isWindowVisible(electronApp)).toBe(true);
});
