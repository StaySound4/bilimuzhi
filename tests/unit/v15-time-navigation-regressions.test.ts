import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { RUNTIME_PROTOCOL_VERSION } from "../../src/application/runtime-contract";
import {
  installContentPlayerBridge,
  type ContentPageDocument,
  type PlaybackVideo,
} from "../../src/infrastructure/content-player-bridge";

const videoKey = "bvid:BV1n9uA6KEcW:cid:40593459287:p:1" as const;

function command(seconds: number) {
  return {
    payload: { seconds, videoKey },
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: "real-page-route",
    type: "muzhi.video.seek",
  } as const;
}

function isolatedPage(video: PlaybackVideo): ContentPageDocument {
  return {
    // Chrome content script 的隔离世界看不到页面主世界中的 __INITIAL_STATE__。
    defaultView: {},
    location: {
      href: "https://www.bilibili.com/video/BV1n9uA6KEcW/?spm_id_from=333.788.videopod.episodes&vd_source=fixture",
    },
    querySelectorAll: () => [video],
  };
}

describe("v15 用户试测时间导航回归", () => {
  it("在单P合集视频的稳定 URL 上，不依赖主世界全局即可确认真实 seek", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    const seeked = new Set<() => void>();
    let currentTime = 0;
    const video: PlaybackVideo = {
      addEventListener: (_type, callback) => seeked.add(callback),
      duration: 84,
      get currentTime() {
        return currentTime;
      },
      removeEventListener: (_type, callback) => seeked.delete(callback),
      set currentTime(value: number) {
        currentTime = value;
      },
    };
    installContentPlayerBridge(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn((registered) => {
              listener = registered;
            }),
          },
        },
      },
      isolatedPage(video),
    );
    const sendResponse = vi.fn();

    expect(listener?.(command(72), {}, sendResponse)).toBe(true);
    for (const callback of [...seeked]) callback();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { seconds: 72, videoKey },
        type: "muzhi.video.seeked",
      }),
    );
  });

  it("总结正文最后一段不会被外层面板 last-child 规则染成浅灰", async () => {
    const css = await readFile(resolve("src/ui/ai-chat-shell.css"), "utf8");

    expect(css).not.toMatch(
      /\.muzhi-shell__panel p:last-child\s*\{[^}]*color:\s*var\(--muzhi-muted\)/s,
    );
    expect(css).toMatch(
      /\.muzhi-shell__panel \.muzhi-markdown p:last-child\s*\{[^}]*color:\s*var\(--muzhi-text\)/s,
    );
  });

  it("时间链接在总结和对话中都使用主题蓝色小框且不带下划线", async () => {
    const [insightCss, chatCss] = await Promise.all([
      readFile(resolve("src/ui/insights/insight-workspace.css"), "utf8"),
      readFile(resolve("src/ui/chat/chat-workspace.css"), "utf8"),
    ]);

    expect(insightCss).toMatch(
      /\.muzhi-markdown__time-link\s*\{[^}]*border:\s*1px solid[^}]*border-radius:[^}]*color:\s*var\(--muzhi-accent-strong\)[^}]*background:\s*var\(--muzhi-accent-soft\)/s,
    );
    expect(insightCss).toMatch(
      /\.muzhi-markdown__time-link\s*\{[^}]*text-decoration:\s*none/s,
    );
    expect(chatCss).toMatch(
      /\.muzhi-chat \.muzhi-markdown__time-link\s*\{[^}]*min-height:\s*24px[^}]*padding:\s*1px 7px[^}]*border:\s*1px solid color-mix\([^}]*border-radius:\s*7px[^}]*color:\s*var\(--muzhi-accent-strong\)[^}]*font-size:\s*0\.92em[^}]*background:\s*var\(--muzhi-accent-soft\)[^}]*text-decoration:\s*none/s,
    );
  });
});
