/**
 * Side Panel 外观状态：加载、旧版本迁移与默认值。
 *
 * 深模块：调用方只需「读取外观状态 / 写回外观状态」，无需了解
 * version 迁移与主题/宽度校验细节。
 */
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  THEME_MODES,
  type AppearancePreference,
} from "./appearance";
import { DEFAULT_CONVERSATION_PANE_WIDTH_PX } from "./conversation-splitter";

export const APPEARANCE_STORAGE_KEY = "muzhi.appearance.v1";

export interface SidePanelAppearanceState {
  readonly appearance: AppearancePreference;
  readonly conversationPaneWidthPx: number;
  readonly version: 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isThemeMode(
  value: unknown,
): value is AppearancePreference["theme"] {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

export function isAppearanceState(
  value: unknown,
): value is SidePanelAppearanceState {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.appearance)) {
    return false;
  }
  return (
    isThemeMode(value.appearance.theme) &&
    typeof value.conversationPaneWidthPx === "number" &&
    Number.isFinite(value.conversationPaneWidthPx) &&
    value.conversationPaneWidthPx > 0
  );
}

export function upgradeLegacyAppearanceState(
  value: unknown,
): SidePanelAppearanceState | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.appearance)) {
    return null;
  }
  const theme = value.appearance.theme;
  const conversationPaneWidthPx = value.conversationPaneWidthPx;
  if (
    !isThemeMode(theme) ||
    typeof conversationPaneWidthPx !== "number" ||
    !Number.isFinite(conversationPaneWidthPx) ||
    conversationPaneWidthPx <= 0
  ) {
    return null;
  }
  return Object.freeze({
    appearance: Object.freeze({ theme }),
    conversationPaneWidthPx,
    version: 2,
  });
}

export function defaultAppearanceState(): SidePanelAppearanceState {
  return Object.freeze({
    appearance: DEFAULT_APPEARANCE_PREFERENCE,
    conversationPaneWidthPx: DEFAULT_CONVERSATION_PANE_WIDTH_PX,
    version: 2,
  });
}
