import type { BatchStatusFilter } from "./batch-filter";

export interface FrozenBatchActionScope {
  readonly filter: BatchStatusFilter;
  readonly itemIds: readonly string[];
}

export function freezeBatchActionScope(
  filter: BatchStatusFilter,
  itemIds: readonly string[],
): FrozenBatchActionScope {
  return Object.freeze({
    filter,
    itemIds: Object.freeze([...itemIds]),
  });
}
