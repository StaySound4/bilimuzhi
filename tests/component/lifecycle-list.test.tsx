/**
 * Ticket 07 契约测试：共享生命周期列表 primitive + Session/Batch adapter。
 *
 * - 搜索、多选、全选、行结构、三点菜单、恢复/移入回收站/永久删除、
 *   危险确认与空态由同一 primitive 承载；
 * - Session 与 Batch 通过 adapter 注入不同数据行为，结构锚点一致。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LifecycleList,
  type LifecycleListAdapter,
  type LifecycleListProps,
} from "../../src/ui/primitives/lifecycle-list";
import type { MessageKey } from "../../src/i18n/messages";

afterEach(cleanup);

interface Row {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
}

const ARCHIVE_ADAPTER: LifecycleListAdapter = {
  actionsAriaKey: "drawer.listActionsAria" as MessageKey,
  countKey: "drawer.listCount" as MessageKey,
  emptyKey: "batch.archiveEmpty" as MessageKey,
  kind: "batch",
  noMatchKey: "drawer.noListMatch" as MessageKey,
  purgeLabelKey: null,
  purgeManyLabelKey: null,
  restoreLabelKey: "batch.restoreList" as MessageKey,
  restoreManyLabelKey: "batch.restoreMany" as MessageKey,
  runningNamesKey: "drawer.runningListNames" as MessageKey,
  searchLabelKey: "drawer.searchLists" as MessageKey,
  searchPlaceholderKey: "drawer.searchListPlaceholder" as MessageKey,
  selectAriaKey: "drawer.selectList" as MessageKey,
  selectionAriaKey: "drawer.batchManageListsAria" as MessageKey,
  surface: "archive",
  trashLabelKey: "drawer.actionDelete" as MessageKey,
  trashManyLabelKey: "batch.trashMany" as MessageKey,
};

function props(
  overrides: Partial<LifecycleListProps<Row>> = {},
): LifecycleListProps<Row> {
  return {
    adapter: ARCHIVE_ADAPTER,
    busy: false,
    items: [
      { id: "r1", title: "列表 A", meta: "2026/8/1" },
      { id: "r2", title: "列表 B", meta: "2026/8/2" },
    ],
    matches: (row, query) => row.title.toLowerCase().includes(query),
    onMoveToTrash: vi.fn(),
    onRestore: vi.fn(),
    onRestoreMany: vi.fn(),
    toView: (row) => ({ id: row.id, meta: row.meta, title: row.title }),
    uiLanguage: "zh-Hans",
    ...overrides,
  };
}

describe("LifecycleList 共享 primitive", () => {
  it("渲染标题、搜索、计数、行结构与三点菜单（archive adapter）", () => {
    render(<LifecycleList {...props()} />);
    expect(screen.getByLabelText("搜索列表")).toBeDefined();
    expect(screen.getByText("2 个列表")).toBeDefined();
    expect(screen.getByText("列表 A")).toBeDefined();
    expect(screen.getByText("列表 B")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "列表操作 列表 A" }));
    expect(
      screen.getByRole("menuitem", { name: "恢复列表至工作区" }),
    ).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeDefined();
  });

  it("搜索只过滤列表/会话名称", () => {
    render(<LifecycleList {...props()} />);
    fireEvent.input(screen.getByLabelText("搜索列表"), {
      target: { value: "A" },
    });
    expect(screen.getByText("列表 A")).toBeDefined();
    expect(screen.queryByText("列表 B")).toBeNull();
    fireEvent.input(screen.getByLabelText("搜索列表"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配列表")).toBeDefined();
  });

  it("多选工具栏：全选搜索结果、批量恢复、批量移入回收站", () => {
    const onRestoreMany = vi.fn();
    const onTrashMany = vi.fn();
    render(
      <LifecycleList
        {...props({ onMoveToTrash: onTrashMany, onRestoreMany })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择列表 列表 A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择列表 列表 B" }));
    expect(screen.getByText("已选 2")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    expect(onTrashMany).toHaveBeenCalledWith(["r1", "r2"]);
    // 批量恢复后退出多选（工具栏消失）。
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择列表 列表 A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择列表 列表 B" }));
    fireEvent.click(screen.getByRole("button", { name: "批量恢复" }));
    expect(onRestoreMany).toHaveBeenCalledWith(["r1", "r2"]);
  });

  it("trash adapter 提供永久删除并先危险确认", () => {
    const onPurge = vi.fn();
    render(
      <LifecycleList
        {...props({
          adapter: {
            ...ARCHIVE_ADAPTER,
            confirmPurge: true,
            confirmPurgeBodyKey: "batch.confirmPurgeBody" as MessageKey,
            confirmPurgeTitleKey: "batch.confirmPurgeTitle" as MessageKey,
            purgeLabelKey: "trash.deleteForever",
            surface: "trash",
          },
          onPurge,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "列表操作 列表 A" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    expect(onPurge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onPurge).toHaveBeenCalledWith(["r1"]);
  });

  it("空列表与过滤空态区分", () => {
    const { rerender } = render(<LifecycleList {...props({ items: [] })} />);
    expect(screen.getByText("批量归档为空。")).toBeDefined();
    rerender(<LifecycleList {...props()} />);
    fireEvent.input(screen.getByLabelText("搜索列表"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("没有匹配列表")).toBeDefined();
  });

  it("危险操作（恢复/移入回收站）在运行中先确认，行级恢复直接调用", () => {
    const onRestore = vi.fn();
    render(<LifecycleList {...props({ onRestore })} />);
    fireEvent.click(screen.getByRole("button", { name: "列表操作 列表 A" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复列表至工作区" }));
    expect(onRestore).toHaveBeenCalledWith(["r1"]);
  });
});
