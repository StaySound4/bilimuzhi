import { type JSX } from "preact";

import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export interface AppearancePreference {
  readonly theme: ThemeMode;
}

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference =
  Object.freeze({ theme: "system" });

function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value);
}

export interface AppearanceControlsProps {
  readonly onChange: (preference: AppearancePreference) => void;
  readonly preference: AppearancePreference;
  readonly uiLanguage?: UiLanguage;
}

export function AppearanceControls({
  onChange,
  preference,
  uiLanguage,
}: AppearanceControlsProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const updateTheme = (
    event: JSX.TargetedEvent<HTMLSelectElement, Event>,
  ): void => {
    const theme = event.currentTarget.value;
    if (isThemeMode(theme)) {
      onChange(Object.freeze({ ...preference, theme }));
    }
  };
  return (
    <div class="muzhi-appearance" aria-label={t(lang, "settings.appearance")}>
      <label>
        <span>{t(lang, "header.theme")}</span>
        <select
          aria-label={t(lang, "header.theme")}
          onInput={updateTheme}
          value={preference.theme}
        >
          <option value="system">{t(lang, "header.themeFollowSystem")}</option>
          <option value="light">{t(lang, "header.themeLight")}</option>
          <option value="dark">{t(lang, "header.themeDark")}</option>
        </select>
      </label>
    </div>
  );
}
