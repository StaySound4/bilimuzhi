import { useMemo, useState } from "preact/hooks";

import { t } from "../../i18n";

import { LifecycleList } from "../primitives/lifecycle-list";
import type { UiLanguage } from "../../i18n/languages";
import "./archive-workspace.css";

export interface ArchiveBranchView {
  readonly id: string;
  readonly title: string;
}

export interface ArchiveSessionProjectionView {
  readonly kind: "session";
  readonly id: string;
  readonly archivedAtLabel: string;
  readonly statusDetailLabel: string | null;
  readonly statusLabel: string;
  readonly title: string;
  readonly tagIds: readonly string[];
  readonly branchIds: readonly string[];
}

export interface ArchiveTagView {
  readonly tagId: string;
  readonly name: string;
  readonly count: number;
}

export type ArchiveActionResult = boolean | void | Promise<boolean | void>;

export interface ArchiveWorkspaceProps {
  readonly busy?: boolean;
  /** 界面语言（docs/i18n-spec.md §2）；文案接入渐进推进。 */
  readonly uiLanguage?: UiLanguage;
  readonly sessions: readonly ArchiveSessionProjectionView[];
  readonly tags: readonly ArchiveTagView[];
  readonly tagCount: number;
  readonly selectedBranchIds: readonly string[];
  readonly onSelectedBranchIdsChange: (branchIds: readonly string[]) => void;
  readonly onOpenSession: (sessionId: string) => ArchiveActionResult;
  readonly onRestoreToWorkspace: (
    branchIds: readonly string[],
    sessionId?: string,
  ) => ArchiveActionResult;
  readonly onDeleteSessionProjection: (
    branchIds: readonly string[],
    sessionId?: string,
  ) => ArchiveActionResult;
  /** 多选混合删除（有分支 + 空会话）：单个 action 内全部处理，空会话不跳过。 */
  readonly onDeleteSessionProjectionMany: (
    branchIds: readonly string[],
    emptySessionIds: readonly string[],
  ) => ArchiveActionResult;
  /** 多选混合恢复（有分支 + 空会话）：单个 action 内全部处理，空会话不跳过。 */
  readonly onRestoreToWorkspaceMany: (
    branchIds: readonly string[],
    emptySessionIds: readonly string[],
  ) => ArchiveActionResult;
  readonly onSetSessionTags: (
    sessionId: string,
    tagIds: readonly string[],
  ) => ArchiveActionResult;
  readonly onCreateTag: (name: string) => ArchiveActionResult;
  readonly onRenameTag: (tagId: string, name: string) => ArchiveActionResult;
  readonly onDeleteTag: (tagId: string) => ArchiveActionResult;
  readonly onMoveTag: (
    tagId: string,
    beforeTagId: string | null,
  ) => ArchiveActionResult;
  readonly onRenameSession: (
    sessionId: string,
    title: string,
  ) => ArchiveActionResult;
  /** 页面标题旁的帮助问号（六语境帮助入口）。 */
  readonly onHelpClick?: () => void;
}

function closeAfterSuccessfulAction(
  action: () => ArchiveActionResult,
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
    // The action owner renders the error. Keep the dialog open for retry.
  }
}

interface TagEditDialogState {
  readonly sessionIds: readonly string[];
  readonly initialTagIds: readonly string[];
}

type ArchiveDialogState =
  | {
      readonly kind: "confirm-delete-branches";
      readonly branchIds: readonly string[];
    }
  | {
      readonly kind: "confirm-delete-session";
      readonly branchIds: readonly string[];
      readonly sessionId: string;
    }
  | { readonly kind: "edit-tags"; readonly state: TagEditDialogState }
  | {
      readonly kind: "rename-session";
      readonly sessionId: string;
      readonly title: string;
    };

export function ArchiveWorkspace(props: ArchiveWorkspaceProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const {
    busy,
    onDeleteSessionProjection,
    onDeleteSessionProjectionMany,
    onDeleteTag,
    onMoveTag,
    onOpenSession,
    onCreateTag,
    onRenameSession,
    onRenameTag,
    onRestoreToWorkspaceMany,
    onSetSessionTags,
    sessions,
    tagCount,
    tags,
  } = props;
  const [selectionMode, setSelectionMode] = useState(false);
  const [dialog, setDialog] = useState<ArchiveDialogState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<
    readonly string[]
  >(() => Object.freeze([]));
  // 单卡标签编辑：卡片内展开面板（紧贴卡片，同三点菜单框架）。
  // setter 用于 closeAllSurfaces 复位；读取值从未被消费，保留 setter 即可。
  const [, setPanelTagRename] = useState<string | null>(null);
  const [, setPanelTagDelete] = useState<string | null>(null);
  const [tagEditorSessionId, setTagEditorSessionId] = useState<string | null>(
    null,
  );
  // 管理标签面板：单选选中标签，底部常驻按钮组随选中亮起。
  const [managerOpen, setManagerOpen] = useState(false);
  const [managedTagId, setManagedTagId] = useState<string | null>(null);
  const [managerRename, setManagerRename] = useState(false);
  const [managerDelete, setManagerDelete] = useState(false);
  // 拖拽排序状态。
  const [dragTagId, setDragTagId] = useState<string | null>(null);
  const [dragOverTagId, setDragOverTagId] = useState<string | null>(null);
  // 拖到列表空白处 = 追加到末尾（HTML5 拖拽无 onDragLeave 到容器外时靠此标记区分）。
  const [dragToEnd, setDragToEnd] = useState(false);

  // 交集筛选：会话必须包含全部已选标签；搜索与筛选取交集。
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim();
    return sessions.filter((session) => {
      if (query.length > 0 && !session.title.includes(query)) return false;
      const ids = session.tagIds;
      return selectedFilterTagIds.every((tagId) => ids.includes(tagId));
    });
  }, [sessions, searchQuery, selectedFilterTagIds]);

  const filterActive =
    selectedFilterTagIds.length > 0 || searchQuery.trim().length > 0;

  const clearFilter = (): void => {
    setSelectedFilterTagIds(Object.freeze([]));
    setSearchQuery("");
  };

  const toggleTagSelection = (tagId: string): void => {
    setSelectedFilterTagIds((current) =>
      current.includes(tagId)
        ? Object.freeze(current.filter((id) => id !== tagId))
        : Object.freeze([...current, tagId]),
    );
  };

  const removeDeletedTagFromFilter = (tagId: string): void => {
    setSelectedFilterTagIds((current) =>
      current.includes(tagId)
        ? Object.freeze(current.filter((id) => id !== tagId))
        : current,
    );
  };

  /** 把选中的会话 id 拆成「有分支」与「空会话（无分支）」两组。 */
  const splitSessions = (
    sessionIds: readonly string[],
  ): {
    readonly branchIds: readonly string[];
    readonly emptySessionIds: readonly string[];
  } => {
    const target = sessions.filter((session) =>
      sessionIds.includes(session.id),
    );
    return {
      branchIds: target.flatMap((session) => session.branchIds),
      emptySessionIds: target
        .filter((session) => session.branchIds.length === 0)
        .map((session) => session.id),
    };
  };

  const exitSelection = (): void => {
    setSelectionMode(false);
    props.onSelectedBranchIdsChange(Object.freeze([]));
  };

  const selectAllVisible = (): void => {
    const branchIds = filteredSessions.flatMap((session) =>
      session.branchIds.map((branchId) => branchId),
    );
    props.onSelectedBranchIdsChange(Object.freeze([...branchIds]));
  };

  /** 单例互斥：同一时刻最多一个菜单/面板/对话框打开；同按钮 toggle、异按钮切换。 */
  const closeAllSurfaces = (): void => {
    setTagEditorSessionId(null);
    setManagerOpen(false);
    setDialog(null);
    setPanelTagRename(null);
    setPanelTagDelete(null);
    setManagerRename(false);
    setManagerDelete(false);
  };

  const openTagEditorExclusive = (sessionId: string): void => {
    // 同钮 toggle：同卡片展开面板已打开则收起；异卡直接切换
    if (tagEditorSessionId === sessionId) {
      setTagEditorSessionId(null);
      return;
    }
    setManagerOpen(false);
    setDialog(null);
    setTagEditorSessionId(sessionId);
  };

  const openManagerExclusive = (): void => {
    // 同钮 toggle：面板已打开则收起；否则切换并关闭其他表面
    if (managerOpen) {
      setManagerOpen(false);
      setManagedTagId(null);
      setManagerRename(false);
      setManagerDelete(false);
      return;
    }
    setTagEditorSessionId(null);
    setDialog(null);
    setManagerOpen(true);
    setManagedTagId(null);
    setManagerRename(false);
    setManagerDelete(false);
  };

  return (
    <section
      className="muzhi-archive"
      aria-label={t(lang, "archive.workspaceAria")}
    >
      <header>
        <h2>{t(lang, "archive.title")}</h2>
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
        <span className="muzhi-archive__usage">
          {t(lang, "archive.tagUsage", { count: tagCount })}
        </span>
        <div className="muzhi-archive__header-actions">
          <button disabled={busy} onClick={openManagerExclusive} type="button">
            {t(lang, "archive.manageTags")}
          </button>
        </div>
      </header>

      {managerOpen ? (
        <div
          aria-label={t(lang, "archive.managerTitle")}
          aria-modal="true"
          className="muzhi-archive__manager-layer"
          onClick={(event) => {
            if (event.currentTarget === event.target && !busy)
              closeAllSurfaces();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) closeAllSurfaces();
          }}
          role="dialog"
        >
          <TagManagerPanel
            lang={lang}
            busy={busy ?? false}
            dragOverTagId={dragOverTagId}
            dragTagId={dragTagId}
            dragToEnd={dragToEnd}
            onDragBlank={() => setDragToEnd(true)}
            onDragRow={() => setDragToEnd(false)}
            managedTagId={managedTagId}
            managerDelete={managerDelete}
            managerRename={managerRename}
            onCancelDelete={() => setManagerDelete(false)}
            onCancelRename={() => setManagerRename(false)}
            onClose={closeAllSurfaces}
            onCreateTag={onCreateTag}
            onConfirmDelete={() => {
              const tagId = managedTagId;
              if (tagId === null) return;
              setManagedTagId(null);
              setManagerDelete(false);
              closeAfterSuccessfulAction(
                () => onDeleteTag(tagId),
                () => removeDeletedTagFromFilter(tagId),
              );
            }}
            onConfirmRename={(name) => {
              const tagId = managedTagId;
              if (tagId === null) return;
              setManagerRename(false);
              closeAfterSuccessfulAction(
                () => onRenameTag(tagId, name),
                () => undefined,
              );
            }}
            onDragEnd={() => {
              const tagId = dragTagId;
              const beforeTagId = dragToEnd ? null : dragOverTagId;
              setDragTagId(null);
              setDragOverTagId(null);
              setDragToEnd(false);
              if (tagId === null || tagId === beforeTagId) {
                return;
              }
              closeAfterSuccessfulAction(
                () => onMoveTag(tagId, beforeTagId),
                () => undefined,
              );
            }}
            onDragOverTag={(tagId) => setDragOverTagId(tagId)}
            onDragStartTag={(tagId) => setDragTagId(tagId)}
            onRenameRequest={() => setManagerRename(true)}
            onSelectTag={(tagId) => {
              setManagedTagId((current) => (current === tagId ? null : tagId));
              setManagerRename(false);
              setManagerDelete(false);
            }}
            onStartDelete={() => setManagerDelete(true)}
            tags={tags}
          />
        </div>
      ) : null}
      <div
        aria-label={t(lang, "archive.tagPanelAria")}
        className="muzhi-archive__filter-panel"
      >
        {tags.length === 0 ? (
          <p className="muzhi-archive__filter-empty">
            {t(lang, "archive.noTagsHint")}
          </p>
        ) : (
          <div className="muzhi-archive__filter-tags">
            {tags.map((tag) => {
              const selected = selectedFilterTagIds.includes(tag.tagId);
              return (
                <div className="muzhi-archive__filter-row" key={tag.tagId}>
                  <button
                    aria-pressed={selected}
                    className={`muzhi-archive__filter-chip${
                      selected ? " is-selected" : ""
                    }`}
                    onClick={() => toggleTagSelection(tag.tagId)}
                    title={t(lang, "archive.clickToFilter")}
                    type="button"
                  >
                    {tag.name} ({tag.count})
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {filterActive ? (
          <div className="muzhi-archive__filter-actions">
            <button disabled={busy} onClick={clearFilter} type="button">
              {t(lang, "archive.clearFilter")}
            </button>
          </div>
        ) : null}
      </div>

      {filterActive && !selectionMode ? (
        <div className="muzhi-archive__filter-bar">
          <span>{t(lang, "archive.filterActive")}</span>
          <button onClick={selectAllVisible} type="button">
            {t(lang, "archive.selectAllResults")}
          </button>
          <button onClick={clearFilter} type="button">
            {t(lang, "common.clear")}
          </button>
        </div>
      ) : null}

      <LifecycleList
        adapter={{
          actionsAriaKey: "archive.sessionMenuAria",
          confirmTrash: true,
          confirmTrashBodyKey: "archive.confirmDeleteBody",
          confirmTrashTitleKey: "archive.confirmDeleteTitle",
          countKey: "drawer.sessionCount",
          emptyKey: "archive.empty",
          kind: "session",
          noMatchKey: "archive.noMatch",
          purgeLabelKey: null,
          purgeManyLabelKey: null,
          restoreLabelKey: "archive.restoreToWorkspace",
          restoreManyLabelKey: "trash.restoreMany",
          runningNamesKey: "drawer.runningNames",
          searchLabelKey: "archive.searchSessions",
          selectionAriaKey: "archive.selectionAria",
          searchPlaceholderKey: "archive.searchSessions",
          selectAriaKey: "archive.selectSessionAria",
          surface: "archive",
          trashLabelKey: "archive.deleteSession",
          trashManyLabelKey: "archive.trashMany",
        }}
        busy={busy}
        items={filteredSessions}
        matches={(session, query) =>
          session.title.toLocaleLowerCase().includes(query)
        }
        onMoveToTrash={(ids) => {
          // primitive 已完成危险确认（confirmTrash），此处直接执行删除语义。
          // 混合处理：空会话（无分支）也必须移入回收站，不能只删有分支的。
          const { branchIds, emptySessionIds } = splitSessions(ids);
          if (branchIds.length === 0 && emptySessionIds.length === 0) return;
          closeAfterSuccessfulAction(
            () => onDeleteSessionProjectionMany(branchIds, emptySessionIds),
            exitSelection,
          );
        }}
        onOpen={(session) => {
          void onOpenSession(session.id);
        }}
        onRestore={(ids) => {
          const { branchIds, emptySessionIds } = splitSessions(ids);
          closeAfterSuccessfulAction(
            () => onRestoreToWorkspaceMany(branchIds, emptySessionIds),
            exitSelection,
          );
        }}
        onRestoreMany={(ids) => {
          const { branchIds, emptySessionIds } = splitSessions(ids);
          closeAfterSuccessfulAction(
            () => onRestoreToWorkspaceMany(branchIds, emptySessionIds),
            exitSelection,
          );
        }}
        selectionExtra={(ids) => [
          {
            label: t(lang, "archive.batchEditTags"),
            onClick: () => {
              const target = sessions.filter((session) =>
                ids.includes(session.id),
              );
              if (target.length === 0) return;
              setDialog({
                kind: "edit-tags",
                state: {
                  initialTagIds: [],
                  sessionIds: target.map((session) => session.id),
                },
              });
            },
          },
        ]}
        rowChildren={(session) =>
          tagEditorSessionId === session.id ? (
            <CardTagEditor
              lang={lang}
              busy={busy ?? false}
              initialTagIds={session.tagIds}
              onClose={() => setTagEditorSessionId(null)}
              onSave={(tagIds) =>
                closeAfterSuccessfulAction(
                  () => onSetSessionTags(session.id, tagIds),
                  () => setTagEditorSessionId(null),
                )
              }
              tags={tags}
            />
          ) : null
        }
        rowAction={(session) => ({
          ariaLabel: t(lang, "archive.editTagsAria", {
            title: session.title,
          }),
          icon: "tag",
          onClick: () => openTagEditorExclusive(session.id),
          title: t(lang, "archive.editTags"),
        })}
        rowMenuExtra={(session) => [
          {
            disabled: busy,
            icon: "pencil",
            kind: "item",
            label: t(lang, "drawer.actionRename"),
            onSelect: () =>
              setDialog({
                kind: "rename-session",
                sessionId: session.id,
                title: session.title,
              }),
          },
          {
            disabled: busy,
            icon: "tag",
            kind: "item",
            label: t(lang, "archive.editTags"),
            onSelect: () => openTagEditorExclusive(session.id),
          },
        ]}
        toView={(session) => ({
          id: session.id,
          meta: `${session.statusLabel}${
            session.archivedAtLabel.length === 0
              ? ""
              : ` · ${t(lang, "archive.archivedAt", {
                  label: session.archivedAtLabel,
                })}`
          }`,
          title: session.title,
        })}
        uiLanguage={lang}
      />

      {dialog !== null ? (
        <ArchiveDialog
          lang={lang}
          busy={busy ?? false}
          dialog={dialog}
          onClose={closeAllSurfaces}
          onDelete={() => {
            const branchIds =
              dialog.kind === "confirm-delete-branches" ||
              dialog.kind === "confirm-delete-session"
                ? dialog.branchIds
                : [];
            const sessionId =
              dialog.kind === "confirm-delete-session"
                ? dialog.sessionId
                : undefined;
            closeAfterSuccessfulAction(
              () => onDeleteSessionProjection(branchIds, sessionId),
              () => {
                setDialog(null);
                if (selectionMode) exitSelection();
              },
            );
          }}
          onRenameSession={(sessionId, title) =>
            closeAfterSuccessfulAction(
              () => onRenameSession(sessionId, title),
              () => setDialog(null),
            )
          }
          onSetSessionTags={(sessionIds, tagIds) =>
            closeAfterSuccessfulAction(
              () => {
                let pending: ArchiveActionResult = true;
                for (const sessionId of sessionIds) {
                  pending = onSetSessionTags(sessionId, tagIds);
                }
                return pending;
              },
              () => setDialog(null),
            )
          }
          tags={tags}
        />
      ) : null}
    </section>
  );
}

function ArchiveDialog({
  lang,
  busy,
  dialog,
  onClose,
  onDelete,
  onRenameSession,
  onSetSessionTags,
  tags,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly dialog: ArchiveDialogState;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onSetSessionTags: (
    sessionIds: readonly string[],
    tagIds: readonly string[],
  ) => void;
  readonly tags: readonly ArchiveTagView[];
}) {
  if (dialog.kind === "confirm-delete-branches") {
    return (
      <div
        aria-label={t(lang, "archive.deleteConfirmAria")}
        className="muzhi-dialog"
        role="dialog"
      >
        <h3>{t(lang, "archive.confirmDeleteTitle")}</h3>
        <p>
          {t(lang, "archive.confirmDeleteBatch", {
            count: dialog.branchIds.length,
          })}
        </p>
        <div className="muzhi-dialog__actions">
          <button disabled={busy} onClick={onClose} type="button">
            {t(lang, "common.cancel")}
          </button>
          <button
            className="muzhi-archive__danger-action"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            {t(lang, "common.delete")}
          </button>
        </div>
      </div>
    );
  }
  if (dialog.kind === "confirm-delete-session") {
    return (
      <div
        aria-label={t(lang, "archive.deleteConfirmAria")}
        className="muzhi-dialog"
        role="dialog"
      >
        <h3>{t(lang, "archive.confirmDeleteTitle")}</h3>
        <p>{t(lang, "archive.confirmDeleteBody")}</p>
        <div className="muzhi-dialog__actions">
          <button disabled={busy} onClick={onClose} type="button">
            {t(lang, "common.cancel")}
          </button>
          <button
            className="muzhi-archive__danger-action"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            {t(lang, "common.delete")}
          </button>
        </div>
      </div>
    );
  }
  if (dialog.kind === "rename-session") {
    return (
      <RenameDialog
        lang={lang}
        busy={busy}
        onClose={onClose}
        onRename={(title) => onRenameSession(dialog.sessionId, title)}
        title={dialog.title}
      />
    );
  }
  return (
    <TagEditDialog
      lang={lang}
      batch={dialog.state.sessionIds.length > 1}
      busy={busy}
      initialTagIds={dialog.state.initialTagIds}
      onClose={onClose}
      onSave={(tagIds) => onSetSessionTags(dialog.state.sessionIds, tagIds)}
      tags={tags}
    />
  );
}

function RenameDialog({
  lang,
  busy,
  onClose,
  onRename,
  title,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onRename: (title: string) => void;
  readonly title: string;
}) {
  const [value, setValue] = useState(title);
  return (
    <div
      aria-label={t(lang, "archive.renameSessionTitle")}
      className="muzhi-dialog"
      role="dialog"
    >
      <h3>{t(lang, "archive.renameSessionTitle")}</h3>
      <input
        aria-label={t(lang, "archive.renameSessionAria")}
        maxLength={120}
        onInput={(event) => setValue(event.currentTarget.value)}
        type="text"
        value={value}
      />
      <div className="muzhi-dialog__actions">
        <button disabled={busy} onClick={onClose} type="button">
          {t(lang, "common.cancel")}
        </button>
        <button
          disabled={busy || value.trim().length === 0}
          onClick={() => onRename(value.trim())}
          type="button"
        >
          {t(lang, "common.save")}
        </button>
      </div>
    </div>
  );
}

function TagEditDialog({
  lang,
  batch,
  busy,
  initialTagIds,
  onClose,
  onSave,
  tags,
}: {
  readonly lang: UiLanguage;
  readonly batch: boolean;
  readonly busy: boolean;
  readonly initialTagIds: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (tagIds: readonly string[]) => void;
  readonly tags: readonly ArchiveTagView[];
}) {
  const [selected, setSelected] = useState<readonly string[]>(initialTagIds);
  const toggle = (tagId: string): void => {
    setSelected((current) =>
      current.includes(tagId)
        ? Object.freeze(current.filter((id) => id !== tagId))
        : Object.freeze([...current, tagId]),
    );
  };

  const clearAll = (): void => {
    setSelected(Object.freeze([]));
  };

  return (
    <div
      aria-label={
        batch ? t(lang, "archive.batchEditTags") : t(lang, "archive.editTags")
      }
      className="muzhi-dialog"
      role="dialog"
    >
      <h3>
        {batch ? t(lang, "archive.batchEditTags") : t(lang, "archive.editTags")}
      </h3>
      {batch ? (
        <p className="muzhi-dialog__hint">{t(lang, "archive.batchEditHint")}</p>
      ) : null}
      <div className="muzhi-archive__tag-options">
        {tags.map((tag) => {
          const checked = selected.includes(tag.tagId);
          return (
            <label className="muzhi-archive__tag-option" key={tag.tagId}>
              <input
                checked={checked}
                onChange={() => toggle(tag.tagId)}
                type="checkbox"
              />
              <span>
                {tag.name} ({tag.count})
              </span>
            </label>
          );
        })}
      </div>
      <div className="muzhi-dialog__actions">
        <button disabled={busy} onClick={clearAll} type="button">
          {t(lang, "archive.clearTags")}
        </button>
        <button disabled={busy} onClick={onClose} type="button">
          {t(lang, "common.cancel")}
        </button>
        <button
          className="muzhi-archive__primary-action"
          disabled={busy}
          onClick={() => onSave(selected)}
          type="button"
        >
          {batch ? t(lang, "archive.batchApply") : t(lang, "common.confirm")}
        </button>
      </div>
    </div>
  );
}

/**
 * 单卡标签编辑：卡片内展开面板（与三点菜单同款框架，紧贴卡片）。
 * 紧凑 chips（与筛选/菜单统一样式）；选中整卡底纹；无搜索/新建。
 */
function CardTagEditor({
  lang,
  busy,
  initialTagIds,
  onClose,
  onSave,
  tags,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly initialTagIds: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (tagIds: readonly string[]) => void;
  readonly tags: readonly ArchiveTagView[];
}) {
  const [selected, setSelected] = useState<readonly string[]>(initialTagIds);
  const toggle = (tagId: string): void => {
    setSelected((current) =>
      current.includes(tagId)
        ? Object.freeze(current.filter((id) => id !== tagId))
        : Object.freeze([...current, tagId]),
    );
  };
  return (
    <div
      className="muzhi-archive__menu"
      aria-label={t(lang, "archive.editTags")}
    >
      <div className="muzhi-archive__menu-head">
        <strong>{t(lang, "archive.editTags")}</strong>
        <button disabled={busy} onClick={onClose} type="button">
          {t(lang, "common.close")}
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="muzhi-archive__filter-empty">
          {t(lang, "archive.noTags")}
        </p>
      ) : (
        <div className="muzhi-archive__tag-options">
          {tags.map((tag) => {
            const checked = selected.includes(tag.tagId);
            return (
              <label className="muzhi-archive__tag-option" key={tag.tagId}>
                <input
                  checked={checked}
                  onChange={() => toggle(tag.tagId)}
                  type="checkbox"
                />
                <span>
                  {tag.name} ({tag.count})
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="muzhi-archive__actions">
        <button
          disabled={busy || selected.length === 0}
          onClick={() => setSelected(Object.freeze([]))}
          type="button"
        >
          {t(lang, "common.clear")}
        </button>
        <button
          className="muzhi-archive__primary-action"
          disabled={busy}
          onClick={() => onSave(selected)}
          type="button"
        >
          {t(lang, "common.confirm")}
        </button>
      </div>
    </div>
  );
}

/**
 * 管理标签面板：点击标签单选，底部常驻按钮组（重命名/删除）默认禁用，
 * 选中标签后亮起；标签可拖拽排序（拖到某标签上方 = 插入其前）。
 */
function TagManagerPanel({
  lang,
  busy,
  dragOverTagId,
  dragTagId,
  dragToEnd,
  onDragBlank,
  onDragRow,
  managedTagId,
  managerDelete,
  managerRename,
  onCancelDelete,
  onCancelRename,
  onClose,
  onCreateTag,
  onConfirmDelete,
  onConfirmRename,
  onDragEnd,
  onDragOverTag,
  onDragStartTag,
  onRenameRequest,
  onSelectTag,
  onStartDelete,
  tags,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly dragOverTagId: string | null;
  readonly dragTagId: string | null;
  readonly dragToEnd: boolean;
  readonly onDragBlank: () => void;
  readonly onDragRow: () => void;
  readonly managedTagId: string | null;
  readonly managerDelete: boolean;
  readonly managerRename: boolean;
  readonly onCancelDelete: () => void;
  readonly onCancelRename: () => void;
  readonly onClose: () => void;
  readonly onCreateTag: (name: string) => ArchiveActionResult;
  readonly onConfirmDelete: () => void;
  readonly onConfirmRename: (name: string) => void;
  readonly onDragEnd: () => void;
  readonly onDragOverTag: (tagId: string) => void;
  readonly onDragStartTag: (tagId: string) => void;
  readonly onRenameRequest: () => void;
  readonly onSelectTag: (tagId: string) => void;
  readonly onStartDelete: () => void;
  readonly tags: readonly ArchiveTagView[];
}) {
  const managedTag = tags.find((tag) => tag.tagId === managedTagId) ?? null;
  const [managerNewTagName, setManagerNewTagName] = useState("");

  if (managerRename && managedTag !== null) {
    return (
      <div className="muzhi-archive__manager">
        <div className="muzhi-archive__manager-head">
          <h3>{t(lang, "archive.renameTagTitle")}</h3>
          <button disabled={busy} onClick={onClose} type="button">
            {t(lang, "common.close")}
          </button>
        </div>
        <TagRenameInline
          lang={lang}
          busy={busy}
          initialName={managedTag.name}
          onCancel={onCancelRename}
          onConfirm={onConfirmRename}
        />
        <div className="muzhi-archive__manager-actions">
          <button disabled type="button">
            {t(lang, "common.rename")}
          </button>
          <button disabled type="button">
            {t(lang, "common.delete")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="muzhi-archive__manager">
      <div className="muzhi-archive__manager-head">
        <h3>{t(lang, "archive.managerTitle")}</h3>
        <button disabled={busy} onClick={onClose} type="button">
          {t(lang, "common.close")}
        </button>
      </div>
      <p className="muzhi-archive__manager-hint">
        {t(lang, "archive.managerHint")}
      </p>
      <div className="muzhi-archive__filter-new">
        <input
          aria-label={t(lang, "archive.newTagPlaceholder")}
          maxLength={20}
          onInput={(event) => setManagerNewTagName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && managerNewTagName.trim().length > 0) {
              const name = managerNewTagName.trim();
              setManagerNewTagName("");
              closeAfterSuccessfulAction(
                () => onCreateTag(name),
                () => undefined,
              );
            }
          }}
          placeholder={t(lang, "archive.newTagPlaceholder")}
          type="text"
          value={managerNewTagName}
        />
        <button
          disabled={busy || managerNewTagName.trim().length === 0}
          onClick={() => {
            const name = managerNewTagName.trim();
            setManagerNewTagName("");
            closeAfterSuccessfulAction(
              () => onCreateTag(name),
              () => undefined,
            );
          }}
          type="button"
        >
          {t(lang, "archive.addTag")}
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="muzhi-archive__filter-empty">
          {t(lang, "archive.noTags")}
        </p>
      ) : (
        <div
          className={`muzhi-archive__manager-list${
            dragToEnd ? " is-drag-to-end" : ""
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            if (dragTagId !== null) onDragBlank();
          }}
          onDrop={(event) => event.preventDefault()}
        >
          {tags.map((tag) => {
            const managed = managedTagId === tag.tagId;
            const isDragTarget = dragOverTagId === tag.tagId;
            return (
              <div
                aria-selected={managed}
                className={`muzhi-archive__manager-row${
                  managed ? " is-managed" : ""
                }${isDragTarget ? " is-drag-over" : ""}`}
                draggable
                key={tag.tagId}
                onDragEnd={onDragEnd}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDragRow();
                  if (dragTagId !== null && dragTagId !== tag.tagId) {
                    onDragOverTag(tag.tagId);
                  }
                }}
                onDragStart={(event) => {
                  if (event.dataTransfer !== null) {
                    event.dataTransfer.effectAllowed = "move";
                  }
                  onDragStartTag(tag.tagId);
                }}
                onClick={() => onSelectTag(tag.tagId)}
                role="option"
                title={t(lang, "archive.managerRowTitle")}
              >
                <span
                  className="muzhi-archive__manager-drag"
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span className="muzhi-archive__manager-name">
                  {tag.name} ({tag.count})
                </span>
              </div>
            );
          })}
        </div>
      )}
      {managerDelete && managedTag !== null ? (
        <TagDeleteConfirm
          lang={lang}
          busy={busy}
          count={managedTag.count}
          name={managedTag.name}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
      <div className="muzhi-archive__manager-actions">
        <button
          disabled={busy || managedTagId === null}
          onClick={onRenameRequest}
          type="button"
        >
          {t(lang, "common.rename")}
        </button>
        <button
          className="muzhi-archive__danger-action"
          disabled={busy || managedTagId === null}
          onClick={onStartDelete}
          type="button"
        >
          {t(lang, "common.delete")}
        </button>
      </div>
    </div>
  );
}

function TagRenameInline({
  lang,
  busy,
  initialName,
  onCancel,
  onConfirm,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly initialName: string;
  readonly onCancel: () => void;
  readonly onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(initialName);
  return (
    <span className="muzhi-archive__filter-inline">
      <input
        aria-label={t(lang, "archive.renameTagInput", { name: initialName })}
        maxLength={20}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim().length > 0) {
            onConfirm(value.trim());
          }
          if (event.key === "Escape") onCancel();
        }}
        type="text"
        value={value}
      />
      <button
        disabled={busy || value.trim().length === 0}
        onClick={() => onConfirm(value.trim())}
        type="button"
      >
        {t(lang, "common.save")}
      </button>
      <button disabled={busy} onClick={onCancel} type="button">
        {t(lang, "common.cancel")}
      </button>
    </span>
  );
}

function TagDeleteConfirm({
  lang,
  busy,
  count,
  name,
  onCancel,
  onConfirm,
}: {
  readonly lang: UiLanguage;
  readonly busy: boolean;
  readonly count: number;
  readonly name: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <span className="muzhi-archive__filter-inline is-confirm">
      <span>{t(lang, "archive.deleteTagConfirm", { name, count })}</span>
      <button disabled={busy} onClick={onCancel} type="button">
        {t(lang, "common.cancel")}
      </button>
      <button
        className="muzhi-archive__danger-action"
        disabled={busy}
        onClick={onConfirm}
        type="button"
      >
        {t(lang, "archive.confirmDeleteButton")}
      </button>
    </span>
  );
}
