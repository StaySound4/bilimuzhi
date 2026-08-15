import type { BrowserContext } from "playwright/test";
import { chromium, expect, test } from "playwright/test";

declare const process: { cwd(): string };

import { seedAttackWorkspace } from "./zz-seed";

async function launchExtension() {
  const extensionDirectory = `${process.cwd().replaceAll("\\", "/")}/dist/extension`;
  const context = await chromium.launchPersistentContext("", {
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
    ],
    channel: "chromium",
    headless: true,
    viewport: { height: 980, width: 920 },
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
  return page;
}

async function openArchive(context: BrowserContext, extensionId: string) {
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByRole("heading", { name: "归档" })).toBeVisible();
  return page;
}

test("常驻标签面板：无需按钮展开，新建标签即时可用", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  // 面板常驻：chips 直接可见（无「筛选标签/筛选组合」开关按钮）
  await expect(page.getByRole("button", { name: "考试 (2)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "复习 (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "动漫 (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "筛选标签" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选组合" })).toHaveCount(0);

  // 输入新标签 → 添加立即可用（onInput）
  const input = page.getByLabel("新标签名称");
  await input.click();
  await page.keyboard.type("冲刺");
  await page.getByRole("button", { name: "添加标签" }).click();
  await expect(page.getByRole("button", { name: "冲刺 (0)" })).toBeVisible();

  await context.close();
});

test("默认多选筛选：点标签切换多选，交集过滤", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  // 点「考试」→ 选中
  const exam = page.getByRole("button", { name: "考试 (2)" });
  await exam.click();
  await expect(exam).toHaveAttribute("aria-pressed", "true");
  // 归档甲/乙（有考试）可见，归档丙（只有动漫）被筛掉
  await expect(page.getByText("归档甲", { exact: true })).toBeVisible();
  await expect(page.getByText("归档乙", { exact: true })).toBeVisible();
  await expect(page.getByText("归档丙", { exact: true })).toHaveCount(0);

  // 再点「复习」→ 多选交集（只有归档乙同时有考试+复习）
  const review = page.getByRole("button", { name: "复习 (1)" });
  await review.click();
  await expect(review).toHaveAttribute("aria-pressed", "true");
  await expect(exam).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("归档乙", { exact: true })).toBeVisible();
  await expect(page.getByText("归档甲", { exact: true })).toHaveCount(0);

  // 再点「考试」→ 取消选中（仍选中复习 → 交集只剩归档乙）
  await exam.click();
  await expect(exam).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("归档乙", { exact: true })).toBeVisible();
  await expect(page.getByText("归档甲", { exact: true })).toHaveCount(0);

  // 清除筛选
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByText("归档丙", { exact: true })).toBeVisible();

  await context.close();
});

test("管理标签面板：选中标签后重命名/删除可用，拖拽排序存在", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  await page.getByRole("button", { name: "管理标签" }).click();
  const panel = page.getByLabel("管理标签");
  await expect(panel).toBeVisible();
  // 管理面板可直接新建标签
  await panel.getByLabel("新标签名称").fill("面板新建");
  await panel.getByRole("button", { name: "添加标签" }).click();
  await expect(panel.getByText("面板新建 (0)")).toBeVisible();
  // 未选中：重命名/删除禁用（灰色）
  await expect(panel.getByRole("button", { name: "重命名" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "删除" })).toBeDisabled();
  // 点击标签（单选）→ 按钮亮起
  await panel.getByText("考试 (2)").click();
  await expect(panel.getByRole("button", { name: "重命名" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "删除" })).toBeEnabled();
  // 重命名
  await panel.getByRole("button", { name: "重命名" }).click();
  await page.getByLabel("重命名 考试").fill("备考");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(panel.getByText("备考 (2)")).toBeVisible();
  // 删除：确认条 → 确认（重命名后仍选中，再点一次会取消选中，先重新选中）
  await panel.getByText("备考 (2)").click();
  await panel.getByText("备考 (2)").click();
  await panel.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText(/确定删除「备考」/)).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel.getByText("备考 (2)")).toBeVisible();
  // 拖拽行存在（draggable 排序）
  const row = panel.locator("[draggable=true]").first();
  await expect(row).toBeVisible();

  await context.close();
});

test("卡片：状态槽行显示归档时间；展开详情无编辑标签按钮", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  // 归档时间在卡片状态槽行（状态文本 · 归档于 …）
  const card = page.locator(".muzhi-archive__session").first();
  const status = card.locator(".muzhi-archive__status");
  await expect(status).toBeVisible();
  await expect(status.getByText(/归档于/)).toBeVisible();

  // 展开详情：无「编辑标签」按钮（卡片右侧 🏷 已有，避免冗余）
  await page.getByRole("button", { name: "归档操作 归档甲" }).click();
  const detail = page.locator(".muzhi-archive__menu");
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "打开会话", exact: true }),
  ).toBeVisible();
  await expect(detail.getByRole("button", { name: "重命名" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "编辑标签" })).toHaveCount(0);
  // 展开详情保留标签 chips
  await expect(
    detail.locator(".muzhi-archive__menu-tag").first(),
  ).toBeVisible();

  await context.close();
});

test("卡片 🏷 编辑标签：卡片内展开面板（紧贴卡片），勾选保存", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  await page.getByRole("button", { name: "编辑标签 归档甲" }).click();
  // 面板在卡片内展开（同三点菜单框架），非底部对话框
  const panel = page.getByLabel("编辑标签", { exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator("xpath=ancestor::li[1]")).toHaveClass(
    /muzhi-archive__session/,
  );
  // 归档甲已有「考试」→ 默认勾选（选中项有底纹样式类）
  await expect(panel.getByLabel("考试")).toBeChecked();
  // 精简：无「添加新标签」与「搜索标签」
  await expect(panel.getByLabel("新标签名称")).toHaveCount(0);
  await expect(panel.getByLabel("搜索标签")).toHaveCount(0);
  await panel.getByLabel("复习").check();
  await panel.getByRole("button", { name: "确定" }).click();
  await expect(panel).toHaveCount(0);

  await context.close();
});

test("菜单单例互斥：三点菜单与编辑标签/管理面板只开一个，同钮 toggle", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openArchive(context, extensionId);

  // 三点菜单（以「打开会话」按钮为标志）
  const openButton = page.getByRole("button", {
    name: "打开会话",
    exact: true,
  });
  await page.getByRole("button", { name: "归档操作 归档甲" }).click();
  await expect(openButton).toBeVisible();
  // 点编辑标签图标 → 三点菜单收起、卡片内编辑面板打开（互斥切换）
  await page.getByRole("button", { name: "编辑标签 归档甲" }).click();
  await expect(openButton).toHaveCount(0);
  const panel = page.getByLabel("编辑标签", { exact: true });
  await expect(panel).toBeVisible();
  // 再点同一图标 → 面板收起（toggle）
  await page.getByRole("button", { name: "编辑标签 归档甲" }).click();
  await expect(panel).toHaveCount(0);
  // 管理面板与三点互斥
  await page.getByRole("button", { name: "归档操作 归档乙" }).click();
  await expect(openButton).toBeVisible();
  await page.getByRole("button", { name: "管理标签" }).click();
  await expect(openButton).toHaveCount(0);
  await expect(page.getByLabel("管理标签")).toBeVisible();
  // 管理面板同钮 toggle 收起
  await page.getByRole("button", { name: "管理标签" }).click();
  await expect(page.getByLabel("管理标签")).toHaveCount(0);

  await context.close();
});
