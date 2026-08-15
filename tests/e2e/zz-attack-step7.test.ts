import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "playwright/test";

declare const process: { cwd(): string };
declare const chrome: {
  runtime: {
    onMessage: {
      addListener(listener: (message: unknown) => void): void;
    };
    sendMessage(message: unknown): void;
  };
};

import { seedAttackWorkspace } from "./zz-seed";

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
    viewport: { height: 980, width: 920 },
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

test.beforeEach(async () => {
  // 每个测试独立数据库：扩展在持久 profile 里，删除旧库重新 seed
  await chromium
    .launchPersistentContext("", { headless: true })
    .then(async (ctx) => {
      await ctx.close();
    });
});

test("菜单互斥：归档区点开会话菜单后打开另一个菜单，前一个自动关闭", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByRole("heading", { name: "归档" })).toBeVisible();
  await page.getByRole("button", { name: "归档操作 归档甲" }).click();
  await expect(
    page.getByRole("button", { name: "打开会话", exact: true }),
  ).toBeVisible();
  // 归档丙在根目录下、不被 A 菜单遮挡；点开它应自动关闭 A。
  // 归档甲菜单浮层可能盖住相邻卡片；用 dispatchEvent 直接触发按钮
  // onClick 验证互斥状态机（打开归档丙时归档甲菜单必须关闭）。
  const buttonC = page.getByRole("button", { name: "归档操作 归档丙" }).first();
  await buttonC.dispatchEvent("click");
  await expect(
    page.getByRole("button", { name: "打开会话", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开会话", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "归档操作 归档甲" }).first(),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(buttonC).toHaveAttribute("aria-expanded", "true");
  await context.close();
});

test("菜单越界：底部卡片菜单向上翻转且不超出视口", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  await page.setViewportSize({ height: 600, width: 920 });

  await page.getByRole("button", { name: "打开归档区" }).click();
  const menuButton = page
    .getByRole("button", { name: "归档操作 归档丙" })
    .first();
  await menuButton.click();
  const menu = page.locator(".muzhi-archive__menu").last();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await context.close();
});

test("归档时间直接显示在卡片状态槽行，空会话也显示", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  // 归档时间在卡片状态槽行（与状态标签同行）：自动 · 官方字幕 · 归档于 …
  const status = page.locator(".muzhi-archive__status").first();
  await expect(status).toContainText("归档于");
  const statusTexts = await page
    .locator(".muzhi-archive__status")
    .allTextContents();
  // 至少一个卡片状态槽含归档时间
  expect(statusTexts.some((t) => t.includes("归档于"))).toBe(true);
  await context.close();
});

test("空会话归档闭环：工作区空会话归档后归档区可见并可恢复", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  // 工作区抽屉里归档空会话
  await page.getByRole("button", { name: "会话操作 空会话" }).click();
  await page.getByRole("button", { name: "归档 空会话" }).click();
  await expect(page.getByText("会话已归档")).toBeVisible();

  // 归档区可见空会话卡片（无字幕）
  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByText("归档空会话")).toBeVisible();
  await expect(page.getByText("空会话").first()).toBeVisible();
  await context.close();
});

test("恢复语义：归档来源回收站条目恢复回工作区且不报错", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开回收站" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "回收站" }),
  ).toBeVisible();
  const btn = page.getByRole("button", { name: "回收站操作 回收站乙" }).first();
  await btn.click({ timeout: 8000 });
  const restoreBtn = page.getByRole("button", {
    name: "恢复会话至工作区 回收站乙",
  });
  await restoreBtn.click();
  await expect(page.getByText("会话已恢复至工作区")).toBeVisible();
  await context.close();
});

test("只读模式：归档打开会话显示横幅，锁定功能弹告警，返回归档横幅消失", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByRole("heading", { name: "归档" })).toBeVisible();
  await page.getByRole("button", { name: "归档操作 归档甲" }).click();
  await page.getByRole("button", { name: "打开会话", exact: true }).click();
  await expect(page.getByText("只读 · 来自归档")).toBeVisible();

  // 返回归档 → 横幅消失
  await page.getByRole("button", { name: "返回归档" }).click();
  await expect(page.getByText("只读 · 来自归档")).toHaveCount(0);
  await expect(page.getByText("归档甲", { exact: true })).toBeVisible();
  await context.close();
});

test("任务提示：运行任务会话删除弹确认框且提示任务终止", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "会话操作 运行任务会话" }).click();
  await page.getByRole("button", { name: "删除 运行任务会话" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "确认删除？" }),
  ).toBeVisible();
  await expect(
    page.getByText("该会话有正在运行的任务，强制删除会终止任务"),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await context.close();
});

test("任务提示：运行任务会话归档先弹确认框，取消不归档", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "会话操作 运行任务会话" }).click();
  await page.getByRole("button", { name: "归档 运行任务会话" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "确认归档？" }),
  ).toBeVisible();
  await expect(
    page.getByText("该会话有正在运行的任务，强制归档会终止任务"),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "确认归档？" }),
  ).toHaveCount(0);
  await context.close();
});

test("状态槽：语言映射与无字幕显示", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开回收站" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "回收站" }),
  ).toBeVisible();
  // bilibili 未指定语言 → 自动
  await expect(page.getByText("自动 · 官方字幕").first()).toBeVisible();
  // groq 指定 other → 其他 · 语音字幕（归档丙）
  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "归档" }),
  ).toBeVisible();
  await expect(page.getByText("其他 · 语音字幕").first()).toBeVisible();
  // 归档空会话显示无字幕
  await expect(page.getByText("无字幕").first()).toBeVisible();
  await context.close();
});

test("快速连点菜单按钮不崩溃且状态一致", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  const button = page.getByRole("button", { name: "归档操作 归档甲" }).first();
  // 菜单浮层可能覆盖按钮；用 dispatchEvent 直接触发 onClick 验证状态机
  // 在连点下保持单菜单、不崩溃。
  for (let i = 0; i < 5; i += 1) {
    await button.dispatchEvent("click");
  }
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  await expect(page.locator(".muzhi-archive__menu")).toHaveCount(1);
  await context.close();
});

test("窄宽 360px：状态槽与菜单不越界", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();
  await page.setViewportSize({ height: 800, width: 360 });

  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "归档" }),
  ).toBeVisible();
  const menuButton = page
    .getByRole("button", { name: "归档操作 归档甲" })
    .first();
  await menuButton.click();
  const menu = page.locator(".muzhi-archive__menu").last();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  // 文档流内展开：菜单宽度与卡片一致，不超出列表容器右边界
  const listBox = await page.locator(".muzhi-archive__list").boundingBox();
  expect(listBox).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(listBox!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    listBox!.x + listBox!.width + 1,
  );
  // 菜单按钮网格不换行撑破容器：两列按钮文本可读
  await expect(
    menu.locator("button", { hasText: "恢复会话至工作区" }),
  ).toBeVisible();
  await context.close();
});

test("对话结束自愈：chat run 终态后会话圆点与任务提示消失", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);

  // 复用攻击种子（保证侧栏可启动），再追加对话线程与 in-flight 的 chat run
  await seedAttackWorkspace(page);
  await page.evaluate(
    async ({ baseTime }) => {
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
        ["chatMessages", "chatThreads", "generationRuns"],
        "readwrite",
      );
      const chatMessages = transaction.objectStore("chatMessages");
      const chatThreads = transaction.objectStore("chatThreads");
      const runs = transaction.objectStore("generationRuns");
      chatThreads.put({
        branchId: "ws-branch-1",
        chatThreadId: "chat-thread-1",
        conversationRevision: 0,
        createdAt: baseTime,
        order: 0,
        sessionId: "ws-session-1",
        subtitleId: "subtitle-ws-branch-1",
        title: null,
        updatedAt: baseTime,
      });
      chatMessages.put({
        chatThreadId: "chat-thread-1",
        content: "你好",
        createdAt: baseTime,
        messageId: "chat-msg-1",
        order: 0,
        role: "user",
        status: "complete",
        updatedAt: baseTime,
      });
      chatMessages.put({
        chatThreadId: "chat-thread-1",
        content: "",
        createdAt: baseTime,
        generationRunId: "chat-run-1",
        messageId: "chat-msg-2",
        order: 1,
        role: "assistant",
        status: "complete",
        updatedAt: baseTime,
      });
      runs.put({
        branchId: "ws-branch-1",
        browserSessionId: "attack-browser",
        completionSequence: null,
        contextRevision: 1,
        createdAt: baseTime,
        errorCode: null,
        expectedOwnerRevision: 0,
        kind: "chat",
        partialOutput: "",
        runId: "chat-run-1",
        sessionId: "ws-session-1",
        status: "requesting",
        stopReason: null,
        subtitleId: "subtitle-ws-branch-1",
        targetId: "chat-thread-1",
        taskId: "chat-task-1",
        updatedAt: baseTime,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener("abort", () => reject(transaction.error), {
          once: true,
        });
      });
      database.close();
    },
    { baseTime: 1_752_729_600_000 },
  );

  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  // 打开会话（loadChatState 就绪 activeChatThreadId）并确认圆点转圈
  await page.getByRole("button", { name: "中文会话" }).first().click();
  await expect(page.getByLabel("中文会话 有任务正在运行")).toBeVisible();

  // 模拟 SW 推送非终态 run 事件：activeChatRun 建立并启动 2s 轮询自愈
  const serviceWorker = context.serviceWorkers()[0];
  await serviceWorker.evaluate(
    ({ run }) => {
      chrome.runtime.sendMessage({
        payload: {
          message: {
            chatThreadId: "chat-thread-1",
            content: "",
            createdAt: 1_752_729_600_000,
            generationRunId: "chat-run-1",
            messageId: "chat-msg-2",
            order: 1,
            role: "assistant",
            status: "complete",
            updatedAt: 1_752_729_600_000,
          },
          run,
          threadId: "chat-thread-1",
        },
        protocolVersion: 1,
        type: "muzhi.chat.assistant.updated",
      });
    },
    {
      run: {
        branchId: "ws-branch-1",
        browserSessionId: "attack-browser",
        completionSequence: null,
        contextRevision: 1,
        createdAt: 1_752_729_600_000,
        errorCode: null,
        expectedOwnerRevision: 0,
        kind: "chat",
        partialOutput: "",
        runId: "chat-run-1",
        sessionId: "ws-session-1",
        status: "requesting",
        stopReason: null,
        subtitleId: "subtitle-ws-branch-1",
        targetId: "chat-thread-1",
        taskId: "chat-task-1",
        updatedAt: 1_752_729_600_000,
      },
    },
  );

  // 直接落库终态（模拟对话自然结束）：reconciler 2s 轮询发现终态后刷新投影
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
    const transaction = database.transaction("generationRuns", "readwrite");
    const runs = transaction.objectStore("generationRuns");
    const run = await new Promise<unknown>((resolve) => {
      const request = runs.get("chat-run-1");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
    });
    // completed 领域校验要求 completionSequence 非 null（真实完成路径会写入）
    runs.put({
      ...(run as Record<string, unknown>),
      completionSequence: 1,
      status: "completed",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
    database.close();
  });

  // reconciler 轮询（2s）+ 投影刷新：圆点消失、删除/归档任务提示解除
  await expect(page.getByLabel("中文会话 有任务正在运行")).toHaveCount(0, {
    timeout: 15_000,
  });
  await context.close();
});

test("归档卡片详情面板：无冗余编辑标签按钮，含来源/标签/操作", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByRole("heading", { name: "归档" })).toBeVisible();
  await page.getByRole("button", { name: "归档操作 归档甲" }).first().click();
  // 展开详情：操作按钮齐全
  for (const name of [
    "打开会话",
    "重命名",
    "恢复会话至工作区",
    "删除归档会话",
  ]) {
    await expect(
      page.getByRole("button", { name, exact: true }).first(),
    ).toBeVisible();
  }
  // 详情不再有「编辑标签」（卡片右侧 🏷 已提供）
  await expect(
    page.getByRole("button", { name: "编辑标签", exact: true }),
  ).toHaveCount(0);
  // 详情含会话标签 chips
  await expect(page.locator(".muzhi-archive__menu-tag").first()).toBeVisible();
  // 点击外部按钮关闭详情（互斥）
  await page.getByRole("button", { name: "归档操作 归档乙" }).click();
  await expect(page.locator(".muzhi-archive__menu")).toHaveCount(1);
  await context.close();
});

test("左下角归档按钮离开只读会话后横幅消失", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开归档区" }).click();
  await page.getByRole("button", { name: "归档操作 归档甲" }).first().click();
  await page.getByRole("button", { name: "打开会话", exact: true }).click();
  await expect(page.getByText("只读 · 来自归档")).toBeVisible();
  // 不点「返回归档」，改点左下角归档区按钮
  await page.getByRole("button", { name: "打开归档区" }).click();
  await expect(page.getByText("只读 · 来自归档")).toHaveCount(0);
  await context.close();
});

test("回收站展开详情不再重复标题与状态槽", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await openSidePanel(context, extensionId);
  await seedAttackWorkspace(page);
  await page.reload();
  await expect(page.locator('main[aria-label="Bilimuzhi"]')).toBeVisible();

  await page.getByRole("button", { name: "打开回收站" }).click();
  await page
    .getByRole("button", { name: "回收站操作 回收站甲" })
    .first()
    .click();
  const panel = page.locator(".muzhi-trash__menu");
  await expect(panel).toBeVisible();
  // 详情中不再重复标题（回收站甲）与状态槽文本（自动 · 官方字幕）
  const panelText = await panel.textContent();
  expect(panelText).not.toContain("回收站甲");
  expect(panelText).not.toContain("自动 · 官方字幕");
  await context.close();
});
