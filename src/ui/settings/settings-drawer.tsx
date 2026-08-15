import { useEffect, useId, useRef, useState } from "preact/hooks";

import { BilimuzhiIcon } from "../icons";
import type { RetentionChoice } from "../retention";
import "./settings-drawer.css";
import { t } from "../../i18n";
import { isCustomReasoningEffort } from "../../application/ai/provider-contract";
import { displayPresetName } from "../prompt-preset-name";
import type { MessageKey } from "../../i18n/messages";
import { UI_LANGUAGE_META, type UiLanguage } from "../../i18n/languages";
const sections = ["外观", "AI", "任务模型", "提示词", "缓存", "关于"] as const;
type SettingsSection = (typeof sections)[number];

/**
 * Groq 密钥眼睛按钮共享逻辑:已配置但输入框为空时按需取回明文显示,
 * 否则本地切换遮罩/明文。主组件与 V12 组件共用,避免两处重复演进。
 */
function toggleGroqSecretVisibility(input: {
  readonly configured: boolean;
  readonly draft: string;
  readonly onReveal?: () => Promise<string | null>;
  readonly setDraft: (value: string) => void;
  readonly setVisible: (updater: (visible: boolean) => boolean) => void;
  readonly visible: boolean;
}): void {
  if (!input.visible && input.draft === "" && input.configured) {
    void input.onReveal?.().then((revealed) => {
      if (revealed !== null && revealed !== undefined) {
        input.setDraft(revealed);
        input.setVisible(() => true);
      }
    });
    return;
  }
  input.setVisible((visible) => !visible);
}

const SECTION_KEYS: Record<SettingsSection, MessageKey> = {
  外观: "settings.appearance",
  AI: "settings.ai",
  任务模型: "settings.taskModels",
  提示词: "settings.prompts",
  缓存: "settings.cache",
  关于: "settings.about",
};

const TASK_PROMPT_FIELDS = [
  {
    kind: "summary" as const,
    labelKey: "settings.taskPromptSummaryLabel",
    placeholderKey: "settings.taskPromptSummaryPlaceholder",
  },
  {
    kind: "segments" as const,
    labelKey: "settings.taskPromptSegmentsLabel",
    placeholderKey: "settings.taskPromptSegmentsPlaceholder",
  },
  {
    kind: "chat" as const,
    labelKey: "settings.taskPromptChatLabel",
    placeholderKey: "settings.taskPromptChatPlaceholder",
  },
] as const;
export type ThemeChoice = "dark" | "light" | "system";
export type { RetentionChoice } from "../retention";

export interface ProviderOption {
  readonly id: string;
  readonly label: string;
}
export interface ModelCapability {
  readonly id: string;
  readonly label: string;
  readonly reasoningEfforts: readonly string[];
}
export interface ExportPreference {
  readonly includeTimestamps: boolean;
  readonly format: "markdown" | "srt" | "txt";
}
export type SettingsActionResult = boolean | void | Promise<boolean | void>;
export type SettingsTaskKind = "chat" | "segments" | "summary";
export interface PromptPresetOption {
  readonly builtIn: boolean;
  readonly content: string;
  readonly id: string;
  readonly kind: SettingsTaskKind;
  readonly name: string;
}
export interface TaskModelChoice {
  readonly kind: SettingsTaskKind;
  readonly label: string;
  /** Empty means "follow the default model". */
  readonly modelId: string;
  readonly reasoningEffort: string;
}
export interface V12ProviderProfileOption {
  readonly apiKey: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly baseUrl: string;
  readonly hostPermission: "granted" | "missing";
  readonly id: string;
  readonly protocol?: "openai-chat" | "openai-responses";
  readonly models: readonly {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    /** 模型能力声明的档位（内置七档子集）。 */
    readonly reasoningEfforts: readonly string[];
    /** v13 每模型思考覆盖；null = 未设置（跟随模型默认）。 */
    readonly reasoningOverride: {
      readonly effort: string;
      readonly enabled: boolean;
    } | null;
    readonly verification: "unverified" | "verified";
  }[];
  readonly name: string;
}
export interface V12TaskChoice {
  readonly kind: SettingsTaskKind;
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: string;
  readonly state: "ready" | "needs-reselection";
}
export interface ProviderProfilePresetInput {
  readonly baseUrl: string;
  readonly name: string;
  readonly presetId: string;
  readonly protocol: "openai-compatible";
}
export type V12BackupGroup =
  "application-ai" | "prompts" | "workspace" | "archive" | "trash";
export type SettingsBackupCardGroup = V12BackupGroup | "api-keys";

export interface SettingsBackupCounts {
  readonly archive: number;
  readonly languageModels: number;
  readonly prompts: { readonly chat: number; readonly summary: number };
  readonly trash: number;
  readonly workspace: number;
}

export interface V12BackupSelection {
  readonly groups: readonly V12BackupGroup[];
  readonly includeKeys: boolean;
  readonly password?: string;
}

export interface V12BackupImportRequest {
  readonly json: string;
}
export interface SettingsFeedback {
  readonly kind: "error" | "pending" | "status";
  readonly text: string;
}
export interface SettingsDrawerProps {
  readonly busy?: boolean;
  readonly open: boolean;
  readonly apiKey: string;
  readonly apiKeyConfigured: boolean;
  readonly groqApiKey: string;
  readonly groqApiKeyConfigured: boolean;
  readonly theme: ThemeChoice;
  readonly uiLanguage: "zh-Hans" | "zh-Hant" | "en" | "ja";
  readonly providers: readonly ProviderOption[];
  readonly providerId: string;
  readonly baseUrl: string;
  readonly protocol: "anthropic" | "gemini" | "openai-compatible";
  readonly models: readonly ModelCapability[];
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly retention: RetentionChoice;
  readonly customRetentionDays: string;
  readonly applyRetentionTo: "existing" | "future";
  readonly exportPreference: ExportPreference;
  readonly promptTemplate: string;
  readonly taskPrompts?: Readonly<Record<SettingsTaskKind, string>>;
  readonly promptPresets?: readonly PromptPresetOption[];
  readonly selectedPromptPresetIds?: Readonly<Record<SettingsTaskKind, string>>;
  readonly defaultPromptPresetIds?: Readonly<Record<SettingsTaskKind, string>>;
  readonly onCopyPromptPreset?: (presetId: string) => SettingsActionResult;
  readonly onCreatePromptPreset?: (
    kind: SettingsTaskKind,
  ) => SettingsActionResult;
  readonly onDeletePromptPreset?: (presetId: string) => SettingsActionResult;
  readonly onExportPromptPresets?: (
    format: "json" | "text",
  ) => SettingsActionResult;
  readonly onImportPromptPresets?: (
    format: "json" | "text",
  ) => SettingsActionResult;
  readonly onRestoreBuiltInPrompt?: (
    kind: SettingsTaskKind,
  ) => SettingsActionResult;
  readonly onSelectPromptPreset?: (value: {
    readonly kind: SettingsTaskKind;
    readonly presetId: string;
  }) => SettingsActionResult;
  readonly onSelectDefaultPromptPreset?: (value: {
    readonly kind: SettingsTaskKind;
    readonly presetId: string;
  }) => SettingsActionResult;
  readonly onUpdatePromptPreset?: (value: {
    readonly content: string;
    readonly name: string;
    readonly presetId: string;
  }) => SettingsActionResult;
  readonly onTaskPromptChange?: (value: {
    readonly kind: SettingsTaskKind;
    readonly value: string;
  }) => SettingsActionResult;
  readonly feedback?: SettingsFeedback;
  readonly taskModels?: readonly TaskModelChoice[];
  readonly connectionEditable?: boolean;
  readonly hostPermissionGranted?: boolean;
  readonly onTaskModelChange?: (value: {
    readonly kind: SettingsTaskKind;
    readonly modelId: string;
    readonly reasoningEffort: string;
  }) => SettingsActionResult;
  readonly onClose: () => void;
  readonly onSaveGroqKey: (key: string) => SettingsActionResult;
  /** 已保存 Groq 密钥的唯一明文读取路径:眼睛点击且输入框为空时按需调用。 */
  readonly onRevealGroqKey?: () => Promise<string | null>;
  readonly onSaveProviderKey: (key: string) => SettingsActionResult;
  readonly onTestProvider: () => SettingsActionResult;
  readonly onThemeChange: (theme: ThemeChoice) => SettingsActionResult;
  readonly onUiLanguageChange: (
    language: "zh-Hans" | "zh-Hant" | "en" | "ja",
  ) => SettingsActionResult;
  readonly onProviderChange: (value: {
    readonly providerId: string;
    readonly baseUrl: string;
    readonly protocol: SettingsDrawerProps["protocol"];
  }) => void;
  readonly onDiscoverModels: () => SettingsActionResult;
  readonly onModelChange: (value: {
    readonly modelId: string;
    readonly reasoningEffort: string;
  }) => SettingsActionResult;
  readonly onRetentionChange: (value: {
    readonly retention: RetentionChoice;
    readonly customDays: string;
    readonly applyTo: "existing" | "future";
  }) => SettingsActionResult;
  readonly onExportPreferenceChange: (
    value: ExportPreference,
  ) => SettingsActionResult;
  readonly onPromptTemplateChange: (value: string) => SettingsActionResult;
  readonly groqKeyProjection?: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly profiles?: readonly V12ProviderProfileOption[];
  /** 用户自定义档位清单（与模型能力档位合并展示）。 */
  readonly customReasoningEfforts?: readonly string[];
  readonly onAddCustomReasoningEffort?: (
    effort: string,
  ) => SettingsActionResult;
  readonly onRemoveCustomReasoningEffort?: (
    effort: string,
  ) => SettingsActionResult;
  readonly onMoveCustomReasoningEffort?: (
    effort: string,
    direction: "up" | "down",
  ) => SettingsActionResult;
  readonly onSetModelReasoning?: (input: {
    readonly effort: string;
    readonly enabled: boolean;
    readonly modelId: string;
    readonly profileId: string;
  }) => SettingsActionResult;
  readonly selectedProfileId?: string;
  readonly taskChoices?: readonly V12TaskChoice[];
  readonly onCreateProfile?: (input: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly name: string;
    readonly protocol?: "openai-chat" | "openai-responses" | "ollama-chat";
  }) => SettingsActionResult;
  readonly onRenameProfileModel?: (input: {
    readonly modelId: string;
    readonly nextModelId: string;
    readonly profileId: string;
  }) => SettingsActionResult;
  readonly onDeleteProfileModel?: (input: {
    readonly modelId: string;
    readonly profileId: string;
  }) => SettingsActionResult;
  readonly onAddManualProfileModel?: (input: {
    readonly modelId: string;
    readonly profileId: string;
  }) => SettingsActionResult;
  readonly onDeleteProfile?: (profileId: string) => SettingsActionResult;
  readonly onCheckProfileAvailability?: (
    profileId: string,
  ) => SettingsActionResult;
  readonly onDiscoverProfileModels?: (
    profileId: string,
  ) => SettingsActionResult;
  readonly onOpenBackupExport?: (
    input: V12BackupSelection,
  ) => SettingsActionResult;
  readonly onOpenBackupImport?: (
    input: V12BackupImportRequest,
  ) => SettingsActionResult;
  readonly backupCounts?: SettingsBackupCounts;
  readonly backupSelectedGroups?: readonly SettingsBackupCardGroup[];
  readonly lastBackupExportPath?: string | null;
  readonly onBackupGroupChange?: (input: {
    readonly group: SettingsBackupCardGroup;
    readonly selected: boolean;
  }) => void;
  readonly onCopyBackupExportPath?: () => void;
  readonly onOpenBackupExportFolder?: () => void;
  readonly onReorderProfileModel?: (input: {
    readonly modelId: string;
    readonly profileId: string;
    readonly toIndex: number;
  }) => SettingsActionResult;
  readonly onReorderProfile?: (input: {
    readonly profileId: string;
    readonly toIndex: number;
  }) => SettingsActionResult;
  readonly onRevealProviderKey?: (profileId: string) => Promise<string>;
  readonly onSetProfileModelEnabled?: (input: {
    readonly enabled: boolean;
    readonly modelId: string;
    readonly profileId: string;
  }) => SettingsActionResult;
  readonly onUpdateProfile?: (input: {
    readonly apiKey?: string;
    readonly baseUrl: string;
    readonly name?: string;
    readonly profileId: string;
    readonly protocol?: "openai-chat" | "openai-responses" | "ollama-chat";
  }) => SettingsActionResult;
}

/** 档位选择列表 = 模型能力档位 ∪ 用户自定义档位（保持顺序、去重）。 */
function reasoningOptionsFor(
  modelEfforts: readonly string[],
  customEfforts: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const effort of [...modelEfforts, ...customEfforts]) {
    if (seen.has(effort)) continue;
    seen.add(effort);
    result.push(effort);
  }
  return result;
}

function nextSection(
  current: SettingsSection,
  key: string,
): SettingsSection | null {
  const index = sections.indexOf(current);
  if (key === "Home") return sections[0];
  if (key === "End") return sections[sections.length - 1];
  if (key === "ArrowRight") return sections[(index + 1) % sections.length];
  if (key === "ArrowLeft")
    return sections[(index - 1 + sections.length) % sections.length];
  return null;
}

function findFocusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']",
    ),
  ];
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const [activeSection, setActiveSection] = useState<SettingsSection>("外观");
  const [groqKeyDraft, setGroqKeyDraft] = useState(props.groqApiKey);
  const [groqKeyVisible, setGroqKeyVisible] = useState(false);
  const [promptKind, setPromptKind] = useState<SettingsTaskKind>("chat");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const selectedModel =
    props.models.find((model) => model.id === props.modelId) ?? null;

  useEffect(() => setGroqKeyDraft(props.groqApiKey), [props.groqApiKey]);
  useEffect(() => {
    if (props.open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    } else {
      previousFocus.current?.focus();
      previousFocus.current = null;
    }
  }, [props.open]);

  if (!props.open) return null;
  if (props.profiles !== undefined && props.taskChoices !== undefined) {
    return <V12SettingsDrawerContent props={props} />;
  }

  function close(): void {
    props.onClose();
  }
  return (
    <div className="muzhi-settings-layer">
      <button
        aria-label={t(lang, "settings.closeBackdrop")}
        className="muzhi-settings-layer__backdrop"
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="muzhi-settings"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key !== "Tab" || dialogRef.current === null) return;
          const focusable = findFocusable(dialogRef.current);
          if (focusable.length === 0) return;
          const current = document.activeElement as HTMLElement | null;
          if (event.shiftKey && current === focusable[0]) {
            event.preventDefault();
            focusable[focusable.length - 1].focus();
          }
          if (!event.shiftKey && current === focusable[focusable.length - 1]) {
            event.preventDefault();
            focusable[0].focus();
          }
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id={titleId}>{t(lang, "settings.title")}</h2>
          <button
            aria-label={t(lang, "settings.close")}
            onClick={close}
            type="button"
          >
            {t(lang, "common.close")}
          </button>
        </header>
        <div
          aria-label={t(lang, "settings.categories")}
          className="muzhi-settings__tabs"
          role="tablist"
        >
          {sections.map((section) => (
            <button
              aria-controls={`settings-panel-${section}`}
              aria-selected={activeSection === section}
              id={`settings-tab-${section}`}
              key={section}
              onClick={() => setActiveSection(section)}
              onKeyDown={(event) => {
                const next = nextSection(section, event.key);
                if (!next) return;
                event.preventDefault();
                setActiveSection(next);
                document.getElementById(`settings-tab-${next}`)?.focus();
              }}
              role="tab"
              tabIndex={activeSection === section ? 0 : -1}
              type="button"
            >
              {t(lang, SECTION_KEYS[section])}
            </button>
          ))}
        </div>
        {props.feedback ? (
          <p
            className={`muzhi-settings__feedback is-${props.feedback.kind}`}
            role={props.feedback.kind === "error" ? "alert" : "status"}
          >
            {props.feedback.text}
          </p>
        ) : null}
        <section
          aria-labelledby={`settings-tab-${activeSection}`}
          className="muzhi-settings__panel"
          id={`settings-panel-${activeSection}`}
          role="tabpanel"
        >
          {activeSection === "外观" ? (
            <label>
              {t(lang, "header.theme")}
              <select
                aria-label={t(lang, "header.theme")}
                disabled={props.busy}
                onInput={(event) =>
                  props.onThemeChange(event.currentTarget.value as ThemeChoice)
                }
                value={props.theme}
              >
                <option value="system">
                  {t(lang, "header.themeFollowSystem")}
                </option>
                <option value="light">{t(lang, "header.themeLight")}</option>
                <option value="dark">{t(lang, "header.themeDark")}</option>
              </select>
            </label>
          ) : null}
          {activeSection === "任务模型" ? (
            <div className="muzhi-settings__key">
              <h3>{t(lang, "settings.defaultModel")}</h3>
              <label>
                {t(lang, "settings.model")}
                <select
                  aria-label={t(lang, "settings.model")}
                  disabled={props.busy}
                  onInput={(event) =>
                    props.onModelChange({
                      modelId: event.currentTarget.value,
                      reasoningEffort: "auto",
                    })
                  }
                  value={props.modelId}
                >
                  {props.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "settings.reasoning")}
                <select
                  aria-label={t(lang, "settings.reasoning")}
                  disabled={props.busy || selectedModel === null}
                  onInput={(event) =>
                    props.onModelChange({
                      modelId: props.modelId,
                      reasoningEffort: event.currentTarget.value,
                    })
                  }
                  value={props.reasoningEffort}
                >
                  <option value="auto">
                    {t(lang, "settings.autoReasoning")}
                  </option>
                  {selectedModel?.reasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
              {props.models.length === 0 ? (
                <p className="muzhi-settings__hint">
                  {t(lang, "settings.noModelsHint1")}
                  {t(lang, "settings.noModelsHint2")}
                </p>
              ) : (
                <p className="muzhi-settings__hint">
                  {t(lang, "settings.reasoningHint")}
                </p>
              )}
              {props.taskModels && props.onTaskModelChange ? (
                <>
                  <h3>{t(lang, "settings.taskModelsTitle")}</h3>
                  {props.taskModels.map((task) => {
                    const taskModel =
                      props.models.find((model) => model.id === task.modelId) ??
                      null;
                    return (
                      <div className="muzhi-settings__task" key={task.kind}>
                        <label>
                          {t(lang, "settings.taskModelLabel", {
                            label: task.label,
                          })}
                          <select
                            aria-label={`${t(lang, "settings.taskModelLabel", { label: task.label })}`}
                            disabled={props.busy}
                            onInput={(event) =>
                              props.onTaskModelChange?.({
                                kind: task.kind,
                                modelId: event.currentTarget.value,
                                reasoningEffort: "auto",
                              })
                            }
                            value={task.modelId}
                          >
                            <option value="">
                              {t(lang, "settings.followDefaultModel")}
                            </option>
                            {props.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t(lang, "settings.taskReasoningLabel", {
                            label: task.label,
                          })}
                          <select
                            aria-label={`${t(lang, "settings.taskReasoningLabel", { label: task.label })}`}
                            disabled={props.busy || taskModel === null}
                            onInput={(event) =>
                              props.onTaskModelChange?.({
                                kind: task.kind,
                                modelId: task.modelId,
                                reasoningEffort: event.currentTarget.value,
                              })
                            }
                            value={task.reasoningEffort}
                          >
                            <option value="auto">
                              {t(lang, "settings.autoReasoning")}
                            </option>
                            {taskModel?.reasoningEfforts.map((effort) => (
                              <option key={effort} value={effort}>
                                {effort}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    );
                  })}
                </>
              ) : null}
            </div>
          ) : null}
          {activeSection === "AI" ? (
            <div className="muzhi-settings__key">
              <h3>{t(lang, "settings.aiSectionTitle")}</h3>
              <p className="muzhi-settings__hint">
                {t(lang, "settings.aiSectionHint")}
              </p>
              <label>
                {t(lang, "settings.groqKeyLabel")}
                <span className="muzhi-settings__secret-field">
                  <input
                    aria-label={t(lang, "settings.groqKeyLabel")}
                    autoComplete="new-password"
                    disabled={props.busy}
                    onInput={(event) =>
                      setGroqKeyDraft(event.currentTarget.value)
                    }
                    type={groqKeyVisible ? "text" : "password"}
                    value={groqKeyDraft}
                  />
                  <button
                    aria-label={t(lang, "settings.secretToggleAria", {
                      action: groqKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    className="muzhi-settings__secret-toggle"
                    disabled={props.busy}
                    onClick={() =>
                      toggleGroqSecretVisibility({
                        configured: props.groqApiKeyConfigured,
                        draft: groqKeyDraft,
                        onReveal: props.onRevealGroqKey,
                        setDraft: setGroqKeyDraft,
                        setVisible: setGroqKeyVisible,
                        visible: groqKeyVisible,
                      })
                    }
                    title={t(lang, "settings.secretToggleTitle", {
                      action: groqKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    type="button"
                  >
                    <BilimuzhiIcon
                      name={groqKeyVisible ? "eye-off" : "eye"}
                      title={
                        groqKeyVisible
                          ? t(lang, "settings.secretHide")
                          : t(lang, "settings.secretShow")
                      }
                    />
                  </button>
                </span>
              </label>
              <p role="status">
                {props.groqApiKeyConfigured
                  ? t(lang, "settings.groqConfigured")
                  : t(lang, "settings.groqNotConfigured")}
              </p>
              <div className="muzhi-settings__actions">
                <button
                  disabled={props.busy}
                  onClick={() => props.onSaveGroqKey(groqKeyDraft)}
                  type="button"
                >
                  {t(lang, "settings.saveGroqKey")}
                </button>
              </div>
              <a
                className="muzhi-settings__external-link"
                href="https://console.groq.com/keys"
                rel="noreferrer"
                target="_blank"
              >
                {t(lang, "settings.groqConsole")}
              </a>
            </div>
          ) : null}
          {activeSection === "提示词" ? (
            <div className="muzhi-settings__key">
              <h3>{t(lang, "settings.promptsTitle")}</h3>
              <p>{t(lang, "settings.promptsHint1")}</p>
              <p>{t(lang, "settings.promptsHint2")}</p>
              {props.promptPresets && props.selectedPromptPresetIds ? (
                <div className="muzhi-settings__prompt-presets">
                  <label>
                    {t(lang, "settings.promptTask")}
                    <select
                      aria-label={t(lang, "settings.promptTask")}
                      disabled={props.busy}
                      onInput={(event) =>
                        setPromptKind(
                          event.currentTarget.value as SettingsTaskKind,
                        )
                      }
                      value={promptKind}
                    >
                      <option value="chat">
                        {t(lang, "settings.promptChat")}
                      </option>
                      <option value="summary">
                        {t(lang, "settings.promptSummary")}
                      </option>
                      <option value="segments">
                        {t(lang, "settings.promptSegments")}
                      </option>
                    </select>
                  </label>
                  {(() => {
                    const label =
                      promptKind === "chat"
                        ? t(lang, "settings.promptChat")
                        : promptKind === "summary"
                          ? t(lang, "settings.promptSummary")
                          : t(lang, "settings.promptSegments");
                    const options = props.promptPresets.filter(
                      (preset) => preset.kind === promptKind,
                    );
                    const selectedId =
                      props.selectedPromptPresetIds?.[promptKind] ?? "";
                    const selected = options.find(
                      (preset) => preset.id === selectedId,
                    );
                    return (
                      <>
                        <label>
                          {t(lang, "settings.promptPresetLabel", { label })}
                          <select
                            aria-label={`${t(lang, "settings.promptPresetLabel", { label })}`}
                            disabled={props.busy}
                            onInput={(event) =>
                              props.onSelectPromptPreset?.({
                                kind: promptKind,
                                presetId: event.currentTarget.value,
                              })
                            }
                            value={selectedId}
                          >
                            {options.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {displayPresetName(preset, lang)}
                                {preset.builtIn
                                  ? t(lang, "settings.builtInSuffix")
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {selected?.builtIn
                            ? t(lang, "settings.viewBuiltIn")
                            : t(lang, "settings.editPromptPreset")}
                          <textarea
                            aria-label={
                              selected?.builtIn
                                ? t(lang, "settings.viewBuiltIn")
                                : t(lang, "settings.editPromptPreset")
                            }
                            disabled={props.busy}
                            onInput={(event) =>
                              selected &&
                              !selected.builtIn &&
                              props.onUpdatePromptPreset?.({
                                content: event.currentTarget.value,
                                name: selected.name,
                                presetId: selected.id,
                              })
                            }
                            readOnly={selected?.builtIn ?? true}
                            rows={8}
                            value={selected?.content ?? ""}
                          />
                        </label>
                        <div className="muzhi-settings__prompt-actions">
                          <button
                            disabled={props.busy || !selected}
                            onClick={() =>
                              selected &&
                              props.onCopyPromptPreset?.(selected.id)
                            }
                            type="button"
                          >
                            {t(lang, "settings.copyAsNew")}
                          </button>
                          <button
                            disabled={props.busy}
                            onClick={() =>
                              props.onCreatePromptPreset?.(promptKind)
                            }
                            type="button"
                          >
                            {t(lang, "settings.newPreset")}
                          </button>
                          <button
                            disabled={props.busy || !selected}
                            onClick={() =>
                              selected &&
                              props.onSelectDefaultPromptPreset?.({
                                kind: promptKind,
                                presetId: selected.id,
                              })
                            }
                            type="button"
                          >
                            {t(lang, "settings.setDefault")}
                          </button>
                          <button
                            disabled={props.busy}
                            onClick={() =>
                              props.onRestoreBuiltInPrompt?.(promptKind)
                            }
                            type="button"
                          >
                            {t(lang, "settings.restoreBuiltIn")}
                          </button>
                          {!selected?.builtIn ? (
                            <button
                              disabled={props.busy || !selected}
                              onClick={() =>
                                selected &&
                                props.onDeletePromptPreset?.(selected.id)
                              }
                              type="button"
                            >
                              {t(lang, "settings.deletePreset")}
                            </button>
                          ) : null}
                          <button
                            onClick={() =>
                              props.onImportPromptPresets?.("text")
                            }
                            type="button"
                          >
                            {t(lang, "settings.importText")}
                          </button>
                          <button
                            onClick={() =>
                              props.onImportPromptPresets?.("json")
                            }
                            type="button"
                          >
                            {t(lang, "settings.importJson")}
                          </button>
                          <button
                            onClick={() =>
                              props.onExportPromptPresets?.("text")
                            }
                            type="button"
                          >
                            {t(lang, "settings.exportText")}
                          </button>
                          <button
                            onClick={() =>
                              props.onExportPromptPresets?.("json")
                            }
                            type="button"
                          >
                            {t(lang, "settings.exportJson")}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                TASK_PROMPT_FIELDS.map((field) => (
                  <label key={field.kind}>
                    {t(lang, field.labelKey)}
                    <textarea
                      aria-label={t(lang, field.labelKey)}
                      disabled={props.busy}
                      onInput={(event) =>
                        props.onTaskPromptChange?.({
                          kind: field.kind,
                          value: event.currentTarget.value,
                        })
                      }
                      placeholder={t(lang, field.placeholderKey)}
                      rows={6}
                      value={props.taskPrompts?.[field.kind] ?? ""}
                    />
                  </label>
                ))
              )}
            </div>
          ) : null}
          {activeSection === "缓存" ? (
            <div className="muzhi-settings__key">
              <h3>{t(lang, "settings.cacheTitle")}</h3>
              <p>{t(lang, "settings.cacheBody1")}</p>
              <p>{t(lang, "settings.cacheBody2")}</p>
            </div>
          ) : null}
          {activeSection === "关于" ? (
            <div>
              <p>Bilimuzhi</p>
              <p>{t(lang, "settings.aboutBody")}</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const PROVIDER_PROFILE_PRESETS: readonly ProviderProfilePresetInput[] =
  Object.freeze([
    {
      baseUrl: "https://api.openai.com/v1",
      name: "OpenAI",
      presetId: "openai",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://openrouter.ai/api/v1",
      name: "OpenRouter",
      presetId: "openrouter",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.deepseek.com",
      name: "DeepSeek",
      presetId: "deepseek",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      name: "Gemini",
      presetId: "gemini",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.groq.com/openai/v1",
      name: "Groq 官方",
      presetId: "groq",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.anthropic.com/v1",
      name: "Claude",
      presetId: "claude",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      name: "智谱",
      presetId: "zhipu",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api-inference.modelscope.cn/v1",
      name: "ModelScope",
      presetId: "modelscope",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.moonshot.cn/v1",
      name: "Kimi",
      presetId: "kimi",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.xiaomimimo.com/v1",
      name: "MiMo",
      presetId: "mimo",
      protocol: "openai-compatible",
    },
    {
      // Ollama：本地模型端点，无 key（OpenAI 兼容 /v1，协议 openai-chat）。
      // 预留端点类型扩展位：原生 /api/chat + think 参数作为后续增强。
      baseUrl: "http://localhost:11434/v1",
      name: "Ollama",
      presetId: "ollama",
      protocol: "openai-compatible",
    },
    {
      baseUrl: "https://api.example.com/v1",
      name: "自定义端点",
      presetId: "custom",
      protocol: "openai-compatible",
    },
  ]);

const V12_SECTIONS = [
  "外观",
  "语言",
  "语音转字幕",
  "语言模型配置",
  "备份",
] as const;
type V12Section = (typeof V12_SECTIONS)[number];

const V12_SECTION_KEYS: Record<V12Section, MessageKey> = {
  外观: "settings.appearance",
  语言: "settings.language",
  语音转字幕: "settings.speech",
  语言模型配置: "settings.models",
  备份: "settings.backup",
};
const V12_TASK_LABELS: Readonly<Record<SettingsTaskKind, MessageKey>> = {
  chat: "settings.promptChat",
  segments: "settings.promptSegments",
  summary: "settings.promptSummary",
};

const BACKUP_CARD_LABELS: Readonly<
  Record<SettingsBackupCardGroup, MessageKey>
> = Object.freeze({
  "api-keys": "settings.backupGroupApiKeys",
  "application-ai": "settings.backupGroupAppAi",
  archive: "settings.backupGroupArchive",
  prompts: "settings.backupGroupPrompts",
  trash: "settings.backupGroupTrash",
  workspace: "settings.backupGroupWorkspace",
});

const BACKUP_CARD_GROUPS: readonly SettingsBackupCardGroup[] = Object.freeze([
  "application-ai",
  "prompts",
  "workspace",
  "archive",
  "trash",
  "api-keys",
]);

function BackupCardIcon({ group }: { group: SettingsBackupCardGroup }) {
  const paths: Readonly<Record<SettingsBackupCardGroup, string>> = {
    "api-keys":
      "M8.5 10.5a3.5 3.5 0 1 1 2.8 1.4L10 13.2V15H8v2H5v-3.3l3.5-3.2Z",
    "application-ai":
      "M4 5.5h12v9H4zM7 3v2.5m6-2.5v2.5M7 14.5V17m6-2.5V17M7.5 9h.01m4.99 0h.01",
    archive: "M4 7h12v9H4zM3 4h14v3H3zm5 6h4",
    prompts: "M5 3h8l3 3v11H5zM13 3v4h4M8 10h5m-5 3h5",
    trash: "M6 6h8l-.7 11H6.7zM8 6V3h4v3M4 6h12m-7 3v5m2-5v5",
    workspace: "M3 5h6l2 2h6v9H3zM6 10h8m-8 3h6",
  };
  return (
    <svg
      aria-hidden="true"
      className="muzhi-settings__backup-card-icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d={paths[group]}
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function backupCardTitle(
  lang: UiLanguage,
  group: SettingsBackupCardGroup,
  counts: SettingsBackupCounts | undefined,
): string {
  if (group === "application-ai") {
    return t(lang, "settings.backupStatsAppAi");
  }
  if (group === "prompts") {
    return counts
      ? t(lang, "settings.backupStatsPrompts", {
          chat: counts.prompts.chat,
          summary: counts.prompts.summary,
        })
      : t(lang, "settings.backupStatsPromptsDesc");
  }
  if (group === "workspace") {
    return counts
      ? t(lang, "settings.backupStatsWorkspace", { count: counts.workspace })
      : t(lang, "settings.backupStatsWorkspaceDesc");
  }
  if (group === "archive") {
    return counts
      ? t(lang, "settings.backupStatsArchive", { count: counts.archive })
      : "已归档的项目";
  }
  if (group === "trash") {
    return counts
      ? t(lang, "settings.backupStatsTrash", { count: counts.trash })
      : "回收站中的项目";
  }
  return counts
    ? t(lang, "settings.backupStatsModels", {
        count: counts.languageModels,
      })
    : t(lang, "settings.backupStatsModelsDesc");
}

function V12SettingsDrawerContent({ props }: { props: SettingsDrawerProps }) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const profiles = props.profiles ?? [];
  const taskChoices = props.taskChoices ?? [];
  const [activeSection, setActiveSection] = useState<V12Section>("外观");
  const [selectedProfileId, setSelectedProfileId] = useState(
    props.selectedProfileId ?? profiles[0]?.id ?? "",
  );
  const [groqKeyDraft, setGroqKeyDraft] = useState("");
  const [groqKeyVisible, setGroqKeyVisible] = useState(false);
  const [manualModelDraft, setManualModelDraft] = useState("");
  const [customEffortDraft, setCustomEffortDraft] = useState("");
  const [customEffortError, setCustomEffortError] = useState("");
  const [editorProtocolDraft, setEditorProtocolDraft] = useState<
    "openai-chat" | "openai-responses"
  >("openai-chat");
  const [draggingModelId, setDraggingModelId] = useState<string | null>(null);
  const [draggingProfileId, setDraggingProfileId] = useState<string | null>(
    null,
  );
  const [profileMenuId, setProfileMenuId] = useState<string | null>(null);
  const [modelMenuId, setModelMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly profileId: string }
    | null
  >(null);
  const [editorPresetId, setEditorPresetId] = useState("openai");
  const [editorNameDraft, setEditorNameDraft] = useState("");
  const [editorBaseUrlDraft, setEditorBaseUrlDraft] = useState("");
  const [editorApiKeyDraft, setEditorApiKeyDraft] = useState("");
  const [editorApiKeyTouched, setEditorApiKeyTouched] = useState(false);
  const editorRevealTokenRef = useRef(0);
  const [editorApiKeyVisible, setEditorApiKeyVisible] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [modelEditor, setModelEditor] = useState<{
    readonly modelId: string;
    readonly profileId: string;
  } | null>(null);
  const [modelEditorDraft, setModelEditorDraft] = useState("");
  const [modelEditorError, setModelEditorError] = useState("");
  const [confirmingProfileDeletion, setConfirmingProfileDeletion] = useState<
    string | null
  >(null);
  const [confirmingModelDeletion, setConfirmingModelDeletion] = useState<{
    readonly modelId: string;
    readonly profileId: string;
  } | null>(null);
  const [backupGroups, setBackupGroups] = useState<readonly V12BackupGroup[]>([
    "application-ai",
    "prompts",
    "workspace",
    "archive",
    "trash",
  ]);
  const [backupIncludeKeys, setBackupIncludeKeys] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupFileName, setBackupFileName] = useState("");
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const selectedProfile =
    profiles.find(({ id }) => id === selectedProfileId) ?? profiles[0] ?? null;
  const selectedBackupCardGroups: readonly SettingsBackupCardGroup[] =
    props.backupSelectedGroups ?? [
      ...backupGroups,
      ...(backupIncludeKeys ? (["api-keys"] as const) : []),
    ];
  const selectedBackupGroups = selectedBackupCardGroups.filter(
    (group): group is V12BackupGroup => group !== "api-keys",
  );
  const selectedBackupIncludesKeys =
    selectedBackupCardGroups.includes("api-keys");

  useEffect(() => {
    setManualModelDraft("");
  }, [selectedProfile?.id]);

  useEffect(() => {
    if (
      selectedProfileId !== "" &&
      !profiles.some(({ id }) => id === selectedProfileId)
    ) {
      setSelectedProfileId(profiles[0]?.id ?? "");
    }
  }, [profiles, selectedProfileId]);
  function openCreateEditor(): void {
    setEditorPresetId("openai");
    setEditorNameDraft("");
    setEditorBaseUrlDraft(
      PROVIDER_PROFILE_PRESETS.find(({ presetId }) => presetId === "openai")
        ?.baseUrl ?? "",
    );
    setEditorApiKeyDraft("");
    setEditorApiKeyTouched(false);
    setEditorApiKeyVisible(false);
    setEditorProtocolDraft("openai-chat");
    setEditorError("");
    setEditor({ mode: "create" });
  }
  function openEditEditor(profileId: string): void {
    // 关闭该行已展开的三点菜单，避免菜单浮层盖住编辑窗口。
    setProfileMenuId(null);
    const profile = profiles.find(({ id }) => id === profileId);
    if (profile === undefined) return;
    const preset = PROVIDER_PROFILE_PRESETS.find(
      ({ baseUrl }) => baseUrl === profile.baseUrl,
    );
    setEditorPresetId(preset?.presetId ?? "custom");
    setEditorNameDraft(profile.name);
    setEditorBaseUrlDraft(profile.baseUrl);
    setEditorApiKeyDraft("");
    setEditorApiKeyTouched(false);
    setEditorApiKeyVisible(false);
    // 编辑时回填已保存的协议（旧值兼容：openai-compatible/openai 视为 chat）。
    setEditorProtocolDraft(
      profile.protocol === "openai-responses"
        ? "openai-responses"
        : "openai-chat",
    );
    setEditorError("");
    setEditor({ mode: "edit", profileId });
    // 编辑窗口显式回填已保存的 Key：password 掩码显示，眼睛图标可切明文查看/复制。
    // 这是完整 Key 的唯一查看路径；回填不视为用户改动，保存时未改动则保留原 Key。
    const revealToken = ++editorRevealTokenRef.current;
    const revealed = props.onRevealProviderKey?.(profileId);
    if (revealed !== undefined) {
      void Promise.resolve(revealed)
        .then((apiKey) => {
          if (editorRevealTokenRef.current !== revealToken) return;
          setEditorApiKeyDraft(apiKey);
          setEditorApiKeyTouched(false);
        })
        .catch(() => {
          // 回填失败（如密钥已删除）不阻塞编辑：Key 留空保存时保留原状态。
        });
    }
  }
  function closeEditor(): void {
    editorRevealTokenRef.current += 1;
    setEditor(null);
    setEditorError("");
    setEditorApiKeyTouched(false);
  }
  function changeEditorPreset(presetId: string): void {
    setEditorPresetId(presetId);
    const preset = PROVIDER_PROFILE_PRESETS.find(
      ({ presetId: candidate }) => candidate === presetId,
    );
    setEditorBaseUrlDraft(preset?.baseUrl ?? "");
    setEditorError("");
  }
  function validateEditor(): string {
    const name = editorNameDraft.trim();
    if (name.length === 0) return t(lang, "settings.validationNameEmpty");
    if (name.length > 30) return t(lang, "settings.validationNameTooLong");
    const duplicate = profiles.some(
      (profile) =>
        profile.id !==
          (editor?.mode === "edit" ? editor.profileId : undefined) &&
        profile.name === name,
    );
    if (duplicate) return t(lang, "settings.validationNameExists");
    const baseUrl = editorBaseUrlDraft.trim();
    if (!/^https?:\/\//.test(baseUrl)) {
      return t(lang, "settings.validationBaseUrlScheme");
    }
    try {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return t(lang, "settings.validationBaseUrlProtocol");
      }
    } catch {
      return t(lang, "settings.validationBaseUrlInvalid");
    }
    if (
      baseUrl === "https://api.example.com/v1" ||
      baseUrl === "https://api.example.com"
    ) {
      return t(lang, "settings.validationBaseUrlReal");
    }
    // 只有新建才要求 Key 必填；编辑留空视为保留已保存的 Key。
    // Ollama 预设无 key（本地端点），创建时同样豁免。
    if (
      editor?.mode !== "edit" &&
      editorApiKeyDraft.trim().length === 0 &&
      editorPresetId !== "ollama"
    ) {
      return t(lang, "settings.validationApiKeyEmpty");
    }
    return "";
  }
  function saveEditor(): void {
    const error = validateEditor();
    if (error !== "") {
      setEditorError(error);
      return;
    }
    const name = editorNameDraft.trim();
    const baseUrl = editorBaseUrlDraft.trim();
    const apiKey =
      editor?.mode === "edit"
        ? editorApiKeyTouched && editorApiKeyDraft.trim() !== ""
          ? editorApiKeyDraft.trim()
          : undefined
        : editorApiKeyDraft.trim();
    // Ollama 本地端点保持 ollama-chat 端点类型（协议下拉只含 chat/responses）。
    const effectiveProtocol =
      editorProtocolDraft === "openai-chat" &&
      baseUrl.startsWith("http://localhost:11434")
        ? "ollama-chat"
        : editorProtocolDraft;
    const result =
      editor?.mode === "edit"
        ? props.onUpdateProfile?.({
            ...(apiKey === undefined ? {} : { apiKey }),
            baseUrl,
            name,
            profileId: editor.profileId,
            protocol: effectiveProtocol,
          })
        : props.onCreateProfile?.({
            apiKey: apiKey ?? "",
            baseUrl,
            name,
            protocol: effectiveProtocol,
          });
    if (result === undefined) return;
    void Promise.resolve(result).then((saved) => {
      if (saved !== false) {
        closeEditor();
      }
    });
  }
  function openModelEditor(profileId: string, modelId: string): void {
    // 关闭该行已展开的三点菜单，避免菜单浮层盖住编辑窗口。
    setModelMenuId(null);
    setModelEditor({ modelId, profileId });
    setModelEditorDraft(modelId);
    setModelEditorError("");
  }
  function closeModelEditor(): void {
    setModelEditor(null);
    setModelEditorError("");
  }
  function saveModelEditor(): void {
    const nextModelId = modelEditorDraft.trim();
    if (nextModelId.length === 0) {
      setModelEditorError(t(lang, "settings.validationModelIdEmpty"));
      return;
    }
    if (modelEditor === null) return;
    const profile = profiles.find(({ id }) => id === modelEditor.profileId);
    if (
      nextModelId !== modelEditor.modelId &&
      profile?.models.some(({ id }) => id === nextModelId)
    ) {
      setModelEditorError(t(lang, "settings.validationModelIdExists"));
      return;
    }
    const result = props.onRenameProfileModel?.({
      modelId: modelEditor.modelId,
      nextModelId,
      profileId: modelEditor.profileId,
    });
    if (result === undefined) return;
    void Promise.resolve(result).then((saved) => {
      if (saved !== false) {
        closeModelEditor();
      }
    });
  }

  function toggleBackupGroup(group: V12BackupGroup, checked: boolean): void {
    setBackupGroups((current) =>
      checked
        ? current.includes(group)
          ? current
          : [...current, group]
        : current.filter((candidate) => candidate !== group),
    );
  }

  function toggleBackupCard(group: SettingsBackupCardGroup): void {
    const selected = !selectedBackupCardGroups.includes(group);
    props.onBackupGroupChange?.({ group, selected });
    if (props.backupSelectedGroups !== undefined) return;
    if (group === "api-keys") {
      setBackupIncludeKeys(selected);
    } else {
      toggleBackupGroup(group, selected);
    }
  }

  return (
    <div className="muzhi-settings-layer">
      <button
        aria-label={t(lang, "settings.closeBackdrop")}
        className="muzhi-settings-layer__backdrop"
        onClick={props.onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="muzhi-settings"
        role="dialog"
      >
        <header>
          <h2 id={titleId}>{t(lang, "settings.title")}</h2>
          <button
            aria-label={t(lang, "settings.close")}
            onClick={props.onClose}
            type="button"
          >
            {t(lang, "common.close")}
          </button>
        </header>
        <div
          aria-label={t(lang, "settings.categories")}
          className="muzhi-settings__tabs"
          role="tablist"
        >
          {V12_SECTIONS.map((section) => (
            <button
              aria-controls={`settings-panel-${section}`}
              aria-selected={activeSection === section}
              id={`settings-tab-${section}`}
              key={section}
              onClick={() => setActiveSection(section)}
              role="tab"
              tabIndex={activeSection === section ? 0 : -1}
              type="button"
            >
              {t(lang, V12_SECTION_KEYS[section])}
            </button>
          ))}
        </div>
        {props.feedback ? (
          <p
            className={`muzhi-settings__feedback is-${props.feedback.kind}`}
            role={props.feedback.kind === "error" ? "alert" : "status"}
          >
            {props.feedback.text}
          </p>
        ) : null}
        <section
          aria-labelledby={`settings-tab-${activeSection}`}
          className="muzhi-settings__panel"
          id={`settings-panel-${activeSection}`}
          role="tabpanel"
        >
          {activeSection === "外观" ? (
            <label>
              {t(lang, "header.theme")}
              <select
                aria-label={t(lang, "header.theme")}
                onInput={(event) =>
                  props.onThemeChange(event.currentTarget.value as ThemeChoice)
                }
                value={props.theme}
              >
                <option value="system">
                  {t(lang, "header.themeFollowSystem")}
                </option>
                <option value="light">{t(lang, "header.themeLight")}</option>
                <option value="dark">{t(lang, "header.themeDark")}</option>
              </select>
            </label>
          ) : null}

          {activeSection === "语言" ? (
            <div className="muzhi-settings__language">
              <label>
                {t(lang, "settings.uiLanguage")}
                <select
                  aria-label={t(lang, "settings.uiLanguage")}
                  onInput={(event) =>
                    props.onUiLanguageChange(
                      event.currentTarget.value as
                        "zh-Hans" | "zh-Hant" | "en" | "ja",
                    )
                  }
                  value={props.uiLanguage}
                >
                  <option value="zh-Hans">
                    {UI_LANGUAGE_META["zh-Hans"].label}
                  </option>
                  <option value="zh-Hant">
                    {UI_LANGUAGE_META["zh-Hant"].label}
                  </option>
                  <option value="en">{UI_LANGUAGE_META.en.label}</option>
                  <option value="ja">{UI_LANGUAGE_META.ja.label}</option>
                </select>
              </label>
              <p className="muzhi-settings__hint">
                {t(lang, "settings.uiLanguageHint")}
              </p>
            </div>
          ) : null}

          {activeSection === "语音转字幕" ? (
            <div className="muzhi-settings__key">
              <h3>{t(lang, "settings.groqTitle")}</h3>
              <p>
                {props.groqKeyProjection?.configured === false
                  ? t(lang, "settings.groqUnsaved")
                  : (props.groqKeyProjection?.masked ??
                    t(lang, "settings.groqUnsaved"))}
              </p>
              <label>
                {t(lang, "settings.groqKeyLabel")}
                <span className="muzhi-settings__secret-field">
                  <input
                    aria-label={t(lang, "settings.groqKeyLabel")}
                    autoComplete="new-password"
                    onInput={(event) =>
                      setGroqKeyDraft(event.currentTarget.value)
                    }
                    placeholder={
                      props.groqKeyProjection?.configured === false
                        ? t(lang, "settings.groqKeyPlaceholder")
                        : props.groqKeyProjection?.masked ||
                          t(lang, "settings.groqKeyPlaceholder")
                    }
                    type={groqKeyVisible ? "text" : "password"}
                    value={groqKeyDraft}
                  />
                  <button
                    aria-label={t(lang, "settings.secretToggleAria", {
                      action: groqKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    className="muzhi-settings__secret-toggle"
                    onClick={() =>
                      toggleGroqSecretVisibility({
                        configured:
                          props.groqKeyProjection?.configured === true,
                        draft: groqKeyDraft,
                        onReveal: props.onRevealGroqKey,
                        setDraft: setGroqKeyDraft,
                        setVisible: setGroqKeyVisible,
                        visible: groqKeyVisible,
                      })
                    }
                    title={t(lang, "settings.secretToggleTitle", {
                      action: groqKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    type="button"
                  >
                    <BilimuzhiIcon
                      name={groqKeyVisible ? "eye-off" : "eye"}
                      title={
                        groqKeyVisible
                          ? t(lang, "settings.secretHide")
                          : t(lang, "settings.secretShow")
                      }
                    />
                  </button>
                </span>
              </label>
              <button
                disabled={groqKeyDraft.trim() === ""}
                onClick={() => {
                  const result = props.onSaveGroqKey(groqKeyDraft.trim());
                  void Promise.resolve(result).then(() => setGroqKeyDraft(""));
                }}
                type="button"
              >
                {t(lang, "settings.saveGroqKey")}
              </button>
              <a
                className="muzhi-settings__external-link"
                href="https://console.groq.com/keys"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t(lang, "settings.getGroqKey")}
              </a>
            </div>
          ) : null}

          {activeSection === "语言模型配置" ? (
            <div className="muzhi-settings__profiles">
              <div className="muzhi-settings__new-profile">
                <button
                  aria-label={t(lang, "settings.newProfileAria")}
                  onClick={openCreateEditor}
                  type="button"
                >
                  {t(lang, "settings.newProfile")}
                </button>
              </div>
              <ol
                aria-label={t(lang, "settings.profileOrderAria")}
                className="muzhi-settings__profile-list"
              >
                {profiles.map((profile, index) => (
                  <li
                    className="muzhi-settings__profile-card"
                    draggable
                    key={profile.id}
                    onDragEnd={() => setDraggingProfileId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={(event) => {
                      const dataTransfer = event.dataTransfer;
                      if (dataTransfer === null) {
                        setDraggingProfileId(null);
                        return;
                      }
                      setDraggingProfileId(profile.id);
                      dataTransfer.effectAllowed = "move";
                      dataTransfer.setData("text/plain", profile.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const dataTransfer = event.dataTransfer;
                      let transferredProfileId = "";
                      if (dataTransfer !== null) {
                        transferredProfileId =
                          dataTransfer.getData("text/plain");
                      }
                      const profileId =
                        draggingProfileId ?? transferredProfileId;
                      if (profileId && profileId !== profile.id) {
                        props.onReorderProfile?.({
                          profileId,
                          toIndex: index,
                        });
                      }
                      setDraggingProfileId(null);
                    }}
                  >
                    <button
                      aria-label={t(lang, "settings.selectProfileAria", {
                        name: profile.name,
                      })}
                      className="muzhi-settings__profile-card-main"
                      onClick={() => {
                        setSelectedProfileId(profile.id);
                      }}
                      type="button"
                    >
                      <span className="muzhi-settings__profile-card-name">
                        {profile.name}
                      </span>
                      <span className="muzhi-settings__profile-card-status">
                        {profile.hostPermission === "missing"
                          ? t(lang, "settings.missingHostPermission")
                          : profile.baseUrl}
                        {profile.apiKey.configured
                          ? ` · ${profile.apiKey.masked}`
                          : t(lang, "settings.unsavedKey")}
                      </span>
                    </button>
                    <details
                      className="muzhi-settings__row-menu"
                      open={profileMenuId === profile.id}
                    >
                      <summary
                        role="button"
                        tabIndex={0}
                        aria-label={t(lang, "settings.profileMenuAria", {
                          name: profile.name,
                        })}
                        onClick={(event) => {
                          event.preventDefault();
                          setProfileMenuId((current) =>
                            current === profile.id ? null : profile.id,
                          );
                        }}
                      >
                        ⋯
                      </summary>
                      <span className="muzhi-settings__profile-order-actions">
                        <button
                          aria-label={t(lang, "settings.editProfileAria", {
                            name: profile.name,
                          })}
                          onClick={() => openEditEditor(profile.id)}
                          title={t(lang, "settings.editProfileAria", {
                            name: profile.name,
                          })}
                          type="button"
                        >
                          <BilimuzhiIcon
                            name="pencil"
                            title={t(lang, "settings.edit")}
                          />
                        </button>
                        <button
                          aria-label={t(lang, "settings.deleteProfileAria", {
                            name: profile.name,
                          })}
                          className="muzhi-settings__danger"
                          onClick={() => {
                            setProfileMenuId(null);
                            setConfirmingProfileDeletion(profile.id);
                          }}
                          title={t(lang, "settings.deleteProfileAria", {
                            name: profile.name,
                          })}
                          type="button"
                        >
                          <BilimuzhiIcon
                            name="trash"
                            title={t(lang, "settings.delete")}
                          />
                        </button>
                        <button
                          aria-label={t(lang, "settings.moveUpProfileAria", {
                            name: profile.name,
                          })}
                          disabled={index === 0}
                          onClick={() =>
                            props.onReorderProfile?.({
                              profileId: profile.id,
                              toIndex: Math.max(0, index - 1),
                            })
                          }
                          title={t(lang, "settings.moveUpProfileTitle", {
                            name: profile.name,
                          })}
                          type="button"
                        >
                          <BilimuzhiIcon
                            name="arrow-up"
                            title={t(lang, "settings.moveUp")}
                          />
                        </button>
                        <button
                          aria-label={t(lang, "settings.moveDownProfileAria", {
                            name: profile.name,
                          })}
                          disabled={index === profiles.length - 1}
                          onClick={() =>
                            props.onReorderProfile?.({
                              profileId: profile.id,
                              toIndex: Math.min(profiles.length - 1, index + 1),
                            })
                          }
                          title={t(lang, "settings.moveDownProfileTitle", {
                            name: profile.name,
                          })}
                          type="button"
                        >
                          <BilimuzhiIcon
                            name="arrow-down"
                            title={t(lang, "settings.moveDown")}
                          />
                        </button>
                      </span>
                    </details>
                  </li>
                ))}
              </ol>
              {selectedProfile !== null ? (
                <div className="muzhi-settings__profile-detail">
                  <h3>{selectedProfile.name}</h3>
                  <p className="muzhi-settings__profile-base-url">
                    {selectedProfile.baseUrl}
                  </p>
                  <p
                    className="muzhi-settings__profile-permission"
                    role="status"
                  >
                    {selectedProfile.hostPermission === "missing"
                      ? t(lang, "settings.hostPermissionMissing")
                      : t(lang, "settings.hostPermissionReady")}
                  </p>
                  <div className="muzhi-settings__probe-actions">
                    <button
                      aria-label={t(lang, "settings.detectProfile", {
                        name: selectedProfile.name,
                      })}
                      disabled={props.busy}
                      onClick={() =>
                        props.onCheckProfileAvailability?.(selectedProfile.id)
                      }
                      type="button"
                    >
                      {t(lang, "settings.detectProfile", {
                        name: selectedProfile.name,
                      })}
                    </button>
                    <button
                      aria-label={t(lang, "settings.fetchModels", {
                        name: selectedProfile.name,
                      })}
                      disabled={
                        props.busy ||
                        selectedProfile.hostPermission !== "granted" ||
                        !selectedProfile.apiKey.configured
                      }
                      onClick={() =>
                        props.onDiscoverProfileModels?.(selectedProfile.id)
                      }
                      type="button"
                    >
                      {t(lang, "settings.fetchModels", {
                        name: selectedProfile.name,
                      })}
                    </button>
                  </div>
                  <label>
                    {t(lang, "settings.manualModelId", {
                      name: selectedProfile.name,
                    })}
                    <input
                      aria-label={t(lang, "settings.manualModelId", {
                        name: selectedProfile.name,
                      })}
                      onInput={(event) =>
                        setManualModelDraft(event.currentTarget.value)
                      }
                      value={manualModelDraft}
                    />
                  </label>
                  <button
                    aria-label={t(lang, "settings.addManualModel", {
                      name: selectedProfile.name,
                    })}
                    disabled={manualModelDraft.trim() === ""}
                    onClick={() => {
                      const result = props.onAddManualProfileModel?.({
                        modelId: manualModelDraft.trim(),
                        profileId: selectedProfile.id,
                      });
                      if (result !== undefined) {
                        void Promise.resolve(result).then(() =>
                          setManualModelDraft(""),
                        );
                      }
                    }}
                    type="button"
                  >
                    {t(lang, "settings.addManualModel", {
                      name: selectedProfile.name,
                    })}
                  </button>
                  <ol
                    aria-label={t(lang, "settings.modelOrderAria", {
                      name: selectedProfile.name,
                    })}
                    className="muzhi-settings__model-list"
                  >
                    {selectedProfile.models.map((model, index) => {
                      const accessibleLabel = model.label.replace(
                        `${t(lang, "settings.unverifiedSuffix")}`,
                        "",
                      );
                      return (
                        <li
                          className="muzhi-settings__model-card"
                          draggable
                          key={model.id}
                          onDragEnd={() => setDraggingModelId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDragStart={(event) => {
                            const dataTransfer = event.dataTransfer;
                            if (dataTransfer === null) {
                              setDraggingModelId(null);
                              return;
                            }
                            setDraggingModelId(model.id);
                            dataTransfer.effectAllowed = "move";
                            dataTransfer.setData("text/plain", model.id);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const dataTransfer = event.dataTransfer;
                            let transferredModelId = "";
                            if (dataTransfer !== null) {
                              transferredModelId =
                                dataTransfer.getData("text/plain");
                            }
                            const modelId =
                              draggingModelId ?? transferredModelId;
                            if (modelId && modelId !== model.id) {
                              props.onReorderProfileModel?.({
                                modelId,
                                profileId: selectedProfile.id,
                                toIndex: index,
                              });
                            }
                            setDraggingModelId(null);
                          }}
                        >
                          <div className="muzhi-settings__model-card-head">
                            <span
                              aria-label={t(lang, "settings.dragModelAria", {
                                label: accessibleLabel,
                              })}
                              className="muzhi-settings__drag-handle"
                              title={t(lang, "settings.dragModelAria", {
                                label: accessibleLabel,
                              })}
                            >
                              <BilimuzhiIcon
                                name="grip"
                                title={t(lang, "settings.dragOrder")}
                              />
                            </span>
                            <span className="muzhi-settings__model-title">
                              <strong>{model.label}</strong>
                              <code>{model.id}</code>
                              <small
                                className={
                                  model.verification === "verified"
                                    ? "is-verified"
                                    : "is-unverified"
                                }
                              >
                                {model.verification === "verified"
                                  ? t(lang, "settings.verified")
                                  : t(lang, "settings.unverified")}
                              </small>
                            </span>
                            <details
                              className="muzhi-settings__row-menu"
                              open={modelMenuId === model.id}
                            >
                              <summary
                                role="button"
                                tabIndex={0}
                                aria-label={t(lang, "settings.modelMenuAria", {
                                  label: accessibleLabel,
                                })}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setModelMenuId((current) =>
                                    current === model.id ? null : model.id,
                                  );
                                }}
                              >
                                ⋯
                              </summary>
                              <span className="muzhi-settings__model-order-actions">
                                <button
                                  aria-label={t(
                                    lang,
                                    "settings.editModelAria",
                                    { label: accessibleLabel },
                                  )}
                                  onClick={() =>
                                    openModelEditor(
                                      selectedProfile.id,
                                      model.id,
                                    )
                                  }
                                  title={t(lang, "settings.editModelTitle", {
                                    label: accessibleLabel,
                                  })}
                                  type="button"
                                >
                                  <BilimuzhiIcon
                                    name="pencil"
                                    title={t(lang, "settings.edit")}
                                  />
                                </button>
                                <button
                                  aria-label={t(
                                    lang,
                                    "settings.deleteModelAria",
                                    { label: accessibleLabel },
                                  )}
                                  className="muzhi-settings__danger"
                                  onClick={() => {
                                    setModelMenuId(null);
                                    setConfirmingModelDeletion({
                                      modelId: model.id,
                                      profileId: selectedProfile.id,
                                    });
                                  }}
                                  title={t(lang, "settings.deleteModelTitle", {
                                    label: accessibleLabel,
                                  })}
                                  type="button"
                                >
                                  <BilimuzhiIcon
                                    name="trash"
                                    title={t(lang, "settings.delete")}
                                  />
                                </button>
                                <button
                                  aria-label={t(
                                    lang,
                                    "settings.moveUpModelAria",
                                    { label: accessibleLabel },
                                  )}
                                  disabled={index === 0}
                                  onClick={() =>
                                    props.onReorderProfileModel?.({
                                      modelId: model.id,
                                      profileId: selectedProfile.id,
                                      toIndex: Math.max(0, index - 1),
                                    })
                                  }
                                  title={t(lang, "settings.moveUpModelTitle", {
                                    label: accessibleLabel,
                                  })}
                                  type="button"
                                >
                                  <BilimuzhiIcon
                                    name="arrow-up"
                                    title={t(lang, "settings.moveUp")}
                                  />
                                </button>
                                <button
                                  aria-label={t(
                                    lang,
                                    "settings.moveDownModelAria",
                                    { label: accessibleLabel },
                                  )}
                                  disabled={
                                    index === selectedProfile.models.length - 1
                                  }
                                  onClick={() =>
                                    props.onReorderProfileModel?.({
                                      modelId: model.id,
                                      profileId: selectedProfile.id,
                                      toIndex: Math.min(
                                        selectedProfile.models.length - 1,
                                        index + 1,
                                      ),
                                    })
                                  }
                                  title={t(
                                    lang,
                                    "settings.moveDownModelTitle",
                                    { label: accessibleLabel },
                                  )}
                                  type="button"
                                >
                                  <BilimuzhiIcon
                                    name="arrow-down"
                                    title={t(lang, "settings.moveDown")}
                                  />
                                </button>
                              </span>
                            </details>
                          </div>
                          <div className="muzhi-settings__model-card-controls">
                            <label className="muzhi-settings__model-switch">
                              <input
                                aria-label={t(
                                  lang,
                                  "settings.enableModelAria",
                                  {
                                    label: accessibleLabel,
                                  },
                                )}
                                checked={model.enabled}
                                onChange={(event) =>
                                  props.onSetProfileModelEnabled?.({
                                    enabled: event.currentTarget.checked,
                                    modelId: model.id,
                                    profileId: selectedProfile.id,
                                  })
                                }
                                type="checkbox"
                              />
                              <span>
                                {t(lang, "settings.enableModelToggle")}
                              </span>
                            </label>
                            <label className="muzhi-settings__model-switch">
                              <input
                                aria-label={t(
                                  lang,
                                  "settings.reasoningToggleAria",
                                  { label: accessibleLabel },
                                )}
                                checked={
                                  model.reasoningOverride?.enabled ?? false
                                }
                                onChange={(event) => {
                                  const enabled = event.currentTarget.checked;
                                  props.onSetModelReasoning?.({
                                    effort:
                                      model.reasoningOverride?.effort ?? "auto",
                                    enabled,
                                    modelId: model.id,
                                    profileId: selectedProfile.id,
                                  });
                                }}
                                type="checkbox"
                              />
                              <span>{t(lang, "settings.reasoningToggle")}</span>
                            </label>
                            <label className="muzhi-settings__model-select">
                              <span>
                                {t(lang, "settings.reasoningEffortLabel")}
                              </span>
                              <select
                                aria-label={`${accessibleLabel} ${t(
                                  lang,
                                  "settings.reasoningEffortLabel",
                                )}`}
                                disabled={
                                  !(model.reasoningOverride?.enabled ?? false)
                                }
                                onChange={(event) => {
                                  props.onSetModelReasoning?.({
                                    effort: event.currentTarget.value,
                                    enabled: true,
                                    modelId: model.id,
                                    profileId: selectedProfile.id,
                                  });
                                }}
                                value={
                                  model.reasoningOverride?.effort ?? "auto"
                                }
                              >
                                <option value="auto">
                                  {t(lang, "settings.reasoningAuto")}
                                </option>
                                {reasoningOptionsFor(
                                  model.reasoningEfforts,
                                  props.customReasoningEfforts ?? [],
                                ).map((effort) => (
                                  <option key={effort} value={effort}>
                                    {effort}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p className="muzhi-settings__model-hint">
                              {t(lang, "settings.reasoningEffortHint")}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <section
                    aria-label={t(lang, "settings.customEffortsTitle")}
                    className="muzhi-settings__custom-efforts"
                  >
                    <h4>{t(lang, "settings.customEffortsTitle")}</h4>
                    <div className="muzhi-settings__custom-efforts-add">
                      <label>
                        <span className="visually-hidden">
                          {t(lang, "settings.customEffortsDraftAria")}
                        </span>
                        <input
                          aria-label={t(
                            lang,
                            "settings.customEffortsDraftAria",
                          )}
                          onInput={(event) => {
                            setCustomEffortDraft(event.currentTarget.value);
                            setCustomEffortError("");
                          }}
                          placeholder={t(
                            lang,
                            "settings.customEffortsPlaceholder",
                          )}
                          value={customEffortDraft}
                        />
                      </label>
                      <button
                        disabled={customEffortDraft.trim() === ""}
                        onClick={() => {
                          const effort = customEffortDraft.trim();
                          const customEfforts =
                            props.customReasoningEfforts ?? [];
                          if (
                            customEfforts.some(
                              (candidate) =>
                                candidate.toLowerCase() ===
                                effort.toLowerCase(),
                            )
                          ) {
                            setCustomEffortError(
                              t(lang, "settings.customEffortsDuplicate"),
                            );
                            return;
                          }
                          if (!isCustomReasoningEffort(effort)) {
                            setCustomEffortError(
                              t(lang, "settings.customEffortsInvalid"),
                            );
                            return;
                          }
                          const result =
                            props.onAddCustomReasoningEffort?.(effort);
                          if (result !== undefined) {
                            void Promise.resolve(result).then((saved) => {
                              if (saved !== false) {
                                setCustomEffortDraft("");
                                setCustomEffortError("");
                              }
                            });
                          }
                        }}
                        type="button"
                      >
                        {t(lang, "settings.customEffortsAdd")}
                      </button>
                    </div>
                    {customEffortError !== "" ? (
                      <p className="muzhi-settings__form-error" role="alert">
                        {customEffortError}
                      </p>
                    ) : null}
                    <ol
                      aria-label={t(lang, "settings.customEffortsListAria")}
                      className="muzhi-settings__custom-efforts-list"
                    >
                      {(props.customReasoningEfforts ?? []).map(
                        (effort, index) => (
                          <li key={effort}>
                            <code>{effort}</code>
                            <span className="muzhi-settings__profile-order-actions">
                              <button
                                aria-label={t(
                                  lang,
                                  "settings.customEffortsMoveUpAria",
                                  { effort },
                                )}
                                disabled={index === 0}
                                onClick={() =>
                                  props.onMoveCustomReasoningEffort?.(
                                    effort,
                                    "up",
                                  )
                                }
                                title={t(
                                  lang,
                                  "settings.customEffortsMoveUpAria",
                                  { effort },
                                )}
                                type="button"
                              >
                                <BilimuzhiIcon
                                  name="arrow-up"
                                  title={t(lang, "settings.moveUp")}
                                />
                              </button>
                              <button
                                aria-label={t(
                                  lang,
                                  "settings.customEffortsMoveDownAria",
                                  { effort },
                                )}
                                disabled={
                                  index ===
                                  (props.customReasoningEfforts?.length ?? 0) -
                                    1
                                }
                                onClick={() =>
                                  props.onMoveCustomReasoningEffort?.(
                                    effort,
                                    "down",
                                  )
                                }
                                title={t(
                                  lang,
                                  "settings.customEffortsMoveDownAria",
                                  { effort },
                                )}
                                type="button"
                              >
                                <BilimuzhiIcon
                                  name="arrow-down"
                                  title={t(lang, "settings.moveDown")}
                                />
                              </button>
                              <button
                                aria-label={t(
                                  lang,
                                  "settings.customEffortsDeleteAria",
                                  { effort },
                                )}
                                className="muzhi-settings__danger"
                                onClick={() =>
                                  props.onRemoveCustomReasoningEffort?.(effort)
                                }
                                title={t(
                                  lang,
                                  "settings.customEffortsDeleteAria",
                                  { effort },
                                )}
                                type="button"
                              >
                                <BilimuzhiIcon
                                  name="trash"
                                  title={t(lang, "settings.delete")}
                                />
                              </button>
                            </span>
                          </li>
                        ),
                      )}
                    </ol>
                    <p className="muzhi-settings__reasoning-hint">
                      {t(lang, "settings.customEffortsHint")}
                    </p>
                  </section>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeSection === "备份" ? (
            <div className="muzhi-settings__backup">
              <div className="muzhi-settings__backup-heading">
                <div>
                  <h3>{t(lang, "settings.backupGroups")}</h3>
                  <p>{t(lang, "settings.backupGroupsHint")}</p>
                </div>
              </div>
              <div
                aria-label={t(lang, "settings.backupGroups")}
                className="muzhi-settings__backup-cards"
              >
                {BACKUP_CARD_GROUPS.map((group) => {
                  const label = t(lang, BACKUP_CARD_LABELS[group]);
                  const selected = selectedBackupCardGroups.includes(group);
                  return (
                    <button
                      aria-label={label}
                      aria-pressed={selected}
                      className={`muzhi-settings__backup-card${
                        selected ? " is-selected" : ""
                      }`}
                      disabled={props.busy}
                      key={group}
                      onClick={() => toggleBackupCard(group)}
                      title={backupCardTitle(lang, group, props.backupCounts)}
                      type="button"
                    >
                      <BackupCardIcon group={group} />
                      <span>{label}</span>
                      <span
                        aria-hidden="true"
                        className="muzhi-settings__backup-card-state"
                      >
                        {selected
                          ? t(lang, "settings.backupSelected")
                          : t(lang, "settings.backupUnselected")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label>
                {t(lang, "settings.backupPassword")}
                <input
                  aria-label={t(lang, "settings.backupPassword")}
                  disabled={props.busy}
                  onInput={(event) =>
                    setBackupPassword(event.currentTarget.value)
                  }
                  type="password"
                  value={backupPassword}
                />
              </label>
              <button
                aria-label={t(lang, "settings.exportBackup")}
                disabled={props.busy || selectedBackupGroups.length === 0}
                onClick={() =>
                  props.onOpenBackupExport?.({
                    groups: selectedBackupGroups,
                    includeKeys: selectedBackupIncludesKeys,
                    ...(backupPassword === ""
                      ? {}
                      : { password: backupPassword }),
                  })
                }
                type="button"
              >
                {t(lang, "settings.exportBackup")}
              </button>
              <div className="muzhi-settings__backup-import-file">
                <span>{t(lang, "settings.chooseBackupFile")}</span>
                <div className="muzhi-settings__backup-file-row">
                  <button
                    disabled={props.busy}
                    onClick={() => backupFileInputRef.current?.click()}
                    type="button"
                  >
                    {t(lang, "settings.selectFile")}
                  </button>
                  <span className="muzhi-settings__backup-file-name">
                    {backupFileName === ""
                      ? t(lang, "settings.noFileSelected")
                      : backupFileName}
                  </span>
                  <input
                    accept="application/json,.json"
                    aria-label={t(lang, "settings.chooseBackupFile")}
                    disabled={props.busy}
                    hidden
                    onChange={(event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (!file || file.size > 64 * 1_024 * 1_024) {
                        setBackupFileName("");
                        input.value = "";
                        return;
                      }
                      setBackupFileName(file.name);
                      void file.text().then(
                        (json) => props.onOpenBackupImport?.({ json }),
                        () => undefined,
                      );
                      input.value = "";
                    }}
                    ref={backupFileInputRef}
                    type="file"
                  />
                </div>
              </div>
              {props.lastBackupExportPath ? (
                <div className="muzhi-settings__backup-result" role="status">
                  <p>已导出到：{props.lastBackupExportPath}</p>
                  <div>
                    <button
                      aria-label={t(lang, "settings.copyExportPath")}
                      disabled={!props.onCopyBackupExportPath}
                      onClick={props.onCopyBackupExportPath}
                      type="button"
                    >
                      {t(lang, "settings.copyExportPath")}
                    </button>
                    <button
                      aria-label={t(lang, "settings.openFolder")}
                      disabled={!props.onOpenBackupExportFolder}
                      onClick={props.onOpenBackupExportFolder}
                      type="button"
                    >
                      {t(lang, "settings.openFolder")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        {editor !== null ? (
          <div className="muzhi-settings__confirmation-layer">
            <button
              aria-label={t(lang, "settings.cancelEditProfile")}
              className="muzhi-settings__confirmation-backdrop"
              onClick={closeEditor}
              type="button"
            />
            <div
              aria-label={
                editor.mode === "create"
                  ? t(lang, "settings.newProfileTitle")
                  : t(lang, "settings.editProfileTitle")
              }
              aria-modal="true"
              className="muzhi-settings__confirmation muzhi-settings__editor"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeEditor();
                }
              }}
              role="dialog"
            >
              <h3>
                {editor.mode === "create"
                  ? t(lang, "settings.newProfileTitle")
                  : t(lang, "settings.editProfileTitle")}
              </h3>
              <label>
                Provider
                <select
                  aria-label="Provider"
                  disabled={props.busy}
                  onInput={(event) =>
                    changeEditorPreset(event.currentTarget.value)
                  }
                  value={editorPresetId}
                >
                  {PROVIDER_PROFILE_PRESETS.map((preset) => (
                    <option key={preset.presetId} value={preset.presetId}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(lang, "settings.profileName")}
                <input
                  aria-label={t(lang, "settings.profileName")}
                  autoComplete="off"
                  disabled={props.busy}
                  onInput={(event) =>
                    setEditorNameDraft(event.currentTarget.value)
                  }
                  value={editorNameDraft}
                />
              </label>
              <label>
                Base URL
                <input
                  aria-label="Base URL"
                  autoComplete="off"
                  disabled={props.busy}
                  onInput={(event) =>
                    setEditorBaseUrlDraft(event.currentTarget.value)
                  }
                  value={editorBaseUrlDraft}
                />
              </label>
              <label>
                API Key
                <span className="muzhi-settings__secret-field">
                  <input
                    aria-label="API Key"
                    autoComplete="new-password"
                    disabled={props.busy}
                    onInput={(event) => {
                      setEditorApiKeyDraft(event.currentTarget.value);
                      setEditorApiKeyTouched(true);
                    }}
                    placeholder={t(lang, "settings.inputApiKey")}
                    type={editorApiKeyVisible ? "text" : "password"}
                    value={editorApiKeyDraft}
                  />
                  <button
                    aria-label={t(lang, "settings.secretToggleAria", {
                      action: editorApiKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    className="muzhi-settings__secret-toggle"
                    disabled={props.busy}
                    onClick={() =>
                      setEditorApiKeyVisible((visible) => !visible)
                    }
                    title={t(lang, "settings.secretToggleTitle", {
                      action: editorApiKeyVisible
                        ? t(lang, "settings.secretHide")
                        : t(lang, "settings.secretShow"),
                    })}
                    type="button"
                  >
                    <BilimuzhiIcon
                      name={editorApiKeyVisible ? "eye-off" : "eye"}
                      title={
                        editorApiKeyVisible
                          ? t(lang, "settings.secretHide")
                          : t(lang, "settings.secretShow")
                      }
                    />
                  </button>
                </span>
              </label>
              <label>
                {t(lang, "settings.profileProtocol")}
                <select
                  aria-label={t(lang, "settings.profileProtocol")}
                  disabled={props.busy}
                  onInput={(event) => {
                    const protocol = event.currentTarget.value;
                    if (
                      protocol === "openai-chat" ||
                      protocol === "openai-responses"
                    ) {
                      setEditorProtocolDraft(protocol);
                    }
                  }}
                  value={editorProtocolDraft}
                >
                  <option value="openai-chat">
                    {t(lang, "settings.protocolOpenAiChat")}
                  </option>
                  <option value="openai-responses">
                    {t(lang, "settings.protocolOpenAiResponses")}
                  </option>
                </select>
              </label>
              {editorError !== "" ? <p role="alert">{editorError}</p> : null}
              <div className="muzhi-settings__confirmation-actions">
                <button onClick={closeEditor} type="button">
                  {t(lang, "common.cancel")}
                </button>
                <button
                  aria-label={t(lang, "settings.saveProfile")}
                  disabled={props.busy}
                  onClick={saveEditor}
                  type="button"
                >
                  {t(lang, "common.save")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {modelEditor !== null ? (
          <div className="muzhi-settings__confirmation-layer">
            <button
              aria-label={t(lang, "settings.cancelEditModel")}
              className="muzhi-settings__confirmation-backdrop"
              onClick={closeModelEditor}
              type="button"
            />
            <div
              aria-label={t(lang, "settings.editModelTitle2")}
              aria-modal="true"
              className="muzhi-settings__confirmation"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeModelEditor();
                }
              }}
              role="dialog"
            >
              <h3>{t(lang, "settings.editModelTitle2")}</h3>
              <label>
                {t(lang, "settings.modelId")}
                <input
                  aria-label={t(lang, "settings.modelId")}
                  autoComplete="off"
                  disabled={props.busy}
                  onInput={(event) =>
                    setModelEditorDraft(event.currentTarget.value)
                  }
                  value={modelEditorDraft}
                />
              </label>
              {modelEditorError !== "" ? (
                <p role="alert">{modelEditorError}</p>
              ) : null}
              <div className="muzhi-settings__confirmation-actions">
                <button onClick={closeModelEditor} type="button">
                  {t(lang, "common.cancel")}
                </button>
                <button
                  aria-label={t(lang, "settings.saveModelEdit")}
                  disabled={props.busy}
                  onClick={saveModelEditor}
                  type="button"
                >
                  {t(lang, "common.save")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {confirmingProfileDeletion !== null ? (
          <div className="muzhi-settings__confirmation-layer">
            <button
              aria-label={t(lang, "settings.cancelDeleteProfile")}
              className="muzhi-settings__confirmation-backdrop"
              onClick={() => setConfirmingProfileDeletion(null)}
              type="button"
            />
            <div
              aria-label={t(lang, "settings.deleteProfileTitle")}
              aria-modal="true"
              className="muzhi-settings__confirmation"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setConfirmingProfileDeletion(null);
                }
              }}
              role="alertdialog"
            >
              <h3>{t(lang, "settings.deleteProfileTitle")}</h3>
              {(() => {
                const profile = profiles.find(
                  ({ id }) => id === confirmingProfileDeletion,
                );
                if (profile === undefined) return null;
                const affected = taskChoices
                  .filter(({ profileId }) => profileId === profile.id)
                  .map(({ kind }) => t(lang, V12_TASK_LABELS[kind]));
                return (
                  <>
                    <p>
                      {t(lang, "settings.deleteProfileBody", {
                        name: profile.name,
                      })}
                    </p>
                    <p>
                      {t(lang, "settings.affectedTasks", {
                        tasks:
                          affected.length > 0
                            ? affected.join("、")
                            : t(lang, "common.none"),
                      })}
                    </p>
                  </>
                );
              })()}
              <div className="muzhi-settings__confirmation-actions">
                <button
                  autoFocus
                  onClick={() => setConfirmingProfileDeletion(null)}
                  type="button"
                >
                  {t(lang, "common.cancel")}
                </button>
                <button
                  aria-label={t(lang, "settings.confirmDeleteProfile")}
                  className="muzhi-settings__danger"
                  disabled={props.busy}
                  onClick={() => {
                    const profileId = confirmingProfileDeletion;
                    // 操作进行中保持确认层打开（按钮随 busy 禁用）；
                    // 成功后关闭，失败时重新打开确认层，卡片不提前消失。
                    const result = props.onDeleteProfile?.(profileId);
                    if (result === undefined) {
                      setConfirmingProfileDeletion(null);
                      return;
                    }
                    void Promise.resolve(result).then((saved) => {
                      if (saved !== false) {
                        setConfirmingProfileDeletion(null);
                      } else {
                        setConfirmingProfileDeletion(profileId);
                      }
                    });
                  }}
                  type="button"
                >
                  {t(lang, "settings.confirmDeleteProfile")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {confirmingModelDeletion !== null ? (
          <div className="muzhi-settings__confirmation-layer">
            <button
              aria-label={t(lang, "settings.cancelDeleteModel")}
              className="muzhi-settings__confirmation-backdrop"
              onClick={() => setConfirmingModelDeletion(null)}
              type="button"
            />
            <div
              aria-label={t(lang, "settings.deleteModelTitle2")}
              aria-modal="true"
              className="muzhi-settings__confirmation"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setConfirmingModelDeletion(null);
                }
              }}
              role="alertdialog"
            >
              <h3>{t(lang, "settings.deleteModelTitle2")}</h3>
              {(() => {
                const target = confirmingModelDeletion;
                const profile = profiles.find(
                  ({ id }) => id === target.profileId,
                );
                const model = profile?.models.find(
                  ({ id }) => id === target.modelId,
                );
                if (model === undefined) return null;
                const affected = taskChoices
                  .filter(
                    ({ profileId, modelId }) =>
                      profileId === target.profileId &&
                      modelId === target.modelId,
                  )
                  .map(({ kind }) => V12_TASK_LABELS[kind]);
                return (
                  <>
                    <p>
                      {t(lang, "settings.deleteModelBody", { id: model.id })}
                    </p>
                    <p>
                      {t(lang, "settings.affectedTasks", {
                        tasks:
                          affected.length > 0
                            ? affected.join("、")
                            : t(lang, "common.none"),
                      })}
                    </p>
                  </>
                );
              })()}
              <div className="muzhi-settings__confirmation-actions">
                <button
                  autoFocus
                  onClick={() => setConfirmingModelDeletion(null)}
                  type="button"
                >
                  {t(lang, "common.cancel")}
                </button>
                <button
                  aria-label={t(lang, "settings.confirmDeleteModel")}
                  className="muzhi-settings__danger"
                  disabled={props.busy}
                  onClick={() => {
                    const target = confirmingModelDeletion;
                    // 与配置删除一致：操作进行中保持确认层，失败时重新打开。
                    const result = props.onDeleteProfileModel?.(target);
                    if (result === undefined) {
                      setConfirmingModelDeletion(null);
                      return;
                    }
                    void Promise.resolve(result).then((saved) => {
                      if (saved !== false) {
                        setConfirmingModelDeletion(null);
                      } else {
                        setConfirmingModelDeletion(target);
                      }
                    });
                  }}
                  type="button"
                >
                  {t(lang, "settings.confirmDeleteProfile")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
