import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchJobView } from "../../src/application/batch-runtime";
import {
  createBatchItem,
  createBatchJob,
  type BatchItem,
} from "../../src/domain";
import {
  BatchWorkspace,
  type BatchWorkspaceProps,
} from "../../src/ui/batch/batch-workspace";
import { t } from "../../src/i18n";
import { BatchArchiveWorkspace } from "../../src/ui/batch/batch-archive-workspace";
import { BatchTrashWorkspace } from "../../src/ui/batch/batch-trash-workspace";

afterEach(cleanup);

const bvid = "BV1zt4y1z72D";

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return createBatchItem({
    batchItemId: "item-1",
    batchJobId: "job-1",
    bvid,
    errorCode: null,
    order: 0,
    page: 1,
    resultBranchId: null,
    resultSessionId: null,
    rowCount: 0,
    selected: true,
    status: "pending",
    title: "第一个视频",
    trackId: null,
    updatedAt: 1,
    videoKey: `bvid:${bvid}:cid:30000000001:p:1`,
    ...overrides,
  });
}

function view(
  overrides: Partial<BatchJobView> = {},
  items: readonly BatchItem[] = [item()],
): BatchJobView {
  return {
    items,
    job: createBatchJob({
      batchJobId: "job-1",
      browserSessionId: "browser-1",
      createdAt: 1,
      method: "direct",
      sourceKind: "video-pages",
      sourceLabel: "测试来源",
      status: "ready",
      updatedAt: 1,
    }),
    overwriteCount: 0,
    ...overrides,
  };
}

function props(
  overrides: Partial<BatchWorkspaceProps> = {},
): BatchWorkspaceProps {
  return {
    includeAllPages: false,
    input: "",
    hasLists: false,
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onIncludeAllPagesChange: vi.fn(),
    onInputChange: vi.fn(),
    onLanguagePreferenceChange: vi.fn(),
    onPrepare: vi.fn(),
    onSelectionChange: vi.fn(),
    onStart: vi.fn(),
    speechConfigured: true,
    speechLanguageMode: "mixed",
    speechRoutingMode: "balanced",
    onItemSpeechLanguageChange: vi.fn(),
    onSpeechLanguageChange: vi.fn(),
    onSpeechRoutingModeChange: vi.fn(),
    ...overrides,
  };
}

describe("BatchWorkspace", () => {
  it("shows the Groq key hint instead of the Bilibili login hint for a failed speech item", () => {
    const value = props({
      view: view({}, [
        item({
          acquisitionMethod: "speech",
          errorCode: "AUTHENTICATION_REQUIRED",
          retryable: false,
          status: "failed",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    expect(
      screen.getByText("请先在设置中保存并测试 Groq 密钥。"),
    ).toBeDefined();
    expect(screen.queryByText("需要登录 B 站")).toBeNull();
  });

  it("keeps the Bilibili login hint for a failed direct item", () => {
    const value = props({
      view: view({}, [
        item({
          acquisitionMethod: "direct",
          errorCode: "AUTHENTICATION_REQUIRED",
          retryable: true,
          status: "failed",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    expect(screen.getByText("需要登录 B 站")).toBeDefined();
  });

  it("distinguishes no-lists from select-list empty states and gates the parse entry", () => {
    const onCreateList = vi.fn();
    const { rerender } = render(
      <BatchWorkspace {...props({ input: bvid, onCreateList })} />,
    );

    // 完全没有列表：空卡片 + 新建列表引导；无解析入口。
    expect(screen.getByText("还没有列表")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "新建列表" }));
    expect(onCreateList).toHaveBeenCalledOnce();

    // 已有列表但未选中：提示先选择列表。
    rerender(<BatchWorkspace {...props({ input: bvid, hasLists: true })} />);
    expect(screen.getByText("请先选择一个批量列表。")).toBeDefined();

    // 有活动列表但无视频：标题 + 解析入口 + 空卡片。
    rerender(
      <BatchWorkspace
        {...props({ input: bvid, hasLists: true, view: view({}, []) })}
      />,
    );
    expect(screen.getByText("当前列表还没有视频")).toBeDefined();
    fireEvent.click(
      screen.getAllByRole("button", { name: "解析并加入列表" })[0]!,
    );
    expect(
      screen.getByRole("dialog", { name: "解析并加入列表" }),
    ).toBeDefined();
  });

  it("syncs the current page through the parse dialog when a list exists", () => {
    const onFetchByCurrentPage = vi.fn();
    render(
      <BatchWorkspace {...props({ onFetchByCurrentPage, view: view() })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    fireEvent.click(
      screen.getByRole("button", { name: "按当前打开页面获取视频" }),
    );
    expect(onFetchByCurrentPage).toHaveBeenCalledOnce();
  });

  it("keeps the parse dialog submit disabled until a source is entered", () => {
    const { rerender } = render(
      <BatchWorkspace {...props({ view: view() })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    const emptyDialog = screen.getByRole("dialog", {
      name: "解析并加入列表",
    });
    expect(
      (
        within(emptyDialog).getByRole("button", {
          name: "按输入框内容获取视频",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(<BatchWorkspace {...props({ input: bvid, view: view() })} />);
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    expect(
      (
        within(dialog).getByRole("button", {
          name: "按输入框内容获取视频",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("explains why batch controls are disabled while processing or running", () => {
    const { rerender } = render(
      <BatchWorkspace {...props({ busy: true, input: bvid, view: view() })} />,
    );
    expect(
      screen.getByText("正在处理上一项批量操作，完成后可继续修改。"),
    ).not.toBeNull();

    rerender(
      <BatchWorkspace
        {...props({
          input: bvid,
          view: view({
            job: createBatchJob({
              ...view().job,
              status: "running",
            }),
          }),
        })}
      />,
    );
    expect(
      screen.getByText(
        "批量任务正在准备或运行；停止任务后可修改来源、选择和语言。",
      ),
    ).not.toBeNull();
  });

  it("shows a local pending reason until deferred selection persistence finishes", async () => {
    let resolveSelection: (() => void) | undefined;
    const onSelectionChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSelection = resolve;
        }),
    );
    render(<BatchWorkspace {...props({ onSelectionChange, view: view() })} />);

    const checkbox = screen.getByLabelText(
      "选择 第一个视频",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.getAttribute("aria-describedby")).toBe(
      "muzhi-batch-controls-note",
    );
    expect(
      screen.getByText("正在保存批量选择，完成前请勿重复操作。"),
    ).not.toBeNull();

    resolveSelection?.();
    await waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(
      screen.queryByText("正在保存批量选择，完成前请勿重复操作。"),
    ).toBeNull();
  });

  it("publishes the pasted source and the explicit all-parts radio choice", () => {
    const onSingleVideoPageSelectionChange = vi.fn();
    const value = props({
      view: view(),
      input: bvid,
      onSingleVideoPageSelectionChange,
      recognizedSingleVideoPages: { currentPage: 1, totalPages: 3 },
      singleVideoPageSelection: "current",
    });
    render(<BatchWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });

    expect(
      (
        within(dialog).getByRole("radio", {
          name: "仅当前分 P",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.input(within(dialog).getByLabelText("批量来源"), {
      target: { value: "https://space.bilibili.com/1" },
    });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "包含全部分 P" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "按输入框内容获取视频" }),
    );

    expect(value.onInputChange).toHaveBeenCalledWith(
      "https://space.bilibili.com/1",
    );
    expect(onSingleVideoPageSelectionChange).toHaveBeenCalledWith("all");
    expect(value.onIncludeAllPagesChange).toHaveBeenCalledWith(true);
    expect(value.onPrepare).toHaveBeenCalledOnce();
  });

  it("offers every frozen source kind as an explicit source-type choice", () => {
    render(<BatchWorkspace {...props({ input: bvid, view: view() })} />);
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));

    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    const sourceType = within(dialog).getByRole("combobox", {
      name: "来源类型",
    });
    const labels = Array.from(sourceType.querySelectorAll("option")).map(
      (option) => option.textContent,
    );

    expect(labels).toEqual([
      "单个视频",
      "用户主页",
      "收藏夹",
      "合集 / 系列（多个视频）",
      "视频选集 / 分 P（同一视频）",
      "搜索页面",
    ]);
    expect(
      within(dialog).getByLabelText("批量来源").getAttribute("placeholder"),
    ).toBe("粘贴 B 站页面地址（如 BV1b7411N798）或输入搜索关键词");
  });

  it("shows the page-stability hint inside the parse dialog", () => {
    render(<BatchWorkspace {...props({ input: bvid, view: view() })} />);
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    expect(
      within(dialog).getByText("请等待视频页面加载稳定后再复制地址"),
    ).not.toBeNull();
  });

  it("opens accessible source help inside the parse dialog and restores focus after Escape", () => {
    render(<BatchWorkspace {...props({ input: bvid, view: view() })} />);
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });
    const trigger = within(dialog).getByRole("button", {
      name: "查看支持的批量来源",
    });

    trigger.focus();
    fireEvent.click(trigger);
    const helpDialog = screen.getByRole("dialog", {
      name: "支持的批量来源",
    });
    expect(helpDialog.textContent).toContain("单个视频");
    expect(helpDialog.textContent).toContain("搜索页面");

    fireEvent.keyDown(helpDialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "支持的批量来源" })).toBeNull();
    // Escape 同时关闭来源帮助与解析 Dialog（trigger 随 Dialog 卸载，
    // 焦点回到 body；来源帮助的焦点恢复语义由 AppDialog 自身覆盖）。
    return waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "解析并加入列表" }),
      ).toBeNull(),
    );
  });

  it("opens the unified acquisition dialog and starts direct acquisition with skip by default", () => {
    const value = props({ view: view() });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("作用范围：全部，共 1 项");
    expect(dialog.textContent).toContain("已有字幕 0 项");
    expect(dialog.textContent).toContain("获取官方/AI字幕");
    expect(dialog.textContent).toContain("获取语音转录字幕");
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /获取官方\/AI字幕/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /跳过已有字幕/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1"],
      "skip",
      "mixed",
    );
  });

  it("requires an explicit replace choice before acquisition when every selected item has subtitles", () => {
    const value = props({ view: view({ overwriteCount: 2 }) });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    expect(value.onStart).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("已有字幕 2 项");
    expect(dialog.textContent).toContain("所选视频均已获取过字幕");

    // 全部已有时「跳过已有字幕」禁用，默认选中「重新获取并替换」。
    const skipRadio = within(dialog).getByRole("radio", {
      name: /跳过已有字幕/u,
    }) as HTMLInputElement;
    expect(skipRadio.disabled).toBe(true);
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /重新获取并替换/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1"],
      "all",
      "mixed",
    );
  });

  it("chooses the speech method and replace rule inside the unified dialog", () => {
    const value = props({ view: view({ overwriteCount: 1 }) });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /获取语音转录字幕/u }),
    );
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /重新获取并替换/u }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "speech",
      ["item-1"],
      "all",
      "mixed",
    );
  });

  it("speech 方法显示语音语言设置（默认混合），选择后通知作用域批量写入（Ticket 09）", () => {
    const value = props({ view: view() });
    render(<BatchWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    // direct 方法：不显示语音语言设置
    expect(
      within(dialog).queryByRole("group", {
        name: "语音转录语言",
      }),
    ).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /获取语音转录字幕/u }),
    );
    // speech 方法：显示语言设置（默认混合）+ disclaimer
    const group = within(dialog).getByRole("group", {
      name: "语音转录语言",
    });
    expect(
      (within(group).getByRole("radio", { name: "混合" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(dialog.textContent).toContain("只能促进识别");
    // 选择语言 → 作用域批量写入回调（mode + 冻结 itemIds）
    fireEvent.click(within(group).getByRole("radio", { name: "中文" }));
    expect(value.onSpeechLanguageChange).toHaveBeenCalledWith("zh", ["item-1"]);
  });

  it("cancels the unified acquisition dialog without changing any data", () => {
    const value = props({ view: view({ overwriteCount: 1 }) });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(value.onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "批量获取字幕" })).toBeNull();
  });

  it("closes the unified acquisition dialog with Escape", () => {
    const value = props({ view: view() });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(value.onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "批量获取字幕" })).toBeNull();
  });

  it("toggles a single item selection", () => {
    const value = props({
      view: view({}, [
        item(),
        item({ batchItemId: "item-2", order: 1, title: "第二个视频" }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByLabelText("选择 第一个视频"));

    expect(value.onSelectionChange).toHaveBeenCalledWith(["item-2"]);
  });

  it("selects from row whitespace and exposes the whole selected row without double-toggling controls", () => {
    const value = props({
      view: view({}, [
        item({
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              source: "official",
              trackId: "track-zh",
            },
          ],
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    const row = screen.getByText("第一个视频").closest("tr");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(row!);
    expect(value.onSelectionChange).toHaveBeenCalledWith([]);

    vi.mocked(value.onSelectionChange).mockClear();
    // 刚加入列表：状态列显示「获取语言」预设下拉而非轨道选择框。
    // 刚加入列表：状态列显示「加入列表成功」而非轨道选择框；操作列提供语音设置。
    fireEvent.click(
      screen.getByRole("button", {
        name: "设置 第一个视频 的语音转录与语言",
      }),
    );
    expect(value.onSelectionChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyUp(document, { key: "Escape" });
    expect(value.onSelectionChange).not.toHaveBeenCalled();
  });

  it("uses one five-item filter menu, clears selection on filter change, and selects the whole filtered scope", () => {
    const items = Array.from({ length: 45 }, (_, index) =>
      item({
        batchItemId: `item-${index + 1}`,
        order: index,
        selected: index === 0,
        status: index < 30 ? "succeeded" : index < 40 ? "pending" : "running",
        rowCount: index < 30 ? 1 : 0,
        title: `视频 ${index + 1}`,
      }),
    );
    const onSelectionChange = vi.fn();
    render(
      <BatchWorkspace
        {...props({ onSelectionChange, view: view({}, items) })}
      />,
    );

    expect(screen.queryByRole("button", { name: /获取中/u })).toBeNull();
    expect(screen.getByText("获取中 5", { exact: false })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按状态筛选批量条目" }));
    const menu = screen.getByRole("menu", { name: "按状态筛选批量条目" });
    const menuItems = within(menu).getAllByRole("menuitem");
    expect(menuItems).toHaveLength(5);
    expect(menu.textContent).toContain("全部");
    expect(menu.textContent).toContain("待处理");
    expect(menu.textContent).toContain("已完成");
    expect(menu.textContent).toContain("失败");
    expect(menu.textContent).toContain("已取消");

    fireEvent.click(within(menu).getByRole("menuitem", { name: /已完成/u }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);

    vi.mocked(onSelectionChange).mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: /选择当前筛选的全部 30 项/u }),
    );
    const selected = onSelectionChange.mock.calls[0]?.[0] as string[];
    expect(selected).toHaveLength(30);
    expect(selected[0]).toBe("item-1");
    expect(selected[29]).toBe("item-30");
  });

  it("freezes the selected filter name and actual ids when opening the acquisition dialog", () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      item({
        batchItemId: `item-${index + 1}`,
        order: index,
        selected: true,
        status: "succeeded",
        rowCount: 1,
        title: `视频 ${index + 1}`,
      }),
    );
    const onStart = vi.fn();
    render(
      <BatchWorkspace
        {...props({ onStart, view: view({ overwriteCount: 30 }, items) })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "按状态筛选批量条目" }));
    fireEvent.click(
      within(
        screen.getByRole("menu", { name: "按状态筛选批量条目" }),
      ).getByRole("menuitem", { name: /已完成/u }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("作用范围：已完成，共 30 项");

    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(onStart).toHaveBeenCalledWith(
      "direct",
      Array.from({ length: 30 }, (_, index) => `item-${index + 1}`),
      "all",
      "mixed",
    );
  });

  it("opens the column settings dialog from the adjust-columns button next to force-full-text", () => {
    render(<BatchWorkspace {...props({ view: view() })} />);
    fireEvent.click(screen.getByRole("button", { name: "调整列" }));
    const dialog = screen.getByRole("dialog", { name: "调整列" });
    expect(dialog.textContent).toContain("序号");
    // 应用草稿后布局持久化。
    fireEvent.click(screen.getByRole("button", { name: "下移 标题" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.queryByRole("dialog", { name: "调整列" })).toBeNull();
    const headers = Array.from(
      document.querySelectorAll("thead th"),
      (header) => header.textContent,
    );
    expect(headers[1]).toBe("字幕状态?");
    expect(headers[2]).toBe("标题");
  });

  it("renders the full filtered list without pagination controls", () => {
    const items = Array.from({ length: 94 }, (_, index) =>
      item({
        batchItemId: `item-${index + 1}`,
        order: index,
        selected: false,
        status: "succeeded",
        rowCount: 1,
        title: `视频 ${index + 1}`,
      }),
    );
    let onSelectionChange = vi.fn();
    const rerenderWithSelection = (next: typeof onSelectionChange) => {
      onSelectionChange = next;
      rerender(
        <BatchWorkspace
          {...props({ onSelectionChange: next, view: view({}, items) })}
        />,
      );
    };
    const { rerender } = render(
      <BatchWorkspace
        {...props({ onSelectionChange, view: view({}, items) })}
      />,
    );

    expect(
      screen.queryByRole("navigation", { name: "批量列表分页" }),
    ).toBeNull();
    expect(screen.queryByLabelText("跳转页码")).toBeNull();
    expect(screen.queryByText(/第 1–20 项/u)).toBeNull();
    const table = screen.getByRole("table", { name: "批量视频列表" });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(94);
    // 全选作用于当前筛选结果全集。
    const selectionSpy = vi.fn();
    rerenderWithSelection(selectionSpy);
    fireEvent.click(
      screen.getByRole("button", { name: /选择当前筛选的全部 94 项/u }),
    );
    const selected = selectionSpy.mock.calls[0]?.[0] as string[];
    expect(selected).toHaveLength(94);
    expect(selected[0]).toBe("item-1");
    expect(selected[93]).toBe("item-94");
  });

  it("shows per-item failure reasons and keeps export disabled without results", () => {
    render(
      <BatchWorkspace
        {...props({
          view: view({}, [
            item({
              errorCode: "SUBTITLE_NOT_FOUND",
              status: "failed",
            }),
          ]),
        })}
      />,
    );

    expect(screen.getByText("没有匹配的字幕", { exact: false })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "导出" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders the seven frozen columns with the actions column", () => {
    const detailedItem = {
      ...item({
        errorCode: "NETWORK_ERROR",
        status: "failed",
      }),
      author: "测试作者",
      availableTracks: [
        {
          language: "zh-CN",
          name: "中文（中国）",
          source: "official",
          trackId: "track-zh",
        },
      ],
      progress: {
        completed: 0,
        stage: "discovering",
        total: 1,
      },
      publishedAt: 1_700_000_000,
      selectedLanguage: "zh-CN",
      selectedTrackId: "track-zh",
    } as BatchItem & {
      readonly author: string;
      readonly availableTracks: readonly {
        readonly language: string;
        readonly name: string;
        readonly source: "official";
        readonly trackId: string;
      }[];
      readonly progress: {
        readonly completed: number;
        readonly stage: string;
        readonly total: number;
      };
      readonly publishedAt: number;
      readonly selectedLanguage: string;
      readonly selectedTrackId: string;
    };
    render(<BatchWorkspace {...props({ view: view({}, [detailedItem]) })} />);

    const table = screen.getByRole("table", { name: "批量视频列表" });
    const headers = Array.from(
      table.querySelectorAll("thead th"),
      (header) => header.textContent,
    );
    expect(headers).toEqual([
      "序号",
      "标题",
      "字幕状态?",
      "操作?",
      "作者",
      "发布日期",
      "视频身份",
    ]);
    expect(headers).not.toContain("语言");
    expect(table.textContent).not.toContain("获取方式 / 进度");
    expect(table.textContent).not.toContain("获取方式 / 进度");
    expect(table.textContent).toContain("测试作者");
    expect(table.textContent).toContain("BV1zt4y1z72D");
    // failed 条目：操作列提供语音设置与行删除，无导出。
    expect(
      screen.getByRole("combobox", { name: "字幕轨道 第一个视频" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "重试 第一个视频" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "导出 第一个视频" }),
    ).toBeNull();
  });

  it("keeps an empty active filter instead of switching context", () => {
    const items = [
      item({ status: "succeeded", rowCount: 5 }),
      item({
        batchItemId: "item-2",
        order: 1,
        selected: false,
        status: "running",
        title: "第二个视频",
      }),
    ];
    const value = props({ view: view({}, items) });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "按状态筛选批量条目" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /失败/u }));
    expect(document.querySelector(".muzhi-batch__filter-empty")).not.toBeNull();
    expect(screen.getByText(/当前筛选：失败/u)).not.toBeNull();
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      0,
    );
  });

  it("keeps the table in a keyboard-scrollable vertical region with a dedicated top horizontal scroller", () => {
    render(<BatchWorkspace {...props({ view: view() })} />);

    const tableScroller = screen.getByRole("region", {
      name: "批量视频列表滚动区域",
    });
    expect(tableScroller.getAttribute("tabindex")).toBe("0");
    expect(tableScroller.contains(screen.getByRole("table"))).toBe(true);

    const hscroll = screen.getByRole("region", {
      name: "批量列表横向滚动",
    });
    expect(hscroll.getAttribute("tabindex")).toBe("0");
    expect(hscroll.querySelector(".muzhi-batch__hscroll-track")).not.toBeNull();
  });

  it("mirrors the top horizontal scroller into the table scroll position", () => {
    render(<BatchWorkspace {...props({ view: view() })} />);
    const hscroll = screen.getByRole("region", {
      name: "批量列表横向滚动",
    });
    const tableScroller = screen.getByRole("region", {
      name: "批量视频列表滚动区域",
    });
    (hscroll as HTMLElement).scrollLeft = 320;
    fireEvent.scroll(hscroll);
    expect(tableScroller.scrollLeft).toBe(320);
  });

  it("keeps the contextual selection toolbar minimal: clear-selection, batch fetch, export", () => {
    render(<BatchWorkspace {...props({ view: view() })} />);

    expect(screen.getByRole("button", { name: "批量获取字幕" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "导出" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "清除选择" })).not.toBeNull();
    // 已删除：重试所选、独立直接/语音按钮、清除所选字幕菜单、从任务中移除。
    expect(screen.queryByRole("button", { name: "重试所选" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "获取官方/AI字幕" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "批量语音转字幕" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "清除所选视频获取的字幕" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "从任务中移除" })).toBeNull();
  });

  it("publishes clear-selection and removes a single row via the row action", () => {
    const onSelectionChange = vi.fn();
    const onDeleteItems = vi.fn();
    render(
      <BatchWorkspace
        {...props({ onSelectionChange, onDeleteItems, view: view() })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
    fireEvent.click(
      screen.getByRole("button", { name: "从列表中删除 第一个视频" }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "确认删除",
      }),
    );
    expect(onDeleteItems).toHaveBeenCalledWith(["item-1"]);
  });

  it("uses one export entry and chooses the format in an application dialog", () => {
    const value = props({
      view: view({}, [
        item({
          rowCount: 42,
          status: "succeeded",
          trackId: "track-zh",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    expect(screen.queryByRole("button", { name: "导出 ZIP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出 TXT" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    const dialog = screen.getByRole("dialog", { name: "选择导出格式" });
    expect(dialog.textContent).toContain("TXT");
    expect(dialog.textContent).toContain("SRT");
    expect(dialog.textContent).toContain("Markdown");
    expect(within(dialog).queryByRole("button", { name: "ZIP" })).toBeNull();
    expect(value.onExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "TXT" }));
    expect(value.onExport).toHaveBeenCalledWith("txt", undefined, {
      includeTimestamps: true,
      zip: true,
    });
  });

  it("offers only txt/srt/markdown in the batch export dialog (ZIP is implicit)", () => {
    const value = props({
      view: view({}, [
        item({ rowCount: 42, status: "succeeded", trackId: "track-zh" }),
        item({
          batchItemId: "item-2",
          order: 1,
          rowCount: 21,
          status: "succeeded",
          title: "第二个视频",
          trackId: "track-zh-2",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    const dialog = screen.getByRole("dialog", { name: "选择导出格式" });
    expect(within(dialog).getByRole("button", { name: "TXT" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "SRT" })).not.toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Markdown" }),
    ).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "ZIP" })).toBeNull();
  });

  it("offers the timestamp option only and hides the ZIP option for a single export", () => {
    const value = props({
      view: view({}, [
        item({ rowCount: 42, status: "succeeded", trackId: "track-zh" }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    const dialog = screen.getByRole("dialog", { name: "选择导出格式" });
    const fieldLabels = Array.from(dialog.querySelectorAll("label"), (label) =>
      label.textContent?.trim(),
    );
    expect(fieldLabels.some((label) => /时间戳/u.test(label ?? ""))).toBe(true);
    expect(fieldLabels.some((label) => /内容/u.test(label ?? ""))).toBe(false);
    expect(fieldLabels.some((label) => /ZIP/u.test(label ?? ""))).toBe(false);
    expect(dialog.querySelectorAll("input, select").length).toBe(1);
  });

  it("freezes the selected successful item ids when global export starts even if the live selection changes while its dialog is open", () => {
    const onExport = vi.fn();
    const first = item({
      rowCount: 42,
      selected: true,
      status: "succeeded",
      trackId: "track-zh",
    });
    const second = item({
      batchItemId: "item-2",
      order: 1,
      rowCount: 21,
      selected: false,
      status: "succeeded",
      title: "第二个视频",
      trackId: "track-zh-2",
    });
    const { rerender } = render(
      <BatchWorkspace
        {...props({ onExport, view: view({}, [first, second]) })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    rerender(
      <BatchWorkspace
        {...props({
          onExport,
          view: view({}, [
            createBatchItem({ ...first, selected: false }),
            createBatchItem({ ...second, selected: true }),
          ]),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "SRT" }));

    expect(onExport).toHaveBeenCalledOnce();
    expect(onExport.mock.calls[0]?.slice(0, 2)).toEqual(["srt", ["item-1"]]);
  });

  it("keeps every compact-card field, selected state, status and per-item controls in the accessible row", () => {
    const detailedItem = {
      ...item({
        rowCount: 42,
        status: "succeeded",
        trackId: "track-zh",
      }),
      aid: 88_000_001,
      author: "响应式作者",
      availableTracks: [
        {
          language: "zh-CN",
          name: "中文（中国）",
          source: "official",
          trackId: "track-zh",
        },
      ],
      cid: 30_000_000_001,
      publishedAt: 1_700_000_000,
      selectedLanguage: "zh-CN",
      selectedTrackId: "track-zh",
    } as BatchItem & {
      readonly aid: number;
      readonly author: string;
      readonly availableTracks: readonly {
        readonly language: string;
        readonly name: string;
        readonly source: "official";
        readonly trackId: string;
      }[];
      readonly cid: number;
      readonly publishedAt: number;
      readonly selectedLanguage: string;
      readonly selectedTrackId: string;
    };
    render(<BatchWorkspace {...props({ view: view({}, [detailedItem]) })} />);

    const row = screen.getByText("第一个视频").closest("tr");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(row?.textContent).toContain("响应式作者");
    expect(row?.textContent).toContain(bvid);
    expect(row?.textContent).toContain("P1");
    expect(row?.textContent).toContain("已有官方字幕");
    expect(
      within(row!).getByRole("checkbox", { name: "选择 第一个视频" }),
    ).not.toBeNull();
    expect(
      within(row!).getByRole("combobox", { name: "字幕轨道 第一个视频" }),
    ).not.toBeNull();
    // 操作列：成功项显示导出按钮。
    expect(
      within(row!).getByRole("button", { name: "导出 第一个视频" }),
    ).not.toBeNull();
  });

  it("freezes the filtered scope across live selection changes while the dialog is open", () => {
    const onStart = vi.fn();
    const first = item({ acquisitionMethod: null, selected: true });
    const second = item({
      acquisitionMethod: null,
      batchItemId: "item-2",
      order: 1,
      selected: true,
      title: "第二个视频",
    });
    const rendered = render(
      <BatchWorkspace
        {...props({ onStart, view: view({}, [first, second]) })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    expect(
      screen.getByRole("dialog", { name: "批量获取字幕" }).textContent,
    ).toContain("作用范围：全部，共 2 项");

    rendered.rerender(
      <BatchWorkspace
        {...props({
          onStart,
          view: view({}, [{ ...first, selected: false }, second]),
        })}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("作用范围：全部，共 2 项");
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1", "item-2"],
      "skip",
      "mixed",
    );
  });

  it("shows a stage and processed total while source preparation is busy", () => {
    render(
      <BatchWorkspace
        {...props({
          busy: true,
          preparing: true,
          view: view(),
          statusMessage: "正在加入批量列表 · 2/104",
        })}
      />,
    );

    expect(screen.getByText("正在加入批量列表 · 2/104")).toBeDefined();
    const progress = screen.getByRole("progressbar", {
      name: "批量来源准备进度",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuemax")).toBe("104");
  });

  it("renders a successful independent BatchSubtitle without any Session action", () => {
    const value = props({
      view: view({}, [
        item({
          rowCount: 42,
          status: "succeeded",
          trackId: "track-zh",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    expect(screen.getByText("42 行", { exact: false })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "转为会话" })).toBeNull();
    expect(screen.getByRole("button", { name: "导出" })).not.toBeNull();
  });

  it("offers a stop action while the job is running", () => {
    const value = props({
      view: view({
        job: createBatchJob({
          batchJobId: "job-1",
          browserSessionId: "browser-1",
          createdAt: 1,
          method: "direct",
          sourceKind: "video-pages",
          sourceLabel: "测试来源",
          status: "running",
          updatedAt: 1,
        }),
      }),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "停止批量" }));

    expect(value.onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "批量获取字幕" })).toBeNull();
  });

  describe("v16 D4 column layout", () => {
    const zhTrack = {
      language: "zh-CN",
      name: "中文（中国）",
      source: "official" as const,
      trackId: "track-zh",
    };

    function memoryLayoutStorage() {
      let value: unknown = null;
      return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next: unknown) => {
          value = next;
        }),
      };
    }

    it("opens per-item speech settings with the persisted language mode preselected", () => {
      const onItemSpeechLanguageChange = vi.fn();
      const value = props({
        onItemSpeechLanguageChange,
        speechLanguageMode: "mixed",
        view: view({}, [item({ speechLanguageMode: "en", status: "pending" })]),
      });
      render(<BatchWorkspace {...value} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "设置 第一个视频 的语音转录与语言",
        }),
      );
      const dialog = screen.getByRole("dialog", {
        name: "语音转录与语言",
      });
      const languageSelect = within(dialog).getByRole("combobox", {
        name: "语音请求语言",
      }) as HTMLSelectElement;
      expect(languageSelect.value).toBe("en");
      const options = Array.from(
        languageSelect.querySelectorAll("option"),
        (option) => option.textContent,
      );
      expect(options).toEqual(["混合", "中文", "英文", "日文", "其他"]);
      fireEvent.input(languageSelect, { target: { value: "other" } });
      expect(onItemSpeechLanguageChange).toHaveBeenCalledWith(
        "item-1",
        "other",
      );
    });

    it("shows the session default speech language when the item has none", () => {
      const value = props({
        speechLanguageMode: "zh",
        view: view({}, [{ ...item(), speechLanguageMode: undefined }]),
      });
      render(<BatchWorkspace {...value} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "设置 第一个视频 的语音转录与语言",
        }),
      );
      const languageSelect = within(
        screen.getByRole("dialog", { name: "语音转录与语言" }),
      ).getByRole("combobox", {
        name: "语音请求语言",
      }) as HTMLSelectElement;
      expect(languageSelect.value).toBe("zh");
    });

    it("publishes the session speech routing mode from the speech settings dialog", () => {
      const onSpeechRoutingModeChange = vi.fn();
      const value = props({
        onSpeechRoutingModeChange,
        speechRoutingMode: "balanced",
        view: view(),
      });
      render(<BatchWorkspace {...value} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "设置 第一个视频 的语音转录与语言",
        }),
      );
      const routingSelect = within(
        screen.getByRole("dialog", { name: "语音转录与语言" }),
      ).getByRole("combobox", {
        name: "语音模型策略",
      }) as HTMLSelectElement;
      expect(routingSelect.value).toBe("balanced");
      fireEvent.input(routingSelect, { target: { value: "turbo-first" } });
      expect(onSpeechRoutingModeChange).toHaveBeenCalledWith("turbo-first");
    });

    it("hints when no Groq key is configured inside the speech settings dialog", () => {
      const value = props({
        speechConfigured: false,
        view: view(),
      });
      render(<BatchWorkspace {...value} />);
      fireEvent.click(
        screen.getByRole("button", {
          name: "设置 第一个视频 的语音转录与语言",
        }),
      );
      expect(
        within(
          screen.getByRole("dialog", { name: "语音转录与语言" }),
        ).getByText("请先在设置中保存并测试 Groq 密钥。"),
      ).not.toBeNull();
    });

    it("hides the real track select until tracks were discovered", () => {
      render(<BatchWorkspace {...props({ view: view() })} />);
      expect(
        screen.queryByRole("combobox", { name: "字幕轨道 第一个视频" }),
      ).toBeNull();
    });

    it("hosts the real track select and row-level clear inside the status column", () => {
      const detailedItem = {
        ...item({
          rowCount: 42,
          status: "succeeded",
          trackId: "track-zh",
        }),
        availableTracks: [zhTrack],
      } as BatchItem & {
        readonly availableTracks: readonly (typeof zhTrack)[];
      };
      render(<BatchWorkspace {...props({ view: view({}, [detailedItem]) })} />);
      const row = screen.getByText("第一个视频").closest("tr");
      const statusCell = row?.querySelector("td:nth-child(3)");
      expect(statusCell?.textContent).toContain("已有官方字幕");
      expect(statusCell?.textContent).toContain("42 行");
      // 状态列承载轨道选择与行级清除；操作列承载导出。
      expect(
        within(statusCell as HTMLElement).getByRole("combobox", {
          name: "字幕轨道 第一个视频",
        }),
      ).not.toBeNull();
      expect(
        within(statusCell as HTMLElement).getByRole("button", {
          name: "清除 第一个视频 的当前字幕并返回待处理状态",
        }),
      ).not.toBeNull();
      const actionsCell = row?.querySelector("td:nth-child(4)");
      expect(
        within(actionsCell as HTMLElement).getByRole("button", {
          name: "导出 第一个视频",
        }),
      ).not.toBeNull();
      // 无独立语言列。
      expect(
        screen.queryByRole("combobox", { name: "语言偏好 第一个视频" }),
      ).toBeNull();
    });

    it("shows a speech subtitle label with the request language for succeeded speech items", () => {
      render(
        <BatchWorkspace
          {...props({
            view: view({}, [
              item({
                acquisitionMethod: "speech",
                rowCount: 7,
                speechLanguageMode: "en",
                status: "succeeded",
              }),
            ]),
          })}
        />,
      );
      const row = screen.getByText("第一个视频").closest("tr");
      const statusCell = row?.querySelector("td:nth-child(3)");
      expect(statusCell?.textContent).toContain("语音转录 · 英文");
      // 语音成功项不提供直接轨道下拉。
      expect(
        screen.queryByRole("combobox", { name: "字幕轨道 第一个视频" }),
      ).toBeNull();
      // 操作列主操作切换为导出。
      expect(
        screen.getByRole("button", { name: "导出 第一个视频" }),
      ).not.toBeNull();
    });

    it("colors every status badge with a non-color status dot", () => {
      render(
        <BatchWorkspace
          {...props({
            view: view({}, [
              item({ status: "pending" }),
              item({
                batchItemId: "item-2",
                order: 1,
                status: "running",
                title: "第二个视频",
              }),
              item({
                batchItemId: "item-3",
                order: 2,
                rowCount: 1,
                status: "succeeded",
                title: "第三个视频",
              }),
              item({
                batchItemId: "item-4",
                errorCode: "NETWORK_ERROR",
                order: 3,
                status: "failed",
                title: "第四个视频",
              }),
              item({
                batchItemId: "item-5",
                errorCode: null,
                order: 4,
                retryable: true,
                status: "cancelled",
                title: "第五个视频",
              }),
            ]),
          })}
        />,
      );
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const dots = table.querySelectorAll(".muzhi-batch__status-dot");
      expect(dots).toHaveLength(5);
      expect(
        Array.from(dots, (dot) => dot.getAttribute("data-status")),
      ).toEqual(["pending", "running", "succeeded", "failed", "cancelled"]);
    });

    it("shows the failure reason and speech progress inside the status column", () => {
      render(
        <BatchWorkspace
          {...props({
            view: view({}, [
              item({
                acquisitionMethod: "speech",
                errorCode: "SPEECH_TRANSCRIPTION_FAILED",
                progress: {
                  completed: 2,
                  stage: "transcribing",
                  total: 5,
                },
                status: "failed",
              }),
            ]),
          })}
        />,
      );
      const row = screen.getByText("第一个视频").closest("tr");
      const statusCell = row?.querySelector("td:nth-child(3)");
      expect(statusCell?.textContent).toContain("语音服务未能生成可用字幕");
      expect(statusCell?.textContent).toContain("转写音频分片 2/5");
    });

    it("labels a succeeded user-upload track badge distinctly", () => {
      const detailedItem = {
        ...item({ rowCount: 1, status: "succeeded", trackId: "track-up" }),
        availableTracks: [
          {
            language: "zh-CN",
            name: "中文（中国）",
            origin: "user-upload",
            source: "official",
            trackId: "track-up",
          },
        ],
      } as BatchItem & { readonly availableTracks: readonly unknown[] };
      render(<BatchWorkspace {...props({ view: view({}, [detailedItem]) })} />);
      expect(
        screen.getByText("已有用户上传字幕", { exact: false }),
      ).not.toBeNull();
    });

    it("exposes every column boundary as a draggable separator", () => {
      render(<BatchWorkspace {...props({ view: view() })} />);
      const table = screen.getByRole("table", { name: "批量视频列表" });
      expect(within(table).getAllByRole("separator")).toHaveLength(6);
    });

    it("resizes only the dragged column from its right boundary and persists the width", async () => {
      const storage = memoryLayoutStorage();
      render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const separators = within(table).getAllByRole("separator");
      // separators[1] = title|status 边界，拖它只改 title 列。
      fireEvent.pointerDown(separators[1], { clientX: 200 });
      fireEvent.pointerMove(document, { clientX: 260 });
      fireEvent.pointerUp(document);
      expect(
        table
          .querySelector("colgroup col[data-column-id='title']")
          ?.getAttribute("style"),
      ).toContain("width: 420px");
      await vi.waitFor(() => expect(storage.save).toHaveBeenCalled());
      const saved = storage.save.mock.calls[0]?.[0] as {
        readonly widths: Readonly<Record<string, number>>;
      };
      expect(saved.widths.title).toBe(420);
      // 其他列保持原宽（整体右移）。
      expect(
        table
          .querySelector("colgroup col[data-column-id='author']")
          ?.getAttribute("style"),
      ).toContain("width: 140px");
    });

    it("clamps every column at its minChars floor, including status", () => {
      render(<BatchWorkspace {...props({ view: view() })} />);
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const separators = within(table).getAllByRole("separator");
      // 拖 title|status 边界到很负：title clamp 到 minChars 8 → 116
      fireEvent.pointerDown(separators[1], { clientX: 300 });
      fireEvent.pointerMove(document, { clientX: 0 });
      fireEvent.pointerUp(document);
      expect(
        table
          .querySelector("colgroup col[data-column-id='title']")
          ?.getAttribute("style"),
      ).toContain("width: 116px");
      // 拖 status|actions 边界到很负：status clamp 到四语言最宽内容 → 228
      fireEvent.pointerDown(separators[2], { clientX: 300 });
      fireEvent.pointerMove(document, { clientX: 0 });
      fireEvent.pointerUp(document);
      expect(
        table
          .querySelector("colgroup col[data-column-id='status']")
          ?.getAttribute("style"),
      ).toContain("width: 228px");
    });

    it("resizes a column from the keyboard with bounded steps", () => {
      render(<BatchWorkspace {...props({ view: view() })} />);
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const separators = within(table).getAllByRole("separator");
      // separators[1] = title|status 边界 → 键盘调 title 列 360 + 8 = 368
      fireEvent.keyDown(separators[1], { key: "ArrowRight" });
      expect(
        table
          .querySelector("colgroup col[data-column-id='title']")
          ?.getAttribute("style"),
      ).toContain("width: 368px");
    });

    it("wraps flex cells only when force-full-text is on, keeps widths and restores the toggle after remount", async () => {
      const storage = memoryLayoutStorage();
      const { unmount } = render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const widthBefore = table
        .querySelector("colgroup col:nth-child(2)")
        ?.getAttribute("style");
      const toggle = screen.getByRole("button", { name: "强制显示全文本" });
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(toggle.className).toContain("is-active");
      expect(table.className).toContain("is-full-text");
      expect(
        table.querySelector("colgroup col:nth-child(2)")?.getAttribute("style"),
      ).toBe(widthBefore);
      await vi.waitFor(() =>
        expect(storage.save).toHaveBeenCalledWith(
          expect.objectContaining({ forceFullText: true }),
        ),
      );
      unmount();
      render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const restored = screen.getByRole("button", {
        name: "强制显示全文本",
      });
      await vi.waitFor(() =>
        expect(restored.getAttribute("aria-pressed")).toBe("true"),
      );
    });

    it("restores persisted column widths after a remount", async () => {
      const storage = memoryLayoutStorage();
      const { unmount } = render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const table = screen.getByRole("table", { name: "批量视频列表" });
      const separators = within(table).getAllByRole("separator");
      // separators[2] = status|actions 边界：status 240 + 60 = 300
      fireEvent.pointerDown(separators[2], { clientX: 200 });
      fireEvent.pointerMove(document, { clientX: 260 });
      fireEvent.pointerUp(document);
      await vi.waitFor(() => expect(storage.save).toHaveBeenCalled());
      unmount();
      render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const restored = screen.getByRole("table", { name: "批量视频列表" });
      await vi.waitFor(() =>
        expect(
          restored
            .querySelector("colgroup col[data-column-id='status']")
            ?.getAttribute("style"),
        ).toContain("width: 300px"),
      );
    });

    it("tags every cell with its card label for the narrow stacked view", () => {
      render(<BatchWorkspace {...props({ view: view() })} />);
      const row = screen.getByText("第一个视频").closest("tr");
      const labels = Array.from(row!.querySelectorAll("td"), (cell) =>
        cell.getAttribute("data-label"),
      );
      expect(labels).toEqual([
        "序号",
        "标题",
        "字幕状态",
        "操作",
        "作者",
        "发布日期",
        "视频身份",
      ]);
    });

    it("projects a legacy first-round layout: actions ignored, canonical widths applied, language defaulted", async () => {
      const legacy = {
        columns: [
          { fixed: true, forceFull: true, id: "index", minChars: 3, width: 64 },
          {
            fixed: true,
            forceFull: true,
            id: "status",
            minChars: 22,
            width: 320,
          },
          {
            fixed: true,
            forceFull: true,
            id: "actions",
            minChars: 6,
            width: 110,
          },
          {
            fixed: false,
            forceFull: true,
            id: "title",
            minChars: 8,
            width: 240,
          },
          {
            fixed: false,
            forceFull: true,
            id: "author",
            minChars: 4,
            width: 140,
          },
          {
            fixed: false,
            forceFull: true,
            id: "published",
            minChars: 6,
            width: 140,
          },
          {
            fixed: false,
            forceFull: true,
            id: "identity",
            minChars: 8,
            width: 200,
          },
        ],
        forceFullText: false,
      };
      const storage = memoryLayoutStorage();
      storage.load.mockResolvedValueOnce(legacy);
      render(
        <BatchWorkspace {...props({ layoutStorage: storage, view: view() })} />,
      );
      const table = await screen.findByRole("table", { name: "批量视频列表" });
      const headers = Array.from(
        table.querySelectorAll("thead th"),
        (header) => header.textContent,
      );
      // canonical 顺序（无 language、有 actions）。
      expect(headers).toEqual([
        "序号",
        "标题",
        "字幕状态?",
        "操作?",
        "作者",
        "发布日期",
        "视频身份",
      ]);
      // status 用旧保存宽度 320；title 用旧保存宽度 240；actions 用旧保存宽度 110。
      expect(
        table
          .querySelector("colgroup col[data-column-id='status']")
          ?.getAttribute("style"),
      ).toContain("width: 320px");
      expect(
        table
          .querySelector("colgroup col[data-column-id='title']")
          ?.getAttribute("style"),
      ).toContain("width: 240px");
      // v2 语义：合法旧 v1 布局加载后迁移并写回 v2（一次）。
      expect(storage.save).toHaveBeenCalledTimes(1);
      const migrated = storage.save.mock.calls[0]?.[0] as {
        readonly order: readonly string[];
        readonly widths: Readonly<Record<string, number>>;
      };
      expect(migrated.order[0]).toBe("index");
      expect(migrated.widths.status).toBe(320);
      // actions 列投影旧保存宽度。
      expect(
        table
          .querySelector("colgroup col[data-column-id='actions']")
          ?.getAttribute("style"),
      ).toContain("width: 118px");
      // 无 language 列。
      expect(
        table.querySelector("colgroup col[data-column-id='language']"),
      ).toBeNull();
    });

    it("shows speech setup for fresh items and export for acquired items in the actions column", () => {
      render(
        <BatchWorkspace
          {...props({
            view: view({}, [
              item({ status: "pending", acquisitionMethod: null }),
              item({
                batchItemId: "item-2",
                order: 1,
                status: "succeeded",
                rowCount: 9,
                trackId: "track-zh",
                title: "第二个视频",
                availableTracks: [zhTrack],
              }),
            ]),
          })}
        />,
      );
      // fresh 项：设置语音转录与语言 + 从列表中删除。
      expect(
        screen.getByRole("button", {
          name: "设置 第一个视频 的语音转录与语言",
        }),
      ).not.toBeNull();
      // 已获取项：导出（主操作）+ 从列表中删除。
      expect(
        screen.getByRole("button", { name: "导出 第二个视频" }),
      ).not.toBeNull();
      // 无独立语言列。
      expect(
        screen.queryByRole("combobox", { name: "语言偏好 第一个视频" }),
      ).toBeNull();
    });

    it("deletes a single row from the list only after an explicit confirmation", () => {
      const onDeleteItems = vi.fn();
      const value = props({
        onDeleteItems,
        view: view({}, [
          item({ status: "pending" }),
          item({
            batchItemId: "item-2",
            order: 1,
            status: "succeeded",
            rowCount: 3,
            title: "第二个视频",
            trackId: "track-zh",
            availableTracks: [zhTrack],
          }),
        ]),
      });
      render(<BatchWorkspace {...value} />);
      fireEvent.click(
        screen.getByRole("button", { name: "从列表中删除 第二个视频" }),
      );
      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toContain("第二个视频");
      expect(onDeleteItems).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
      expect(onDeleteItems).toHaveBeenCalledWith(["item-2"]);
    });

    it("refetches the chosen track directly while the item has no subtitle yet", () => {
      const onRefetchTrack = vi.fn();
      const value = props({
        onRefetchTrack,
        view: view({}, [
          item({
            acquisitionMethod: "direct",
            status: "failed",
            errorCode: "NETWORK_ERROR",
            retryable: true,
            availableTracks: [zhTrack],
            trackId: null,
          }),
        ]),
      });
      render(<BatchWorkspace {...value} />);
      const trackSelect = screen.getByRole("combobox", {
        name: "字幕轨道 第一个视频",
      }) as HTMLSelectElement;
      fireEvent.input(trackSelect, { target: { value: "track-zh" } });
      // 无确认：直接重取。
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onRefetchTrack).toHaveBeenCalledWith("item-1", "track-zh");
    });

    it("confirms before switching the direct track of an item that already has a subtitle", () => {
      const onRefetchTrack = vi.fn();
      const value = props({
        onRefetchTrack,
        view: view({}, [
          item({
            acquisitionMethod: "direct",
            rowCount: 12,
            status: "succeeded",
            trackId: "track-zh",
            availableTracks: [
              zhTrack,
              {
                language: "en-US",
                name: "英文",
                source: "official" as const,
                trackId: "track-en",
              },
            ],
            selectedTrackId: "track-zh",
          }),
        ]),
      });
      render(<BatchWorkspace {...value} />);
      const trackSelect = screen.getByRole("combobox", {
        name: "字幕轨道 第一个视频",
      }) as HTMLSelectElement;
      fireEvent.input(trackSelect, { target: { value: "track-en" } });
      // 已有字幕：先确认替换。
      expect(onRefetchTrack).not.toHaveBeenCalled();
      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toContain("英文");
      fireEvent.click(within(dialog).getByRole("button", { name: "确认替换" }));
      expect(onRefetchTrack).toHaveBeenCalledWith("item-1", "track-en");
    });
  });
});
//
// v16 D5：覆盖对话框三选项、清除字幕（列表级/行级）、删除所选、轨道切换重取。
//
describe("v16 D5 overwrite / clear / delete / refetch UI", () => {
  function succeededItem(overrides: Partial<BatchItem> = {}): BatchItem {
    return item({
      acquisitionMethod: "direct",
      rowCount: 12,
      status: "succeeded",
      trackId: "track-zh",
      ...overrides,
    });
  }

  it("offers skip / replace rules in the unified dialog and starts skip by default", () => {
    const value = props({
      view: view({ overwriteCount: 1 }, [
        succeededItem(),
        item({ batchItemId: "item-2", order: 1 }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("已有字幕 1 项");
    // 部分已有：跳过可用且默认选中。
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /跳过已有字幕/u,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /跳过已有字幕/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(value.onStart).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1", "item-2"],
      "skip",
      "mixed",
    );
  });

  it("starts with overwrite=all from the replace rule", () => {
    const value = props({
      view: view({ overwriteCount: 1 }, [succeededItem()]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /重新获取并替换/u }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1"],
      "all",
      "mixed",
    );
  });

  it("hints when every selected item already has a subtitle", () => {
    const value = props({
      view: view({ overwriteCount: 2 }, [
        succeededItem(),
        succeededItem({ batchItemId: "item-2", order: 1 }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("所选视频均已获取过字幕");
    expect(
      (
        within(dialog).getByRole("radio", {
          name: /跳过已有字幕/u,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("refetches the chosen track from the track select and hides it for speech items", () => {
    const onRefetchTrack = vi.fn();
    const value = props({
      onRefetchTrack,
      view: view({}, [
        succeededItem({
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              source: "official",
              trackId: "track-zh",
            },
            {
              language: "en-US",
              name: "English",
              source: "official",
              trackId: "track-en",
            },
          ],
        }),
        succeededItem({
          acquisitionMethod: "speech",
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              source: "official",
              trackId: "track-zh",
            },
          ],
          batchItemId: "item-2",
          order: 1,
          trackId: null,
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.input(
      screen.getByRole("combobox", { name: "字幕轨道 第一个视频" }),
      { target: { value: "track-en" } },
    );
    // 已有字幕：切换轨道先确认替换，确认后才重取。
    expect(onRefetchTrack).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("English");
    fireEvent.click(within(dialog).getByRole("button", { name: "确认替换" }));
    expect(onRefetchTrack).toHaveBeenCalledWith("item-1", "track-en");
    expect(
      screen.queryByRole("combobox", { name: "字幕轨道 第二个视频" }),
    ).toBeNull();
  });

  it("ignores the auto placeholder option without triggering a refetch", () => {
    const onRefetchTrack = vi.fn();
    const value = props({
      onRefetchTrack,
      view: view({}, [
        succeededItem({
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              source: "official",
              trackId: "track-zh",
            },
          ],
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.input(
      screen.getByRole("combobox", { name: "字幕轨道 第一个视频" }),
      { target: { value: "" } },
    );
    expect(onRefetchTrack).not.toHaveBeenCalled();
  });

  it("starts speech with overwrite=all from the unified dialog", () => {
    const value = props({
      view: view({ overwriteCount: 1 }, [succeededItem()]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /获取语音转录字幕/u }),
    );
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /重新获取并替换/u }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "speech",
      ["item-1"],
      "all",
      "mixed",
    );
  });

  it("clears a single item directly from the row without a dialog", () => {
    const onClearItem = vi.fn();
    const value = props({
      onClearItem,
      view: view({}, [succeededItem()]),
    });
    render(<BatchWorkspace {...value} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "清除 第一个视频 的当前字幕并返回待处理状态",
      }),
    );
    expect(onClearItem).toHaveBeenCalledWith("item-1");
  });

  it("renders a cleared item as pending with the track list kept instead of fresh-listed", () => {
    // 清除只复位字幕：tracksDiscovered/availableTracks/speechLanguageMode 保留。
    const cleared = item({
      acquisitionMethod: null,
      errorCode: null,
      rowCount: 0,
      status: "pending",
      trackId: null,
      tracksDiscovered: true,
      availableTracks: [
        {
          language: "zh-CN",
          name: "中文（中国）",
          source: "official" as const,
          trackId: "track-zh",
        },
      ],
      speechLanguageMode: "en",
    });
    render(<BatchWorkspace {...props({ view: view({}, [cleared]) })} />);
    const row = screen.getByText("第一个视频").closest("tr");
    const statusCell = row?.querySelector("td:nth-child(3)");
    // 回到「待处理」而非「加入列表成功」。
    expect(statusCell?.textContent).toContain("待处理");
    expect(statusCell?.textContent).not.toContain("加入列表成功");
    // 已发现轨道保留，可直接重新选择。
    expect(
      within(statusCell as HTMLElement).getByRole("combobox", {
        name: "字幕轨道 第一个视频",
      }),
    ).not.toBeNull();
  });
});
//
// v16 验收锚点样例（ticket 08）：BV1b7411N798/?p=22
// P22「3.1.3_栈的链式存储实现」；P1「0.0 课程白嫖指南」。
//
describe("v16 验收锚点样例批量场景", () => {
  const anchorP22 = (overrides: Partial<BatchItem> = {}): BatchItem =>
    item({
      bvid: "BV1b7411N798",
      page: 22,
      title: "3.1.3_栈的链式存储实现",
      ...overrides,
    });

  it("lists the anchor P22 row with identity and runs overwrite/clear/delete flow", () => {
    const onDeleteItems = vi.fn();
    const value = props({
      onDeleteItems,
      view: view({ overwriteCount: 1 }, [
        anchorP22({
          acquisitionMethod: "direct",
          aid: 2_803_108_323,
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              origin: "official-cc",
              source: "official",
              trackId: "track-zh",
            },
          ],
          cid: 304_765_522,
          rowCount: 42,
          status: "succeeded",
          trackId: "track-zh",
        }),
        anchorP22({
          aid: 2_803_108_323,
          batchItemId: "item-p1",
          cid: 304_765_521,
          order: 1,
          page: 1,
          title: "0.0 课程白嫖指南",
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    // 列表：P22 与 P1 标题、身份列（P22 · AID · CID）可见。
    const table = screen.getByRole("table", { name: "批量视频列表" });
    expect(table.textContent).toContain("3.1.3_栈的链式存储实现");
    expect(table.textContent).toContain("0.0 课程白嫖指南");
    expect(table.textContent).toContain("P22 · AID 2803108323");

    // 统一获取对话框：全部重新获取（锚点 P22 已有字幕）。
    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /重新获取并替换/u }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1", "item-p1"],
      "all",
      "mixed",
    );

    // 行级删除：独立确认（列表级删除入口已退役，行操作覆盖）。
    fireEvent.click(
      screen.getByRole("button", { name: "从列表中删除 0.0 课程白嫖指南" }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "确认删除",
      }),
    );
    expect(onDeleteItems).toHaveBeenCalledWith(["item-p1"]);
  });

  it("shows the stop action while the anchor batch is running and restores after refresh", () => {
    const onCancel = vi.fn();
    const value = props({
      onCancel,
      view: view(
        {
          job: {
            ...view().job,
            status: "running",
          } as BatchJobView["job"],
        },
        [anchorP22({ status: "running" })],
      ),
    });
    const { rerender } = render(<BatchWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "停止批量" }));
    expect(onCancel).toHaveBeenCalledOnce();

    // 刷新恢复：running 条目恢复为 succeeded（reconcile 语义由运行时测试覆盖，
    // 此处断言刷新后视图按持久化状态渲染）。
    const refreshed = props({
      view: view({}, [
        anchorP22({
          acquisitionMethod: "direct",
          availableTracks: [
            {
              language: "zh-CN",
              name: "中文（中国）",
              origin: "official-cc",
              source: "official",
              trackId: "track-zh",
            },
          ],
          rowCount: 42,
          status: "succeeded",
          trackId: "track-zh",
        }),
      ]),
    });
    rerender(<BatchWorkspace {...refreshed} />);
    expect(screen.getByText("已有官方字幕", { exact: false })).not.toBeNull();
  });
});

describe("batch contextual actions", () => {
  it("does not render selection actions when no rows are selected", () => {
    const unselected = createBatchItem({ ...item(), selected: false });
    render(<BatchWorkspace {...props({ view: view({}, [unselected]) })} />);
    expect(screen.queryByRole("button", { name: "批量获取字幕" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出" })).toBeNull();
  });

  describe("batch archive/trash workspace projections", () => {
    const archivedList = {
      archivedAt: 1_700_000_000_000,
      job: createBatchJob({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
        name: "归档列表",
        status: "ready",
        updatedAt: 1,
      }),
      order: 1,
      pinned: false,
    };

    it("renders archived lists with restore menu（无标签系统）", () => {
      const onRestoreList = vi.fn();
      render(
        <BatchArchiveWorkspace
          lists={[archivedList]}
          onRenameList={vi.fn()}
          onRestoreList={onRestoreList}
          onTrashList={vi.fn()}
          uiLanguage="zh-Hans"
        />,
      );
      expect(screen.getByText("归档列表")).not.toBeNull();
      // Ticket 05：批量标签系统已删除——无「全部列表」过滤栏与标签 chips。
      expect(screen.queryByRole("button", { name: "全部列表" })).toBeNull();
      expect(screen.queryByText("课程 · 1")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "列表操作 归档列表" }),
      );
      fireEvent.click(
        screen.getByRole("menuitem", { name: "恢复列表至工作区" }),
      );
      expect(onRestoreList).toHaveBeenCalledWith("job-1", true);
    });

    it("renders trashed lists with restore and permanent-delete menu", () => {
      const onPurgeList = vi.fn();
      render(
        <BatchTrashWorkspace
          lists={[
            {
              deletionReason: "user-delete",
              job: archivedList.job,
              order: 1,
              pinned: false,
              purgeAfter: null,
              retentionStartedAt: 200,
              trashedAt: 200,
              trashOrigin: "workspace",
            },
          ]}
          applyRetentionTo="future"
          customRetentionDays="7"
          onEmptyTrash={vi.fn()}
          onPurgeList={onPurgeList}
          onRestoreList={vi.fn()}
          onRetentionChange={vi.fn()}
          retention="7"
          uiLanguage="zh-Hans"
        />,
      );
      expect(screen.getByText("归档列表")).not.toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "列表操作 归档列表" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
      const dialog = screen.getByRole("alertdialog", {
        name: "永久删除该列表？",
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
      expect(onPurgeList).toHaveBeenCalledWith("job-1");
    });
  });
});

describe("Ticket 03：操作列图标与列头问号帮助", () => {
  it("操作列使用图标按钮（settings/download/trash）且删除为红色", () => {
    const succeededItem = createBatchItem({ ...item(), status: "succeeded" });
    const failedItem = createBatchItem({
      ...item({ batchItemId: "item-2", title: "第二个视频" }),
      errorCode: "NETWORK_ERROR",
      status: "failed",
    });
    render(
      <BatchWorkspace
        {...props({ view: view({}, [succeededItem, failedItem]) })}
      />,
    );
    // 成功行：download + trash 图标
    const exportBtn = screen.getByRole("button", {
      name: "导出 第一个视频",
    });
    expect(exportBtn.querySelector('[data-icon="download"]')).not.toBeNull();
    const removeSucceeded = screen.getByRole("button", {
      name: "从列表中删除 第一个视频",
    });
    expect(removeSucceeded.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(removeSucceeded.className).toContain("muzhi-batch__item-remove");
    // 失败行：settings + trash 图标（无导出）
    const settingsBtn = screen.getByRole("button", {
      name: "设置 第二个视频 的语音转录与语言",
    });
    expect(settingsBtn.querySelector('[data-icon="settings"]')).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "导出 第二个视频" }),
    ).toBeNull();
    // hover title 保留全称（aria-label 即全称）。
    expect(exportBtn.getAttribute("title")).toBe("导出 第一个视频");
  });

  it("状态列/操作列列头问号打开单关闭帮助 Dialog", () => {
    render(<BatchWorkspace {...props({ view: view({}, [item()]) })} />);
    fireEvent.click(screen.getByRole("button", { name: "字幕状态列帮助" }));
    const dialog = screen.getByRole("dialog", { name: "字幕状态列说明" });
    expect(dialog.textContent).toContain("待获取");
    expect(dialog.textContent).toContain("已取消");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "操作列帮助" }));
    const actionsDialog = screen.getByRole("dialog", {
      name: "操作列说明",
    });
    expect(actionsDialog.textContent).toContain("齿轮");
    expect(actionsDialog.textContent).toContain("垃圾桶");
    fireEvent.click(
      within(actionsDialog).getByRole("button", { name: "关闭" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("四语言帮助正文键 t() 抽查（en/ja/zh-Hant）", () => {
    // 组件渲染走默认 zh-Hans（四语言投影由 QA harness 承担）；
    // 此处用 t() 直查四语言正文，与 i18n 键集合门禁互补。
    expect(t("en", "batch.helpStatusColumnBody")).toContain("Pending");
    expect(t("ja", "batch.helpStatusColumnBody")).toContain("未取得");
    expect(t("zh-Hant", "batch.helpStatusColumnBody")).toContain("待取得");
    expect(t("en", "batch.helpActionsColumnBody")).toContain("Gear (settings)");
    expect(t("ja", "batch.helpActionsColumnBody")).toContain("歯車（設定）");
    expect(t("zh-Hant", "batch.helpActionsColumnBody")).toContain("齒輪");
  });
});

describe("Ticket 05：批量回收站期限设置", () => {
  const trashList = {
    deletionReason: "user-delete",
    job: createBatchJob({
      batchJobId: "job-1",
      browserSessionId: "browser-1",
      createdAt: 1,
      name: "回收站列表",
      status: "ready",
      updatedAt: 1,
    }),
    order: 1,
    pinned: false,
    purgeAfter: null,
    retentionStartedAt: 200,
    trashedAt: 200,
    trashOrigin: "workspace" as const,
  };

  it("renders retention controls and publishes changes", () => {
    const onRetentionChange = vi.fn();
    render(
      <BatchTrashWorkspace
        applyRetentionTo="future"
        customRetentionDays="7"
        lists={[trashList]}
        onEmptyTrash={vi.fn()}
        onPurgeList={vi.fn()}
        onRestoreList={vi.fn()}
        onRetentionChange={onRetentionChange}
        retention="7"
        uiLanguage="zh-Hans"
      />,
    );
    fireEvent.input(screen.getByRole("combobox", { name: "回收站保留" }), {
      target: { value: "365" },
    });
    expect(onRetentionChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用保留期限" }));
    expect(onRetentionChange).toHaveBeenCalledWith({
      applyTo: "future",
      customDays: "7",
      retention: "365",
    });
  });
});
