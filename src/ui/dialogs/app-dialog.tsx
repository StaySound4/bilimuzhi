import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import "./app-dialog.css";

export interface AppDialogOption {
  readonly label: string;
  readonly value: string;
}

export interface AppDialogRequest {
  readonly cancelLabel?: string;
  /** 缺省用「关闭」（单动作帮助模式常用）。 */
  readonly confirmLabel?: string;
  readonly danger?: boolean;
  readonly defaultValue?: string;
  readonly description?: string;
  readonly inputLabel?: string;
  readonly inputType?: "password" | "text";
  readonly multipleOptions?: boolean;
  readonly options?: readonly AppDialogOption[];
  readonly title: string;
  readonly role?: "alertdialog" | "dialog";
}

export interface AppDialogProps extends AppDialogRequest {
  readonly uiLanguage?: UiLanguage;
  readonly busy?: boolean;
  /** 纯帮助单动作模式：只渲染一个「关闭」按钮，不出现取消。 */
  readonly singleAction?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (value: string) => void;
  /** 自定义内容（如语音设置控件），渲染在默认输入之后、动作按钮之前。 */
  readonly children?: ComponentChildren;
}

let dialogDescriptionSequence = 0;

/**
 * Single in-app replacement for the browser `confirm`/`prompt` dialogs. It owns
 * focus, Escape, backdrop dismissal and a Tab cycle so a destructive action can
 * never be triggered by a browser-native affordance outside the extension UI.
 */
export function AppDialog({
  uiLanguage,
  busy = false,
  cancelLabel,
  confirmLabel,
  singleAction = false,
  danger = false,
  defaultValue,
  description,
  inputLabel,
  inputType = "text",
  multipleOptions = false,
  onCancel,
  onConfirm,
  options,
  title,
  children,
  role = "alertdialog",
}: AppDialogProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const resolvedConfirmLabel = confirmLabel ?? t(lang, "common.close");
  const [descriptionId] = useState(
    () => `muzhi-dialog-description-${++dialogDescriptionSequence}`,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const requiresValue = defaultValue !== undefined || options !== undefined;
  const [value, setValue] = useState(defaultValue ?? options?.[0]?.value ?? "");

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTarget =
      dialogRef.current?.querySelector<HTMLElement>("input, select, button") ??
      null;
    focusTarget?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  const submit = (event: JSX.TargetedSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    onConfirm(value);
  };

  return (
    <div class="muzhi-dialog-layer">
      <button
        aria-label={t(lang, "dialog.closeBackdrop")}
        class="muzhi-dialog-layer__backdrop"
        disabled={busy}
        onClick={onCancel}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title}
        aria-modal="true"
        class="muzhi-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
            return;
          }
          if (event.key !== "Tab" || dialogRef.current === null) return;
          const focusable = [
            ...dialogRef.current.querySelectorAll<HTMLElement>(
              "button:not([disabled]), input:not([disabled]), select:not([disabled])",
            ),
          ];
          if (focusable.length === 0) return;
          const current = document.activeElement as HTMLElement | null;
          if (event.shiftKey && current === focusable[0]) {
            event.preventDefault();
            focusable[focusable.length - 1].focus();
          } else if (
            !event.shiftKey &&
            current === focusable[focusable.length - 1]
          ) {
            event.preventDefault();
            focusable[0].focus();
          }
        }}
        ref={dialogRef}
        role={role}
      >
        <form onSubmit={submit}>
          <h2>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
          {options !== undefined ? (
            multipleOptions ? (
              <fieldset class="muzhi-dialog__field muzhi-dialog__options">
                <legend>{inputLabel ?? t(lang, "dialog.select")}</legend>
                {options.map((option) => {
                  const selected = value.split(",").includes(option.value);
                  return (
                    <label key={option.value}>
                      <input
                        checked={selected}
                        disabled={busy}
                        onChange={(event) => {
                          const current = value
                            .split(",")
                            .filter((item) => item.length > 0);
                          const next = event.currentTarget.checked
                            ? [...current, option.value]
                            : current.filter((item) => item !== option.value);
                          setValue([...new Set(next)].join(","));
                        }}
                        type="checkbox"
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <label class="muzhi-dialog__field">
                <span>{inputLabel ?? t(lang, "dialog.select")}</span>
                <select
                  disabled={busy}
                  onInput={(event) =>
                    setValue((event.target as HTMLSelectElement).value)
                  }
                  value={value}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : defaultValue !== undefined ? (
            <label class="muzhi-dialog__field">
              <span>{inputLabel ?? t(lang, "dialog.name")}</span>
              <input
                autoComplete={
                  inputType === "password" ? "current-password" : undefined
                }
                disabled={busy}
                maxLength={200}
                onInput={(event) =>
                  setValue((event.target as HTMLInputElement).value)
                }
                type={inputType}
                value={value}
              />
            </label>
          ) : null}
          {children}
          <div class="muzhi-dialog__actions">
            {!singleAction ? (
              <button disabled={busy} onClick={onCancel} type="button">
                {cancelLabel ?? t(lang, "common.cancel")}
              </button>
            ) : null}
            <button
              class={danger ? "muzhi-dialog__danger" : "muzhi-dialog__primary"}
              disabled={busy || (requiresValue && value.trim().length === 0)}
              type="submit"
            >
              {resolvedConfirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
