import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubtitleAcquisitionState } from "../../src/application/subtitle-acquisition";
import type { RestoredWorkspace } from "../../src/application/workspace-restoration";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoKey,
} from "../../src/domain";
import { AiChatShell } from "../../src/ui/ai-chat-shell";
import type { SpeechAcquisitionPanelProps } from "../../src/ui/asr/speech-acquisition-panel";
import type { SessionDrawerProps } from "../../src/ui/session-drawer";
import type { SubtitleTimelineProps } from "../../src/ui/subtitle-timeline";

afterEach(cleanup);

const bvid = "BV1Q541167Qg";

function restoredWorkspace(
  subtitleText = "旧字幕上下文",
  subtitleId = "subtitle-old",
): RestoredWorkspace {
  const videoKey = createVideoKey({
    bvid,
    cid: 30_000_000_007,
    page: 7,
  });
  const sessionId = "session-bound";
  const branchId = "branch-bound";
  const session = createSession({
    activeBranchId: branchId,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 2_000,
    selectionRevision: 1,
    sessionId,
    title: "第七分 P 的精确视频标题",
    updatedAt: 2_000,
    videoBound: true,
    videoKey,
  });
  const subtitle = createSubtitleSnapshot({
    branchId,
    contentHash: `sha256:${subtitleId}`,
    createdAt: 1_500,
    language: "zh-CN",
    rows: [{ endMs: 15_000, startMs: 12_000, text: subtitleText }],
    sessionId,
    source: "bilibili",
    status: "active",
    subtitleId,
    videoKey,
  });
  const branch = createSubtitleBranch({
    activeSubtitleId: subtitle.subtitleId,
    branchId,
    contextRevision: subtitleId === "subtitle-old" ? 3 : 4,
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
  return {
    activeMode: "timeline",
    branch,
    placement: createBranchPlacement({
      branchId,
      deletionReason: null,
      location: "workspace",
      order: 1_500,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
    scrollTopByMode: { chat: 0, segments: 0, summary: 0, timeline: 0 },
    session,
    subtitle,
  };
}

function drawer(workspace: RestoredWorkspace): SessionDrawerProps {
  return {
    activeSessionId: workspace.session.sessionId,
    onBindCurrent: vi.fn(),
    onBindIdentifier: vi.fn(),
    onDelete: vi.fn(),
    onDeleteMany: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    sessions: [workspace.session],
  };
}

function timeline(
  workspace: RestoredWorkspace,
  onSeek: (seconds: number) => void = vi.fn(),
): SubtitleTimelineProps {
  if (!workspace.subtitle || !workspace.branch) {
    throw new Error("The v14 bound workspace fixture requires a subtitle");
  }
  return {
    onSeek,
    rows: workspace.subtitle.rows,
    subtitleOwner: {
      pageRevision: workspace.branch.contextRevision,
      videoKey: workspace.subtitle.videoKey,
    },
    // Deliberately omit playerOwner: the original tab is stale/closed, but an
    // explicit click must still go through the v14 player route.
  };
}

function idleAcquisition(): SubtitleAcquisitionState {
  return { phase: "idle", selectedTrackId: null, tracks: [] };
}

function speechAcquisition(onStart: () => void): SpeechAcquisitionPanelProps {
  return {
    completedChunks: 0,
    hasConfiguredKey: true,
    hasExistingSubtitle: true,
    languageMode: "mixed",
    onCancel: vi.fn(),
    onLanguageModeChange: vi.fn(),
    onRoutingModeChange: vi.fn(),
    onStart,
    phase: "idle",
    routingMode: "balanced",
    totalChunks: 0,
  };
}

describe("v14 bound workspace and in-place reacquisition", () => {
  it("renders a compact persistent binding header and removes the restore banner and identifier form", () => {
    const workspace = restoredWorkspace();
    render(
      <AiChatShell
        restoredWorkspace={workspace}
        sessionDrawer={drawer(workspace)}
        timeline={timeline(workspace)}
      />,
    );

    const binding = screen.getByRole("region", { name: "已绑定视频" });
    expect(
      within(binding).getByRole("heading", {
        name: "第七分 P 的精确视频标题",
      }),
    ).not.toBeNull();
    expect(binding.textContent).toContain(bvid);
    expect(binding.textContent).toMatch(/(?:P|第)\s*7/);
    expect(binding.textContent).toMatch(/已绑定|页面.*(?:切换|关闭|未连接)/);
    expect(screen.queryByText(/^已恢复会话/)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "新建或打开视频会话" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "BV 号或完整 URL" }),
    ).toBeNull();
  });

  it("shows only a compact reacquire action until clicked, then keeps the binding head while replacing the lower pane with both sources", () => {
    const workspace = restoredWorkspace();
    const onAcquire = vi.fn();
    const onCancel = vi.fn();
    const onDiscover = vi.fn();
    const onSelect = vi.fn();
    const onStart = vi.fn();
    render(
      <AiChatShell
        restoredWorkspace={workspace}
        sessionDrawer={drawer(workspace)}
        speechAcquisition={speechAcquisition(onStart)}
        subtitleAcquisition={{
          hasExistingSubtitle: true,
          onAcquire,
          onCancel,
          onDiscover,
          onSelect,
          state: idleAcquisition(),
        }}
        timeline={timeline(workspace)}
      />,
    );

    const binding = screen.getByRole("region", { name: "已绑定视频" });
    const bindingText = binding.textContent;
    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();
    expect(
      screen.queryByRole("heading", { name: "获取视频自带字幕" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "语音转字幕" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));

    expect(screen.getByRole("region", { name: "已绑定视频" }).textContent).toBe(
      bindingText,
    );
    expect(screen.queryByRole("region", { name: "字幕时间线" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "获取视频自带字幕" }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "语音转字幕" })).not.toBeNull();
    expect(screen.queryByText("尚无字幕")).toBeNull();
    expect(screen.getByText(/新字幕成功前.*保留当前字幕/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回当前字幕" }));
    expect(screen.getByRole("region", { name: "字幕时间线" })).not.toBeNull();
    expect(screen.getByText("旧字幕上下文")).not.toBeNull();
    expect(onAcquire).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDiscover).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps explicit timeline seek enabled when the precise bound page is stale", () => {
    const workspace = restoredWorkspace();
    const onSeek = vi.fn();
    render(
      <AiChatShell
        restoredWorkspace={workspace}
        timeline={timeline(workspace, onSeek)}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "跳转到 00:12：旧字幕上下文",
      }),
    );

    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("restores the old projection on source cancel or failure and swaps it only after a successful committed projection", async () => {
    const oldWorkspace = restoredWorkspace();
    const newWorkspace = restoredWorkspace(
      "新字幕原子提交结果",
      "subtitle-new",
    );
    const onAcquire = vi.fn();
    const onCancel = vi.fn();
    const onDiscover = vi.fn();
    const onSelect = vi.fn();
    const onStart = vi.fn();
    const subtitleAcquisition = (state: SubtitleAcquisitionState) => ({
      hasExistingSubtitle: true,
      onAcquire,
      onCancel,
      onDiscover,
      onSelect,
      state,
    });
    const tree = (
      workspace: RestoredWorkspace,
      state: SubtitleAcquisitionState,
    ) => (
      <AiChatShell
        restoredWorkspace={workspace}
        sessionDrawer={drawer(workspace)}
        speechAcquisition={speechAcquisition(onStart)}
        subtitleAcquisition={subtitleAcquisition(state)}
        timeline={timeline(workspace)}
      />
    );
    const rendered = render(tree(oldWorkspace, idleAcquisition()));

    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    fireEvent.click(screen.getByRole("button", { name: "获取视频自带字幕" }));
    expect(onDiscover).toHaveBeenCalledOnce();
    rendered.rerender(
      tree(oldWorkspace, {
        phase: "selecting",
        selectedTrackId: "track-zh",
        tracks: [
          {
            language: "zh-CN",
            name: "中文",
            source: "official",
            trackId: "track-zh",
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByText("旧字幕上下文")).not.toBeNull(),
    );

    rendered.rerender(tree(oldWorkspace, idleAcquisition()));
    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    fireEvent.click(screen.getByRole("button", { name: "获取视频自带字幕" }));
    rendered.rerender(
      tree(oldWorkspace, {
        error: {
          code: "NETWORK_ERROR",
          message: "授权字幕请求暂时失败",
          retryable: true,
        },
        phase: "error",
        retry: "discover",
        selectedTrackId: null,
        tracks: [],
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("旧字幕上下文")).not.toBeNull(),
    );
    expect(oldWorkspace.subtitle?.rows[0].text).toBe("旧字幕上下文");
    expect(
      screen.getByRole("region", { name: "已绑定视频" }).textContent,
    ).toContain("第七分 P 的精确视频标题");

    rendered.rerender(tree(oldWorkspace, idleAcquisition()));
    fireEvent.click(screen.getByRole("button", { name: "重新获取" }));
    fireEvent.click(screen.getByRole("button", { name: "获取视频自带字幕" }));
    rendered.rerender(
      tree(newWorkspace, {
        phase: "success",
        rowCount: 1,
        selectedTrackId: "track-zh",
        tracks: [],
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("新字幕原子提交结果")).not.toBeNull(),
    );
    expect(screen.queryByText("旧字幕上下文")).toBeNull();
    expect(
      screen.getByRole("region", { name: "已绑定视频" }).textContent,
    ).toContain("第七分 P 的精确视频标题");
  });
});
