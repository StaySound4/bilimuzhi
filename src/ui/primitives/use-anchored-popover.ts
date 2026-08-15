/**
 * useAnchoredPopover — 共享 non-modal anchored layer helper（Ticket 05）。
 *
 * 合同（spec D8/D9）：
 * - absolute layer 不入文档流，打开不改变 anchor row geometry；
 * - non-modal：调用方不写 aria-modal=true；背景可操作时语义一致；
 * - light dismiss（outside click）、Escape、return focus；
 * - 顶部/底部 viewport 碰撞翻转由 CSS container 承载。
 *
 * Primitive 只承载 presentation/focus，不拥有业务 state。
 */
import { useEffect, useRef, useState } from "preact/hooks";

export interface AnchoredPopoverState {
  readonly close: () => void;
  readonly open: boolean;
  readonly ref: { current: HTMLDivElement | null };
  readonly toggle: () => void;
  readonly triggerRef: { current: HTMLButtonElement | null };
}

/**
 * 返回 anchored popover 状态与 refs。调用方渲染：
 *   <button ref={state.triggerRef} aria-expanded={state.open} onClick={state.toggle}>…
 *   {state.open ? <div ref={state.ref} role="dialog">…</div> : null}
 */
export function useAnchoredPopover(): AnchoredPopoverState {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (ref.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return {
    close,
    open,
    ref,
    toggle: () => setOpen((value) => !value),
    triggerRef,
  };
}
