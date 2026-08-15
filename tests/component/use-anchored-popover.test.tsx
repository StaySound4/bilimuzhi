import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useAnchoredPopover,
  type AnchoredPopoverState,
} from "../../src/ui/primitives/use-anchored-popover";

afterEach(cleanup);

function PopoverFixture() {
  const state = useAnchoredPopover();
  return (
    <div>
      <button
        aria-expanded={state.open}
        aria-haspopup="dialog"
        onClick={state.toggle}
        ref={state.triggerRef}
        type="button"
      >
        导出
      </button>
      {state.open ? (
        <div ref={state.ref} role="dialog">
          <label>
            时间戳
            <input type="checkbox" />
          </label>
          <button type="button">确定</button>
        </div>
      ) : null}
    </div>
  );
}

describe("useAnchoredPopover", () => {
  it("打开后渲染 non-modal dialog（不含 aria-modal），可 light dismiss 并回焦", () => {
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "导出" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // light dismiss：点击 dialog 内部不关闭，点击外部关闭
    fireEvent.pointerDown(screen.getByRole("button", { name: "确定" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape 关闭并回焦 trigger；toggle 再开再关", () => {
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "导出" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("打开/关闭不改变 anchor row geometry（layer 不入文档流）", () => {
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "导出" });
    const row = trigger.parentElement as HTMLElement;
    const before = row.getBoundingClientRect();
    fireEvent.click(trigger);
    const after = row.getBoundingClientRect();
    expect(after.top).toBe(before.top);
    expect(after.height).toBe(before.height);
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("close() 可由外部调用（如表单提交后）并回焦", () => {
    let externalState: AnchoredPopoverState | null = null;
    function CaptureFixture() {
      const state = useAnchoredPopover();
      externalState = state;
      return (
        <div>
          <button
            aria-expanded={state.open}
            onClick={state.toggle}
            ref={state.triggerRef}
            type="button"
          >
            打开
          </button>
          {state.open ? (
            <div ref={state.ref} role="dialog">
              <button onClick={state.close} type="button">
                完成
              </button>
            </div>
          ) : null}
        </div>
      );
    }
    const onSelect = vi.fn();
    render(<CaptureFixture />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开" }),
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(externalState).not.toBeNull();
  });
});
