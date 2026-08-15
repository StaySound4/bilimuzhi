/**
 * QA scenario 注册表（仅 `npm run build:qa` 构建引入）。
 *
 * 每个 scenario 提供稳定 ID、surface/state 元数据、数据证明 counts、
 * expected anchors（浏览器断言）与真实组件 props 投影。
 */
import type { AiChatShellProps } from "../ui/ai-chat-shell";
import type { RestoredWorkspace } from "../application/workspace-restoration";
import type { SubtitleBranch } from "../domain/branch";
import type { BranchPlacement } from "../domain/placement";
import type { Session } from "../domain/session";
import type { SubtitleSnapshot } from "../domain/subtitle";

import type { QaScenario, QaTheme } from "./types";
import {
  makeBatchArchiveProps,
  makeBatchDrawerProps,
  makeBatchTrashProps,
  makeBatchWorkspaceProps,
  type BatchFixtureOptions,
} from "./fixtures/batch";
import {
  makeArchiveWorkspaceProps,
  makeChatMessages,
  makeChatProps,
  makeSessionDrawerProps,
  makeSubtitleRows,
  makeTimelineProps,
  makeInsightProps,
  makeTrashWorkspaceProps,
  QA_SESSION_ID,
  QA_VIDEO_KEY,
} from "./fixtures/surfaces";

/** 构造一个可展示 workspace 模式的最小 RestoredWorkspace 投影。 */
function makeRestoredWorkspace(
  activeMode: RestoredWorkspace["activeMode"],
  options: { readonly withSubtitle?: boolean } = {},
): RestoredWorkspace {
  const session: Session = {
    activeBranchId: "qa-branch-001",
    createdAt: 1_752_729_600_000,
    customTitle: true,
    lastActivityAt: 1_752_729_600_000,
    selectionRevision: 0,
    sessionId: QA_SESSION_ID,
    title: "机器学习基础系列",
    updatedAt: 1_752_729_600_000,
    videoBound: true,
    videoKey: QA_VIDEO_KEY,
  };
  const branch: SubtitleBranch = {
    activeSubtitleId: "qa-subtitle-001",
    branchId: "qa-branch-001",
    completionSequence: 1,
    contextRevision: 1,
    language: "zh",
    createdAt: 1_752_729_600_000,
    detectedLanguage: "zh",
    lastOpenedAt: 1_752_729_600_000,
    lastReadCompletionSequence: 1,
    lastSelectedAt: 1_752_729_600_000,
    requestedLanguageMode: null,
    sessionId: QA_SESSION_ID,
    source: "bilibili",
    title: null,
    updatedAt: 1_752_729_600_000,
    videoKey: QA_VIDEO_KEY,
  };
  const placement: BranchPlacement = {
    branchId: "qa-branch-001",
    deletionReason: null,
    location: "workspace",
    order: 0,
    purgeAfter: null,
    retentionStartedAt: null,
    sessionId: QA_SESSION_ID,
    trashedAt: null,
    trashOrigin: null,
    trashOriginFolderId: null,
    trashOriginPathSnapshot: null,
  };
  const subtitle: SubtitleSnapshot = {
    branchId: "qa-branch-001",
    contentHash: "qa-content-hash-0000",
    createdAt: 1_752_729_600_000,
    language: "zh",
    rows: makeSubtitleRows(24),
    sessionId: QA_SESSION_ID,
    source: "bilibili",
    status: "active",
    subtitleId: "qa-subtitle-001",
    videoKey: QA_VIDEO_KEY,
  };
  return {
    activeMode,
    branch,
    placement,
    scrollTopByMode: { chat: 0, segments: 0, summary: 0, timeline: 0 },
    session,
    subtitle: options.withSubtitle === false ? null : subtitle,
  };
}

/** Batch scenario 的公共 props 构造。 */
function batchShellProps(
  theme: QaTheme,
  opts: BatchFixtureOptions,
): AiChatShellProps {
  const batch = makeBatchWorkspaceProps(theme, opts);
  return {
    appearance: { theme },
    batch,
    batchDrawer: makeBatchDrawerProps(batch.view?.job.batchJobId ?? null),
    sessionDrawer: makeSessionDrawerProps({ activeWorkspaceMode: "batch" }),
    uiLanguage: "zh-Hans",
    utilityView: "batch",
  };
}

const SCENARIOS: readonly QaScenario[] = [
  // —— Batch workspace ——
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 0,
        distribution: [0, 0, 0, 0, 0],
        withView: false,
      }),
    counts: { batchItems: 0 },
    expectedAnchors: [
      { role: "heading", name: "还没有列表" },
      { css: ".muzhi-batch__empty-card" },
    ],
    id: "batch-empty",
    state: "empty",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
      }),
    counts: {
      batchItems: 20,
      cancelled: 1,
      failed: 3,
      pending: 4,
      running: 3,
      succeeded: 9,
    },
    expectedAnchors: [
      { css: ".muzhi-batch__table tbody tr" },
      { role: "table" },
    ],
    id: "batch-mixed-20",
    state: "mixed",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 94,
        distribution: [20, 12, 44, 13, 5],
      }),
    counts: {
      batchItems: 94,
      cancelled: 5,
      failed: 13,
      pending: 20,
      running: 12,
      succeeded: 44,
    },
    expectedAnchors: [{ css: ".muzhi-batch__table tbody tr" }],
    id: "batch-mixed-94",
    state: "mixed",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 2,
        overwriteCount: 1,
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      overwrite: 1,
      pending: 4,
      running: 3,
      selected: 2,
      succeeded: 9,
    },
    expectedAnchors: [
      { css: ".muzhi-batch__actions.is-contextual" },
      { css: 'input[type="checkbox"]:checked' },
    ],
    id: "batch-selected-2",
    state: "selected",
    surface: "batch-selection",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 12, 1, 2, 1],
        jobStatus: "running",
      }),
    counts: {
      batchItems: 20,
      failed: 2,
      pending: 4,
      running: 12,
      succeeded: 1,
    },
    expectedAnchors: [
      { css: '[data-status="running"]' },
      { role: "button", name: "停止" },
    ],
    id: "batch-running",
    state: "running",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [2, 0, 8, 8, 2],
        jobStatus: "failed",
      }),
    counts: {
      batchItems: 20,
      cancelled: 2,
      failed: 8,
      pending: 2,
      succeeded: 8,
    },
    expectedAnchors: [{ css: '[data-status="failed"]' }],
    id: "batch-partial-failure",
    state: "partial-failure",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [0, 0, 20, 0, 0],
        jobStatus: "completed",
      }),
    counts: { batchItems: 20, succeeded: 20 },
    expectedAnchors: [{ css: '[data-status="succeeded"]' }],
    id: "batch-completed",
    state: "completed",
    surface: "batch-workspace",
    theme: "light",
  },
  // —— Ticket 06：Batch object menu / canonical overlays（interaction 型）——
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 2,
        overwriteCount: 1,
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      overwrite: 1,
      pending: 4,
      running: 3,
      selected: 2,
      succeeded: 9,
    },
    expectedAnchors: [{ css: ".muzhi-batch__actions.is-contextual" }],
    id: "batch-job-menu-open",
    interactions: [
      {
        expect: { role: "menu" },
        // QA 视口 ≥620px 容器：侧栏常驻，直接打开列表三点菜单。
        trigger: { role: "button", name: "列表操作 测试任务 1" },
      },
    ],
    state: "job-menu-open",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 2,
        overwriteCount: 1,
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      overwrite: 1,
      pending: 4,
      running: 3,
      selected: 2,
      succeeded: 9,
    },
    expectedAnchors: [{ css: ".muzhi-batch__actions.is-contextual" }],
    id: "batch-overwrite-choice",
    interactions: [
      {
        expect: { role: "dialog", name: "批量获取字幕" },
        trigger: { role: "button", name: "批量获取字幕" },
      },
    ],
    state: "batch-overwrite-choice",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        jobStatus: "running",
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      pending: 4,
      running: 12,
      succeeded: 1,
    },
    expectedAnchors: [{ css: '[data-status="running"]' }],
    id: "batch-clear-job-confirm",
    interactions: [
      {
        expect: { role: "alertdialog", name: "删除列表？" },
        steps: [
          { role: "button", name: "列表操作 测试任务 1" },
          { role: "menuitem", name: "删除" },
        ],
      },
    ],
    state: "batch-clear-job-confirm",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 2,
        overwriteCount: 1,
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      overwrite: 1,
      pending: 4,
      running: 3,
      selected: 2,
      succeeded: 9,
    },
    expectedAnchors: [{ css: ".muzhi-batch__actions.is-contextual" }],
    id: "batch-row-speech-settings",
    interactions: [
      {
        expect: { role: "dialog", name: "语音转录与语言" },
        trigger: {
          role: "button",
          name: "设置 为什么机器学习模型会失效：偏差与方差详解（第 1 部分） 的语音转录与语言",
        },
      },
    ],
    state: "batch-row-speech-settings",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [0, 0, 20, 0, 0],
        jobStatus: "completed",
        selectedCount: 2,
      }),
    counts: {
      batchItems: 20,
      selected: 2,
      succeeded: 20,
    },
    expectedAnchors: [{ css: ".muzhi-batch__actions.is-contextual" }],
    id: "batch-export-options",
    interactions: [
      {
        expect: { role: "dialog", name: "选择导出格式" },
        trigger: { role: "button", name: "导出" },
      },
    ],
    state: "batch-export-options",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 2,
      }),
    counts: {
      batchItems: 20,
      failed: 3,
      pending: 4,
      running: 3,
      selected: 2,
      succeeded: 9,
    },
    expectedAnchors: [{ css: ".muzhi-batch__actions.is-contextual" }],
    id: "batch-speech-strategy-choice",
    interactions: [
      {
        expect: { role: "dialog", name: "批量获取字幕" },
        trigger: { role: "button", name: "批量获取字幕" },
      },
    ],
    state: "batch-speech-strategy-choice",
    surface: "batch-overlay",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
      }),
    counts: { batchItems: 20 },
    expectedAnchors: [{ css: ".muzhi-batch__column-settings-open" }],
    id: "batch-column-settings",
    interactions: [
      {
        expect: { role: "dialog", name: "调整列" },
        trigger: { role: "button", name: "调整列" },
      },
    ],
    state: "column-settings-open",
    surface: "batch-overlay",
    theme: "light",
  },
  // —— Timeline ——
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), { syncEnabled: false }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-populated-20",
    state: "populated",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        currentTimeMs: 15_000,
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-current",
    state: "current",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        initialScrollTop: 17 * 56,
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-long-text",
    state: "long-text",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        initialScrollTop: 12 * 56,
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-mid-scroll",
    state: "mid-scroll",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        currentTimeMs: 9_000,
        syncEnabled: true,
        syncState: {
          generation: 3,
          lastSampleMs: 12_000,
          phase: "following",
        },
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-sync-following",
    state: "sync-following",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        currentTimeMs: 9_000,
        syncEnabled: true,
        syncState: {
          generation: 4,
          phase: "seeking",
          seekTargetMs: 60_000,
        },
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-sync-seek-pending",
    state: "sync-seek-pending",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      // 关闭/切换视频页：playerOwner 缺失（运行时唯一可达的不匹配态），
      // 定位必须不可用（不同 P 在 runtime 中体现为 playerIsBound=false）。
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        playerOwner: undefined,
        syncEnabled: false,
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-locate-mismatch",
    state: "locate-mismatch",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      // 快速连续点击两次 seek（意图 A 30s → 意图 B 60s）：last intent wins，
      // 旧 seek 响应被丢弃后的终态=following 且高亮 B；旧采样不回跳。
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        currentTimeMs: 9_000,
        syncEnabled: true,
        syncState: {
          generation: 5,
          lastSampleMs: 60_000,
          phase: "following",
        },
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-sync-rapid-click",
    state: "sync-rapid-click",
    surface: "timeline",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("timeline"),
      sessionDrawer: makeSessionDrawerProps(),
      // owner 失效后同步自动关闭：idle + 按钮未按下。
      timeline: makeTimelineProps(makeSubtitleRows(24), {
        syncEnabled: false,
        syncState: { generation: 6, phase: "idle" },
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { subtitleRows: 24 },
    expectedAnchors: [{ css: ".subtitle-timeline" }],
    id: "timeline-sync-owner-lost",
    state: "sync-owner-lost",
    surface: "timeline",
    theme: "light",
  },
  // —— Chat ——
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({ attachments: [] }),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-populated",
    state: "populated",
    surface: "chat",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({
        activeGenerationRun: {
          conversationId: "qa-thread-001",
          messageId: "qa-msg-007",
          runId: "qa-run-001",
          sessionId: QA_SESSION_ID,
          status: "streaming",
          stoppable: true,
        },
        generationStatus: "streaming",
        messages: makeChatMessages(),
      }),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-streaming",
    state: "streaming",
    surface: "chat",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({
        errorMessage: "生成失败：网络请求超时。",
        generationStatus: "failed",
        messages: [
          {
            content: "请重试上面的问题。",
            failure: {
              action: "重试",
              code: "NETWORK_ERROR",
              incomplete: false,
              placement: "chat-message",
              preservePartial: false,
              preservePreviousArtifact: false,
              retryable: true,
            },
            id: "qa-msg-008",
            role: "assistant",
            retryable: true,
            status: "failed",
          },
        ],
      }),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 1 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-failed",
    state: "failed",
    surface: "chat",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({
        taskModelSelection: {
          modelId: "model-001",
          profileId: "profile-001",
          reasoningEffort: "medium",
          state: "needs-reselection",
        },
      }),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-needs-reselection",
    state: "needs-reselection",
    surface: "chat",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({ outputLanguageLocked: true }),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-language-locked",
    state: "language-locked",
    surface: "chat",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps(),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-attachments",
    state: "attachments",
    surface: "chat",
    theme: "light",
  },
  // —— Sessions ——
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      sessionDrawer: makeSessionDrawerProps({
        pinnedSessionIds: [],
      }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { sessions: 4 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "sessions-populated",
    state: "populated",
    surface: "sessions",
    theme: "light",
  },
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { sessions: 4 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "sessions-selected",
    state: "selected",
    surface: "sessions",
    theme: "light",
  },
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { sessions: 4 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "sessions-pinned",
    state: "pinned",
    surface: "sessions",
    theme: "light",
  },
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { sessions: 4 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "sessions-multi-select",
    state: "multi-select",
    surface: "sessions",
    theme: "light",
  },
  // —— Insights ——
  {
    activeTab: "segments",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("segments"),
      segments: makeInsightProps("segments"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { segments: 7 },
    expectedAnchors: [{ css: ".muzhi-insight" }],
    id: "segments-populated",
    state: "populated",
    surface: "segments",
    theme: "light",
  },
  {
    activeTab: "summary",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("summary"),
      sessionDrawer: makeSessionDrawerProps(),
      summary: makeInsightProps("summary"),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { paragraphs: 3 },
    expectedAnchors: [{ css: ".muzhi-insight" }],
    id: "summary-populated",
    state: "populated",
    surface: "summary",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({ messages: [] }),
      restoredWorkspace: makeRestoredWorkspace("timeline", {
        withSubtitle: false,
      }),
      segments: makeInsightProps("segments", { hasSubtitle: false }),
      sessionDrawer: makeSessionDrawerProps(),
      summary: makeInsightProps("summary", { hasSubtitle: false }),
      timeline: makeTimelineProps([]),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { emptyStates: 4 },
    expectedAnchors: [
      { css: ".muzhi-workspace-empty[data-empty-variant='no-subtitle']" },
    ],
    id: "workspace-no-subtitle",
    state: "no-subtitle",
    surface: "workspace-empty-states",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({ messages: [] }),
      restoredWorkspace: undefined,
      segments: makeInsightProps("segments", {
        content: "",
        hasSubtitle: false,
        phase: "idle",
        segments: [],
      }),
      sessionDrawer: makeSessionDrawerProps(),
      summary: makeInsightProps("summary", {
        content: "",
        hasSubtitle: false,
        phase: "idle",
      }),
      timeline: makeTimelineProps([]),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { emptyStates: 4 },
    expectedAnchors: [
      { css: ".muzhi-workspace-empty[data-empty-variant='no-video']" },
    ],
    id: "workspace-no-video",
    state: "no-video",
    surface: "workspace-empty-states",
    theme: "light",
  },
  {
    activeTab: "segments",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps({ messages: [] }),
      restoredWorkspace: makeRestoredWorkspace("segments"),
      segments: makeInsightProps("segments", {
        content: "",
        phase: "idle",
        segments: [],
      }),
      sessionDrawer: makeSessionDrawerProps(),
      summary: makeInsightProps("summary", { content: "", phase: "idle" }),
      timeline: makeTimelineProps(makeSubtitleRows(24)),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { emptyStates: 3 },
    expectedAnchors: [
      { css: ".muzhi-workspace-empty[data-empty-variant='no-content']" },
    ],
    id: "workspace-no-content",
    state: "no-content",
    surface: "workspace-empty-states",
    theme: "light",
  },
  {
    activeTab: "timeline",
    buildProps: (theme) => ({
      appearance: { theme },
      helpDialog: { context: "session-workspace" },
      onHelpClick: () => undefined,
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "会话模式教程" },
      { css: ".muzhi-shell__help" },
    ],
    id: "session-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) => ({
      ...batchShellProps(theme, { count: 1, distribution: [1, 0, 0, 0, 0] }),
      helpDialog: { context: "batch-workspace" },
      onHelpClick: () => undefined,
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "批量模式教程" },
      // 帮助按钮已随 f5f7863 迁移到 shell header(批量/会话共用,右上角贴主题设置)。
      { css: ".muzhi-shell__help" },
    ],
    id: "batch-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  // —— Ticket 10：六帮助语境（session/batch × workspace/archive/trash）——
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      archive: makeArchiveWorkspaceProps(),
      helpDialog: { context: "session-archive" },
      onHelpClick: () => undefined,
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "archive",
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "会话归档教程" },
      { css: ".muzhi-archive" },
    ],
    id: "session-archive-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      helpDialog: { context: "session-trash" },
      onHelpClick: () => undefined,
      sessionDrawer: makeSessionDrawerProps(),
      trash: makeTrashWorkspaceProps(),
      uiLanguage: "zh-Hans",
      utilityView: "trash",
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "会话回收站教程" },
      { css: ".muzhi-trash" },
    ],
    id: "session-trash-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) => ({
      ...batchShellProps(theme, { count: 1, distribution: [1, 0, 0, 0, 0] }),
      batchArchive: makeBatchArchiveProps(theme, {
        count: 1,
        distribution: [1, 0, 0, 0, 0],
      }),
      helpDialog: { context: "batch-archive" },
      onHelpClick: () => undefined,
      utilityView: "batch-archive",
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "批量归档教程" },
      { css: ".muzhi-batch-archive" },
    ],
    id: "batch-archive-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) => ({
      ...batchShellProps(theme, { count: 1, distribution: [1, 0, 0, 0, 0] }),
      batchTrash: makeBatchTrashProps(theme, {
        count: 1,
        distribution: [1, 0, 0, 0, 0],
      }),
      helpDialog: { context: "batch-trash" },
      onHelpClick: () => undefined,
      utilityView: "batch-trash",
    }),
    counts: { helpDialogs: 1 },
    expectedAnchors: [
      { role: "dialog", name: "批量回收站教程" },
      { css: ".muzhi-batch-trash" },
    ],
    id: "batch-trash-help-dialog",
    state: "help-dialog",
    surface: "help-dialog",
    theme: "light",
  },
  // —— Ticket 06：Session / Chat object menu（interaction 型）——
  {
    activeTab: "sessions",
    buildProps: (theme) => ({
      appearance: { theme },
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { sessions: 4 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "sessions-menu-open",
    interactions: [
      {
        expect: { role: "menu" },
        trigger: { role: "button", name: "会话操作 机器学习基础系列" },
      },
    ],
    state: "menu-open",
    surface: "sessions",
    theme: "light",
  },
  {
    activeTab: "chat",
    buildProps: (theme) => ({
      appearance: { theme },
      chat: makeChatProps(),
      restoredWorkspace: makeRestoredWorkspace("chat"),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { messages: 7 },
    expectedAnchors: [{ css: ".muzhi-chat" }],
    id: "chat-thread-menu-open",
    interactions: [
      {
        expect: { role: "menu" },
        trigger: { role: "button", name: "对话操作" },
      },
    ],
    state: "menu-open",
    surface: "chat",
    theme: "light",
  },
  // —— Ticket 13 终验专属场景（真实差异化 state）——
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 3, 9, 3, 1],
        selectedCount: 0,
      }),
    counts: {
      batchItems: 20,
      cancelled: 1,
      failed: 3,
      pending: 4,
      running: 3,
      succeeded: 9,
    },
    expectedAnchors: [{ css: ".muzhi-batch__table tbody tr" }],
    id: "batch-zero-selected",
    state: "0-selected",
    surface: "batch-workspace",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 20,
        distribution: [4, 12, 1, 2, 1],
        jobStatus: "running",
        selectedCount: 2,
      }),
    counts: {
      batchItems: 20,
      cancelled: 1,
      failed: 2,
      pending: 4,
      running: 12,
      selected: 2,
      succeeded: 1,
    },
    expectedAnchors: [{ css: '[data-status="running"]' }],
    id: "batch-running-selected",
    state: "running-selected",
    surface: "batch-selection",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 0,
        distribution: [0, 0, 0, 0, 0],
      }),
    counts: { batchItems: 0, jobs: 1 },
    expectedAnchors: [{ css: ".session-drawer__list" }],
    id: "batch-sidebar-guide",
    state: "guide",
    surface: "batch-sidebar",
    theme: "light",
  },
  {
    activeTab: "batch",
    buildProps: (theme) =>
      batchShellProps(theme, {
        count: 0,
        distribution: [0, 0, 0, 0, 0],
      }),
    counts: { batchItems: 0, jobs: 0, sessions: 0 },
    expectedAnchors: [
      { role: "button", name: "新建列表" },
      { css: ".session-drawer__empty" },
    ],
    id: "batch-sidebar-no-session",
    state: "no-session-list",
    surface: "batch-sidebar",
    theme: "light",
  },
  {
    activeTab: "segments",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("segments"),
      segments: makeInsightProps("segments", { phase: "running" }),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { segments: 7 },
    expectedAnchors: [{ css: ".muzhi-insight" }],
    id: "segments-running",
    state: "running",
    surface: "segments",
    theme: "light",
  },
  {
    activeTab: "segments",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("segments"),
      segments: makeInsightProps("segments", {
        failure: {
          action: "重试",
          code: "NETWORK_ERROR",
          incomplete: false,
          placement: "artifact",
          preservePartial: false,
          preservePreviousArtifact: false,
          retryable: true,
        },
        phase: "failed",
      }),
      sessionDrawer: makeSessionDrawerProps(),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { segments: 7 },
    expectedAnchors: [{ css: ".muzhi-insight" }],
    id: "segments-failed",
    state: "failed",
    surface: "segments",
    theme: "light",
  },
  {
    activeTab: "summary",
    buildProps: (theme) => ({
      appearance: { theme },
      restoredWorkspace: makeRestoredWorkspace("summary"),
      sessionDrawer: makeSessionDrawerProps(),
      summary: makeInsightProps("summary", { phase: "running" }),
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { paragraphs: 3 },
    expectedAnchors: [{ css: ".muzhi-insight" }],
    id: "summary-running",
    state: "running",
    surface: "summary",
    theme: "light",
  },
  {
    activeTab: "primitives",
    buildProps: (theme) => ({
      appearance: { theme },
      uiLanguage: "zh-Hans",
      utilityView: "workspace",
    }),
    counts: { primitives: 3 },
    expectedAnchors: [{ css: ".qa-primitives-demo" }],
    id: "primitives-demo",
    state: "populated",
    surface: "primitives",
    theme: "light",
  },
];

export const QA_SCENARIOS: ReadonlyMap<string, QaScenario> = new Map(
  SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

export function getQaScenario(id: string): QaScenario | undefined {
  return QA_SCENARIOS.get(id);
}

export function getQaScenarioIds(): readonly string[] {
  return Array.from(QA_SCENARIOS.keys()).sort();
}
