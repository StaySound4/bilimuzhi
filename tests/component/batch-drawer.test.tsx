/**
 * Ticket 02 结构契约测试：BatchDrawer 与 SessionDrawer 严格同构（A1/A2/A3），
 * 文案使用「列表」而非「会话」；列表级选择与右侧视频行选择独立。
 *
 * 结构等价断言：Batch 侧栏使用与 Session 侧栏相同的结构锚点类名与
 * 交互模型（A1 创建、A2 搜索、A3 行/多选/三点菜单），防止漂移。
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
  BatchDrawer,
  type BatchDrawerProps,
} from "../../src/ui/batch/batch-drawer";
import { createBatchJob } from "../../src/domain";

afterEach(cleanup);

function list(overrides: Partial<Parameters<typeof createBatchJob>[0]> = {}) {
  const job = createBatchJob({
    batchJobId: "list-1",
    browserSessionId: "browser-1",
    createdAt: 1,
    method: "direct",
    sourceKind: "video-pages",
    sourceLabel: "机器学习系列",
    status: "ready",
    updatedAt: 1,
    ...overrides,
  });
  return {
    createdAtLabel: "2026-01-01",
    id: job.batchJobId,
    label: job.name ?? job.sourceLabel ?? "批量列表",
    pinned: false,
    running: job.status === "running" || job.status === "preparing",
    status: job.status,
  };
}

function drawerProps(
  overrides: Partial<BatchDrawerProps> = {},
): BatchDrawerProps {
  return {
    lists: [list()],
    activeListId: "list-1",
    onArchive: vi.fn(),
    onArchiveMany: vi.fn(),
    onDelete: vi.fn(),
    onDeleteMany: vi.fn(),
    onCreateList: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    onTogglePinned: vi.fn(),
    ...overrides,
  };
}

describe("BatchDrawer A1/A2/A3 结构（与 SessionDrawer 同构）", () => {
  it("A1：与 Session 相同的位置与按钮结构，文案为「新建列表」", () => {
    const onCreateList = vi.fn();
    render(<BatchDrawer {...drawerProps({ onCreateList })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    const create = within(
      document.querySelector(".session-drawer__panel")!,
    ).getByRole("button", { name: "新建列表" });
    expect(create.className).toContain("session-drawer__create-session");
    fireEvent.click(create);
    expect(onCreateList).toHaveBeenCalledOnce();
  });

  it("A2：与 Session 相同的搜索结构，文案为「搜索列表」，搜索只过滤列表名称", () => {
    const lists = [
      list(),
      list({ batchJobId: "list-2", sourceLabel: "纪录片合集" }),
    ];
    render(<BatchDrawer {...drawerProps({ lists })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    const panel = document.querySelector(
      ".session-drawer__panel",
    ) as HTMLElement;
    const search = within(panel).getByLabelText("搜索列表");
    expect(search.className).toBe(""); // 与 Session 相同：裸 input
    fireEvent.input(search, { target: { value: "纪录片" } });
    expect(within(panel).getByText("纪录片合集")).toBeDefined();
    expect(within(panel).queryByText("机器学习系列")).toBeNull();
    fireEvent.input(search, { target: { value: "不存在" } });
    expect(within(panel).getByText("没有匹配列表")).toBeDefined();
  });

  it("A3：行结构复用 Session 行锚点：标题、状态槽、三点菜单、多选复选框", () => {
    render(<BatchDrawer {...drawerProps({ activeListId: "list-1" })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    const panel = document.querySelector(
      ".session-drawer__panel",
    ) as HTMLElement;
    const row = panel.querySelector(".session-drawer__row") as HTMLElement;
    expect(row).not.toBeNull();
    expect(panel.querySelector(".session-drawer__state-slot")).not.toBeNull();
    expect(
      within(panel).getByRole("button", { name: "打开列表 机器学习系列" }),
    ).toBeDefined();
    expect(
      within(panel).getByRole("button", { name: "列表操作 机器学习系列" }),
    ).toBeDefined();

    // 进入多选：复选框结构同 Session
    fireEvent.click(within(panel).getByRole("button", { name: "多选" }));
    const checkbox = panel.querySelector<HTMLInputElement>(
      ".session-drawer__checkbox",
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.getAttribute("aria-label")).toBe("选择列表 机器学习系列");
  });

  it("进入列表多选时通知父级暂停右侧修改（选择域隔离）", () => {
    const onListSelectionActiveChange = vi.fn();
    render(<BatchDrawer {...drawerProps({ onListSelectionActiveChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    expect(onListSelectionActiveChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onListSelectionActiveChange).toHaveBeenCalledWith(false);
  });

  it("三点菜单：重命名/置顶/归档/删除，运行中先确认停止", () => {
    const onRename = vi.fn();
    const onTogglePinned = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(
      <BatchDrawer
        {...drawerProps({
          lists: [list({ status: "running" as const })],
          onRename,
          onTogglePinned,
          onArchive,
          onDelete,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    const panel = document.querySelector(
      ".session-drawer__panel",
    ) as HTMLElement;
    fireEvent.click(
      within(panel).getByRole("button", { name: "列表操作 机器学习系列" }),
    );
    fireEvent.click(within(panel).getByRole("menuitem", { name: "重命名" }));
    expect(within(panel).getByText("列表名称")).toBeDefined();
    // 草稿预填当前名称；清空后提交被禁用（不提交）。
    const renameInput = within(panel).getByLabelText(
      "列表名称",
    ) as HTMLInputElement;
    expect(renameInput.value).toBe("机器学习系列");
    fireEvent.input(renameInput, { target: { value: "" } });
    expect(
      (
        within(panel).getByRole("button", {
          name: "保存名称",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.input(renameInput, { target: { value: "新标题" } });
    fireEvent.click(within(panel).getByRole("button", { name: "保存名称" }));
    expect(onRename).toHaveBeenCalledWith("list-1", "新标题");

    fireEvent.click(
      within(panel).getByRole("button", { name: "列表操作 机器学习系列" }),
    );
    fireEvent.click(within(panel).getByRole("menuitem", { name: "置顶" }));
    expect(onTogglePinned).toHaveBeenCalledWith("list-1", true);

    fireEvent.click(
      within(panel).getByRole("button", { name: "列表操作 机器学习系列" }),
    );
    fireEvent.click(within(panel).getByRole("menuitem", { name: "归档" }));
    expect(
      screen.getByText("该列表有正在运行的任务，强制归档会终止任务"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onArchive).toHaveBeenCalledWith("list-1");

    fireEvent.click(
      within(panel).getByRole("button", { name: "列表操作 机器学习系列" }),
    );
    fireEvent.click(within(panel).getByRole("menuitem", { name: "删除" }));
    expect(
      screen.getByText("该列表有正在运行的任务，强制删除会终止任务"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onDelete).toHaveBeenCalledWith("list-1");
  });

  it("列表多选工具栏支持全选/批量归档/批量删除", () => {
    const onArchiveMany = vi.fn();
    const onDeleteMany = vi.fn();
    render(
      <BatchDrawer
        {...drawerProps({
          lists: [
            list(),
            list({ batchJobId: "list-2", sourceLabel: "第二个列表" }),
          ],
          onArchiveMany,
          onDeleteMany,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    const panel = document.querySelector(
      ".session-drawer__panel",
    ) as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "多选" }));
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "选择列表 机器学习系列" }),
    );
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "选择列表 第二个列表" }),
    );
    expect(within(panel).getByText("已选 2")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "批量归档" }));
    expect(onArchiveMany).toHaveBeenCalledWith(["list-1", "list-2"]);
    fireEvent.click(within(panel).getByRole("button", { name: "多选" }));
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "选择列表 机器学习系列" }),
    );
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "选择列表 第二个列表" }),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "批量删除" }));
    expect(screen.getByText("确认删除 2 个列表？")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onDeleteMany).toHaveBeenCalledWith(["list-1", "list-2"]);
  });

  it("空状态区分「暂无列表」与「没有匹配列表」", () => {
    const { rerender } = render(
      <BatchDrawer {...drawerProps({ lists: [] })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开批量列表" }));
    expect(screen.getByText("暂无列表")).toBeDefined();
    rerender(<BatchDrawer {...drawerProps({ lists: [] })} />);
  });
});
