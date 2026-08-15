/**
 * Ticket 05 组件契约：调整列 Dialog（草稿、原子应用、恢复默认、键盘）。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultBatchColumnLayoutV2,
  type BatchColumnLayoutV2,
} from "../../src/ui/batch/batch-column-layout-v2";
import {
  BatchColumnSettingsDialog,
  type BatchColumnSettingsDialogProps,
} from "../../src/ui/batch/batch-column-settings-dialog";

afterEach(cleanup);

function dialogProps(
  overrides: Partial<BatchColumnSettingsDialogProps> = {},
): BatchColumnSettingsDialogProps {
  return {
    layout: defaultBatchColumnLayoutV2(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("BatchColumnSettingsDialog（调整列）", () => {
  it("默认顺序渲染：序号、标题、字幕状态、操作、作者、发布日期、视频身份", () => {
    render(<BatchColumnSettingsDialog {...dialogProps()} />);
    const rows = document.querySelectorAll(".muzhi-batch__column-order-item");
    expect(
      Array.from(rows, (row) => row.textContent?.replace("⠿", "").trim()),
    ).toEqual([
      "序号固定↑↓",
      "标题显示↑↓",
      "字幕状态固定↑↓",
      "操作固定↑↓",
      "作者显示↑↓",
      "发布日期显示↑↓",
      "视频身份显示↑↓",
    ]);
    // 序号行：上移/下移禁用；不可隐藏（无显示/隐藏复选框）。
    const indexRow = rows[0] as HTMLElement;
    expect(
      (
        within(indexRow).getByRole("button", {
          name: "上移 序号",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(indexRow).getByRole("button", {
          name: "下移 序号",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(within(indexRow).queryByRole("checkbox")).toBeNull();
    // 状态/操作行：无隐藏复选框。
    const statusRow = rows[2] as HTMLElement;
    expect(within(statusRow).queryByRole("checkbox")).toBeNull();
  });

  it("上移/下移改草稿顺序，应用才原子提交", () => {
    const onApply = vi.fn();
    render(<BatchColumnSettingsDialog {...dialogProps({ onApply })} />);
    fireEvent.click(screen.getByRole("button", { name: "下移 标题" }));
    expect(onApply).not.toHaveBeenCalled();
    const rows = document.querySelectorAll(".muzhi-batch__column-order-item");
    expect(rows[1]?.textContent).toContain("字幕状态");
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]?.[0] as BatchColumnLayoutV2;
    expect(applied.order[1]).toBe("status");
    expect(applied.order[2]).toBe("title");
  });

  it("取消丢弃草稿；恢复默认一次恢复顺序/可见性/宽度/全文本", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const layout = defaultBatchColumnLayoutV2();
    const hiddenTitle = {
      ...layout,
      visible: { ...layout.visible, title: false },
      order: [...layout.order],
      forceFullText: true,
    };
    const { rerender } = render(
      <BatchColumnSettingsDialog
        {...dialogProps({ layout: hiddenTitle, onApply, onCancel })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "上移 字幕状态" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();

    rerender(
      <BatchColumnSettingsDialog
        {...dialogProps({ layout: hiddenTitle, onApply, onCancel })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    const titleCheckbox = screen.getByRole("checkbox", {
      name: "显示/隐藏 标题",
    }) as HTMLInputElement;
    expect(titleCheckbox.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    const applied = onApply.mock.calls[0]?.[0] as BatchColumnLayoutV2;
    expect(applied).toEqual(defaultBatchColumnLayoutV2());
  });

  it("可见性切换只作用于可隐藏列；隐藏后应用生效", () => {
    const onApply = vi.fn();
    render(<BatchColumnSettingsDialog {...dialogProps({ onApply })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "显示/隐藏 作者" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    const applied = onApply.mock.calls[0]?.[0] as BatchColumnLayoutV2;
    expect(applied.visible.author).toBe(false);
  });

  it("拖拽排序：拖动标题到身份行后顺序更新", () => {
    render(<BatchColumnSettingsDialog {...dialogProps()} />);
    const rows = document.querySelectorAll(".muzhi-batch__column-order-item");
    const titleRow = rows[1] as HTMLElement;
    const identityRow = rows[6] as HTMLElement;
    fireEvent.dragStart(titleRow);
    fireEvent.drop(identityRow);
    fireEvent.dragEnd(titleRow);
    const after = document.querySelectorAll(".muzhi-batch__column-order-item");
    expect(after[6]?.textContent).toContain("标题");
  });

  it("Escape 取消；遮罩点击取消", () => {
    const onCancel = vi.fn();
    render(<BatchColumnSettingsDialog {...dialogProps({ onCancel })} />);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "调整列" }), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(
      document.querySelector(".muzhi-batch__overlay") as HTMLElement,
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
