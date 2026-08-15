import { t } from "../../i18n";
import {
  UI_LANGUAGE_META,
  type OutputLanguagePreference,
  type UiLanguage,
} from "../../i18n/languages";
import { useState } from "preact/hooks";

import "./task-model-picker.css";

export interface TaskModelProfileOption {
  readonly id: string;
  readonly name: string;
  readonly models: readonly {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    readonly reasoningEfforts: readonly string[];
  }[];
}

export interface TaskModelSelection {
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: string;
  readonly state: "needs-reselection" | "ready";
}

/** 变更入参：配置/模型/推理强度三元组（各模式界面与 sidepanel 共用）。 */
export interface TaskModelSelectionInput {
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: string;
}

export interface TaskModelPickerProps {
  readonly uiLanguage?: UiLanguage;
  readonly label: string;
  readonly profiles: readonly TaskModelProfileOption[];
  readonly selection: TaskModelSelection | null;
  readonly busy?: boolean;
  /** 输出语言偏好（per-mode 弱约束默认值）；"auto" 表示不指定。 */
  readonly outputLanguage?: OutputLanguagePreference;
  /** 输出语言锁定（对话模式：会话已发出消息后锁定）。 */
  readonly outputLanguageLocked?: boolean;
  readonly onOutputLanguageChange?: (
    language: OutputLanguagePreference,
  ) => void;
  /** 调用方传入的外部错误（如保存失败）；与内部空模型错误合并展示。 */
  readonly selectionError?: string;
  readonly onChange: (next: TaskModelSelectionInput) => void;
}

/**
 * 各模式界面顶部的模型配置行：配置 / 模型 / 推理强度三联动。
 * 变更即持久化（由调用方保存，有记忆）；切换配置无可用模型时内联报错
 * 且不触发保存；needs-reselection 只提示、不自动回退。
 */
export function TaskModelPicker({
  uiLanguage,
  busy = false,
  label,
  onChange,
  outputLanguage = "auto",
  outputLanguageLocked = false,
  onOutputLanguageChange,
  profiles,
  selection,
  selectionError,
}: TaskModelPickerProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [pendingError, setPendingError] = useState("");
  const selectedProfile =
    profiles.find(({ id }) => id === selection?.profileId) ?? null;
  const availableModels = (selectedProfile?.models ?? []).filter(
    ({ enabled }) => enabled,
  );
  const selectedModel = availableModels.find(
    ({ id }) => id === selection?.modelId,
  );
  const efforts = Array.from(
    new Set([
      ...(selectedModel?.reasoningEfforts ?? []),
      ...(selection === null ||
      selection.reasoningEffort === "provider-default" ||
      (selectedModel?.reasoningEfforts.length ?? 0) === 0
        ? ["provider-default"]
        : []),
    ]),
  );
  const error = pendingError || selectionError || "";

  function changeProfile(profileId: string): void {
    const profile = profiles.find(({ id }) => id === profileId);
    const firstModel = profile?.models.find(({ enabled }) => enabled);
    if (!firstModel) {
      setPendingError(t(lang, "taskModel.noModelsHint"));
      return;
    }
    setPendingError("");
    onChange({
      modelId: firstModel.id,
      profileId,
      reasoningEffort: "provider-default",
    });
  }

  function changeModel(modelId: string): void {
    setPendingError("");
    if (selection === null || selectedProfile === null) return;
    const model = availableModels.find(({ id }) => id === modelId);
    const reasoningEffort =
      model !== undefined &&
      (model.reasoningEfforts.includes(selection.reasoningEffort) ||
        selection.reasoningEffort === "provider-default")
        ? selection.reasoningEffort
        : "provider-default";
    onChange({
      modelId,
      profileId: selectedProfile.id,
      reasoningEffort,
    });
  }

  function changeEffort(reasoningEffort: string): void {
    setPendingError("");
    if (selection === null || selectedProfile === null) return;
    onChange({
      modelId: selection.modelId,
      profileId: selectedProfile.id,
      reasoningEffort,
    });
  }

  return (
    <div className="muzhi-task-model">
      <label>
        {t(lang, "taskModel.profileSuffix", { label })}
        <select
          aria-label={`${t(lang, "taskModel.profileSuffix", { label })}`}
          disabled={busy}
          onInput={(event) => changeProfile(event.currentTarget.value)}
          value={selection?.profileId ?? ""}
        >
          {selection === null ? (
            <option value="">{t(lang, "taskModel.notConfigured")}</option>
          ) : null}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(lang, "taskModel.modelSuffix", { label })}
        <select
          aria-label={`${t(lang, "taskModel.modelSuffix", { label })}`}
          disabled={busy}
          onInput={(event) => changeModel(event.currentTarget.value)}
          value={selection?.modelId ?? ""}
        >
          {availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(lang, "taskModel.reasoningSuffix", { label })}
        <select
          aria-label={`${t(lang, "taskModel.reasoningSuffix", { label })}`}
          disabled={busy}
          onInput={(event) => changeEffort(event.currentTarget.value)}
          value={selection?.reasoningEffort ?? "provider-default"}
        >
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort === "provider-default"
                ? t(lang, "taskModel.providerDefault")
                : effort}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(lang, "taskModel.outputLanguageSuffix", { label })}
        <select
          aria-label={`${t(lang, "taskModel.outputLanguageSuffix", { label })}`}
          disabled={
            busy || outputLanguageLocked || onOutputLanguageChange === undefined
          }
          onInput={(event) =>
            onOutputLanguageChange?.(
              event.currentTarget.value as OutputLanguagePreference,
            )
          }
          value={outputLanguage}
        >
          <option value="auto">
            {t(lang, "taskModel.outputLanguageAuto")}
          </option>
          {UI_LANGUAGE_META["zh-Hans"]
            ? (["zh-Hans", "zh-Hant", "en", "ja"] as const).map((language) => (
                <option key={language} value={language}>
                  {UI_LANGUAGE_META[language].label}
                </option>
              ))
            : null}
        </select>
      </label>
      {outputLanguageLocked ? (
        <p role="status">{t(lang, "taskModel.outputLanguageLockedHint")}</p>
      ) : null}
      {error !== "" ? <p role="alert">{error}</p> : null}
      {selection !== null && selection.state === "needs-reselection" ? (
        <p role="status">{t(lang, "taskModel.needsReselection")}</p>
      ) : null}
    </div>
  );
}
