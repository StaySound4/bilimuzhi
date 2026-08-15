import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession, createVideoKey, type Session } from "../../src/domain";
import { AiChatShell } from "../../src/ui/ai-chat-shell";

import type { SessionDrawerProps } from "../../src/ui/session-drawer";

afterEach(cleanup);

function session(id: string, title: string, page: number): Session {
  return createSession({
    activeBranchId: null,
    createdAt: page,
    customTitle: false,
    lastActivityAt: page,
    selectionRevision: 0,
    sessionId: id,
    title,
    updatedAt: page,
    videoKey: createVideoKey({
      bvid: "BV1Q541167Qg",
      cid: 30_000_000_000 + page,
      page,
    }),
  });
}

function drawer(
  overrides: Partial<SessionDrawerProps> = {},
): SessionDrawerProps {
  return {
    onArchiveMany: vi.fn(),
    onBindCurrent: vi.fn(),
    onBindIdentifier: vi.fn(),
    onDelete: vi.fn(),
    onDeleteMany: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    sessions: [
      session("session-1", "一个足够长且必须保持可读的会话标题", 1),
      session("session-2", "第二个会话", 2),
    ],
    ...overrides,
  };
}

describe("v12 shell and session final contract", () => {
  it("keeps the shell responsive to the actual panel width and carries the theme through every button state surface", () => {
    const view = render(
      <AiChatShell appearance={{ theme: "dark" }} sessionDrawer={drawer()} />,
    );
    const app = screen
      .getByRole("main", { name: "Bilimuzhi" })
      .closest(".muzhi-app");

    expect(app?.getAttribute("data-theme")).toBe("dark");
    expect(app?.getAttribute("data-responsive-panel")).toBe("true");
    expect(app?.hasAttribute("data-min-panel-width")).toBe(false);
    expect(view.container.querySelector("button:not([class])")).toBeNull();
  });

  it("uses the required two-row multi-select layout, selects only visible sessions, and clears selection on cancel", () => {
    const props = drawer();
    render(<AiChatShell sessionDrawer={props} />);
    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
    fireEvent.click(screen.getByRole("button", { name: "多选" }));

    const summary = screen.getByLabelText("会话数量与多选模式");
    const toolbar = screen.getByRole("group", { name: "批量管理会话" });
    expect(summary.getAttribute("data-layout")).toBe("selection-header-row");
    expect(toolbar.getAttribute("data-layout")).toBe("selection-actions-row");
    expect(screen.getByText("已选 0")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("已选 2")).toBeNull();
  });

  it("keeps session navigation keyboard reachable in reduced-motion mode with an always-present anchored menu", () => {
    render(<AiChatShell sessionDrawer={drawer()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));

    // trigger 常驻 DOM（不依赖 hover/降噪隐藏），键盘可直达。
    const menu = screen.getByRole("button", { name: /会话操作 一个足够长/ });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(
      screen.getByRole("menu", {
        name: /会话操作 一个足够长且必须保持可读的会话标题/,
      }),
    ).not.toBeNull();
  });
});
