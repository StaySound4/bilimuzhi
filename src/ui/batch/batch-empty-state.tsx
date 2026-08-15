/**
 * BatchListEmptyState — 批量空状态 seam 子组件（Ticket 01 抽离，Ticket 02 扩展）。
 *
 * 三种变体（spec：无列表与有空列表必须区分）：
 * - no-lists：完全没有 Batch List →「还没有列表」空卡片 + 新建列表引导；
 * - select-list：已有列表但未选中 → 提示先选择列表；
 * - list-empty：已创建但没有 BatchItem → 标题 + 解析按钮 +「当前列表
 *   还没有视频」空卡片（由父组件提供标题与解析入口）。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";

export type BatchListEmptyVariant = "no-lists" | "select-list" | "list-empty";

export interface BatchListEmptyStateProps {
  readonly uiLanguage?: UiLanguage;
  readonly variant?: BatchListEmptyVariant;
  readonly busy?: boolean;
  /** no-lists 变体的新建引导。 */
  readonly onCreateList?: () => void;
  /** list-empty 变体的解析入口。 */
  readonly onOpenSource?: () => void;
}

export function BatchListEmptyState({
  busy = false,
  onCreateList,
  onOpenSource,
  uiLanguage,
  variant = "no-lists",
}: BatchListEmptyStateProps) {
  const lang = uiLanguage ?? "zh-Hans";
  if (variant === "select-list") {
    return (
      <div class="muzhi-batch__empty-card" data-empty-variant="select-list">
        <h3>{t(lang, "batch.selectListPrompt")}</h3>
      </div>
    );
  }
  const isNoLists = variant === "no-lists";
  return (
    <div
      class="muzhi-batch__empty-card"
      data-empty-variant={isNoLists ? "no-lists" : "list-empty"}
    >
      <h3>
        {t(lang, isNoLists ? "batch.noListsTitle" : "batch.listEmptyTitle")}
      </h3>
      <p>{t(lang, isNoLists ? "batch.noListsBody" : "batch.listEmptyBody")}</p>
      {isNoLists && onCreateList ? (
        <button
          class="muzhi-btn muzhi-btn--primary"
          disabled={busy}
          onClick={onCreateList}
          type="button"
        >
          {t(lang, "drawer.newList")}
        </button>
      ) : null}
      {!isNoLists && onOpenSource ? (
        <button
          class="muzhi-btn muzhi-btn--primary"
          disabled={busy}
          onClick={onOpenSource}
          type="button"
        >
          {t(lang, "batch.parseDialogTitle")}
        </button>
      ) : null}
    </div>
  );
}
