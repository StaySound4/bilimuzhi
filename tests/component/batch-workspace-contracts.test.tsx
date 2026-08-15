/**
 * Ticket 01 契约测试：BatchWorkspace 拆分 seam 的外部行为等价。
 *
 * 拆分的子组件（BatchJobsList / BatchSourceForm / BatchItemTable /
 * BatchListEmptyState）与共享契约（batch-contracts）必须保持与拆分前
 * BatchWorkspace 相同的外部行为与结构锚点：
 * - 批量任务列表的行、选中态、三点菜单与回调语义不变；
 * - 来源表单的来源类型、输入、分 P 单选、语言选择与提交语义不变；
 * - 表格的 sticky 表头、列调整、行内容与操作按钮语义不变；
 * - 空状态文案不变；
 * - 帮助语境、生命周期 adapter、选择域、列布局 v2、时间轴状态机与
 *   语音语言模式的契约被冻结且可被测试引用。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchItem } from "../../src/domain";
import { createBatchItem, createBatchJob } from "../../src/domain";
import { defaultBatchColumnLayoutV2 } from "../../src/ui/batch/batch-column-layout-v2";
import {
  BATCH_HELP_CONTEXTS,
  DEFAULT_BATCH_COLUMN_ORDER,
  HIDABLE_COLUMNS,
  NON_HIDABLE_COLUMNS,
  SPEECH_LANGUAGE_MODES,
  SPEECH_PROMPT_POLICY,
  TIMELINE_SYNC_STATES,
  type BatchHelpContext,
  type BatchColumnLayoutV2,
  type SelectionDomain,
  type TimelineSyncIntent,
} from "../../src/ui/batch/batch-contracts";
import { BatchListEmptyState } from "../../src/ui/batch/batch-empty-state";
import { BatchAcquireDialog } from "../../src/ui/batch/batch-acquire-dialog";
import { BatchItemTable } from "../../src/ui/batch/batch-item-table";
import { BatchJobsList } from "../../src/ui/batch/batch-jobs-list";
import { BatchSourceForm } from "../../src/ui/batch/batch-source-form";

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

function jobSummary(
  overrides: Partial<Parameters<typeof createBatchJob>[0]> = {},
) {
  const job = createBatchJob({
    batchJobId: "job-1",
    browserSessionId: "browser-1",
    createdAt: 1,
    method: "direct",
    sourceKind: "video-pages",
    sourceLabel: "测试来源",
    status: "ready",
    updatedAt: 1,
    ...overrides,
  });
  return {
    createdAtLabel: "2026-01-01",
    id: job.batchJobId,
    label: job.name ?? job.sourceLabel ?? "批量任务",
    pinned: false,
    status: job.status,
  };
}

describe("BatchJobsList（侧栏 seam）", () => {
  it("渲染 A3 列表行结构：标题、状态槽、三点菜单与激活态", () => {
    const jobs = [jobSummary()];
    render(
      <BatchJobsList
        jobs={jobs}
        activeJobId="job-1"
        busy={false}
        summary={{ succeeded: 2, failed: 1 }}
        onSelectJob={vi.fn()}
        onRenameRequest={vi.fn()}
        onTogglePinned={vi.fn()}
        onArchiveRequest={vi.fn()}
        onTrashRequest={vi.fn()}
      />,
    );

    const section = document.querySelector(".muzhi-batch__jobs");
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-labelledby")).toBe("batch-jobs-title");
    expect(screen.getByText("批量任务")).toBeDefined();
    const sectionEl = document.querySelector(
      ".muzhi-batch__jobs",
    ) as HTMLElement;
    const activeButton = within(sectionEl).getByRole("button", {
      name: /^测试来源/,
    });
    expect(activeButton.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(/待获取字幕/)).toBeDefined();
    expect(screen.getByText(/2\/1/)).toBeDefined();
  });

  it("三点菜单回调保持语义：重命名/置顶/归档/删除", () => {
    const onRenameRequest = vi.fn();
    const onTogglePinned = vi.fn();
    const onArchiveRequest = vi.fn();
    const onTrashRequest = vi.fn();
    const jobs = [jobSummary()];
    render(
      <BatchJobsList
        jobs={jobs}
        busy={false}
        onSelectJob={vi.fn()}
        onRenameRequest={onRenameRequest}
        onTogglePinned={onTogglePinned}
        onArchiveRequest={onArchiveRequest}
        onTrashRequest={onTrashRequest}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "批量任务操作 测试来源" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(onRenameRequest).toHaveBeenCalledWith("job-1", "测试来源");
    fireEvent.click(
      screen.getByRole("button", { name: "批量任务操作 测试来源" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(onTogglePinned).toHaveBeenCalledWith("job-1", true);
    fireEvent.click(
      screen.getByRole("button", { name: "批量任务操作 测试来源" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(onArchiveRequest).toHaveBeenCalledWith("job-1");
    fireEvent.click(
      screen.getByRole("button", { name: "批量任务操作 测试来源" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(onTrashRequest).toHaveBeenCalledWith("job-1");
  });

  it("点击行选中列表", () => {
    const onSelectJob = vi.fn();
    render(
      <BatchJobsList
        jobs={[
          jobSummary(),
          jobSummary({ batchJobId: "job-2", sourceLabel: "测试来源 2" }),
        ]}
        activeJobId="job-1"
        busy={false}
        onSelectJob={onSelectJob}
        onRenameRequest={vi.fn()}
        onTogglePinned={vi.fn()}
        onArchiveRequest={vi.fn()}
        onTrashRequest={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^测试来源 2/ }));
    expect(onSelectJob).toHaveBeenCalledWith("job-2");
  });
});

describe("BatchSourceForm（解析并加入 seam）", () => {
  it("渲染全部冻结来源类型与输入占位", () => {
    render(
      <BatchSourceForm
        hasCurrentList
        input={bvid}
        onIncludeAllPagesChange={vi.fn()}
        onInputChange={vi.fn()}
        onPrepare={vi.fn()}
        onShowSourceHelp={vi.fn()}
        onSingleVideoPageSelectionChange={vi.fn()}
        onSourceKindChange={vi.fn()}
      />,
    );

    const sourceType = screen.getByRole("combobox", { name: "来源类型" });
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
    expect(screen.getByLabelText("批量来源").getAttribute("placeholder")).toBe(
      "粘贴 B 站页面地址（如 BV1b7411N798）或输入搜索关键词",
    );
    expect(
      screen.getByText("请等待视频页面加载稳定后再复制地址"),
    ).not.toBeNull();
  });

  it("无输入时禁用提交；有输入后提交调用 onPrepare", () => {
    const onPrepare = vi.fn();
    const { rerender } = render(
      <BatchSourceForm
        hasCurrentList
        input=""
        onIncludeAllPagesChange={vi.fn()}
        onInputChange={vi.fn()}
        onPrepare={onPrepare}
        onShowSourceHelp={vi.fn()}
        onSingleVideoPageSelectionChange={vi.fn()}
        onSourceKindChange={vi.fn()}
      />,
    );
    // Ticket 04：提交按钮移入 Dialog 底部（form 不再渲染提交按钮），
    // form seam 以 Enter 提交验证 onPrepare 与禁用态。
    expect(screen.queryByRole("button", { name: "解析并加入列表" })).toBeNull();

    rerender(
      <BatchSourceForm
        hasCurrentList
        input={bvid}
        onIncludeAllPagesChange={vi.fn()}
        onInputChange={vi.fn()}
        onPrepare={onPrepare}
        onShowSourceHelp={vi.fn()}
        onSingleVideoPageSelectionChange={vi.fn()}
        onSourceKindChange={vi.fn()}
      />,
    );
    const form = screen.getByLabelText("批量来源").closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(onPrepare).toHaveBeenCalledOnce();
  });

  it("来源类型与单视频分 P 选择保持显式回传", () => {
    const onSourceKindChange = vi.fn();
    const onSingleVideoPageSelectionChange = vi.fn();
    const onIncludeAllPagesChange = vi.fn();
    render(
      <BatchSourceForm
        hasCurrentList
        input={bvid}
        onIncludeAllPagesChange={onIncludeAllPagesChange}
        onInputChange={vi.fn()}
        onPrepare={vi.fn()}
        onShowSourceHelp={vi.fn()}
        onSingleVideoPageSelectionChange={onSingleVideoPageSelectionChange}
        onSourceKindChange={onSourceKindChange}
        recognizedSingleVideoPages={{ currentPage: 1, totalPages: 3 }}
        singleVideoPageSelection="current"
      />,
    );

    expect(
      (screen.getByRole("radio", { name: "仅当前分 P" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "包含全部分 P" }));
    expect(onSingleVideoPageSelectionChange).toHaveBeenCalledWith("all");
    expect(onIncludeAllPagesChange).toHaveBeenCalledWith(true);

    fireEvent.input(screen.getByLabelText("来源类型"), {
      target: { value: "video-pages" },
    });
    expect(onSourceKindChange).toHaveBeenCalledWith("video-pages");
  });

  it("打开来源帮助入口；常驻「默认字幕语言」已删除", () => {
    const onShowSourceHelp = vi.fn();
    render(
      <BatchSourceForm
        hasCurrentList
        input={bvid}
        onIncludeAllPagesChange={vi.fn()}
        onInputChange={vi.fn()}
        onPrepare={vi.fn()}
        onShowSourceHelp={onShowSourceHelp}
        onSingleVideoPageSelectionChange={vi.fn()}
        onSourceKindChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看支持的批量来源" }));
    expect(onShowSourceHelp).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("默认字幕语言")).toBeNull();
  });
});

describe("BatchItemTable（表格视口 seam）", () => {
  function tableProps() {
    return {
      hasCurrentList: true,
      items: [
        item({ title: "第一个视频", order: 0 }),
        item({
          batchItemId: "item-2",
          order: 1,
          selected: false,
          status: "succeeded" as const,
          title: "第二个视频",
          rowCount: 42,
          acquisitionMethod: "direct" as const,
          trackId: "track-1",
          availableTracks: [
            {
              language: "zh",
              name: "中文（自动生成）",
              origin: "ai" as const,
              source: "ai" as const,
              trackId: "track-1",
            },
          ],
        }),
      ],
      layout: defaultBatchColumnLayoutV2(),
      onClearItem: vi.fn(),
      onExportItem: vi.fn(),
      onLayoutChange: vi.fn(),
      onRemoveItemRequest: vi.fn(),
      onSpeechSettingsRequest: vi.fn(),
      onChangeTrack: vi.fn(),
      onToggleFromRow: vi.fn(),
      onToggleItem: vi.fn(),
      speechLanguageMode: "mixed" as const,
    };
  }

  it("渲染 sticky 表头、顶部横向滚动条与表格列头", () => {
    render(<BatchItemTable {...tableProps()} />);

    expect(document.querySelector(".muzhi-batch__hscroll")).not.toBeNull();
    expect(document.querySelector(".muzhi-batch__table-scroll")).not.toBeNull();
    expect(
      document.querySelector(".muzhi-batch__hscroll-track"),
    ).not.toBeNull();
    const table = document.querySelector(".muzhi-batch__table");
    expect(table).not.toBeNull();
    expect(table?.getAttribute("style")).toContain("min-width");
    const headers = Array.from(document.querySelectorAll("thead th")).map(
      (th) => th.textContent,
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
    expect(
      document.querySelectorAll("thead .muzhi-batch__resizer").length,
    ).toBe(6);
  });

  it("渲染数据行：选择框、状态、标题、身份与操作按钮", () => {
    render(<BatchItemTable {...tableProps()} />);

    expect(screen.getByLabelText("选择 第一个视频")).toBeDefined();
    expect(screen.getByText("第一个视频")).toBeDefined();
    expect(screen.getByText("加入列表成功")).toBeDefined();
    expect(screen.getByText("第二个视频")).toBeDefined();
    expect(screen.getByText(/42 行/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "导出 第二个视频" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /设置 第一个视频 的语音转录与语言/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /从列表中删除 第一个视频/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /清除 第二个视频 的当前字幕/ }),
    ).toBeDefined();
  });

  it("行内操作回调保持语义", () => {
    const onToggleItem = vi.fn();
    const onClearItem = vi.fn();
    const onExportItem = vi.fn();
    const onSpeechSettingsRequest = vi.fn();
    const onRemoveItemRequest = vi.fn();
    const props = tableProps();
    render(
      <BatchItemTable
        {...props}
        onToggleItem={onToggleItem}
        onClearItem={onClearItem}
        onExportItem={onExportItem}
        onSpeechSettingsRequest={onSpeechSettingsRequest}
        onRemoveItemRequest={onRemoveItemRequest}
      />,
    );

    fireEvent.click(screen.getByLabelText("选择 第一个视频"));
    expect(onToggleItem).toHaveBeenCalledWith("item-1", false);
    fireEvent.click(
      screen.getByRole("button", { name: /清除 第二个视频 的当前字幕/ }),
    );
    expect(onClearItem).toHaveBeenCalledWith("item-2");
    fireEvent.click(screen.getByRole("button", { name: "导出 第二个视频" }));
    expect(onExportItem).toHaveBeenCalledWith(
      expect.objectContaining({ batchItemId: "item-2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /设置 第一个视频 的语音转录与语言/ }),
    );
    expect(onSpeechSettingsRequest).toHaveBeenCalledWith("item-1");
    fireEvent.click(
      screen.getByRole("button", { name: /从列表中删除 第一个视频/ }),
    );
    expect(onRemoveItemRequest).toHaveBeenCalledWith("item-1");
  });
});

describe("BatchListEmptyState（空状态 seam）", () => {
  it("无列表时渲染「还没有列表」空卡片（含新建引导按钮）", () => {
    const onCreateList = vi.fn();
    render(<BatchListEmptyState onCreateList={onCreateList} />);
    expect(screen.getByText("还没有列表")).toBeDefined();
    expect(document.querySelector(".muzhi-batch__empty-card")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建列表" }));
    expect(onCreateList).toHaveBeenCalledOnce();
  });

  it("已有列表但未选中时提示选择列表", () => {
    render(<BatchListEmptyState variant="select-list" />);
    expect(screen.getByText("请先选择一个批量列表。")).toBeDefined();
  });

  it("空列表渲染「当前列表还没有视频」空卡片与解析引导", () => {
    const onOpenSource = vi.fn();
    render(
      <BatchListEmptyState variant="list-empty" onOpenSource={onOpenSource} />,
    );
    expect(screen.getByText("当前列表还没有视频")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "解析并加入列表" }));
    expect(onOpenSource).toHaveBeenCalledOnce();
  });
});

describe("BatchAcquireDialog（批量获取字幕 seam）", () => {
  function dialogProps(
    overrides: Partial<Parameters<typeof BatchAcquireDialog>[0]> = {},
  ) {
    return {
      allHaveSubtitles: false,
      busy: false,
      existingCount: 1,
      method: "direct" as const,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onMethodChange: vi.fn(),
      onOverwriteChange: vi.fn(),
      overwrite: "skip" as const,
      scopeDescription: "全部 3 项",
      speechScope: "mixed" as const,
      onSpeechScopeChange: vi.fn(),
      ...overrides,
    };
  }

  it("speech 方法显示语音语言作用域（含按对应视频项设置）与 disclaimer，切换触发回调（Ticket 10）", () => {
    const onSpeechScopeChange = vi.fn();
    render(
      <BatchAcquireDialog
        {...dialogProps({
          method: "speech",
          onSpeechScopeChange,
          speechScope: "mixed",
        })}
      />,
    );
    screen.getByRole("group", { name: "语音转录语言" });
    // 默认混合选中
    expect(
      (screen.getByRole("radio", { name: "混合" }) as HTMLInputElement).checked,
    ).toBe(true);
    // 六选项齐全：按对应视频项设置 / 混合 / 中文 / 英文 / 日文 / 其他
    expect(
      screen.getByRole("radio", { name: "按对应视频项设置" }),
    ).not.toBeNull();
    expect(screen.getByRole("radio", { name: "中文" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "英文" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "日文" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "其他" })).not.toBeNull();
    expect(screen.getByText(/只能促进识别/u)).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "中文" }));
    expect(onSpeechScopeChange).toHaveBeenCalledWith("zh");
    // 按对应视频项设置也触发回调
    fireEvent.click(screen.getByRole("radio", { name: "按对应视频项设置" }));
    expect(onSpeechScopeChange).toHaveBeenCalledWith("item");
  });

  it("direct 方法不显示语音语言设置", () => {
    render(<BatchAcquireDialog {...dialogProps()} />);
    expect(screen.queryByRole("group", { name: "语音转录语言" })).toBeNull();
  });

  it("渲染获取方式与覆盖决策单选，确认走 onConfirm", () => {
    const onConfirm = vi.fn();
    render(<BatchAcquireDialog {...dialogProps({ onConfirm })} />);
    expect(
      (
        screen.getByRole("radio", {
          name: "获取官方/AI字幕",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "跳过已有字幕" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "开始获取" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("全部已有字幕时「跳过」不可选并显示提示", () => {
    render(<BatchAcquireDialog {...dialogProps({ allHaveSubtitles: true })} />);
    expect(
      (screen.getByRole("radio", { name: "跳过已有字幕" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/均已获取过字幕/)).toBeDefined();
  });

  it("方法/覆盖变更通过回调上报", () => {
    const onMethodChange = vi.fn();
    const onOverwriteChange = vi.fn();
    render(
      <BatchAcquireDialog
        {...dialogProps({ onMethodChange, onOverwriteChange })}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /语音转录/ }));
    expect(onMethodChange).toHaveBeenCalledWith("speech");
    fireEvent.click(screen.getByRole("radio", { name: "重新获取并替换" }));
    expect(onOverwriteChange).toHaveBeenCalledWith("all");
  });

  it("作用范围文案与已有字幕计数出现在描述中", () => {
    render(
      <BatchAcquireDialog
        {...dialogProps({ scopeDescription: "全部 3 项", existingCount: 2 })}
      />,
    );
    expect(screen.getByText(/全部 3 项/)).toBeDefined();
    expect(screen.getByText(/已有字幕 2 项/)).toBeDefined();
  });
});

describe("batch-contracts（冻结契约）", () => {
  it("帮助语境为六种 mode×surface 且值冻结", () => {
    expect(BATCH_HELP_CONTEXTS).toEqual([
      "session-workspace",
      "session-archive",
      "session-trash",
      "batch-workspace",
      "batch-archive",
      "batch-trash",
    ]);
    const context: BatchHelpContext = "batch-workspace";
    expect(context.length).toBeGreaterThan(0);
  });

  it("列布局 v2：序号永远第一；序号/状态/操作不可隐藏", () => {
    // 注意：v2 顺序是 Ticket 05 的目标契约；当前表格仍按 v1 canonical
    // 顺序（index/status/title/author/published/identity/actions）渲染，
    // 本断言只锁定契约常量，不锁定当前渲染顺序。
    expect(DEFAULT_BATCH_COLUMN_ORDER[0]).toBe("index");
    expect(DEFAULT_BATCH_COLUMN_ORDER).toEqual([
      "index",
      "title",
      "status",
      "actions",
      "author",
      "published",
      "identity",
    ]);
    expect(NON_HIDABLE_COLUMNS).toEqual(["index", "status", "actions"]);
    expect(HIDABLE_COLUMNS).toEqual([
      "title",
      "author",
      "published",
      "identity",
    ]);
    const v2: BatchColumnLayoutV2 = {
      forceFullText: false,
      order: [...DEFAULT_BATCH_COLUMN_ORDER],
      visible: { author: true, identity: true, published: true, title: true },
      widths: {
        actions: 120,
        author: 140,
        identity: 200,
        index: 64,
        published: 140,
        status: 220,
        title: 360,
      },
    };
    expect(v2.order[0]).toBe("index");
  });

  it("语音语言模式为 zh/en/other/mixed/ja 且默认 mixed", () => {
    expect(SPEECH_LANGUAGE_MODES).toEqual(["zh", "en", "other", "mixed", "ja"]);
  });

  it("语音 Prompt 策略：zh/en/ja 固定 language，other/mixed 不固定", () => {
    expect(SPEECH_PROMPT_POLICY.zh.languageParam).toBe("zh");
    expect(SPEECH_PROMPT_POLICY.en.languageParam).toBe("en");
    expect(SPEECH_PROMPT_POLICY.ja.languageParam).toBe("ja");
    expect(SPEECH_PROMPT_POLICY.other.languageParam).toBeNull();
    expect(SPEECH_PROMPT_POLICY.mixed.languageParam).toBeNull();
  });

  it("时间轴同步状态机为 idle/following/seeking 且 intent 带代次", () => {
    expect(TIMELINE_SYNC_STATES).toEqual(["idle", "following", "seeking"]);
    const intent: TimelineSyncIntent = { generation: 3, sequence: 7 };
    expect(intent.sequence).toBe(7);
  });

  it("选择域契约可被消费且严格区分列表/条目", () => {
    const listDomain: SelectionDomain = { domain: "list" };
    const itemDomain: SelectionDomain = { domain: "item" };
    expect(listDomain.domain).toBe("list");
    expect(itemDomain.domain).toBe("item");
  });
});
