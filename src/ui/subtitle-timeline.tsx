import { t } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { UiLanguage } from "../i18n/languages";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { TimelineSyncState } from "../application/timeline-sync";
import { AppDialog } from "./dialogs/app-dialog";
import { BilimuzhiIcon } from "./icons";
import { WorkspaceEmptyState } from "./primitives/workspace-empty-state";
import "./primitives/workspace-empty-state.css";
import { useAnchoredPopover } from "./primitives/use-anchored-popover";

import type { SubtitleExportFormat } from "../application/subtitle-export";
import type { SubtitleRow, VideoKey } from "../domain";

export interface SubtitleTimelineOwner {
  readonly pageRevision: number;
  readonly videoKey: VideoKey;
}

export interface SubtitleTimelineProps {
  readonly uiLanguage?: UiLanguage;
  readonly currentTimeMs?: number;
  readonly availability?: "no-subtitle" | "no-video" | "ready";
  readonly durationMs?: number;
  readonly initialScrollTop?: number;
  readonly onExport?: (
    format: SubtitleExportFormat,
    options?: { readonly includeTimestamps?: boolean },
  ) => void;
  readonly onLocateCurrent?: () => Promise<number | null>;
  readonly onSeek?: (seconds: number) => void;
  readonly onScrollTopChange?: (scrollTop: number) => void;
  readonly onSyncEnabledChange?: (enabled: boolean) => void;
  readonly overscan?: number;
  readonly rowHeight?: number;
  readonly rows: readonly SubtitleRow[];
  /** Owner captured when the displayed subtitle rows were committed. */
  readonly subtitleOwner?: SubtitleTimelineOwner;
  /** 播放器断开原因（按钮 disabled 时 hover 显示；undefined 表示不提示）。 */
  readonly playerDisconnectReason?: "no-video" | "video-mismatch";
  /** Owner sampled from the currently bound player page. */
  readonly playerOwner?: SubtitleTimelineOwner;
  /** 同步开关（宿主持有）。 */
  readonly syncEnabled?: boolean;
  /** 同步状态机（宿主持有）；seeking 时高亮锁定 seek 目标行。 */
  readonly syncState?: TimelineSyncState;
  readonly viewportHeight?: number;
}

interface IndexedSubtitleRow {
  readonly originalIndex: number;
  readonly row: SubtitleRow;
}

interface ProgrammaticScrollTransaction {
  checksRemaining: number;
  frameId: number | null;
  readonly target: number;
  readonly token: number;
}

const DEFAULT_ROW_HEIGHT = 56;
const FALLBACK_VIEWPORT_HEIGHT = 320;
const DEFAULT_OVERSCAN = 4;

/** 播放器按钮 title：可点时用默认文案；disabled 时按原因显示提示。 */
function playerButtonTitle(
  lang: UiLanguage,
  ownerMatches: boolean,
  reason: "no-video" | "video-mismatch" | undefined,
  enabledKey: MessageKey,
  noPlayerKey: MessageKey,
  mismatchKey: MessageKey,
): string {
  if (ownerMatches) return t(lang, enabledKey);
  if (reason === "no-video") return t(lang, noPlayerKey);
  if (reason === "video-mismatch") return t(lang, mismatchKey);
  return t(lang, enabledKey);
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function nonNegativeFinite(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function isSeekableRow(row: SubtitleRow, durationMs?: number): boolean {
  return (
    Number.isSafeInteger(row.startMs) &&
    row.startMs >= 0 &&
    Number.isSafeInteger(row.endMs) &&
    row.endMs > row.startMs &&
    (durationMs === undefined ||
      (Number.isFinite(durationMs) &&
        durationMs >= 0 &&
        row.startMs <= durationMs))
  );
}

function currentRowIndex(
  rows: readonly IndexedSubtitleRow[],
  currentTimeMs?: number,
  durationMs?: number,
): number {
  if (
    typeof currentTimeMs !== "number" ||
    !Number.isFinite(currentTimeMs) ||
    currentTimeMs < 0
  ) {
    return -1;
  }
  const exactIndex = rows.findIndex(
    ({ row }) =>
      isSeekableRow(row, durationMs) &&
      currentTimeMs >= row.startMs &&
      currentTimeMs < row.endMs,
  );
  if (exactIndex >= 0) return exactIndex;

  let previousIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].row;
    if (!isSeekableRow(row, durationMs)) continue;
    if (row.startMs > currentTimeMs) {
      return previousIndex;
    }
    previousIndex = index;
  }
  return -1;
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function highlightText(text: string, query: string) {
  if (query.length === 0) return text;
  const index = text.toLocaleLowerCase().indexOf(query);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function timelineOwnerMatches(
  subtitleOwner: SubtitleTimelineOwner | undefined,
  playerOwner: SubtitleTimelineOwner | undefined,
): boolean {
  if (subtitleOwner === undefined || playerOwner === undefined) {
    // Preserve the existing unowned caller as one compatibility state while
    // refusing every partially-bound state. New owned callers must provide
    // both sides of the comparison before seek or locate becomes reachable.
    return subtitleOwner === playerOwner;
  }
  return (
    subtitleOwner.videoKey === playerOwner.videoKey &&
    subtitleOwner.pageRevision === playerOwner.pageRevision
  );
}

export function SubtitleTimeline({
  availability = "ready",
  currentTimeMs,
  durationMs,
  initialScrollTop: initialScrollTopInput,
  onExport,
  onLocateCurrent,
  onSeek,
  onScrollTopChange,
  onSyncEnabledChange,
  overscan: overscanInput,
  playerDisconnectReason,
  playerOwner,
  rowHeight: rowHeightInput,
  syncState,
  rows,
  subtitleOwner,
  syncEnabled = false,
  uiLanguage,
  viewportHeight: viewportHeightInput,
}: SubtitleTimelineProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [query, setQuery] = useState("");
  const [exportIncludeTimestamps, setExportIncludeTimestamps] = useState(true);
  // Ticket 10：wide（≥760 内容宽）用 non-modal anchored popover；
  // narrow 用 AppDialog modal。监听 viewport 宽度切换形态。
  const [wideViewport, setWideViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 760px)").matches,
  );
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia("(min-width: 760px)");
    const update = (): void => setWideViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const exportPopover = useAnchoredPopover();
  // 窄形态独立开关：避免 useAnchoredPopover 的 document pointerdown
  // light-dismiss 在 AppDialog 内点击时抢先关闭（B1 修复）。
  const [exportNarrowOpen, setExportNarrowOpen] = useState(false);
  const [locateStatus, setLocateStatus] = useState<string | null>(null);
  const [locatedSample, setLocatedSample] = useState<
    | {
        readonly controlledTimeAtRead: number | undefined;
        readonly timeMs: number;
      }
    | undefined
  >(undefined);
  const initialScrollTop = nonNegativeFinite(initialScrollTopInput, 0);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [measuredViewportHeight, setMeasuredViewportHeight] = useState<
    number | null
  >(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const programmaticScrollSequenceRef = useRef(0);
  const programmaticScrollRef = useRef<ProgrammaticScrollTransaction | null>(
    null,
  );
  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;
  const freeScrollTopRef = useRef(initialScrollTop);
  const previousSyncEnabledRef = useRef(false);
  const rowHeight = positiveFinite(rowHeightInput, DEFAULT_ROW_HEIGHT);
  const explicitViewportHeight =
    viewportHeightInput === undefined
      ? null
      : positiveFinite(viewportHeightInput, FALLBACK_VIEWPORT_HEIGHT);
  const viewportHeight =
    measuredViewportHeight ??
    explicitViewportHeight ??
    FALLBACK_VIEWPORT_HEIGHT;
  const overscan = nonNegativeInteger(overscanInput, DEFAULT_OVERSCAN);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = useMemo<readonly IndexedSubtitleRow[]>(
    () =>
      rows.flatMap((row, originalIndex) =>
        normalizedQuery.length === 0 ||
        row.text.toLocaleLowerCase().includes(normalizedQuery)
          ? [{ originalIndex, row }]
          : [],
      ),
    [normalizedQuery, rows],
  );
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const requestedFirstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const firstVisible = Math.min(
    requestedFirstVisible,
    Math.max(0, filteredRows.length - visibleCount),
  );
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(
    filteredRows.length,
    firstVisible + visibleCount + overscan,
  );
  const visibleRows = filteredRows.slice(startIndex, endIndex);
  const activeTimeMs =
    locatedSample !== undefined &&
    currentTimeMs === locatedSample.controlledTimeAtRead
      ? locatedSample.timeMs
      : (currentTimeMs ?? locatedSample?.timeMs);
  const activeIndex = currentRowIndex(filteredRows, activeTimeMs, durationMs);
  // 同步中：seeking 锁定 seek 目标行；following 以最近被接受的采样为准
  // （旧采样已被状态机丢弃，不会把高亮拉回上一个字幕）。
  const syncActiveIndex =
    syncEnabled && syncState !== undefined
      ? syncState.phase === "seeking" && syncState.seekTargetMs !== undefined
        ? currentRowIndex(filteredRows, syncState.seekTargetMs, durationMs)
        : syncState.phase === "following" &&
            syncState.lastSampleMs !== undefined
          ? currentRowIndex(filteredRows, syncState.lastSampleMs, durationMs)
          : activeIndex
      : activeIndex;
  const ownerMatches = timelineOwnerMatches(subtitleOwner, playerOwner);
  // An explicit seek is routed by the bound subtitle VideoKey. A stale or
  // closed player page only disables live sampling/highlighting; the runtime
  // may still activate another matching tab or ask before opening one.
  const seekOwnerMatches = onSeek !== undefined;
  const locateOwnerMatches =
    ownerMatches && (onLocateCurrent !== undefined || activeIndex >= 0);

  const cancelProgrammaticScroll = (): void => {
    const transaction = programmaticScrollRef.current;
    if (transaction?.frameId !== null && transaction?.frameId !== undefined) {
      globalThis.cancelAnimationFrame(transaction.frameId);
    }
    programmaticScrollRef.current = null;
  };

  const scheduleProgrammaticScrollCheck = (token: number): void => {
    const transaction = programmaticScrollRef.current;
    if (
      transaction === null ||
      transaction.token !== token ||
      transaction.frameId !== null
    ) {
      return;
    }
    transaction.frameId = globalThis.requestAnimationFrame(() => {
      const current = programmaticScrollRef.current;
      if (current === null || current.token !== token) {
        return;
      }
      current.frameId = null;
      const viewport = viewportRef.current;
      if (
        viewport !== null &&
        (viewport.scrollTop !== current.target ||
          scrollTopRef.current !== current.target)
      ) {
        pendingScrollTopRef.current = current.target;
        viewport.scrollTop = current.target;
        scrollTopRef.current = current.target;
        setScrollTop(current.target);
      }
      current.checksRemaining -= 1;
      if (current.checksRemaining <= 0) {
        programmaticScrollRef.current = null;
        return;
      }
      scheduleProgrammaticScrollCheck(token);
    });
  };

  const requestScrollTop = (target: number): void => {
    cancelProgrammaticScroll();
    const token = (programmaticScrollSequenceRef.current += 1);
    programmaticScrollRef.current = {
      checksRemaining: 3,
      frameId: null,
      target,
      token,
    };
    pendingScrollTopRef.current = target;
    scrollTopRef.current = target;
    setScrollTop(target);
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || typeof ResizeObserver === "undefined") return;
    const updateHeight = (): void => {
      const nextHeight = viewport.clientHeight;
      if (nextHeight > 0) setMeasuredViewportHeight(nextHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    requestScrollTop(initialScrollTop);
  }, [initialScrollTop]);

  useLayoutEffect(() => {
    const pendingScrollTop = pendingScrollTopRef.current;
    const viewport = viewportRef.current;
    if (pendingScrollTop === null || viewport === null) {
      return;
    }
    viewport.scrollTop = pendingScrollTop;
    pendingScrollTopRef.current = null;
    const transaction = programmaticScrollRef.current;
    if (transaction !== null && transaction.target === pendingScrollTop) {
      scheduleProgrammaticScrollCheck(transaction.token);
    }
  }, [endIndex, scrollTop, startIndex]);

  useLayoutEffect(
    () => () => {
      cancelProgrammaticScroll();
    },
    [],
  );

  const scrollToRow = (index: number): void => {
    const target = Math.max(
      0,
      index * rowHeight - (viewportHeight - rowHeight) / 2,
    );
    requestScrollTop(target);
  };

  useLayoutEffect(() => {
    const wasSyncEnabled = previousSyncEnabledRef.current;
    previousSyncEnabledRef.current = syncEnabled;
    if (syncEnabled && !wasSyncEnabled) {
      freeScrollTopRef.current = viewportRef.current?.scrollTop ?? scrollTop;
      return;
    }
    if (!syncEnabled && wasSyncEnabled) {
      const restoredScrollTop = freeScrollTopRef.current;
      requestScrollTop(restoredScrollTop);
    }
  }, [scrollTop, syncEnabled]);

  useLayoutEffect(() => {
    if (!syncEnabled || syncActiveIndex < 0) {
      return;
    }
    scrollToRow(syncActiveIndex);
  }, [syncActiveIndex, activeTimeMs, rowHeight, syncEnabled, viewportHeight]);

  const locateAt = (
    locatedTime: number | null | undefined,
    useControlledFallback: boolean,
  ): void => {
    const targetTime =
      locatedTime ?? (useControlledFallback ? currentTimeMs : undefined);
    const index = currentRowIndex(filteredRows, targetTime, durationMs);
    if (index < 0) {
      setLocateStatus(t(lang, "timeline.locateNoMatch"));
      return;
    }
    setLocatedSample({
      controlledTimeAtRead: currentTimeMs,
      timeMs: targetTime as number,
    });
    scrollToRow(index);
    // 成功定位不增加布局状态文字；滚动本身即反馈（Ticket 08）。
    setLocateStatus(null);
  };

  const locateCurrent = (): void => {
    if (!ownerMatches) {
      setLocateStatus(t(lang, "timeline.ownerMismatch"));
      return;
    }
    if (onLocateCurrent === undefined) {
      locateAt(undefined, true);
      return;
    }
    void onLocateCurrent().then(
      (locatedTime) => locateAt(locatedTime, false),
      () => {
        setLocateStatus(t(lang, "timeline.locateFailed"));
      },
    );
  };

  return (
    <div class="subtitle-timeline">
      <div class="subtitle-timeline__toolbar">
        <label>
          <span>{t(lang, "timeline.searchLabel")}</span>
          <input
            aria-label={t(lang, "timeline.searchLabel")}
            onInput={(event) => {
              const value = event.currentTarget.value;
              requestScrollTop(0);
              setQuery(value);
            }}
            type="search"
            value={query}
          />
        </label>
        <button
          aria-label={t(lang, "timeline.locateCurrent")}
          class="muzhi-btn muzhi-btn--icon muzhi-btn--ghost"
          disabled={
            !locateOwnerMatches ||
            syncEnabled ||
            (activeIndex < 0 && onLocateCurrent === undefined)
          }
          onClick={locateCurrent}
          title={playerButtonTitle(
            lang,
            locateOwnerMatches,
            playerDisconnectReason,
            "timeline.locateCurrent",
            "timeline.locateDisabledNoPlayer",
            "timeline.locateDisabledMismatch",
          )}
          type="button"
        >
          <BilimuzhiIcon name="locate" />
        </button>
        {onSyncEnabledChange ? (
          <button
            aria-label={t(lang, "timeline.syncMode")}
            aria-pressed={syncEnabled}
            class={`muzhi-btn muzhi-btn--icon muzhi-btn--ghost${syncEnabled ? " is-active" : ""}`}
            disabled={!ownerMatches}
            onClick={() => onSyncEnabledChange(!syncEnabled)}
            title={playerButtonTitle(
              lang,
              ownerMatches,
              playerDisconnectReason,
              "timeline.syncMode",
              "timeline.syncDisabledNoPlayer",
              "timeline.syncDisabledMismatch",
            )}
            type="button"
          >
            <BilimuzhiIcon name="sync" />
          </button>
        ) : null}
      </div>
      {locateStatus ? (
        <p class="subtitle-timeline__locate-status" role="status">
          {locateStatus}
        </p>
      ) : null}
      <p aria-live="polite" class="subtitle-timeline__count">
        {t(lang, "timeline.rowCount", { count: filteredRows.length })}
      </p>
      {onExport ? (
        <div
          aria-label={t(lang, "timeline.exportAria")}
          class="subtitle-timeline__exports"
          role="group"
        >
          <button
            aria-expanded={wideViewport ? exportPopover.open : exportNarrowOpen}
            aria-haspopup="dialog"
            disabled={rows.length === 0}
            onClick={() => {
              setExportIncludeTimestamps(true);
              if (wideViewport) {
                exportPopover.toggle();
              } else {
                setExportNarrowOpen(true);
              }
            }}
            ref={exportPopover.triggerRef}
            type="button"
          >
            {t(lang, "timeline.export")}
          </button>
          {wideViewport && exportPopover.open ? (
            <div
              aria-label={t(lang, "timeline.exportDialogTitle")}
              class="subtitle-timeline__export-popover"
              ref={exportPopover.ref}
              role="dialog"
            >
              <h3>{t(lang, "timeline.exportDialogTitle")}</h3>
              <label>
                <input
                  checked={exportIncludeTimestamps}
                  onInput={(event) =>
                    setExportIncludeTimestamps(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                {t(lang, "timeline.includeTimestamps")}
              </label>
              <div class="subtitle-timeline__export-actions">
                {(
                  [
                    ["TXT", "txt"],
                    ["SRT", "srt"],
                    ["Markdown", "markdown"],
                  ] as const
                ).map(([label, format]) => (
                  <button
                    key={format}
                    onClick={() => {
                      exportPopover.close();
                      onExport(format, {
                        includeTimestamps: exportIncludeTimestamps,
                      });
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={exportPopover.close} type="button">
                {t(lang, "common.cancel")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {onExport && !wideViewport && exportNarrowOpen ? (
        <AppDialog
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "timeline.export")}
          description={t(lang, "timeline.includeTimestamps")}
          onCancel={() => setExportNarrowOpen(false)}
          onConfirm={(value) => {
            setExportNarrowOpen(false);
            onExport(value as SubtitleExportFormat, {
              includeTimestamps: exportIncludeTimestamps,
            });
          }}
          options={[
            { label: "TXT", value: "txt" },
            { label: "SRT", value: "srt" },
            { label: "Markdown", value: "markdown" },
          ]}
          title={t(lang, "timeline.exportDialogTitle")}
        />
      ) : null}
      {filteredRows.length === 0 ? (
        <WorkspaceEmptyState
          description={
            rows.length > 0
              ? t(lang, "workspaceEmpty.noMatch")
              : availability === "no-video"
                ? t(lang, "workspaceEmpty.noVideoDescription")
                : t(lang, "workspaceEmpty.timelineNoSubtitle")
          }
          title={
            rows.length > 0
              ? t(lang, "workspaceEmpty.noMatchTitle")
              : availability === "no-video"
                ? t(lang, "workspaceEmpty.noVideoTitle")
                : t(lang, "workspaceEmpty.noSubtitleTitle")
          }
          variant={
            rows.length > 0
              ? "no-match"
              : availability === "no-video"
                ? "no-video"
                : "no-subtitle"
          }
        />
      ) : (
        <div
          aria-label={t(lang, "timeline.viewportAria")}
          class={`subtitle-timeline__viewport${syncEnabled ? " is-synced" : ""}`}
          onKeyDown={cancelProgrammaticScroll}
          onPointerDown={cancelProgrammaticScroll}
          onScroll={(event) => {
            const nextScrollTop = nonNegativeFinite(
              event.currentTarget.scrollTop,
              0,
            );
            const programmaticScroll = programmaticScrollRef.current;
            if (programmaticScroll !== null) {
              if (
                event.currentTarget.scrollHeight >
                event.currentTarget.clientHeight
              ) {
                if (nextScrollTop !== programmaticScroll.target) {
                  pendingScrollTopRef.current = programmaticScroll.target;
                  event.currentTarget.scrollTop = programmaticScroll.target;
                  scrollTopRef.current = programmaticScroll.target;
                  setScrollTop(programmaticScroll.target);
                }
                return;
              }
              cancelProgrammaticScroll();
            }
            scrollTopRef.current = nextScrollTop;
            setScrollTop(nextScrollTop);
            if (!syncEnabled) {
              freeScrollTopRef.current = nextScrollTop;
              onScrollTopChange?.(nextScrollTop);
            }
          }}
          onTouchStart={cancelProgrammaticScroll}
          onWheel={cancelProgrammaticScroll}
          ref={viewportRef}
          role="region"
          style={{
            height:
              explicitViewportHeight === null
                ? undefined
                : `${explicitViewportHeight}px`,
            overflowAnchor: "none",
            overflowY: syncEnabled ? "hidden" : "scroll",
            scrollBehavior: "auto",
            scrollbarGutter: syncEnabled ? "auto" : "stable",
          }}
        >
          <ol
            class="subtitle-timeline__list"
            style={{ height: `${filteredRows.length * rowHeight}px` }}
          >
            {visibleRows.map(({ originalIndex, row }, offset) => {
              const filteredIndex = startIndex + offset;
              const seekable = isSeekableRow(row, durationMs);
              const timestamp = seekable ? formatTimestamp(row.startMs) : null;
              return (
                <li
                  aria-current={
                    filteredIndex === syncActiveIndex ? "true" : undefined
                  }
                  data-testid="subtitle-row"
                  key={`${originalIndex}:${row.startMs}:${row.endMs}`}
                  style={{
                    height: `${rowHeight}px`,
                    transform: `translateY(${filteredIndex * rowHeight}px)`,
                  }}
                >
                  {seekable && timestamp !== null && seekOwnerMatches ? (
                    <button
                      aria-label={t(lang, "timeline.seekAria", {
                        label: timestamp,
                        text: row.text,
                      })}
                      onClick={() => onSeek(row.startMs / 1_000)}
                      type="button"
                    >
                      <time>{timestamp}</time>
                      <span aria-hidden="true" class="subtitle-timeline__rail">
                        <span class="subtitle-timeline__node" />
                      </span>
                      <span title={row.text}>
                        {highlightText(row.text, normalizedQuery)}
                      </span>
                    </button>
                  ) : (
                    <div aria-disabled="true">
                      <span aria-hidden="true">{timestamp ?? "--:--"}</span>
                      <span aria-hidden="true" class="subtitle-timeline__rail">
                        <span class="subtitle-timeline__node" />
                      </span>
                      <span title={row.text}>
                        {highlightText(row.text, normalizedQuery)}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
