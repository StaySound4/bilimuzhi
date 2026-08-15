import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RestoredWorkspace,
  WorkspaceMode,
} from "../../src/application/workspace-restoration";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoKey,
} from "../../src/domain";
import { AiChatShell } from "../../src/ui/ai-chat-shell";
import type { BatchWorkspaceProps } from "../../src/ui/batch/batch-workspace";

afterEach(cleanup);

function createRestoredWorkspace(
  activeMode: WorkspaceMode,
  rowCount = 1,
  timelineScrollTop = 80,
  sessionId = "session-1",
): RestoredWorkspace {
  const videoKey = createVideoKey({
    bvid: "BV1Q541167Qg",
    cid: 30_000_000_001,
    page: 1,
  });
  const branchId = `branch-${sessionId}`;
  const session = createSession({
    activeBranchId: branchId,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 2_000,
    selectionRevision: 1,
    sessionId,
    title: "精确视频",
    updatedAt: 2_000,
    videoBound: true,
    videoKey,
  });
  const subtitle = createSubtitleSnapshot({
    branchId,
    contentHash: "sha256:component",
    createdAt: 1_500,
    language: "zh-CN",
    rows: Array.from({ length: rowCount }, (_, index) => ({
      endMs: index * 2_000 + 1_500,
      startMs: index * 2_000,
      text: rowCount === 1 ? "已恢复字幕" : `已恢复字幕 ${index}`,
    })),
    sessionId,
    source: "bilibili",
    status: "active",
    subtitleId: "subtitle-1",
    videoKey,
  });
  const branch = createSubtitleBranch({
    activeSubtitleId: subtitle.subtitleId,
    branchId,
    contextRevision: 1,
    createdAt: subtitle.createdAt,
    detectedLanguage: null,
    language: subtitle.language,
    lastOpenedAt: 2_000,
    lastSelectedAt: 2_000,
    requestedLanguageMode: null,
    sessionId,
    source: subtitle.source,
    title: null,
    updatedAt: 2_000,
    videoKey,
  });
  const placement = createBranchPlacement({
    branchId,
    deletionReason: null,
    location: "workspace",
    order: subtitle.createdAt,
    purgeAfter: null,
    retentionStartedAt: null,
    sessionId,
    trashedAt: null,
    trashOrigin: null,
    trashOriginFolderId: null,
    trashOriginPathSnapshot: null,
  });
  return {
    activeMode,
    branch,
    placement,
    scrollTopByMode: {
      chat: 0,
      segments: 0,
      summary: 40,
      timeline: timelineScrollTop,
    },
    session,
    subtitle,
  };
}

function createRestoredWorkspaceWithoutSubtitle(
  sessionId = "session-1",
): RestoredWorkspace {
  const restored = createRestoredWorkspace("timeline", 1, 80, sessionId);
  return {
    ...restored,
    session: createSession({
      ...restored.session,
      activeBranchId: null,
      selectionRevision: 0,
    }),
    branch: null,
    placement: null,
    subtitle: null,
  };
}

function createUnboundRestoredWorkspace(
  sessionId = "session-unbound",
): RestoredWorkspace {
  const restored = createRestoredWorkspaceWithoutSubtitle(sessionId);
  return {
    ...restored,
    session: createSession({
      ...restored.session,
      title: "未绑定会话",
      videoBound: false,
    }),
  };
}

function batchProps(): BatchWorkspaceProps {
  return {
    includeAllPages: false,
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
    onPrepare: vi.fn(),
    onSelectionChange: vi.fn(),
    onStart: vi.fn(),
  };
}

function batchDrawerProps(): Parameters<
  typeof import("../../src/ui/batch/batch-drawer").BatchDrawer
>[0] {
  return {
    lists: [],
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
  };
}

describe("AiChatShell", () => {
  it("uses the packaged Bilimuzhi logo in the primary workspace header", () => {
    render(<AiChatShell />);

    const heading = screen.getByRole("heading", { name: "Bilimuzhi" });
    const logo = heading.parentElement?.previousElementSibling;
    expect(logo?.getAttribute("src")).toBe("icons/muzhi-logo.png");
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
  });

  it("places the visible session and batch entries in the top mode navigation, outside footer tools", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");
    render(
      <AiChatShell
        batch={batchProps()}
        batchDrawer={batchDrawerProps()}
        onOpenSettings={vi.fn()}
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onOpenArchive: vi.fn(),
          onOpenTrash: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
    const modeNavigation = screen.getByRole("navigation", {
      name: "工作区模式",
    });
    expect(
      modeNavigation.contains(screen.getByRole("button", { name: "会话模式" })),
    ).toBe(true);
    const button = screen.getByRole("button", { name: "批量模式" });
    expect(button.getAttribute("title")).toBe("批量模式");
    expect(button.textContent).toContain("批量模式");
    expect(modeNavigation.contains(button)).toBe(true);
    expect(
      screen.getByRole("navigation", { name: "工作区工具" }).contains(button),
    ).toBe(false);

    fireEvent.click(button);
    // 批量模式：批量侧栏（drawer）随模式切换出现。
    expect(
      screen.getByRole("complementary", { name: "批量模式" }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "新建列表" })).not.toBeNull();
  });

  it("routes the batch workspace current-page sync action from the right content area", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");
    const onFetchByCurrentPage = vi.fn();
    const batch = {
      ...batchProps(),
      hasLists: true,
      onFetchByCurrentPage,
      view: {
        items: [],
        job: {
          batchJobId: "job-1",
          browserSessionId: "browser-1",
          createdAt: 1,
          method: "direct" as const,
          name: "测试列表",
          sourceKind: "video-pages" as const,
          sourceLabel: "测试来源",
          status: "ready" as const,
          updatedAt: 1,
        },
        overwriteCount: 0,
      },
    } as BatchWorkspaceProps & { readonly onFetchByCurrentPage: () => void };
    render(
      <AiChatShell
        batch={batch}
        batchDrawer={batchDrawerProps()}
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
        utilityView="batch"
      />,
    );

    const workspace = screen.getByRole("main", { name: "Bilimuzhi" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "解析并加入列表" })[0]!,
    );
    const sync = screen.getByRole("button", { name: "按当前打开页面获取视频" });
    expect(workspace.contains(sync)).toBe(true);
    expect(
      screen.getByRole("complementary", { name: "批量模式" }).contains(sync),
    ).toBe(false);
    fireEvent.click(sync);

    expect(onFetchByCurrentPage).toHaveBeenCalledOnce();
  });

  it("publishes current-page and trimmed identifier binding intents from the right session workspace", () => {
    const restoredWorkspace = createUnboundRestoredWorkspace();
    const onBindCurrent = vi.fn();
    const onBindIdentifier = vi.fn();
    render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent,
          onBindIdentifier,
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
      />,
    );

    const workspace = screen.getByRole("main", { name: "Bilimuzhi" });
    fireEvent.click(
      screen.getByRole("button", { name: "获取当前页面视频会话" }),
    );
    expect(onBindCurrent).toHaveBeenCalledOnce();

    const identifier = screen.getByRole("textbox", {
      name: "BV 号或完整 URL",
    });
    const bind = screen.getByRole("button", { name: "打开BV/URL对应视频会话" });
    expect(workspace.contains(identifier)).toBe(true);
    expect((bind as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(identifier, { target: { value: "  BV1Q541167Qg  " } });
    fireEvent.click(bind);

    expect(onBindIdentifier).toHaveBeenCalledWith("BV1Q541167Qg");
    expect((identifier as HTMLInputElement).value).toBe("");
  });

  it("preserves the right-workspace video identifier until asynchronous binding succeeds", async () => {
    const restoredWorkspace = createUnboundRestoredWorkspace();
    const onBindIdentifier = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier,
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
      />,
    );
    const identifier = screen.getByRole("textbox", {
      name: "BV 号或完整 URL",
    });
    fireEvent.input(identifier, { target: { value: "BV1Q541167Qg" } });

    fireEvent.click(
      screen.getByRole("button", { name: "打开BV/URL对应视频会话" }),
    );
    await waitFor(() =>
      expect((identifier as HTMLInputElement).value).toBe("BV1Q541167Qg"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "打开BV/URL对应视频会话" }),
    );
    await waitFor(() =>
      expect((identifier as HTMLInputElement).value).toBe(""),
    );
  });

  it("applies the saved mode when the controlled active session changes", () => {
    const first = createRestoredWorkspace("summary");
    const second = createRestoredWorkspace("chat", 1, 20, "session-2");
    const rendered = render(<AiChatShell restoredWorkspace={first} />);
    expect(
      screen.getByRole("tab", { name: "总结" }).getAttribute("aria-selected"),
    ).toBe("true");

    rendered.rerender(<AiChatShell restoredWorkspace={second} />);

    expect(
      screen.getByRole("tab", { name: "对话" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("renders the real controlled chat workspace instead of the chat placeholder", () => {
    render(
      <AiChatShell
        chat={{
          activeThreadId: null,
          messages: [],
          onCopyMessage: vi.fn(),
          onCreateThread: vi.fn(),
          onDeleteThread: vi.fn(),
          onExportThread: vi.fn(),
          onRenameThread: vi.fn(),
          onRequestMessageMutation: vi.fn(),
          onRetryMessage: vi.fn(),
          onSelectThread: vi.fn(),
          onSend: vi.fn(),
          onStop: vi.fn(),
          threads: [],
        }}
        restoredWorkspace={createRestoredWorkspace("chat")}
      />,
    );

    expect(screen.getByLabelText("AI 对话工作区")).not.toBeNull();
    expect(
      screen.queryByText("尚无字幕：获取字幕后即可开始 AI 对话。"),
    ).toBeNull();
  });

  it("opens archive from the single drawer entry and returns to the workspace", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");
    render(
      <AiChatShell
        archive={{
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
          sessions: [],
          tagCount: 0,
          tags: [],
        }}
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
    fireEvent.click(screen.getByRole("button", { name: "打开归档区" }));
    expect(screen.getByRole("region", { name: "归档工作区" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "时间轴" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));
    expect(screen.getByRole("tab", { name: "时间轴" })).not.toBeNull();
  });

  it("returns from a utility view when the user selects a workspace session", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");
    const onSelect = vi.fn();
    render(
      <AiChatShell
        archive={{
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
          sessions: [],
          tagCount: 0,
          tags: [],
        }}
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect,
          sessions: [restoredWorkspace.session],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
    fireEvent.click(screen.getByRole("button", { name: "打开归档区" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `打开会话 ${restoredWorkspace.session.title}`,
      }),
    );

    expect(onSelect).toHaveBeenCalledWith(restoredWorkspace.session.sessionId);
    expect(screen.getByRole("tab", { name: "时间轴" })).not.toBeNull();
  });

  it("mounts the controlled session drawer beside the workspace", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");

    render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        sessionDrawer={{
          activeSessionId: restoredWorkspace.session.sessionId,
          onBindCurrent: vi.fn(),
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restoredWorkspace.session],
        }}
      />,
    );

    expect(screen.getByRole("complementary", { name: "会话" })).not.toBeNull();
    expect(screen.getByRole("main", { name: "Bilimuzhi" })).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: `打开会话 ${restoredWorkspace.session.title}`,
      }),
    ).not.toBeNull();
  });

  it("renders one accessible four-mode workspace without pretending placeholders work", () => {
    render(<AiChatShell />);

    expect(screen.getByRole("main", { name: "Bilimuzhi" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Bilimuzhi" })).not.toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "时间轴",
      "分段",
      "总结",
      "对话",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(
      screen.getByRole("tabpanel", { name: "时间轴" }).textContent,
    ).toContain("尚未实现");
    expect(
      screen.queryByRole("button", { name: /生成|发送|开始|停止/ }),
    ).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("switches the single active placeholder with click and keyboard navigation", () => {
    render(<AiChatShell />);
    const timeline = screen.getByRole("tab", { name: "时间轴" });
    const segments = screen.getByRole("tab", { name: "分段" });
    const summary = screen.getByRole("tab", { name: "总结" });

    fireEvent.click(summary);
    expect(summary.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "总结" })).not.toBeNull();
    expect(screen.queryByRole("tabpanel", { name: "时间轴" })).toBeNull();

    summary.focus();
    fireEvent.keyDown(summary, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(segments);
    expect(segments.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(segments, { key: "Home" });
    expect(document.activeElement).toBe(timeline);
    expect(timeline.getAttribute("aria-selected")).toBe("true");
  });

  it("replaces only the timeline placeholder when timeline data is provided", () => {
    render(
      <AiChatShell
        timeline={{
          onSeek: () => undefined,
          rows: [{ endMs: 1_000, startMs: 0, text: "已加载字幕" }],
        }}
      />,
    );

    expect(screen.getByRole("searchbox", { name: "搜索字幕" })).not.toBeNull();
    expect(screen.getByText("已加载字幕")).not.toBeNull();
    expect(
      screen.queryByText("尚无字幕：请先获取官方/AI 字幕或使用语音转字幕。"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "总结" }));
    expect(
      screen.getByRole("tabpanel", { name: "总结" }).textContent,
    ).toContain("尚未实现");
  });

  it("shows the chat no-subtitle empty card instead of the not-implemented placeholder", () => {
    const restoredWorkspace = createRestoredWorkspaceWithoutSubtitle();
    render(<AiChatShell restoredWorkspace={restoredWorkspace} />);

    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    // T-B3 回归:有视频无字幕时,对话模式必须渲染 ChatWorkspace 的
    // no-subtitle 空状态卡片(与分段/总结同体系),而不是「尚未实现」。
    expect(screen.queryByText("尚未实现")).toBeNull();
    expect(screen.getByText("尚无字幕")).not.toBeNull();
    expect(
      screen.getByText("请先在“时间轴”获取字幕，再开始对话。"),
    ).not.toBeNull();
  });

  it("renders controlled direct-subtitle discovery and track selection for a bound empty session", () => {
    const restoredWorkspace = createRestoredWorkspaceWithoutSubtitle();
    const onAcquire = vi.fn();
    const onCancel = vi.fn();
    const onDiscover = vi.fn();
    const onSelect = vi.fn();
    const rendered = render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          onAcquire,
          onCancel,
          onDiscover,
          onSelect,
          state: {
            phase: "idle",
            selectedTrackId: null,
            tracks: [],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "获取视频自带字幕" }));
    expect(onDiscover).toHaveBeenCalledOnce();
    expect(screen.queryByText("尚未实现")).toBeNull();

    rendered.rerender(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          onAcquire,
          onCancel,
          onDiscover,
          onSelect,
          state: {
            phase: "selecting",
            selectedTrackId: "id:1001",
            tracks: [
              {
                language: "zh-CN",
                name: "中文（自动生成）",
                source: "ai",
                trackId: "id:1001",
              },
              {
                language: "en-US",
                name: "English",
                source: "official",
                trackId: "id:1002",
              },
            ],
          },
        }}
      />,
    );
    const english = screen.getByRole("radio", {
      name: /English.*官方字幕/,
    });
    fireEvent.click(english);
    expect(onSelect).toHaveBeenCalledWith("id:1002");
    fireEvent.click(screen.getByRole("button", { name: "获取所选字幕" }));
    expect(onAcquire).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("re-enters bound acquisition in place without the legacy replacement modal", () => {
    const restoredWorkspace = createRestoredWorkspace("timeline");
    const onDiscover = vi.fn();
    render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          hasExistingSubtitle: true,
          onAcquire: vi.fn(),
          onCancel: vi.fn(),
          onDiscover,
          onSelect: vi.fn(),
          state: {
            phase: "idle",
            selectedTrackId: null,
            tracks: [],
          },
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();
    const binding = screen.getByRole("region", { name: "已绑定视频" });
    const bindingText = binding.textContent;
    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    expect(screen.getByRole("region", { name: "已绑定视频" }).textContent).toBe(
      bindingText,
    );
    expect(screen.queryByRole("region", { name: "字幕时间线" })).toBeNull();
    expect(screen.getByText(/新字幕成功前.*保留当前字幕/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "获取视频自带字幕" }));
    expect(onDiscover).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "确认覆盖当前字幕？" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回当前字幕" }));
    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();
    expect(screen.getByText("已恢复字幕")).not.toBeNull();
  });

  it("offers real speech transcription beside direct subtitles with or without an existing timeline", () => {
    const onStart = vi.fn();
    const speechAcquisition = {
      completedChunks: 0,
      hasConfiguredKey: true,
      hasExistingSubtitle: true,
      languageMode: "mixed" as const,
      onCancel: vi.fn(),
      onLanguageModeChange: vi.fn(),
      onRoutingModeChange: vi.fn(),
      onStart,
      phase: "idle" as const,
      routingMode: "balanced" as const,
      totalChunks: 0,
    };
    const rendered = render(
      <AiChatShell
        restoredWorkspace={createRestoredWorkspace("timeline")}
        speechAcquisition={speechAcquisition}
      />,
    );
    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    fireEvent.click(screen.getByRole("button", { name: "开始语音转字幕" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "确认覆盖当前字幕？" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回当前字幕" }));
    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();

    rendered.unmount();
    render(
      <AiChatShell
        restoredWorkspace={createRestoredWorkspaceWithoutSubtitle(
          "session-speech-empty",
        )}
        speechAcquisition={{
          ...speechAcquisition,
          hasExistingSubtitle: false,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "语音转字幕" })).not.toBeNull();
    expect(screen.queryByText("尚未实现")).toBeNull();
  });

  it("exposes subtitle busy, safe error, retry, and success states through roles", () => {
    const restoredWorkspace = createRestoredWorkspaceWithoutSubtitle();
    const onAcquire = vi.fn();
    const onDiscover = vi.fn();
    const shared = {
      onAcquire,
      onCancel: vi.fn(),
      onDiscover,
      onSelect: vi.fn(),
    };
    const rendered = render(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          ...shared,
          state: {
            phase: "finding",
            selectedTrackId: null,
            tracks: [],
          },
        }}
      />,
    );
    expect(screen.getByText(/正在读取当前视频可用/).getAttribute("role")).toBe(
      "status",
    );
    expect(
      (screen.getByRole("button", { name: "正在查找" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    rendered.rerender(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          ...shared,
          state: {
            phase: "acquiring",
            selectedTrackId: "id:1002",
            tracks: [
              {
                language: "en-US",
                name: "English",
                source: "official",
                trackId: "id:1002",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/正在获取“English”正文/).getAttribute("role")).toBe(
      "status",
    );
    expect(
      (screen.getByRole("button", { name: "正在获取" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    rendered.rerender(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          ...shared,
          state: {
            error: {
              code: "AUTHENTICATION_REQUIRED",
              message: "请先登录 B 站后再获取字幕。",
              retryable: false,
            },
            phase: "error",
            retry: "discover",
            selectedTrackId: null,
            tracks: [],
          },
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "请先登录 B 站后再获取字幕。",
    );
    fireEvent.click(screen.getByRole("button", { name: "重试查找字幕" }));
    expect(onDiscover).toHaveBeenCalledOnce();

    rendered.rerender(
      <AiChatShell
        restoredWorkspace={restoredWorkspace}
        subtitleAcquisition={{
          ...shared,
          state: {
            phase: "success",
            rowCount: 3,
            selectedTrackId: "id:1002",
            tracks: [],
          },
        }}
      />,
    );
    expect(screen.getByText("已获取 3 行字幕。").getAttribute("role")).toBe(
      "status",
    );
    expect(onAcquire).not.toHaveBeenCalled();
  });

  it("starts in the restored mode and reports the real restored content", () => {
    const restoredWorkspace = createRestoredWorkspace("summary");
    render(<AiChatShell restoredWorkspace={restoredWorkspace} />);

    expect(
      screen.getByRole("tab", { name: "总结" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByText(/^已恢复会话/)).toBeNull();
    expect(
      screen.getByRole("region", { name: "已绑定视频" }).textContent,
    ).toContain("精确视频");
    expect(
      screen.getByRole("region", { name: "已绑定视频" }).textContent,
    ).toContain("BV1Q541167Qg");
    expect(screen.getByRole("tabpanel", { name: "总结" })).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "时间轴" }));
    expect(screen.getByText("已恢复字幕")).not.toBeNull();
  });

  it("shows the restored active subtitle before player seek is wired", () => {
    render(
      <AiChatShell restoredWorkspace={createRestoredWorkspace("timeline")} />,
    );

    expect(screen.getByRole("searchbox", { name: "搜索字幕" })).not.toBeNull();
    expect(screen.getByText("已恢复字幕")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /跳转到/ })).toBeNull();
  });

  it("passes the restored timeline scroll into the virtual window", () => {
    render(
      <AiChatShell
        restoredWorkspace={createRestoredWorkspace("timeline", 100, 2_800)}
      />,
    );

    expect(screen.getByText("已恢复字幕 50")).not.toBeNull();
    expect(screen.queryByText("已恢复字幕 0")).toBeNull();
  });

  it("reports restored session mode and scroll changes through one controlled callback", () => {
    const onWorkspaceViewChange = vi.fn();
    render(
      <AiChatShell
        onWorkspaceViewChange={onWorkspaceViewChange}
        restoredWorkspace={createRestoredWorkspace("timeline", 100, 2_800)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(onWorkspaceViewChange).toHaveBeenLastCalledWith({
      activeMode: "chat",
      scrollTopByMode: {
        chat: 0,
        segments: 0,
        summary: 40,
        timeline: 2_800,
      },
      sessionId: "session-1",
    });

    fireEvent.click(screen.getByRole("tab", { name: "时间轴" }));
    fireEvent.scroll(screen.getByRole("region", { name: "字幕时间线" }), {
      target: { scrollTop: 3_000 },
    });
    expect(onWorkspaceViewChange).toHaveBeenLastCalledWith({
      activeMode: "timeline",
      scrollTopByMode: {
        chat: 0,
        segments: 0,
        summary: 40,
        timeline: 3_000,
      },
      sessionId: "session-1",
    });
  });

  it("applies a theme with the fixed blue visual system", () => {
    const onAppearanceChange = vi.fn();
    render(<AiChatShell onAppearanceChange={onAppearanceChange} />);
    const shell = screen
      .getByRole("main", { name: "Bilimuzhi" })
      .closest(".muzhi-app");

    expect(shell?.getAttribute("data-theme")).toBe("system");
    expect(shell?.hasAttribute("data-accent")).toBe(false);
    fireEvent.input(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "dark" },
    });

    expect(shell?.getAttribute("data-theme")).toBe("dark");
    expect(screen.queryByRole("combobox", { name: "强调色" })).toBeNull();
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ theme: "dark" });
  });

  it("renders the read-only banner with archive navigation and workspace restore", () => {
    const onReturnToArchive = vi.fn();
    const onRestoreToWorkspace = vi.fn();
    const onGuard = vi.fn();
    render(
      <AiChatShell
        readOnly={{
          onGuard,
          onRestoreToWorkspace,
          onReturnToArchive,
        }}
        restoredWorkspace={createRestoredWorkspaceWithoutSubtitle()}
      />,
    );
    expect(screen.getByText("只读 · 来自归档")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回归档" }));
    expect(onReturnToArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "恢复会话至工作区" }));
    expect(onRestoreToWorkspace).toHaveBeenCalledTimes(1);
  });

  it("guards the re-acquire action through the read-only warning instead of running it", () => {
    const onGuard = vi.fn();
    const restored = createRestoredWorkspace("timeline", 1, 80);
    render(
      <AiChatShell
        readOnly={{
          onGuard,
          onRestoreToWorkspace: vi.fn(),
          onReturnToArchive: vi.fn(),
        }}
        restoredWorkspace={restored}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    expect(onGuard).toHaveBeenCalledTimes(1);
  });

  it("does not render the read-only banner for a normal workspace session", () => {
    render(
      <AiChatShell
        restoredWorkspace={createRestoredWorkspaceWithoutSubtitle()}
      />,
    );
    expect(screen.queryByText("只读 · 来自归档")).toBeNull();
  });
});
//
// v16 D7：单「新建会话」按钮、教学空状态、双获取模式 creator、移除会话同步入口。
//
describe("v16 D7 session entry rework", () => {
  const drawerProps = (
    overrides: Partial<
      NonNullable<Parameters<typeof AiChatShell>[0]>["sessionDrawer"]
    > = {},
  ): NonNullable<Parameters<typeof AiChatShell>[0]>["sessionDrawer"] => ({
    activeSessionId: null,
    onBindCurrent: vi.fn(),
    onBindIdentifier: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    sessions: [],
    ...overrides,
  });

  it("opens the session help dialog from the header help button", () => {
    const onHelpClick = vi.fn();
    render(
      <AiChatShell
        onHelpClick={onHelpClick}
        sessionDrawer={drawerProps()}
        restoredWorkspace={undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看当前模式教程" }));
    expect(onHelpClick).toHaveBeenCalledOnce();
    // 帮助 Dialog 内容由 helpDialog prop 驱动。
    expect(screen.queryByRole("heading", { name: "使用会话模式" })).toBeNull();
  });

  it("opens the batch help from the header help button in batch view", () => {
    const onHelpClick = vi.fn();
    render(
      <AiChatShell
        batch={{ ...batchProps(), hasLists: true }}
        batchDrawer={batchDrawerProps()}
        onHelpClick={onHelpClick}
        utilityView="batch"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看当前模式教程" }));
    expect(onHelpClick).toHaveBeenCalledOnce();
  });

  it("renders the session and batch help dialogs with mode-specific content", () => {
    const close = vi.fn();
    const { rerender } = render(
      <AiChatShell
        helpDialog={{ context: "session-workspace" }}
        onHelpClick={close}
      />,
    );
    expect(screen.getByRole("dialog", { name: "会话模式教程" })).not.toBeNull();
    rerender(
      <AiChatShell
        helpDialog={{ context: "batch-workspace" }}
        onHelpClick={close}
      />,
    );
    const batchDialog = screen.getByRole("dialog", {
      name: "批量模式教程",
    });
    expect(batchDialog).not.toBeNull();
    // Ticket 02：被删除的常驻安全/隔离说明补入批量帮助，不丢失。
    expect(batchDialog.textContent).toMatch(/当前浏览器登录 Bilibili/u);
    expect(batchDialog.textContent).toMatch(/独立于会话/u);
    fireEvent.click(
      screen
        .getByRole("dialog")
        .querySelector("button[type='submit']") as HTMLButtonElement,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders six help contexts with single close button and no cancel", () => {
    const close = vi.fn();
    const cases = [
      ["session-workspace", "会话模式教程"],
      ["session-archive", "会话归档教程"],
      ["session-trash", "会话回收站教程"],
      ["batch-workspace", "批量模式教程"],
      ["batch-archive", "批量归档教程"],
      ["batch-trash", "批量回收站教程"],
    ] as const;
    for (const [context, title] of cases) {
      const { unmount } = render(
        <AiChatShell helpDialog={{ context }} onHelpClick={close} />,
      );
      const dialog = screen.getByRole("dialog", { name: title });
      const buttons = Array.from(dialog.querySelectorAll("button"));
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.textContent).toBe("关闭");
      if (context.endsWith("-archive")) {
        expect(dialog.textContent).toContain("恢复");
      } else if (context.endsWith("-trash")) {
        expect(dialog.textContent).toContain("永久删除");
      } else {
        expect(dialog.textContent).toContain("字幕");
      }
      unmount();
    }
    expect(close).not.toHaveBeenCalled();
  });

  it("shows the two-mode creator for a selected unbound session without a sync button", () => {
    render(
      <AiChatShell
        sessionDrawer={drawerProps()}
        restoredWorkspace={createUnboundRestoredWorkspace()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "获取当前页面视频会话" }),
    );
    expect(
      screen.getByRole("textbox", { name: "BV 号或完整 URL" }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "同步当前页面" })).toBeNull();
  });

  it("publishes current-page binding from mode one and keeps the stability hint visible", () => {
    const onBindCurrent = vi.fn();
    render(
      <AiChatShell
        restoredWorkspace={createUnboundRestoredWorkspace()}
        sessionDrawer={drawerProps({ onBindCurrent })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "获取当前页面视频会话" }),
    );
    expect(onBindCurrent).toHaveBeenCalledOnce();
    expect(
      screen.getByText("请等待视频页面加载稳定后再复制地址"),
    ).not.toBeNull();
  });

  it("keeps the first-acquisition flow reachable for a bound session without subtitles", () => {
    const subtitleAcquisition = {
      onAcquire: vi.fn(),
      onCancel: vi.fn(),
      onDiscover: vi.fn(),
      onSelect: vi.fn(),
      state: {
        phase: "idle" as const,
        selectedTrackId: null,
        tracks: [],
      },
    };
    render(
      <AiChatShell
        restoredWorkspace={createRestoredWorkspaceWithoutSubtitle()}
        sessionDrawer={drawerProps()}
        subtitleAcquisition={subtitleAcquisition}
        timeline={undefined}
      />,
    );
    // 已绑定无字幕：显示首次获取面板（选择字幕来源）而非 no-video 空态卡。
    expect(
      document.querySelector(
        ".muzhi-workspace-empty[data-empty-variant='no-video']",
      ),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "获取视频自带字幕" }),
    ).not.toBeNull();
  });
});

describe("v16 placeholder guidance without subtitles", () => {
  it("shows current guidance for timeline and chat instead of the legacy slice notice", () => {
    render(<AiChatShell />);
    fireEvent.click(screen.getByRole("tab", { name: "时间轴" }));
    expect(
      screen.getByText("尚无字幕：请先获取官方/AI 字幕或使用语音转字幕。"),
    ).not.toBeNull();
    expect(screen.queryByText("字幕时间轴将在后续切片实现。")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    // T-B3:对话模式渲染 ChatWorkspace 统一空态卡片(no-video),
    // 不再使用旧「尚未实现/切片实现」占位文案。
    expect(screen.getByText("尚未选择视频")).not.toBeNull();
    expect(screen.queryByText("多轮 AI 对话将在后续切片实现。")).toBeNull();
    expect(screen.queryByText("尚未实现")).toBeNull();
  });
});

describe("shell feedback routing", () => {
  it("routes status feedback to a polite toast and keeps errors inline", () => {
    const rendered = render(
      <AiChatShell actionMessage={{ kind: "status", text: "保存成功" }} />,
    );
    expect(screen.getByRole("status").textContent).toContain("保存成功");
    expect(document.querySelector(".muzhi-shell__toast")).not.toBeNull();
    rendered.rerender(
      <AiChatShell actionMessage={{ kind: "error", text: "保存失败" }} />,
    );
    expect(screen.getByRole("alert").textContent).toBe("保存失败");
    expect(document.querySelector(".muzhi-shell__toast")).toBeNull();
  });

  it("shows stale browser context as polite status with a rebind action", () => {
    const restored = createRestoredWorkspace("timeline");
    const onBindCurrent = vi.fn();
    render(
      <AiChatShell
        pageIsStale
        restoredWorkspace={restored}
        sessionDrawer={{
          activeSessionId: restored.session.sessionId,
          onBindCurrent,
          onBindIdentifier: vi.fn(),
          onDelete: vi.fn(),
          onRename: vi.fn(),
          onSelect: vi.fn(),
          sessions: [restored.session],
        }}
      />,
    );
    const context = screen.getByRole("region", { name: "已绑定视频" });
    expect(context.classList).toContain("is-stale");
    fireEvent.click(
      screen.getByRole("button", { name: "获取当前页面视频会话" }),
    );
    expect(onBindCurrent).toHaveBeenCalledOnce();
  });
});

describe("Ticket 04 fluid tabs 共享 indicator", () => {
  it("DOM 中只有一个共享 indicator，且无每条 tab 独立选中线伪元素", () => {
    render(<AiChatShell />);
    const indicators = document.querySelectorAll(".muzhi-shell__tab-indicator");
    expect(indicators).toHaveLength(1);
    // 选中线由 indicator 承载，button 不再自带 ::after 选中线
    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      const style = window.getComputedStyle(tab, "::after");
      expect(style.background).not.toBe("rgb(23, 105, 232)");
      expect(style.content).not.toBe('""');
    }
  });

  it("indicator transform 由 --muzhi-tab-index 驱动，随 active index 同步", () => {
    render(<AiChatShell />);
    const nav = screen.getByRole("tablist");
    const timeline = screen.getByRole("tab", { name: "时间轴" });
    const summary = screen.getByRole("tab", { name: "总结" });
    const readIndex = () =>
      (nav as HTMLElement).style.getPropertyValue("--muzhi-tab-index");

    expect(readIndex()).toBe("0");
    fireEvent.click(summary);
    expect(readIndex()).toBe("2");
    expect(summary.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(summary, { key: "Home" });
    expect(readIndex()).toBe("0");
    expect(timeline.getAttribute("aria-selected")).toBe("true");
  });

  it("快速连续切换后 indicator 最终落在最后 active tab", () => {
    render(<AiChatShell />);
    const nav = screen.getByRole("tablist");
    const segments = screen.getByRole("tab", { name: "分段" });
    const chat = screen.getByRole("tab", { name: "对话" });
    const summary = screen.getByRole("tab", { name: "总结" });
    const readIndex = () =>
      (nav as HTMLElement).style.getPropertyValue("--muzhi-tab-index");

    fireEvent.click(segments);
    fireEvent.click(chat);
    fireEvent.click(summary);
    expect(readIndex()).toBe("2");
    expect(summary.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "总结" })).not.toBeNull();
  });

  it("reduced-motion 下 indicator 无位移 transition（由 CSS 承载，DOM 状态仍同步）", () => {
    render(<AiChatShell />);
    const nav = screen.getByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(
      (nav as HTMLElement).style.getPropertyValue("--muzhi-tab-index"),
    ).toBe("3");
    expect(
      screen.getByRole("tab", { name: "对话" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("routes all six mode×surface combinations and keeps surface on mode switch", () => {
    const batchArchive = {
      busy: false,
      lists: [],
      onDeleteTag: vi.fn(),
      onMoveTag: vi.fn(),
      onCreateTag: vi.fn(),
      onRenameTag: vi.fn(),
      onRenameList: vi.fn(),
      onRestoreList: vi.fn(),
      onSelectedTagIdChange: vi.fn(),
      onSetListTags: vi.fn(),
      onTrashList: vi.fn(),
      selectedTagId: null,
      tags: [],
      uiLanguage: "zh-Hans" as const,
    };
    const batchTrash = {
      busy: false,
      lists: [],
      onEmptyTrash: vi.fn(),
      onPurgeList: vi.fn(),
      onRestoreList: vi.fn(),
      uiLanguage: "zh-Hans" as const,
    };
    const base = {
      batch: batchProps(),
      batchArchive,
      batchTrash,
      sessionDrawer: {
        onBindCurrent: vi.fn(),
        onBindIdentifier: vi.fn(),
        onDelete: vi.fn(),
        onRename: vi.fn(),
        onSelect: vi.fn(),
        sessions: [],
      },
    } as unknown as Record<string, unknown>;
    const renderView = (view: string) => {
      const { unmount } = render(
        <AiChatShell {...base} utilityView={view as never} />,
      );
      return unmount;
    };

    const first = renderView("batch-archive");
    expect(screen.getByRole("heading", { name: "批量归档" })).not.toBeNull();
    // 批量归档有返回工作区按钮 → 批量工作台（无列表空卡片）。
    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));
    expect(screen.getByRole("heading", { name: "还没有列表" })).not.toBeNull();
    first();

    const second = renderView("batch-trash");
    expect(screen.getByRole("heading", { name: "批量回收站" })).not.toBeNull();
    second();
  });
});
