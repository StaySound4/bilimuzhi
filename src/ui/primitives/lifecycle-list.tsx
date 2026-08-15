/**
 * LifecycleList — Session/Batch 共享的生命周期列表 primitive（Ticket 07）。
 *
 * Archive 与 Trash 复用同一结构：搜索、多选、全选搜索结果、行结构、
 * 三点菜单、恢复、移入回收站/永久删除与危险确认；数据行为通过
 * adapter 注入，Session 只读写 Session repository，Batch 只读写
 * Batch repository，严格隔离。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";
import type { UiLanguage } from "../../i18n/languages";
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import type { LifecycleKind, LifecycleSurface } from "../batch/batch-contracts";
import { AppDialog } from "../dialogs/app-dialog";
import { BilimuzhiIcon } from "../icons";
import {
  CompactActionMenu,
  type CompactActionMenuItem,
} from "./compact-action-menu";

export interface LifecycleListAdapter {
  readonly kind: LifecycleKind;
  readonly surface: LifecycleSurface;
  readonly searchLabelKey: MessageKey;
  readonly searchPlaceholderKey: MessageKey;
  readonly countKey: MessageKey;
  readonly emptyKey: MessageKey;
  readonly noMatchKey: MessageKey;
  readonly restoreLabelKey: MessageKey;
  /** Archive 专属：移入对应 Trash 的行级菜单文案。 */
  readonly trashLabelKey: MessageKey | null;
  /** Trash 专属：永久删除的行级菜单文案。 */
  readonly purgeLabelKey: MessageKey | null;
  readonly actionsAriaKey: MessageKey;
  readonly selectAriaKey: MessageKey;
  /** 多选工具栏的无障碍组名（Session/Batch 各自语境）。 */
  readonly selectionAriaKey: MessageKey;
  readonly restoreManyLabelKey: MessageKey;
  readonly trashManyLabelKey: MessageKey | null;
  readonly purgeManyLabelKey: MessageKey | null;
  readonly runningNamesKey: MessageKey;
  /** 移入回收站/永久删除总是先危险确认（如会话删除语义）。 */
  readonly confirmTrash?: boolean;
  readonly confirmPurge?: boolean;
  readonly confirmTrashTitleKey?: MessageKey;
  readonly confirmTrashBodyKey?: MessageKey;
  readonly confirmPurgeTitleKey?: MessageKey;
  readonly confirmPurgeBodyKey?: MessageKey;
  /** 危险确认正文生成器（如需要 {counts} 等动态参数）；缺省无参渲染 bodyKey。 */
  readonly confirmBody?: (lang: UiLanguage, ids: readonly string[]) => string;
}

export interface LifecycleItemView {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  /** 行级状态点（运行中）；危险操作（移入回收站/永久删除）先确认。 */
  readonly running?: boolean;
}

export interface LifecycleListProps<TItem> {
  readonly uiLanguage?: UiLanguage;
  readonly busy?: boolean;
  readonly adapter: LifecycleListAdapter;
  readonly items: readonly TItem[];
  readonly toView: (item: TItem) => LifecycleItemView;
  readonly matches: (item: TItem, query: string) => boolean;
  readonly onRestore: (ids: readonly string[]) => void;
  readonly onRestoreMany?: (ids: readonly string[]) => void;
  /** 非多选模式点击行（如会话归档打开会话）。 */
  readonly onOpen?: (item: TItem) => void;
  /** Archive：移入对应 Trash。 */
  readonly onMoveToTrash?: (ids: readonly string[]) => void;
  /** Trash：永久删除。 */
  readonly onPurge?: (ids: readonly string[]) => void;
  /** surface 专属的行级菜单附加项（如重命名/编辑标签）。 */
  readonly rowMenuExtra?: (item: TItem) => readonly CompactActionMenuItem[];
  /** 行内附加动作按钮（如会话归档的编辑标签）。 */
  readonly rowAction?: (item: TItem) => {
    readonly ariaLabel: string;
    readonly icon: "tag";
    readonly title: string;
    readonly onClick: () => void;
  } | null;
  /** 多选工具栏附加动作（如会话归档的批量编辑标签）。 */
  readonly selectionExtra?: (selectedIds: readonly string[]) => readonly {
    readonly danger?: boolean;
    readonly label: string;
    readonly onClick: () => void;
  }[];
  /** 行内附加渲染（如会话归档的卡片内标签编辑面板）。 */
  readonly rowChildren?: (item: TItem) => JSX.Element | null;
}

type ConfirmKind = "trash" | "purge";

export function LifecycleList<TItem>({
  adapter,
  busy = false,
  items,
  matches,
  onMoveToTrash,
  onOpen,
  onPurge,
  onRestore,
  onRestoreMany,
  rowAction,
  rowChildren,
  rowMenuExtra,
  selectionExtra,
  toView,
  uiLanguage,
}: LifecycleListProps<TItem>) {
  const lang = uiLanguage ?? "zh-Hans";
  const [query, setQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(
    Object.freeze([]),
  );
  const [confirming, setConfirming] = useState<{
    readonly kind: ConfirmKind;
    readonly ids: readonly string[];
  } | null>(null);

  const normalized = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      normalized.length === 0
        ? items
        : items.filter((item) => matches(item, normalized)),
    [items, matches, normalized],
  );
  const views = useMemo(
    () => new Map(visibleItems.map((item) => [toView(item).id, toView(item)])),
    [visibleItems, toView],
  );
  const visibleIds = useMemo(
    () => visibleItems.map((item) => toView(item).id),
    [visibleItems, toView],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const runningTitles = (ids: readonly string[]): string[] =>
    ids
      .map((id) => views.get(id))
      .filter((view): view is LifecycleItemView => view?.running === true)
      .map((view) => view.title);

  const toggleId = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return Object.freeze([...next]);
    });
  };

  const toggleAll = (): void => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const visible = new Set(visibleIds);
        return Object.freeze(current.filter((id) => !visible.has(id)));
      }
      return Object.freeze([...new Set([...current, ...visibleIds])]);
    });
  };

  const leaveSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedIds(Object.freeze([]));
  };

  const runRestore = (ids: readonly string[]): void => {
    const many = ids.length > 1 && onRestoreMany !== undefined;
    if (many) onRestoreMany(ids);
    else onRestore(ids);
    leaveSelectionMode();
  };

  const runTrash = (ids: readonly string[]): void => {
    if (onMoveToTrash === undefined) return;
    if (adapter.confirmTrash === true || runningTitles(ids).length > 0) {
      setConfirming(Object.freeze({ kind: "trash", ids }));
      return;
    }
    onMoveToTrash(ids);
    leaveSelectionMode();
  };

  const runPurge = (ids: readonly string[]): void => {
    if (onPurge === undefined) return;
    if (adapter.confirmPurge === true || runningTitles(ids).length > 0) {
      setConfirming(Object.freeze({ kind: "purge", ids }));
      return;
    }
    onPurge(ids);
    leaveSelectionMode();
  };

  const confirmDanger = (): void => {
    if (confirming === null) return;
    const { ids, kind } = confirming;
    setConfirming(null);
    if (kind === "trash") onMoveToTrash?.(ids);
    else onPurge?.(ids);
    leaveSelectionMode();
  };

  const rowMenu = (item: TItem): readonly CompactActionMenuItem[] => {
    const view = toView(item);
    const extra = rowMenuExtra?.(item) ?? [];
    return [
      {
        disabled: busy,
        icon: "archive",
        kind: "item",
        label: t(lang, adapter.restoreLabelKey),
        onSelect: () => runRestore([view.id]),
      },
      ...(adapter.trashLabelKey !== null && onMoveToTrash !== undefined
        ? [
            {
              danger: true,
              disabled: busy,
              icon: "trash" as const,
              kind: "item" as const,
              label: t(lang, adapter.trashLabelKey),
              onSelect: () => runTrash([view.id]),
            },
          ]
        : []),
      ...(adapter.purgeLabelKey !== null && onPurge !== undefined
        ? [
            {
              danger: true,
              disabled: busy,
              icon: "trash" as const,
              kind: "item" as const,
              label: t(lang, adapter.purgeLabelKey),
              onSelect: () => runPurge([view.id]),
            },
          ]
        : []),
      ...extra,
    ];
  };

  const restoreManyLabel = t(lang, adapter.restoreManyLabelKey);
  const trashManyLabel =
    adapter.trashManyLabelKey !== null
      ? t(lang, adapter.trashManyLabelKey)
      : null;
  const purgeManyLabel =
    adapter.purgeManyLabelKey !== null
      ? t(lang, adapter.purgeManyLabelKey)
      : null;

  return (
    <div
      class="muzhi-lifecycle"
      data-kind={adapter.kind}
      data-surface={adapter.surface}
    >
      <label class="muzhi-lifecycle__search">
        {t(lang, adapter.searchLabelKey)}
        <input
          aria-label={t(lang, adapter.searchLabelKey)}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={t(lang, adapter.searchPlaceholderKey)}
          type="search"
          value={query}
        />
      </label>
      <div class="muzhi-lifecycle__summary">
        <p aria-live="polite">
          {t(lang, adapter.countKey, { count: visibleItems.length })}
        </p>
        {items.length > 0 ? (
          <button
            disabled={busy}
            onClick={() =>
              selectionMode ? leaveSelectionMode() : setSelectionMode(true)
            }
            type="button"
          >
            {selectionMode
              ? t(lang, "common.cancel")
              : t(lang, "archive.multiSelect")}
          </button>
        ) : null}
      </div>
      {selectionMode ? (
        <div
          aria-label={t(lang, adapter.selectionAriaKey)}
          class="muzhi-lifecycle__selection-toolbar"
          role="group"
        >
          <button
            disabled={busy || visibleIds.length === 0}
            onClick={toggleAll}
            type="button"
          >
            {allVisibleSelected
              ? t(lang, "drawer.deselectAll")
              : t(lang, "drawer.selectAll")}
          </button>
          <span aria-live="polite">
            {t(lang, "drawer.selectedCount", {
              count: selectedIds.length,
            })}
          </span>
          <button
            disabled={busy || selectedIds.length === 0}
            onClick={() => runRestore(selectedIds)}
            type="button"
          >
            {restoreManyLabel}
          </button>
          {trashManyLabel !== null ? (
            <button
              disabled={busy || selectedIds.length === 0}
              onClick={() => runTrash(selectedIds)}
              type="button"
            >
              {trashManyLabel}
            </button>
          ) : null}
          {purgeManyLabel !== null ? (
            <button
              disabled={busy || selectedIds.length === 0}
              onClick={() => runPurge(selectedIds)}
              type="button"
            >
              {purgeManyLabel}
            </button>
          ) : null}
          {(selectionExtra?.(selectedIds) ?? []).map((action) => (
            <button
              class={
                action.danger === true ? "muzhi-lifecycle__danger" : undefined
              }
              disabled={busy || selectedIds.length === 0}
              key={action.label}
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {visibleItems.length === 0 ? (
        <p class="muzhi-lifecycle__empty" role="status">
          {items.length === 0
            ? t(lang, adapter.emptyKey)
            : t(lang, adapter.noMatchKey)}
        </p>
      ) : (
        <ul class="muzhi-lifecycle__list">
          {visibleItems.map((item) => {
            const view = toView(item);
            const selected = selectedSet.has(view.id);
            const action = rowAction?.(item) ?? null;
            return (
              <li
                aria-selected={selectionMode ? selected : undefined}
                class={selected ? "is-selected" : undefined}
                key={view.id}
              >
                <div
                  class={`muzhi-lifecycle__row${
                    selectionMode ? " is-selecting" : ""
                  }`}
                >
                  {selectionMode ? (
                    <input
                      aria-label={t(lang, adapter.selectAriaKey, {
                        title: view.title,
                      })}
                      checked={selected}
                      disabled={busy}
                      onChange={() => toggleId(view.id)}
                      type="checkbox"
                    />
                  ) : null}
                  <button
                    class="muzhi-lifecycle__select"
                    disabled={busy}
                    onClick={() =>
                      selectionMode ? toggleId(view.id) : onOpen?.(item)
                    }
                    title={view.title}
                    type="button"
                  >
                    <strong>{view.title}</strong>
                    <small>{view.meta}</small>
                  </button>
                  <span
                    aria-hidden={view.running ? undefined : "true"}
                    class={`muzhi-lifecycle__state-slot${
                      view.running ? " is-running" : ""
                    }`}
                  />
                  {action !== null ? (
                    <button
                      aria-label={action.ariaLabel}
                      class="muzhi-lifecycle__row-action"
                      disabled={busy}
                      onClick={action.onClick}
                      title={action.title}
                      type="button"
                    >
                      <BilimuzhiIcon name={action.icon} title="" />
                    </button>
                  ) : null}
                  {!selectionMode ? (
                    <CompactActionMenu
                      ariaLabel={t(lang, adapter.actionsAriaKey, {
                        title: view.title,
                      })}
                      items={rowMenu(item)}
                    />
                  ) : null}
                </div>
                {rowChildren?.(item) ?? null}
              </li>
            );
          })}
        </ul>
      )}
      {confirming !== null ? (
        <AppDialog
          busy={busy}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "drawer.confirmAction")}
          danger
          description={(() => {
            const bodyKey =
              confirming.kind === "trash"
                ? (adapter.confirmTrashBodyKey ??
                  "drawer.archiveListRunningWarning")
                : (adapter.confirmPurgeBodyKey ??
                  "drawer.deleteListRunningWarning");
            const body =
              adapter.confirmBody !== undefined
                ? adapter.confirmBody(lang, confirming.ids)
                : t(lang, bodyKey);
            const running = runningTitles(confirming.ids);
            if (running.length === 0) return body;
            return `${body}${t(lang, adapter.runningNamesKey, {
              names: running.join(t(lang, "common.nameSeparator")),
            })}`;
          })()}
          onCancel={() => setConfirming(null)}
          onConfirm={() => confirmDanger()}
          title={
            confirming.kind === "trash"
              ? t(
                  lang,
                  adapter.confirmTrashTitleKey ??
                    "drawer.confirmArchiveListTitle",
                )
              : t(
                  lang,
                  adapter.confirmPurgeTitleKey ??
                    "drawer.confirmDeleteListTitle",
                )
          }
          uiLanguage={lang}
        />
      ) : null}
    </div>
  );
}
