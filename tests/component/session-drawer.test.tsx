import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession, createVideoKey, type Session } from "../../src/domain";
import { SessionDrawer } from "../../src/ui/session-drawer";

afterEach(cleanup);

function createTestSession(
  sessionId: string,
  title: string,
  page: number,
): Session {
  const timestamp = page * 1_000;
  return createSession({
    activeBranchId: null,
    createdAt: timestamp,
    customTitle: false,
    lastActivityAt: timestamp,
    selectionRevision: 0,
    sessionId,
    title,
    updatedAt: timestamp,
    videoKey: createVideoKey({
      bvid: "BV1Q541167Qg",
      cid: 30_000_000_000 + page,
      page,
    }),
  });
}

function renderDrawer(
  overrides: Partial<Parameters<typeof SessionDrawer>[0]> = {},
) {
  const first = createTestSession("session-first", "第一集", 1);
  const second = createTestSession("session-second", "第二集", 2);
  const props = {
    activeSessionId: first.sessionId,
    indicators: {
      [first.sessionId]: { running: false, unread: true },
      [second.sessionId]: { running: true, unread: false },
    },
    onArchive: vi.fn(),
    onBindCurrent: vi.fn(),
    onBindIdentifier: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    sessions: [second, first],
    ...overrides,
  };
  render(<SessionDrawer {...props} />);
  return { first, props, second };
}

function openSessionMenu(title: string): void {
  fireEvent.click(screen.getByRole("button", { name: `会话操作 ${title}` }));
}

describe("SessionDrawer", () => {
  it("keeps a mounted drawer controllable and closes it with Escape", () => {
    renderDrawer();
    const toggle = screen.getByRole("button", { name: "打开会话" });
    const drawer = screen.getByRole("complementary", { name: "会话" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(drawer.classList.contains("is-open")).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(drawer.classList.contains("is-open")).toBe(true);
    expect(
      document.activeElement?.classList.contains("session-drawer__close"),
    ).toBe(true);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "会话操作 第一集" }),
    );
    fireEvent.keyDown(document, { key: "Tab" });
    expect(
      document.activeElement?.classList.contains("session-drawer__close"),
    ).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("filters by title or exact video identity and selects a visible session", () => {
    const { props, second } = renderDrawer();
    const search = screen.getByRole("searchbox", { name: "搜索会话" });

    fireEvent.input(search, { target: { value: "第二" } });

    expect(
      screen.queryByRole("button", { name: "打开会话 第一集" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开会话 第二集" }));
    expect(props.onSelect).toHaveBeenCalledWith(second.sessionId);

    fireEvent.input(search, {
      target: { value: "cid:30000000001:p:1" },
    });
    expect(
      screen.getByRole("button", { name: "打开会话 第一集" }),
    ).not.toBeNull();
  });

  it("publishes the new-session intent without rendering page-binding controls in the navigation", () => {
    const onCreateSession = vi.fn();
    const { props } = renderDrawer({ onCreateSession });

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

    expect(onCreateSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "同步当前页面" })).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "BV 号或完整 URL" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "打开视频会话" })).toBeNull();
    expect(props.onBindCurrent).not.toHaveBeenCalled();
    expect(props.onBindIdentifier).not.toHaveBeenCalled();
  });

  it("publishes the two top workspace modes and marks batch mode active independently of footer tools", () => {
    const onOpenBatch = vi.fn();
    const onOpenSessionMode = vi.fn();
    renderDrawer({
      activeWorkspaceMode: "batch",
      onOpenBatch,
      onOpenSessionMode,
    });

    const navigation = screen.getByRole("navigation", { name: "工作区模式" });
    const batch = screen.getByRole("button", { name: "批量模式" });
    expect(navigation.contains(batch)).toBe(true);
    expect(batch.getAttribute("aria-current")).toBe("page");
    expect(batch.closest("nav")?.getAttribute("aria-label")).toBe("工作区模式");

    fireEvent.click(screen.getByRole("button", { name: "会话模式" }));
    expect(onOpenSessionMode).toHaveBeenCalledOnce();
    expect(onOpenBatch).not.toHaveBeenCalled();
  });

  it("shows a short batch-mode hint instead of the removed resident guide", () => {
    renderDrawer({ activeWorkspaceMode: "batch" });

    expect(screen.getByText("在批量工作区创建并管理列表。")).not.toBeNull();
    expect(document.querySelector(".session-drawer__batch-steps")).toBeNull();
  });

  it("switches workspace mode with horizontal arrow keys", () => {
    const onOpenBatch = vi.fn();
    const onOpenSessionMode = vi.fn();
    renderDrawer({
      activeWorkspaceMode: "session",
      onOpenBatch,
      onOpenSessionMode,
    });
    const session = screen.getByRole("button", { name: "会话模式" });
    fireEvent.keyDown(session.closest("nav")!, { key: "ArrowRight" });
    expect(onOpenBatch).toHaveBeenCalledOnce();
    expect(onOpenSessionMode).not.toHaveBeenCalled();
  });

  it("uses a compact directional handle for the collapsed session drawer", () => {
    renderDrawer();

    const toggle = screen.getByRole("button", { name: "打开会话" });
    expect(toggle.textContent).toBe("›");
  });

  it("exposes running and unread session state without changing the title", () => {
    const { first, second } = renderDrawer();
    expect(
      screen.getByLabelText(`${first.title} 有未读结果`).classList,
    ).toContain("is-unread");
    expect(
      screen.getByLabelText(`${second.title} 有任务正在运行`).classList,
    ).toContain("is-running");
  });

  it("opens a compact menu with visible text actions and icons", () => {
    const { first } = renderDrawer({
      onTogglePinned: vi.fn(),
      pinnedSessionIds: [],
    });
    const menu = screen.getByRole("button", {
      name: `会话操作 ${first.title}`,
    });
    expect(menu.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(menu);

    const expectations = [
      ["重命名", "pencil"],
      ["归档", "archive"],
      ["置顶", "pin"],
      ["删除", "trash"],
    ] as const;
    for (const [label, icon] of expectations) {
      const button = screen.getByRole("menuitem", { name: label });
      expect(button.textContent).toContain(label);
      expect(button.querySelector("svg")?.getAttribute("data-icon")).toBe(icon);
    }
  });

  it("groups the destructive menu action after a separator", () => {
    const fullTitle = "会话操作层级";
    const session = createTestSession("session-action-layout", fullTitle, 5);
    renderDrawer({
      activeSessionId: session.sessionId,
      onTogglePinned: vi.fn(),
      pinnedSessionIds: [],
      sessions: [session],
    });
    openSessionMenu(fullTitle);
    const menu = screen.getByRole("menu", { name: `会话操作 ${fullTitle}` });
    const separator = menu.querySelector(".muzhi-compact-menu__separator");
    const remove = screen.getByRole("menuitem", { name: "删除" });
    expect(separator).not.toBeNull();
    expect(separator?.nextElementSibling).toBe(remove);
    expect(remove.classList).toContain("is-danger");
  });

  it("publishes trimmed rename intent and supports cancellation", () => {
    const { first, props } = renderDrawer();
    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "会话名称" });
    fireEvent.input(input, { target: { value: "  新标题  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    expect(props.onRename).toHaveBeenCalledWith(first.sessionId, "新标题");

    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    fireEvent.click(screen.getByRole("button", { name: "取消重命名" }));
    expect(screen.queryByRole("textbox", { name: "会话名称" })).toBeNull();
  });

  it("archives any workspace session, including one without subtitles yet", () => {
    const { first, props, second } = renderDrawer();
    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(props.onArchive).toHaveBeenCalledWith(first.sessionId);

    openSessionMenu(second.title);
    const archiveEmptySession = screen.getByRole("menuitem", {
      name: "归档",
    }) as HTMLButtonElement;
    expect(archiveEmptySession.disabled).toBe(false);
    fireEvent.click(archiveEmptySession);
    // 有运行任务：先确认（任务终止提示），再归档。
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onArchive).toHaveBeenCalledWith(second.sessionId);
  });

  it("requires a focused modal alertdialog before deletion with safe initial focus", () => {
    const { first, props } = renderDrawer();
    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认删除？" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toBe("确认删除？取消确认");
    expect(
      screen
        .getByRole("button", { name: `打开会话 ${first.title}` })
        .closest("li")
        ?.contains(dialog),
    ).toBe(false);
    expect(props.onDelete).not.toHaveBeenCalled();
    // danger dialog 默认焦点不在危险按钮（取消在前）。
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "取消" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onDelete).toHaveBeenCalledWith(first.sessionId);
  });

  it("selects multiple workspace sessions and publishes one batch archive", () => {
    const onArchiveMany = vi.fn();
    const { first, second } = renderDrawer({
      onArchiveMany,
      onDeleteMany: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    expect(
      screen.queryByRole("button", { name: `会话操作 ${first.title}` }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择 ${first.title}` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `选择会话 ${second.title}` }),
    );
    expect(screen.getByText("已选 2")).not.toBeNull();

    const archive = screen.getByRole("button", { name: "批量归档" });
    expect(archive.getAttribute("title")).toBe("批量归档");
    fireEvent.click(archive);
    // second 有运行任务：先弹确认框再归档。
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onArchiveMany).toHaveBeenCalledWith([
      first.sessionId,
      second.sessionId,
    ]);
    expect(screen.queryByText("已选 2")).toBeNull();
  });

  it("keeps the count and multiselect controls in the frozen two-row layout", () => {
    renderDrawer({ onArchiveMany: vi.fn(), onDeleteMany: vi.fn() });

    const count = screen.getByText("2 个会话");
    const enter = screen.getByRole("button", { name: "多选" });
    expect(count.parentElement).toBe(enter.parentElement);

    fireEvent.click(enter);
    const cancel = screen.getByRole("button", { name: "取消" });
    const selectAll = screen.getByRole("button", { name: "全选" });
    const selectedCount = screen.getByText("已选 0");
    const archive = screen.getByRole("button", { name: "批量归档" });
    const remove = screen.getByRole("button", { name: "批量删除" });

    expect(count.parentElement).toBe(cancel.parentElement);
    expect(selectAll.parentElement).toBe(selectedCount.parentElement);
    expect(selectAll.parentElement).toBe(archive.parentElement);
    expect(selectAll.parentElement).toBe(remove.parentElement);
    expect(selectAll.parentElement).not.toBe(count.parentElement);
    expect(archive.hasAttribute("disabled")).toBe(true);
    expect(remove.hasAttribute("disabled")).toBe(true);
  });

  it("supports select-all, clear, and one modal batch deletion", () => {
    const onDeleteMany = vi.fn();
    const { first, second } = renderDrawer({
      onArchiveMany: vi.fn(),
      onDeleteMany,
    });

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 2")).not.toBeNull();
    expect(
      (
        screen.getByRole("checkbox", {
          name: `选择 ${first.title}`,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "取消全选" }));
    expect(screen.getByText("已选 0")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));

    expect(
      screen.getByRole("alertdialog", { name: "确认删除 2 个会话？" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onDeleteMany).toHaveBeenCalledWith([
      second.sessionId,
      first.sessionId,
    ]);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps the rename draft when persistence fails", async () => {
    const onRename = vi.fn(async () => false);
    const { first } = renderDrawer({ onRename });

    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const rename = screen.getByRole("textbox", { name: "会话名称" });
    fireEvent.input(rename, { target: { value: "保留的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "会话名称",
          }) as HTMLInputElement
        ).value,
      ).toBe("保留的草稿"),
    );

    fireEvent.click(screen.getByRole("button", { name: "取消重命名" }));
    expect(onRename).toHaveBeenCalledWith(first.sessionId, "保留的草稿");
  });

  it("uses accessible SVG icons for archive, trash, settings, and rename without wrapping labels", () => {
    const onOpenArchive = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenTrash = vi.fn();
    renderDrawer({ onOpenArchive, onOpenSettings, onOpenTrash });

    const footer = screen.getByRole("navigation", { name: "工作区工具" });
    expect(footer.textContent).toBe("");
    expect(footer.querySelector('[data-icon="archive"]')).not.toBeNull();
    expect(footer.querySelector('[data-icon="trash"]')).not.toBeNull();
    expect(footer.querySelector('[data-icon="settings"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开归档区" }));
    expect(onOpenArchive).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
    openSessionMenu("第一集");
    const rename = screen.getByRole("menuitem", { name: "重命名" });
    expect(rename.textContent).toContain("重命名");
    expect(rename.querySelector('[data-icon="pencil"]')).not.toBeNull();
  });

  it("keeps the row title-only and anchors the compact menu without expanding the row", () => {
    const { first } = renderDrawer();

    expect(screen.queryByText(first.videoKey)).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull();
    const menu = screen.getByRole("button", {
      name: `会话操作 ${first.title}`,
    });
    expect(menu.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector(".session-drawer__expanded-title"),
    ).toBeNull();
    const actions = screen.getByRole("menu", {
      name: `会话操作 ${first.title}`,
    });
    expect(actions.querySelectorAll("button[role='menuitem']")).toHaveLength(3);
    expect(
      actions.querySelector(".muzhi-compact-menu__separator"),
    ).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "重命名" })).not.toBeNull();
  });

  it("shows pinned and unpinned sections and publishes reversible pin intents", () => {
    const onTogglePinned = vi.fn();
    const firstSession = createTestSession("session-first", "第一集", 1);
    const secondSession = createTestSession("session-second", "第二集", 2);
    const { first, second } = renderDrawer({
      onTogglePinned,
      pinnedSessionIds: ["session-second"],
      sessions: [firstSession, secondSession],
    });

    const pinned = screen.getByRole("list", { name: "置顶会话" });
    const others = screen.getByRole("list", { name: "其他会话" });
    expect(pinned.textContent).toContain(second.title);
    expect(pinned.textContent).not.toContain(first.title);
    expect(others.textContent).toContain(first.title);

    openSessionMenu(second.title);
    const unpin = screen.getByRole("menuitem", { name: "取消置顶" });
    expect(unpin.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "pin-off",
    );
    fireEvent.click(unpin);
    expect(onTogglePinned).toHaveBeenCalledWith(second.sessionId, false);

    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(onTogglePinned).toHaveBeenCalledWith(first.sessionId, true);
  });

  it("publishes drag reorder within a pin section", () => {
    const onReorder = vi.fn();
    const { first, second } = renderDrawer({ onReorder });
    const firstRow = screen
      .getByRole("button", { name: `打开会话 ${first.title}` })
      .closest("li");
    const secondRow = screen
      .getByRole("button", { name: `打开会话 ${second.title}` })
      .closest("li");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    fireEvent.dragStart(secondRow!);
    fireEvent.dragOver(firstRow!);
    fireEvent.drop(firstRow!);

    expect(onReorder).toHaveBeenCalledWith(second.sessionId, first.sessionId);
  });

  it("warns about running tasks before deleting a session and terminates on confirm", () => {
    const { props, second } = renderDrawer();
    openSessionMenu(second.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认删除？" });
    expect(dialog.textContent).toContain(
      "该会话有正在运行的任务，强制删除会终止任务",
    );
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onDelete).toHaveBeenCalledWith(second.sessionId);
  });

  it("lists running-task session titles in the multi-delete confirmation", () => {
    const { first, props, second } = renderDrawer({
      onArchiveMany: vi.fn(),
      onDeleteMany: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择 ${first.title}` }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择 ${second.title}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "确认删除 2 个会话？",
    });
    expect(dialog.textContent).toContain(second.title);
    expect(dialog.textContent).toContain("以下会话有正在运行的任务");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onDeleteMany).toHaveBeenCalledWith([
      first.sessionId,
      second.sessionId,
    ]);
  });

  it("confirms archiving only when a session runs tasks, then archives on confirm", () => {
    const { first, props, second } = renderDrawer();
    // 无任务会话直接归档，不弹框。
    openSessionMenu(first.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onArchive).toHaveBeenCalledWith(first.sessionId);

    // 有任务会话先弹确认框。
    openSessionMenu(second.title);
    fireEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "确认归档？",
    });
    expect(dialog.textContent).toContain(
      "该会话有正在运行的任务，强制归档会终止任务",
    );
    expect(props.onArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(props.onArchive).toHaveBeenCalledWith(second.sessionId);
  });

  it("confirms batch archive with running-task session titles and archives on confirm", () => {
    const onArchiveMany = vi.fn();
    const { first, second } = renderDrawer({
      onArchiveMany,
      onDeleteMany: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择 ${first.title}` }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: `选择 ${second.title}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量归档" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "确认归档 2 个会话？",
    });
    expect(dialog.textContent).toContain(second.title);
    expect(dialog.textContent).toContain("以下会话有正在运行的任务");
    expect(onArchiveMany).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onArchiveMany).toHaveBeenCalledWith([
      first.sessionId,
      second.sessionId,
    ]);
  });
});

describe("Ticket 04 Batch 模式常驻指南已退役", () => {
  it("batch 模式只显示简短提示，不渲染 Session 新建/搜索/列表与三步指南", () => {
    const sessions = [
      createTestSession("s1", "会话一", 1),
      createTestSession("s2", "会话二", 2),
    ];
    renderDrawer({ activeWorkspaceMode: "batch", sessions });

    expect(screen.queryByRole("heading", { name: "批量使用指南" })).toBeNull();
    expect(screen.queryByText("添加视频来源")).toBeNull();
    expect(
      screen.queryByText("批量字幕独立保存，不会创建或读取普通会话。"),
    ).toBeNull();
    expect(screen.getByText("在批量工作区创建并管理列表。")).not.toBeNull();

    // Session 专属控件不得出现在 DOM
    expect(screen.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "搜索会话" })).toBeNull();
    expect(screen.queryByText("会话一")).toBeNull();
    expect(screen.queryByText("会话二")).toBeNull();
  });

  it("session 模式也不显示三步指南", () => {
    renderDrawer({
      activeWorkspaceMode: "session",
      sessions: [createTestSession("s1", "会话一", 1)],
    });
    expect(screen.queryByText("批量使用指南")).toBeNull();
    expect(screen.queryByText("添加视频来源")).toBeNull();
  });
});
