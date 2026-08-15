import { describe, expect, it } from "vitest";

import {
  activateWorkspaceSession,
  isWorkspaceState,
  removeWorkspaceSession,
  restoreWorkspace,
  saveWorkspaceView,
  type WorkspaceState,
} from "../../src/application/workspace-restoration";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoKey,
} from "../../src/domain";

describe("restoreWorkspace", () => {
  it("restores the active session, subtitle, mode, and per-mode scroll positions", async () => {
    const videoKey = createVideoKey({
      bvid: "BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
    });
    const session = createSession({
      activeBranchId: "branch-1",
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 2_000,
      selectionRevision: 2,
      sessionId: "session-1",
      title: "精确视频",
      updatedAt: 2_000,
      videoKey,
    });
    const subtitle = createSubtitleSnapshot({
      branchId: "branch-1",
      contentHash: "sha256:example",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "已恢复字幕" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-1",
      videoKey,
    });
    const branch = createSubtitleBranch({
      activeSubtitleId: subtitle.subtitleId,
      branchId: subtitle.branchId,
      contextRevision: 1,
      createdAt: subtitle.createdAt,
      detectedLanguage: null,
      language: subtitle.language,
      lastOpenedAt: 2_000,
      lastSelectedAt: 2_000,
      requestedLanguageMode: null,
      sessionId: session.sessionId,
      source: subtitle.source,
      title: null,
      updatedAt: 2_000,
      videoKey,
    });
    const placement = createBranchPlacement({
      branchId: branch.branchId,
      deletionReason: null,
      location: "workspace",
      order: branch.createdAt,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: session.sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    });

    await expect(
      restoreWorkspace({
        repository: {
          restore: async () => ({ branch, placement, session, subtitle }),
        },
        stateStore: {
          load: async () => ({
            activeSessionId: session.sessionId,
            sessions: [
              {
                activeMode: "summary",
                scrollTopByMode: {
                  chat: 40,
                  segments: 20,
                  summary: 30,
                  timeline: 10,
                },
                sessionId: session.sessionId,
              },
            ],
            version: 1,
          }),
          save: async () => undefined,
        },
      }),
    ).resolves.toEqual({
      activeMode: "summary",
      branch,
      placement,
      scrollTopByMode: {
        chat: 40,
        segments: 20,
        summary: 30,
        timeline: 10,
      },
      session,
      subtitle,
    });
  });
});

describe("saveWorkspaceView", () => {
  it("upserts the active session view while preserving other sessions", async () => {
    const existing = {
      activeSessionId: "session-old",
      sessions: [
        {
          activeMode: "timeline",
          scrollTopByMode: {
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 50,
          },
          sessionId: "session-old",
        },
      ],
      version: 1,
    } satisfies WorkspaceState;
    let saved: WorkspaceState | null = null;

    const result = await saveWorkspaceView(
      {
        load: async () => existing,
        save: async (state) => {
          saved = state;
        },
      },
      {
        activeMode: "chat",
        scrollTopByMode: {
          chat: 80,
          segments: 20,
          summary: 30,
          timeline: 10,
        },
        sessionId: "session-new",
      },
    );

    expect({ result, saved }).toEqual({
      result: {
        activeSessionId: "session-new",
        sessions: [
          existing.sessions[0],
          {
            activeMode: "chat",
            scrollTopByMode: {
              chat: 80,
              segments: 20,
              summary: 30,
              timeline: 10,
            },
            sessionId: "session-new",
          },
        ],
        version: 1,
      },
      saved: {
        activeSessionId: "session-new",
        sessions: [
          existing.sessions[0],
          {
            activeMode: "chat",
            scrollTopByMode: {
              chat: 80,
              segments: 20,
              summary: 30,
              timeline: 10,
            },
            sessionId: "session-new",
          },
        ],
        version: 1,
      },
    });
  });
});

describe("workspace session activation", () => {
  it("preserves a known session view and initializes a new one", async () => {
    let stored: WorkspaceState = {
      activeSessionId: "session-old",
      sessions: [
        {
          activeMode: "summary",
          scrollTopByMode: {
            chat: 40,
            segments: 20,
            summary: 30,
            timeline: 10,
          },
          sessionId: "session-old",
        },
      ],
      version: 1,
    };
    const stateStore = {
      load: async () => stored,
      save: async (state: WorkspaceState) => {
        stored = state;
      },
    };

    await expect(
      activateWorkspaceSession(stateStore, "session-old"),
    ).resolves.toEqual(stored);
    await expect(
      activateWorkspaceSession(stateStore, "session-new"),
    ).resolves.toEqual({
      activeSessionId: "session-new",
      sessions: [
        stored.sessions[0],
        {
          activeMode: "timeline",
          scrollTopByMode: {
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 0,
          },
          sessionId: "session-new",
        },
      ],
      version: 1,
    });
  });

  it("removes a session view and clears only a deleted active identity", async () => {
    let stored: WorkspaceState = {
      activeSessionId: "session-active",
      sessions: [
        {
          activeMode: "timeline",
          scrollTopByMode: {
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 20,
          },
          sessionId: "session-active",
        },
        {
          activeMode: "chat",
          scrollTopByMode: {
            chat: 50,
            segments: 0,
            summary: 0,
            timeline: 0,
          },
          sessionId: "session-other",
        },
      ],
      version: 1,
    };
    const stateStore = {
      load: async () => stored,
      save: async (state: WorkspaceState) => {
        stored = state;
      },
    };

    await expect(
      removeWorkspaceSession(stateStore, "session-other"),
    ).resolves.toMatchObject({ activeSessionId: "session-active" });
    await expect(
      removeWorkspaceSession(stateStore, "session-active"),
    ).resolves.toEqual({
      activeSessionId: null,
      sessions: [],
      version: 1,
    });
  });
});

describe("isWorkspaceState", () => {
  it("accepts only exact, internally consistent version 1 state", () => {
    const valid = {
      activeSessionId: "session-1",
      sessions: [
        {
          activeMode: "timeline",
          scrollTopByMode: {
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 12.5,
          },
          sessionId: "session-1",
        },
      ],
      version: 1,
    };
    const session = valid.sessions[0];

    expect(
      [
        valid,
        { ...valid, version: 2 },
        { ...valid, debug: true },
        { ...valid, activeSessionId: "missing-session" },
        { ...valid, sessions: [session, { ...session }] },
        {
          ...valid,
          sessions: [{ ...session, activeMode: "unknown" }],
        },
        {
          ...valid,
          sessions: [
            {
              ...session,
              scrollTopByMode: {
                ...session.scrollTopByMode,
                timeline: -1,
              },
            },
          ],
        },
        {
          ...valid,
          sessions: [
            {
              ...session,
              scrollTopByMode: {
                ...session.scrollTopByMode,
                extra: 0,
              },
            },
          ],
        },
      ].map(isWorkspaceState),
    ).toEqual([true, false, false, false, false, false, false, false]);
  });
});
