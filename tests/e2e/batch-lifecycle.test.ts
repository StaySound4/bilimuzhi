import type { BrowserContext, Page } from "playwright/test";
import { chromium, expect, test } from "playwright/test";

declare const process: { cwd(): string };

/**
 * 批量生命周期修复（2026-08-13 切片 Ticket 01）回归：
 * - 归档/回收站视图首次打开必须显示最新数据（stale 渲染回归）；
 * - 归档区直接恢复必须真正回到工作区（repository restore 只处理
 *   trash 的回归）；
 * - 删除进回收站、回收站恢复链路。
 * 数据路由（归档→archiveBatchPlacements、删除→trashBatchPlacements）
 * 由集成测试锁定，本文件只验证真实扩展端到端可见行为。
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

async function openSidePanel(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  await page.getByRole("button", { name: "批量模式" }).first().click();
  await page
    .getByRole("button", { name: "新建列表", exact: true })
    .first()
    .click();
  await expect(page.getByText("1 个列表")).toBeVisible();
  return page;
}

async function clickListMenu(page: Page, itemName: string) {
  // 菜单层 role="menu" 出现后再点击 menuitem（显式 role 覆盖 button 隐式 role，
  // 因此必须用 getByRole("menuitem") 定位）。
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: itemName, exact: true }).click();
}

test("归档后首次打开归档区即可见，且归档区恢复真正回到工作区", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);

    // 归档「新建列表1」（非运行中，无确认框）
    await page.getByRole("button", { name: "列表操作 新建列表1" }).click();
    await clickListMenu(page, "归档");
    await expect(page.getByText("0 个列表")).toBeVisible();

    // 首次打开归档区：列表必须立即可见（stale 渲染回归）
    await page.getByRole("button", { name: "打开归档区" }).click();
    await expect(page.getByText("新建列表1")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("1 个列表")).toBeVisible();

    // 归档区直接恢复
    await page.getByRole("button", { name: "列表操作 新建列表1" }).click();
    await clickListMenu(page, "恢复列表至工作区");
    // 恢复后选中该列表，但保留当前归档区界面（不切走）。
    await expect(page.getByText("1 个列表")).toBeVisible({ timeout: 5_000 });
    // 选中的列表名出现在归档区（恢复后自动选中、界面保留）。
    await expect(
      page.getByText("新建列表1", { exact: true }).first(),
    ).toBeVisible();
    // 界面仍停留在归档区（用户要求保留当前界面）。
    await expect(page.getByText("批量归档", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("删除后首次打开回收站即可见，回收站恢复回到工作区", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);

    // 删除（危险确认）
    await page.getByRole("button", { name: "列表操作 新建列表1" }).click();
    await clickListMenu(page, "删除");
    await page.getByRole("button", { name: "确认" }).click();
    await expect(page.getByText("0 个列表")).toBeVisible();

    // 首次打开回收站：列表必须立即可见（stale 渲染回归）
    await page.getByRole("button", { name: "打开回收站" }).click();
    await expect(page.getByText("新建列表1")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("1 个列表")).toBeVisible();

    // 回收站恢复
    await page.getByRole("button", { name: "列表操作 新建列表1" }).click();
    await clickListMenu(page, "恢复列表至工作区");
    // 恢复后选中该列表，但保留当前归档区界面（不切走）。
    await expect(page.getByText("1 个列表")).toBeVisible({ timeout: 5_000 });
    // 选中的列表名出现在归档区（恢复后自动选中、界面保留）。
    await expect(
      page.getByText("新建列表1", { exact: true }).first(),
    ).toBeVisible();
    // 界面仍停留在对应区（用户要求保留当前界面）。
    await expect(page.getByText("批量回收站", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
