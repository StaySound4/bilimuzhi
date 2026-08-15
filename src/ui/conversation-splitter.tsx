import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import { type JSX } from "preact";

export const DEFAULT_CONVERSATION_PANE_WIDTH_PX = 220;
export const MIN_CONVERSATION_PANE_WIDTH_PX = 180;
export const MAX_CONVERSATION_PANE_WIDTH_PX = 360;
export const MIN_MAIN_WORKSPACE_WIDTH_PX = 320;
export const CONVERSATION_SPLITTER_WIDTH_PX = 12;
export const TWO_PANE_BREAKPOINT_PX = 520;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function clampConversationPaneWidth(
  preferredWidth: number,
  containerWidth: number,
): number {
  if (!finitePositive(preferredWidth) || !finitePositive(containerWidth)) {
    return DEFAULT_CONVERSATION_PANE_WIDTH_PX;
  }
  const maximumWidth = Math.max(
    MIN_CONVERSATION_PANE_WIDTH_PX,
    Math.min(
      MAX_CONVERSATION_PANE_WIDTH_PX,
      containerWidth * 0.45,
      containerWidth -
        MIN_MAIN_WORKSPACE_WIDTH_PX -
        CONVERSATION_SPLITTER_WIDTH_PX,
    ),
  );
  return Math.round(
    Math.min(
      Math.max(preferredWidth, MIN_CONVERSATION_PANE_WIDTH_PX),
      maximumWidth,
    ),
  );
}

export interface ConversationSplitterProps {
  readonly uiLanguage?: UiLanguage;
  readonly getContainerWidth: () => number;
  readonly onWidthChange: (width: number) => void;
  readonly width: number;
}

export function ConversationSplitter({
  uiLanguage,
  getContainerWidth,
  onWidthChange,
  width,
}: ConversationSplitterProps) {
  const beginDrag = (event: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || getContainerWidth() < TWO_PANE_BREAKPOINT_PX) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onPointerMove = (move: PointerEvent): void => {
      onWidthChange(
        clampConversationPaneWidth(
          startWidth + move.clientX - startX,
          getContainerWidth(),
        ),
      );
    };
    const stopDrag = (): void => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", stopDrag);
      globalThis.removeEventListener("pointercancel", stopDrag);
    };
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", stopDrag, { once: true });
    globalThis.addEventListener("pointercancel", stopDrag, { once: true });
  };

  return (
    <div
      aria-label={t(uiLanguage ?? "zh-Hans", "splitter.dragHint")}
      class="muzhi-conversation-splitter"
      onDblClick={() =>
        onWidthChange(
          clampConversationPaneWidth(
            DEFAULT_CONVERSATION_PANE_WIDTH_PX,
            getContainerWidth(),
          ),
        )
      }
      onPointerDown={beginDrag}
      role="separator"
    />
  );
}
