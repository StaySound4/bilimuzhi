import type { UiLanguage } from "../i18n/languages";
import { t } from "../i18n";
import { type JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { Session } from "../domain";
import { AppDialog } from "./dialogs/app-dialog";
import { CompactActionMenu } from "./primitives/compact-action-menu";
import { BilimuzhiIcon } from "./icons";
export interface SessionDrawerMessage {
  readonly kind: "error" | "status";
  readonly text: string;
}

export type SessionDrawerActionResult =
  boolean | void | Promise<boolean | void>;

export interface SessionDrawerProps {
  readonly uiLanguage?: UiLanguage;
  readonly activeWorkspaceMode?: "batch" | "session";
  readonly activeSessionId?: string | null;
  readonly busy?: boolean;
  readonly message?: SessionDrawerMessage;
  readonly indicators?: Readonly<
    Record<string, { readonly running: boolean; readonly unread: boolean }>
  >;
  readonly onBindCurrent: () => SessionDrawerActionResult;
  readonly onBindIdentifier: (value: string) => SessionDrawerActionResult;
  readonly onArchive?: (sessionId: string) => SessionDrawerActionResult;
  readonly onArchiveMany?: (
    sessionIds: readonly string[],
  ) => SessionDrawerActionResult;
  readonly onDelete: (sessionId: string) => SessionDrawerActionResult;
  readonly onDeleteMany?: (
    sessionIds: readonly string[],
  ) => SessionDrawerActionResult;
  readonly onCreateSession?: () => SessionDrawerActionResult;
  readonly onOpenArchive?: () => void;
  readonly onOpenBatch?: () => void;
  readonly onOpenSessionMode?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onOpenTrash?: () => void;
  readonly onReorder?: (
    sessionId: string,
    beforeSessionId: string | null,
  ) => SessionDrawerActionResult;
  readonly onRename: (
    sessionId: string,
    title: string,
  ) => SessionDrawerActionResult;
  readonly onSelect: (sessionId: string) => SessionDrawerActionResult;
  readonly onTogglePinned?: (
    sessionId: string,
    pinned: boolean,
  ) => SessionDrawerActionResult;
  readonly pinnedSessionIds?: readonly string[];
  readonly sessions: readonly Session[];
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function closeAfterSuccessfulAction(
  action: () => SessionDrawerActionResult,
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

export function SessionDrawer({
  uiLanguage,
  activeWorkspaceMode = "session",
  activeSessionId,
  busy = false,
  indicators = {},
  message,
  onArchive,
  onArchiveMany,
  onCreateSession,
  onDelete,
  onDeleteMany,
  onOpenArchive,
  onOpenBatch,
  onOpenSessionMode,
  onOpenSettings,
  onOpenTrash,
  onReorder,
  onRename,
  onSelect,
  onTogglePinned,
  pinnedSessionIds,
  sessions,
}: SessionDrawerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteSessionIds, setDeleteSessionIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const [archiveSessionIds, setArchiveSessionIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<
    readonly string[]
  >(Object.freeze([]));
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(
    null,
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const normalizedQuery = normalizedSearch(query);
  const visibleSessions = useMemo(
    () =>
      normalizedQuery.length === 0
        ? sessions
        : sessions.filter(
            (session) =>
              session.title.toLocaleLowerCase().includes(normalizedQuery) ||
              session.videoKey.toLocaleLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, sessions],
  );
  const pinnedSessionIdSet = useMemo(
    () => new Set(pinnedSessionIds ?? []),
    [pinnedSessionIds],
  );
  const pinningEnabled =
    pinnedSessionIds !== undefined || onTogglePinned !== undefined;
  const multiSelectEnabled =
    onArchiveMany !== undefined || onDeleteMany !== undefined;
  const sessionTitleById = useMemo(
    () =>
      new Map(sessions.map((session) => [session.sessionId, session.title])),
    [sessions],
  );
  const runningSessionIds = useMemo(
    () =>
      new Set(
        sessions
          .filter((session) => indicators[session.sessionId]?.running === true)
          .map((session) => session.sessionId),
      ),
    [indicators, sessions],
  );
  const runningTitles = (sessionIds: readonly string[]): string[] =>
    sessionIds
      .filter((sessionId) => runningSessionIds.has(sessionId))
      .map((sessionId) => sessionTitleById.get(sessionId) ?? sessionId);
  const selectedSessionIdSet = useMemo(
    () => new Set(selectedSessionIds),
    [selectedSessionIds],
  );
  const visibleSessionIds = useMemo(
    () => visibleSessions.map((session) => session.sessionId),
    [visibleSessions],
  );
  const allVisibleSelected =
    visibleSessionIds.length > 0 &&
    visibleSessionIds.every((sessionId) => selectedSessionIdSet.has(sessionId));
  const lang = uiLanguage ?? "zh-Hans";
  const drawerLabel =
    activeWorkspaceMode === "batch"
      ? t(lang, "drawer.batchMode")
      : t(lang, "drawer.sessionShort");
  // session without subtitles can be archived just like any other.
  const selectedSessionsCanArchive = selectedSessionIds.length > 0;
  const visibleGroups = useMemo(
    () =>
      pinningEnabled
        ? [
            {
              id: "pinned",
              label: t(lang, "drawer.groupPinned"),
              sessions: visibleSessions.filter((session) =>
                pinnedSessionIdSet.has(session.sessionId),
              ),
            },
            {
              id: "others",
              label: t(lang, "drawer.groupOthers"),
              sessions: visibleSessions.filter(
                (session) => !pinnedSessionIdSet.has(session.sessionId),
              ),
            },
          ].filter((group) => group.sessions.length > 0)
        : [
            {
              id: "all",
              label: t(lang, "drawer.groupAll"),
              sessions: visibleSessions,
            },
          ],
    [pinnedSessionIdSet, pinningEnabled, visibleSessions],
  );

  const closeDrawer = (): void => {
    setOpen(false);
    if (open) toggleRef.current?.focus();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    const handleDrawerKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (deleteSessionIds.length > 0) return;
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        return;
      }
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
  }, [deleteSessionIds.length, open]);

  useEffect(() => {
    const available = new Set(sessions.map((session) => session.sessionId));
    setSelectedSessionIds((current) => {
      const next = current.filter((sessionId) => available.has(sessionId));
      return next.length === current.length ? current : Object.freeze(next);
    });
  }, [sessions]);

  const beginRename = (session: Session): void => {
    setDeleteSessionIds(Object.freeze([]));
    setEditingSessionId(session.sessionId);
    setRenameDraft(session.title);
  };

  const leaveSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedSessionIds(Object.freeze([]));
  };

  const toggleSessionSelection = (sessionId: string): void => {
    setSelectedSessionIds((current) => {
      const selected = new Set(current);
      if (selected.has(sessionId)) selected.delete(sessionId);
      else selected.add(sessionId);
      return Object.freeze([...selected]);
    });
  };

  const toggleAllVisibleSessions = (): void => {
    setSelectedSessionIds((current) => {
      if (allVisibleSelected) {
        const visible = new Set(visibleSessionIds);
        return Object.freeze(
          current.filter((sessionId) => !visible.has(sessionId)),
        );
      }
      return Object.freeze([...new Set([...current, ...visibleSessionIds])]);
    });
  };

  const runBatchArchive = (): void => {
    if (onArchiveMany === undefined || selectedSessionIds.length === 0) return;
    const hasRunningTasks = selectedSessionIds.some((sessionId) =>
      runningSessionIds.has(sessionId),
    );
    if (hasRunningTasks) {
      setArchiveSessionIds(selectedSessionIds);
      return;
    }
    closeAfterSuccessfulAction(
      () => onArchiveMany(selectedSessionIds),
      leaveSelectionMode,
    );
  };

  const runConfirmedArchive = (): void => {
    const sessionIds = archiveSessionIds;
    if (sessionIds.length === 0) return;
    const action =
      sessionIds.length > 1 && onArchiveMany !== undefined
        ? () => onArchiveMany(sessionIds)
        : onArchive !== undefined
          ? () => onArchive(sessionIds[0]!)
          : null;
    if (action === null) return;
    closeAfterSuccessfulAction(action, () => {
      setArchiveSessionIds(Object.freeze([]));
      leaveSelectionMode();
    });
  };

  const runConfirmedDelete = (): void => {
    const sessionIds = deleteSessionIds;
    if (sessionIds.length === 0) return;
    const action =
      sessionIds.length > 1 && onDeleteMany !== undefined
        ? () => onDeleteMany(sessionIds)
        : () => onDelete(sessionIds[0]!);
    closeAfterSuccessfulAction(action, () => {
      setDeleteSessionIds(Object.freeze([]));
      leaveSelectionMode();
    });
  };

  const submitRename = (
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
    sessionId: string,
  ): void => {
    event.preventDefault();
    const title = renameDraft.trim();
    if (busy || title.length === 0) {
      return;
    }
    closeAfterSuccessfulAction(
      () => onRename(sessionId, title),
      () => {
        setEditingSessionId(null);
        setRenameDraft("");
      },
    );
  };

  return (
    <div class="session-drawer">
      <button
        aria-controls="muzhi-session-drawer"
        aria-expanded={open}
        aria-label={
          activeWorkspaceMode === "batch"
            ? open
              ? t(lang, "drawer.closeBatchNav")
              : t(lang, "drawer.openBatchNav")
            : open
              ? t(lang, "drawer.closeSessions")
              : t(lang, "drawer.openSessions")
        }
        class="session-drawer__toggle"
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        type="button"
      >
        <span aria-hidden="true">›</span>
      </button>
      <button
        aria-label={t(lang, "drawer.closeDrawerAria")}
        class={`session-drawer__overlay${open ? " is-open" : ""}`}
        onClick={closeDrawer}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-label={drawerLabel}
        class={`session-drawer__panel${open ? " is-open" : ""}`}
        id="muzhi-session-drawer"
        ref={panelRef}
      >
        <header class="session-drawer__header">
          <div>
            <p>{t(lang, "drawer.workspaceTitle")}</p>
            <h2>
              {activeWorkspaceMode === "batch"
                ? t(lang, "drawer.workspaceModeBatch")
                : t(lang, "drawer.workspaceMode")}
            </h2>
          </div>
          <button
            aria-label={
              activeWorkspaceMode === "batch"
                ? t(lang, "drawer.closeBatchNav")
                : t(lang, "drawer.closeSessions")
            }
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
            if (activeWorkspaceMode === "batch") onOpenSessionMode?.();
            else onOpenBatch?.();
            closeDrawer();
          }}
        >
          <button
            aria-current={activeWorkspaceMode === "batch" ? "page" : undefined}
            class={`muzhi-button muzhi-btn muzhi-btn--ghost${
              activeWorkspaceMode === "batch" ? " is-active" : ""
            }`}
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
            aria-current={
              activeWorkspaceMode === "session" ? "page" : undefined
            }
            class={`muzhi-button muzhi-btn muzhi-btn--ghost${
              activeWorkspaceMode === "session" ? " is-active" : ""
            }`}
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

        {activeWorkspaceMode === "session" ? (
          <button
            class="session-drawer__create-session muzhi-btn muzhi-btn--secondary"
            disabled={busy}
            onClick={() => {
              if (onCreateSession) {
                closeAfterSuccessfulAction(onCreateSession, closeDrawer);
              } else {
                closeDrawer();
              }
            }}
            type="button"
          >
            {t(lang, "drawer.newSession")}
          </button>
        ) : (
          <p class="session-drawer__batch-guide">
            {t(lang, "drawer.batchModeHint")}
          </p>
        )}

        {activeWorkspaceMode === "session" && message ? (
          <p
            class={`session-drawer__message is-${message.kind}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}

        {activeWorkspaceMode === "session" ? (
          <label class="session-drawer__search" for="muzhi-session-search">
            {t(lang, "drawer.searchSessions")}
            <input
              id="muzhi-session-search"
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={t(lang, "drawer.searchPlaceholder")}
              type="search"
              value={query}
            />
          </label>
        ) : null}

        {activeWorkspaceMode === "session" ? (
          <div
            class="session-drawer__selection-summary"
            aria-label={t(lang, "drawer.selectionSummaryAria")}
            data-layout={selectionMode ? "selection-header-row" : "summary-row"}
          >
            <p class="session-drawer__count" aria-live="polite">
              {t(lang, "drawer.sessionCount", {
                count: visibleSessions.length,
              })}
            </p>
            {multiSelectEnabled && sessions.length > 0 ? (
              <button
                class="muzhi-button"
                disabled={busy}
                onClick={
                  selectionMode
                    ? leaveSelectionMode
                    : () => {
                        setEditingSessionId(null);
                        setSelectionMode(true);
                      }
                }
                type="button"
              >
                {selectionMode
                  ? t(lang, "common.cancel")
                  : t(lang, "archive.multiSelect")}
              </button>
            ) : null}
          </div>
        ) : null}
        {activeWorkspaceMode === "session" &&
        multiSelectEnabled &&
        sessions.length > 0 &&
        selectionMode ? (
          <div
            aria-label={t(lang, "drawer.batchManageAria")}
            class="session-drawer__selection-toolbar is-selecting"
            data-layout="selection-actions-row"
            role="group"
          >
            <button
              class="session-drawer__selection-all"
              disabled={busy || visibleSessionIds.length === 0}
              onClick={toggleAllVisibleSessions}
              type="button"
            >
              {allVisibleSelected
                ? t(lang, "drawer.deselectAll")
                : t(lang, "drawer.selectAll")}
            </button>
            <span aria-live="polite">
              {t(lang, "drawer.selectedCount", {
                count: selectedSessionIds.length,
              })}
            </span>
            {onArchiveMany ? (
              <button
                aria-label={t(lang, "drawer.batchArchive")}
                class="session-drawer__batch-icon"
                disabled={busy || !selectedSessionsCanArchive}
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
                disabled={busy || selectedSessionIds.length === 0}
                onClick={() => setDeleteSessionIds(selectedSessionIds)}
                title={t(lang, "drawer.batchDelete")}
                type="button"
              >
                <BilimuzhiIcon name="trash" title="" />
              </button>
            ) : null}
          </div>
        ) : null}
        {activeWorkspaceMode !== "session" ? null : visibleSessions.length ===
          0 ? (
          <p class="session-drawer__empty">
            {sessions.length === 0
              ? t(lang, "drawer.noSessions")
              : t(lang, "drawer.noMatch")}
          </p>
        ) : (
          <div class="session-drawer__groups">
            {visibleGroups.map((group) => (
              <section class="session-drawer__group" key={group.id}>
                {pinningEnabled ? <h3>{group.label}</h3> : null}
                <ul aria-label={group.label} class="session-drawer__list">
                  {group.sessions.map((session) => {
                    const active = session.sessionId === activeSessionId;
                    const editing = session.sessionId === editingSessionId;
                    const pinned = pinnedSessionIdSet.has(session.sessionId);
                    const selected = selectedSessionIdSet.has(
                      session.sessionId,
                    );
                    const indicator = indicators[session.sessionId];
                    return (
                      <li
                        aria-selected={selectionMode ? selected : undefined}
                        class={
                          `${active ? "is-active" : ""}${
                            selected ? " is-selected" : ""
                          }`.trim() || undefined
                        }
                        draggable={
                          onReorder !== undefined && !busy && !selectionMode
                        }
                        key={session.sessionId}
                        onClick={(event) => {
                          if (
                            selectionMode &&
                            event.currentTarget === event.target
                          ) {
                            toggleSessionSelection(session.sessionId);
                          }
                        }}
                        onDragEnd={() => setDraggingSessionId(null)}
                        onDragOver={(event) => {
                          if (
                            draggingSessionId !== null &&
                            draggingSessionId !== session.sessionId &&
                            pinnedSessionIdSet.has(draggingSessionId) === pinned
                          ) {
                            event.preventDefault();
                          }
                        }}
                        onDragStart={() =>
                          setDraggingSessionId(session.sessionId)
                        }
                        onDrop={(event) => {
                          if (
                            onReorder === undefined ||
                            draggingSessionId === null ||
                            draggingSessionId === session.sessionId ||
                            pinnedSessionIdSet.has(draggingSessionId) !== pinned
                          ) {
                            return;
                          }
                          event.preventDefault();
                          closeAfterSuccessfulAction(
                            () =>
                              onReorder(draggingSessionId, session.sessionId),
                            () => setDraggingSessionId(null),
                          );
                        }}
                      >
                        <div
                          class={`session-drawer__row${
                            selectionMode ? " is-selecting" : ""
                          }`}
                        >
                          {selectionMode ? (
                            <input
                              aria-label={t(lang, "drawer.selectCheckbox", {
                                title: session.title,
                              })}
                              checked={selected}
                              class="session-drawer__checkbox"
                              disabled={busy}
                              onChange={() =>
                                toggleSessionSelection(session.sessionId)
                              }
                              type="checkbox"
                            />
                          ) : null}
                          <button
                            aria-current={active ? "page" : undefined}
                            aria-label={
                              selectionMode
                                ? t(lang, "drawer.selectSession", {
                                    title: session.title,
                                  })
                                : t(lang, "drawer.openSession", {
                                    title: session.title,
                                  })
                            }
                            class="session-drawer__select"
                            disabled={busy}
                            onClick={() =>
                              selectionMode
                                ? toggleSessionSelection(session.sessionId)
                                : onSelect(session.sessionId)
                            }
                            title={session.title}
                            type="button"
                          >
                            <strong>{session.title}</strong>
                          </button>
                          <span
                            aria-label={
                              indicator?.running
                                ? t(lang, "drawer.runningIndicator", {
                                    title: session.title,
                                  })
                                : indicator?.unread
                                  ? t(lang, "drawer.unreadIndicator", {
                                      title: session.title,
                                    })
                                  : undefined
                            }
                            aria-hidden={indicator ? undefined : "true"}
                            class={`session-drawer__state-slot${
                              indicator?.running
                                ? " is-running"
                                : indicator?.unread
                                  ? " is-unread"
                                  : ""
                            }`}
                          />
                          {!selectionMode ? (
                            <CompactActionMenu
                              ariaLabel={t(lang, "drawer.sessionActionsAria", {
                                title: session.title,
                              })}
                              items={[
                                {
                                  disabled: busy,
                                  icon: "pencil",
                                  kind: "item",
                                  label: t(lang, "drawer.actionRename"),
                                  onSelect: () => beginRename(session),
                                },
                                ...(onArchive
                                  ? [
                                      {
                                        disabled: busy,
                                        icon: "archive" as const,
                                        kind: "item" as const,
                                        label: t(lang, "drawer.actionArchive"),
                                        onSelect: () => {
                                          if (
                                            runningSessionIds.has(
                                              session.sessionId,
                                            )
                                          ) {
                                            setArchiveSessionIds(
                                              Object.freeze([
                                                session.sessionId,
                                              ]),
                                            );
                                            return;
                                          }
                                          closeAfterSuccessfulAction(
                                            () => onArchive(session.sessionId),
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
                                              onTogglePinned(
                                                session.sessionId,
                                                !pinned,
                                              ),
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
                                    setEditingSessionId(null);
                                    setDeleteSessionIds(
                                      Object.freeze([session.sessionId]),
                                    );
                                  },
                                },
                              ]}
                            />
                          ) : null}
                        </div>

                        {editing ? (
                          <form
                            class="session-drawer__rename"
                            onSubmit={(event) =>
                              submitRename(event, session.sessionId)
                            }
                          >
                            <label>
                              {t(lang, "drawer.renameLabel")}
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
                                onClick={() => setEditingSessionId(null)}
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
      {deleteSessionIds.length > 0 ? (
        <AppDialog
          busy={busy}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={
            deleteSessionIds.some((sessionId) =>
              runningSessionIds.has(sessionId),
            )
              ? deleteSessionIds.length === 1
                ? t(lang, "drawer.deleteRunningWarning")
                : t(lang, "drawer.runningNames", {
                    names: runningTitles(deleteSessionIds).join("、"),
                  })
              : undefined
          }
          onCancel={() => setDeleteSessionIds(Object.freeze([]))}
          onConfirm={() => runConfirmedDelete()}
          title={
            deleteSessionIds.length === 1
              ? t(lang, "drawer.confirmDeleteTitle")
              : t(lang, "drawer.confirmDeleteMany", {
                  count: deleteSessionIds.length,
                })
          }
        />
      ) : null}
      {archiveSessionIds.length > 0 ? (
        <AppDialog
          busy={busy}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={
            archiveSessionIds.some((sessionId) =>
              runningSessionIds.has(sessionId),
            )
              ? archiveSessionIds.length === 1
                ? t(lang, "drawer.archiveRunningWarning")
                : t(lang, "drawer.runningNames", {
                    names: runningTitles(archiveSessionIds).join("、"),
                  })
              : undefined
          }
          onCancel={() => setArchiveSessionIds(Object.freeze([]))}
          onConfirm={() => runConfirmedArchive()}
          title={
            archiveSessionIds.length === 1
              ? t(lang, "drawer.confirmArchiveTitle")
              : t(lang, "drawer.confirmArchiveMany", {
                  count: archiveSessionIds.length,
                })
          }
        />
      ) : null}
    </div>
  );
}
