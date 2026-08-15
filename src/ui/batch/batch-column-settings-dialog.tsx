/**
 * BatchColumnSettingsDialog — 调整列 Dialog（Ticket 05）。
 *
 * - 草稿模式：上移/下移/拖拽排序/可见性开关只改草稿，完成才原子
 *   应用；取消丢弃草稿；恢复默认一次恢复顺序、可见性、宽度与
 *   全文本开关；
 * - 序号永远第一（不可移动、不可隐藏）；字幕状态、操作不可隐藏；
 * - 键盘可用：上移/下移按钮与可见性复选框均可聚焦操作。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { useEffect, useRef, useState } from "preact/hooks";

import type { JSX } from "preact";
import type { BatchColumnId } from "./batch-column-layout";
import {
  defaultBatchColumnLayoutV2,
  moveColumnV2,
  reorderBatchColumnV2,
  toggleColumnVisibilityV2,
  type BatchColumnLayoutV2,
} from "./batch-column-layout-v2";
import { NON_HIDABLE_COLUMNS } from "./batch-contracts";
import { columnLabel } from "./batch-labels";

export interface BatchColumnSettingsDialogProps {
  readonly uiLanguage?: UiLanguage;
  readonly layout: BatchColumnLayoutV2;
  readonly busy?: boolean;
  readonly onApply: (next: BatchColumnLayoutV2) => void;
  readonly onCancel: () => void;
}

export function BatchColumnSettingsDialog({
  busy = false,
  layout,
  onApply,
  onCancel,
  uiLanguage,
}: BatchColumnSettingsDialogProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [draft, setDraft] = useState<BatchColumnLayoutV2>(layout);
  const [draggingId, setDraggingId] = useState<BatchColumnId | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(layout);
  }, [layout]);

  useEffect(() => {
    const focusTarget =
      dialogRef.current?.querySelector<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? null;
    focusTarget?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (busy) return;
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ),
    ];
    if (focusable.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    if (event.shiftKey && current === focusable[0]) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && current === focusable[focusable.length - 1]) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  const dropColumn = (
    event: JSX.TargetedDragEvent<HTMLLIElement>,
    targetId: BatchColumnId,
  ): void => {
    event.preventDefault();
    const source = draggingId;
    setDraggingId(null);
    if (source === null || source === targetId) return;
    const order = [...draft.order];
    const from = order.indexOf(source);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, source);
    setDraft(reorderBatchColumnV2(draft, order));
  };

  return (
    <div
      class="muzhi-batch__overlay"
      onClick={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div
        aria-labelledby="muzhi-batch-column-settings-title"
        aria-modal="true"
        class="muzhi-batch__dialog muzhi-batch__column-settings"
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h3 id="muzhi-batch-column-settings-title">
          {t(lang, "batch.columnSettingsTitle")}
        </h3>
        <p class="muzhi-batch__inline-hint">
          {t(lang, "batch.columnSettingsDesc")}
        </p>
        <ul
          aria-label={t(lang, "batch.columnSettingsTitle")}
          class="muzhi-batch__column-order"
        >
          {draft.order.map((columnId) => {
            const hideable = !NON_HIDABLE_COLUMNS.includes(columnId);
            const visible = draft.visible[columnId] !== false;
            const index = draft.order.indexOf(columnId);
            const isFirst = index === 0;
            const isLast = index === draft.order.length - 1;
            return (
              <li
                class="muzhi-batch__column-order-item"
                draggable={!busy && columnId !== "index"}
                key={columnId}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggingId(columnId)}
                onDrop={(event) => dropColumn(event, columnId)}
              >
                <span
                  aria-hidden="true"
                  class="muzhi-batch__column-drag"
                  title={t(lang, "batch.columnDragAria", {
                    column: columnLabel(lang, columnId),
                  })}
                >
                  ⠿
                </span>
                <strong>{columnLabel(lang, columnId)}</strong>
                {hideable ? (
                  <label class="muzhi-batch__column-visible">
                    <input
                      aria-label={t(lang, "batch.columnVisibleAria", {
                        column: columnLabel(lang, columnId),
                      })}
                      checked={visible}
                      disabled={busy}
                      onChange={() =>
                        setDraft(toggleColumnVisibilityV2(draft, columnId))
                      }
                      type="checkbox"
                    />
                    {t(lang, "common.show")}
                  </label>
                ) : (
                  <span class="muzhi-batch__column-locked" aria-hidden="true">
                    {t(lang, "batch.columnLocked")}
                  </span>
                )}
                <div class="muzhi-batch__column-move">
                  <button
                    aria-label={t(lang, "batch.columnMoveUp", {
                      column: columnLabel(lang, columnId),
                    })}
                    disabled={busy || columnId === "index" || isFirst}
                    onClick={() => setDraft(moveColumnV2(draft, columnId, -1))}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={t(lang, "batch.columnMoveDown", {
                      column: columnLabel(lang, columnId),
                    })}
                    disabled={busy || columnId === "index" || isLast}
                    onClick={() => setDraft(moveColumnV2(draft, columnId, 1))}
                    type="button"
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p class="muzhi-batch__inline-hint">
          {t(lang, "batch.columnSettingsHint")}
        </p>
        <div class="muzhi-batch__dialog-actions">
          <button
            disabled={busy}
            onClick={() => setDraft(defaultBatchColumnLayoutV2())}
            type="button"
          >
            {t(lang, "batch.columnRestoreDefaults")}
          </button>
          <button disabled={busy} onClick={onCancel} type="button">
            {t(lang, "common.cancel")}
          </button>
          <button
            class="muzhi-dialog__primary"
            disabled={busy}
            onClick={() => onApply(draft)}
            type="button"
          >
            {t(lang, "batch.columnApply")}
          </button>
        </div>
      </div>
    </div>
  );
}
