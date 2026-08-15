import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AiChatShell } from "../../src/ui/ai-chat-shell";
import type { BatchWorkspaceProps } from "../../src/ui/batch/batch-workspace";
import type { SessionDrawerProps } from "../../src/ui/session-drawer";
import {
  createBatchItem,
  createBatchJob,
  createSession,
  createVideoKey,
} from "../../src/domain";

const now = 1_721_000_000_000;
const bvid = "BV1zt4y1z72D";
let batchWorkspaceCss = "";

beforeAll(async () => {
  batchWorkspaceCss = await readFile(
    resolve("src/ui/batch/batch-workspace.css"),
    "utf8",
  );
});

afterEach(cleanup);

function sessionDrawerProps(): SessionDrawerProps {
  return {
    sessions: [
      createSession({
        activeBranchId: null,
        createdAt: now,
        customTitle: false,
        lastActivityAt: now,
        selectionRevision: 0,
        sessionId: "session-v9-1",
        title: "一个用于验证完整标题可访问性的非常长的会话标题",
        updatedAt: now,
        videoKey: createVideoKey({ bvid, cid: 901, page: 1 }),
      }),
    ],
    activeSessionId: "session-v9-1",
    searchTerm: "",
    filterMode: "active",
    searchResults: undefined,
    searching: false,
    feedback: undefined,
    selectionMode: false,
    selectedSessionIds: [],
    identifier: "",
    onSelect: vi.fn(),
    onBindCurrent: vi.fn(),
    onIdentifierChange: vi.fn(),
    onBindIdentifier: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onOpenArchive: vi.fn(),
    onOpenTrash: vi.fn(),
  } as unknown as SessionDrawerProps;
}

function batchProps(): BatchWorkspaceProps {
  const job = createBatchJob({
    batchJobId: "batch-v9-shell-job",
    browserSessionId: "browser-v9",
    createdAt: now,
    method: "direct",
    sourceKind: "single-video",
    sourceLabel: "独立批量任务",
    status: "completed",
    updatedAt: now,
  });
  const item = createBatchItem({
    batchItemId: "batch-v9-shell-item",
    batchJobId: job.batchJobId,
    bvid,
    errorCode: null,
    order: 0,
    page: 1,
    resultBranchId: "legacy-branch",
    resultSessionId: "legacy-session",
    rowCount: 1,
    selected: true,
    status: "succeeded",
    title: "已完成字幕的视频",
    trackId: "official-zh-CN",
    updatedAt: now,
    videoKey: createVideoKey({ bvid, cid: 901, page: 1 }),
  });

  return {
    includeAllPages: true,
    input: "",
    hasLists: true,
    view: { job, items: [item], overwriteCount: 0 },
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onIncludeAllPagesChange: vi.fn(),
    onInputChange: vi.fn(),
    onLanguagePreferenceChange: vi.fn(),
    onPrepare: vi.fn(),
    onSelectionChange: vi.fn(),
    onStart: vi.fn(),
    onOpenSession: vi.fn(),
    onSyncCurrentSource: vi.fn(),
  } as unknown as BatchWorkspaceProps;
}

function batchDrawerProps() {
  return {
    lists: [],
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
  };
}

describe("v9 独立批量模式工作区入口", () => {
  it("uses a true compact-card layout at both 359px and 360px without a wider horizontal-scroll canvas", () => {
    // Ticket 11 布局预算（Q44 硬断言）：卡视图断点由 521 迁移至 399，
    // 使 400×600/520×900 目标尺寸走表格视图以满足最少完整可见行预算。
    const compactRules = batchWorkspaceCss.slice(
      batchWorkspaceCss.lastIndexOf("@container (max-width: 399px)"),
    );

    expect(compactRules).not.toMatch(
      /\.muzhi-batch__table\s*\{[\s\S]{0,360}min-width:\s*520px/u,
    );
    expect(compactRules).toMatch(
      /\.muzhi-batch__table-scroll\s*\{[^}]*overflow-x:\s*(?:clip|hidden|visible)/u,
    );
    expect(compactRules).toMatch(
      /\.muzhi-batch__table\s*\{[^}]*width:\s*100%/u,
    );
  });

  it("把会话模式与批量模式作为左上角常驻文字入口，而不是放进左下角工具区", () => {
    render(
      <AiChatShell
        sessionDrawer={sessionDrawerProps()}
        batch={batchProps()}
        batchDrawer={batchDrawerProps()}
      />,
    );

    const modeNavigation = screen.getByRole("navigation", {
      name: "工作区模式",
    });
    expect(
      within(modeNavigation).getByRole("button", { name: "会话模式" }),
    ).not.toBeNull();

    const batchMode = within(modeNavigation).getByRole("button", {
      name: "批量模式",
    });
    expect(batchMode).not.toBeNull();
    expect(
      screen
        .getByRole("navigation", { name: "工作区工具" })
        .contains(batchMode),
    ).toBe(false);
    expect(screen.getByText("工作区 / 会话")).not.toBeNull();

    fireEvent.click(batchMode);

    expect(screen.getByText("工作区 / 批量模式")).not.toBeNull();
  });

  it("左侧只保留新建会话入口，右侧无会话选中时不再显示常驻教学", () => {
    render(
      <AiChatShell
        sessionDrawer={sessionDrawerProps()}
        batch={batchProps()}
        batchDrawer={batchDrawerProps()}
      />,
    );

    const drawer = screen.getByRole("complementary", { name: "会话" });
    const workspace = screen.getByRole("main", { name: "Bilimuzhi" });
    expect(
      within(drawer).getByRole("button", { name: "新建会话" }),
    ).not.toBeNull();

    // v16 D7 + Ticket 09：常驻教学已删除；无会话选中时显示统一空态，
    // 不再渲染输入框或「同步当前页面」。
    expect(workspace.textContent).not.toContain("使用会话模式");
    expect(workspace.textContent).toContain("尚无字幕");
    expect(
      within(workspace).queryByRole("textbox", { name: "BV 号或完整 URL" }),
    ).toBeNull();
    expect(
      within(workspace).queryByRole("button", { name: "同步当前页面" }),
    ).toBeNull();
  });

  it("批量来源 Dialog 提供「按当前打开页面获取视频」，不暴露会话入口", () => {
    render(
      <AiChatShell
        sessionDrawer={sessionDrawerProps()}
        batch={batchProps()}
        batchDrawer={batchDrawerProps()}
        utilityView="batch"
      />,
    );

    const workspace = screen.getByRole("main", { name: "Bilimuzhi" });
    fireEvent.click(
      within(workspace).getByRole("button", { name: "解析并加入列表" }),
    );
    expect(
      within(workspace).getByRole("button", {
        name: "按当前打开页面获取视频",
      }),
    ).not.toBeNull();
    expect(
      within(workspace).queryByRole("button", { name: "打开会话" }),
    ).toBeNull();
    expect(
      within(workspace).queryByRole("button", { name: "转为会话" }),
    ).toBeNull();
  });
});
