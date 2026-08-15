import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "playwright/test";

declare const process: { cwd(): string };

const ICON_SIZES = [16, 32, 48, 128] as const;

const BILIBILI_API_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-headers": "accept, content-type",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-origin": "https://www.bilibili.com",
  vary: "Origin",
};

const BILIBILI_CDN_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
};

async function seedBilibiliLogin(context: BrowserContext): Promise<void> {
  const runtimeOnlyValue = globalThis.crypto.randomUUID().replaceAll("-", "");
  await context.addCookies([
    {
      domain: ".bilibili.com",
      expires: Math.floor(Date.now() / 1_000) + 3_600,
      httpOnly: true,
      name: "SESSDATA",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: runtimeOnlyValue,
    },
  ]);
}

const WBI_NAV_RESPONSE = Object.freeze({
  code: 0,
  data: Object.freeze({
    isLogin: true,
    mid: 88_000_000,
    wbi_img: Object.freeze({
      img_url:
        "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url:
        "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    }),
  }),
  message: "0",
  ttl: 1,
});

async function routeExactVideoWbiIdentity(
  context: BrowserContext,
  identity: {
    readonly aid: number;
    readonly bvid: string;
    readonly pages: readonly {
      readonly cid: number;
      readonly page: number;
    }[];
  },
): Promise<void> {
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/nav(?:\?.*)?$/,
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(WBI_NAV_RESPONSE),
        contentType: "application/json",
        headers: BILIBILI_API_CORS_HEADERS,
        status: 200,
      });
    },
  );
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/wbi\/view\/detail\?/,
    async (route) => {
      const requestUrl = new URL(route.request().url());
      expect(requestUrl.searchParams.get("bvid")).toBe(identity.bvid);
      expect(requestUrl.searchParams.get("need_elec")).toBe("1");
      expect(requestUrl.searchParams.get("w_rid")).toMatch(/^[0-9a-f]{32}$/);
      expect(requestUrl.searchParams.get("wts")).toMatch(/^\d+$/);
      await route.fulfill({
        body: JSON.stringify({
          code: 0,
          data: {
            View: {
              aid: identity.aid,
              bvid: identity.bvid,
              pages: identity.pages,
            },
          },
        }),
        contentType: "application/json",
        headers: BILIBILI_API_CORS_HEADERS,
        status: 200,
      });
    },
  );
}

async function routeUnavailableSubtitleWebView(
  context: BrowserContext,
  identity: { readonly aid: number; readonly cid: number },
): Promise<void> {
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/v2\/subtitle\/web\/view\?/,
    async (route) => {
      const requestUrl = new URL(route.request().url());
      expect(requestUrl.searchParams.get("pid")).toBe(String(identity.aid));
      expect(requestUrl.searchParams.get("oid")).toBe(String(identity.cid));
      await route.fulfill({
        body: JSON.stringify({ code: -404 }),
        contentType: "application/json",
        headers: BILIBILI_API_CORS_HEADERS,
        status: 404,
      });
    },
  );
}

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
  await seedBilibiliLogin(context);
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

async function expectBoundVideoRegion(
  page: Page,
  expected: {
    readonly bvid: string;
    readonly hasSubtitle: boolean;
    readonly pageNumber: number;
    readonly status: "页面已切换、关闭或未连接" | "页面已连接";
    readonly title: string;
  },
): Promise<void> {
  const boundVideo = page.getByRole("region", { name: "已绑定视频" });
  await expect(boundVideo).toBeVisible();
  await expect(
    boundVideo.getByRole("heading", {
      exact: true,
      level: 2,
      name: expected.title,
    }),
  ).toBeVisible();
  await expect(
    boundVideo.getByText(expected.bvid, { exact: true }),
  ).toBeVisible();
  await expect(
    boundVideo.getByText(`P ${expected.pageNumber}`, { exact: true }),
  ).toBeVisible();
  await expect(
    boundVideo.getByText(expected.status, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "BV 号或完整 URL" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "同步当前页面" })).toHaveCount(
    0,
  );
  await expect(
    boundVideo.getByRole("button", { name: "重新获取" }),
  ).toHaveCount(expected.hasSubtitle ? 1 : 0);
}

async function expectInitialAcquisitionSelection(page: Page): Promise<void> {
  const selection = page.getByRole("region", { name: "选择字幕来源" });
  await expect(selection).toBeVisible();
  await expect(
    selection.getByRole("button", { name: "获取视频自带字幕" }),
  ).toBeVisible();
  await expect(
    selection.getByRole("button", { name: "开始语音转字幕" }),
  ).toBeVisible();
}

type PlayerRaceAction =
  | "capturedCount"
  | "enable"
  | "enableAndClickLocate"
  | "pendingIndices"
  | "reject"
  | "resolve";

async function openSidePanelWithPlayerRaceHarness(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const chromeValue: unknown = Reflect.get(globalThis, "chrome");
    const runtime =
      typeof chromeValue === "object" && chromeValue !== null
        ? (Reflect.get(chromeValue, "runtime") as unknown)
        : null;
    const originalSendMessage =
      typeof runtime === "object" && runtime !== null
        ? (Reflect.get(runtime, "sendMessage") as unknown)
        : null;
    if (
      typeof runtime !== "object" ||
      runtime === null ||
      typeof originalSendMessage !== "function"
    ) {
      Reflect.set(globalThis, "__muzhiPlayerRaceHarness", {
        installed: false,
      });
      return;
    }
    const pending: Array<{
      readonly message: Record<string, unknown>;
      reject(error: unknown): void;
      resolve(value: unknown): void;
      settled: boolean;
    }> = [];
    let enabled = false;
    const harness = {
      capturedCount: () => pending.length,
      enable(value: unknown) {
        enabled = value === true;
      },
      enableAndClickLocate() {
        const locate = [...document.querySelectorAll("button")].find(
          (button) => button.textContent?.trim() === "定位当前字幕",
        );
        if (!(locate instanceof HTMLButtonElement) || locate.disabled) {
          throw new Error("The locate-current control is unavailable");
        }
        enabled = true;
        locate.click();
      },
      installed: true,
      pendingIndices: () =>
        pending.flatMap((entry, index) => (entry.settled ? [] : [index])),
      reject(indexValue: unknown) {
        const index = Number(indexValue);
        const entry = pending[index];
        if (entry === undefined || entry.settled) {
          throw new Error("The controlled player request is not pending");
        }
        entry.settled = true;
        entry.reject(new Error("controlled late player read rejection"));
      },
      resolve(indexValue: unknown, currentTimeValue: unknown) {
        const index = Number(indexValue);
        const currentTimeMs = Number(currentTimeValue);
        const entry = pending[index];
        const payload =
          entry === undefined
            ? null
            : (Reflect.get(entry.message, "payload") as unknown);
        if (
          entry === undefined ||
          entry.settled ||
          typeof payload !== "object" ||
          payload === null ||
          !Number.isSafeInteger(currentTimeMs) ||
          currentTimeMs < 0
        ) {
          throw new Error("The controlled player request cannot be resolved");
        }
        entry.settled = true;
        entry.resolve({
          payload: {
            currentTimeMs,
            videoKey: Reflect.get(payload, "videoKey"),
          },
          protocolVersion: Reflect.get(entry.message, "protocolVersion"),
          requestId: Reflect.get(entry.message, "requestId"),
          type: "muzhi.video.time.reported",
        });
      },
    };
    const interceptedSendMessage = function (
      this: unknown,
      ...args: unknown[]
    ): unknown {
      const message = args[0];
      if (
        enabled &&
        typeof message === "object" &&
        message !== null &&
        Reflect.get(message, "type") === "muzhi.video.time.read"
      ) {
        return new Promise((resolve, reject) => {
          pending.push({
            message: message as Record<string, unknown>,
            reject,
            resolve,
            settled: false,
          });
        });
      }
      return Reflect.apply(originalSendMessage, runtime, args);
    };
    Reflect.set(runtime, "sendMessage", interceptedSendMessage);
    Reflect.set(globalThis, "__muzhiPlayerRaceHarness", harness);
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

async function playerRaceAction(
  page: Page,
  action: PlayerRaceAction,
  ...args: readonly unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ actionName, values }) => {
      const harness: unknown = Reflect.get(
        globalThis,
        "__muzhiPlayerRaceHarness",
      );
      if (
        typeof harness !== "object" ||
        harness === null ||
        Reflect.get(harness, "installed") !== true
      ) {
        throw new Error("The player race harness was not installed");
      }
      const operation = Reflect.get(harness, actionName) as unknown;
      if (typeof operation !== "function") {
        throw new Error("The player race harness action is unavailable");
      }
      return Reflect.apply(operation, harness, values);
    },
    { actionName: action, values: [...args] },
  );
}

async function readSessionRuleCount(context: BrowserContext): Promise<number> {
  const serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker)
    throw new Error("Extension Service Worker is unavailable");
  return await serviceWorker.evaluate(async () => {
    const chromeValue: unknown = Reflect.get(globalThis, "chrome");
    const dnr =
      typeof chromeValue === "object" && chromeValue !== null
        ? Reflect.get(chromeValue, "declarativeNetRequest")
        : null;
    const getSessionRules =
      typeof dnr === "object" && dnr !== null
        ? Reflect.get(dnr, "getSessionRules")
        : null;
    if (typeof getSessionRules !== "function") {
      throw new Error("Chrome DNR API is unavailable");
    }
    const rules = await Reflect.apply(getSessionRules, dnr, []);
    return Array.isArray(rules) ? rules.length : -1;
  });
}

async function readPersistedAcquisition(page: Page): Promise<{
  activeSubtitleId: string | null;
  sessionCount: number;
  snapshotStatus: string | null;
  storedWorkspace: unknown;
  videoKey: string | null;
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muzhi");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const transaction = database.transaction(
      ["sessions", "subtitleBranches", "subtitleSnapshots"],
      "readonly",
    );
    const sessionsRequest = transaction.objectStore("sessions").getAll();
    const branchesRequest = transaction
      .objectStore("subtitleBranches")
      .getAll();
    const snapshotsRequest = transaction
      .objectStore("subtitleSnapshots")
      .getAll();
    const readAll = (
      request: IDBRequest<unknown[]>,
    ): Promise<Array<Record<string, unknown>>> =>
      new Promise((resolve, reject) => {
        request.addEventListener(
          "success",
          () => resolve(request.result as Array<Record<string, unknown>>),
          { once: true },
        );
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
    const [sessions, branches, snapshots] = await Promise.all([
      readAll(sessionsRequest),
      readAll(branchesRequest),
      readAll(snapshotsRequest),
    ]);
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
    const get: unknown =
      typeof local === "object" && local !== null
        ? Reflect.get(local, "get")
        : null;
    if (typeof get !== "function") {
      throw new Error("Chrome local storage API is unavailable");
    }
    const storedWorkspace = await Reflect.apply(get, local, [
      "muzhi.workspace.v1",
    ]);

    const session = sessions[0];
    const activeBranchId =
      session && typeof session.activeBranchId === "string"
        ? session.activeBranchId
        : null;
    const activeBranch = branches.find(
      (branch) => branch.branchId === activeBranchId,
    );
    const activeSubtitleId =
      activeBranch && typeof activeBranch.activeSubtitleId === "string"
        ? activeBranch.activeSubtitleId
        : null;
    const activeSnapshot = snapshots.find(
      (snapshot) => snapshot.subtitleId === activeSubtitleId,
    );
    return {
      activeSubtitleId,
      sessionCount: sessions.length,
      snapshotStatus:
        activeSnapshot && typeof activeSnapshot.status === "string"
          ? activeSnapshot.status
          : null,
      storedWorkspace,
      videoKey:
        session && typeof session.videoKey === "string"
          ? session.videoKey
          : null,
    };
  });
}

async function seedRestoredWorkspace(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const videoKey = "bvid:BV1Q541167Qg:cid:30000000001:p:1";
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muzhi");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const requiredStores = [
      "branchPlacements",
      "sessions",
      "subtitleBranches",
      "subtitleSnapshots",
      "videos",
      "workspaceSessionPlacements",
    ] as const;
    const missingStores = requiredStores.filter(
      (storeName) => !database.objectStoreNames.contains(storeName),
    );
    if (missingStores.length > 0) {
      database.close();
      throw new Error(
        `Restored workspace seed requires initialized stores: ${missingStores.join(", ")}`,
      );
    }
    const transaction = database.transaction(
      [
        "branchPlacements",
        "sessions",
        "subtitleBranches",
        "subtitleSnapshots",
        "videos",
        "workspaceSessionPlacements",
      ],
      "readwrite",
    );
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
      transaction.addEventListener("complete", () => resolve(), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
    });
    database.close();

    const chromeValue: unknown = Reflect.get(globalThis, "chrome");
    if (typeof chromeValue !== "object" || chromeValue === null) {
      throw new Error("Chrome extension API is unavailable");
    }
    const storage: unknown = Reflect.get(chromeValue, "storage");
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
  });
}

async function openRestoredPlayerRaceWorkspace(
  context: BrowserContext,
  extensionId: string,
  options: { readonly longTimeline?: boolean } = {},
): Promise<{ page: Page; videoPage: Page }> {
  const bvid = "BV1Q541167Qg";
  const cid = 30_000_000_001;
  const videoUrl = `https://www.bilibili.com/video/${bvid}`;
  await context.route(
    /^https:\/\/www\.bilibili\.com\/video\/BV1Q541167Qg\/?(?:\?.*)?$/,
    async (route) =>
      route.fulfill({
        body: `<!doctype html><html><body><video id="player"></video><script>const video = document.querySelector("video"); Object.defineProperty(video, "duration", { value: 120 }); video.currentTime = 1.2;</script></body></html>`,
        contentType: "text/html",
        status: 200,
      }),
  );
  await context.route(
    /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
    async (route) =>
      route.fulfill({
        body: JSON.stringify({
          code: 0,
          data: {
            aid: 88_000_100,
            bvid,
            pages: [{ cid, duration: 120, page: 1 }],
            title: "E2E 恢复视频",
          },
        }),
        contentType: "application/json",
        status: 200,
      }),
  );
  await routeExactVideoWbiIdentity(context, {
    aid: 88_000_100,
    bvid,
    pages: [{ cid, page: 1 }],
  });

  const seedPage = await openSidePanel(context, extensionId);
  await seedRestoredWorkspace(seedPage);
  if (options.longTimeline === true) {
    await seedPage.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("muzhi");
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const transaction = database.transaction(
        ["subtitleSnapshots"],
        "readwrite",
      );
      const store = transaction.objectStore("subtitleSnapshots");
      const snapshot = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const request = store.get("subtitle-e2e");
          request.addEventListener(
            "success",
            () => resolve(request.result as Record<string, unknown>),
            { once: true },
          );
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        },
      );
      store.put({
        ...snapshot,
        contentHash: "sha256:e2e-long-timeline",
        rows: Array.from({ length: 100 }, (_, index) => ({
          endMs: index * 2_000 + 1_500,
          startMs: index * 2_000,
          text: index === 50 ? "定位目标字幕" : `字幕行 ${index}`,
        })),
      });
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener("abort", () => reject(transaction.error), {
          once: true,
        });
        transaction.addEventListener("error", () => reject(transaction.error), {
          once: true,
        });
      });
      database.close();
    });
  }
  await seedPage.close();

  const videoPage = await context.newPage();
  await videoPage.goto(videoUrl);
  await videoPage.bringToFront();
  const page = await openSidePanelWithPlayerRaceHarness(context, extensionId);
  await videoPage.bringToFront();
  await page.reload();
  await page.getByRole("tab", { name: "时间轴" }).click();
  await expect(
    page.getByText(
      options.longTimeline === true ? "字幕行 0" : "E2E 已恢复字幕",
    ),
  ).toBeAttached();
  return { page, videoPage };
}

async function seedResponsiveBatchJob(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muzhi");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const requiredStores = ["batchItems", "batchJobs"] as const;
    const missingStores = requiredStores.filter(
      (storeName) => !database.objectStoreNames.contains(storeName),
    );
    if (missingStores.length > 0) {
      database.close();
      throw new Error(
        `Batch seed requires initialized stores: ${missingStores.join(", ")}`,
      );
    }
    const transaction = database.transaction(
      ["batchItems", "batchJobs"],
      "readwrite",
    );
    transaction.objectStore("batchJobs").put({
      batchJobId: "batch-responsive",
      browserSessionId: "responsive-browser",
      createdAt: 1_700_000_000_000,
      method: "direct",
      sourceKind: "collection",
      sourceLabel: "响应式批量任务",
      status: "completed",
      updatedAt: 1_700_000_001_000,
    });
    transaction.objectStore("batchItems").put({
      author: "响应式测试作者",
      availableTracks: [],
      batchItemId: "batch-responsive-failed",
      batchJobId: "batch-responsive",
      bvid: "BV1zt4y1z72D",
      errorCode: "SUBTITLE_NOT_FOUND",
      order: 0,
      page: 13,
      progress: { completed: 1, stage: "discovering", total: 1 },
      publishedAt: 1_700_000_000,
      resultBranchId: null,
      resultSessionId: null,
      retryable: true,
      rowCount: 0,
      selected: true,
      selectedLanguage: null,
      selectedTrackId: null,
      status: "failed",
      title: "用于验证窄屏横向操作可达性的长标题视频",
      trackId: null,
      updatedAt: 1_700_000_001_000,
      videoKey: "bvid:BV1zt4y1z72D:cid:30000000013:p:13",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
    database.close();
  });
}

test("loads the MV3 extension and renders its side panel entry", async () => {
  test.setTimeout(60_000);
  const { context, extensionId } = await launchExtension();
  try {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const page = await openSidePanel(context, extensionId);

    await expect(page).toHaveTitle("Bilimuzhi");
    await expect(page.getByRole("main", { name: "Bilimuzhi" })).toBeAttached();

    for (const size of ICON_SIZES) {
      const dimensions = await page.evaluate(
        ({ extensionId: id, iconSize }) =>
          new Promise<{ height: number; width: number }>((resolve, reject) => {
            const image = new Image();
            image.addEventListener("load", () =>
              resolve({
                height: image.naturalHeight,
                width: image.naturalWidth,
              }),
            );
            image.addEventListener("error", () =>
              reject(new Error("Icon failed to load")),
            );
            image.src = `chrome-extension://${id}/icons/muzhi-${iconSize}.png`;
          }),
        { extensionId, iconSize: size },
      );
      expect(dimensions).toEqual({ height: size, width: size });
    }
  } finally {
    await context.close();
  }
});

test("keeps the compact batch card fully visible and keyboard-accessible without horizontal scrolling at 520px and 519px", async () => {
  test.setTimeout(60_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await seedResponsiveBatchJob(page);
    await page.reload();

    for (const width of [520, 519]) {
      await page.setViewportSize({ height: 980, width });

      const navigationToggle = page.getByRole("button", {
        name: /^打开(?:会话|批量模式导航)$/,
      });
      await expect(navigationToggle).toBeVisible();
      await navigationToggle.click();

      const workspaceModes = page.getByRole("navigation", {
        name: "工作区模式",
      });
      await expect(workspaceModes).toBeVisible();
      await expect(
        workspaceModes.getByRole("button", { name: "会话模式" }),
      ).toBeVisible();
      const batchEntry = workspaceModes.getByRole("button", {
        name: "批量模式",
      });
      await expect(batchEntry).toBeVisible();
      await expect(batchEntry.locator("span")).toHaveText("批量模式");
      const batchIcon = batchEntry.locator('svg[data-icon="batch"]');
      await expect(batchIcon).toBeVisible();
      await expect(batchIcon).toHaveAttribute("aria-hidden", "true");
      await expect(batchIcon).toHaveAttribute("width", "20");
      await expect(batchIcon).toHaveAttribute("height", "20");
      await batchEntry.focus();
      await expect(batchEntry).toBeFocused();
      await batchEntry.press("Enter");

      await page
        .getByRole("button", { name: /^响应式批量任务 已完成/ })
        .click();
      // Ticket 03 对话框化：来源输入框在「解析并加入列表」Dialog 内。
      await page
        .getByRole("button", { name: "解析并加入列表" })
        .first()
        .click();
      await expect(page.getByLabel("批量来源", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "取消" }).click();
      for (const actionName of [
        "获取官方/AI字幕",
        "批量语音转字幕",
        "批量获取字幕",
      ]) {
        const action = page.getByRole("button", { name: actionName });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }

      const tableScroller = page.getByRole("region", {
        name: "批量视频列表横向滚动",
      });
      await expect(tableScroller).toBeAttached({ timeout: 2_000 });
      for (const columnName of [
        "序号",
        "标题",
        "作者",
        "发布日期",
        "视频身份",
        "字幕状态",
        "字幕语言",
        "获取方式 / 进度",
        "操作",
      ]) {
        await expect(
          tableScroller.getByRole("columnheader", { name: columnName }),
        ).toBeAttached();
      }
      await tableScroller.focus();
      await expect(tableScroller).toBeFocused();
      const scrollMetrics = await tableScroller.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
      }));
      expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(
        scrollMetrics.clientWidth + 1,
      );
      expect(scrollMetrics.scrollLeft).toBe(0);

      const title = "用于验证窄屏横向操作可达性的长标题视频";
      const itemCard = tableScroller
        .getByRole("row")
        .filter({ hasText: title });
      await expect(itemCard).toBeVisible();
      await expect(itemCard).toHaveAttribute("aria-selected", "true");
      await expect(itemCard).toHaveClass(/is-selected/);
      await expect(itemCard.getByText(title, { exact: true })).toBeVisible();
      await expect(
        itemCard.getByText("响应式测试作者", { exact: true }),
      ).toBeVisible();
      await expect(
        itemCard.getByText("BV1zt4y1z72D", { exact: true }),
      ).toBeVisible();
      await expect(itemCard.getByText(/P13/)).toBeVisible();
      await expect(itemCard.getByText("失败", { exact: true })).toBeVisible();
      await expect(
        itemCard.getByText("没有匹配的字幕", { exact: true }),
      ).toBeVisible();

      const selection = itemCard.getByRole("checkbox", {
        name: `选择 ${title}`,
      });
      const language = itemCard.getByRole("combobox", {
        name: `字幕轨道 ${title}`,
      });
      const retry = itemCard.getByRole("button", {
        name: `重试 ${title}`,
      });
      for (const control of [selection, language, retry]) {
        await expect(control).toBeVisible();
        await expect(control).toBeInViewport();
      }
      await expect(selection).toBeChecked();
      await expect(language).toHaveValue("");

      await tableScroller.focus();
      await tableScroller.press("Tab");
      await expect(selection).toBeFocused();
      await selection.press("Tab");
      await expect(language).toBeFocused();
      await language.press("Tab");
      await expect(retry).toBeFocused();
      await expect
        .poll(() => tableScroller.evaluate((element) => element.scrollLeft))
        .toBe(0);

      const cardBox = await itemCard.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.x).toBeGreaterThanOrEqual(0);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width + 1);
    }
  } finally {
    await context.close();
  }
});

test("adopts a newly prepared batch job progress over the selected history job and ignores late history updates", async () => {
  test.setTimeout(60_000);
  const bvid = "BV1Q541167Qg";
  const aid = 88_000_103;
  const pages = [
    { cid: 30_000_000_101, page: 1 },
    { cid: 30_000_000_102, page: 2 },
    { cid: 30_000_000_103, page: 3 },
  ] as const;
  const identityWaiters: Array<() => void> = [];
  let holdIdentityResolution = true;
  let identityResolutionRequests = 0;
  let sourceListingCompleted = false;
  let trackDiscoveryRequests = 0;
  const { context, extensionId } = await launchExtension();
  try {
    context.on("request", (request) => {
      if (/\/x\/player\/(?:wbi\/)?v2\?/.test(request.url())) {
        trackDiscoveryRequests += 1;
      }
    });
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
      async (route) => {
        expect(new URL(route.request().url()).searchParams.get("bvid")).toBe(
          bvid,
        );
        if (sourceListingCompleted) {
          identityResolutionRequests += 1;
          if (holdIdentityResolution) {
            await new Promise<void>((resolve) => identityWaiters.push(resolve));
          }
        } else {
          sourceListingCompleted = true;
        }
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              aid,
              bvid,
              owner: { name: "新任务作者" },
              pages: pages.map((item) => ({
                ...item,
                duration: 120,
                part: `新任务第 ${item.page} 集`,
              })),
              pubdate: 1_700_000_000,
              title: "新建三集课程",
            },
          }),
          contentType: "application/json",
          status: 200,
        });
      },
    );

    const page = await openSidePanel(context, extensionId);
    await seedResponsiveBatchJob(page);
    await page.reload();
    await page.getByRole("button", { name: "批量模式" }).click();
    await page.getByRole("button", { name: /^响应式批量任务 已完成/ }).click();
    await expect(
      page.getByText("用于验证窄屏横向操作可达性的长标题视频"),
    ).toBeVisible();

    await page.getByRole("button", { name: "解析并加入列表" }).first().click();
    await page
      .getByRole("combobox", { name: "来源类型" })
      .selectOption("video-pages");
    await page.getByRole("textbox", { name: "批量来源" }).fill(bvid);
    await page.getByRole("button", { name: "按输入框内容获取视频" }).click();

    await expect.poll(() => identityResolutionRequests).toBe(1);
    await expect(
      page.getByText("正在加入批量列表 · 0/3 · 已加入 0 · 失败 0", {
        exact: true,
      }),
    ).toBeVisible();
    const preparationProgress = page.getByRole("progressbar", {
      name: "批量来源准备进度",
    });
    await expect(preparationProgress).toHaveAttribute("aria-valuemax", "3");
    await expect(preparationProgress).toHaveAttribute("aria-valuenow", "0");
    await expect(preparationProgress).toHaveAttribute("max", "3");
    await expect(preparationProgress).toHaveAttribute("value", "0");
    await expect(
      page.getByText("正在读取批量来源…", { exact: true }),
    ).toHaveCount(0);

    expect(trackDiscoveryRequests).toBe(0);

    identityWaiters.shift()?.();
    await expect.poll(() => identityResolutionRequests).toBe(2);
    await expect(
      page.getByText("正在加入批量列表 · 1/3 · 已加入 1 · 失败 0", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(preparationProgress).toHaveAttribute("aria-valuenow", "1");

    const serviceWorker = context.serviceWorkers()[0];
    expect(serviceWorker).toBeDefined();
    await serviceWorker!.evaluate(async () => {
      const chromeValue: unknown = Reflect.get(globalThis, "chrome");
      const runtime =
        typeof chromeValue === "object" && chromeValue !== null
          ? Reflect.get(chromeValue, "runtime")
          : null;
      const sendMessage =
        typeof runtime === "object" && runtime !== null
          ? Reflect.get(runtime, "sendMessage")
          : null;
      if (typeof sendMessage !== "function") {
        throw new Error("Chrome runtime messaging is unavailable");
      }
      try {
        await Reflect.apply(sendMessage, runtime, [
          {
            payload: {
              items: [
                {
                  acquisitionMethod: "direct",
                  author: "旧任务作者",
                  availableTracks: [],
                  batchItemId: "batch-responsive-late",
                  batchJobId: "batch-responsive",
                  bvid: "BV1zt4y1z72D",
                  cid: 30_000_000_013,
                  errorCode: null,
                  order: 0,
                  page: 13,
                  progress: { completed: 1, stage: "saved", total: 1 },
                  publishedAt: 1_700_000_000,
                  retryable: false,
                  rowCount: 1,
                  selected: true,
                  selectedLanguage: "zh-CN",
                  selectedTrackId: "old-track",
                  status: "succeeded",
                  title: "旧任务迟到事件不得覆盖新任务",
                  trackId: "old-track",
                  tracksDiscovered: true,
                  updatedAt: 1_700_000_002_000,
                  videoKey: "bvid:BV1zt4y1z72D:cid:30000000013:p:13",
                },
              ],
              job: {
                batchJobId: "batch-responsive",
                browserSessionId: "responsive-browser",
                createdAt: 1_700_000_000_000,
                method: "direct",
                sourceKind: "collection",
                sourceLabel: "响应式批量任务",
                status: "completed",
                updatedAt: 1_700_000_002_000,
              },
              overwriteCount: 0,
            },
            protocolVersion: 1,
            type: "muzhi.batch.updated",
          },
        ]);
      } catch {
        // A broadcast has no response recipient; delivery to the side panel is
        // the observable behavior under test.
      }
    });

    await expect(
      page.getByText("正在加入批量列表 · 1/3 · 已加入 1 · 失败 0", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(preparationProgress).toHaveAttribute("aria-valuenow", "1");
    await expect(
      page.getByText("旧任务迟到事件不得覆盖新任务", { exact: true }),
    ).toHaveCount(0);

    expect(trackDiscoveryRequests).toBe(0);

    holdIdentityResolution = false;
    identityWaiters.splice(0).forEach((release) => release());
    await expect(
      page.getByText("加入列表完成 · 已加入 3 · 失败 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("新任务第 3 集", { exact: true }),
    ).toBeVisible();
    expect(trackDiscoveryRequests).toBe(0);
  } finally {
    holdIdentityResolution = false;
    identityWaiters.splice(0).forEach((release) => release());
    await context.close();
  }
});

test("restores and exports an explicitly seeded active subtitle", async () => {
  test.setTimeout(60_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await seedRestoredWorkspace(page);
    await page.reload();

    await expectBoundVideoRegion(page, {
      bvid: "BV1Q541167Qg",
      hasSubtitle: true,
      pageNumber: 1,
      status: "页面已切换、关闭或未连接",
      title: "E2E 恢复视频",
    });
    await expect(page.getByRole("tab", { name: "总结" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "时间轴" }).click();
    await expect(page.getByText("E2E 已恢复字幕")).toBeAttached();
    await page.getByRole("button", { name: "重新获取" }).click();
    const reacquisition = page.getByRole("region", {
      name: "重新获取字幕来源",
    });
    await expect(reacquisition).toBeVisible();
    await expect(
      reacquisition.getByText("新字幕成功前会保留当前字幕。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始语音转字幕" }),
    ).toBeDisabled();
    await expect(
      page.getByText("请先在设置中保存并测试 Groq 密钥。"),
    ).toBeAttached();
    await reacquisition.getByRole("button", { name: "返回当前字幕" }).click();
    await expect(page.getByText("E2E 已恢复字幕")).toBeAttached();

    const downloadStarted = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 TXT" }).click();
    const download = await downloadStarted;
    expect(download.suggestedFilename()).toBe("E2E 恢复视频.txt");
  } finally {
    await context.close();
  }
});

test("keeps stale explicit seek reachable and ignores its previous player owner", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { page, videoPage } = await openRestoredPlayerRaceWorkspace(
      context,
      extensionId,
    );
    const syncMode = page.getByRole("button", { name: "同步模式" });
    const activeRow = page
      .getByTestId("subtitle-row")
      .filter({ hasText: "E2E 已恢复字幕" });
    await expect(activeRow).toHaveAttribute("aria-current", "true");
    await syncMode.click();
    await expect(syncMode).toHaveAttribute("aria-pressed", "true");

    await playerRaceAction(page, "enable", true);
    await expect
      .poll(async () => {
        const indices = await playerRaceAction(page, "pendingIndices");
        return Array.isArray(indices) ? indices.length : -1;
      })
      .toBeGreaterThanOrEqual(1);
    const firstPending = await playerRaceAction(page, "pendingIndices");
    expect(Array.isArray(firstPending)).toBe(true);
    const oldRevisionRequest = Number((firstPending as unknown[])[0]);

    const unrelatedPage = await context.newPage();
    await unrelatedPage.goto("about:blank");
    await unrelatedPage.bringToFront();
    await expect(
      page.getByText(/检测到页面已变化；当前会话与字幕获取仍可用/),
    ).toBeAttached();
    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
    await expect(activeRow).not.toHaveAttribute("aria-current", "true");

    const staleGuidance = page.getByRole("status").filter({
      hasText: "检测到页面已变化",
    });
    await expect(staleGuidance).toBeVisible();
    await expect
      .soft(
        staleGuidance,
        "stale guidance names the reachable v14 seek behavior instead of a removed bound-session control",
      )
      .toHaveText(
        "检测到页面已变化；当前会话与字幕获取仍可用。点击时间点或“定位当前字幕”会激活已打开的匹配视频页；若未打开，将先询问是否打开视频页。",
      );

    const capturedBeforeExplicitSeek = Number(
      await playerRaceAction(page, "capturedCount"),
    );
    await activeRow
      .getByRole("button", { name: "跳转到 00:01：E2E 已恢复字幕" })
      .click();
    await expect
      .poll(() =>
        videoPage
          .locator("video")
          .evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBe(1);
    await expect
      .poll(() => videoPage.evaluate(() => document.visibilityState))
      .toBe("visible");

    await playerRaceAction(page, "reject", oldRevisionRequest);

    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
    await expect(activeRow).not.toHaveAttribute("aria-current", "true");
    await expect
      .poll(async () => Number(await playerRaceAction(page, "capturedCount")))
      .toBe(capturedBeforeExplicitSeek);
    await expect(
      page.getByRole("alert").filter({ hasText: /player|播放器|读取/ }),
    ).toHaveCount(0);
    await unrelatedPage.close();
  } finally {
    await context.close();
  }
});

test("ignores an older overlapping player rejection after a newer sample succeeds in the same revision", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { page } = await openRestoredPlayerRaceWorkspace(
      context,
      extensionId,
    );
    const syncMode = page.getByRole("button", { name: "同步模式" });
    const activeRow = page
      .getByTestId("subtitle-row")
      .filter({ hasText: "E2E 已恢复字幕" });
    await expect(activeRow).toHaveAttribute("aria-current", "true");
    await syncMode.click();
    await expect(syncMode).toHaveAttribute("aria-pressed", "true");

    await playerRaceAction(page, "enable", true);
    await expect
      .poll(async () => {
        const indices = await playerRaceAction(page, "pendingIndices");
        return Array.isArray(indices) ? indices.length : -1;
      })
      .toBeGreaterThanOrEqual(2);
    const overlapping = await playerRaceAction(page, "pendingIndices");
    expect(Array.isArray(overlapping)).toBe(true);
    const olderRequest = Number((overlapping as unknown[])[0]);
    const newerRequest = Number((overlapping as unknown[]).at(-1));
    expect(newerRequest).toBeGreaterThan(olderRequest);

    await playerRaceAction(page, "resolve", newerRequest, 1_200);
    await expect(activeRow).toHaveAttribute("aria-current", "true");
    const capturedBeforeLateFailure = Number(
      await playerRaceAction(page, "capturedCount"),
    );
    await playerRaceAction(page, "reject", olderRequest);

    await expect(syncMode).toHaveAttribute("aria-pressed", "true");
    await expect(activeRow).toHaveAttribute("aria-current", "true");
    await expect
      .poll(async () => Number(await playerRaceAction(page, "capturedCount")))
      .toBeGreaterThan(capturedBeforeLateFailure);
  } finally {
    await context.close();
  }
});

test("finishes an explicit locate with its fresh sample when a newer background sample overlaps", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { page } = await openRestoredPlayerRaceWorkspace(
      context,
      extensionId,
      { longTimeline: true },
    );
    const syncMode = page.getByRole("button", { name: "同步模式" });
    const locateCurrent = page.getByRole("button", {
      name: "定位当前字幕",
    });
    const viewport = page.getByRole("region", { name: "字幕时间线" });
    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
    await expect(locateCurrent).toBeEnabled();
    await expect(page.getByText("定位目标字幕")).toHaveCount(0);
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await playerRaceAction(page, "enableAndClickLocate");
    await expect
      .poll(async () => {
        const indices = await playerRaceAction(page, "pendingIndices");
        return Array.isArray(indices) ? indices.length : -1;
      })
      .toBeGreaterThanOrEqual(1);
    const locatePending = await playerRaceAction(page, "pendingIndices");
    expect(Array.isArray(locatePending)).toBe(true);
    const explicitLocate = Number((locatePending as unknown[])[0]);

    await expect
      .poll(async () => {
        const indices = await playerRaceAction(page, "pendingIndices");
        return Array.isArray(indices) ? indices.length : -1;
      })
      .toBeGreaterThanOrEqual(2);
    const overlapping = await playerRaceAction(page, "pendingIndices");
    expect(Array.isArray(overlapping)).toBe(true);
    const newerBackgroundSample = Number((overlapping as unknown[]).at(-1));
    expect(newerBackgroundSample).toBeGreaterThan(explicitLocate);

    await playerRaceAction(page, "resolve", newerBackgroundSample, 1_200);
    await expect(
      page.getByTestId("subtitle-row").filter({ hasText: "字幕行 0" }),
    ).toHaveAttribute("aria-current", "true");
    await playerRaceAction(page, "resolve", explicitLocate, 100_250);

    await expect(
      page.getByRole("status").filter({ hasText: "已定位到 01:40。" }),
    ).toBeAttached();
    await expect(
      page.getByText("当前播放位置没有匹配的字幕。", { exact: true }),
    ).toHaveCount(0);
    const locatedRow = page
      .getByTestId("subtitle-row")
      .filter({ hasText: "定位目标字幕" });
    await expect(locatedRow).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBe(2_668);
    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
  } finally {
    await context.close();
  }
});

test("binds an empty workspace, acquires a selected track, exports, and restores it", async () => {
  test.setTimeout(60_000);
  const { context, extensionId } = await launchExtension();
  let signedTrackRequests = 0;
  let signedTrackUrl = "";
  let unsignedTrackRequests = 0;
  let contentRequests = 0;
  const sessionRuleCountsDuringPageRequests: number[] = [];
  try {
    await context.route(
      /^https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD\/?(?:\?.*)?$/,
      async (route) =>
        route.fulfill({
          body: "<!doctype html><html><body><video></video></body></html>",
          contentType: "text/html",
          status: 200,
        }),
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
      async (route) => {
        expect(new URL(route.request().url()).searchParams.get("bvid")).toBe(
          "BV1xx411c7mD",
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              aid: 88_000_099,
              bvid: "BV1xx411c7mD",
              pages: [{ cid: 30_000_000_099, duration: 120, page: 1 }],
              title: "E2E 字幕主链",
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await routeExactVideoWbiIdentity(context, {
      aid: 88_000_099,
      bvid: "BV1xx411c7mD",
      pages: [{ cid: 30_000_000_099, page: 1 }],
    });
    await routeUnavailableSubtitleWebView(context, {
      aid: 88_000_099,
      cid: 30_000_000_099,
    });
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/v2\?/,
      async (route) => {
        unsignedTrackRequests += 1;
        sessionRuleCountsDuringPageRequests.push(
          await readSessionRuleCount(context),
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              need_login_subtitle: false,
              subtitle: { subtitles: [] },
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/wbi\/v2\?/,
      async (route) => {
        signedTrackRequests += 1;
        signedTrackUrl = route.request().url();
        sessionRuleCountsDuringPageRequests.push(
          await readSessionRuleCount(context),
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              need_login_subtitle: false,
              subtitle: {
                subtitles: [
                  {
                    ai_type: 1,
                    id: 1_001,
                    lan: "zh-CN",
                    lan_doc: "中文（自动生成）",
                    subtitle_url: "https://aisubtitle.hdslb.com/e2e/zh-CN.json",
                  },
                  {
                    ai_type: 0,
                    id: 1_002,
                    lan: "en-US",
                    lan_doc: "English",
                    subtitle_url: "https://aisubtitle.hdslb.com/e2e/en-US.json",
                  },
                ],
              },
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      "https://aisubtitle.hdslb.com/e2e/en-US.json",
      async (route) => {
        contentRequests += 1;
        await route.fulfill({
          body: JSON.stringify({
            body: [
              {
                content: "E2E selected English subtitle",
                from: 1,
                to: 2.5,
              },
            ],
          }),
          contentType: "application/json",
          headers: BILIBILI_CDN_CORS_HEADERS,
          status: 200,
        });
      },
    );

    const videoPage = await context.newPage();
    await videoPage.goto("https://www.bilibili.com/video/BV1xx411c7mD?p=1");
    await videoPage.bringToFront();
    const page = await openSidePanel(context, extensionId);
    await videoPage.bringToFront();
    const initiallyPersisted = await readPersistedAcquisition(page);
    expect(initiallyPersisted.sessionCount).toBe(0);
    expect(initiallyPersisted.activeSubtitleId).toBeNull();
    expect(initiallyPersisted.storedWorkspace).toEqual({});

    await page
      .getByRole("textbox", { name: "BV 号或完整 URL" })
      .fill("BV1xx411c7mD");
    await page.getByRole("button", { name: "打开视频会话" }).click();
    await expectBoundVideoRegion(page, {
      bvid: "BV1xx411c7mD",
      hasSubtitle: false,
      pageNumber: 1,
      status: "页面已切换、关闭或未连接",
      title: "E2E 字幕主链",
    });
    await expectInitialAcquisitionSelection(page);

    const discoverSubtitles = page.getByRole("button", {
      name: "获取视频自带字幕",
    });
    await expect(discoverSubtitles).toBeVisible({ timeout: 5_000 });
    await discoverSubtitles.click();
    await expect(
      page.getByRole("radio", { name: /English.*官方字幕/ }),
    ).toBeAttached();
    await page.getByRole("radio", { name: /English.*官方字幕/ }).check();
    await page.getByRole("button", { name: "获取所选字幕" }).click();

    await expect(
      page.getByText("E2E selected English subtitle"),
    ).toBeAttached();
    await expectBoundVideoRegion(page, {
      bvid: "BV1xx411c7mD",
      hasSubtitle: true,
      pageNumber: 1,
      status: "页面已切换、关闭或未连接",
      title: "E2E 字幕主链",
    });
    expect(unsignedTrackRequests).toBeGreaterThanOrEqual(1);
    expect(signedTrackRequests).toBeGreaterThanOrEqual(1);
    const authoritativeTrackUrl = new URL(signedTrackUrl);
    expect(authoritativeTrackUrl.pathname).toBe("/x/player/wbi/v2");
    expect(authoritativeTrackUrl.searchParams.get("aid")).toBe("88000099");
    expect(authoritativeTrackUrl.searchParams.get("cid")).toBe("30000000099");
    expect(authoritativeTrackUrl.searchParams.get("w_rid")).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(authoritativeTrackUrl.searchParams.get("wts")).toMatch(/^\d+$/);
    expect(contentRequests).toBe(1);
    expect(sessionRuleCountsDuringPageRequests.length).toBeGreaterThan(0);
    expect(
      sessionRuleCountsDuringPageRequests.every((count) => count === 0),
    ).toBe(true);
    await expect.poll(() => readSessionRuleCount(context)).toBe(0);

    const persisted = await readPersistedAcquisition(page);
    expect(persisted.activeSubtitleId).not.toBeNull();
    expect(persisted.snapshotStatus).toBe("active");

    const downloadStarted = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 TXT" }).click();
    const download = await downloadStarted;
    expect(download.suggestedFilename()).toBe("E2E 字幕主链.txt");

    await page.reload();
    await expectBoundVideoRegion(page, {
      bvid: "BV1xx411c7mD",
      hasSubtitle: true,
      pageNumber: 1,
      status: "页面已连接",
      title: "E2E 字幕主链",
    });
    await expect(
      page.getByText("E2E selected English subtitle"),
    ).toBeAttached();
  } finally {
    await context.close();
  }
});

test("uses the active non-P1 page identity for branch acquisition, player seek, export, and restore", async () => {
  test.setTimeout(60_000);
  const bvid = "BV1Q541167Qg";
  const cid = 30_000_000_002;
  const videoUrl = `https://www.bilibili.com/video/${bvid}?p=2`;
  let signedTrackRequests = 0;
  let signedTrackUrl = "";
  let unsignedTrackRequests = 0;
  const { context, extensionId } = await launchExtension();
  try {
    await context.route(videoUrl, async (route) =>
      route.fulfill({
        body: `<!doctype html><html><body><video id="player"></video><script>const video = document.querySelector("video"); Object.defineProperty(video, "duration", { value: 120 }); video.currentTime = 6; let observedTime = video.currentTime; setInterval(() => { if (video.currentTime !== observedTime) { observedTime = video.currentTime; video.dispatchEvent(new Event("seeked")); } }, 10);</script></body></html>`,
        contentType: "text/html",
        status: 200,
      }),
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
      async (route) => {
        expect(new URL(route.request().url()).searchParams.get("bvid")).toBe(
          bvid,
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              aid: 88_000_101,
              bvid,
              pages: [
                { cid: 30_000_000_001, duration: 120, page: 1 },
                { cid, duration: 120, page: 2 },
              ],
              title: "E2E 当前页 P2",
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await routeExactVideoWbiIdentity(context, {
      aid: 88_000_101,
      bvid,
      pages: [
        { cid: 30_000_000_001, page: 1 },
        { cid, page: 2 },
      ],
    });
    await routeUnavailableSubtitleWebView(context, {
      aid: 88_000_101,
      cid,
    });
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/v2\?/,
      async (route) => {
        unsignedTrackRequests += 1;
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              need_login_subtitle: false,
              subtitle: { subtitles: [] },
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/wbi\/v2\?/,
      async (route) => {
        signedTrackRequests += 1;
        signedTrackUrl = route.request().url();
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              need_login_subtitle: false,
              subtitle: {
                subtitles: [
                  {
                    ai_type: 0,
                    id: 2_002,
                    lan: "en-US",
                    lan_doc: "English P2",
                    subtitle_url:
                      "https://aisubtitle.hdslb.com/e2e/current-p2.json",
                  },
                ],
              },
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      "https://aisubtitle.hdslb.com/e2e/current-p2.json",
      async (route) =>
        route.fulfill({
          body: JSON.stringify({
            body: [
              {
                content: "E2E active P2 subtitle",
                from: 1,
                to: 2.5,
              },
            ],
          }),
          contentType: "application/json",
          headers: BILIBILI_CDN_CORS_HEADERS,
          status: 200,
        }),
    );

    const videoPage = await context.newPage();
    await videoPage.goto(videoUrl);
    await videoPage.bringToFront();
    const page = await openSidePanel(context, extensionId);
    await videoPage.bringToFront();
    await page.reload();

    await expectBoundVideoRegion(page, {
      bvid,
      hasSubtitle: false,
      pageNumber: 2,
      status: "页面已切换、关闭或未连接",
      title: "P2 · E2E 当前页 P2",
    });
    await expectInitialAcquisitionSelection(page);
    await page.getByRole("button", { name: "获取视频自带字幕" }).click();
    await page.getByRole("radio", { name: /English P2.*官方字幕/ }).check();
    await page.getByRole("button", { name: "获取所选字幕" }).click();
    await expect(page.getByText("E2E active P2 subtitle")).toBeAttached();
    await expectBoundVideoRegion(page, {
      bvid,
      hasSubtitle: true,
      pageNumber: 2,
      status: "页面已连接",
      title: "P2 · E2E 当前页 P2",
    });
    expect(unsignedTrackRequests).toBeGreaterThanOrEqual(1);
    expect(signedTrackRequests).toBeGreaterThanOrEqual(1);
    const authoritativeTrackUrl = new URL(signedTrackUrl);
    expect(authoritativeTrackUrl.pathname).toBe("/x/player/wbi/v2");
    expect(authoritativeTrackUrl.searchParams.get("aid")).toBe("88000101");
    expect(authoritativeTrackUrl.searchParams.get("cid")).toBe(String(cid));
    expect(authoritativeTrackUrl.searchParams.get("w_rid")).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(authoritativeTrackUrl.searchParams.get("wts")).toMatch(/^\d+$/);
    await page.getByRole("combobox", { name: "主题" }).selectOption("dark");
    await expect(page.locator(".muzhi-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );

    const persisted = await readPersistedAcquisition(page);
    expect(persisted.videoKey).toBe(`bvid:${bvid}:cid:${cid}:p:2`);
    expect(persisted.activeSubtitleId).not.toBeNull();

    await videoPage.bringToFront();
    await page
      .getByRole("button", { name: "跳转到 00:01：E2E active P2 subtitle" })
      .click();
    await expect
      .poll(() =>
        videoPage
          .locator("video")
          .evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBe(1);

    const syncMode = page.getByRole("button", { name: "同步模式" });
    const activeRow = page
      .getByTestId("subtitle-row")
      .filter({ hasText: "E2E active P2 subtitle" });
    await syncMode.click();
    await expect(syncMode).toHaveAttribute("aria-pressed", "true");
    await expect(activeRow).toHaveAttribute("aria-current", "true");

    const unrelatedPage = await context.newPage();
    await unrelatedPage.goto("about:blank");
    await unrelatedPage.bringToFront();
    await expect(
      page.getByText(/检测到页面已变化；当前会话与字幕获取仍可用/),
    ).toBeAttached();
    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
    await expect(activeRow).not.toHaveAttribute("aria-current", "true");

    // Wait beyond the 750 ms sampling cadence. A stale timer that was not
    // stopped would repopulate the old verified time and highlight this row.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
    await expect(syncMode).toHaveAttribute("aria-pressed", "false");
    await expect(activeRow).not.toHaveAttribute("aria-current", "true");
    await unrelatedPage.close();
    await videoPage.bringToFront();

    const downloadStarted = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 TXT" }).click();
    const download = await downloadStarted;
    expect(download.suggestedFilename()).toBe("P2 · E2E 当前页 P2.txt");

    await videoPage.bringToFront();
    await page.reload();
    await expect(page.getByText("E2E active P2 subtitle")).toBeAttached();
    await expect(page.locator(".muzhi-app")).toHaveAttribute(
      "data-theme",
      "dark",
    );
  } finally {
    await context.close();
  }
});
