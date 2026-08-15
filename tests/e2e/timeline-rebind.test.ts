import type { BrowserContext, Page } from "playwright/test";
import { chromium, expect, test } from "playwright/test";

declare const process: { cwd(): string };

/**
 * Ticket 02 时间轴回归：
 * - stale 后自动重绑：切走再切回绑定视频页、关闭视频页重开后，
 *   定位/同步按钮自动恢复可点（v16 移除手动「同步当前页面」入口后
 *   曾永久灰化）；
 * - 不同视频保持灰，且 disabled title 显示原因（no-video/mismatch）；
 * - 双图标回归：工具栏按钮无旧 ::before 图标叠加（仅 BilimuzhiIcon）。
 */
const BVID = "BV1Q541167Qg";
const OTHER_BVID = "BV1xx411c7mD";
const VIDEO_URL = `https://www.bilibili.com/video/${BVID}`;
const OTHER_URL = `https://www.bilibili.com/video/${OTHER_BVID}`;
const VIDEO_KEY = "bvid:BV1Q541167Qg:cid:30000000001:p:1";

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
  await context.addCookies([
    {
      domain: ".bilibili.com",
      expires: Math.floor(Date.now() / 1_000) + 3_600,
      httpOnly: true,
      name: "SESSDATA",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "timeline-e2e",
    },
  ]);
  const videoRe = new RegExp(
    `^https://www\\.bilibili\\.com/video/(?:${BVID}|${OTHER_BVID})/?(?:\\?.*)?$`,
  );
  await context.route(videoRe, async (route) =>
    route.fulfill({
      body: '<!doctype html><html><body><video id="player"></video><script>const video = document.querySelector("video"); Object.defineProperty(video, "duration", { value: 120 }); video.currentTime = 1.2;</script></body></html>',
      contentType: "text/html",
      status: 200,
    }),
  );
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/nav(?:\?.*)?$/,
    async (route) =>
      route.fulfill({
        body: JSON.stringify({
          code: 0,
          data: {
            isLogin: true,
            mid: 1,
            wbi_img: {
              img_url: "https://i0.hdslb.com/bfs/wbi/a.png",
              sub_url: "https://i0.hdslb.com/bfs/wbi/b.png",
            },
          },
          message: "0",
          ttl: 1,
        }),
        contentType: "application/json",
        status: 200,
      }),
  );
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
    async (route) => {
      const bvid = new URL(route.request().url()).searchParams.get("bvid");
      await route.fulfill({
        body: JSON.stringify({
          code: 0,
          data: {
            aid: bvid === OTHER_BVID ? 88_000_200 : 88_000_100,
            bvid,
            pages: [{ cid: 30_000_000_001, duration: 120, page: 1 }],
            title: "视频",
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/wbi\/view\/detail\?/,
    async (route) => {
      const bvid = new URL(route.request().url()).searchParams.get("bvid");
      await route.fulfill({
        body: JSON.stringify({
          code: 0,
          data: {
            View: {
              aid: bvid === OTHER_BVID ? 88_000_200 : 88_000_100,
              bvid,
              pages: [{ cid: 30_000_000_001, page: 1 }],
            },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );
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

async function seedBoundWorkspace(page: Page): Promise<void> {
  await page.evaluate(async (videoKey) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muzhi");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const stores = [
      "branchPlacements",
      "sessions",
      "subtitleBranches",
      "subtitleSnapshots",
      "videos",
      "workspaceSessionPlacements",
    ] as const;
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("videos").add({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "E2E 恢复视频",
      videoKey,
    });
    transaction.objectStore("sessions").add({
      activeBranchId: "branch-e2e",
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 2_000,
      selectionRevision: 1,
      sessionId: "session-e2e",
      title: "E2E 恢复视频",
      updatedAt: 2_000,
      videoKey,
    });
    transaction.objectStore("subtitleBranches").add({
      activeSubtitleId: "subtitle-e2e",
      branchId: "branch-e2e",
      contextRevision: 1,
      createdAt: 1_500,
      detectedLanguage: null,
      language: "zh-CN",
      lastOpenedAt: 2_000,
      lastSelectedAt: 2_000,
      requestedLanguageMode: null,
      sessionId: "session-e2e",
      source: "bilibili",
      title: null,
      updatedAt: 2_000,
      videoKey,
    });
    transaction.objectStore("branchPlacements").add({
      branchId: "branch-e2e",
      deletionReason: null,
      location: "workspace",
      order: 1_500,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "session-e2e",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    });
    transaction.objectStore("workspaceSessionPlacements").add({
      order: 2_000,
      pinned: false,
      sessionId: "session-e2e",
    });
    transaction.objectStore("subtitleSnapshots").add({
      branchId: "branch-e2e",
      contentHash: "sha256:e2e",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "E2E 已恢复字幕" }],
      sessionId: "session-e2e",
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-e2e",
      videoKey,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
    });
    database.close();
    const chromeValue: unknown = Reflect.get(globalThis, "chrome");
    const storage: unknown =
      typeof chromeValue === "object" && chromeValue !== null
        ? Reflect.get(chromeValue, "storage")
        : null;
    const local: unknown =
      typeof storage === "object" && storage !== null
        ? Reflect.get(storage, "local")
        : null;
    const set: unknown =
      typeof local === "object" && local !== null
        ? Reflect.get(local, "set")
        : null;
    if (typeof set !== "function") {
      throw new Error("Chrome local storage API is unavailable");
    }
    await Reflect.apply(set, local, [
      {
        "muzhi.workspace.v1": {
          activeSessionId: "session-e2e",
          sessions: [
            {
              activeMode: "summary",
              scrollTopByMode: {
                chat: 0,
                segments: 0,
                summary: 20,
                timeline: 40,
              },
              sessionId: "session-e2e",
            },
          ],
          version: 1,
        },
      },
    ]);
  }, VIDEO_KEY);
}

async function openTimeline(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "时间轴" }).click();
  await expect(page.getByText("E2E 已恢复字幕")).toBeAttached();
}

test("切走再切回/关闭重开绑定视频页后定位与同步按钮自动恢复可点", async () => {
  test.setTimeout(120_000);
  const { context, extensionId } = await launchExtension();
  try {
    const seedPage = await openSidePanel(context, extensionId);
    await seedBoundWorkspace(seedPage);
    await seedPage.close();

    const videoPage = await context.newPage();
    await videoPage.goto(VIDEO_URL);
    await videoPage.bringToFront();
    await videoPage.waitForTimeout(600);

    const page = await openSidePanel(context, extensionId);
    await openTimeline(page);

    // 视频页激活（auto-rebind）→ 两按钮可点
    await videoPage.bringToFront();
    const locate = page.getByRole("button", { name: "定位当前字幕" });
    const sync = page.getByRole("button", { name: "同步模式" });
    await expect(locate).toBeEnabled({ timeout: 8_000 });
    await expect(sync).toBeEnabled();

    // 切走再切回：保持可点
    const blank = await context.newPage();
    await blank.goto("about:blank");
    await blank.bringToFront();
    await page.waitForTimeout(600);
    await videoPage.bringToFront();
    await expect(locate).toBeEnabled({ timeout: 8_000 });

    // 关闭视频页重开：自动恢复可点
    await videoPage.close();
    await page.waitForTimeout(800);
    await expect(locate).toBeDisabled({ timeout: 4_000 });
    const videoPage2 = await context.newPage();
    await videoPage2.goto(VIDEO_URL);
    await videoPage2.bringToFront();
    await expect(locate).toBeEnabled({ timeout: 10_000 });
    await expect(sync).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("不同视频页保持灰且 disabled title 显示原因", async () => {
  test.setTimeout(120_000);
  const { context, extensionId } = await launchExtension();
  try {
    const seedPage = await openSidePanel(context, extensionId);
    await seedBoundWorkspace(seedPage);
    await seedPage.close();

    const videoPage = await context.newPage();
    await videoPage.goto(VIDEO_URL);
    await videoPage.bringToFront();
    await videoPage.waitForTimeout(600);

    const page = await openSidePanel(context, extensionId);
    await openTimeline(page);
    await videoPage.bringToFront();
    const locate = page.getByRole("button", { name: "定位当前字幕" });
    const sync = page.getByRole("button", { name: "同步模式" });
    await expect(locate).toBeEnabled({ timeout: 8_000 });

    // 切不同视频：灰 + mismatch 原因
    const other = await context.newPage();
    await other.goto(OTHER_URL);
    await other.bringToFront();
    await expect(locate).toBeDisabled({ timeout: 8_000 });
    await expect(sync).toBeDisabled();
    await expect(locate).toHaveAttribute(
      "title",
      "当前页面是其他视频，请切换到已绑定视频的页面",
    );
    await expect(sync).toHaveAttribute(
      "title",
      "当前页面是其他视频，请切换到已绑定视频的页面",
    );

    // 切回绑定视频：恢复可点
    await videoPage.bringToFront();
    await expect(locate).toBeEnabled({ timeout: 8_000 });
    await expect(sync).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("时间轴工具栏按钮无旧 ::before 图标叠加", async () => {
  test.setTimeout(60_000);
  const { context, extensionId } = await launchExtension();
  try {
    const seedPage = await openSidePanel(context, extensionId);
    await seedBoundWorkspace(seedPage);
    await seedPage.close();
    const page = await openSidePanel(context, extensionId);
    await openTimeline(page);
    const contents = await page.evaluate(() => {
      const buttons = [
        ...document.querySelectorAll(
          ".subtitle-timeline__toolbar .muzhi-btn--icon",
        ),
      ];
      return buttons.map((b) => getComputedStyle(b, "::before").content);
    });
    expect(contents.length).toBeGreaterThan(0);
    for (const content of contents) {
      expect(content).toBe("none");
    }
    // 图标仍来自 BilimuzhiIcon
    await expect(
      page.locator('.subtitle-timeline__toolbar [data-icon="locate"]'),
    ).toBeAttached();
    await expect(
      page.locator('.subtitle-timeline__toolbar [data-icon="sync"]'),
    ).toBeAttached();
  } finally {
    await context.close();
  }
});
