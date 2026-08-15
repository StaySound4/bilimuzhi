/**
 * Ticket 01 冻结的共享契约（BatchWorkspace 拆分 seam）。
 *
 * 本文件只定义类型契约与冻结常量，不承载最终 UI 实现：
 * - 六种 mode×surface 帮助语境（Ticket 06 消费）；
 * - 生命周期列表 adapter（Ticket 07 消费，Session/Batch 数据严格隔离）；
 * - 列表级选择域与视频行选择域（两个独立命令域，禁止合并）；
 * - 列布局 v2（顺序/可见性/宽度/全文本开关，Ticket 05 消费）；
 * - 时间轴同步状态机（idle/following/seeking + generation/sequence，
 *   Ticket 08 消费，last intent wins）；
 * - 语音语言模式映射（zh/en/other/mixed，Ticket 09 消费）；
 * - 单动作帮助 Dialog 请求（Ticket 06 消费）。
 *
 * 这些契约是后续并行 Lane 的共同边界；改动必须同步所有消费者与测试。
 */
import type { BatchColumnId } from "./batch-column-layout";

/** 帮助语境的 mode 维度：Session 与 Batch 完全隔离。 */
export type BatchHelpMode = "session" | "batch";

/** 帮助语境的 surface 维度：工作区 / 归档区 / 回收站。 */
export type BatchHelpSurface = "workspace" | "archive" | "trash";

/** 六种独立帮助语境（spec §6）。 */
export type BatchHelpContext =
  | "session-workspace"
  | "session-archive"
  | "session-trash"
  | "batch-workspace"
  | "batch-archive"
  | "batch-trash";

export const BATCH_HELP_CONTEXTS: readonly BatchHelpContext[] = Object.freeze([
  "session-workspace",
  "session-archive",
  "session-trash",
  "batch-workspace",
  "batch-archive",
  "batch-trash",
]);

export function batchHelpContext(
  mode: BatchHelpMode,
  surface: BatchHelpSurface,
): BatchHelpContext {
  const value = `${mode}-${surface}`;
  if (!BATCH_HELP_CONTEXTS.includes(value as BatchHelpContext)) {
    throw new Error(`unknown batch help context: ${value}`);
  }
  return value as BatchHelpContext;
}

/** 生命周期列表的 surface（归档 / 回收站）。 */
export type LifecycleSurface = "archive" | "trash";

/** 生命周期列表的数据 kind（Session / Batch，严格隔离）。 */
export type LifecycleKind = "session" | "batch";

/**
 * 选择域契约：列表级选择（侧栏）与视频行选择（右侧表格）是两个独立
 * 命令域；切换域、surface 或 mode 时清空相关临时选择。
 */
export type SelectionDomain =
  { readonly domain: "list" } | { readonly domain: "item" };

export const SELECTION_DOMAINS: readonly SelectionDomain["domain"][] =
  Object.freeze(["list", "item"]);

/**
 * 列布局 v2 契约（spec §5）：
 * - 默认顺序：序号、标题、字幕状态、操作、作者、发布日期、视频身份；
 * - 序号永远第一，不可移动，不可隐藏；
 * - 除序号外其余列可排序；字幕状态、操作不可隐藏；
 * - 标题、作者、发布日期、视频身份可隐藏；
 * - 布局是设备级 UI 偏好，不进入业务备份。
 */
export const DEFAULT_BATCH_COLUMN_ORDER: readonly BatchColumnId[] =
  Object.freeze([
    "index",
    "title",
    "status",
    "actions",
    "author",
    "published",
    "identity",
  ]);

/** 不可隐藏列（序号/字幕状态/操作）。 */
export const NON_HIDABLE_COLUMNS: readonly BatchColumnId[] = Object.freeze([
  "index",
  "status",
  "actions",
]);

/** 可隐藏列（标题/作者/发布日期/视频身份）。 */
export const HIDABLE_COLUMNS: readonly BatchColumnId[] = Object.freeze([
  "title",
  "author",
  "published",
  "identity",
]);

export interface BatchColumnLayoutV2 {
  /** 渲染顺序（index 恒为第一）。 */
  readonly order: readonly BatchColumnId[];
  /** 可见性（仅可隐藏列参与；缺省视为可见）。 */
  readonly visible: Readonly<Partial<Record<BatchColumnId, boolean>>>;
  /** 宽度（px）。 */
  readonly widths: Readonly<Record<BatchColumnId, number>>;
  /** 全文本开关。 */
  readonly forceFullText: boolean;
}

/** v2 布局持久化（chrome.storage.local，设备级 UI 偏好）。 */
export interface BatchColumnLayoutV2Storage {
  load(): Promise<unknown>;
  save(layout: BatchColumnLayoutV2): Promise<void>;
}

/**
 * 时间轴同步状态机契约（spec §9）：
 * idle → following（同步中）→ seeking（播放器跳转中）→ following；
 * generation/sequence 实现 last intent wins：旧采样与旧 seek 结果
 * 不得覆盖最新用户操作；页面 owner 失效时自动回到 idle。
 */
export type TimelineSyncState = "idle" | "following" | "seeking";

export const TIMELINE_SYNC_STATES: readonly TimelineSyncState[] = Object.freeze(
  ["idle", "following", "seeking"],
);

/** 一次同步意图的全局单调代次（防回跳的 last intent wins 依据）。 */
export interface TimelineSyncIntent {
  readonly generation: number;
  readonly sequence: number;
}

export {
  DEFAULT_SPEECH_LANGUAGE_MODE,
  SPEECH_LANGUAGE_MODES,
  SPEECH_PROMPT_POLICY,
  type SpeechPromptMapping,
} from "../../application/speech-prompt-policy";

/** 纯帮助 Dialog 的单动作请求（spec §6：只有一个「关闭」按钮）。 */
export interface SingleActionDialogRequest {
  readonly title: string;
  readonly description?: string;
  readonly closeLabel?: string;
  /** 关闭后回焦的帮助按钮锚点（用于焦点恢复）。 */
  readonly returnFocusTo?: () => void;
}
