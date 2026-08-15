import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "playwright/test";

declare const process: { cwd(): string };

/**
 * T10：语言切换 e2e 抽查（docs/i18n-spec.md §2）。
 * 关键断言：设置抽屉切 UI 语言后，header/设置导航/抽屉按钮立即切换；
 * 语言选择持久化（重开侧栏仍生效）；en/ja 各抽查一轮。
 */
async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const extensionDirectory = `${process.cwd().replaceAll("\\", "/")}/dist/extension`;
  const context = await chromium.launchPersistentContext("", {
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
    ],
    channel: "chromium",
    headless: true,
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
  // 品牌名「Bilimuzhi」不随语言变化（docs/i18n-spec.md §3 技术标识豁免）
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  return page;
}

async function openSettingsAndLanguage(page: Page): Promise<void> {
  // 左下角设置按钮（会话抽屉底部工具区）
  const settingsButton = page.getByRole("button", { name: "打开设置" });
  await settingsButton.click();
  // 设置分类「语言」tab
  await page.getByRole("tab", { name: "语言", exact: true }).click();
}

async function switchUiLanguage(
  page: Page,
  optionValue: "zh-Hant" | "en" | "ja",
): Promise<void> {
  const languageSelect = page.getByRole("combobox", {
    name: "界面语言",
  });
  await languageSelect.selectOption(optionValue);
}

test("切换 UI 语言为 en 后关键文案立即变化且持久化", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    // zh-Hans 基线
    await expect(page.getByRole("button", { name: "打开设置" })).toBeVisible();

    await openSettingsAndLanguage(page);
    await switchUiLanguage(page, "en");

    // 设置抽屉内立即变化
    await expect(
      page.getByRole("tab", { name: "Language", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // 关闭设置后 header 状态文字变化
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await expect(
      page.locator(".muzhi-shell__status", { hasText: "Session Workspace" }),
    ).toBeVisible();

    // 持久化：等待写入 chrome.storage 后再重开侧栏
    await page.waitForTimeout(800);
    await page.close();
    const page2 = await openSidePanel(context, extensionId);
    await expect(
      page2.locator(".muzhi-shell__status", { hasText: "Session Workspace" }),
    ).toBeVisible();
    // 会话抽屉为英文（complementary 区域与按钮）
    await expect(
      page2.getByRole("complementary", { name: "Sessions" }),
    ).toBeVisible();
    await expect(
      page2.getByRole("button", { name: "New Session" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("切换 UI 语言为 ja 后关键文案立即变化", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await openSettingsAndLanguage(page);
    await switchUiLanguage(page, "ja");

    await expect(
      page.getByRole("tab", { name: "言語", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

    await page
      .getByRole("button", { name: "設定を閉じる", exact: true })
      .click();
    // 会话抽屉开关按钮为日文
    await expect(
      page.getByRole("button", { name: "セッションを開く" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
