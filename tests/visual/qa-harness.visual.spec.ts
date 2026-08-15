/**
 * QA harness 真实浏览器 smoke 收集门（Ticket 03）。
 *
 * 启动 QA build 扩展（dist/extension 必须由 `npm run build:qa` 生成），
 * 对每个 required smoke scenario 打开 qa-harness.html?scenario=<id>，
 * 断言 expected anchor 可见并收集 scenario proof。
 *
 * 门禁语义：
 * - 零测试（无 scenario 可收集）→ playwright 无测试退出非 0（本 spec 不使用
 *   --pass-with-no-tests）；
 * - 缺少任一 required smoke ID → 本 spec 显式断言失败，退出非 0。
 */
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "playwright/test";

declare const process: { cwd(): string };

/** Ticket 03 要求真实浏览器 smoke 的固定 scenario ID 集合。 */
export const REQUIRED_SMOKE_SCENARIOS = [
  "batch-empty",
  "batch-mixed-20",
  "batch-mixed-94",
  "batch-selected-2",
  "batch-running",
  "batch-partial-failure",
  "batch-completed",
  "timeline-populated-20",
  "timeline-current",
  "timeline-long-text",
  "timeline-sync-following",
  "timeline-sync-seek-pending",
  "timeline-locate-mismatch",
  "timeline-sync-rapid-click",
  "timeline-sync-owner-lost",
  "chat-populated",
  "chat-streaming",
  "chat-failed",
  "chat-needs-reselection",
  "chat-language-locked",
  "chat-attachments",
  "sessions-populated",
  "sessions-selected",
  "sessions-pinned",
  "sessions-multi-select",
  "segments-populated",
  "summary-populated",
  "workspace-no-subtitle",
  "workspace-no-video",
  "workspace-no-content",
  "session-help-dialog",
  "session-archive-help-dialog",
  "session-trash-help-dialog",
  "batch-help-dialog",
  "batch-archive-help-dialog",
  "batch-trash-help-dialog",
  "primitives-demo",
  "batch-job-menu-open",
  "batch-overwrite-choice",
  "batch-clear-job-confirm",
  "batch-row-speech-settings",
  "batch-export-options",
  "batch-speech-strategy-choice",
  "batch-column-settings",
  "sessions-menu-open",
  "chat-thread-menu-open",
] as const;

export interface QaAnchor {
  readonly role?: string;
  readonly name?: string | RegExp;
  readonly css?: string;
}

interface QaProof {
  readonly activeTab: string;
  readonly counts: Record<string, number>;
  readonly expectedAnchors: readonly {
    readonly role?: string;
    readonly name?: string | RegExp;
    readonly css?: string;
  }[];
  readonly interactions: readonly {
    readonly trigger?: QaAnchor;
    readonly expect: QaAnchor;
    readonly steps?: readonly QaAnchor[];
  }[];
  readonly id: string;
  readonly state: string;
  readonly surface: string;
  readonly theme: string;
}

async function launchQaExtension(): Promise<{
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

async function openQaScenario(
  context: BrowserContext,
  extensionId: string,
  scenarioId: string,
  theme: "light" | "dark" = "light",
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/qa-harness.html?scenario=${scenarioId}&theme=${theme}`,
  );
  await expect(page.locator(".muzhi-app")).toBeVisible();
  return page;
}

async function readProof(page: Page): Promise<QaProof> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        __MUZHI_QA__?: {
          expectedAnchors: readonly {
            role?: string;
            name?: string | RegExp;
            css?: string;
          }[];
          interactions: readonly {
            trigger?: { role?: string; name?: string | RegExp; css?: string };
            expect: { role?: string; name?: string | RegExp; css?: string };
            steps?: readonly {
              role?: string;
              name?: string | RegExp;
              css?: string;
            }[];
          }[];
          getComputedStyles(): Record<string, string>;
          getTheme(): string;
          getThemeAttribute(): { name: string; value: string };
          scenario: {
            activeTab: string;
            counts: Record<string, number>;
            id: string;
            state: string;
            surface: string;
            theme: string;
          };
        };
      }
    ).__MUZHI_QA__;
    if (api === undefined) {
      throw new Error("window.__MUZHI_QA__ 未暴露");
    }
    const attribute = api.getThemeAttribute();
    if (attribute.value !== api.getTheme()) {
      throw new Error(
        `data-theme=${attribute.value} 与 scenario theme=${api.getTheme()} 不一致`,
      );
    }
    const styles = api.getComputedStyles();
    for (const key of ["canvas", "background", "text", "accent"]) {
      if (typeof styles[key] !== "string" || styles[key].trim() === "") {
        throw new Error(`computedStyles.${key} 缺失`);
      }
    }
    return {
      activeTab: api.scenario.activeTab,
      counts: api.scenario.counts,
      expectedAnchors: api.expectedAnchors,
      interactions: api.interactions,
      id: api.scenario.id,
      state: api.scenario.state,
      surface: api.scenario.surface,
      theme: api.scenario.theme,
    };
  });
}

async function assertAnchorVisible(
  page: Page,
  anchor: QaAnchor,
): Promise<void> {
  if (anchor.css !== undefined) {
    await expect(page.locator(anchor.css).first()).toBeVisible();
    return;
  }
  if (anchor.role !== undefined) {
    const locator =
      anchor.name !== undefined
        ? page.getByRole(anchor.role as never, { name: anchor.name })
        : page.getByRole(anchor.role as never);
    await expect(locator.first()).toBeVisible();
    return;
  }
  throw new Error("anchor 必须提供 role 或 css");
}

const TIMELINE_PANEL_VIEWPORTS = [
  { width: 520, height: 900 },
  { width: 760, height: 900 },
  { width: 1158, height: 1152 },
] as const;

const BATCH_PANEL_VIEWPORTS = [
  { width: 360, height: 520 },
  { width: 400, height: 600 },
  { width: 520, height: 900 },
  { width: 760, height: 900 },
  { width: 1158, height: 1152 },
] as const;

interface BatchGeometryProof {
  readonly appOverflow: number;
  readonly bodyOverflow: number;
  /** 控制区（顶栏+摘要+筛选）高度 / 面板可视高度。 */
  readonly controlsRatio: number;
  readonly headerSticky: boolean;
  readonly headerVisible: boolean;
  readonly helpHit: boolean;
  /** 顶部横向滚动条可见（宽屏表格视图）并与表格横向滚动双向同步。 */
  readonly hscrollVisible: boolean;
  readonly hscrollSync: boolean;
  readonly lastRowReachable: boolean;
  readonly tableScrollReachable: boolean;
  readonly scrollOwnerCount: number;
  readonly scrollOwnerClasses: readonly string[];
  /** 列表滚动区内完整可见的数据行数。 */
  readonly visibleFullRows: number;
}

async function readBatchGeometry(page: Page): Promise<BatchGeometryProof> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>(".muzhi-app");
    const help = document.querySelector<HTMLElement>(
      ".muzhi-batch__topbar-help",
    );
    const tableScroll = document.querySelector<HTMLElement>(
      ".muzhi-batch__table-scroll",
    );
    if (!app || !help || !tableScroll) {
      throw new Error("Batch 几何锚点缺失");
    }
    // 列表滚动区自身可达（唯一纵向滚动 owner）。
    const tableScrollRect = tableScroll.getBoundingClientRect();
    const tableScrollReachable =
      tableScrollRect.top < window.innerHeight && tableScrollRect.bottom > 0;
    help.scrollIntoView({ block: "center" });
    const helpRect = help.getBoundingClientRect();
    const hit = document.elementFromPoint(
      (helpRect.left + helpRect.right) / 2,
      (helpRect.top + helpRect.bottom) / 2,
    );
    const batch = document.querySelector<HTMLElement>(".muzhi-batch");
    const lastRow = document.querySelector<HTMLElement>(
      ".muzhi-batch__table tbody tr:last-child",
    );
    const tableHeader = document.querySelector<HTMLElement>(
      ".muzhi-batch__table thead",
    );
    if (!batch || !tableScroll || !lastRow || !tableHeader) {
      throw new Error("Batch 滚动锚点缺失");
    }
    const hscroll = document.querySelector<HTMLElement>(
      ".muzhi-batch__hscroll",
    );
    const hscrollRect = hscroll?.getBoundingClientRect() ?? null;
    const hscrollVisible =
      hscroll !== null &&
      hscrollRect !== null &&
      hscrollRect.width > 0 &&
      hscrollRect.height > 0 &&
      getComputedStyle(hscroll).display !== "none";
    let hscrollSync = false;
    if (hscroll !== null && hscrollVisible) {
      const previousScrollLeft = tableScroll.scrollLeft;
      hscroll.scrollLeft = 40;
      hscroll.dispatchEvent(new Event("scroll", { bubbles: true }));
      hscrollSync = tableScroll.scrollLeft === 40;
      tableScroll.scrollLeft = previousScrollLeft;
      hscroll.scrollLeft = 0;
    }
    const batchRect = batch.getBoundingClientRect();
    const scrollRect = tableScroll.getBoundingClientRect();
    const controlsRatio =
      window.innerHeight > 0
        ? (scrollRect.top - batchRect.top) / window.innerHeight
        : 0;
    const rowRects = Array.from(
      document.querySelectorAll<HTMLElement>(".muzhi-batch__table tbody tr"),
    ).map((row) => row.getBoundingClientRect());
    const visibleFullRows = rowRects.filter(
      (rect) =>
        rect.top >= scrollRect.top - 0.5 &&
        rect.bottom <= scrollRect.bottom + 0.5,
    ).length;
    const scrollOwners = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll<HTMLElement>("body *"),
    ].filter((candidate) => {
      const style = getComputedStyle(candidate);
      return (
        candidate.scrollHeight > candidate.clientHeight + 1 &&
        candidate.clientHeight > 0 &&
        /(auto|scroll)/u.test(style.overflowY)
      );
    });
    const scrollOwner = scrollOwners[0];
    if (!scrollOwner) throw new Error("Batch 唯一滚动 owner 缺失");
    const previousScrollTop = scrollOwner.scrollTop;
    scrollOwner.scrollTop = scrollOwner.scrollHeight;
    const lastRowRect = lastRow.getBoundingClientRect();
    const lastRowReachable =
      lastRowRect.top < window.innerHeight && lastRowRect.bottom > 0;
    scrollOwner.scrollTop = previousScrollTop;
    return {
      appOverflow: app.scrollWidth - app.clientWidth,
      bodyOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      controlsRatio,
      hscrollSync,
      hscrollVisible,
      headerSticky:
        getComputedStyle(tableHeader.querySelector("th") ?? tableHeader)
          .position === "sticky",
      headerVisible: (() => {
        const rect = tableHeader.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0;
      })(),
      helpHit: hit === help || (hit !== null && help.contains(hit)),
      lastRowReachable,
      tableScrollReachable,
      scrollOwnerCount: scrollOwners.length,
      scrollOwnerClasses: scrollOwners.map((owner) => owner.className),
      visibleFullRows,
    };
  });
}

test.describe("QA harness smoke 收集门", () => {
  // 串行：同一 worker 顺序执行，collected 数组跨 test 共享；
  // 若任一 smoke 失败则收集门最终断言失败，退出非 0。
  test.describe.configure({ mode: "serial" });
  let context: BrowserContext;
  let extensionId: string;
  const collected: string[] = [];
  test.beforeAll(async () => {
    ({ context, extensionId } = await launchQaExtension());
  });

  test.afterAll(async () => {
    await context.close();
  });

  for (const scenarioId of REQUIRED_SMOKE_SCENARIOS) {
    test(`smoke: ${scenarioId} 可打开且 expected anchor 可见`, async () => {
      const page = await openQaScenario(context, extensionId, scenarioId);
      const proof = await readProof(page);
      expect(proof.id).toBe(scenarioId);
      expect(proof.counts).toBeTruthy();
      expect(proof.expectedAnchors.length).toBeGreaterThan(0);
      for (const anchor of proof.expectedAnchors) {
        await assertAnchorVisible(page, anchor);
      }
      // Ticket 06：交互型 scenario 先点击 trigger（或 steps 链），再断言 expect。
      for (const interaction of proof.interactions ?? []) {
        const clickAnchor = async (anchor: QaAnchor): Promise<void> => {
          const locator =
            anchor.role !== undefined
              ? page.getByRole(anchor.role as never, {
                  name: anchor.name,
                })
              : page.locator(anchor.css ?? "");
          await locator.first().click();
        };
        if (interaction.steps !== undefined) {
          for (const step of interaction.steps) {
            await clickAnchor(step);
          }
        } else if (interaction.trigger !== undefined) {
          await clickAnchor(interaction.trigger);
        }
        await assertAnchorVisible(page, interaction.expect);
      }
      collected.push(scenarioId);
      await page.close();
    });
  }

  for (const viewport of TIMELINE_PANEL_VIEWPORTS) {
    test(`Timeline ${viewport.width}×${viewport.height} 占满剩余高度且仅列表滚动`, async () => {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-populated-20",
      );
      await page.setViewportSize(viewport);
      const proof = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(
          ".muzhi-shell__panel",
        );
        const timeline =
          document.querySelector<HTMLElement>(".subtitle-timeline");
        const viewportElement = document.querySelector<HTMLElement>(
          ".subtitle-timeline__viewport",
        );
        if (!panel || !timeline || !viewportElement) {
          throw new Error("Timeline 几何锚点缺失");
        }
        const panelRect = panel.getBoundingClientRect();
        const viewportRect = viewportElement.getBoundingClientRect();
        const owners = [
          document.documentElement,
          document.body,
          ...panel.querySelectorAll<HTMLElement>("*"),
        ].filter((candidate) => {
          const style = getComputedStyle(candidate);
          return (
            candidate.clientHeight > 0 && /(auto|scroll)/u.test(style.overflowY)
          );
        });
        return {
          bottomGap: panelRect.bottom - viewportRect.bottom,
          clientHeight: viewportElement.clientHeight,
          inlineHeight: viewportElement.style.height,
          ownerClasses: owners.map((owner) => owner.className),
          viewportScrollable:
            viewportElement.scrollHeight > viewportElement.clientHeight + 1,
          renderedRows: timeline.querySelectorAll(
            '[data-testid="subtitle-row"]',
          ).length,
        };
      });
      expect(proof.bottomGap).toBeGreaterThanOrEqual(0);
      expect(proof.bottomGap).toBeLessThanOrEqual(24);
      expect(proof.clientHeight).toBeGreaterThan(320);
      expect(proof.inlineHeight).toBe("");
      expect(proof.ownerClasses).toEqual(["subtitle-timeline__viewport"]);
      expect(proof.viewportScrollable).toBe(true);
      expect(proof.renderedRows).toBeGreaterThan(8);
      const timelineViewport = page.getByRole("region", { name: "字幕时间线" });
      await timelineViewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await expect(
        page.getByText("最后一行：节目到此结束，感谢观看。"),
      ).toBeVisible();
      await page.close();
    });
  }

  test("Ticket 08 时间轴同步状态机与定位可用性（真实装配投影）", async () => {
    // following：高亮跟随最近被接受的采样（旧 currentTimeMs 不回跳），定位禁用
    {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-sync-following",
      );
      await page.setViewportSize({ width: 520, height: 900 });
      const current = await page
        .locator("li[aria-current='true']")
        .textContent();
      expect(current).toContain(
        "一个高偏差的模型通常过于简单，无法捕捉数据中的规律。",
      );
      await expect(
        page.getByRole("button", { name: "定位当前字幕" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "同步模式" }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.close();
    }
    // seeking：高亮锁定 seek 目标行（60s → 第 20 行），不被旧采样回拉
    {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-sync-seek-pending",
      );
      await page.setViewportSize({ width: 520, height: 900 });
      const current = await page
        .locator("li[aria-current='true']")
        .textContent();
      expect(current).toContain("时间戳与跳转：点击当前行应调用 seek。");
      await page.close();
    }
    // 关闭/切换视频页：owner 不匹配 → 定位与同步都不可用
    {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-locate-mismatch",
      );
      await page.setViewportSize({ width: 520, height: 900 });
      await expect(
        page.getByRole("button", { name: "定位当前字幕" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "同步模式" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "同步模式" }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.close();
    }
    // 快速连续点击：last intent wins，高亮最终目标（60s → 行 20），旧采样不回跳
    {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-sync-rapid-click",
      );
      await page.setViewportSize({ width: 520, height: 900 });
      const current = await page
        .locator("li[aria-current='true']")
        .textContent();
      expect(current).toContain("时间戳与跳转：点击当前行应调用 seek。");
      await page.close();
    }
    // owner 失效：同步已自动关闭（按钮未按下）
    {
      const page = await openQaScenario(
        context,
        extensionId,
        "timeline-sync-owner-lost",
      );
      await page.setViewportSize({ width: 520, height: 900 });
      await expect(
        page.getByRole("button", { name: "同步模式" }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.close();
    }
  });

  test("Summary/Segments 默认折叠并将空间留给产物区", async () => {
    for (const scenarioId of [
      "summary-populated",
      "segments-populated",
    ] as const) {
      const page = await openQaScenario(context, extensionId, scenarioId);
      await page.setViewportSize({ width: 520, height: 900 });
      const trigger = page.getByRole("button", { name: "配置模型" });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".muzhi-task-context__inspector")).toHaveCount(
        0,
      );
      const collapsedHeight = await page
        .locator(".muzhi-task-context")
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(collapsedHeight).toBeLessThan(56);
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.locator(".muzhi-task-context__inspector"),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await page.close();
    }
  });

  test("四工作区 no-subtitle/no-content 使用生产装配的统一空态 DOM", async () => {
    const cases = [
      {
        scenario: "workspace-no-subtitle",
        tabs: ["时间轴", "分段", "总结", "对话"],
        variant: "no-subtitle",
        titles: ["尚无字幕", "尚无字幕", "尚无字幕", "尚无字幕"],
      },
      {
        scenario: "workspace-no-content",
        tabs: ["分段", "总结", "对话"],
        variant: "no-content",
        titles: ["尚未生成分段", "尚未生成总结", "暂无对话消息"],
      },
    ] as const;
    for (const entry of cases) {
      const page = await openQaScenario(context, extensionId, entry.scenario);
      await page.setViewportSize({ width: 520, height: 900 });
      for (let index = 0; index < entry.tabs.length; index += 1) {
        await page.getByRole("tab", { name: entry.tabs[index] }).click();
        const empty = page.locator(".muzhi-workspace-empty");
        await expect(empty).toHaveAttribute(
          "data-empty-variant",
          entry.variant,
        );
        await expect(empty.locator("strong")).toHaveText(entry.titles[index]);
        await expect(empty.locator(":scope > p")).toHaveCount(1);
      }
      await page.close();
    }
  });

  for (const viewport of BATCH_PANEL_VIEWPORTS) {
    test(`Batch ${viewport.width}×${viewport.height} 无页面越界且关键操作可达`, async () => {
      const page = await openQaScenario(context, extensionId, "batch-mixed-94");
      await page.setViewportSize(viewport);
      const proof = await readBatchGeometry(page);
      expect(proof.bodyOverflow).toBeLessThanOrEqual(1);
      expect(proof.appOverflow).toBeLessThanOrEqual(1);
      if (viewport.width > 520) expect(proof.helpHit).toBe(true);
      expect(proof.tableScrollReachable).toBe(true);
      expect(proof.headerVisible).toBe(true);
      expect(proof.headerSticky).toBe(true);
      // 顶部横向滚动条：宽屏表格视图可见且与表格横向滚动双向同步。
      if (viewport.width > 399) {
        expect(proof.hscrollVisible).toBe(true);
        expect(proof.hscrollSync).toBe(true);
      }
      expect(proof.lastRowReachable).toBe(true);
      expect(proof.scrollOwnerCount).toBe(1);

      await page.locator(".muzhi-batch__table-scroll").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const interactionRow = page
        .locator(".muzhi-batch__table tbody tr")
        .first();
      const firstCheckbox = interactionRow.locator('input[type="checkbox"]');
      await expect(firstCheckbox).toBeEnabled();
      if (viewport.width > 399) {
        await interactionRow.scrollIntoViewIfNeeded();
        await expect(firstCheckbox).toBeInViewport();
        const initiallyChecked = await firstCheckbox.isChecked();
        await firstCheckbox.click({ position: { x: 6, y: 6 }, timeout: 5_000 });
        await expect(firstCheckbox).toBeChecked({ checked: !initiallyChecked });
      }

      // 过滤菜单在表格工具栏内，任何宽度都可见（抽屉三点菜单窄屏隐藏）。
      const more = page.locator(
        ".muzhi-batch__list-toolbar .muzhi-compact-menu__trigger",
      );
      if ((await more.count()) > 0) {
        await more.first().scrollIntoViewIfNeeded();
        await more.first().click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expect(more.first()).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      }

      const selectAll = page.getByRole("button", {
        name: /选择当前筛选的全部 94 项/u,
      });
      await expect(selectAll).toBeVisible();
      if (viewport.width === 360) await expect(selectAll).toBeInViewport();
      else await selectAll.scrollIntoViewIfNeeded();
      await selectAll.click();
      await expect(
        page.locator('.muzhi-batch__table input[type="checkbox"]'),
      ).toHaveCount(94);

      // Ticket 04：无分页控件；全量 94 行渲染，最后一行可达。
      await expect(page.locator(".muzhi-batch__table tbody tr")).toHaveCount(
        94,
      );
      const tableScroll = page.locator(".muzhi-batch__table-scroll");
      await tableScroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await expect(
        page.locator(".muzhi-batch__table tbody tr").last(),
      ).toBeInViewport();
      await page.close();
    });
  }

  for (const scale of [1.25, 1.5] as const) {
    test(`Batch 400×600 字体缩放 ${scale * 100}% 保持可用`, async () => {
      const page = await openQaScenario(context, extensionId, "batch-mixed-94");
      await page.setViewportSize({
        width: Math.floor(400 / scale),
        height: Math.floor(600 / scale),
      });
      const proof = await readBatchGeometry(page);
      expect(proof.bodyOverflow).toBeLessThanOrEqual(1);
      expect(proof.appOverflow).toBeLessThanOrEqual(1);
      expect(proof.tableScrollReachable).toBe(true);
      expect(proof.headerVisible).toBe(true);
      expect(proof.headerSticky).toBe(true);
      const help = page.locator(".muzhi-batch__topbar-help");
      await expect(help).toBeVisible();
      await help.click();
      await expect(help).toBeFocused();
      const tableScroll = page.locator(".muzhi-batch__table-scroll");
      await expect(tableScroll).toBeInViewport();
      const selectAll = page.getByRole("button", {
        name: /选择当前筛选的全部 94 项/u,
      });
      await expect(selectAll).toBeVisible();
      await selectAll.click();
      const lastRow = page.locator(".muzhi-batch__table tbody tr").last();
      await lastRow.scrollIntoViewIfNeeded();
      await expect(lastRow).toBeInViewport();
      expect(proof.scrollOwnerClasses).toEqual(["muzhi-batch__table-scroll"]);
      await page.close();
    });
  }
  test("Ticket 11：活动列表控制区预算与最少完整可见行（Q44 硬断言）", async () => {
    // Q44 预算：控制区 ≤ 36/30/24/20/18%，完整行 ≥ 2/4/8/10/14。
    // Ticket 11 紧凑化修复后实测：0.208/0.2/0.172/0.172/0.114 与 2/6/10/10/15。
    const ratioBudgets = [0.36, 0.3, 0.24, 0.2, 0.18] as const;
    const minRows = [2, 4, 8, 10, 14] as const;
    for (let i = 0; i < BATCH_PANEL_VIEWPORTS.length; i += 1) {
      const viewport = BATCH_PANEL_VIEWPORTS[i];
      const page = await openQaScenario(context, extensionId, "batch-mixed-94");
      await page.setViewportSize(viewport);
      const proof = await readBatchGeometry(page);
      expect(
        proof.controlsRatio,
        `${viewport.width}×${viewport.height} 控制区预算`,
      ).toBeLessThanOrEqual(ratioBudgets[i]);
      expect(
        proof.visibleFullRows,
        `${viewport.width}×${viewport.height} 完整行预算`,
      ).toBeGreaterThanOrEqual(minRows[i]);
      await page.close();
    }
  });

  test("Ticket 10：四语言检查——长文案/按钮/ARIA/本土化词汇", async () => {
    const languages = ["zh-Hans", "zh-Hant", "en", "ja"] as const;
    for (const lang of languages) {
      const page = await openQaScenario(context, extensionId, "batch-mixed-20");
      await page.goto(`${page.url()}&lang=${lang}`);
      await page.setViewportSize({ width: 400, height: 600 });
      const proof = await readBatchGeometry(page);
      expect(proof.bodyOverflow).toBeLessThanOrEqual(1);
      expect(proof.appOverflow).toBeLessThanOrEqual(1);
      // 本土化按钮与 ARIA 随语言切换（title 文案来自 messages；四语言下
      // accessible name 不同，用 class 锚点 + aria-label 非空断言）。
      const primary = page.locator(".muzhi-batch__primary-action");
      await expect(primary).toBeVisible();
      const primaryText = await primary.textContent();
      expect(primaryText).not.toBeNull();
      expect(primaryText!.trim().length).toBeGreaterThan(0);
      const help = page.locator(".muzhi-batch__topbar-help");
      await expect(help).toBeVisible();
      const helpAria = await help.getAttribute("aria-label");
      expect(helpAria).not.toBeNull();
      expect(helpAria!.length).toBeGreaterThan(0);
      // 本地化词汇：每语言必须出现该语言的专属按钮文案。
      const expectedByLang: Record<string, string> = {
        "zh-Hans": "解析并加入列表",
        "zh-Hant": "解析並加入列表",
        en: "Resolve & add to list",
        ja: "解析してリストに追加",
      };
      const pageText = await page.locator(".muzhi-batch").textContent();
      expect(pageText, `lang=${lang} 本土化文案`).toContain(
        expectedByLang[lang],
      );
      // 且不得出现其它语言文案（除 zh-Hans 与 zh-Hant 共享部分词汇外）。
      if (lang === "en" || lang === "ja") {
        expect(pageText).not.toContain("解析并加入列表");
        expect(pageText).not.toContain("解析並加入列表");
      }
      await page.close();
    }
  });

  test("Ticket 10：四语言帮助 Dialog 可打开、正文可滚动、单关闭按钮", async () => {
    const languages = ["zh-Hans", "zh-Hant", "en", "ja"] as const;
    for (const lang of languages) {
      const page = await openQaScenario(
        context,
        extensionId,
        "batch-help-dialog",
      );
      await page.goto(`${page.url()}&lang=${lang}`);
      await page.setViewportSize({ width: 400, height: 600 });
      const dialog = page.locator(".muzhi-dialog");
      await expect(dialog).toBeVisible();
      // 帮助正文可滚动（长文案四语言均不截断容器）。
      const scrollProof = await dialog.evaluate((element) => {
        const overflows = element.scrollHeight > element.clientHeight + 1;
        return {
          clientHeight: element.clientHeight,
          overflows,
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
        };
      });
      // 内容未超容器时可无需滚动；一旦溢出必须可滚动（overflow-y: auto）。
      expect(scrollProof.overflowY, `lang=${lang} 帮助可滚动`).toBe("auto");
      if (scrollProof.overflows) {
        expect(scrollProof.scrollHeight).toBeGreaterThan(
          scrollProof.clientHeight,
        );
      }
      // 单关闭按钮（六语境帮助统一单动作；四语言下文本随语言切换）。
      await expect(dialog.locator("button")).toHaveCount(1);
      await dialog.locator("button").click();
      await expect(dialog).toHaveCount(0);
      await page.close();
    }
  });

  test("帮助 Dialog 在 360×520 可读、可滚动、可关闭（单关闭按钮）", async () => {
    const page = await openQaScenario(
      context,
      extensionId,
      "batch-help-dialog",
    );
    await page.setViewportSize({ width: 360, height: 520 });
    const dialog = page.getByRole("dialog", { name: "批量模式教程" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("button")).toHaveCount(1);
    await expect(dialog.locator("button")).toHaveText("关闭");
    await dialog.getByRole("button", { name: "关闭" }).click();
    await expect(dialog).toHaveCount(0);
    await page.close();
  });

  test("全部 required smoke scenario IDs 均被收集（非空且无缺失）", () => {
    expect(collected.length).toBeGreaterThan(0);
    const missing = REQUIRED_SMOKE_SCENARIOS.filter(
      (id) => !collected.includes(id),
    );
    expect(missing).toEqual([]);
  });
});
