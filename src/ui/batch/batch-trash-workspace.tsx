import { useEffect, useState } from "preact/hooks";

import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { AppDialog } from "../dialogs/app-dialog";
import { LifecycleList } from "../primitives/lifecycle-list";
import type { BatchJob } from "../../domain";
import type { RetentionChange, RetentionChoice } from "../retention";
import "../trash/trash-workspace.css";

export interface BatchTrashListView {
  readonly deletionReason: string;
  readonly job: BatchJob;
  readonly order: number;
  readonly pinned: boolean;
  readonly purgeAfter: number | null;
  readonly retentionStartedAt: number;
  readonly trashedAt: number;
  readonly trashOrigin: "workspace" | "archive";
}

export type BatchTrashActionResult = boolean | void | Promise<boolean | void>;

export interface BatchTrashWorkspaceProps {
  readonly applyRetentionTo: "existing" | "future";
  readonly busy?: boolean;
  readonly customRetentionDays: string;
  readonly uiLanguage?: UiLanguage;
  readonly lists: readonly BatchTrashListView[];
  readonly onRetentionChange: (
    value: RetentionChange,
  ) => BatchTrashActionResult;
  /** 恢复后保留当前归档/回收站界面并选中该列表；多选恢复只对第一个列表选中。 */
  readonly onRestoreList: (
    batchJobId: string,
    selectAndSwitch?: boolean,
  ) => BatchTrashActionResult;
  /** 批量恢复/永久删除：单次调用内处理全部（避免 busy 锁只放行第一个）。 */
  readonly onRestoreMany?: (
    batchJobIds: readonly string[],
  ) => BatchTrashActionResult;
  readonly onPurgeMany?: (
    batchJobIds: readonly string[],
  ) => BatchTrashActionResult;
  readonly onPurgeList: (batchJobId: string) => BatchTrashActionResult;
  readonly onEmptyTrash: () => BatchTrashActionResult;
  readonly retention: RetentionChoice;
  /** 页面标题旁的帮助问号（六语境帮助入口）。 */
  readonly onHelpClick?: () => void;
}

function closeAfterSuccessfulAction(
  action: () => BatchTrashActionResult,
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

type BatchTrashDialogState =
  | { readonly kind: "confirm-purge"; readonly batchJobId: string }
  | { readonly kind: "confirm-empty" };

function retentionLabel(
  lang: UiLanguage,
  value: RetentionChoice,
  customDays: string,
): string {
  if (value === "forever") return t(lang, "trash.foreverLabel");
  if (value === "custom")
    return t(lang, "trash.days", {
      count: customDays || t(lang, "trash.customLabel"),
    });
  return t(lang, "trash.days", { count: Number(value) });
}

export function BatchTrashWorkspace(props: BatchTrashWorkspaceProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const [dialog, setDialog] = useState<BatchTrashDialogState | null>(null);
  const [retentionDraft, setRetentionDraft] = useState(props.retention);
  const [customDaysDraft, setCustomDaysDraft] = useState(
    props.customRetentionDays,
  );
  const [applyToDraft, setApplyToDraft] = useState(props.applyRetentionTo);
  useEffect(() => setRetentionDraft(props.retention), [props.retention]);
  useEffect(
    () => setCustomDaysDraft(props.customRetentionDays),
    [props.customRetentionDays],
  );

  return (
    <section
      aria-label={t(lang, "trash.title")}
      class="trash-workspace muzhi-batch-trash"
    >
      <header class="trash-workspace__header">
        <div class="muzhi-title-help">
          <h2>{t(lang, "batch.trashTitle")}</h2>
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
        <p>{t(lang, "batch.trashHint")}</p>
        {props.lists.length > 0 ? (
          <button
            class="muzhi-button"
            disabled={props.busy}
            onClick={() => setDialog({ kind: "confirm-empty" })}
            type="button"
          >
            {t(lang, "trash.empty")}
          </button>
        ) : null}
      </header>

      <details className="muzhi-trash__retention">
        <summary>
          {t(lang, "trash.retention")}
          <span>
            {retentionLabel(lang, props.retention, props.customRetentionDays)}
          </span>
        </summary>
        <div className="muzhi-trash__retention-grid">
          <label>
            {t(lang, "trash.retentionSelect")}
            <select
              aria-label={t(lang, "trash.retentionSelect")}
              disabled={props.busy}
              onInput={(event) =>
                setRetentionDraft(event.currentTarget.value as RetentionChoice)
              }
              value={retentionDraft}
            >
              <option value="7">{t(lang, "trash.days", { count: 7 })}</option>
              <option value="30">{t(lang, "trash.days", { count: 30 })}</option>
              <option value="365">
                {t(lang, "trash.days", { count: 365 })}
              </option>
              <option value="custom">{t(lang, "trash.customLabel")}</option>
              <option value="forever">{t(lang, "trash.foreverLabel")}</option>
            </select>
          </label>
          {retentionDraft === "custom" ? (
            <label>
              {t(lang, "trash.customDaysLabel")}
              <input
                aria-label={t(lang, "trash.customDaysLabel")}
                disabled={props.busy}
                inputMode="numeric"
                onInput={(event) =>
                  setCustomDaysDraft(event.currentTarget.value)
                }
                value={customDaysDraft}
              />
            </label>
          ) : null}
          <fieldset>
            <legend>{t(lang, "trash.applyScope")}</legend>
            <label>
              <input
                checked={applyToDraft === "future"}
                disabled={props.busy}
                name="batch-trash-retention-scope"
                onChange={() => setApplyToDraft("future")}
                type="radio"
              />
              {t(lang, "trash.applyFuture")}
            </label>
            <label>
              <input
                checked={applyToDraft === "existing"}
                disabled={props.busy}
                name="batch-trash-retention-scope"
                onChange={() => setApplyToDraft("existing")}
                type="radio"
              />
              {t(lang, "trash.applyExisting")}
            </label>
          </fieldset>
          <button
            disabled={
              props.busy ||
              (retentionDraft === "custom" &&
                !/^[1-9]\d{0,3}$/.test(customDaysDraft))
            }
            onClick={() =>
              props.onRetentionChange({
                applyTo: applyToDraft,
                customDays: customDaysDraft,
                retention: retentionDraft,
              })
            }
            type="button"
          >
            {t(lang, "trash.applyRetention")}
          </button>
        </div>
      </details>

      <LifecycleList
        adapter={{
          actionsAriaKey: "drawer.listActionsAria",
          confirmPurge: true,
          confirmPurgeBodyKey: "batch.confirmPurgeBody",
          confirmPurgeTitleKey: "batch.confirmPurgeTitle",
          countKey: "drawer.listCount",
          emptyKey: "batch.trashEmpty",
          kind: "batch",
          noMatchKey: "drawer.noListMatch",
          purgeLabelKey: "trash.deleteForever",
          purgeManyLabelKey: "batch.purgeMany",
          restoreLabelKey: "batch.restoreList",
          restoreManyLabelKey: "batch.restoreMany",
          runningNamesKey: "drawer.runningListNames",
          searchLabelKey: "drawer.searchLists",
          searchPlaceholderKey: "drawer.searchListPlaceholder",
          selectAriaKey: "drawer.selectList",
          selectionAriaKey: "drawer.batchManageListsAria",
          surface: "trash",
          trashLabelKey: null,
          trashManyLabelKey: null,
        }}
        busy={props.busy}
        items={props.lists}
        matches={(list, query) =>
          (list.job.name ?? list.job.sourceLabel ?? "")
            .toLocaleLowerCase()
            .includes(query)
        }
        onPurge={(ids) => {
          if (props.onPurgeMany !== undefined) {
            closeAfterSuccessfulAction(
              () => props.onPurgeMany!(ids),
              () => undefined,
            );
            return;
          }
          for (const id of ids) {
            closeAfterSuccessfulAction(
              () => props.onPurgeList(id),
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
        toView={(list) => ({
          id: list.job.batchJobId,
          meta: `${t(lang, "batch.trashedAt", {
            date: new Date(list.trashedAt).toLocaleDateString(
              lang === "zh-Hans" ? "zh-CN" : lang,
            ),
          })}${list.purgeAfter !== null ? ` · ${t(lang, "batch.trashExpires", { date: new Date(list.purgeAfter).toLocaleDateString(lang === "zh-Hans" ? "zh-CN" : lang) })}` : ""}`,
          title: list.job.name ?? list.job.sourceLabel ?? "—",
        })}
        uiLanguage={lang}
      />
      {dialog?.kind === "confirm-empty" ? (
        <AppDialog
          cancelLabel={t(lang, "batch.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={t(lang, "batch.confirmEmptyTrashBody")}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            closeAfterSuccessfulAction(
              () => props.onEmptyTrash(),
              () => undefined,
            );
          }}
          title={t(lang, "batch.confirmEmptyTrashTitle")}
          uiLanguage={lang}
        />
      ) : null}
    </section>
  );
}
