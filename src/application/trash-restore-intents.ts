/**
 * 回收站恢复意图解析：恢复语义已统一为「一律恢复到工作区」，
 * 不再区分来源（归档来源回归档/原目录），也不再弹出目标选择器。
 * 空会话（尚未获取字幕）与分支一起恢复到工作区。
 */

export type TrashRestoreBranchIntent = {
  readonly branchId: string;
  readonly kind: "branch";
  readonly originKind: "archive" | "workspace";
};

export type TrashRestoreSessionIntent = {
  readonly kind: "session";
  readonly sessionId: string;
};

export type TrashRestoreIntent =
  TrashRestoreBranchIntent | TrashRestoreSessionIntent;

export interface ResolvedTrashRestoreIntents {
  readonly branchIds: readonly string[];
  readonly emptySessionIds: readonly string[];
}

export function resolveTrashRestoreIntents(
  items: readonly TrashRestoreIntent[],
): ResolvedTrashRestoreIntents {
  const branchIds: string[] = [];
  const emptySessionIds: string[] = [];
  for (const item of items) {
    if (item.kind === "branch") {
      branchIds.push(item.branchId);
    } else {
      emptySessionIds.push(item.sessionId);
    }
  }
  return Object.freeze({
    branchIds: Object.freeze(branchIds),
    emptySessionIds: Object.freeze(emptySessionIds),
  });
}
