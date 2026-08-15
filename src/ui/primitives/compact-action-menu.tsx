/**
 * CompactActionMenu — 共享 anchored command menu primitive（Ticket 05）。
 *
 * 合同（spec D8）：
 * - trigger 在 DOM 中始终存在（视觉可降噪，不依赖 hover 创建）；
 * - item 图标辅助 + 可见文字；separator / danger / disabled；
 * - 打开不改变 anchor row geometry（absolute layer，不入文档流）；
 * - ArrowUp/Down、Home/End、Enter/Space、Escape、Tab close、outside click、return focus；
 * - viewport/drawer 顶部与底部碰撞翻转。
 *
 * Primitive 只承载 presentation/focus，不拥有业务 state。
 */
import { type JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { BilimuzhiIcon, type BilimuzhiIconName } from "../icons";
import "./compact-action-menu.css";

export type CompactActionMenuItem =
  | { readonly kind: "separator" }
  | {
      readonly accessibleName?: string;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly icon?: BilimuzhiIconName;
      readonly kind: "item";
      readonly label: string;
      readonly onSelect: () => void;
    };

export interface CompactActionMenuProps {
  readonly align?: "end" | "start";
  /** 触发按钮的 accessible name（对象化，如「会话操作 {label}」）。 */
  readonly ariaLabel: string;
  readonly items: readonly CompactActionMenuItem[];
}

const MENU_ITEM_SELECTOR = 'button[role="menuitem"]:not([disabled])';

function itemFocusables(menu: HTMLElement): readonly HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];
}

export function CompactActionMenu({
  align = "end",
  ariaLabel,
  items,
}: CompactActionMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // outside click：点击 menu 与 trigger 之外关闭并回焦 trigger。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 打开时聚焦第一个可用 item（danger 项不获得默认焦点）。
  useLayoutEffect(() => {
    if (!open || menuRef.current === null) return;
    const focusable = itemFocusables(menuRef.current);
    const first = focusable.find(
      (item) => !item.classList.contains("is-danger"),
    );
    (first ?? focusable[0])?.focus();
  }, [open]);

  // viewport 碰撞：基于真实 rect 双向约束。
  // 默认向下展开；向下溢出视口且上方空间更足时向上翻转；
  // 两方向均不足时保持向下（由滚动容器承载，不做负值 clamp 截断）。
  useLayoutEffect(() => {
    if (!open || menuRef.current === null || wrapRef.current === null) return;
    const layer = menuRef.current;
    layer.style.top = "";
    layer.style.bottom = "";
    const rect = layer.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 0 && spaceAbove > -spaceBelow) {
      layer.style.top = "auto";
      layer.style.bottom = "calc(100% + 4px)";
    }
  }, [open]);

  // Escape / Tab 关闭菜单并回焦 trigger。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const openMenu = (): void => {
    setOpen(true);
  };

  const moveFocus = (direction: 1 | -1): void => {
    const menu = menuRef.current;
    if (menu === null) return;
    const focusable = itemFocusables(menu);
    if (focusable.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const currentIndex = focusable.findIndex((item) => item === current);
    const next =
      currentIndex === -1
        ? direction === 1
          ? focusable[0]
          : focusable[focusable.length - 1]
        : focusable[
            (currentIndex + direction + focusable.length) % focusable.length
          ];
    next?.focus();
  };

  const onMenuKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const menu = menuRef.current;
      if (menu !== null) {
        itemFocusables(menu)[0]?.focus();
      }
    } else if (event.key === "End") {
      event.preventDefault();
      const menu = menuRef.current;
      if (menu !== null) {
        const focusable = itemFocusables(menu);
        focusable[focusable.length - 1]?.focus();
      }
    }
  };

  const selectItem = (item: CompactActionMenuItem): void => {
    if (item.kind !== "item" || item.disabled) return;
    close();
    item.onSelect();
  };

  return (
    <span class="muzhi-compact-menu" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        class="muzhi-compact-menu__trigger"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            if (!open) openMenu();
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <BilimuzhiIcon aria-hidden="true" name="more" />
      </button>
      {open ? (
        <div
          class={`muzhi-compact-menu__layer${
            align === "start" ? " is-align-start" : ""
          }`}
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
          ref={menuRef}
          role="menu"
        >
          {items.map((item, index) =>
            item.kind === "separator" ? (
              <div
                aria-hidden="true"
                class="muzhi-compact-menu__separator"
                key={`sep-${index}`}
                role="separator"
              />
            ) : (
              <button
                aria-disabled={item.disabled ? true : undefined}
                aria-label={item.accessibleName ?? item.label}
                class={`muzhi-compact-menu__item${
                  item.danger ? " is-danger" : ""
                }`}
                disabled={item.disabled}
                key={`${item.label}-${index}`}
                onClick={() => selectItem(item)}
                role="menuitem"
                type="button"
              >
                {item.icon !== undefined ? (
                  <BilimuzhiIcon aria-hidden="true" name={item.icon} />
                ) : null}
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </span>
  );
}
