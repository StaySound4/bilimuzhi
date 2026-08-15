import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { useEffect, useState } from "preact/hooks";

import { LifecycleList } from "../primitives/lifecycle-list";

import type { RetentionChange, RetentionChoice } from "../retention";
import "./trash-workspace.css";

/**
 * 回收站单行记录投影：一条内容记录（字幕分支）或一个未获取字幕的会话只占一行。
 * 投影只携带回收站管理所需的元数据标签，不包含任何字幕、对话、总结或附件正文。
 */
export interface TrashListItem {
  readonly id: string;
  readonly kind: "branch" | "session";
  readonly sessionId?: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly statusDetailLabel: string | null;
  readonly originLabel: string;
  readonly originKind: "archive" | "workspace";
  readonly trashedAtLabel: string;
  readonly expiresAtLabel: string;
}

export type TrashRestoreIntent =
  | {
      readonly branchId: string;
      readonly kind: "branch";
      readonly originKind: "archive" | "workspace";
    }
  | { readonly kind: "session"; readonly sessionId: string };

export type TrashDeleteIntent =
  | { readonly branchId: string; readonly kind: "branch" }
  | { readonly kind: "session"; readonly sessionId: string };

export type TrashActionResult = boolean | void | Promise<boolean | void>;

export interface TrashWorkspaceProps {
  readonly uiLanguage?: UiLanguage;
  readonly applyRetentionTo: "existing" | "future";
  readonly busy?: boolean;
  readonly customRetentionDays: string;
  readonly items: readonly TrashListItem[];
  readonly onEmptyTrash: () => TrashActionResult;
  readonly onPermanentlyDelete: (
    items: readonly TrashDeleteIntent[],
  ) => TrashActionResult;
  readonly onRestore: (intent: TrashRestoreIntent) => TrashActionResult;
  readonly onRestoreSelected: (
    items: readonly TrashRestoreIntent[],
  ) => TrashActionResult;
  readonly onRetentionChange: (value: RetentionChange) => TrashActionResult;
  readonly retention: RetentionChoice;
  /** 页面标题旁的帮助问号（六语境帮助入口）。 */
  readonly onHelpClick?: () => void;
}

function closeAfterSuccessfulAction(
  action: () => TrashActionResult,
  close: () => void,
): void {
  try {
    const result = action();
    if (result instanceof Promise) {
      void result
        .then((succeeded) => {
          if (succeeded !== false) close();
        })
        .catch(() => undefined);
      return;
    }
    if (result !== false) close();
  } catch {
    // The action owner renders the error. Keep the menu open for retry.
  }
}

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
  return t(lang, "trash.days", { count: value });
}

function restoreIntent(item: TrashListItem): TrashRestoreIntent {
  return item.kind === "session"
    ? { kind: "session", sessionId: item.sessionId! }
    : { branchId: item.id, kind: "branch", originKind: item.originKind };
}

function deleteIntent(item: TrashListItem): TrashDeleteIntent {
  return item.kind === "session"
    ? { kind: "session", sessionId: item.sessionId! }
    : { branchId: item.id, kind: "branch" };
}

/** 永久删除危险确认正文：按选中条目的分支/会话构成生成 counts 预览。 */
export function trashDeleteConfirmBody(
  lang: UiLanguage,
  items: readonly TrashListItem[],
): string {
  const branchCount = items.filter((item) => item.kind === "branch").length;
  const sessionCount = items.length - branchCount;
  const counts =
    branchCount === 0
      ? t(lang, "trash.deletePreviewSessions", { count: sessionCount })
      : t(lang, "trash.deletePreviewBranches", { count: branchCount }) +
        (sessionCount > 0
          ? t(lang, "trash.deletePreviewSessionsInvolved", {
              count: sessionCount,
            })
          : "");
  return t(lang, "trash.deletePreviewIrreversible", { counts });
}

export function TrashWorkspace(props: TrashWorkspaceProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
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
  useEffect(
    () => setApplyToDraft(props.applyRetentionTo),
    [props.applyRetentionTo],
  );

  const hasItems = props.items.length > 0;

  return (
    <section aria-label={t(lang, "trash.title")} className="muzhi-trash">
      <header className="muzhi-trash__header">
        <div>
          <div class="muzhi-title-help">
            <h2>{t(lang, "trash.title")}</h2>
            {props.onHelpClick ? (
              <button
                aria-label={t(lang, "header.helpAria")}
                class="muzhi-shell__help"
                onClick={props.onHelpClick}
                title={t(lang, "header.helpTitle")}
                type="button"
              >
                ?
              </button>
            ) : null}
          </div>
          <p>{t(lang, "trash.hint")}</p>
        </div>
        <div className="muzhi-trash__bulk-actions">
          <button
            className="muzhi-trash__delete muzhi-trash__empty-danger"
            disabled={props.busy || !hasItems}
            onClick={props.onEmptyTrash}
            type="button"
          >
            {t(lang, "trash.emptyNow")}
          </button>
        </div>
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
                name="trash-retention-scope"
                onChange={() => setApplyToDraft("future")}
                type="radio"
              />
              {t(lang, "trash.applyFuture")}
            </label>
            <label>
              <input
                checked={applyToDraft === "existing"}
                disabled={props.busy}
                name="trash-retention-scope"
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
          actionsAriaKey: "trash.menuAria",
          confirmBody: (lang, ids) =>
            trashDeleteConfirmBody(
              lang,
              props.items.filter((item) => ids.includes(item.id)),
            ),
          confirmPurge: true,
          confirmPurgeBodyKey: "trash.deletePreviewIrreversible",
          confirmPurgeTitleKey: "trash.deleteForever",
          countKey: "drawer.sessionCount",
          emptyKey: "trash.empty",
          kind: "session",
          noMatchKey: "trash.noMatch",
          purgeLabelKey: "trash.deleteForever",
          purgeManyLabelKey: "trash.deleteSelected",
          restoreLabelKey: "trash.restore",
          restoreManyLabelKey: "trash.restoreMany",
          runningNamesKey: "drawer.runningNames",
          searchLabelKey: "trash.searchLabel",
          selectionAriaKey: "archive.selectionAria",
          searchPlaceholderKey: "trash.searchLabel",
          selectAriaKey: "trash.selectItemAria",
          surface: "trash",
          trashLabelKey: null,
          trashManyLabelKey: null,
        }}
        busy={props.busy}
        items={props.items}
        matches={(item, query) =>
          item.title.toLocaleLowerCase().includes(query)
        }
        onPurge={(ids) => {
          const intents = props.items
            .filter((item) => ids.includes(item.id))
            .map(deleteIntent);
          if (intents.length === 0) return;
          closeAfterSuccessfulAction(
            () => props.onPermanentlyDelete(intents),
            () => undefined,
          );
        }}
        onRestore={(ids) => {
          const intents = props.items
            .filter((item) => ids.includes(item.id))
            .map(restoreIntent);
          if (intents.length === 0) return;
          closeAfterSuccessfulAction(
            () => props.onRestoreSelected(intents),
            () => undefined,
          );
        }}
        toView={(item) => ({
          id: item.id,
          meta: `${item.statusLabel}${
            item.trashedAtLabel.length === 0
              ? ""
              : ` · ${t(lang, "trash.deletedAt", { label: item.trashedAtLabel })}`
          }${
            item.expiresAtLabel.length === 0
              ? ""
              : ` · ${t(lang, "trash.expiresAt", { label: item.expiresAtLabel })}`
          }`,
          title: item.title,
        })}
        uiLanguage={lang}
      />
    </section>
  );
}
