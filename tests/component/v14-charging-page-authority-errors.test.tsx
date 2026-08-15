import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubtitleAcquisitionCoordinator } from "../../src/application/subtitle-acquisition";
import type { RestoredWorkspace } from "../../src/application/workspace-restoration";
import { createSession, createVideoRef } from "../../src/domain";
import { createBilibiliSubtitleGateway } from "../../src/infrastructure/bilibili-subtitle-gateway";
import { AiChatShell } from "../../src/ui/ai-chat-shell";

afterEach(cleanup);

const CHARGED_BVID = "BV1wyTF6ZEWb";
const FIXTURE_AID = 91_400_014;
const FIXTURE_CID = 71_400_014;

const chargedVideo = createVideoRef({
  aid: FIXTURE_AID,
  bvid: CHARGED_BVID,
  canonicalUrl: `https://www.bilibili.com/video/${CHARGED_BVID}?p=1`,
  cid: FIXTURE_CID,
  page: 1,
  title: "“索卡尔事件”证实人文学科真的无用吗？",
});

function jsonResponse(
  value: unknown,
  authorizationContext: "off-page" | "page",
) {
  return {
    authorizationContext,
    json: vi.fn(async () => value),
    ok: true,
    status: 200,
  };
}

function playerResponse() {
  return {
    code: 0,
    data: {
      is_ugc_pay_preview: true,
      is_upower_exclusive: true,
      is_upower_play: false,
      need_login_subtitle: false,
      subtitle: { subtitles: [] },
    },
  };
}

async function previewAcquisitionState() {
  const fetch = vi.fn(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    if (url.hostname === "signed.fixture" && url.pathname === "/detail") {
      return jsonResponse(
        {
          code: 0,
          data: {
            View: {
              aid: FIXTURE_AID,
              bvid: CHARGED_BVID,
              pages: [{ cid: FIXTURE_CID, page: 1 }],
            },
          },
        },
        "page",
      );
    }
    if (url.pathname === "/x/player/v2") {
      return jsonResponse(playerResponse(), "off-page");
    }
    if (url.hostname === "signed.fixture" && url.pathname === "/player") {
      return jsonResponse(playerResponse(), "page");
    }
    if (url.pathname === "/x/v2/subtitle/web/view") {
      return {
        arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
        authorizationContext: "page" as const,
        json: vi.fn(async () => ({})),
        ok: true,
        status: 200,
      };
    }
    if (url.pathname.includes("/ai/subtitle/search/stat")) {
      return jsonResponse({ code: 0, data: { subtitle_url: "" } }, "page");
    }
    throw new Error(`Unexpected preview UI fixture endpoint: ${rawUrl}`);
  });
  const gateway = createBilibiliSubtitleGateway({
    fetch: fetch as never,
    signWbiUrl: vi.fn(async (pathname: string) =>
      pathname.includes("view/detail")
        ? "https://signed.fixture/detail"
        : "https://signed.fixture/player",
    ),
  });
  const coordinator = createSubtitleAcquisitionCoordinator({
    runtime: {
      acquire: async () => {
        throw new Error("Preview discovery must not start acquisition");
      },
      listTracks: async (videoKey) => {
        expect(videoKey).toBe(chargedVideo.videoKey);
        return gateway.listTracks(chargedVideo);
      },
    },
  });

  return coordinator.discover(chargedVideo.videoKey);
}

function boundWorkspaceWithoutSubtitle(): RestoredWorkspace {
  return {
    activeMode: "timeline",
    branch: null,
    placement: null,
    scrollTopByMode: { chat: 0, segments: 0, summary: 0, timeline: 0 },
    session: createSession({
      activeBranchId: null,
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 2_000,
      selectionRevision: 1,
      sessionId: "session-v14-charging-preview",
      title: chargedVideo.title,
      updatedAt: 2_000,
      videoBound: true,
      videoKey: chargedVideo.videoKey,
    }),
    subtitle: null,
  };
}

describe("v14 charging content UI", () => {
  it("shows the charged-content message and keeps speech transcription actionable", async () => {
    const acquisitionState = await previewAcquisitionState();
    const onStartSpeech = vi.fn();

    render(
      <AiChatShell
        restoredWorkspace={boundWorkspaceWithoutSubtitle()}
        speechAcquisition={{
          completedChunks: 0,
          hasConfiguredKey: true,
          hasExistingSubtitle: false,
          languageMode: "mixed",
          onCancel: vi.fn(),
          onLanguageModeChange: vi.fn(),
          onRoutingModeChange: vi.fn(),
          onStart: onStartSpeech,
          phase: "idle",
          routingMode: "balanced",
          totalChunks: 0,
        }}
        subtitleAcquisition={{
          onAcquire: vi.fn(),
          onCancel: vi.fn(),
          onDiscover: vi.fn(),
          onSelect: vi.fn(),
          state: acquisitionState,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "语音转字幕" })).not.toBeNull();
    const speechButton = screen.getByRole("button", {
      name: "开始语音转字幕",
    });
    expect((speechButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(speechButton);
    expect(onStartSpeech).toHaveBeenCalledOnce();

    expect(screen.getByRole("alert").textContent).toBe(
      "当前视频为充电/付费内容，不支持获取字幕。",
    );
    expect(screen.queryByText(/网络请求失败/)).toBeNull();
    expect(screen.queryByText(/无权/)).toBeNull();
    expect(
      screen.queryByText("当前精确视频没有找到可用的 B 站字幕。"),
    ).toBeNull();
  });
});
