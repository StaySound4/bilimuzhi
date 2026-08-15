/**
 * 批量结果表列布局模型（Ticket 04 canonical 七列）。
 *
 * - canonical 七列：index/status/title/author/published/identity/actions；
 *   独立语言列已删除，操作列常驻；
 * - 宽度按 columnId 绑定（{columnId -> width}），禁止按持久化数组下标；
 * - 序号/状态 fixed（内容永不省略），其余 flex 列低于 minChars 截断；
 * - 布局持久化到 chrome.storage.local 全局键 muzhi.batch-layout.v1；
 * - 兼容投影：读取旧 v1（含 language、早期含 actions）时忽略 language
 *   宽度，actions 使用其保存宽度，已知 canonical ID 使用其保存宽度；
 *   不自动写回。
 */
export const BATCH_LAYOUT_STORAGE_KEY = "muzhi.batch-layout.v1";

export type BatchColumnId =
  | "index"
  | "status"
  | "title"
  | "author"
  | "published"
  | "identity"
  | "actions";

export interface BatchColumnSpec {
  readonly id: BatchColumnId;
  /** px；可拖动，下限 = minChars 对应宽度。 */
  readonly width: number;
  /** true：内容永不省略（完整显示）；false：可省略、可全文本换行。 */
  readonly fixed: boolean;
  /** 最小字数：下限宽度 = minChars * 12 + 20。 */
  readonly minChars: number;
  /** 全文本开关生效的列才读取。 */
  readonly forceFull: boolean;
}

export interface BatchColumnLayout {
  readonly columns: readonly BatchColumnSpec[];
  /** 表级开关（持久化）：flex 列换行完整显示。 */
  readonly forceFullText: boolean;
}

/** minChars 对应的像素宽度（12px 字号 + 单元格内边距 20px）。 */
export const MIN_CHARS_PX = 12;
const CELL_PADDING_PX = 20;
export const MAX_COLUMN_WIDTH = 560;

export function minColumnWidth(column: BatchColumnSpec): number {
  return column.minChars * MIN_CHARS_PX + CELL_PADDING_PX;
}

/** canonical 七列（含顺序与默认宽度）。 */
export const CANONICAL_COLUMN_IDS: readonly BatchColumnId[] = Object.freeze([
  "index",
  "status",
  "title",
  "author",
  "published",
  "identity",
  "actions",
]);

export function defaultBatchColumnLayout(): BatchColumnLayout {
  return Object.freeze({
    columns: Object.freeze([
      Object.freeze({
        fixed: true,
        forceFull: true,
        id: "index",
        minChars: 3,
        width: 64,
      }),
      Object.freeze({
        fixed: true,
        forceFull: true,
        id: "status",
        minChars: 12,
        width: 220,
      }),
      Object.freeze({
        fixed: false,
        forceFull: true,
        id: "title",
        minChars: 8,
        width: 360,
      }),
      Object.freeze({
        fixed: false,
        forceFull: true,
        id: "author",
        minChars: 4,
        width: 140,
      }),
      Object.freeze({
        fixed: false,
        forceFull: true,
        id: "published",
        minChars: 6,
        width: 140,
      }),
      Object.freeze({
        fixed: false,
        forceFull: true,
        id: "identity",
        minChars: 8,
        width: 200,
      }),
      Object.freeze({
        fixed: true,
        forceFull: true,
        id: "actions",
        minChars: 4,
        width: 120,
      }),
    ]),
    forceFullText: false,
  });
}

/** 旧 v1 布局的合法 ID（含已删除的 language，仅用于兼容投影）。 */
const LEGACY_COLUMN_IDS: readonly string[] = Object.freeze([
  "index",
  "status",
  "actions",
  "language",
  "title",
  "author",
  "published",
  "identity",
]);

function isLegacyColumnId(id: string): boolean {
  return LEGACY_COLUMN_IDS.includes(id);
}

function parseColumnSpec(value: unknown): BatchColumnSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<BatchColumnSpec>;
  const id = candidate.id;
  if (typeof id !== "string" || !isLegacyColumnId(id)) return null;
  if (
    typeof candidate.width !== "number" ||
    !Number.isFinite(candidate.width)
  ) {
    return null;
  }
  if (typeof candidate.fixed !== "boolean") return null;
  if (typeof candidate.minChars !== "number" || candidate.minChars < 0) {
    return null;
  }
  if (typeof candidate.forceFull !== "boolean") return null;
  return Object.freeze({
    fixed: candidate.fixed,
    forceFull: candidate.forceFull,
    id: id as BatchColumnId,
    minChars: candidate.minChars,
    width: Math.max(1, Math.round(candidate.width)),
  });
}

/** 已知 canonical ID 的默认 spec（用于旧布局缺失列的补全）。 */
function defaultSpecFor(id: BatchColumnId): BatchColumnSpec {
  const found = defaultBatchColumnLayout().columns.find(
    (column) => column.id === id,
  );
  if (found === undefined) {
    throw new Error(`unknown canonical column: ${id}`);
  }
  return found;
}

/**
 * 持久化 v1 值校验与兼容投影。
 *
 * - 必须为对象且 columns 为非空数组；
 * - 每列必须可解析且 ID 唯一（含 legacy ID）；
 * - 投影：language 忽略（旧宽度不参与）；actions 使用保存宽度；
 *   其余 canonical ID 使用其保存宽度；输出恒为 canonical 七列；
 * - 不写回、不强制迁移：调用方仅在用户主动 resize/toggle 时保存。
 */
export function parseBatchColumnLayout(
  value: unknown,
): BatchColumnLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<BatchColumnLayout>;
  if (!Array.isArray(candidate.columns) || candidate.columns.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  const widths = new Map<BatchColumnId, number>();
  for (const entry of candidate.columns) {
    const column = parseColumnSpec(entry);
    if (column === null || seen.has(column.id)) return null;
    seen.add(column.id);
    if (CANONICAL_COLUMN_IDS.includes(column.id as BatchColumnId)) {
      widths.set(column.id as BatchColumnId, column.width);
    }
    // language 等非 canonical legacy ID：忽略其宽度（不参与投影）。
    // actions 是 canonical ID，其保存宽度会被投影保留。
  }
  if (typeof candidate.forceFullText !== "boolean") return null;
  const columns = CANONICAL_COLUMN_IDS.map((id) => {
    const width = widths.get(id);
    const spec = defaultSpecFor(id);
    return width === undefined ? spec : Object.freeze({ ...spec, width });
  });
  return Object.freeze({
    columns: Object.freeze(columns),
    forceFullText: candidate.forceFullText,
  });
}

/**
 * 拖动后的布局：只改变 columnId 列宽度并夹取到 [minChars 保底, MAX]，
 * 其余列保持原宽；宽度按 columnId 绑定（不依赖数组下标）。
 */
export function resizeBatchColumn(
  layout: BatchColumnLayout,
  columnId: BatchColumnId,
  width: number,
): BatchColumnLayout {
  const column = layout.columns.find((candidate) => candidate.id === columnId);
  if (column === undefined) return layout;
  const clamped = Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(minColumnWidth(column), Math.round(width)),
  );
  if (clamped === column.width) return layout;
  return Object.freeze({
    columns: Object.freeze(
      layout.columns.map((candidate) =>
        candidate.id === columnId
          ? Object.freeze({ ...candidate, width: clamped })
          : candidate,
      ),
    ),
    forceFullText: layout.forceFullText,
  });
}

export function toggleForceFullText(
  layout: BatchColumnLayout,
): BatchColumnLayout {
  return Object.freeze({
    columns: layout.columns,
    forceFullText: !layout.forceFullText,
  });
}

/** 表格总宽度（px）：各列宽度之和。 */
export function batchTableWidth(layout: BatchColumnLayout): number {
  return layout.columns.reduce((total, column) => total + column.width, 0);
}

export interface BatchLayoutStorage {
  load(): Promise<unknown>;
  save(layout: BatchColumnLayout): Promise<void>;
}

/** 扩展运行时的最小 chrome.storage.local 形状（项目未依赖 @types/chrome）。 */
declare const chrome:
  | {
      readonly storage?: {
        readonly local?: {
          get(key: string): Promise<Record<string, unknown>>;
          set(items: Record<string, unknown>): Promise<void>;
        };
      };
    }
  | undefined;

/** 生产默认：chrome.storage.local 全局键；非扩展环境（组件测试）静默跳过。 */
export const defaultBatchLayoutStorage: BatchLayoutStorage = Object.freeze({
  async load(): Promise<unknown> {
    if (typeof chrome === "undefined" || chrome.storage?.local === undefined) {
      return null;
    }
    return (await chrome.storage.local.get(BATCH_LAYOUT_STORAGE_KEY))[
      BATCH_LAYOUT_STORAGE_KEY
    ];
  },
  async save(layout: BatchColumnLayout): Promise<void> {
    if (typeof chrome === "undefined" || chrome.storage?.local === undefined) {
      return;
    }
    await chrome.storage.local.set({
      [BATCH_LAYOUT_STORAGE_KEY]: layout,
    });
  },
});
