import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArchiveWorkspace,
  type ArchiveSessionProjectionView,
  type ArchiveWorkspaceProps,
} from "../../src/ui/archive/archive-workspace";

afterEach(cleanup);

const sessions: readonly ArchiveSessionProjectionView[] = [
  {
    archivedAtLabel: "2026/7/15 10:00",
    branchIds: ["branch-1"],
    id: "session-1",
    kind: "session",
    statusDetailLabel: "官方 CC",
    statusLabel: "中文 · 官方字幕",
    tagIds: ["tag-1"],
    title: "程序查询方式",
  },
  {
    archivedAtLabel: "2026/7/16 11:00",
    branchIds: ["branch-2"],
    id: "session-2",
    kind: "session",
    statusDetailLabel: null,
    statusLabel: "自动 · 无字幕",
    tagIds: ["tag-2"],
    title: "中断控制方式",
  },
  {
    archivedAtLabel: "2026/7/17 12:00",
    branchIds: ["branch-3"],
    id: "session-3",
    kind: "session",
    statusDetailLabel: null,
    statusLabel: "自动 · 官方字幕",
    tagIds: ["tag-1", "tag-2"],
    title: "DMA 方式",
  },
];

const tags = [
  { count: 2, name: "考试", tagId: "tag-1" },
  { count: 2, name: "复习", tagId: "tag-2" },
];

describe("ArchiveWorkspace", () => {
  function props(
    overrides: Partial<ArchiveWorkspaceProps> = {},
  ): ArchiveWorkspaceProps {
    return {
      onCreateTag: vi.fn(),
      onDeleteSessionProjection: vi.fn(),
      onDeleteSessionProjectionMany: vi.fn(),
      onDeleteTag: vi.fn(),
      onMoveTag: vi.fn(),
      onOpenSession: vi.fn(),
      onRenameSession: vi.fn(),
      onRenameTag: vi.fn(),
      onRestoreToWorkspace: vi.fn(),
      onRestoreToWorkspaceMany: vi.fn(),
      onSelectedBranchIdsChange: vi.fn(),
      onSetSessionTags: vi.fn(),
      selectedBranchIds: [],
      sessions,
      tagCount: tags.length,
      tags,
      ...overrides,
    };
  }

  it("渲染扁平会话列表：标题、状态槽、编辑标签按钮与三点菜单", () => {
    render(<ArchiveWorkspace {...props()} />);
    expect(screen.getByText("程序查询方式")).not.toBeNull();
    expect(screen.getByText("中断控制方式")).not.toBeNull();
    expect(
      screen.getByText((text) => text.includes("中文 · 官方字幕")),
    ).not.toBeNull();
    // 归档时间直接显示在卡片状态槽行（用户验收要求）
    expect(
      screen.getByText((text) => text.includes("归档于 2026/7/15 10:00")),
    ).not.toBeNull();
    expect(screen.getAllByTitle("编辑标签").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(
      screen.getByRole("button", { name: "归档操作 程序查询方式" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "恢复会话至工作区" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "删除归档会话" }),
    ).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "重命名" })).not.toBeNull();
  });

  it("卡片编辑面板：紧贴卡片展开（非底部对话框），勾选/清空/确定", async () => {
    const onSetSessionTags = vi.fn();
    render(<ArchiveWorkspace {...props({ onSetSessionTags })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "编辑标签 程序查询方式" }),
    );
    // 面板在卡片内展开（与三点菜单同款框架）
    const panel = screen.getByLabelText("编辑标签");
    expect(panel.closest("li")).not.toBeNull();
    const exam = within(panel).getByLabelText(/考试/);
    expect((exam as HTMLInputElement).checked).toBe(true);

    // 取消勾选「考试」
    fireEvent.click(exam);
    expect((exam as HTMLInputElement).checked).toBe(false);

    // 勾选「复习」
    const review = within(panel).getByLabelText(/复习/);
    fireEvent.click(review);
    expect((review as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(panel).getByRole("button", { name: "确定" }));
    expect(onSetSessionTags).toHaveBeenCalledWith("session-1", ["tag-2"]);
  });

  it("搜索框与标签筛选取交集：只显示同时满足的会话", () => {
    render(<ArchiveWorkspace {...props()} />);

    // 搜索「DMA」→ 只剩 session-3
    fireEvent.input(screen.getByLabelText("搜索会话标题"), {
      target: { value: "DMA" },
    });
    expect(screen.getByText("DMA 方式")).not.toBeNull();
    expect(screen.queryByText("程序查询方式")).toBeNull();

    // 勾选「考试」（默认多选筛选）→ 与搜索取交集（DMA 有考试标签）
    fireEvent.click(screen.getByRole("button", { name: /考试 \(2\)/ }));
    expect(screen.getByText("DMA 方式")).not.toBeNull();

    // 勾选「复习」→ DMA 同时拥有两标签 → 仍在交集内
    fireEvent.click(screen.getByRole("button", { name: /复习 \(2\)/ }));
    expect(screen.getByText("DMA 方式")).not.toBeNull();

    // 换搜索词 → 无匹配 → 空态文案
    fireEvent.input(screen.getByLabelText("搜索会话标题"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配的归档会话")).not.toBeNull();
  });

  it("标签计数显示在紧凑筛选 toolbar", () => {
    render(<ArchiveWorkspace {...props()} />);
    expect(screen.getByRole("button", { name: /考试 \(2\)/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /复习 \(2\)/ })).not.toBeNull();
  });

  it("默认多选筛选：点标签切换多选，交集过滤", () => {
    render(<ArchiveWorkspace {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /考试 \(2\)/ }));
    expect(
      screen
        .getByRole("button", { name: /考试 \(2\)/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // 再点「复习」→ 多选（两个都选中）
    fireEvent.click(screen.getByRole("button", { name: /复习 \(2\)/ }));
    expect(
      screen
        .getByRole("button", { name: /复习 \(2\)/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // 再点「考试」→ 取消选中（多选切换）
    fireEvent.click(screen.getByRole("button", { name: /考试 \(2\)/ }));
    expect(
      screen
        .getByRole("button", { name: /考试 \(2\)/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("管理标签面板：未选中时按钮禁用，选中后重命名可用", () => {
    const onRenameTag = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onRenameTag })} />);
    fireEvent.click(screen.getByRole("button", { name: "管理标签" }));
    const panel = screen.getByLabelText("管理标签");
    const renameBtn = within(panel).getByRole("button", { name: "重命名" });
    const deleteBtn = within(panel).getByRole("button", { name: "删除" });
    // 未选中：按钮禁用（灰色）
    expect((renameBtn as HTMLButtonElement).disabled).toBe(true);
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
    // 点击标签（单选）→ 按钮亮起
    fireEvent.click(within(panel).getByRole("option", { name: /考试/ }));
    expect((renameBtn as HTMLButtonElement).disabled).toBe(false);
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
    // 重命名
    fireEvent.click(renameBtn);
    fireEvent.input(screen.getByLabelText("重命名 考试"), {
      target: { value: "冲刺" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRenameTag).toHaveBeenCalledWith("tag-1", "冲刺");
  });

  it("管理标签面板：删除需确认后调用 onDeleteTag", () => {
    const onDeleteTag = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onDeleteTag })} />);
    fireEvent.click(screen.getByRole("button", { name: "管理标签" }));
    const panel = screen.getByLabelText("管理标签");
    fireEvent.click(within(panel).getByRole("option", { name: /考试/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "删除" }));
    // 确认条出现，未确认不删
    expect(onDeleteTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDeleteTag).toHaveBeenCalledWith("tag-1");
  });

  it("多选态：已选计数、全选所有、批量编辑与恢复", () => {
    const onRestoreToWorkspaceMany = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onRestoreToWorkspaceMany })} />);

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 程序查询方式" }),
    );
    expect(screen.getByText("已选 1")).not.toBeNull();

    // 全选筛选结果
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 3")).not.toBeNull();

    // 批量恢复（选中 3 个会话 → 全部 branchIds，空会话组为空）
    fireEvent.click(screen.getByRole("button", { name: "批量恢复会话" }));
    expect(onRestoreToWorkspaceMany).toHaveBeenCalledWith(
      ["branch-1", "branch-2", "branch-3"],
      [],
    );
  });

  it("批量编辑标签：替换式写入所有选中会话", () => {
    const onSetSessionTags = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onSetSessionTags })} />);

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 程序查询方式" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 中断控制方式" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量编辑标签" }));
    const dialog = screen.getByRole("dialog", { name: "批量编辑标签" });
    fireEvent.click(within(dialog).getByRole("button", { name: "批量应用" }));
    expect(onSetSessionTags).toHaveBeenCalledTimes(2);
    expect(onSetSessionTags).toHaveBeenCalledWith("session-1", []);
    expect(onSetSessionTags).toHaveBeenCalledWith("session-2", []);
  });

  it("删除确认：多选删除调用 onDeleteSessionProjectionMany", () => {
    const onDeleteSessionProjectionMany = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onDeleteSessionProjectionMany })} />);

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 中断控制方式" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量移入回收站" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除归档会话？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(onDeleteSessionProjectionMany).toHaveBeenCalledWith(
      ["branch-2"],
      [],
    );
  });

  it("多选删除混合空会话：空会话不再被跳过（branchIds 与 emptySessionIds 分开传）", () => {
    const onDeleteSessionProjectionMany = vi.fn(() => true);
    const withEmptySession: ArchiveSessionProjectionView = {
      archivedAtLabel: "2026/7/17 12:00",
      branchIds: [],
      id: "session-empty",
      kind: "session",
      statusDetailLabel: null,
      statusLabel: "自动 · 无字幕",
      tagIds: [],
      title: "空会话",
    };
    render(
      <ArchiveWorkspace
        {...props({
          onDeleteSessionProjectionMany,
          sessions: [...sessions, withEmptySession],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 程序查询方式" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "选择会话 空会话" }));
    fireEvent.click(screen.getByRole("button", { name: "批量移入回收站" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除归档会话？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    // 有分支会话与空会话都进入同一个 action：空会话不再被静默跳过。
    expect(onDeleteSessionProjectionMany).toHaveBeenCalledWith(
      ["branch-1"],
      ["session-empty"],
    );
  });

  it("多选恢复混合空会话：branchIds 与 emptySessionIds 分组传入", () => {
    const onRestoreToWorkspaceMany = vi.fn(() => true);
    const withEmptySession: ArchiveSessionProjectionView = {
      archivedAtLabel: "2026/7/17 12:00",
      branchIds: [],
      id: "session-empty",
      kind: "session",
      statusDetailLabel: null,
      statusLabel: "自动 · 无字幕",
      tagIds: [],
      title: "空会话",
    };
    render(
      <ArchiveWorkspace
        {...props({
          onRestoreToWorkspaceMany,
          sessions: [...sessions, withEmptySession],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择会话 程序查询方式" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "选择会话 空会话" }));
    fireEvent.click(screen.getByRole("button", { name: "批量恢复会话" }));
    expect(onRestoreToWorkspaceMany).toHaveBeenCalledWith(
      ["branch-1"],
      ["session-empty"],
    );
  });

  it("单条恢复空会话：调用 Many 方法并传入 emptySessionIds", () => {
    const onRestoreToWorkspaceMany = vi.fn(() => true);
    const withEmptySession: ArchiveSessionProjectionView = {
      archivedAtLabel: "2026/7/17 12:00",
      branchIds: [],
      id: "session-empty",
      kind: "session",
      statusDetailLabel: null,
      statusLabel: "自动 · 无字幕",
      tagIds: [],
      title: "空会话",
    };
    render(
      <ArchiveWorkspace
        {...props({
          onRestoreToWorkspaceMany,
          sessions: [...sessions, withEmptySession],
        })}
      />,
    );

    // 行菜单 → 恢复
    fireEvent.click(screen.getByRole("button", { name: "归档操作 空会话" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复会话至工作区" }));
    expect(onRestoreToWorkspaceMany).toHaveBeenCalledWith(
      [],
      ["session-empty"],
    );
  });

  it("新建标签：按钮与 Enter 都调用 onCreateTag", () => {
    const onCreateTag = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onCreateTag })} />);
    fireEvent.click(screen.getByRole("button", { name: "管理标签" }));
    const input = screen.getByLabelText("新标签名称");
    // 按钮
    fireEvent.input(input, { target: { value: "冲刺" } });
    fireEvent.click(screen.getByRole("button", { name: "添加标签" }));
    expect(onCreateTag).toHaveBeenCalledWith("冲刺");
    // Enter
    fireEvent.input(input, { target: { value: "模拟" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateTag).toHaveBeenCalledWith("模拟");
    // 空输入不触发
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateTag).toHaveBeenCalledTimes(2);
  });

  it("管理面板删除筛选中的标签：同步清除筛选，不残留空筛选", () => {
    const onDeleteTag = vi.fn(() => true);
    render(<ArchiveWorkspace {...props({ onDeleteTag })} />);
    // 主面板选中「考试」作为筛选
    fireEvent.click(screen.getByRole("button", { name: /考试 \(2\)/ }));
    expect(
      screen
        .getByRole("button", { name: /考试 \(2\)/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // 管理面板删除「考试」→ 确认
    fireEvent.click(screen.getByRole("button", { name: "管理标签" }));
    const panel = screen.getByLabelText("管理标签");
    fireEvent.click(within(panel).getByRole("option", { name: /考试/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDeleteTag).toHaveBeenCalledWith("tag-1");
    // 筛选集合同步清除：主面板 chip 不再选中
    expect(
      screen
        .getByRole("button", { name: /考试 \(2\)/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("无标签态：标签面板提示可新建", () => {
    render(<ArchiveWorkspace {...props({ tags: [], tagCount: 0 })} />);
    expect(screen.getByText(/还没有标签/)).not.toBeNull();
    // CRUD 入口在二级标签管理 surface。
    fireEvent.click(screen.getByRole("button", { name: "管理标签" }));
    expect(screen.getByLabelText("新标签名称")).not.toBeNull();
  });

  it("用量显示：标签 x/200 反映当前标签数", () => {
    render(<ArchiveWorkspace {...props({ tagCount: 3 })} />);
    expect(screen.getByText(/标签 3\/200/)).not.toBeNull();
  });
});

function within(element: HTMLElement) {
  return {
    getByLabelText: (text: string | RegExp): HTMLElement => {
      const labeled = element.querySelectorAll("[aria-label]");
      for (const el of labeled) {
        const label = el.getAttribute("aria-label") ?? "";
        if (
          (typeof text === "string" && label.includes(text)) ||
          (typeof text !== "string" && text.test(label))
        ) {
          return el as HTMLElement;
        }
      }
      const labels = element.querySelectorAll("label");
      for (const label of labels) {
        const textContent = label.textContent ?? "";
        if (
          (typeof text === "string" && textContent.includes(text)) ||
          (typeof text !== "string" && text.test(textContent))
        ) {
          const input = label.querySelector("input");
          if (input) return input;
        }
      }
      throw new Error(`label not found: ${String(text)}`);
    },
    getByRole: (
      role: string,
      options: { name?: string | RegExp } = {},
    ): HTMLElement => {
      const selector = role === "button" ? "button" : `[role="${role}"]`;
      const elements = element.querySelectorAll(selector);
      for (const el of elements) {
        const textContent = el.textContent ?? "";
        const name = options.name;
        if (
          name === undefined ||
          (typeof name === "string" && textContent.includes(name)) ||
          (typeof name !== "string" && name.test(textContent))
        ) {
          return el as HTMLElement;
        }
      }
      throw new Error(`role not found: ${role} ${options.name ?? ""}`);
    },
  };
}
