/**
 * BatchDrawer — 批量列表侧栏（Ticket 02）。
 *
 * 与 SessionDrawer 严格同构 A1/A2/A3：
 * - A1 新建列表（原子命名由父级落库，成功后自动选中并进入新列表）；
 * - A2 搜索列表标题（与右侧视频筛选完全独立）；
 * - A3 列表行复用 Session 行锚点（.session-drawer__row / 复选框 /
 *   状态槽 / 三点菜单），文案一律使用「列表」而非「会话」；
 * - 列表级选择是独立命令域：进入多选时通过 onListSelectionActiveChange
 *   通知父级清空并暂停右侧 BatchItem 修改动作；
 * - 三点菜单：重命名、置顶、归档、删除；运行中先确认停止影响。
 * 宽屏常驻侧栏 / 窄屏 Drawer 的响应式规则与 Session 共用同一 CSS。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { type JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { BatchJob } from "../../domain";
import { AppDialog } from "../dialogs/app-dialog";
import { CompactActionMenu } from "../primitives/compact-action-menu";
import { BilimuzhiIcon } from "../icons";

export interface BatchDrawerMessage {
  readonly kind: "error" | "status";
  readonly text: string;
}

export type BatchDrawerActionResult = boolean | void | Promise<boolean | void>;

export interface BatchDrawerList {
  readonly createdAtLabel: string;
  readonly id: string;
  readonly label: string;
  readonly pinned: boolean;
  readonly running: boolean;
  readonly status: BatchJob["status"];
}

export interface BatchDrawerProps {
  readonly uiLanguage?: UiLanguage;
  readonly activeListId?: string | null;
  readonly busy?: boolean;
  readonly lists: readonly BatchDrawerList[];
  readonly message?: BatchDrawerMessage;
  readonly onArchive?: (listId: string) => BatchDrawerActionResult;
  readonly onArchiveMany?: (
    listIds: readonly string[],
  ) => BatchDrawerActionResult;
  readonly onDelete: (listId: string) => BatchDrawerActionResult;
  readonly onDeleteMany?: (
    listIds: readonly string[],
  ) => BatchDrawerActionResult;
  readonly onCreateList?: () => BatchDrawerActionResult;
  readonly onListSelectionActiveChange?: (active: boolean) => void;
  readonly onOpenArchive?: () => void;
  readonly onOpenBatch?: () => void;
  readonly onOpenSessionMode?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onOpenTrash?: () => void;
  readonly onRename: (listId: string, title: string) => BatchDrawerActionResult;
  readonly onSelect: (listId: string) => BatchDrawerActionResult;
  readonly onTogglePinned?: (
    listId: string,
    pinned: boolean,
  ) => BatchDrawerActionResult;
  readonly pinnedListIds?: readonly string[];
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function closeAfterSuccessfulAction(
  action: () => BatchDrawerActionResult,
  onSuccess: () => void,
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
          if (succeeded !== false) onSuccess();
        },
        () => undefined,
      );
      return;
    }
    if (result !== false) onSuccess();
  } catch {
    // The parent action surface owns the visible error message.
  }
}

export function BatchDrawer({
  activeListId,
  busy = false,
  lists,
  message,
  onArchive,
  onArchiveMany,
  onCreateList,
  onDelete,
  onDeleteMany,
  onListSelectionActiveChange,
  onOpenArchive,
  onOpenBatch,
  onOpenSessionMode,
  onOpenSettings,
  onOpenTrash,
  onRename,
  onSelect,
  onTogglePinned,
  pinnedListIds,
  uiLanguage,
}: BatchDrawerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteListIds, setDeleteListIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const [archiveListIds, setArchiveListIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedListIds, setSelectedListIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lang = uiLanguage ?? "zh-Hans";

  const normalizedQuery = normalizedSearch(query);
  const visibleLists = useMemo(
    () =>
      normalizedQuery.length === 0
        ? lists
        : lists.filter((list) =>
            list.label.toLocaleLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, lists],
  );
  const pinnedListIdSet = useMemo(
    () => new Set(pinnedListIds ?? []),
    [pinnedListIds],
  );
  const pinningEnabled =
    pinnedListIds !== undefined || onTogglePinned !== undefined;
  const multiSelectEnabled =
    onArchiveMany !== undefined || onDeleteMany !== undefined;
  const listTitleById = useMemo(
    () => new Map(lists.map((list) => [list.id, list.label])),
    [lists],
  );
  const runningListIds = useMemo(
    () => new Set(lists.filter((list) => list.running).map((list) => list.id)),
    [lists],
  );
  const runningTitles = (listIds: readonly string[]): string[] =>
    listIds
      .filter((listId) => runningListIds.has(listId))
      .map((listId) => listTitleById.get(listId) ?? listId);
  const selectedListIdSet = useMemo(
    () => new Set(selectedListIds),
    [selectedListIds],
  );
  const visibleListIds = useMemo(
    () => visibleLists.map((list) => list.id),
    [visibleLists],
  );
  const allVisibleSelected =
    visibleListIds.length > 0 &&
    visibleListIds.every((listId) => selectedListIdSet.has(listId));
  const visibleGroups = useMemo(
    () =>
      pinningEnabled
        ? [
            {
              id: "pinned",
              label: t(lang, "drawer.groupPinnedLists"),
              lists: visibleLists.filter((list) =>
                pinnedListIdSet.has(list.id),
              ),
            },
            {
              id: "others",
              label: t(lang, "drawer.groupOtherLists"),
              lists: visibleLists.filter(
                (list) => !pinnedListIdSet.has(list.id),
              ),
            },
          ].filter((group) => group.lists.length > 0)
        : [
            {
              id: "all",
              label: t(lang, "drawer.groupListAll"),
              lists: visibleLists,
            },
          ],
    [pinnedListIdSet, pinningEnabled, visibleLists, lang],
  );

  const closeDrawer = (): void => {
    setOpen(false);
    if (open) toggleRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleDrawerKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (deleteListIds.length > 0 || archiveListIds.length > 0) return;
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDrawerKeyDown);
    return () => document.removeEventListener("keydown", handleDrawerKeyDown);
  }, [archiveListIds.length, deleteListIds.length, open]);

  useEffect(() => {
    const available = new Set(lists.map((list) => list.id));
    setSelectedListIds((current) => {
      const next = current.filter((listId) => available.has(listId));
      return next.length === current.length ? current : Object.freeze(next);
    });
  }, [lists]);

  const beginRename = (list: BatchDrawerList): void => {
    setDeleteListIds(Object.freeze([]));
    setArchiveListIds(Object.freeze([]));
    setEditingListId(list.id);
    setRenameDraft(list.label);
  };

  const leaveSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedListIds(Object.freeze([]));
    onListSelectionActiveChange?.(false);
  };

  const enterSelectionMode = (): void => {
    setEditingListId(null);
    setSelectionMode(true);
    onListSelectionActiveChange?.(true);
  };

  const toggleListSelection = (listId: string): void => {
    setSelectedListIds((current) => {
      const selected = new Set(current);
      if (selected.has(listId)) selected.delete(listId);
      else selected.add(listId);
      return Object.freeze([...selected]);
    });
  };

  const toggleAllVisibleLists = (): void => {
    setSelectedListIds((current) => {
      if (allVisibleSelected) {
        const visible = new Set(visibleListIds);
        return Object.freeze(current.filter((listId) => !visible.has(listId)));
      }
      return Object.freeze([...new Set([...current, ...visibleListIds])]);
    });
  };

  const runBatchArchive = (): void => {
    if (onArchiveMany === undefined || selectedListIds.length === 0) return;
    const hasRunningTasks = selectedListIds.some((listId) =>
      runningListIds.has(listId),
    );
    if (hasRunningTasks) {
      setArchiveListIds(selectedListIds);
      return;
    }
    closeAfterSuccessfulAction(
      () => onArchiveMany(selectedListIds),
      leaveSelectionMode,
    );
  };

  const runConfirmedArchive = (): void => {
    const listIds = archiveListIds;
    if (listIds.length === 0) return;
    const action =
      listIds.length > 1 && onArchiveMany !== undefined
        ? () => onArchiveMany(listIds)
        : onArchive !== undefined
          ? () => onArchive(listIds[0]!)
          : null;
    if (action === null) return;
    closeAfterSuccessfulAction(action, () => {
      setArchiveListIds(Object.freeze([]));
      leaveSelectionMode();
    });
  };

  const runConfirmedDelete = (): void => {
    const listIds = deleteListIds;
    if (listIds.length === 0) return;
    const action =
      listIds.length > 1 && onDeleteMany !== undefined
        ? () => onDeleteMany(listIds)
        : () => onDelete(listIds[0]!);
    closeAfterSuccessfulAction(action, () => {
      setDeleteListIds(Object.freeze([]));
      leaveSelectionMode();
    });
  };

  const submitRename = (
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
    listId: string,
  ): void => {
    event.preventDefault();
    const title = renameDraft.trim();
    if (busy || title.length === 0) return;
    closeAfterSuccessfulAction(
      () => onRename(listId, title),
      () => {
        setEditingListId(null);
        setRenameDraft("");
      },
    );
  };

  return (
    <div class="session-drawer">
      <button
        aria-controls="muzhi-batch-drawer"
        aria-expanded={open}
        aria-label={
          open ? t(lang, "drawer.closeLists") : t(lang, "drawer.openLists")
        }
        class="session-drawer__toggle"
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        type="button"
      >
        <span aria-hidden="true">›</span>
      </button>
      <button
        aria-label={t(lang, "drawer.closeListDrawerAria")}
        class={`session-drawer__overlay${open ? " is-open" : ""}`}
        onClick={closeDrawer}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-label={t(lang, "drawer.batchMode")}
        class={`session-drawer__panel${open ? " is-open" : ""}`}
        id="muzhi-batch-drawer"
        ref={panelRef}
      >
        <header class="session-drawer__header">
          <div>
            <p>{t(lang, "drawer.workspaceTitle")}</p>
            <h2>{t(lang, "drawer.workspaceModeBatch")}</h2>
          </div>
          <button
            aria-label={t(lang, "drawer.closeLists")}
            class="session-drawer__close"
            onClick={closeDrawer}
            ref={closeRef}
            type="button"
          >
            ×
          </button>
        </header>

        <nav
          aria-label={t(lang, "drawer.modeNavAria")}
          class="session-drawer__mode-navigation"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onOpenSessionMode?.();
            closeDrawer();
          }}
        >
          <button
            aria-current="page"
            class="muzhi-button muzhi-btn muzhi-btn--ghost is-active"
            disabled={!onOpenBatch}
            onClick={() => {
              onOpenBatch?.();
              closeDrawer();
            }}
            title={t(lang, "drawer.batchMode")}
            type="button"
          >
            <BilimuzhiIcon name="batch" />
            <span>{t(lang, "drawer.batchMode")}</span>
          </button>
          <button
            aria-current={undefined}
            class="muzhi-button muzhi-btn muzhi-btn--ghost"
            onClick={() => {
              onOpenSessionMode?.();
              closeDrawer();
            }}
            title={t(lang, "drawer.sessionMode")}
            type="button"
          >
            <BilimuzhiIcon name="session" />
            <span>{t(lang, "drawer.sessionMode")}</span>
          </button>
        </nav>

        <button
          class="session-drawer__create-session muzhi-btn muzhi-btn--secondary"
          disabled={busy}
          onClick={() => {
            if (onCreateList) {
              closeAfterSuccessfulAction(onCreateList, closeDrawer);
            } else {
              closeDrawer();
            }
          }}
          type="button"
        >
          {t(lang, "drawer.newList")}
        </button>

        {message ? (
          <p
            class={`session-drawer__message is-${message.kind}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}

        <label class="session-drawer__search" for="muzhi-batch-search">
          {t(lang, "drawer.searchLists")}
          <input
            id="muzhi-batch-search"
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={t(lang, "drawer.searchListPlaceholder")}
            type="search"
            value={query}
          />
        </label>

        <div
          class="session-drawer__selection-summary"
          aria-label={t(lang, "drawer.listSelectionSummaryAria")}
          data-layout={selectionMode ? "selection-header-row" : "summary-row"}
        >
          <p class="session-drawer__count" aria-live="polite">
            {t(lang, "drawer.listCount", { count: visibleLists.length })}
          </p>
          {multiSelectEnabled && lists.length > 0 ? (
            <button
              class="muzhi-button"
              disabled={busy}
              onClick={selectionMode ? leaveSelectionMode : enterSelectionMode}
              type="button"
            >
              {selectionMode
                ? t(lang, "common.cancel")
                : t(lang, "archive.multiSelect")}
            </button>
          ) : null}
        </div>
        {multiSelectEnabled && lists.length > 0 && selectionMode ? (
          <div
            aria-label={t(lang, "drawer.batchManageListsAria")}
            class="session-drawer__selection-toolbar is-selecting"
            data-layout="selection-actions-row"
            role="group"
          >
            <button
              class="session-drawer__selection-all"
              disabled={busy || visibleListIds.length === 0}
              onClick={toggleAllVisibleLists}
              type="button"
            >
              {allVisibleSelected
                ? t(lang, "drawer.deselectAll")
                : t(lang, "drawer.selectAll")}
            </button>
            <span aria-live="polite">
              {t(lang, "drawer.selectedCount", {
                count: selectedListIds.length,
              })}
            </span>
            {onArchiveMany ? (
              <button
                aria-label={t(lang, "drawer.batchArchive")}
                class="session-drawer__batch-icon"
                disabled={busy || selectedListIds.length === 0}
                onClick={runBatchArchive}
                title={t(lang, "drawer.batchArchive")}
                type="button"
              >
                <BilimuzhiIcon name="archive" title="" />
              </button>
            ) : null}
            {onDeleteMany ? (
              <button
                aria-label={t(lang, "drawer.batchDelete")}
                class="session-drawer__batch-icon is-danger"
                disabled={busy || selectedListIds.length === 0}
                onClick={() => setDeleteListIds(selectedListIds)}
                title={t(lang, "drawer.batchDelete")}
                type="button"
              >
                <BilimuzhiIcon name="trash" title="" />
              </button>
            ) : null}
          </div>
        ) : null}
        {visibleLists.length === 0 ? (
          <p class="session-drawer__empty">
            {lists.length === 0
              ? t(lang, "drawer.noLists")
              : t(lang, "drawer.noListMatch")}
          </p>
        ) : (
          <div class="session-drawer__groups">
            {visibleGroups.map((group) => (
              <section class="session-drawer__group" key={group.id}>
                {pinningEnabled ? <h3>{group.label}</h3> : null}
                <ul aria-label={group.label} class="session-drawer__list">
                  {group.lists.map((list) => {
                    const active = list.id === activeListId;
                    const editing = list.id === editingListId;
                    const pinned = pinnedListIdSet.has(list.id);
                    const selected = selectedListIdSet.has(list.id);
                    return (
                      <li
                        aria-selected={selectionMode ? selected : undefined}
                        class={
                          `${active ? "is-active" : ""}${
                            selected ? " is-selected" : ""
                          }`.trim() || undefined
                        }
                        key={list.id}
                        onClick={(event) => {
                          if (
                            selectionMode &&
                            event.currentTarget === event.target
                          ) {
                            toggleListSelection(list.id);
                          }
                        }}
                      >
                        <div
                          class={`session-drawer__row${
                            selectionMode ? " is-selecting" : ""
                          }`}
                        >
                          {selectionMode ? (
                            <input
                              aria-label={t(lang, "drawer.selectList", {
                                title: list.label,
                              })}
                              checked={selected}
                              class="session-drawer__checkbox"
                              disabled={busy}
                              onChange={() => toggleListSelection(list.id)}
                              type="checkbox"
                            />
                          ) : null}
                          <button
                            aria-current={active ? "page" : undefined}
                            aria-label={
                              selectionMode
                                ? t(lang, "drawer.selectList", {
                                    title: list.label,
                                  })
                                : t(lang, "drawer.openList", {
                                    title: list.label,
                                  })
                            }
                            class="session-drawer__select"
                            disabled={busy}
                            onClick={() =>
                              selectionMode
                                ? toggleListSelection(list.id)
                                : onSelect(list.id)
                            }
                            title={list.label}
                            type="button"
                          >
                            <strong>{list.label}</strong>
                          </button>
                          <span
                            aria-label={
                              list.running
                                ? t(lang, "drawer.listRunningIndicator", {
                                    title: list.label,
                                  })
                                : undefined
                            }
                            aria-hidden={list.running ? undefined : "true"}
                            class={`session-drawer__state-slot${
                              list.running ? " is-running" : ""
                            }`}
                          />
                          {!selectionMode ? (
                            <CompactActionMenu
                              ariaLabel={t(lang, "drawer.listActionsAria", {
                                title: list.label,
                              })}
                              items={[
                                {
                                  disabled: busy,
                                  icon: "pencil",
                                  kind: "item",
                                  label: t(lang, "drawer.actionRename"),
                                  onSelect: () => beginRename(list),
                                },
                                ...(onArchive
                                  ? [
                                      {
                                        disabled: busy,
                                        icon: "archive" as const,
                                        kind: "item" as const,
                                        label: t(lang, "drawer.actionArchive"),
                                        onSelect: () => {
                                          if (runningListIds.has(list.id)) {
                                            setArchiveListIds(
                                              Object.freeze([list.id]),
                                            );
                                            return;
                                          }
                                          closeAfterSuccessfulAction(
                                            () => onArchive(list.id),
                                            () => undefined,
                                          );
                                        },
                                      },
                                    ]
                                  : []),
                                ...(onTogglePinned
                                  ? [
                                      {
                                        disabled: busy,
                                        icon: pinned
                                          ? ("pin-off" as const)
                                          : ("pin" as const),
                                        kind: "item" as const,
                                        label: pinned
                                          ? t(lang, "drawer.actionUnpin")
                                          : t(lang, "drawer.actionPin"),
                                        onSelect: () => {
                                          closeAfterSuccessfulAction(
                                            () =>
                                              onTogglePinned(list.id, !pinned),
                                            () => undefined,
                                          );
                                        },
                                      },
                                    ]
                                  : []),
                                { kind: "separator" },
                                {
                                  danger: true,
                                  disabled: busy,
                                  icon: "trash",
                                  kind: "item",
                                  label: t(lang, "drawer.actionDelete"),
                                  onSelect: () => {
                                    setEditingListId(null);
                                    setDeleteListIds(Object.freeze([list.id]));
                                  },
                                },
                              ]}
                            />
                          ) : null}
                        </div>

                        {editing ? (
                          <form
                            class="session-drawer__rename"
                            onSubmit={(event) => submitRename(event, list.id)}
                          >
                            <label>
                              {t(lang, "drawer.listRenameLabel")}
                              <input
                                disabled={busy}
                                onInput={(event) =>
                                  setRenameDraft(event.currentTarget.value)
                                }
                                value={renameDraft}
                              />
                            </label>
                            <div>
                              <button
                                class="muzhi-button"
                                disabled={
                                  busy || renameDraft.trim().length === 0
                                }
                                type="submit"
                              >
                                {t(lang, "drawer.saveName")}
                              </button>
                              <button
                                class="muzhi-button"
                                onClick={() => setEditingListId(null)}
                                type="button"
                              >
                                {t(lang, "drawer.cancelRename")}
                              </button>
                            </div>
                          </form>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        {onOpenArchive || onOpenTrash || onOpenSettings ? (
          <nav
            aria-label={t(lang, "drawer.utilityNavAria")}
            class="session-drawer__utilities"
          >
            {onOpenArchive ? (
              <button
                aria-label={t(lang, "drawer.openArchive")}
                class="muzhi-button"
                onClick={() => {
                  onOpenArchive();
                  closeDrawer();
                }}
                title={t(lang, "archive.title")}
                type="button"
              >
                <BilimuzhiIcon name="archive" title="" />
              </button>
            ) : null}
            {onOpenTrash ? (
              <button
                aria-label={t(lang, "drawer.openTrash")}
                class="muzhi-button"
                onClick={() => {
                  onOpenTrash();
                  closeDrawer();
                }}
                title={t(lang, "trash.title")}
                type="button"
              >
                <BilimuzhiIcon name="trash" title="" />
              </button>
            ) : null}
            {onOpenSettings ? (
              <button
                aria-label={t(lang, "drawer.openSettings")}
                class="muzhi-button"
                onClick={() => {
                  onOpenSettings();
                  closeDrawer();
                }}
                title={t(lang, "settings.title")}
                type="button"
              >
                <BilimuzhiIcon name="settings" title="" />
              </button>
            ) : null}
          </nav>
        ) : null}
      </aside>
      {deleteListIds.length > 0 ? (
        <AppDialog
          busy={busy}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={
            deleteListIds.some((listId) => runningListIds.has(listId))
              ? deleteListIds.length === 1
                ? t(lang, "drawer.deleteListRunningWarning")
                : t(lang, "drawer.runningListNames", {
                    names: runningTitles(deleteListIds).join("、"),
                  })
              : undefined
          }
          onCancel={() => setDeleteListIds(Object.freeze([]))}
          onConfirm={() => runConfirmedDelete()}
          title={
            deleteListIds.length === 1
              ? t(lang, "drawer.confirmDeleteListTitle")
              : t(lang, "drawer.confirmDeleteListsMany", {
                  count: deleteListIds.length,
                })
          }
        />
      ) : null}
      {archiveListIds.length > 0 ? (
        <AppDialog
          busy={busy}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={
            archiveListIds.some((listId) => runningListIds.has(listId))
              ? archiveListIds.length === 1
                ? t(lang, "drawer.archiveListRunningWarning")
                : t(lang, "drawer.runningListNames", {
                    names: runningTitles(archiveListIds).join("、"),
                  })
              : undefined
          }
          onCancel={() => setArchiveListIds(Object.freeze([]))}
          onConfirm={() => runConfirmedArchive()}
          title={
            archiveListIds.length === 1
              ? t(lang, "drawer.confirmArchiveListTitle")
              : t(lang, "drawer.confirmArchiveListsMany", {
                  count: archiveListIds.length,
                })
          }
        />
      ) : null}
    </div>
  );
}
