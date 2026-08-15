import type { BrowserContext, Page } from "playwright/test";
import { chromium, expect, test } from "playwright/test";

declare const process: { cwd(): string };

/**
 * Ticket 05 5d：批量三语境帮助各自生效。
 * 回归：helpContextForSurface 曾按 utilityView 常量（恒 workspace）
 * 判断，批量归档/回收站帮助 fallback 到批量工作区教程。
 */
async function launchExtension() {
  const extensionDirectory = `${process.cwd().replaceAll("\\", "/")}/dist/extension`;
  const context = await chromium.launchPersistentContext("", {
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
    ],
    channel: "chromium",
    headless: true,
    viewport: { height: 980, width: 1280 },
  });
  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent("serviceworker");
  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
  };
}

async function openSidePanel(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  return page;
}

async function openHelpAndReadTitle(page: Page): Promise<string> {
  await page.locator(".muzhi-batch__topbar-help").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const title = await dialog.first().getAttribute("aria-label");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return title ?? "";
}

test("批量归档/回收站帮助标题各自生效（不 fallback 批量工作区）", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await page.getByRole("button", { name: "批量模式" }).first().click();
    await expect(
      page.getByRole("button", { name: "打开归档区" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "打开归档区" }).click();
    await expect(page.getByText("批量归档", { exact: true })).toBeVisible();
    expect(await openHelpAndReadTitle(page)).toBe("批量归档教程");

    await page.getByRole("button", { name: "返回工作区" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "打开回收站" }).click();
    await expect(page.getByText("批量回收站", { exact: true })).toBeVisible();
    expect(await openHelpAndReadTitle(page)).toBe("批量回收站教程");
  } finally {
    await context.close();
  }
});
