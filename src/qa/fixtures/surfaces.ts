/**
 * Timeline / Chat / Sessions / Insights 的 QA fixture 工厂（仅 QA build 引入）。
 * 数据全部为非敏感、固定 seed 的内存投影；handler 为记录型 spy。
 */
import type { SubtitleTimelineProps } from "../../ui/subtitle-timeline";
import type { SubtitleRow } from "../../domain/subtitle";
import type {
  ChatWorkspaceProps,
  ChatThreadOption,
  ChatWorkspaceMessage,
} from "../../ui/chat/chat-workspace";
import type { SessionDrawerProps } from "../../ui/session-drawer";
import type { Session } from "../../domain/session";
import type {
  InsightWorkspaceProps,
  InsightPhase,
} from "../../ui/insights/insight-workspace";
import type { ArchiveWorkspaceProps } from "../../ui/archive/archive-workspace";
import type { TrashWorkspaceProps } from "../../ui/trash/trash-workspace";
import type { ArtifactKind, ArtifactSegment } from "../../domain/artifact";

export const QA_VIDEO_KEY = "bvid:BV1zt4y1z72D:cid:30000000007:p:7";
export const QA_SESSION_ID = "qa-session-001";

/** 生成 20+ 行固定字幕（含 current、search hit、长文本与长无空格文本）。 */
export function makeSubtitleRows(count = 24): readonly SubtitleRow[] {
  const texts = [
    "大家好，欢迎收看本期节目。",
    "今天我们讨论的主题是机器学习中的偏差与方差。",
    "偏差衡量模型预测与真实值之间的系统性差距。",
    "方差则反映模型对训练数据波动的敏感程度。",
    "一个高偏差的模型通常过于简单，无法捕捉数据中的规律。",
    "一个高方差的模型则可能过拟合，记住了训练集中的噪声。",
    "偏差与方差之间存在此消彼长的权衡关系。",
    "我们可以通过交叉验证来评估模型的泛化能力。",
    "正则化技术可以在一定程度上控制模型的复杂度。",
    "L1 正则化倾向于产生稀疏解，L2 正则化则压缩参数幅度。",
    "在实际项目中，我们通常需要结合业务场景选择合适的策略。",
    "数据质量往往比模型复杂度更影响最终效果。",
    "特征工程是机器学习流程中不可忽视的环节。",
    "模型评估指标的选择需要与业务目标对齐。",
    "A/B 测试可以帮助我们验证模型上线后的真实收益。",
    "持续监控与模型更新是生产环境中的长期任务。",
    "https://example.com/some/very/long/path/without/spaces/for/clipping/test/1234567890",
    "长文本行：在窄屏下应当被正确地换行而不是溢出容器边界，需要验证两行裁切行为。",
    "多行文本：第一行。",
    "多行文本：第二行。",
    "时间戳与跳转：点击当前行应调用 seek。",
    "搜索命中：关键词「偏差」出现在第 2 行与第 7 行。",
    "最后一行：节目到此结束，感谢观看。",
  ];
  return Array.from({ length: count }, (_, index) => ({
    endMs: index * 3_000 + 2_800,
    lineId: `qa-line-${index}`,
    startMs: index * 3_000,
    text: texts[index % texts.length],
  }));
}

export function makeTimelineProps(
  rows: readonly SubtitleRow[],
  overrides: Partial<SubtitleTimelineProps> = {},
): SubtitleTimelineProps {
  return {
    currentTimeMs: 12_000,
    durationMs: rows.length * 3_000,
    onExport: (format) => void format,
    onLocateCurrent: async () => 3,
    onSeek: () => undefined,
    onScrollTopChange: () => undefined,
    onSyncEnabledChange: () => undefined,
    overscan: 4,
    rowHeight: 56,
    rows,
    subtitleOwner: {
      pageRevision: 1,
      videoKey: QA_VIDEO_KEY,
    },
    playerOwner: {
      pageRevision: 1,
      videoKey: QA_VIDEO_KEY,
    },
    syncEnabled: false,
    ...overrides,
  };
}

/** Session 归档区投影（非敏感固定 seed；handler 为记录型 spy）。 */
export function makeArchiveWorkspaceProps(): ArchiveWorkspaceProps {
  return {
    onDeleteSessionProjection: () => true,
    onDeleteSessionProjectionMany: () => true,
    onDeleteTag: () => true,
    onMoveTag: () => true,
    onOpenSession: () => true,
    onCreateTag: () => true,
    onRenameSession: () => true,
    onRenameTag: () => true,
    onRestoreToWorkspace: () => true,
    onRestoreToWorkspaceMany: () => true,
    onSelectedBranchIdsChange: () => undefined,
    onSetSessionTags: () => true,
    selectedBranchIds: [],
    sessions: [
      {
        archivedAtLabel: "2026/7/15 10:00",
        branchIds: ["branch-1"],
        id: "arch-session-1",
        kind: "session",
        statusDetailLabel: "官方 CC",
        statusLabel: "中文 · 官方字幕",
        tagIds: [],
        title: "程序查询方式",
      },
      {
        archivedAtLabel: "2026/7/16 11:00",
        branchIds: ["branch-2", "branch-3"],
        id: "arch-session-2",
        kind: "session",
        statusDetailLabel: null,
        statusLabel: "自动 · 无字幕",
        tagIds: [],
        title: "中断控制方式",
      },
    ],
    tagCount: 0,
    tags: [],
    uiLanguage: "zh-Hans",
  };
}

/** Session 回收站投影（非敏感固定 seed；handler 为记录型 spy）。 */
export function makeTrashWorkspaceProps(): TrashWorkspaceProps {
  return {
    applyRetentionTo: "future",
    customRetentionDays: "14",
    items: [
      {
        expiresAtLabel: "2026-07-22 10:00",
        id: "trash-branch-1",
        kind: "branch",
        originKind: "archive",
        originLabel: "归档",
        sessionId: "s-1",
        statusDetailLabel: null,
        statusLabel: "中文 · 官方字幕",
        title: "07-15 官方 / 中文",
        trashedAtLabel: "2026-07-15 10:00",
      },
      {
        expiresAtLabel: "2026-07-23 10:00",
        id: "trash-branch-2",
        kind: "branch",
        originKind: "workspace",
        originLabel: "工作区",
        sessionId: "s-2",
        statusDetailLabel: null,
        statusLabel: "自动 · 无字幕",
        title: "07-16 AI / English",
        trashedAtLabel: "2026-07-16 10:00",
      },
    ],
    onEmptyTrash: () => true,
    onPermanentlyDelete: () => true,
    onRestore: () => true,
    onRestoreSelected: () => true,
    onRetentionChange: () => true,
    retention: "7",
    uiLanguage: "zh-Hans",
  };
}

/** Chat：至少 6 轮、长 Markdown、failed/streaming、模型状态与附件。 */
export function makeChatThreads(): readonly ChatThreadOption[] {
  return [
    { id: "qa-thread-001", title: "关于机器学习的问题" },
    { id: "qa-thread-002", title: "总结视频内容" },
    { id: "qa-thread-003", title: "分段讨论" },
  ];
}

export function makeChatMessages(): readonly ChatWorkspaceMessage[] {
  return [
    {
      content: "请解释一下什么是过拟合？",
      id: "qa-msg-001",
      role: "user",
      status: "complete",
    },
    {
      content:
        "过拟合是指模型在训练数据上表现优异，但在未见数据上表现不佳的现象。\n\n具体表现为：\n\n1. 模型记住了训练集中的噪声\n2. 泛化能力下降\n3. 通常伴随高方差\n\n> 可以通过正则化、交叉验证、增加数据量等方式缓解。",
      id: "qa-msg-002",
      role: "assistant",
      status: "complete",
    },
    {
      content: "那偏差和方差又有什么区别？",
      id: "qa-msg-003",
      role: "user",
      status: "complete",
    },
    {
      content:
        "偏差（Bias）是模型预测值与真实值的系统性差距，方差（Variance）是模型对训练数据波动的敏感程度。\n\n| 指标 | 含义 | 来源 |\n|---|---|---|\n| 偏差 | 系统性误差 | 模型过于简单 |\n| 方差 | 波动程度 | 模型过于复杂 |\n\n```\nbias-variance-tradeoff\n```",
      id: "qa-msg-004",
      role: "assistant",
      status: "complete",
    },
    {
      content: "给出一个 L1 正则化的例子。",
      id: "qa-msg-005",
      role: "user",
      status: "complete",
    },
    {
      content:
        "L1 正则化（Lasso）在损失函数中加入权重绝对值和：\n\n$$Loss = MSE + \\lambda \\sum |w_i|$$\n\n它倾向于将不重要的特征权重压缩为零，产生稀疏解，常用于特征选择。",
      id: "qa-msg-006",
      role: "assistant",
      status: "complete",
    },
    {
      content: "正在生成中的流式回复……",
      id: "qa-msg-007",
      role: "assistant",
      status: "streaming",
      incomplete: true,
    },
  ];
}

export function makeChatProps(
  overrides: Partial<ChatWorkspaceProps> = {},
): ChatWorkspaceProps {
  return {
    activeThreadId: "qa-thread-001",
    attachments: [
      {
        attachmentId: "qa-attach-001",
        currentTimeMs: 12_000,
        name: "截图-01.png",
        subtitleContextRevision: 1,
        subtitleId: "qa-subtitle-001",
        thumbnailUrl: "blob:qa-attach-001",
        videoKey: QA_VIDEO_KEY,
      },
    ],
    controlPromptOptions: [
      { id: "prompt-default", name: "默认提示词" },
      { id: "prompt-concise", name: "简明回答" },
    ],
    messages: makeChatMessages(),
    onCreateThread: () => true,
    onDeleteThread: () => true,
    onExportThread: () => undefined,
    onRenameThread: () => true,
    onSelectThread: () => true,
    onSend: () => true,
    onSelectControlPrompt: () => true,
    onStop: () => true,
    onRetryMessage: () => true,
    onCopyMessage: () => undefined,
    onRequestMessageMutation: () => true,
    onRemoveAttachment: () => true,
    onClearAttachments: () => true,
    onAttachImages: () => true,
    onSeek: () => undefined,
    onSeekAttachment: () => undefined,
    onTaskModelChange: () => undefined,
    outputLanguage: "auto",
    selectedControlPromptId: "prompt-default",
    subtitleRows: makeSubtitleRows(8),
    taskModelProfiles: [
      {
        id: "profile-001",
        models: [
          {
            enabled: true,
            id: "model-001",
            label: "deepseek-chat",
            reasoningEfforts: ["low", "medium", "high"],
          },
        ],
        name: "DeepSeek",
      },
    ],
    taskModelSelection: {
      modelId: "model-001",
      profileId: "profile-001",
      reasoningEffort: "medium",
      state: "ready",
    },
    threads: makeChatThreads(),
    timeLinkScope: {
      activeVideoKey: QA_VIDEO_KEY,
      subtitleVideoKey: QA_VIDEO_KEY,
    },
    validatedTimeLinks: [
      { label: "00:12", seconds: 12 },
      { label: "00:45", seconds: 45 },
    ],
    ...overrides,
  };
}

/** Sessions：正常/选中/running/unread/pinned。 */
export function makeSessions(): readonly Session[] {
  const base = {
    activeBranchId: "qa-branch-001",
    createdAt: 1_752_729_600_000,
    customTitle: true,
    lastActivityAt: 1_752_729_600_000,
    selectionRevision: 0,
    updatedAt: 1_752_729_600_000,
    videoBound: true,
  };
  return [
    {
      ...base,
      sessionId: "qa-session-001",
      title: "机器学习基础系列",
      videoKey: "bvid:BV1zt4y1z72D:cid:30000000007:p:7",
    },
    {
      ...base,
      sessionId: "qa-session-002",
      title: "编译原理入门",
      videoKey: "bvid:BV1GJ411x7h7:cid:30000000008:p:1",
    },
    {
      ...base,
      sessionId: "qa-session-003",
      title: "数据结构与算法",
      videoKey: "bvid:BV1Wv411h7kN:cid:30000000009:p:1",
    },
    {
      ...base,
      sessionId: "qa-session-004",
      title: "计算机网络基础",
      videoKey: "bvid:BV1mK4y1C7Bz:cid:30000000010:p:1",
    },
  ];
}

export function makeSessionDrawerProps(
  overrides: Partial<SessionDrawerProps> = {},
): SessionDrawerProps {
  return {
    activeSessionId: "qa-session-001",
    busy: false,
    indicators: {
      "qa-session-001": { running: false, unread: false },
      "qa-session-002": { running: true, unread: true },
      "qa-session-003": { running: false, unread: false },
      "qa-session-004": { running: false, unread: true },
    },
    onArchive: () => true,
    onArchiveMany: () => true,
    onBindCurrent: () => true,
    onBindIdentifier: () => true,
    onDelete: () => true,
    onDeleteMany: () => true,
    onCreateSession: () => true,
    onOpenArchive: () => undefined,
    onOpenBatch: () => undefined,
    onOpenSessionMode: () => undefined,
    onOpenSettings: () => undefined,
    onOpenTrash: () => undefined,
    onReorder: () => true,
    onRename: () => true,
    onSelect: () => true,
    onTogglePinned: () => true,
    pinnedSessionIds: ["qa-session-001"],
    sessions: makeSessions(),
    ...overrides,
  };
}

/** Insights：segments（6+ 行，含广告）与 summary（长 Markdown）。 */
export function makeSegments(): readonly ArtifactSegment[] {
  const rows = makeSubtitleRows(12);
  return Array.from({ length: 7 }, (_, index) => ({
    detail:
      index === 2
        ? "本段为赞助内容，与节目主题无关，可跳过。"
        : `第 ${index + 1} 段的摘要内容：围绕主题展开的要点说明与结论。`,
    endLineId: rows[index * 2 + 1]?.lineId,
    endMs: (index * 2 + 1) * 3_000,
    isAdvertisement: index === 2,
    startLineId: rows[index * 2]?.lineId,
    startMs: index * 2 * 3_000,
    title:
      index === 2
        ? "广告：赞助商推广"
        : index === 3
          ? "一个特别长的分段标题：关于机器学习模型评估中的交叉验证方法与实践细节的完整讨论"
          : `分段 ${index + 1}：${"内容要点".repeat(index === 5 ? 8 : 1)}`,
    type: index === 2 ? "advertisement" : "content",
  }));
}

export function makeInsightProps(
  kind: ArtifactKind,
  overrides: Partial<InsightWorkspaceProps> = {},
): InsightWorkspaceProps {
  const phase: InsightPhase = "ready";
  return {
    content:
      kind === "summary"
        ? "# 视频总结\n\n本视频介绍了机器学习中偏差与方差的权衡。\n\n## 核心观点\n\n1. 偏差与方差此消彼长\n2. 正则化可以控制复杂度\n3. 数据质量决定上限\n\n> 推荐结合交叉验证实践。\n\n| 方法 | 适用场景 |\n|---|---|\n| L1 | 特征选择 |\n| L2 | 权重压缩 |\n\n更多细节请参考原始视频。"
        : "",
    failure: undefined,
    hasSubtitle: true,
    instruction: "总结视频内容",
    kind,
    onClear: () => undefined,
    onCopyContent: () => undefined,
    onCopyReasoning: () => undefined,
    onExport: () => undefined,
    onGenerate: () => undefined,
    onInstructionChange: () => undefined,
    onLoadRemoteImage: async () => ({ objectUrl: "blob:qa-remote-image" }),
    onManageSummaryPresets: () => undefined,
    onSeek: () => undefined,
    onStop: () => undefined,
    onTaskModelChange: () => undefined,
    phase,
    segments: kind === "segments" ? makeSegments() : [],
    subtitleRows: makeSubtitleRows(8),
    taskModelProfiles: [
      {
        id: "profile-001",
        models: [
          {
            enabled: true,
            id: "model-001",
            label: "deepseek-chat",
            reasoningEfforts: ["low", "medium", "high"],
          },
        ],
        name: "DeepSeek",
      },
    ],
    taskModelSelection: {
      modelId: "model-001",
      profileId: "profile-001",
      reasoningEffort: "medium",
      state: "ready",
    },
    timeLinkScope: {
      activeVideoKey: QA_VIDEO_KEY,
      subtitleVideoKey: QA_VIDEO_KEY,
    },
    updatedAtLabel: "2026/8/11 10:00",
    validatedTimeLinks: [
      { label: "00:12", seconds: 12 },
      { label: "00:45", seconds: 45 },
    ],
    ...overrides,
  };
}
