import { t } from "../../i18n";
import {
  UI_LANGUAGE_META,
  type OutputLanguagePreference,
  type UiLanguage,
} from "../../i18n/languages";
import type {
  TaskModelProfileOption,
  TaskModelSelection,
} from "./task-model-picker";

const REASONING_KEYS = {
  high: "taskModel.reasoningHigh",
  low: "taskModel.reasoningLow",
  medium: "taskModel.reasoningMedium",
} as const;

export function taskContextSummaryParts(
  lang: UiLanguage,
  profiles: readonly TaskModelProfileOption[],
  selection: TaskModelSelection | null,
  outputLanguage: OutputLanguagePreference,
): readonly string[] {
  if (selection === null) return [t(lang, "chat.noModel")];
  const profile = profiles.find(({ id }) => id === selection.profileId);
  const model = profile?.models.find(({ id }) => id === selection.modelId);
  const reasoningKey =
    REASONING_KEYS[selection.reasoningEffort as keyof typeof REASONING_KEYS];
  const reasoning =
    selection.reasoningEffort === "provider-default"
      ? t(lang, "taskModel.providerDefault")
      : reasoningKey
        ? t(lang, reasoningKey)
        : selection.reasoningEffort;
  const language =
    outputLanguage === "auto"
      ? t(lang, "taskModel.outputLanguageAuto")
      : UI_LANGUAGE_META[outputLanguage].label;
  return [
    profile?.name ?? t(lang, "taskModel.notConfigured"),
    model?.label ?? t(lang, "taskModel.notConfigured"),
    reasoning,
    language,
  ];
}
