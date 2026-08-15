/**
 * 备份导入预览呈现：把备份预览数据结构描述为用户可读的说明文案。
 *
 * 深模块：调用方传入 BackupImportPreview，得到完整描述文本；
 * 分组标签、密钥/恢复/冲突的措辞集中在此，UI 不再自行拼接。
 * 分组标签保持与登记文案一致的字面量（docs/i18n-spec.md §3）。
 */
import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import type { BackupGroup, BackupImportPreview } from "../application/backup";

export const BACKUP_IMPORT_GROUP_LABELS: Readonly<Record<BackupGroup, string>> =
  {
    "application-ai": "应用与 AI 配置",
    archive: "归档",
    "batch-archive": "批量归档",
    "batch-trash": "批量回收站",
    "batch-workspace": "批量工作区",
    prompts: "提示词",
    trash: "回收站",
    workspace: "工作区会话",
  };

function statisticCount(
  lang: UiLanguage,
  value:
    | number
    | {
        readonly items: number;
        readonly lists: number;
        readonly subtitles: number;
      },
): string {
  if (typeof value === "number") return String(value);
  return t(lang, "backup.importStatisticDetail", {
    items: value.items,
    lists: value.lists,
    subtitles: value.subtitles,
  });
}

export function describeBackupImportPreview(
  preview: BackupImportPreview,
  lang: UiLanguage = "zh-Hans",
): string {
  const statistics = preview.selectedGroups.map((group) => {
    const value = preview.statistics[group];
    return t(lang, "backup.importStatistic", {
      incoming: statisticCount(lang, value.incoming),
      label: BACKUP_IMPORT_GROUP_LABELS[group],
      replaced: statisticCount(lang, value.replaced),
    });
  });
  if (preview.ignoredBatchTags === true) {
    statistics.push(t(lang, "backup.tagsIgnored"));
  }
  if (preview.includeKeys) {
    statistics.push(t(lang, "backup.importKeys"));
  }
  for (const relocation of preview.relocations ?? []) {
    statistics.push(
      t(lang, "backup.restoreMoveFull", {
        branchCount: relocation.branchCount,
        sessionId: relocation.sessionId,
        source: BACKUP_IMPORT_GROUP_LABELS[relocation.from],
        target: BACKUP_IMPORT_GROUP_LABELS[relocation.to],
      }),
    );
  }
  const conflicts = preview.conflicts.map((conflict) =>
    t(lang, "backup.conflict", {
      code: conflict.code,
      sessionId: conflict.sessionId ? `（${conflict.sessionId}）` : "",
    }),
  );
  return [t(lang, "backup.importSummary"), ...statistics, ...conflicts].join(
    "\n",
  );
}
