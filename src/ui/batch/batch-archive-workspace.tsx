/**
 * BatchArchiveWorkspace — 批量归档区（Ticket 05：批量标签系统整体删除）。
 *
 * 复用 LifecycleList primitive（结构/键盘/ARIA 与 Session 归档一致）：
 * 搜索、多选、恢复、移入回收站、重命名；不再有标签系统与「全部列表」
 * 过滤栏。
 */
import { useState } from "preact/hooks";

import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { AppDialog } from "../dialogs/app-dialog";
import { LifecycleList } from "../primitives/lifecycle-list";
import type { BatchJob } from "../../domain";
import "../archive/archive-workspace.css";

export interface BatchArchiveListView {
  readonly archivedAt: number;
  readonly job: BatchJob;
  readonly order: number;
  readonly pinned: boolean;
}

export type BatchArchiveActionResult = boolean | void | Promise<boolean | void>;

export interface BatchArchiveWorkspaceProps {
  readonly busy?: boolean;
  readonly uiLanguage?: UiLanguage;
  readonly lists: readonly BatchArchiveListView[];
  readonly onRenameList: (
    batchJobId: string,
    name: string,
  ) => BatchArchiveActionResult;
  /** 恢复后保留当前归档/回收站界面并选中该列表；多选恢复只对第一个列表选中。 */
  readonly onRestoreList: (
    batchJobId: string,
    selectAndSwitch?: boolean,
  ) => BatchArchiveActionResult;
  /** 批量恢复/删除：单次调用内处理全部（避免 busy 锁只放行第一个）。 */
  readonly onRestoreMany?: (
    batchJobIds: readonly string[],
  ) => BatchArchiveActionResult;
  readonly onTrashMany?: (
    batchJobIds: readonly string[],
  ) => BatchArchiveActionResult;
  readonly onTrashList: (batchJobId: string) => BatchArchiveActionResult;
  /** 页面标题旁的帮助问号（六语境帮助入口）。 */
  readonly onHelpClick?: () => void;
}

function closeAfterSuccessfulAction(
  action: () => BatchArchiveActionResult,
  close: () => void,
): void {
  try {
    const result = action();
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).then(
        (succeeded) => {
          if (succeeded !== false) close();
        },
        () => undefined,
      );
      return;
    }
    if (result !== false) close();
  } catch {
    // The action owner renders the error.
  }
}

type BatchArchiveDialogState = {
  readonly kind: "rename-list";
  readonly batchJobId: string;
  readonly name: string;
} | null;

export function BatchArchiveWorkspace(props: BatchArchiveWorkspaceProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const [dialog, setDialog] = useState<BatchArchiveDialogState>(null);

  return (
    <section
      aria-label={t(lang, "archive.title")}
      class="archive-workspace muzhi-batch-archive"
    >
      <header class="archive-workspace__header">
        <div class="muzhi-title-help">
          <h2>{t(lang, "batch.archiveTitle")}</h2>
          {props.onHelpClick ? (
            <button
              aria-label={t(lang, "batch.topbarHelpAria")}
              class="muzhi-shell__help"
              onClick={props.onHelpClick}
              title={t(lang, "batch.topbarHelpAria")}
              type="button"
            >
              ?
            </button>
          ) : null}
        </div>
        <p>{t(lang, "batch.archiveHint")}</p>
      </header>

      <LifecycleList
        adapter={{
          actionsAriaKey: "drawer.listActionsAria",
          countKey: "drawer.listCount",
          emptyKey: "batch.archiveEmpty",
          kind: "batch",
          noMatchKey: "drawer.noListMatch",
          purgeLabelKey: null,
          purgeManyLabelKey: null,
          restoreLabelKey: "batch.restoreList",
          restoreManyLabelKey: "batch.restoreMany",
          runningNamesKey: "drawer.runningListNames",
          searchLabelKey: "drawer.searchLists",
          searchPlaceholderKey: "drawer.searchListPlaceholder",
          selectAriaKey: "drawer.selectList",
          selectionAriaKey: "drawer.batchManageListsAria",
          surface: "archive",
          trashLabelKey: "drawer.actionDelete",
          trashManyLabelKey: "batch.trashMany",
        }}
        busy={props.busy}
        items={props.lists}
        matches={(list, query) =>
          (list.job.name ?? list.job.sourceLabel ?? "")
            .toLocaleLowerCase()
            .includes(query)
        }
        onMoveToTrash={(ids) => {
          if (props.onTrashMany !== undefined) {
            closeAfterSuccessfulAction(
              () => props.onTrashMany!(ids),
              () => undefined,
            );
            return;
          }
          for (const id of ids) {
            closeAfterSuccessfulAction(
              () => props.onTrashList(id),
              () => undefined,
            );
          }
        }}
        onRestore={(ids) => {
          // 多选恢复：单次调用（第一个列表被选中，界面保留）。
          if (props.onRestoreMany !== undefined) {
            closeAfterSuccessfulAction(
              () => props.onRestoreMany!(ids),
              () => undefined,
            );
            return;
          }
          for (const [index, id] of ids.entries()) {
            closeAfterSuccessfulAction(
              () => props.onRestoreList(id, index === 0),
              () => undefined,
            );
          }
        }}
        rowMenuExtra={(list) => [
          {
            disabled: props.busy,
            icon: "pencil",
            kind: "item",
            label: t(lang, "drawer.actionRename"),
            onSelect: () =>
              setDialog({
                batchJobId: list.job.batchJobId,
                kind: "rename-list",
                name: list.job.name ?? list.job.sourceLabel ?? "",
              }),
          },
        ]}
        toView={(list) => ({
          id: list.job.batchJobId,
          meta: t(lang, "batch.archivedAt", {
            date: new Date(list.archivedAt).toLocaleDateString(
              lang === "zh-Hans" ? "zh-CN" : lang,
            ),
          }),
          title: list.job.name ?? list.job.sourceLabel ?? "—",
        })}
        uiLanguage={lang}
      />

      {dialog?.kind === "rename-list" ? (
        <AppDialog
          confirmLabel={t(lang, "drawer.confirmAction")}
          defaultValue={dialog.name}
          inputLabel={t(lang, "batch.listRenameLabel")}
          onCancel={() => setDialog(null)}
          onConfirm={(value) => {
            const batchJobId = dialog.batchJobId;
            setDialog(null);
            closeAfterSuccessfulAction(
              () => props.onRenameList(batchJobId, value),
              () => undefined,
            );
          }}
          title={t(lang, "batch.listRenameTitle")}
          uiLanguage={lang}
        />
      ) : null}
    </section>
  );
}
