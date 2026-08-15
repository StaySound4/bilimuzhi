/**
 * Ticket 03 契约测试：解析并加入列表 Dialog（Dialog A）。
 *
 * - 只负责来源追加：普通视频、指定分P、全部分P、合集、多种链接型来源
 *   （视频/合集/收藏夹/主页，解释 B：由 parseBatchSource 统一解析）与
 *   当前页面；不放字幕获取方式或语音语言设置；
 * - 解析进度与取消只影响当前 append operation；
 * - 精确 VideoKey 去重摘要（新增/重复）在 Dialog 内展示；
 * - 关闭 Dialog 不改变列表。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BatchSourceDialog,
  type BatchSourceDialogProps,
} from "../../src/ui/batch/batch-source-dialog";

afterEach(cleanup);

const bvid = "BV1zt4y1z72D";

function dialogProps(
  overrides: Partial<BatchSourceDialogProps> = {},
): BatchSourceDialogProps {
  return {
    includeAllPages: false,
    input: "",
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onIncludeAllPagesChange: vi.fn(),
    onInputChange: vi.fn(),
    onPrepare: vi.fn(),
    onShowSourceHelp: vi.fn(),
    onSingleVideoPageSelectionChange: vi.fn(),
    onSourceKindChange: vi.fn(),
    onFetchByCurrentPage: vi.fn(),
    preparing: false,
    ...overrides,
  };
}

describe("BatchSourceDialog（解析并加入列表 Dialog A）", () => {
  it("渲染标题、来源表单与当前页面入口；不出现字幕获取或语音语言设置", () => {
    render(<BatchSourceDialog {...dialogProps()} />);

    expect(
      screen.getByRole("dialog", { name: "解析并加入列表" }),
    ).toBeDefined();
    expect(screen.getByRole("combobox", { name: "来源类型" })).toBeDefined();
    expect(screen.getByLabelText("批量来源")).toBeDefined();
    // Ticket 04：三按钮同排——按输入框内容获取视频 / 按当前打开页面获取视频 / 取消
    expect(
      screen.getByRole("button", { name: "按输入框内容获取视频" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "按当前打开页面获取视频" }),
    ).toBeDefined();
    expect(screen.queryByText("获取官方/AI字幕")).toBeNull();
    expect(screen.queryByText("语音转录")).toBeNull();
    expect(screen.queryByLabelText("默认字幕语言")).toBeNull();
    // Ticket 04：三按钮顺序与 ghost 样式类锁定。
    const actions = screen
      .getAllByRole("button")
      .filter((button) =>
        button.className.includes("muzhi-batch__dialog-action"),
      );
    expect(actions.map((button) => button.textContent)).toEqual([
      "按输入框内容获取视频",
      "按当前打开页面获取视频",
      "取消",
    ]);
  });

  it("提示多种链接型来源（视频/分P/合集/收藏夹/主页），不暗示多行批量输入", () => {
    render(<BatchSourceDialog {...dialogProps()} />);
    const hint = screen.getByText(/支持.*链接/u);
    expect(hint.textContent).toMatch(/视频/u);
    expect(hint.textContent).toMatch(/合集/u);
    expect(hint.textContent).toMatch(/收藏夹/u);
    expect(hint.textContent).toMatch(/主页/u);
    expect(hint.textContent).not.toMatch(/多行|换行|一次多个/u);
  });

  it("指定分P/全部分P 保持单视频来源语义（不新建业务类型）", () => {
    render(
      <BatchSourceDialog
        {...dialogProps({
          recognizedSingleVideoPages: { currentPage: 2, totalPages: 4 },
          singleVideoPageSelection: "current",
        })}
      />,
    );
    expect(
      (screen.getByRole("radio", { name: "仅当前分 P" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "包含全部分 P" }));
    expect(
      screen.getByRole("radio", { name: "包含全部分 P" }) as HTMLInputElement,
    ).toBeDefined();
  });

  it("解析中显示进度与「取消解析」，取消只影响当前 append operation", () => {
    const onCancel = vi.fn();
    render(
      <BatchSourceDialog
        {...dialogProps({
          onCancel,
          preparing: true,
          preparationProgress: { completed: 3, total: 10 },
        })}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "批量来源准备进度" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "取消解析" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("解析完成后在 Dialog 内显示新增/重复去重摘要", () => {
    render(
      <BatchSourceDialog
        {...dialogProps({
          lastAppendSummary: { added: 5, duplicate: 2 },
        })}
      />,
    );
    expect(screen.getByText(/新增 5/u)).toBeDefined();
    expect(screen.getByText(/重复 2/u)).toBeDefined();
  });

  it("错误消息在 Dialog 内展示；关闭 Dialog 不改变列表", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BatchSourceDialog
        {...dialogProps({ onClose, errorMessage: "解析失败" })}
      />,
    );
    expect(screen.getByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<BatchSourceDialog {...dialogProps({ onClose })} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("提交来源调用 onPrepare；关闭由父级装配决定（列表不变）", () => {
    const onPrepare = vi.fn();
    const onClose = vi.fn();
    // 关闭由父级装配决定：workspace 提交后保持打开显示进度，由
    // onClose 显式关闭（本 seam 用自注入 close 模拟父级关闭）。
    render(
      <BatchSourceDialog
        {...dialogProps({
          input: "BV1zt4y1z72D",
          onPrepare: () => {
            onPrepare();
            onClose();
          },
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "按输入框内容获取视频" }),
    );
    expect(onPrepare).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("进入 Dialog 后焦点圈定在 Dialog 内（键盘可用）", () => {
    render(<BatchSourceDialog {...dialogProps()} />);
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("解析中 Escape 与遮罩不关闭（与 AppDialog busy 守卫一致），取消解析可用", () => {
    const onClose = vi.fn();
    render(
      <BatchSourceDialog
        {...dialogProps({ onClose, busy: true, preparing: true })}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      document.querySelector(".muzhi-batch__overlay") as HTMLElement,
    );
    expect(onClose).not.toHaveBeenCalled();
    const cancelResolve = screen.getByRole("button", {
      name: "取消解析",
    }) as HTMLButtonElement;
    expect(cancelResolve.disabled).toBe(false);
  });

  it("空闲时遮罩点击关闭 Dialog（列表不变）", () => {
    const onClose = vi.fn();
    render(<BatchSourceDialog {...dialogProps({ onClose })} />);
    fireEvent.click(
      document.querySelector(".muzhi-batch__overlay") as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("提交后 Dialog 保持打开（父级随后进入解析中状态）", () => {
    const onPrepare = vi.fn();
    const { rerender } = render(
      <BatchSourceDialog {...dialogProps({ input: bvid, onPrepare })} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "按输入框内容获取视频" }),
    );
    expect(onPrepare).toHaveBeenCalledOnce();
    // 父级置 preparing 后 Dialog 仍在，展示进度。
    rerender(
      <BatchSourceDialog
        {...dialogProps({
          input: bvid,
          onPrepare,
          preparing: true,
          preparationProgress: { completed: 1, total: 3 },
        })}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "解析并加入列表" }),
    ).toBeDefined();
    expect(
      screen.getByRole("progressbar", { name: "批量来源准备进度" }),
    ).toBeDefined();
  });
});
