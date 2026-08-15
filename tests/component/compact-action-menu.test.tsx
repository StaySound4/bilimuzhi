import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompactActionMenu,
  type CompactActionMenuItem,
} from "../../src/ui/primitives/compact-action-menu";

afterEach(cleanup);

const ITEMS: readonly CompactActionMenuItem[] = [
  {
    accessibleName: "重命名 测试会话",
    icon: "pencil",
    kind: "item",
    label: "重命名",
    onSelect: () => undefined,
  },
  { kind: "separator" },
  {
    danger: true,
    kind: "item",
    label: "删除",
    onSelect: () => undefined,
  },
];

function renderMenu(items: readonly CompactActionMenuItem[] = ITEMS) {
  const onSelect = vi.fn();
  const wired = items.map((item) =>
    item.kind === "item" ? { ...item, onSelect } : item,
  );
  render(
    <div>
      <button type="button">前置焦点</button>
      <CompactActionMenu ariaLabel="会话操作 测试会话" items={wired} />
    </div>,
  );
  return { onSelect };
}

describe("CompactActionMenu", () => {
  it("trigger 始终在 DOM 中，icon+文字 item 均带可见文字", () => {
    renderMenu();
    const trigger = screen.getByRole("button", {
      name: "会话操作 测试会话",
    });
    expect(trigger).not.toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(menu).not.toBeNull();
    const items = screen.getAllByRole("menuitem");
    expect(
      items.map((item) => item.querySelector("span")?.textContent ?? ""),
    ).toEqual(["重命名", "删除"]);
    // accessible name 对象化
    expect(items[0].getAttribute("aria-label")).toBe("重命名 测试会话");
    // danger 项在 separator 后末位
    expect(items[1].classList.contains("is-danger")).toBe(true);
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("打开时默认焦点不落在危险项；ArrowDown/Up 循环、Home/End 定位", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "会话操作 测试会话" }));
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]); // 重命名（非危险）

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]); // 删除（危险项可聚焦但非默认）
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[1], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[1]);
  });

  it("Enter/Space 选择并回焦 trigger；Escape/Tab/outside 关闭并回焦", () => {
    const { onSelect } = renderMenu();
    const trigger = screen.getByRole("button", { name: "会话操作 测试会话" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(items[1], { key: "Enter" });
    fireEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Escape
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Tab
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // outside click
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disabled item 不可选择且仍可见", () => {
    const onSelect = vi.fn();
    render(
      <CompactActionMenu
        ariaLabel="操作"
        items={[
          {
            disabled: true,
            kind: "item",
            label: "已禁用",
            onSelect,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "操作" }));
    const item = screen.getByRole("menuitem", { name: "已禁用" });
    expect(item.hasAttribute("disabled")).toBe(true);
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("打开/关闭不改变 anchor row geometry（absolute layer 不入文档流）", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "会话操作 测试会话" });
    const row = trigger.closest("div") as HTMLElement;
    const before = row.getBoundingClientRect();
    fireEvent.click(trigger);
    const after = row.getBoundingClientRect();
    expect(after.top).toBe(before.top);
    expect(after.height).toBe(before.height);
    expect(screen.getByRole("menu")).not.toBeNull();
  });
});
