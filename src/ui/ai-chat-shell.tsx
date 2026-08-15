import { type JSX } from "preact";
import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import { useEffect, useRef, useState } from "preact/hooks";

import type {
  RestoredWorkspace,
  SessionWorkspaceState,
  WorkspaceMode,
  WorkspaceScrollPositions,
} from "../application/workspace-restoration";
import { isSessionVideoBound, parseVideoKey } from "../domain";
import {
  AppearanceControls,
  DEFAULT_APPEARANCE_PREFERENCE,
  type AppearancePreference,
} from "./appearance";
import {
  ArchiveWorkspace,
  type ArchiveWorkspaceProps,
} from "./archive/archive-workspace";
import { ChatWorkspace, type ChatWorkspaceProps } from "./chat/chat-workspace";
import {
  BatchWorkspace,
  type BatchWorkspaceProps,
} from "./batch/batch-workspace";
import { BatchDrawer, type BatchDrawerProps } from "./batch/batch-drawer";
import type { MessageKey } from "../i18n/messages";
import type { BatchHelpContext } from "./batch/batch-contracts";
import {
  BatchArchiveWorkspace,
  type BatchArchiveWorkspaceProps,
} from "./batch/batch-archive-workspace";
import {
  BatchTrashWorkspace,
  type BatchTrashWorkspaceProps,
} from "./batch/batch-trash-workspace";
import { AppDialog, type AppDialogProps } from "./dialogs/app-dialog";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "./insights/insight-workspace";
import {
  ConversationSplitter,
  DEFAULT_CONVERSATION_PANE_WIDTH_PX,
  TWO_PANE_BREAKPOINT_PX,
  clampConversationPaneWidth,
} from "./conversation-splitter";
import {
  SessionDrawer,
  type SessionDrawerActionResult,
  type SessionDrawerProps,
} from "./session-drawer";
import {
  SettingsDrawer,
  type SettingsDrawerProps,
} from "./settings/settings-drawer";
import {
  PromptManagerDialog,
  type PromptManagerDialogProps,
} from "./prompts/prompt-manager-dialog";
import {
  SubtitleAcquisitionPanel,
  type SubtitleAcquisitionPanelProps,
} from "./subtitle-acquisition-panel";
import {
  SpeechAcquisitionPanel,
  type SpeechAcquisitionPanelProps,
} from "./asr/speech-acquisition-panel";
import {
  SubtitleTimeline,
  type SubtitleTimelineProps,
} from "./subtitle-timeline";
import {
  TrashWorkspace,
  type TrashWorkspaceProps,
} from "./trash/trash-workspace";

export type ShellUtilityView =
  "archive" | "batch" | "batch-archive" | "batch-trash" | "trash" | "workspace";

const WORKSPACE_MODES = [
  {
    descriptionKey: "shell.timelinePlaceholder",
    id: "timeline",
    labelKey: "shell.timeline",
  },
  {
    descriptionKey: "shell.segmentsPlaceholder",
    id: "segments",
    labelKey: "shell.segments",
  },
  {
    descriptionKey: "shell.summaryPlaceholder",
    id: "summary",
    labelKey: "shell.summary",
  },
  {
    descriptionKey: "shell.chatPlaceholder",
    id: "chat",
    labelKey: "shell.chat",
  },
] as const;

const HELP_TITLE_KEY: Readonly<Record<BatchHelpContext, MessageKey>> =
  Object.freeze({
    "batch-archive": "shell.helpBatchArchiveTitle",
    "batch-trash": "shell.helpBatchTrashTitle",
    "batch-workspace": "shell.helpBatchTitle",
    "session-archive": "shell.helpSessionArchiveTitle",
    "session-trash": "shell.helpSessionTrashTitle",
    "session-workspace": "shell.helpSessionTitle",
  });

const HELP_BODY_KEY: Readonly<Record<BatchHelpContext, MessageKey>> =
  Object.freeze({
    "batch-archive": "shell.helpBatchArchiveBody",
    "batch-trash": "shell.helpBatchTrashBody",
    "batch-workspace": "shell.helpBatchBody",
    "session-archive": "shell.helpSessionArchiveBody",
    "session-trash": "shell.helpSessionTrashBody",
    "session-workspace": "shell.helpSessionBody",
  });

/** 六语境纯帮助 Dialog：单关闭按钮、Escape、遮罩、焦点圈定与回焦。 */
function HelpDialogView({
  context,
  onClose,
  uiLanguage,
}: {
  readonly context: BatchHelpContext;
  readonly onClose?: () => void;
  readonly uiLanguage?: UiLanguage;
}) {
  const lang = uiLanguage ?? "zh-Hans";
  const [dismissed, setDismissed] = useState(false);
  const close = (): void => {
    setDismissed(true);
    onClose?.();
  };
  if (dismissed) return null;
  return (
    <AppDialog
      description={t(lang, HELP_BODY_KEY[context])}
      onCancel={close}
      onConfirm={() => close()}
      role="dialog"
      singleAction
      title={t(lang, HELP_TITLE_KEY[context])}
      uiLanguage={lang}
    />
  );
}

const EMPTY_SCROLL_POSITIONS: WorkspaceScrollPositions = Object.freeze({
  chat: 0,
  segments: 0,
  summary: 0,
  timeline: 0,
});

export interface AiChatShellProps {
  readonly actionMessage?: SessionDrawerProps["message"];
  readonly archive?: ArchiveWorkspaceProps;
  readonly appearance?: AppearancePreference;
  readonly batch?: BatchWorkspaceProps;
  readonly batchDrawer?: BatchDrawerProps;
  readonly chat?: ChatWorkspaceProps;
  readonly conversationPaneWidthPx?: number;
  readonly dialog?: AppDialogProps;
  readonly onAppearanceChange?: (preference: AppearancePreference) => void;
  readonly onConversationPaneWidthChange?: (width: number) => void;
  readonly onOpenSettings?: () => void;
  readonly onUtilityViewChange?: (view: ShellUtilityView) => void;
  readonly onHelpClick?: () => void;
  readonly helpDialog?: { readonly context: BatchHelpContext } | null;
  readonly onWorkspaceViewChange?: (state: SessionWorkspaceState) => void;
  readonly pageIsStale?: boolean;
  /** 界面语言（docs/i18n-spec.md §2）。 */
  readonly uiLanguage?: UiLanguage;
  readonly promptManager?: PromptManagerDialogProps;
  readonly readOnly?: {
    readonly onGuard: (action: () => void) => void;
    readonly onRestoreToWorkspace: () => void;
    readonly onReturnToArchive: () => void;
  };
  readonly restoredWorkspace?: RestoredWorkspace;
  readonly segments?: InsightWorkspaceProps;
  readonly sessionDrawer?: SessionDrawerProps;
  readonly settings?: SettingsDrawerProps;
  readonly speechAcquisition?: SpeechAcquisitionPanelProps;
  readonly subtitleAcquisition?: SubtitleAcquisitionPanelProps;
  readonly summary?: InsightWorkspaceProps;
  readonly timeline?: SubtitleTimelineProps;
  readonly trash?: TrashWorkspaceProps;
  readonly utilityView?: ShellUtilityView;
  readonly batchArchive?: BatchArchiveWorkspaceProps;
  readonly batchTrash?: BatchTrashWorkspaceProps;
}

export function AiChatShell({
  actionMessage,
  archive,
  appearance,
  batch,
  batchDrawer,
  chat,
  conversationPaneWidthPx,
  dialog,
  onAppearanceChange,
  onConversationPaneWidthChange,
  onOpenSettings,
  batchArchive,
  batchTrash,
  onHelpClick,
  helpDialog,
  onUtilityViewChange,
  onWorkspaceViewChange,
  pageIsStale = false,
  promptManager,
  readOnly,
  restoredWorkspace,
  segments,
  sessionDrawer,
  settings,
  uiLanguage,
  speechAcquisition,
  subtitleAcquisition,
  summary,
  timeline,
  trash,
  utilityView,
}: AiChatShellProps = {}) {
  const appRef = useRef<HTMLDivElement>(null);
  const [localAppearance, setLocalAppearance] = useState<AppearancePreference>(
    appearance ?? DEFAULT_APPEARANCE_PREFERENCE,
  );
  const [paneWidth, setPaneWidth] = useState(
    conversationPaneWidthPx ?? DEFAULT_CONVERSATION_PANE_WIDTH_PX,
  );
  const [activeMode, setActiveMode] = useState<WorkspaceMode>(
    restoredWorkspace?.activeMode ?? "timeline",
  );
  const [localUtilityView, setLocalUtilityView] = useState<ShellUtilityView>(
    utilityView ?? "workspace",
  );
  const [sessionIdentifier, setSessionIdentifier] = useState("");
  const [reacquiringSubtitle, setReacquiringSubtitle] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastPaused, setToastPaused] = useState(false);
  const [scrollTopByMode, setScrollTopByMode] =
    useState<WorkspaceScrollPositions>(() => ({
      ...(restoredWorkspace?.scrollTopByMode ?? EMPTY_SCROLL_POSITIONS),
    }));
  const scrollTopByModeRef = useRef(scrollTopByMode);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sessionIdentifierRef = useRef<HTMLInputElement>(null);
  const restoredSessionId = restoredWorkspace?.session.sessionId;
  const boundSession =
    restoredWorkspace && isSessionVideoBound(restoredWorkspace.session)
      ? restoredWorkspace.session
      : null;
  const boundVideoIdentity = boundSession
    ? parseVideoKey(boundSession.videoKey)
    : null;
  const hasExistingSubtitle = restoredWorkspace?.subtitle != null;
  const workspaceAvailability =
    restoredWorkspace === undefined || boundSession === null
      ? "no-video"
      : hasExistingSubtitle
        ? "ready"
        : "no-subtitle";
  const playerConnected =
    timeline?.playerOwner !== undefined &&
    timeline.subtitleOwner !== undefined &&
    timeline.playerOwner.videoKey === timeline.subtitleOwner.videoKey &&
    timeline.playerOwner.pageRevision === timeline.subtitleOwner.pageRevision;

  useEffect(() => {
    if (appearance) {
      setLocalAppearance(appearance);
    }
  }, [appearance]);

  useEffect(() => {
    if (actionMessage?.kind !== "status") {
      setToastVisible(false);
      return;
    }
    setToastVisible(true);
  }, [actionMessage]);

  useEffect(() => {
    if (!toastVisible || toastPaused || actionMessage?.kind !== "status")
      return;
    const timeout = globalThis.setTimeout(() => setToastVisible(false), 3_000);
    return () => globalThis.clearTimeout(timeout);
  }, [actionMessage, toastPaused, toastVisible]);

  useEffect(() => {
    if (conversationPaneWidthPx !== undefined) {
      setPaneWidth(conversationPaneWidthPx);
    }
  }, [conversationPaneWidthPx]);

  useEffect(() => {
    if (utilityView) setLocalUtilityView(utilityView);
  }, [utilityView]);

  const effectiveUtilityView =
    localUtilityView === "archive" && archive
      ? "archive"
      : localUtilityView === "batch-archive" && batchArchive
        ? "batch-archive"
        : localUtilityView === "batch-trash" && batchTrash
          ? "batch-trash"
          : localUtilityView === "batch" && batch
            ? "batch"
            : localUtilityView === "trash" && trash
              ? "trash"
              : "workspace";

  const isBatchSurface =
    effectiveUtilityView === "batch" ||
    effectiveUtilityView === "batch-archive" ||
    effectiveUtilityView === "batch-trash";
  const resolvedBatch = batch
    ? { ...batch, onHelpClick: onHelpClick ? () => onHelpClick() : undefined }
    : undefined;

  const selectUtilityView = (view: ShellUtilityView): void => {
    setLocalUtilityView(view);
    onUtilityViewChange?.(view);
  };

  const createOrFocusSession = (): SessionDrawerActionResult => {
    selectUtilityView("workspace");
    if (sessionDrawer?.onCreateSession) {
      return sessionDrawer.onCreateSession();
    }
    globalThis.setTimeout(() => sessionIdentifierRef.current?.focus(), 0);
  };

  const submitSessionIdentifier = (
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    const value = sessionIdentifier.trim();
    if (!sessionDrawer || sessionDrawer.busy || value.length === 0) return;
    try {
      const result = sessionDrawer.onBindIdentifier(value);
      if (
        typeof result === "object" &&
        result !== null &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        void Promise.resolve(result).then(
          (succeeded) => {
            if (succeeded !== false) setSessionIdentifier("");
          },
          () => undefined,
        );
      } else if (result !== false) {
        setSessionIdentifier("");
      }
    } catch {
      // The side-panel coordinator owns the visible action error.
    }
  };

  const applyPaneWidth = (nextWidth: number): void => {
    const containerWidth = appRef.current?.getBoundingClientRect().width ?? 0;
    const width = clampConversationPaneWidth(nextWidth, containerWidth);
    setPaneWidth(width);
    onConversationPaneWidthChange?.(width);
  };

  useEffect(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }
    const clampOnResize = (): void => {
      const containerWidth = app.getBoundingClientRect().width;
      if (containerWidth < TWO_PANE_BREAKPOINT_PX) {
        return;
      }
      const clamped = clampConversationPaneWidth(paneWidth, containerWidth);
      if (clamped !== paneWidth) {
        setPaneWidth(clamped);
        onConversationPaneWidthChange?.(clamped);
      }
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(clampOnResize);
    observer?.observe(app);
    globalThis.addEventListener("resize", clampOnResize);
    clampOnResize();
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", clampOnResize);
    };
  }, [onConversationPaneWidthChange, paneWidth]);

  const updateAppearance = (nextPreference: AppearancePreference): void => {
    setLocalAppearance(nextPreference);
    onAppearanceChange?.(nextPreference);
  };

  useEffect(() => {
    const positions = {
      ...(restoredWorkspace?.scrollTopByMode ?? EMPTY_SCROLL_POSITIONS),
    };
    scrollTopByModeRef.current = positions;
    setScrollTopByMode(positions);
    setActiveMode(restoredWorkspace?.activeMode ?? "timeline");
    setReacquiringSubtitle(false);
  }, [restoredSessionId]);

  useEffect(() => {
    if (!reacquiringSubtitle || !hasExistingSubtitle) return;
    if (
      subtitleAcquisition?.state.phase === "error" ||
      subtitleAcquisition?.state.phase === "success" ||
      speechAcquisition?.phase === "error" ||
      speechAcquisition?.phase === "success"
    ) {
      setReacquiringSubtitle(false);
    }
  }, [
    hasExistingSubtitle,
    reacquiringSubtitle,
    speechAcquisition?.phase,
    subtitleAcquisition?.state.phase,
  ]);

  const activeIndex = WORKSPACE_MODES.findIndex(
    (mode) => mode.id === activeMode,
  );
  const active = WORKSPACE_MODES[activeIndex];
  const publishWorkspaceView = (
    mode: WorkspaceMode,
    positions: WorkspaceScrollPositions,
  ): void => {
    if (!restoredWorkspace) {
      return;
    }
    onWorkspaceViewChange?.({
      activeMode: mode,
      scrollTopByMode: positions,
      sessionId: restoredWorkspace.session.sessionId,
    });
  };

  const selectMode = (mode: WorkspaceMode): void => {
    setActiveMode(mode);
    publishWorkspaceView(mode, scrollTopByModeRef.current);
  };

  const handleTimelineScroll = (scrollTop: number): void => {
    timeline?.onScrollTopChange?.(scrollTop);
    const positions = Object.freeze({
      ...scrollTopByModeRef.current,
      timeline: scrollTop,
    });
    scrollTopByModeRef.current = positions;
    setScrollTopByMode(positions);
    publishWorkspaceView(activeMode, positions);
  };

  const restoredTimelineScroll = scrollTopByMode.timeline;
  const resolvedTimeline = timeline
    ? {
        ...timeline,
        initialScrollTop:
          timeline.initialScrollTop ?? restoredTimelineScroll ?? 0,
        onScrollTopChange: handleTimelineScroll,
      }
    : restoredWorkspace?.subtitle
      ? {
          initialScrollTop: restoredTimelineScroll ?? 0,
          onScrollTopChange: handleTimelineScroll,
          rows: restoredWorkspace.subtitle.rows,
        }
      : undefined;

  const selectTab = (index: number): void => {
    const mode = WORKSPACE_MODES[index];
    selectMode(mode.id);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + WORKSPACE_MODES.length) % WORKSPACE_MODES.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % WORKSPACE_MODES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = WORKSPACE_MODES.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    selectTab(nextIndex);
  };

  return (
    <div
      class={`muzhi-app${sessionDrawer ? " muzhi-app--with-sessions" : ""}${
        effectiveUtilityView === "batch" ||
        effectiveUtilityView === "batch-archive" ||
        effectiveUtilityView === "batch-trash"
          ? " muzhi-app--batch"
          : ""
      }`}
      data-responsive-panel="true"
      data-theme={localAppearance.theme}
      ref={appRef}
      style={`--muzhi-conversation-pane-width: ${paneWidth}px;`}
    >
      <div class="muzhi-app__layout">
        {!isBatchSurface && sessionDrawer ? (
          <SessionDrawer
            {...sessionDrawer}
            activeWorkspaceMode="session"
            onCreateSession={createOrFocusSession}
            onOpenArchive={
              archive
                ? () => {
                    sessionDrawer.onOpenArchive?.();
                    selectUtilityView("archive");
                  }
                : sessionDrawer.onOpenArchive
            }
            onOpenBatch={batch ? () => selectUtilityView("batch") : undefined}
            onOpenSessionMode={() => selectUtilityView("workspace")}
            onOpenSettings={onOpenSettings}
            onOpenTrash={trash ? () => selectUtilityView("trash") : undefined}
            onSelect={(sessionId) => {
              sessionDrawer.onSelect(sessionId);
              selectUtilityView("workspace");
            }}
          />
        ) : null}
        {isBatchSurface && batchDrawer ? (
          <BatchDrawer
            {...batchDrawer}
            onOpenArchive={
              batchArchive
                ? () => selectUtilityView("batch-archive")
                : undefined
            }
            onOpenBatch={() => selectUtilityView("batch")}
            onOpenSessionMode={() =>
              selectUtilityView(
                effectiveUtilityView === "batch-archive"
                  ? "archive"
                  : effectiveUtilityView === "batch-trash"
                    ? "trash"
                    : "workspace",
              )
            }
            onOpenSettings={onOpenSettings}
            onOpenTrash={
              batchTrash ? () => selectUtilityView("batch-trash") : undefined
            }
          />
        ) : null}
        {sessionDrawer ? (
          <ConversationSplitter
            uiLanguage={uiLanguage}
            getContainerWidth={() =>
              appRef.current?.getBoundingClientRect().width ?? 0
            }
            onWidthChange={applyPaneWidth}
            width={paneWidth}
          />
        ) : null}
        <main class="muzhi-shell" aria-label="Bilimuzhi">
          <header class="muzhi-shell__header">
            <div class="muzhi-shell__brand">
              <img
                aria-hidden="true"
                class="muzhi-shell__brand-logo"
                src="icons/muzhi-logo.png"
              />
              <div>
                <p class="muzhi-shell__eyebrow">AI Chat</p>
                <h1>Bilimuzhi</h1>
              </div>
              <a
                aria-label={t(uiLanguage ?? "zh-Hans", "header.githubAria")}
                class="muzhi-shell__github"
                href="https://github.com/StaySound4/bilimuzhi"
                rel="noreferrer"
                target="_blank"
                title={t(uiLanguage ?? "zh-Hans", "header.githubAria")}
              >
                <svg
                  aria-hidden="true"
                  height="18"
                  viewBox="0 0 16 16"
                  width="18"
                >
                  <path
                    d="M8 0c4.42 0 8 3.58 8 8 0 3.54-2.29 6.53-5.47 7.59.4-.07.55-.17.55-.38v-1.37c0-.94-.38-1.68-.88-2.01.88-.1 1.81-.44 1.81-1.98 0-.44-.18-.84-.46-1.14.04-.11.2-.55-.04-1.14-.36-.11-1.19.45-1.19.45-.35-.09-.72-.13-1.08-.13s-.73.04-1.08.13c0 0-.83-.56-1.19-.45-.24.59-.08 1.03-.04 1.14-.28.3-.46.7-.46 1.14 0 1.54.93 1.88 1.81 1.98-.35.25-.7.71-.82 1.37-.36.17-.99.48-1.42-.13-.16-.28-.5-.93-1.02-.9-.56.03-.44.57-.19.73.29.19.61.53.76 1.1.21.78.9 1.1 1.5 1.18v1.65c0 .21-.15.32-.55.38C2.29 14.53 0 11.54 0 8c0-4.42 3.58-8 8-8Z"
                    fill="currentColor"
                  />
                </svg>
              </a>
              <span class="muzhi-shell__github-star">
                {t(uiLanguage ?? "zh-Hans", "header.githubStar")}
              </span>
            </div>
            <div class="muzhi-shell__header-actions">
              {effectiveUtilityView === "archive" ||
              effectiveUtilityView === "trash" ||
              effectiveUtilityView === "batch-archive" ||
              effectiveUtilityView === "batch-trash" ? (
                <button
                  class="muzhi-button"
                  onClick={() =>
                    selectUtilityView(
                      effectiveUtilityView === "batch-archive" ||
                        effectiveUtilityView === "batch-trash"
                        ? "batch"
                        : "workspace",
                    )
                  }
                  type="button"
                >
                  {t(uiLanguage ?? "zh-Hans", "header.returnToWorkspace")}
                </button>
              ) : null}
              <span class="muzhi-shell__status">
                {effectiveUtilityView === "batch" ||
                effectiveUtilityView === "batch-archive" ||
                effectiveUtilityView === "batch-trash"
                  ? t(uiLanguage ?? "zh-Hans", "header.batchWorkspace")
                  : t(uiLanguage ?? "zh-Hans", "header.sessionWorkspace")}
              </span>
              {onHelpClick &&
              (effectiveUtilityView === "workspace" ||
                effectiveUtilityView === "batch") ? (
                <button
                  aria-label={t(uiLanguage ?? "zh-Hans", "header.helpAria")}
                  class="muzhi-shell__help"
                  onClick={onHelpClick}
                  title={t(uiLanguage ?? "zh-Hans", "header.helpTitle")}
                  type="button"
                >
                  ?
                </button>
              ) : null}
              <AppearanceControls
                onChange={updateAppearance}
                preference={localAppearance}
                uiLanguage={uiLanguage}
              />
            </div>
          </header>

          {readOnly ? (
            <div class="muzhi-shell__readonly-banner" role="status">
              <span class="muzhi-shell__readonly-banner-copy">
                {t(uiLanguage ?? "zh-Hans", "shell.readonlyBanner")}
              </span>
              <button
                class="muzhi-button"
                onClick={readOnly.onReturnToArchive}
                type="button"
              >
                {t(uiLanguage ?? "zh-Hans", "shell.returnToArchive")}
              </button>
              <button
                class="muzhi-button"
                onClick={readOnly.onRestoreToWorkspace}
                type="button"
              >
                {t(uiLanguage ?? "zh-Hans", "archive.restoreToWorkspace")}
              </button>
            </div>
          ) : null}

          {actionMessage?.kind === "error" ? (
            <p class="muzhi-shell__action-message is-error" role="alert">
              {actionMessage.text}
            </p>
          ) : null}
          {actionMessage?.kind === "status" && toastVisible ? (
            <div
              aria-live="polite"
              class="muzhi-shell__toast"
              onFocusIn={() => setToastPaused(true)}
              onFocusOut={() => setToastPaused(false)}
              onMouseEnter={() => setToastPaused(true)}
              onMouseLeave={() => setToastPaused(false)}
              role="status"
            >
              <span>{actionMessage.text}</span>
              <button
                aria-label={t(uiLanguage ?? "zh-Hans", "common.close")}
                onClick={() => setToastVisible(false)}
                type="button"
              >
                ×
              </button>
            </div>
          ) : null}

          {restoredWorkspace && boundSession === null ? (
            <p class="muzhi-shell__restore-status" role="status">
              {t(uiLanguage ?? "zh-Hans", "shell.restoredSession", {
                title: restoredWorkspace.session.title,
              })}
              {restoredWorkspace.subtitle
                ? t(uiLanguage ?? "zh-Hans", "shell.restoredWithRows", {
                    count: restoredWorkspace.subtitle.rows.length,
                  })
                : t(uiLanguage ?? "zh-Hans", "shell.noActiveSubtitle")}
            </p>
          ) : null}

          {effectiveUtilityView === "workspace" ? (
            <>
              {boundSession !== null && boundVideoIdentity !== null ? (
                <section
                  aria-label={t(uiLanguage ?? "zh-Hans", "shell.boundVideo")}
                  class={`muzhi-shell__binding-header${pageIsStale ? " is-stale" : playerConnected ? " is-connected" : " is-disconnected"}`}
                >
                  <div class="muzhi-shell__binding-copy">
                    <p class="muzhi-shell__binding-eyebrow">
                      {t(uiLanguage ?? "zh-Hans", "shell.boundVideo")}
                    </p>
                    <h2>{boundSession.title}</h2>
                    <p class="muzhi-shell__binding-meta">
                      <span>{boundVideoIdentity.bvid}</span>
                      <span>P {boundVideoIdentity.page}</span>
                      <span>
                        {pageIsStale
                          ? t(uiLanguage ?? "zh-Hans", "toast.pageChangedHint")
                          : playerConnected
                            ? t(uiLanguage ?? "zh-Hans", "shell.pageConnected")
                            : t(
                                uiLanguage ?? "zh-Hans",
                                "shell.pageDisconnected",
                              )}
                      </span>
                    </p>
                  </div>
                  {pageIsStale && sessionDrawer ? (
                    <button
                      class="muzhi-shell__binding-action"
                      disabled={sessionDrawer.busy}
                      onClick={() => sessionDrawer.onBindCurrent()}
                      type="button"
                    >
                      {t(uiLanguage ?? "zh-Hans", "shell.bindCurrentPage")}
                    </button>
                  ) : hasExistingSubtitle ? (
                    <button
                      class="muzhi-shell__binding-action"
                      disabled={sessionDrawer?.busy || reacquiringSubtitle}
                      onClick={() =>
                        readOnly
                          ? readOnly.onGuard(() => setReacquiringSubtitle(true))
                          : setReacquiringSubtitle(true)
                      }
                      type="button"
                    >
                      {t(uiLanguage ?? "zh-Hans", "shell.reacquire")}
                    </button>
                  ) : null}
                </section>
              ) : restoredWorkspace && sessionDrawer ? (
                <section
                  aria-labelledby="muzhi-create-session-title"
                  class="muzhi-shell__session-creator"
                >
                  <div class="muzhi-shell__session-creator-heading">
                    <div>
                      <p>{t(uiLanguage ?? "zh-Hans", "drawer.sessionMode")}</p>
                      <h2 id="muzhi-create-session-title">
                        {t(
                          uiLanguage ?? "zh-Hans",
                          "shell.createOrOpenSession",
                        )}
                      </h2>
                    </div>
                    <button
                      class="muzhi-button"
                      disabled={sessionDrawer.busy}
                      onClick={() => sessionDrawer.onBindCurrent()}
                      type="button"
                    >
                      {t(uiLanguage ?? "zh-Hans", "shell.bindCurrentPage")}
                    </button>
                  </div>
                  <form onSubmit={submitSessionIdentifier}>
                    <label for="muzhi-video-identifier">
                      {t(uiLanguage ?? "zh-Hans", "shell.videoIdentifierLabel")}
                    </label>
                    <div>
                      <input
                        disabled={sessionDrawer.busy}
                        id="muzhi-video-identifier"
                        onInput={(event) =>
                          setSessionIdentifier(event.currentTarget.value)
                        }
                        placeholder={t(
                          uiLanguage ?? "zh-Hans",
                          "shell.videoIdentifierPlaceholder",
                        )}
                        ref={sessionIdentifierRef}
                        value={sessionIdentifier}
                      />
                      <button
                        class="muzhi-button"
                        disabled={
                          sessionDrawer.busy ||
                          sessionIdentifier.trim().length === 0
                        }
                        type="submit"
                      >
                        {t(uiLanguage ?? "zh-Hans", "shell.openVideoSession")}
                      </button>
                    </div>
                  </form>
                  <p class="muzhi-shell__creator-hint">
                    {t(uiLanguage ?? "zh-Hans", "shell.stabilityHint")}
                  </p>
                </section>
              ) : null}
              <nav
                class="muzhi-shell__tabs"
                aria-label={t(uiLanguage ?? "zh-Hans", "shell.modeTabsAria")}
                role="tablist"
                style={
                  {
                    "--muzhi-tab-index": activeIndex,
                  } as JSX.CSSProperties
                }
              >
                <span aria-hidden="true" class="muzhi-shell__tab-indicator" />
                {WORKSPACE_MODES.map((mode, index) => {
                  const selected = mode.id === activeMode;
                  return (
                    <button
                      aria-controls={`muzhi-panel-${mode.id}`}
                      aria-selected={selected}
                      class={`muzhi-button${selected ? " is-active" : ""}`}
                      id={`muzhi-tab-${mode.id}`}
                      key={mode.id}
                      onClick={() => selectMode(mode.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, index)}
                      ref={(element) => {
                        tabRefs.current[index] = element;
                      }}
                      role="tab"
                      tabIndex={selected ? 0 : -1}
                      type="button"
                    >
                      {t(uiLanguage ?? "zh-Hans", mode.labelKey)}
                    </button>
                  );
                })}
              </nav>

              <section
                class="muzhi-shell__panel"
                aria-labelledby={`muzhi-tab-${active.id}`}
                id={`muzhi-panel-${active.id}`}
                role="tabpanel"
                tabIndex={0}
              >
                {active.id === "timeline" &&
                resolvedTimeline &&
                !reacquiringSubtitle ? (
                  <div class="muzhi-shell__timeline-stack">
                    <SubtitleTimeline
                      {...resolvedTimeline}
                      availability={workspaceAvailability}
                    />
                  </div>
                ) : active.id === "timeline" &&
                  restoredWorkspace &&
                  (subtitleAcquisition || speechAcquisition) &&
                  (!hasExistingSubtitle || reacquiringSubtitle) ? (
                  <section
                    aria-label={
                      hasExistingSubtitle
                        ? t(
                            uiLanguage ?? "zh-Hans",
                            "shell.reacquireSubtitleSource",
                          )
                        : t(
                            uiLanguage ?? "zh-Hans",
                            "shell.selectSubtitleSource",
                          )
                    }
                    class="muzhi-shell__acquisition-selection"
                  >
                    {hasExistingSubtitle ? (
                      <header class="muzhi-shell__acquisition-heading">
                        <div>
                          <p>
                            {t(
                              uiLanguage ?? "zh-Hans",
                              "shell.reacquireSubtitle",
                            )}
                          </p>
                          <h2>
                            {t(
                              uiLanguage ?? "zh-Hans",
                              "shell.selectSubtitleSource",
                            )}
                          </h2>
                          <p>
                            {t(
                              uiLanguage ?? "zh-Hans",
                              "shell.keepCurrentSubtitle",
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => setReacquiringSubtitle(false)}
                          type="button"
                        >
                          {t(
                            uiLanguage ?? "zh-Hans",
                            "shell.backToCurrentSubtitle",
                          )}
                        </button>
                      </header>
                    ) : null}
                    {subtitleAcquisition ? (
                      <SubtitleAcquisitionPanel
                        {...subtitleAcquisition}
                        onCancel={() => {
                          subtitleAcquisition.onCancel();
                          if (hasExistingSubtitle) {
                            setReacquiringSubtitle(false);
                          }
                        }}
                        reacquiring={hasExistingSubtitle && reacquiringSubtitle}
                      />
                    ) : null}
                    {speechAcquisition ? (
                      <SpeechAcquisitionPanel
                        {...speechAcquisition}
                        onCancel={() => {
                          speechAcquisition.onCancel();
                          if (hasExistingSubtitle) {
                            setReacquiringSubtitle(false);
                          }
                        }}
                        reacquiring={hasExistingSubtitle && reacquiringSubtitle}
                      />
                    ) : null}
                  </section>
                ) : active.id === "chat" ? (
                  // T-B3:对话模式已实现,永不回退「尚未实现」占位。
                  // chat prop 缺失时(如无会话/无字幕)渲染空态,由
                  // workspaceAvailability 决定 no-video/no-subtitle 卡片。
                  <ChatWorkspace
                    {...(chat ?? {
                      activeThreadId: null,
                      messages: [],
                      onCopyMessage: () => undefined,
                      onCreateThread: () => undefined,
                      onDeleteThread: () => undefined,
                      onExportThread: () => undefined,
                      onRequestMessageMutation: () => undefined,
                      onRenameThread: () => undefined,
                      onRetryMessage: () => undefined,
                      onSelectThread: () => undefined,
                      onSend: () => undefined,
                      onStop: () => undefined,
                      threads: [],
                      uiLanguage: uiLanguage ?? "zh-Hans",
                    })}
                    availability={workspaceAvailability}
                  />
                ) : active.id === "segments" && segments ? (
                  <InsightWorkspace
                    {...segments}
                    availability={workspaceAvailability}
                  />
                ) : active.id === "summary" && summary ? (
                  <InsightWorkspace
                    {...summary}
                    availability={workspaceAvailability}
                  />
                ) : (
                  <>
                    <p class="muzhi-shell__placeholder-label">
                      {t(uiLanguage ?? "zh-Hans", "shell.notImplemented")}
                    </p>
                    <h2>{t(uiLanguage ?? "zh-Hans", active.labelKey)}</h2>
                    <p>{t(uiLanguage ?? "zh-Hans", active.descriptionKey)}</p>
                  </>
                )}
              </section>
            </>
          ) : (
            <section class="muzhi-shell__panel" tabIndex={0}>
              {effectiveUtilityView === "archive" && archive ? (
                <ArchiveWorkspace
                  {...archive}
                  onHelpClick={onHelpClick ? () => onHelpClick() : undefined}
                />
              ) : effectiveUtilityView === "batch-archive" && batchArchive ? (
                <BatchArchiveWorkspace
                  {...batchArchive}
                  onHelpClick={onHelpClick ? () => onHelpClick() : undefined}
                />
              ) : effectiveUtilityView === "batch-trash" && batchTrash ? (
                <BatchTrashWorkspace
                  {...batchTrash}
                  onHelpClick={onHelpClick ? () => onHelpClick() : undefined}
                />
              ) : effectiveUtilityView === "batch" && resolvedBatch ? (
                <BatchWorkspace {...resolvedBatch} />
              ) : effectiveUtilityView === "trash" && trash ? (
                <TrashWorkspace
                  {...trash}
                  onHelpClick={onHelpClick ? () => onHelpClick() : undefined}
                />
              ) : null}
            </section>
          )}
        </main>
      </div>
      {settings ? <SettingsDrawer {...settings} /> : null}
      {helpDialog ? (
        <HelpDialogView
          context={helpDialog.context}
          onClose={() => onHelpClick?.()}
          uiLanguage={uiLanguage}
        />
      ) : null}
      {promptManager ? <PromptManagerDialog {...promptManager} /> : null}
      {dialog ? <AppDialog {...dialog} /> : null}
    </div>
  );
}
