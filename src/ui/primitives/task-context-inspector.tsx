import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";

export interface TaskContextInspectorProps {
  readonly children: ComponentChildren;
  readonly configureLabel: string;
  readonly summary: string;
  readonly status?: string;
}

export function TaskContextInspector({
  children,
  configureLabel,
  summary,
  status,
}: TaskContextInspectorProps) {
  const [open, setOpen] = useState(false);
  const inspectorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  return (
    <div
      class="muzhi-task-context"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") close();
      }}
    >
      <div class="muzhi-task-context__strip">
        <span class="muzhi-task-context__summary" title={summary}>
          {summary}
          {status ? (
            <span class="muzhi-task-context__status" role="status">
              {` · ${status}`}
            </span>
          ) : null}
        </span>
        <button
          aria-controls={inspectorId}
          aria-expanded={open}
          class="muzhi-task-context__trigger"
          onClick={() => setOpen((value) => !value)}
          ref={triggerRef}
          type="button"
        >
          {configureLabel}
        </button>
      </div>
      {open ? (
        <div class="muzhi-task-context__inspector" id={inspectorId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
