import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { displayPresetContent, displayPresetName } from "../prompt-preset-name";
import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

import "./prompt-manager-dialog.css";

export type PromptManagerKind = "chat" | "summary";

export interface PromptManagerPreset {
  readonly builtIn: boolean;
  readonly content: string;
  readonly id: string;
  readonly name: string;
}

export type PromptManagerActionResult =
  boolean | void | Promise<boolean | void>;

export interface PromptManagerDialogProps {
  readonly uiLanguage?: UiLanguage;
  /** 该模式输出语言：内置只读预设正文随其切换（语言包内容）。 */
  readonly outputLanguage?: UiLanguage;
  readonly busy?: boolean;
  readonly defaultPresetId: string;
  readonly kind: PromptManagerKind;
  readonly onClose: () => void;
  /** Copies only the selected prompt body. Creation is a separate callback. */
  readonly onCopyPreset: (presetId: string) => PromptManagerActionResult;
  readonly onCreatePreset: (input: {
    readonly kind: PromptManagerKind;
    readonly sourcePresetId: string | null;
  }) => PromptManagerActionResult;
  readonly onDeletePreset: (presetId: string) => PromptManagerActionResult;
  readonly onReorderPreset?: (input: {
    readonly presetId: string;
    readonly toIndex: number;
  }) => PromptManagerActionResult;
  readonly onSelectPreset: (presetId: string) => PromptManagerActionResult;
  readonly onSetDefaultPreset: (presetId: string) => PromptManagerActionResult;
  readonly onUpdatePreset: (input: {
    readonly content: string;
    readonly name: string;
    readonly presetId: string;
  }) => PromptManagerActionResult;
  readonly presets: readonly PromptManagerPreset[];
  readonly selectedPresetId: string;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    ),
  ];
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="muzhi-prompt-manager__icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <rect height="8" rx="2" stroke="currentColor" width="12" x="4" y="9" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "down" | "up" }) {
  return (
    <svg
      aria-hidden="true"
      className="muzhi-prompt-manager__icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d={direction === "up" ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"}
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function PromptManagerDialog({
  uiLanguage,
  outputLanguage,
  busy = false,
  defaultPresetId,
  kind,
  onClose,
  onCopyPreset,
  onCreatePreset,
  onDeletePreset,
  onReorderPreset,
  onSelectPreset,
  onSetDefaultPreset,
  onUpdatePreset,
  presets,
  selectedPresetId,
}: PromptManagerDialogProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const label = kind === "chat" ? "对话" : "总结";
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const selected =
    presets.find(({ id }) => id === selectedPresetId) ?? presets[0] ?? null;
  const [nameDraft, setNameDraft] = useState(selected?.name ?? "");
  const [contentDraft, setContentDraft] = useState(selected?.content ?? "");
  const [choosingCreateSource, setChoosingCreateSource] = useState(false);
  const [createSourcePresetId, setCreateSourcePresetId] = useState(
    selected?.id ?? presets[0]?.id ?? "",
  );
  const [draggingPresetId, setDraggingPresetId] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setContentDraft(selected?.content ?? "");
    if (
      createSourcePresetId === "" ||
      !presets.some(({ id }) => id === createSourcePresetId)
    ) {
      setCreateSourcePresetId(selected?.id ?? presets[0]?.id ?? "");
    }
  }, [
    createSourcePresetId,
    presets,
    selected?.content,
    selected?.id,
    selected?.name,
  ]);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.querySelector<HTMLElement>("button, select")?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  const customChanged =
    selected !== null &&
    !selected.builtIn &&
    (nameDraft.trim() !== selected.name || contentDraft !== selected.content);

  const create = async (sourcePresetId: string | null): Promise<void> => {
    const result = await onCreatePreset({ kind, sourcePresetId });
    if (result !== false) setChoosingCreateSource(false);
  };

  const reorder = (presetId: string, toIndex: number): void => {
    if (toIndex < 0 || toIndex >= presets.length) return;
    onReorderPreset?.({ presetId, toIndex });
  };

  const dropPreset = (
    event: JSX.TargetedDragEvent<HTMLLIElement>,
    toIndex: number,
  ): void => {
    event.preventDefault();
    if (draggingPresetId === null) return;
    reorder(draggingPresetId, toIndex);
    setDraggingPresetId(null);
  };

  return (
    <div className="muzhi-prompt-manager-layer">
      <button
        aria-label={t(lang, "prompts.closeBackdrop")}
        className="muzhi-prompt-manager-layer__backdrop"
        disabled={busy}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="muzhi-prompt-manager"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (choosingCreateSource) setChoosingCreateSource(false);
            else if (!busy) onClose();
            return;
          }
          if (event.key !== "Tab" || dialogRef.current === null) return;
          const focusable = focusableElements(dialogRef.current);
          if (focusable.length === 0) return;
          const active = document.activeElement;
          if (event.shiftKey && active === focusable[0]) {
            event.preventDefault();
            focusable[focusable.length - 1]?.focus();
          } else if (!event.shiftKey && active === focusable.at(-1)) {
            event.preventDefault();
            focusable[0]?.focus();
          }
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header className="muzhi-prompt-manager__header">
          <div>
            <p>{t(lang, "prompts.workspaceEyebrow")}</p>
            <h2 id={titleId}>{t(lang, "prompts.manageTitle", { label })}</h2>
          </div>
          <button
            aria-label={t(lang, "prompts.closeManageAria", { label })}
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </header>

        <p className="muzhi-prompt-manager__description">
          {t(lang, "prompts.description")}
        </p>

        <label className="muzhi-prompt-manager__field">
          <span>{t(lang, "prompts.presetFieldLabel", { label })}</span>
          <select
            aria-label={t(lang, "prompts.presetFieldLabel", { label })}
            disabled={busy || presets.length === 0}
            onInput={(event) => onSelectPreset(event.currentTarget.value)}
            value={selected?.id ?? ""}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {displayPresetName(preset, lang)}
                {preset.builtIn ? t(lang, "prompts.builtinSuffix") : ""}
              </option>
            ))}
          </select>
        </label>

        <ul
          aria-label={t(lang, "prompts.orderAria", { label })}
          className="muzhi-prompt-manager__order"
        >
          {presets.map((preset, index) => (
            <li
              className={
                preset.id === selected?.id
                  ? "muzhi-prompt-manager__order-item is-selected"
                  : "muzhi-prompt-manager__order-item"
              }
              draggable={!busy}
              key={preset.id}
              onDragEnd={() => setDraggingPresetId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setDraggingPresetId(preset.id)}
              onDrop={(event) => dropPreset(event, index)}
            >
              <span aria-hidden="true" className="muzhi-prompt-manager__drag">
                ⠿
              </span>
              <button
                aria-current={preset.id === selected?.id ? "true" : undefined}
                className="muzhi-prompt-manager__order-name"
                disabled={busy}
                onClick={() => onSelectPreset(preset.id)}
                type="button"
              >
                {preset.builtIn ? <LockIcon /> : null}
                <span>{displayPresetName(preset, lang)}</span>
              </button>
              <button
                aria-label={t(lang, "prompts.moveUp", {
                  name: displayPresetName(preset, lang),
                })}
                className="muzhi-prompt-manager__icon-button"
                disabled={busy || index === 0 || onReorderPreset === undefined}
                onClick={() => reorder(preset.id, index - 1)}
                title={t(lang, "prompts.moveUp", {
                  name: displayPresetName(preset, lang),
                })}
                type="button"
              >
                <ArrowIcon direction="up" />
              </button>
              <button
                aria-label={t(lang, "prompts.moveDown", {
                  name: displayPresetName(preset, lang),
                })}
                className="muzhi-prompt-manager__icon-button"
                disabled={
                  busy ||
                  index === presets.length - 1 ||
                  onReorderPreset === undefined
                }
                onClick={() => reorder(preset.id, index + 1)}
                title={t(lang, "prompts.moveDown", {
                  name: displayPresetName(preset, lang),
                })}
                type="button"
              >
                <ArrowIcon direction="down" />
              </button>
            </li>
          ))}
        </ul>

        {selected?.builtIn ? (
          <div className="muzhi-prompt-manager__locked-editor">
            <p
              aria-label={t(lang, "prompts.lockedAria")}
              className="muzhi-prompt-manager__lock-note"
              role="img"
              title={t(lang, "prompts.lockedTitle")}
            >
              <LockIcon />
              {t(lang, "prompts.lockedTitle")}
            </p>
            <label className="muzhi-prompt-manager__field">
              <span>{t(lang, "prompts.viewBuiltin")}</span>
              <textarea
                aria-label={t(lang, "prompts.viewBuiltin")}
                readOnly
                rows={10}
                value={displayPresetContent(selected, lang, outputLanguage)}
              />
            </label>
          </div>
        ) : selected ? (
          <div className="muzhi-prompt-manager__editor">
            <label className="muzhi-prompt-manager__field">
              <span>{t(lang, "prompts.presetName")}</span>
              <input
                aria-label="预设名称"
                disabled={busy}
                maxLength={128}
                onInput={(event) => setNameDraft(event.currentTarget.value)}
                value={nameDraft}
              />
            </label>
            <label className="muzhi-prompt-manager__field">
              <span>{t(lang, "prompts.editPreset")}</span>
              <textarea
                aria-label="编辑提示词预设"
                disabled={busy}
                onInput={(event) => setContentDraft(event.currentTarget.value)}
                rows={9}
                value={contentDraft}
              />
            </label>
            <button
              className="muzhi-prompt-manager__primary"
              disabled={busy || !customChanged || nameDraft.trim() === ""}
              onClick={() =>
                onUpdatePreset({
                  content: contentDraft,
                  name: nameDraft.trim(),
                  presetId: selected.id,
                })
              }
              type="button"
            >
              保存修改
            </button>
          </div>
        ) : (
          <p role="status">{t(lang, "prompts.noPresets")}</p>
        )}

        <div className="muzhi-prompt-manager__actions">
          <button
            disabled={busy || selected === null}
            onClick={() => selected && onCopyPreset(selected.id)}
            type="button"
          >
            {t(lang, "prompts.copyToClipboard")}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setCreateSourcePresetId(selected?.id ?? presets[0]?.id ?? "");
              setChoosingCreateSource(true);
            }}
            type="button"
          >
            {t(lang, "prompts.createPrompt")}
          </button>
          <button
            disabled={busy || selected === null}
            onClick={() => selected && onSetDefaultPreset(selected.id)}
            type="button"
          >
            {t(lang, "prompts.setDefault")}
          </button>
          {selected && !selected.builtIn ? (
            <button
              className="muzhi-prompt-manager__danger"
              disabled={busy}
              onClick={() => onDeletePreset(selected.id)}
              type="button"
            >
              {t(lang, "prompts.deletePreset")}
            </button>
          ) : null}
        </div>
        {selected?.id === defaultPresetId ? (
          <p className="muzhi-prompt-manager__default" role="status">
            {t(lang, "prompts.isDefault", { label })}
          </p>
        ) : null}

        {choosingCreateSource ? (
          <div className="muzhi-prompt-manager__create-layer">
            <button
              aria-label={t(lang, "prompts.cancelChooseSource")}
              className="muzhi-prompt-manager__create-backdrop"
              disabled={busy}
              onClick={() => setChoosingCreateSource(false)}
              tabIndex={-1}
              type="button"
            />
            <div
              aria-label={t(lang, "prompts.chooseSourceAria")}
              aria-modal="true"
              className="muzhi-prompt-manager__create-dialog"
              role="dialog"
            >
              <h3>{t(lang, "prompts.chooseSourceAria")}</h3>
              <p>{t(lang, "prompts.chooseSourceHint")}</p>
              <button
                className="muzhi-prompt-manager__primary"
                disabled={busy}
                onClick={() => void create(null)}
                type="button"
              >
                {t(lang, "prompts.newBlank")}
              </button>
              <label className="muzhi-prompt-manager__field">
                <span>{t(lang, "prompts.copySource")}</span>
                <select
                  aria-label={t(lang, "prompts.copySource")}
                  disabled={busy || presets.length === 0}
                  onInput={(event) =>
                    setCreateSourcePresetId(event.currentTarget.value)
                  }
                  value={createSourcePresetId}
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {displayPresetName(preset, lang)}
                      {preset.builtIn ? t(lang, "prompts.builtinSuffix") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="muzhi-prompt-manager__create-actions">
                <button
                  disabled={busy || createSourcePresetId === ""}
                  onClick={() => void create(createSourcePresetId)}
                  type="button"
                >
                  复制于现有预设
                </button>
                <button
                  disabled={busy}
                  onClick={() => setChoosingCreateSource(false)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
