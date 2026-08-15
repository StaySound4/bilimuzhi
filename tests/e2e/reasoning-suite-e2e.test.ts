import { createServer } from "node:http";

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "playwright/test";

declare const process: {
  cwd(): string;
  stdout: { write(value: string): void };
};

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
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  return page;
}

/** 预置 v13 设置（Ollama profile + 任务选择）与含字幕的工作区。 */
async function seedOllamaWorkspace(
  page: Page,
  ollamaPort = 11434,
): Promise<void> {
  await page.evaluate(
    async ({ ollamaPort }) => {
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
        title: "E2E Ollama 视频",
        videoKey,
      });
      transaction.objectStore("sessions").add({
        activeBranchId: "branch-e2e",
        createdAt: 1_000,
        customTitle: false,
        lastActivityAt: 2_000,
        selectionRevision: 1,
        sessionId: "session-e2e",
        title: "E2E Ollama 视频",
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
        rows: [{ endMs: 2_000, startMs: 1_000, text: "E2E Ollama 字幕" }],
        sessionId: "session-e2e",
        source: "bilibili",
        status: "active",
        subtitleId: "subtitle-e2e",
        updatedAt: 2_000,
        videoKey,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener("error", () => reject(transaction.error), {
          once: true,
        });
      });
      database.close();

      const chromeValue = Reflect.get(globalThis, "chrome") as unknown as {
        storage: {
          local: { set(items: Record<string, unknown>): Promise<void> };
        };
      };
      await chromeValue.storage.local.set({
        "muzhi.settings.v13": {
          appearance: { theme: "dark" },
          archivedSegmentPrompts: [],
          customReasoningEfforts: [],
          imageCapabilities: [],
          modelReasoningOverrides: {},
          profiles: [
            {
              baseUrl: `http://localhost:${ollamaPort}/v1`,
              hostPermission: "granted",
              id: "profile-ollama",
              models: [
                {
                  enabled: true,
                  id: "llama3.1:8b",
                  source: "discovered",
                  verification: "verified",
                },
              ],
              name: "Ollama",
              protocol: "ollama-chat",
            },
          ],
          promptPresets: [],
          speech: { groqApiKeyConfigured: false },
          taskSelections: {
            chat: {
              modelId: "llama3.1:8b",
              profileId: "profile-ollama",
              reasoningEffort: "high",
            },
            segments: null,
            summary: {
              modelId: "llama3.1:8b",
              profileId: "profile-ollama",
              reasoningEffort: "high",
            },
          },
          version: 13,
        },
        "muzhi.settings.secret.v13": {
          groqApiKey: null,
          providerApiKeys: { "profile-ollama": "ollama" },
          removedProviderKeyIds: [],
          version: 13,
        },
        "muzhi.workspace.v1": {
          activeSessionId: "session-e2e",
          sessions: [
            {
              activeMode: "summary",
              scrollTopByMode: {
                chat: 0,
                segments: 0,
                summary: 0,
                timeline: 0,
              },
              sessionId: "session-e2e",
            },
          ],
          version: 1,
        },
      });
    },
    { ollamaPort },
  );
}

function ollamaSse(events: readonly string[]): string {
  return events.map((event) => `data: ${event}\n\n`).join("");
}

function mockOllamaEndpoint(context: BrowserContext) {
  const chatBodies: string[] = [];
  let modelRequests = 0;
  context.route("http://localhost:11434/**", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.endsWith("/v1/models")) {
      modelRequests += 1;
      await route.fulfill({
        body: JSON.stringify({ data: [{ id: "llama3.1:8b" }] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (requestUrl.endsWith("/v1/chat/completions")) {
      chatBodies.push(route.request().postData() ?? "");
      await route.fulfill({
        body: ollamaSse([
          JSON.stringify({
            choices: [
              {
                delta: { content: "这是 Ollama 生成的总结。" },
                finish_reason: "stop",
              },
            ],
          }),
          "[DONE]",
        ]),
        contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: "{}",
      contentType: "application/json",
      status: 404,
    });
  });
  return { chatBodies, getModelRequests: () => modelRequests };
}

/** 首帧延迟的 mock：验证「点击生成立即出现进度反馈」，不等模型产出。 */
function mockSlowOllamaEndpoint(
  context: BrowserContext,
  firstFrameDelayMs: number,
) {
  const chatBodies: string[] = [];
  context.route("http://localhost:11434/**", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.endsWith("/v1/models")) {
      await route.fulfill({
        body: JSON.stringify({ data: [{ id: "llama3.1:8b" }] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (requestUrl.endsWith("/v1/chat/completions")) {
      chatBodies.push(route.request().postData() ?? "");
      await new Promise((resolve) => setTimeout(resolve, firstFrameDelayMs));
      await route.fulfill({
        body: ollamaSse([
          JSON.stringify({
            choices: [
              {
                delta: { content: "这是 Ollama 生成的总结。" },
                finish_reason: "stop",
              },
            ],
          }),
          "[DONE]",
        ]),
        contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: "{}",
      contentType: "application/json",
      status: 404,
    });
  });
  return { chatBodies };
}

test("generates a summary through a mocked Ollama endpoint with the selected reasoning effort", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const { chatBodies } = mockOllamaEndpoint(context);
    const page = await openSidePanel(context, extensionId);
    await seedOllamaWorkspace(page);
    // seed 落在页面加载之后：刷新让 sidepanel 重载 v13 设置。
    await page.reload();
    await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

    // 任务模型选择就绪后切到总结并生成。
    await page.getByRole("tab", { name: "总结" }).click();
    await expect(page.getByRole("button", { name: "生成总结" })).toBeEnabled();
    await page.getByRole("button", { name: "生成总结" }).click();

    await expect(page.getByText("这是 Ollama 生成的总结。")).toBeVisible({
      timeout: 30_000,
    });
    expect(chatBodies.length).toBeGreaterThan(0);
    const body = JSON.parse(chatBodies[0] ?? "{}") as Record<string, unknown>;
    expect(body.model).toBe("llama3.1:8b");
    expect(body.reasoning_effort).toBe("high");
  } finally {
    await context.close();
  }
});

test("persists the per-model thinking override from the settings drawer", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await seedOllamaWorkspace(page);
    // seed 落在页面加载之后：刷新让 sidepanel 重载 v13 设置。
    await page.reload();
    await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

    // 设置 → 语言模型配置 → 模型行思考开关 + 档位选择。
    await page.getByRole("button", { name: "打开设置" }).click();
    await page.getByRole("tab", { name: "语言模型配置" }).click();
    const toggle = page.getByRole("checkbox", {
      name: "切换模型 llama3.1:8b 的思考开关",
    });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const effortSelect = page
      .getByRole("combobox", { name: /推理档位/ })
      .first();
    await expect(effortSelect).toBeEnabled();
    await effortSelect.selectOption("max");

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const chromeValue = Reflect.get(
              globalThis,
              "chrome",
            ) as unknown as {
              storage: {
                local: { get(key: string): Promise<Record<string, unknown>> };
              };
            };
            const stored =
              await chromeValue.storage.local.get("muzhi.settings.v13");
            const settings = stored["muzhi.settings.v13"] as {
              modelReasoningOverrides: Record<
                string,
                { effort: string; enabled: boolean }
              >;
            };
            return settings.modelReasoningOverrides;
          }),
        { timeout: 15_000 },
      )
      .toEqual({
        "profile-ollama\u0000llama3.1:8b": { effort: "max", enabled: true },
      });
  } finally {
    await context.close();
  }
});
test("shows progress feedback immediately after clicking generate (before the model responds)", async () => {
  test.setTimeout(90_000);
  const { context, extensionId } = await launchExtension();
  try {
    // 首帧延迟 8 秒：确保模型产出前，界面已显示「准备/生成中」反馈。
    mockSlowOllamaEndpoint(context, 8_000);
    const page = await openSidePanel(context, extensionId);
    await seedOllamaWorkspace(page);
    await page.reload();
    await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

    await page.getByRole("tab", { name: "总结" }).click();
    await page.getByRole("button", { name: "生成总结" }).click();

    await expect(page.locator(".muzhi-insight__progress")).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("这是 Ollama 生成的总结。")).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
});

test("streams summary deltas into the UI before completion (strict streaming check)", async () => {
  test.setTimeout(120_000);
  // 本地 HTTP 服务器逐帧写 SSE：每 600ms 一帧，共 5 帧 + [DONE]。
  const frames = ["第一段", "第二段", "第三段", "第四段", "第五段"];
  const server = createServer(async (request, response) => {
    const url = request.url ?? "";
    if (url.endsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "llama3.1:8b" }] }));
      return;
    }
    if (url.endsWith("/v1/chat/completions")) {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "text/event-stream",
      });
      for (const frame of frames) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: frame } }] })}

`,
        );
      }
      response.write(`data: [DONE]

`);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end("{}");
  });
  // 固定 11434 端口：manifest host_permissions 只预授权 localhost:11434，
  // 随机端口会被 Chrome 拒绝（SW fetch 无 host 权限 → NETWORK_ERROR）。
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(11434, "127.0.0.1", () => resolve());
  });
  test.skip(!server.listening, "本地 11434 端口被占用，跳过流式验证");

  const { context, extensionId } = await launchExtension();
  try {
    const page = await openSidePanel(context, extensionId);
    await seedOllamaWorkspace(page, 11434);
    await page.reload();
    await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

    // 对话模式：严格流式断言（同一 server，逐帧响应）。
    await page.getByRole("tab", { name: "对话" }).click();
    // 对话需要活动线程：先新建对话再发送。
    await page.getByRole("button", { name: "新建对话" }).click();
    await page.getByRole("textbox", { name: "输入消息" }).fill("你好");
    await page.getByRole("button", { name: "发送消息" }).click();
    // 前两帧（约 1.2s）先到：气泡已渲染部分内容，完整文本（约 3.6s）未到。
    await expect(page.getByText("第一段第二段")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText("第一段第二段第三段第四段第五段")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("第一段第二段")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText("第一段第二段第三段第四段第五段")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("tab", { name: "总结" }).click();
    await page.getByRole("button", { name: "生成总结" }).click();

    // 严格流式断言：第二帧到达（约 1.2s）时正文已可见，而第五帧（约 3s）还没到。
    await expect(page.getByText("第一段第二段")).toBeVisible({
      timeout: 4_000,
    });
    await expect(page.getByText("第五段")).not.toBeVisible({ timeout: 1_000 });
    // 全部帧到达后完整输出可见。
    await expect(page.getByText("第一段第二段第三段第四段第五段")).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
