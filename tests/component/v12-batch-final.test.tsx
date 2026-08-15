import {
  cleanup,
  fireEvent,
  render,
  screen,
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

afterEach(cleanup);

const bvid = "BV1zt4y1z72D";

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return createBatchItem({
    acquisitionMethod: null,
    aid: 88_000_001,
    author: "批量作者",
    batchItemId: "item-1",
    batchJobId: "job-1",
    bvid,
    cid: 30_000_000_001,
    errorCode: null,
    order: 0,
    page: 1,
    publishedAt: 1_700_000_000,
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

function view(items: readonly BatchItem[]): BatchJobView {
  return {
    items,
    job: createBatchJob({
      batchJobId: "job-1",
      browserSessionId: "browser-1",
      createdAt: 1,
      method: "direct",
      sourceKind: "video-pages",
      sourceLabel: "精确分 P 列表",
      status: "ready",
      updatedAt: 1,
    }),
    overwriteCount: 0,
  };
}

function props(
  overrides: Partial<BatchWorkspaceProps> = {},
): BatchWorkspaceProps {
  return {
    includeAllPages: true,
    input: "",
    hasLists: false,
    speechConfigured: true,
    speechLanguageMode: "mixed",
    speechRoutingMode: "balanced",
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onIncludeAllPagesChange: vi.fn(),
    onInputChange: vi.fn(),
    onLanguagePreferenceChange: vi.fn(),
    onOpenSession: vi.fn(),
    onPrepare: vi.fn(),
    onSelectionChange: vi.fn(),
    onStart: vi.fn(),
    ...overrides,
  };
}

describe("v12 independent batch interaction (A5)", () => {
  it("toggles from non-interactive row space, exposes whole-row selection, and does not double-toggle a control click", () => {
    const value = props({ view: view([item()]) });
    render(<BatchWorkspace {...value} />);

    const row = screen.getByText("第一个视频").closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveProperty("className", "is-selected");
    expect(row?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(row!).getByText("批量作者"));
    expect(value.onSelectionChange).toHaveBeenCalledWith([]);

    vi.mocked(value.onSelectionChange).mockClear();
    fireEvent.click(within(row!).getByRole("checkbox"));
    expect(value.onSelectionChange).toHaveBeenCalledOnce();
  });

  it("freezes successful selected ids for export and never offers a row-level download", () => {
    const onExport = vi.fn();
    const onSelectionChange = vi.fn();
    const first = item({
      acquisitionMethod: "direct",
      rowCount: 12,
      status: "succeeded",
      trackId: "track:first",
    });
    const second = item({
      acquisitionMethod: "direct",
      batchItemId: "item-2",
      cid: 30_000_000_002,
      order: 1,
      rowCount: 8,
      selected: false,
      status: "succeeded",
      title: "第二个视频",
      trackId: "track:second",
      videoKey: `bvid:${bvid}:cid:30000000002:p:2`,
    });
    const { rerender } = render(
      <BatchWorkspace
        {...props({
          onExport,
          onSelectionChange,
          view: view([first, second]),
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    rerender(
      <BatchWorkspace
        {...props({
          onExport,
          onSelectionChange,
          view: view([
            createBatchItem({ ...first, selected: false }),
            createBatchItem({ ...second, selected: true }),
          ]),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "SRT" }));
    expect(onExport.mock.calls[0]?.slice(0, 2)).toEqual(["srt", ["item-1"]]);

    // 操作列恢复：成功条目有行内导出按钮，点击打开单条目导出对话框。
    fireEvent.click(screen.getByRole("button", { name: "导出 第二个视频" }));
    screen.getByRole("dialog", { name: "选择导出格式" });
    fireEvent.click(screen.getByRole("button", { name: "TXT" }));
    // live 选中与冻结范围一致时传 undefined（sidepanel 按当前选中导出，即该视频）。
    expect(onExport).toHaveBeenLastCalledWith("txt", undefined, {
      includeTimestamps: true,
      zip: true,
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("offers direct-only discovery versus direct speech and never exposes a Session conversion", () => {
    const value = props({
      view: view([
        item({ acquisitionMethod: null }),
        item({
          acquisitionMethod: "direct",
          batchItemId: "item-2",
          cid: 30_000_000_002,
          order: 1,
          rowCount: 9,
          status: "succeeded",
          title: "已有官方字幕",
          trackId: "track:second",
          videoKey: `bvid:${bvid}:cid:30000000002:p:2`,
        }),
      ]),
    });
    render(<BatchWorkspace {...value} />);

    expect(
      screen.queryByRole("button", { name: /(?:打开|转为)会话/u }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "批量获取字幕" }));
    const dialog = screen.getByRole("dialog", { name: "批量获取字幕" });
    expect(dialog.textContent).toContain("获取官方/AI字幕");
    expect(dialog.textContent).toContain("获取语音转录字幕");
    expect(dialog.textContent).toContain("取消");
    // 默认直接方法：开始获取仅走 direct。
    fireEvent.click(within(dialog).getByRole("button", { name: "开始获取" }));
    expect(value.onStart).toHaveBeenCalledWith(
      "direct",
      ["item-1", "item-2"],
      "skip",
      "mixed",
    );
    expect(value.onOpenSession).not.toHaveBeenCalled();
  });

  it("shows speech preparation as processed MB plus percentage instead of raw unit counters", () => {
    render(
      <BatchWorkspace
        {...props({
          view: view([
            item({
              acquisitionMethod: "speech",
              progress: {
                completed: 5 * 1_048_576,
                stage: "preparing",
                total: 20 * 1_048_576,
                unit: "bytes",
              },
              status: "running",
            }),
          ]),
        })}
      />,
    );

    const row = screen.getByText("第一个视频").closest("tr");
    expect(row?.textContent).toContain("5.0 MB / 20.0 MB");
    expect(row?.textContent).toContain("25%");
    expect(row?.textContent).not.toContain("5242880/20971520");
  });
});
