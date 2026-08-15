import type { TrashPermanentDeletionPreview } from "../../infrastructure/indexeddb/trash-repository";
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";

/**
 * 永久删除确认文案：去重后的字幕记录/会话数量与不可撤销提示。
 * 回收站条目进站时任务已终止，因此文案不再提及运行中任务。
 * 纯函数，独立于 UI 渲染，便于行为测试。
 */
export function trashDeletionDescription(
  preview: TrashPermanentDeletionPreview,
  lang: UiLanguage = "zh-Hans",
): string {
  const counts =
    preview.branchCount === 0
      ? t(lang, "trash.deletePreviewSessions", {
          count: preview.sessionCount,
        })
      : t(lang, "trash.deletePreviewBranches", {
          count: preview.branchCount,
        }) +
        (preview.sessionCount > 0
          ? t(lang, "trash.deletePreviewSessionsInvolved", {
              count: preview.sessionCount,
            })
          : "");
  return t(lang, "trash.deletePreviewIrreversible", { counts });
}
