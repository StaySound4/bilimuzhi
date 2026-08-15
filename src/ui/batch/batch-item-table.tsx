/**
 * BatchItemTable — 批量结果表格视口（Ticket 04/05）。
 *
 * - 渲染当前筛选结果全集（分页语义已删除），滚动高度即完整列表；
 * - 列按 v2 布局（顺序/可见性/宽度/全文本）渲染：序号恒第一且不可
 *   隐藏；字幕状态、操作不可隐藏；其余列可隐藏可排序；
 * - 顶部横向滚动条与表格 body 双向同步，底部原生横向滚动条作为冗余
 *   入口保留并同步；
 * - 列宽拖拽/键盘调整完成后上报父组件持久化；状态与操作列有不可
 *   突破分隔线的最小宽度。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { Fragment } from "preact";
import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AppDialog } from "../dialogs/app-dialog";
import type { BatchItem, SubtitleLanguageMode } from "../../domain";
import type { BatchColumnId } from "./batch-column-layout";
import {
  batchTableWidthV2,
  MAX_COLUMN_WIDTH_V2,
  minColumnWidthV2,
  setColumnWidthV2,
  type BatchColumnLayoutV2,
} from "./batch-column-layout-v2";
import {
  columnLabel,
  itemErrorLabel,
  itemStatusBadge,
  progressLabel,
  publishedAtLabel,
  speechLanguageLabel,
} from "./batch-labels";
import { BilimuzhiIcon } from "../icons";
export interface BatchItemTableProps {
  readonly uiLanguage?: UiLanguage;
  readonly items: readonly BatchItem[];
  readonly layout: BatchColumnLayoutV2;
  readonly busy?: boolean;
  readonly taskLocked?: boolean;
  readonly selectionPending?: boolean;
  readonly hasCurrentList: boolean;
  /** 会话模式语音默认请求语言（行级未持久化时展示）。 */
  readonly speechLanguageMode: SubtitleLanguageMode;
  readonly controlsUnavailableId?: string;
  /** 列宽拖拽/键盘调整完成后上报（父组件负责持久化）。 */
  readonly onLayoutChange: (next: BatchColumnLayoutV2) => void;
  readonly onToggleItem: (batchItemId: string, selected: boolean) => void;
  readonly onToggleFromRow: (
    event: JSX.TargetedMouseEvent<HTMLTableRowElement>,
    item: BatchItem,
  ) => void;
  readonly onChangeTrack: (item: BatchItem, trackId: string) => void;
  readonly onClearItem: (batchItemId: string) => void;
  readonly onExportItem: (item: BatchItem) => void;
  readonly onSpeechSettingsRequest: (batchItemId: string) => void;
  readonly onRemoveItemRequest: (batchItemId: string) => void;
}

export function BatchItemTable({
  busy = false,
  controlsUnavailableId,
  hasCurrentList,
  items,
  layout,
  onChangeTrack,
  onClearItem,
  onExportItem,
  onLayoutChange,
  onRemoveItemRequest,
  onSpeechSettingsRequest,
  onToggleFromRow,
  onToggleItem,
  selectionPending = false,
  speechLanguageMode,
  taskLocked = false,
  uiLanguage,
}: BatchItemTableProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const dragState = useRef<{
    readonly columnId: BatchColumnId;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const hscrollRef = useRef<HTMLDivElement>(null);
  const resizerLinesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Ticket 03：状态列/操作列列头问号帮助（AppDialog 单关闭模式）。
  const [helpColumn, setHelpColumn] = useState<"status" | "actions" | null>(
    null,
  );
  const visibleColumns = layout.order.filter(
    (columnId) => layout.visible[columnId] !== false,
  );

  const syncHorizontalScroll = (): void => {
    const scroll = tableScrollRef.current;
    const hscroll = hscrollRef.current;
    if (scroll === null || hscroll === null) return;
    // 顶部横向滚动条驱动表格容器的 scrollLeft（双向同步的一侧）。
    scroll.scrollLeft = hscroll.scrollLeft;
  };

  const syncHorizontalScrollReverse = (): void => {
    const scroll = tableScrollRef.current;
    const hscroll = hscrollRef.current;
    if (scroll === null || hscroll === null) return;
    // 底部原生横向滚动条（冗余入口）同步回顶部滚动条。
    hscroll.scrollLeft = scroll.scrollLeft;
  };

  const resizeColumn = (columnId: BatchColumnId, width: number): void => {
    onLayoutChange(setColumnWidthV2(layoutRef.current, columnId, width));
  };

  const startColumnResize = (
    columnId: BatchColumnId,
  ): ((event: PointerEvent) => void) => {
    return (event: PointerEvent) => {
      const currentWidth = layoutRef.current.widths[columnId];
      if (currentWidth === undefined) return;
      event.preventDefault();
      dragState.current = {
        columnId,
        startWidth: currentWidth,
        startX: event.clientX,
      };
      const move = (moveEvent: PointerEvent): void => {
        const drag = dragState.current;
        if (drag === null) return;
        const width = Math.min(
          MAX_COLUMN_WIDTH_V2,
          Math.max(
            minColumnWidthV2(drag.columnId),
            drag.startWidth + (moveEvent.clientX - drag.startX),
          ),
        );
        // 拖动中直接更新 DOM（col 宽 / 表格最小宽 / 后续分隔线位置），
        // 不触发整表 React 重渲染：避免高频拖动时的重排卡顿与内容串行闪烁。
        const delta = width - drag.startWidth;
        const col = tableRef.current?.querySelector(
          `col[data-column-id="${drag.columnId}"]`,
        );
        if (col !== null && col !== undefined) {
          col.setAttribute("style", `width: ${Math.round(width)}px`);
        }
        if (tableRef.current !== null) {
          tableRef.current.style.minWidth = `${
            batchTableWidthV2(layoutRef.current) + delta
          }px`;
        }
        const draggedHandle = resizerLinesRef.current.get(drag.columnId);
        if (draggedHandle !== undefined) {
          draggedHandle.style.left = `${Math.round(width) - 4}px`;
        }
      };
      const up = (): void => {
        const drag = dragState.current;
        dragState.current = null;
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (drag === null) return;
        const col = tableRef.current?.querySelector(
          `col[data-column-id="${drag.columnId}"]`,
        );
        const applied = col?.getAttribute("style")?.match(/width:\s*(\d+)/);
        const finalWidth =
          applied === undefined || applied === null
            ? drag.startWidth
            : Number(applied[1]);
        onLayoutChange(
          setColumnWidthV2(layoutRef.current, drag.columnId, finalWidth),
        );
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    };
  };

  const resizeColumnFromKey = (
    columnId: BatchColumnId,
    delta: number,
  ): void => {
    const currentWidth = layoutRef.current.widths[columnId];
    if (currentWidth === undefined) return;
    resizeColumn(columnId, currentWidth + delta);
  };

  /** 按列 ID 渲染单元格内容（与 colgroup/thead 顺序一致）。 */
  const renderCell = (
    columnId: BatchColumnId,
    item: BatchItem,
  ): JSX.Element => {
    const itemProgress = progressLabel(lang, item);
    const selectedTrack = item.selectedTrackId ?? item.trackId ?? "";
    const badge = itemStatusBadge(lang, item);
    const discoveredTracks = item.availableTracks ?? [];
    // 刚加入列表（尚未做过任何获取/发现操作）：显示「加入列表成功」。
    const isFreshListed =
      item.status === "pending" &&
      item.acquisitionMethod === null &&
      item.errorCode === null &&
      item.rowCount === 0 &&
      item.trackId === null &&
      item.tracksDiscovered !== true;
    const isSpeechSucceeded =
      item.status === "succeeded" && item.acquisitionMethod === "speech";
    switch (columnId) {
      case "index":
        return (
          <td
            class="muzhi-batch__index-cell"
            data-column-id="index"
            data-label={t(lang, "batch.colIndex")}
          >
            <input
              aria-label={t(lang, "batch.selectItemAria", {
                title: item.title,
              })}
              checked={item.selected}
              aria-describedby={controlsUnavailableId}
              disabled={
                !hasCurrentList || busy || taskLocked || selectionPending
              }
              onChange={(event) =>
                onToggleItem(item.batchItemId, event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>{item.order + 1}</span>
          </td>
        );
      case "status":
        return (
          <td
            class="muzhi-batch__status-cell"
            data-column-id="status"
            data-label={t(lang, "batch.colSubtitleStatus")}
          >
            <div class="muzhi-batch__status-line">
              <span class="muzhi-batch__status-badge">
                <span
                  aria-hidden="true"
                  class="muzhi-batch__status-dot"
                  data-status={item.status}
                />
                {isFreshListed
                  ? t(lang, "batch.statusListed")
                  : isSpeechSucceeded
                    ? t(lang, "batch.speechSubtitleWithLanguage", {
                        language: speechLanguageLabel(
                          lang,
                          item.speechLanguageMode ?? speechLanguageMode,
                        ),
                      })
                    : badge.label}
                {!isFreshListed &&
                !isSpeechSucceeded &&
                badge.trackName !== null
                  ? ` · ${badge.trackName}`
                  : ""}
              </span>
              {!isFreshListed && item.status === "succeeded" ? (
                <small>
                  {t(lang, "batch.rowCount", { count: item.rowCount })}
                </small>
              ) : null}
              {!isFreshListed && item.status === "failed" ? (
                <small class="is-error">{itemErrorLabel(lang, item)}</small>
              ) : null}
              {itemProgress ? (
                <small class="muzhi-batch__progress-text">{itemProgress}</small>
              ) : null}
            </div>
            {!isFreshListed &&
            !isSpeechSucceeded &&
            discoveredTracks.length > 0 &&
            item.acquisitionMethod !== "speech" ? (
              <select
                aria-label={t(lang, "batch.trackAria", {
                  title: item.title,
                })}
                class="muzhi-batch__track-select"
                aria-describedby={controlsUnavailableId}
                disabled={
                  !hasCurrentList || busy || taskLocked || selectionPending
                }
                onInput={(event) =>
                  onChangeTrack(item, event.currentTarget.value)
                }
                title={t(lang, "batch.trackTitle")}
                value={selectedTrack}
              >
                <option value="">{t(lang, "batch.languageAuto")}</option>
                {discoveredTracks.map((track) => (
                  <option key={track.trackId} value={track.trackId}>
                    {track.name} · {track.language} ·{" "}
                    {track.source === "official"
                      ? t(lang, "batch.trackOfficial")
                      : t(lang, "batch.trackAi")}
                  </option>
                ))}
              </select>
            ) : null}
            {!isFreshListed ? (
              <button
                aria-label={t(lang, "batch.clearCurrentSubtitleAria", {
                  title: item.title,
                })}
                title={t(lang, "batch.clearCurrentSubtitleAria", {
                  title: item.title,
                })}
                class="muzhi-batch__clear-item"
                aria-describedby={controlsUnavailableId}
                disabled={
                  !hasCurrentList || busy || taskLocked || selectionPending
                }
                onClick={() => onClearItem(item.batchItemId)}
                type="button"
              >
                {t(lang, "common.clear")}
              </button>
            ) : null}
          </td>
        );
      case "title":
        return (
          <td
            class="muzhi-batch__title-cell"
            data-column-id="title"
            data-label={t(lang, "batch.colTitle")}
          >
            <div class="muzhi-batch__cell-text">
              <strong title={item.title}>{item.title}</strong>
            </div>
          </td>
        );
      case "author":
        return (
          <td data-column-id="author" data-label={t(lang, "batch.colAuthor")}>
            <div class="muzhi-batch__cell-text">
              {item.author?.trim() || "—"}
            </div>
          </td>
        );
      case "published":
        return (
          <td
            data-column-id="published"
            data-label={t(lang, "batch.colPublished")}
          >
            <div class="muzhi-batch__cell-text">
              {publishedAtLabel(item.publishedAt)}
            </div>
          </td>
        );
      case "identity":
        return (
          <td
            class="muzhi-batch__identity-cell"
            data-column-id="identity"
            data-label={t(lang, "batch.colIdentity")}
          >
            <div class="muzhi-batch__cell-text">
              <span>{item.bvid}</span>
              <small>
                P{item.page} · AID {item.aid ?? "—"} · CID {item.cid ?? "—"}
              </small>
            </div>
          </td>
        );
      case "actions":
        return (
          <td
            class="muzhi-batch__actions-cell"
            data-column-id="actions"
            data-label={t(lang, "batch.colOperations")}
          >
            {item.status === "succeeded" ? (
              <button
                aria-label={t(lang, "batch.exportItemAria", {
                  title: item.title,
                })}
                class="muzhi-batch__item-export"
                aria-describedby={controlsUnavailableId}
                disabled={
                  !hasCurrentList || busy || taskLocked || selectionPending
                }
                onClick={() => onExportItem(item)}
                title={t(lang, "batch.exportItemAria", {
                  title: item.title,
                })}
                type="button"
              >
                <BilimuzhiIcon aria-hidden="true" name="download" />
              </button>
            ) : (
              <button
                aria-label={t(lang, "batch.setupSpeechLanguageAria", {
                  title: item.title,
                })}
                class="muzhi-batch__item-speech-settings"
                aria-describedby={controlsUnavailableId}
                disabled={
                  !hasCurrentList || busy || taskLocked || selectionPending
                }
                onClick={() => onSpeechSettingsRequest(item.batchItemId)}
                title={t(lang, "batch.setupSpeechLanguageAria", {
                  title: item.title,
                })}
                type="button"
              >
                <BilimuzhiIcon aria-hidden="true" name="settings" />
              </button>
            )}
            <button
              aria-label={t(lang, "batch.removeFromListAria", {
                title: item.title,
              })}
              class="muzhi-batch__item-remove"
              aria-describedby={controlsUnavailableId}
              disabled={
                !hasCurrentList || busy || taskLocked || selectionPending
              }
              onClick={() => onRemoveItemRequest(item.batchItemId)}
              title={t(lang, "batch.removeFromListAria", {
                title: item.title,
              })}
              type="button"
            >
              <BilimuzhiIcon aria-hidden="true" name="trash" />
            </button>
          </td>
        );
      default:
        return <td />;
    }
  };

  return (
    <>
      <div
        aria-label={t(lang, "batch.hscrollAria")}
        class="muzhi-batch__hscroll"
        onScroll={syncHorizontalScroll}
        ref={hscrollRef}
        role="region"
        tabIndex={0}
      >
        <div
          class="muzhi-batch__hscroll-track"
          style={{
            minWidth: `var(--muzhi-batch-table-min, ${batchTableWidthV2(
              layout,
            )}px)`,
          }}
        />
      </div>
      <div
        aria-label={t(lang, "batch.scrollAria")}
        class="muzhi-batch__table-scroll"
        onScroll={syncHorizontalScrollReverse}
        ref={tableScrollRef}
        role="region"
        tabIndex={0}
      >
        <table
          aria-label={t(lang, "batch.tableAria")}
          ref={tableRef}
          class={`muzhi-batch__table${
            layout.forceFullText ? " is-full-text" : ""
          }`}
          style={{
            minWidth: `var(--muzhi-batch-table-min, ${batchTableWidthV2(
              layout,
            )}px)`,
          }}
        >
          <colgroup>
            {visibleColumns.map((columnId) => (
              <col
                data-column-id={columnId}
                key={columnId}
                style={{ width: `${layout.widths[columnId]}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((columnId, index) => {
                const isLast = index === visibleColumns.length - 1;
                const offset = layout.widths[columnId] - 4;
                return (
                  <th key={columnId} scope="col">
                    {columnLabel(lang, columnId)}
                    {columnId === "status" || columnId === "actions" ? (
                      <button
                        aria-label={
                          columnId === "status"
                            ? t(lang, "batch.helpStatusColumnAria")
                            : t(lang, "batch.helpActionsColumnAria")
                        }
                        class="muzhi-batch__column-help"
                        onClick={() => setHelpColumn(columnId)}
                        title={
                          columnId === "status"
                            ? t(lang, "batch.helpStatusColumnAria")
                            : t(lang, "batch.helpActionsColumnAria")
                        }
                        type="button"
                      >
                        ?
                      </button>
                    ) : null}
                    {!isLast ? (
                      <div
                        aria-label={t(lang, "batch.resizeColumnAria", {
                          column: columnLabel(lang, columnId),
                        })}
                        aria-orientation="vertical"
                        aria-valuemax={MAX_COLUMN_WIDTH_V2}
                        aria-valuemin={minColumnWidthV2(columnId)}
                        aria-valuenow={layout.widths[columnId]}
                        class="muzhi-batch__resizer"
                        onKeyDown={(event) => {
                          if (event.key === "ArrowLeft") {
                            event.preventDefault();
                            resizeColumnFromKey(columnId, -8);
                          } else if (event.key === "ArrowRight") {
                            event.preventDefault();
                            resizeColumnFromKey(columnId, 8);
                          }
                        }}
                        onPointerDown={startColumnResize(columnId)}
                        ref={(element) => {
                          if (element === null) {
                            resizerLinesRef.current.delete(columnId);
                          } else {
                            resizerLinesRef.current.set(columnId, element);
                          }
                        }}
                        role="separator"
                        style={{ left: `${offset}px` }}
                        tabIndex={0}
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                aria-selected={item.selected}
                class={item.selected ? "is-selected" : undefined}
                data-status={item.status}
                key={item.batchItemId}
                onClick={(event) => onToggleFromRow(event, item)}
              >
                {visibleColumns.map((columnId) => (
                  <Fragment key={`${item.batchItemId}-${columnId}`}>
                    {renderCell(columnId, item)}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {helpColumn !== null ? (
        <AppDialog
          description={
            helpColumn === "status"
              ? t(lang, "batch.helpStatusColumnBody")
              : t(lang, "batch.helpActionsColumnBody")
          }
          onCancel={() => setHelpColumn(null)}
          onConfirm={() => setHelpColumn(null)}
          role="dialog"
          singleAction
          title={
            helpColumn === "status"
              ? t(lang, "batch.helpStatusColumnTitle")
              : t(lang, "batch.helpActionsColumnTitle")
          }
          uiLanguage={lang}
        />
      ) : null}
    </>
  );
}
