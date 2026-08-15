/**
 * Batch surface 的 QA fixture 工厂（仅 QA build 引入）。
 * 数据全部为非敏感、固定 seed 的内存投影；handler 为记录型 spy，不产生副作用。
 */
import type { BatchItem, BatchJob } from "../../domain/batch";
import type { BatchJobView } from "../../application/batch-runtime";
import type {
  BatchWorkspaceProps,
  BatchJobSummary,
} from "../../ui/batch/batch-workspace";
import type { BatchColumnLayoutV2Storage } from "../../ui/batch/batch-column-layout-v2";
import type { BatchDrawerProps } from "../../ui/batch/batch-drawer";
import type { BatchArchiveWorkspaceProps } from "../../ui/batch/batch-archive-workspace";
import type { BatchTrashWorkspaceProps } from "../../ui/batch/batch-trash-workspace";
import type { QaTheme } from "../types";

export interface BatchFixtureOptions {
  readonly count: number;
  /** 不投影活动列表（无列表空态）；缺省投影。 */
  readonly withView?: boolean;
  readonly jobStatus?: BatchJob["status"];
  /** 状态分布：[pending, running, succeeded, failed, cancelled] 数量。 */
  readonly distribution?: readonly [number, number, number, number, number];
  readonly selectedCount?: number;
  readonly overwriteCount?: number;
  readonly titlePrefix?: string;
}

const BVIDS = [
  "BV1zt4y1z72D",
  "BV1GJ411x7h7",
  "BV1Wv411h7kN",
  "BV1mK4y1C7Bz",
  "BV1bW411n7fP",
  "BV1Q5411h7XX",
  "BV1Y4411Q7xU",
  "BV1JE411g7QX",
  "BV1z4411U7G7",
  "BV1K4411k7Vo",
  "BV1C7411k7wV",
  "BV1F4411m7XK",
  "BV1B4411H7cz",
  "BV1n4411k7X1",
  "BV1e4411u7CB",
  "BV1s4411m7kz",
  "BV1L4411m7NQ",
  "BV1T4411m7bV",
  "BV1zE411H7mC",
  "BV1g4411P7pG",
  "BV1o4411K7CQ",
  "BV1y4411T7Gm",
  "BV1x4411U7XY",
  "BV1w4411K7Fw",
  "BV1k4411J7Wp",
];

const TITLES = [
  "为什么机器学习模型会失效：偏差与方差详解",
  "线性代数的本质——从向量到特征值",
  "用 Python 实现一个编译器：词法分析实战",
  "关于时间序列预测你必须知道的五件事",
  "概率论入门：贝叶斯定理的直觉理解",
  "数据结构与算法：平衡二叉树的插入与删除",
  "操作系统导论：进程与线程的区别",
  "计算机网络：TCP 三次握手与四次挥手",
  "深入理解 JavaScript 事件循环机制",
  "数据库索引原理：B+ 树为什么快",
  "机器学习中的正则化：L1 与 L2 的几何意义",
  "从零实现反向传播：手写神经网络",
  "分布式系统一致性：从 Paxos 到 Raft",
  "编译原理：语法分析中的 LL 与 LR 算法",
  "图神经网络入门：从谱方法到消息传递",
  "强化学习基础：马尔可夫决策过程",
  "密码学基础：对称加密与非对称加密",
  "软件工程实践：如何写出可维护的代码",
  "计算机组成原理：流水线冒险与处理",
  "概率图模型：隐马尔可夫模型详解",
  "自然语言处理：Transformer 注意力机制",
  "优化算法：梯度下降的变体与收敛性",
  "量子计算导论：qubit 与量子门",
  "微积分复习：泰勒展开与级数收敛",
  "人工智能安全：对抗样本攻击与防御",
];

const AUTHORS = [
  "哔哩哔哩大学堂",
  "技术宅的日常",
  "极客实验室",
  "编码的艺术",
  "算法食堂",
  "计算机科学漫游",
  "AI 观察站",
  "编程思维训练营",
];

const SEED_DATE = 1_752_729_600_000; // 2026-08-11 附近固定时钟

function makeBatchItem(
  index: number,
  job: BatchJob,
  status: BatchItem["status"],
  opts: BatchFixtureOptions,
): BatchItem {
  const bvid = BVIDS[index % BVIDS.length];
  const rowCount = status === "succeeded" ? 40 + (index % 60) : 0;
  const selected = index < (opts.selectedCount ?? 0);
  return {
    acquisitionMethod: status === "pending" ? null : "direct",
    author: AUTHORS[index % AUTHORS.length],
    availableTracks:
      status === "pending"
        ? []
        : [
            {
              language: "zh",
              name: "中文（官方）",
              origin: "official-cc",
              source: "official",
              trackId: "track-zh-official",
            },
            {
              language: "zh",
              name: "中文（AI）",
              origin: "ai",
              source: "ai",
              trackId: "track-zh-ai",
            },
          ],
    batchItemId: `batch-item-${job.batchJobId}-${index}`,
    batchJobId: job.batchJobId,
    bvid,
    cid: 30000000000 + index,
    errorCode: status === "failed" ? "SUBTITLE_NOT_FOUND" : null,
    order: index,
    page: (index % 3) + 1,
    progress:
      status === "running"
        ? { completed: 30 + (index % 60), stage: "请求字幕", total: 100 }
        : null,
    publishedAt: SEED_DATE - (index % 90) * 86_400_000,
    rowCount,
    selected,
    selectedLanguage: status === "pending" ? "zh" : null,
    selectedTrackId: status === "succeeded" ? "track-zh-official" : null,
    speechOwner: null,
    status,
    title: `${TITLES[index % TITLES.length]}（第 ${(index % 3) + 1} 部分）`,
    trackId: status === "pending" ? null : "track-zh-official",
    tracksDiscovered: status !== "pending",
    retryable: status === "failed",
    updatedAt: SEED_DATE - index * 60_000,
    videoKey: `bvid:${bvid}:cid:${30000000000 + index}:p:${(index % 3) + 1}`,
  };
}

/** 构造 BatchJobView（items + job + overwriteCount）。 */
export function makeBatchJobView(opts: BatchFixtureOptions): BatchJobView {
  const job: BatchJob = {
    batchJobId: "qa-job-001",
    browserSessionId: "qa-browser-session",
    method: "direct",
    sourceKind: "collection",
    sourceLabel: "测试合集·第 1 部分",
    status: opts.jobStatus ?? "ready",
    createdAt: SEED_DATE - 3_600_000,
    updatedAt: SEED_DATE - 60_000,
  };
  const [pending, running, succeeded, failed, cancelled] =
    opts.distribution ?? [4, 3, 9, 3, 1];
  const statuses: BatchItem["status"][] = [
    ...Array.from({ length: pending }, () => "pending" as const),
    ...Array.from({ length: running }, () => "running" as const),
    ...Array.from({ length: succeeded }, () => "succeeded" as const),
    ...Array.from({ length: failed }, () => "failed" as const),
    ...Array.from({ length: cancelled }, () => "cancelled" as const),
  ];
  // 保证恰好 count 个（截断/补齐为 pending）。
  const items = Array.from({ length: opts.count }, (_, index) =>
    makeBatchItem(index, job, statuses[index] ?? "pending", opts),
  );
  return {
    items,
    job,
    overwriteCount: opts.overwriteCount ?? 0,
    progress:
      job.status === "running"
        ? { completed: 8, stage: "获取字幕", total: opts.count }
        : undefined,
  };
}

/** 内存布局存储（不写 chrome.storage）。 */
export const qaBatchLayoutStorage: BatchColumnLayoutV2Storage = Object.freeze({
  async load() {
    return null;
  },
  async save() {
    // QA harness 不持久化布局。
  },
});

export function makeJobSummary(job: BatchJob, index = 0): BatchJobSummary {
  return {
    createdAtLabel: "2026/8/11 10:00",
    id: job.batchJobId,
    label: `测试任务 ${index + 1}`,
    pinned: false,
    status: job.status,
  };
}

/** 记录型 spy 集合（handler 签名与生产 props 一致，记录调用但不产生副作用）。 */
export function makeBatchSpies(): {
  readonly calls: string[];
  readonly props: Omit<
    BatchWorkspaceProps,
    "includeAllPages" | "input" | "hasLists" | "layoutStorage" | "view"
  >;
} {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(name);
      void args;
    };
  return {
    calls,
    props: {
      busy: false,
      onCancel: record("onCancel"),
      onExport: record("onExport"),
      onIncludeAllPagesChange: record("onIncludeAllPagesChange"),
      onInputChange: record("onInputChange"),
      onRefetchTrack: record("onRefetchTrack"),
      onItemSpeechLanguageChange: record("onItemSpeechLanguageChange"),
      onSpeechRoutingModeChange: record("onSpeechRoutingModeChange"),
      speechConfigured: true,
      speechLanguageMode: "mixed",
      speechRoutingMode: "balanced",
      onClearItem: record("onClearItem"),
      onDeleteItems: record("onDeleteItems"),
      onLanguagePreferenceChange: record("onLanguagePreferenceChange"),
      onPrepare: record("onPrepare"),
      onSelectionChange: record("onSelectionChange"),
      onSingleVideoPageSelectionChange: record(
        "onSingleVideoPageSelectionChange",
      ),
      onSourceKindChange: record("onSourceKindChange"),
      onStart: record("onStart"),
      onFetchByCurrentPage: record("onFetchByCurrentPage"),
      preparing: false,
      sourceKind: "single-video",
    },
  };
}

/** 构造批量侧栏 props（与 workspace 共享同一 job 的投影）。 */
export function makeBatchDrawerProps(
  activeListId: string | null,
): BatchDrawerProps {
  const job = makeBatchJobView({ count: 1 });
  return {
    activeListId,
    busy: false,
    lists: [
      {
        createdAtLabel: "2026/8/11 10:00",
        id: job.job.batchJobId,
        label: "测试任务 1",
        pinned: false,
        running: false,
        status: job.job.status,
      },
    ],
    onArchive: () => undefined,
    onDelete: () => undefined,
    onCreateList: () => undefined,
    onRename: () => undefined,
    onSelect: () => undefined,
    onTogglePinned: () => undefined,
  };
}

/** 构造完整 BatchWorkspaceProps（供 AiChatShell 消费）。 */
/** Batch 归档区投影（非敏感固定 seed；handler 为记录型 spy）。 */
export function makeBatchArchiveProps(
  theme: QaTheme,
  opts: BatchFixtureOptions,
): BatchArchiveWorkspaceProps {
  const job = makeBatchJobView(opts).job;
  return {
    lists: [
      {
        archivedAt: SEED_DATE - 86_400_000,
        job,
        order: 1,
        pinned: false,
      },
    ],
    onRenameList: () => true,
    onRestoreList: () => true,
    onTrashList: () => true,
    uiLanguage: "zh-Hans",
  };
}

/** Batch 回收站投影（非敏感固定 seed；handler 为记录型 spy）。 */
export function makeBatchTrashProps(
  theme: QaTheme,
  opts: BatchFixtureOptions,
): BatchTrashWorkspaceProps {
  const job = makeBatchJobView(opts).job;
  return {
    applyRetentionTo: "future",
    customRetentionDays: "7",
    lists: [
      {
        deletionReason: "user",
        job,
        order: 1,
        pinned: false,
        purgeAfter: SEED_DATE + 6 * 86_400_000,
        retentionStartedAt: SEED_DATE,
        trashedAt: SEED_DATE,
        trashOrigin: "workspace",
      },
    ],
    onEmptyTrash: () => true,
    onPurgeList: () => true,
    onRestoreList: () => true,
    onRetentionChange: () => true,
    retention: "7",
    uiLanguage: "zh-Hans",
  };
}

export function makeBatchWorkspaceProps(
  theme: QaTheme,
  opts: BatchFixtureOptions,
): BatchWorkspaceProps {
  const spies = makeBatchSpies();
  if (opts.withView === false) {
    return {
      ...spies.props,
      includeAllPages: false,
      input: "",
      hasLists: false,
      layoutStorage: qaBatchLayoutStorage,
      uiLanguage: "zh-Hans",
    };
  }
  const view = makeBatchJobView(opts);
  return {
    ...spies.props,
    includeAllPages: false,
    input: "",
    hasLists: true,
    layoutStorage: qaBatchLayoutStorage,
    uiLanguage: "zh-Hans",
    view,
  };
}
