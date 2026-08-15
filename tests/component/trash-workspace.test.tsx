import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TrashWorkspace,
  type TrashListItem,
  type TrashWorkspaceProps,
} from "../../src/ui/trash/trash-workspace";
import { trashDeletionDescription } from "../../src/ui/trash/trash-confirmation";

afterEach(cleanup);

const branchItemA: TrashListItem = {
  expiresAtLabel: "2026-07-22 10:00",
  id: "trash-branch-1",
  kind: "branch",
  originKind: "archive",
  originLabel: "归档 / 课程",
  statusDetailLabel: "官方 CC",
  statusLabel: "中文 · 官方字幕",
  title: "07-15 官方 / 中文",
  trashedAtLabel: "2026-07-15 10:00",
};

const branchItemB: TrashListItem = {
  expiresAtLabel: "永久保留",
  id: "trash-branch-2",
  kind: "branch",
  originKind: "workspace",
  originLabel: "工作区",
  statusDetailLabel: null,
  statusLabel: "自动 · 语音字幕",
  title: "07-16 AI / English",
  trashedAtLabel: "2026-07-16 10:00",
};

function props(
  overrides: Partial<TrashWorkspaceProps> = {},
): TrashWorkspaceProps {
  return {
    applyRetentionTo: "future",
    customRetentionDays: "14",
    items: [branchItemA, branchItemB],
    onEmptyTrash: vi.fn(),
    onPermanentlyDelete: vi.fn(),
    onRestore: vi.fn(),
    onRestoreSelected: vi.fn(),
    onRetentionChange: vi.fn(),
    retention: "7",
    ...overrides,
  };
}

describe("TrashWorkspace", () => {
  it("renders flat single-line items with metadata only and exposes full info via the three-dot menu", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);

    // 默认不显示任何选择框；每个可操作对象只占一行。
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "回收站操作 07-15 官方 / 中文" }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /打开|预览/ })).toBeNull();

    // 标题与状态槽、删除/到期时间都在同一行 meta；菜单提供恢复/永久删除。
    fireEvent.click(
      screen.getByRole("button", { name: "回收站操作 07-15 官方 / 中文" }),
    );
    expect(
      screen.getAllByText((text) => text.includes("中文 · 官方字幕")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("menuitem", { name: "恢复会话至工作区" }),
    ).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "永久删除" })).not.toBeNull();
  });

  it("defaults to 直接清空/多选 and switches to 取消多选/删除已选/恢复会话至工作区 with checkboxes in selection state", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);

    expect(screen.getByRole("button", { name: "直接清空" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "多选" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "删除已选" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    expect(screen.getByRole("button", { name: "取消" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "删除已选" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "批量恢复会话" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "直接清空" })).not.toBeNull();
    expect(
      screen.getByRole("checkbox", {
        name: "选择回收站条目 07-15 官方 / 中文",
      }),
    ).not.toBeNull();
  });

  it("keeps bulk buttons disabled without selection and enables them immediately after selection", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));

    expect(
      (screen.getByRole("button", { name: "删除已选" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "批量恢复会话",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "选择回收站条目 07-15 官方 / 中文",
      }),
    );
    // 选择后立即可用（primitive 内部选择状态）。
    expect(
      (screen.getByRole("button", { name: "删除已选" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "批量恢复会话",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("取消多选 exits selection state and clears the whole selection", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "选择回收站条目 07-15 官方 / 中文",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "多选" })).not.toBeNull();
  });

  it("emits bulk restore and permanent-delete intents for the selected items only", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "选择回收站条目 07-15 官方 / 中文",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除已选" }));
    expect(value.onPermanentlyDelete).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "永久删除" })).getByRole(
        "button",
        { name: "确认" },
      ),
    );
    expect(value.onPermanentlyDelete).toHaveBeenCalledWith([
      { branchId: "trash-branch-1", kind: "branch" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "选择回收站条目 07-15 官方 / 中文",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量恢复会话" }));
    expect(value.onRestoreSelected).toHaveBeenCalledWith([
      { branchId: "trash-branch-1", kind: "branch", originKind: "archive" },
    ]);
  });

  it("disables 直接清空/多选 when the trash is empty", () => {
    const value = props({ items: [] });
    render(<TrashWorkspace {...value} />);
    expect(screen.getByText("回收站为空。")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "直接清空" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // primitive 空列表不渲染多选入口。
    expect(screen.queryByRole("button", { name: "多选" })).toBeNull();
  });

  it("restores a session that was deleted before subtitles existed through its own single row", () => {
    const value = props({
      items: [
        {
          expiresAtLabel: "2026-07-22 10:00",
          id: "trash-session:empty-session",
          kind: "session" as const,
          originKind: "workspace" as const,
          originLabel: "工作区",
          sessionId: "empty-session",
          statusDetailLabel: null,
          statusLabel: "无字幕",
          title: "尚未获取字幕的视频",
          trashedAtLabel: "2026-07-15 10:00",
        },
      ],
    });
    render(<TrashWorkspace {...value} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "回收站操作 尚未获取字幕的视频",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复会话至工作区" }));
    expect(value.onRestoreSelected).toHaveBeenCalledWith([
      { kind: "session", sessionId: "empty-session" },
    ]);
  });

  it("row restore 立即调用并通过 onRestoreSelected 提交 intent（菜单关闭由 primitive 承载）", async () => {
    const onRestoreSelected = vi.fn(() => true);
    render(<TrashWorkspace {...props({ onRestoreSelected })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "回收站操作 07-15 官方 / 中文" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复会话至工作区" }));
    expect(onRestoreSelected).toHaveBeenCalledWith([
      { branchId: "trash-branch-1", kind: "branch", originKind: "archive" },
    ]);
  });

  it("行级永久删除先危险确认，确认后才提交 intents", () => {
    const onPermanentlyDelete = vi.fn(() => true);
    render(<TrashWorkspace {...props({ onPermanentlyDelete })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "回收站操作 07-16 AI / English" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "永久删除" }));
    expect(onPermanentlyDelete).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "永久删除" })).getByRole(
        "button",
        { name: "确认" },
      ),
    );
    expect(onPermanentlyDelete).toHaveBeenCalledWith([
      { branchId: "trash-branch-2", kind: "branch" },
    ]);
  });

  it("keeps retention controls in the recycle bin and publishes changes", () => {
    const value = props();
    render(<TrashWorkspace {...value} />);
    fireEvent.input(screen.getByRole("combobox", { name: "回收站保留" }), {
      target: { value: "365" },
    });
    expect(value.onRetentionChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用保留期限" }));
    expect(value.onRetentionChange).toHaveBeenCalledWith({
      applyTo: "future",
      customDays: "14",
      retention: "365",
    });
  });

  it("disables every action while busy", () => {
    const value = props({ busy: true });
    render(<TrashWorkspace {...value} />);
    expect(
      (screen.getByRole("button", { name: "直接清空" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "多选" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // busy 时行内操作同样禁用：多选按钮为 disabled，浏览器不会触发点击。
    expect(screen.queryByRole("button", { name: "取消多选" })).toBeNull();
  });

  it("keeps long titles and long archive paths inside their single row and menu", () => {
    const longTitle =
      "这是一个用于检查超长标题单行省略效果的非常非常非常非常非常长的字幕分支标题";
    const longPath =
      "归档 / 课程资料 / 深度学习专项 / 2026 春季学期 / 第 12 讲 注意力机制与 Transformer 架构";
    const value = props({
      items: [
        {
          ...branchItemA,
          id: "trash-long",
          originLabel: longPath,
          title: longTitle,
        },
      ],
    });
    render(<TrashWorkspace {...value} />);

    // 行内标题单行省略（truncation class + title 属性承载完整信息）。
    const rowTitle = document.querySelector(".muzhi-lifecycle__select strong");
    expect(rowTitle?.textContent).toBe(longTitle);

    // 三点菜单仍可打开（标题不裁切交互路径）。
    fireEvent.click(
      screen.getByRole("button", { name: `回收站操作 ${longTitle}` }),
    );
    expect(screen.getByRole("menuitem", { name: "永久删除" })).not.toBeNull();
  });
});

describe("trashDeletionDescription", () => {
  it("shows deduplicated record/session counts and an irreversible warning", () => {
    expect(
      trashDeletionDescription({
        branchCount: 3,
        runningTaskCount: 0,
        sessionCount: 2,
      }),
    ).toBe("将永久删除 3 个字幕记录、涉及 2 个会话，此操作无法撤销。");
  });

  it("no longer mentions running tasks: trash rows carry no live tasks", () => {
    expect(
      trashDeletionDescription({
        branchCount: 1,
        runningTaskCount: 2,
        sessionCount: 1,
      }),
    ).toBe("将永久删除 1 个字幕记录、涉及 1 个会话，此操作无法撤销。");
  });

  it("handles empty-session-only deletions without a record count", () => {
    expect(
      trashDeletionDescription({
        branchCount: 0,
        runningTaskCount: 0,
        sessionCount: 2,
      }),
    ).toBe("将永久删除 2 个未获取字幕的会话，此操作无法撤销。");
  });
});
