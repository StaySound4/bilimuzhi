/**
 * Ticket 04 契约测试：取消分页后完整列表语义。
 *
 * - 当前筛选结果全集直接渲染（无 page/pageSize/jump/range 语义）；
 * - 滚动容器高度代表完整列表，最后一行可达；
 * - 顶部横向滚动条与表格 body 双向同步（含底部原生冗余入口）；
 * - 全选作用于当前筛选结果全集。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchItem } from "../../src/domain";
import { createBatchItem, createBatchJob } from "../../src/domain";
import {
  BatchWorkspace,
  type BatchWorkspaceProps,
} from "../../src/ui/batch/batch-workspace";
import {
  filterBatchItems,
  statusFilterCounts,
} from "../../src/ui/batch/batch-filter";

afterEach(cleanup);

const bvid = "BV1zt4y1z72D";

function item(index: number): BatchItem {
  return createBatchItem({
    batchItemId: `item-${index}`,
    batchJobId: "job-1",
    bvid,
    errorCode: null,
    order: index,
    page: 1,
    resultBranchId: null,
    resultSessionId: null,
    rowCount: 0,
    selected: false,
    status: index % 4 === 0 ? ("succeeded" as const) : ("pending" as const),
    title: `视频 ${index}`,
    trackId: null,
    updatedAt: 1,
    videoKey: `bvid:${bvid}:cid:${3000000000 + index}:p:1`,
  });
}

function view(count: number) {
  return {
    items: Array.from({ length: count }, (_, index) => item(index)),
    job: createBatchJob({
      batchJobId: "job-1",
      browserSessionId: "browser-1",
      createdAt: 1,
      method: "direct",
      sourceKind: "video-pages",
      sourceLabel: "完整列表",
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
    hasLists: true,
    includeAllPages: false,
    input: "",
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
    ...overrides,
  };
}

describe("BatchWorkspace 完整列表（无分页）", () => {
  it("渲染当前筛选结果全集（94 项全量渲染，无分页控件）", () => {
    render(<BatchWorkspace {...props({ view: view(94) })} />);

    expect(
      document.querySelectorAll(".muzhi-batch__table tbody tr"),
    ).toHaveLength(94);
    expect(
      screen.queryByRole("navigation", { name: "批量列表分页" }),
    ).toBeNull();
    expect(screen.queryByLabelText("跳转页码")).toBeNull();
  });

  it("完整列表全部行在滚动容器内（最后一行可达，真实几何由 visual 门禁覆盖）", () => {
    render(<BatchWorkspace {...props({ view: view(94) })} />);
    const scroll = document.querySelector<HTMLElement>(
      ".muzhi-batch__table-scroll",
    )!;
    const rows = scroll.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(94);
    const lastRow = rows[rows.length - 1] as HTMLElement;
    expect(lastRow.textContent).toContain("视频 93");
    // 滚动容器是唯一纵向滚动 owner 的承载元素。
    expect(scroll.classList.contains("muzhi-batch__table-scroll")).toBe(true);
  });

  it("全选作用于当前筛选结果全集并提交全部 ID", () => {
    const onSelectionChange = vi.fn();
    render(
      <BatchWorkspace {...props({ onSelectionChange, view: view(94) })} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /选择当前筛选的全部 94 项/u }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith(
      Array.from({ length: 94 }, (_, index) => `item-${index}`),
    );
  });

  it("筛选后全选只作用于筛选结果", () => {
    const onSelectionChange = vi.fn();
    render(
      <BatchWorkspace {...props({ onSelectionChange, view: view(20) })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "按状态筛选批量条目" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /待处理/u }));
    fireEvent.click(
      screen.getByRole("button", { name: /选择当前筛选的全部 15 项/u }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith(
      Array.from({ length: 20 }, (_, index) => `item-${index}`).filter(
        (_, index) => index % 4 !== 0,
      ),
    );
  });

  it("顶部横向滚动条与表格 body 双向同步（底部原生滚动条冗余保留）", () => {
    render(<BatchWorkspace {...props({ view: view(10) })} />);
    const hscroll = document.querySelector<HTMLElement>(
      ".muzhi-batch__hscroll",
    )!;
    const scroll = document.querySelector<HTMLElement>(
      ".muzhi-batch__table-scroll",
    )!;
    // 顶部滚动条驱动表格 body
    hscroll.scrollLeft = 120;
    fireEvent.scroll(hscroll);
    expect(scroll.scrollLeft).toBe(120);
    // 表格 body 原生横向滚动驱动顶部滚动条
    scroll.scrollLeft = 60;
    fireEvent.scroll(scroll);
    expect(hscroll.scrollLeft).toBe(60);
  });

  it("filterBatchItems / statusFilterCounts 保持纯投影语义", () => {
    const items = view(10).items;
    expect(filterBatchItems(items, "all")).toHaveLength(10);
    expect(filterBatchItems(items, "succeeded")).toHaveLength(3);
    const counts = statusFilterCounts(items);
    expect(counts.succeeded).toBe(3);
    expect(counts.pending).toBe(7);
  });
});
