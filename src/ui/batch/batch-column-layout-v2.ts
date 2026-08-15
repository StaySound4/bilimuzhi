/**
 * 批量列布局 v2（Ticket 05）：顺序 / 可见性 / 宽度 / 全文本开关。
 *
 * - 默认顺序：序号、标题、字幕状态、操作、作者、发布日期、视频身份；
 *   序号永远第一，不可移动，不可隐藏；
 * - 除序号外其余列可排序；字幕状态、操作不可隐藏；
 *   标题/作者/发布日期/视频身份可隐藏；
 * - 布局是设备级 UI 偏好（chrome.storage.local），不进入业务备份；
 * - 旧 v1 布局（muzhi.batch-layout.v1，含已删除 language 列）安全迁移。
 */
import { parseBatchColumnLayout } from "./batch-column-layout";
import type { BatchColumnId } from "./batch-column-layout";
import {
  DEFAULT_BATCH_COLUMN_ORDER,
  HIDABLE_COLUMNS,
  NON_HIDABLE_COLUMNS,
  type BatchColumnLayoutV2,
  type BatchColumnLayoutV2Storage,
} from "./batch-contracts";

export type {
  BatchColumnLayoutV2,
  BatchColumnLayoutV2Storage,
} from "./batch-contracts";

export const BATCH_LAYOUT_V2_STORAGE_KEY = "muzhi.batch-layout.v2";
export const BATCH_LAYOUT_V1_STORAGE_KEY = "muzhi.batch-layout.v1";

export const CANONICAL_COLUMN_IDS_V2: readonly string[] = Object.freeze([
  ...DEFAULT_BATCH_COLUMN_ORDER,
]);

/** 每列最小宽度（px）。状态/操作列按四语言最宽内容量测（Ticket 03）：
 * 操作列=2 图标按钮横排（30px×2 + 1×4px gap + td padding 20px ≈ 84），
 * 预留第 3 图标位（settings/download/trash 全部入口）取 118px；
 * 状态列=四语言最宽徽标自然宽（en "Has official subtitle · 轨道名"
 * 203px）+ td padding 20px ≈ 228（badge 可换行，但最小宽度保证完整
 * 单行显示）。量测工具：Playwright + QA harness 真实浏览器（t03-width/
 * final-probe），非 jsdom。 */
export const MIN_COLUMN_WIDTH_V2: Readonly<Record<string, number>> =
  Object.freeze({
    actions: 118,
    author: 68,
    identity: 116,
    index: 56,
    published: 92,
    status: 228,
    title: 116,
  });

export const MAX_COLUMN_WIDTH_V2 = 560;

const DEFAULT_WIDTHS_V2: Readonly<Record<BatchColumnId, number>> =
  Object.freeze({
    actions: 120,
    author: 140,
    identity: 200,
    index: 64,
    published: 140,
    status: 240,
    title: 360,
  });

export function defaultBatchColumnLayoutV2(): BatchColumnLayoutV2 {
  const widths: Record<BatchColumnId, number> = { ...DEFAULT_WIDTHS_V2 };
  return Object.freeze({
    forceFullText: false,
    order: Object.freeze([...DEFAULT_BATCH_COLUMN_ORDER]),
    visible: Object.freeze({}),
    widths: Object.freeze(widths),
  });
}

function isCanonicalColumnId(id: string): boolean {
  return CANONICAL_COLUMN_IDS_V2.includes(id);
}

export function minColumnWidthV2(columnId: BatchColumnId): number {
  return MIN_COLUMN_WIDTH_V2[columnId] ?? MIN_COLUMN_WIDTH_V2.title;
}

/**
 * v2 持久化值校验：
 * - order 必须 7 列、序号恒第一、无重复、全为 canonical ID；
 * - visible 只允许 boolean，且不可把序号/状态/操作设为 false；
 * - widths 必须 7 列齐全、有限且 ≥ 各自最小宽度；
 * - forceFullText 必须 boolean。
 */
export function parseBatchColumnLayoutV2(
  value: unknown,
): BatchColumnLayoutV2 | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<BatchColumnLayoutV2>;
  if (!Array.isArray(candidate.order)) return null;
  if (candidate.order.length !== CANONICAL_COLUMN_IDS_V2.length) return null;
  if (candidate.order[0] !== "index") return null;
  if (new Set(candidate.order).size !== candidate.order.length) return null;
  if (!candidate.order.every(isCanonicalColumnId)) return null;

  const visible: Record<string, boolean> = {};
  if (candidate.visible !== undefined) {
    if (typeof candidate.visible !== "object" || candidate.visible === null) {
      return null;
    }
    for (const [id, flag] of Object.entries(candidate.visible)) {
      if (!isCanonicalColumnId(id)) return null;
      if (typeof flag !== "boolean") return null;
      if (flag === false && NON_HIDABLE_COLUMNS.includes(id as never)) {
        return null;
      }
      visible[id] = flag;
    }
  }

  if (typeof candidate.widths !== "object" || candidate.widths === null) {
    return null;
  }
  const widths: Record<string, number> = {};
  for (const id of CANONICAL_COLUMN_IDS_V2) {
    const columnId = id as BatchColumnId;
    const width = (candidate.widths as Record<string, unknown>)[id];
    if (typeof width !== "number" || !Number.isFinite(width)) return null;
    if (width < minColumnWidthV2(columnId) || width > MAX_COLUMN_WIDTH_V2) {
      return null;
    }
    widths[id] = Math.round(width);
  }
  if (typeof candidate.forceFullText !== "boolean") return null;

  return Object.freeze({
    forceFullText: candidate.forceFullText,
    order: Object.freeze([...candidate.order]),
    visible: Object.freeze(visible),
    widths: Object.freeze(widths),
  });
}

/**
 * 旧 v1 布局安全迁移：v1 校验通过时保留保存宽度与全文本开关，
 * 顺序/可见性取默认；含已删除 language 列时忽略其宽度。
 */
export function migrateBatchColumnLayoutV1(
  value: unknown,
): BatchColumnLayoutV2 {
  const base = defaultBatchColumnLayoutV2();
  const v1 = parseBatchColumnLayout(value);
  if (v1 === null) return base;
  const widths: Record<BatchColumnId, number> = { ...base.widths };
  for (const column of v1.columns) {
    if (isCanonicalColumnId(column.id)) {
      widths[column.id] = Math.min(
        MAX_COLUMN_WIDTH_V2,
        Math.max(minColumnWidthV2(column.id), column.width),
      );
    }
  }
  return Object.freeze({
    forceFullText: v1.forceFullText,
    order: base.order,
    visible: base.visible,
    widths: Object.freeze(widths),
  });
}

/** 移动列（delta 格）；序号不可移动，越界夹取。 */
export function moveColumnV2(
  layout: BatchColumnLayoutV2,
  columnId: BatchColumnId,
  delta: number,
): BatchColumnLayoutV2 {
  if (columnId === "index" || delta === 0) return layout;
  const current = [...layout.order];
  const from = current.indexOf(columnId);
  if (from < 0) return layout;
  const to = Math.min(current.length - 1, Math.max(1, from + delta));
  if (to === from) return layout;
  current.splice(from, 1);
  current.splice(to, 0, columnId);
  return Object.freeze({
    ...layout,
    order: Object.freeze(current),
  });
}

/** 按给定顺序重排（强制序号第一、去重、补齐缺失列）。 */
export function reorderBatchColumnV2(
  layout: BatchColumnLayoutV2,
  order: readonly string[],
): BatchColumnLayoutV2 {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (isCanonicalColumnId(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  for (const id of CANONICAL_COLUMN_IDS_V2) {
    if (!seen.has(id)) next.push(id);
  }
  const withIndexFirst: BatchColumnId[] = [
    "index",
    ...(next.filter((id) => id !== "index") as BatchColumnId[]),
  ];
  return Object.freeze({ ...layout, order: Object.freeze(withIndexFirst) });
}

/** 切换列可见性；不可隐藏列（序号/状态/操作）保持不变。 */
export function toggleColumnVisibilityV2(
  layout: BatchColumnLayoutV2,
  columnId: BatchColumnId,
): BatchColumnLayoutV2 {
  if (!HIDABLE_COLUMNS.includes(columnId)) return layout;
  const current = layout.visible[columnId] !== false;
  const visible = { ...layout.visible };
  if (current) visible[columnId] = false;
  else delete visible[columnId];
  return Object.freeze({ ...layout, visible: Object.freeze(visible) });
}

/** 设置列宽（夹取到 [最小宽度, MAX]，状态/操作列不可突破分隔线）。 */
export function setColumnWidthV2(
  layout: BatchColumnLayoutV2,
  columnId: BatchColumnId,
  width: number,
): BatchColumnLayoutV2 {
  const clamped = Math.min(
    MAX_COLUMN_WIDTH_V2,
    Math.max(minColumnWidthV2(columnId), Math.round(width)),
  );
  if (clamped === layout.widths[columnId]) return layout;
  return Object.freeze({
    ...layout,
    widths: Object.freeze({ ...layout.widths, [columnId]: clamped }),
  });
}

/** 全文本开关切换。 */
export function toggleForceFullTextV2(
  layout: BatchColumnLayoutV2,
): BatchColumnLayoutV2 {
  return Object.freeze({ ...layout, forceFullText: !layout.forceFullText });
}

/** 表格总宽度（可见列宽度之和）。 */
export function batchTableWidthV2(layout: BatchColumnLayoutV2): number {
  return layout.order
    .filter((id) => layout.visible[id] !== false)
    .reduce((total, id) => total + layout.widths[id], 0);
}

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

/** 生产默认：chrome.storage.local v2 键；组件测试注入内存实现。 */
export const defaultBatchColumnLayoutV2Storage: BatchColumnLayoutV2Storage =
  Object.freeze({
    async load(): Promise<unknown> {
      if (
        typeof chrome === "undefined" ||
        chrome.storage?.local === undefined
      ) {
        return null;
      }
      const stored = await chrome.storage.local.get(
        BATCH_LAYOUT_V2_STORAGE_KEY,
      );
      return stored[BATCH_LAYOUT_V2_STORAGE_KEY] ?? null;
    },
    async save(layout: BatchColumnLayoutV2): Promise<void> {
      if (
        typeof chrome === "undefined" ||
        chrome.storage?.local === undefined
      ) {
        return;
      }
      await chrome.storage.local.set({
        [BATCH_LAYOUT_V2_STORAGE_KEY]: layout,
      });
    },
  });
