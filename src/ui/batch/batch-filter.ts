/**
 * Batch 状态筛选纯投影（Ticket 04：分页语义删除后仅保留筛选）。
 *
 * 分页（page/pageSize/jump/range）已在 Ticket 04 整体删除；状态筛选
 * 只改变 UI 投影，不改数据、不触发 refetch。
 */

export type BatchStatusFilter =
  "all" | "pending" | "succeeded" | "failed" | "cancelled";

export interface BatchStatusCounts {
  readonly all: number;
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
}

interface StatusItem {
  readonly status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
}

export function filterBatchItems<T extends StatusItem>(
  items: readonly T[],
  filter: BatchStatusFilter,
): readonly T[] {
  return filter === "all"
    ? items
    : items.filter((item) => item.status === filter);
}

export function statusFilterCounts<T extends StatusItem>(
  items: readonly T[],
): BatchStatusCounts {
  const counts = {
    all: items.length,
    cancelled: 0,
    failed: 0,
    pending: 0,
    running: 0,
    succeeded: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return Object.freeze(counts);
}
