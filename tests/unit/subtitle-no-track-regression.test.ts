import { describe, expect, it, vi } from "vitest";

import { createVideoRef } from "../../src/domain";
import { createBilibiliSubtitleGateway } from "../../src/infrastructure/bilibili-subtitle-gateway";

function jsonResponse(body: unknown, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

describe("无字幕视频错误分类", () => {
  it("权威 player 已确认空轨道时，不让辅助 Web View/AI 网络失败覆盖 SUBTITLE_NOT_FOUND", async () => {
    const video = createVideoRef({
      aid: 117037254837034,
      bvid: "BV1n9uA6KEcW",
      canonicalUrl: "https://www.bilibili.com/video/BV1n9uA6KEcW",
      cid: 40593459287,
      durationSec: 84,
      page: 1,
      title: "微博热议多方爆料BLG不打算签约圣枪哥，Bin会回归！",
    });
    const fetch = vi.fn(async (url: string) => {
      const request = new URL(url);
      if (
        request.pathname === "/x/player/v2" ||
        request.pathname === "/x/player/wbi/v2"
      ) {
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        });
      }
      if (request.pathname === "/x/v2/subtitle/web/view") {
        return jsonResponse({}, 503);
      }
      if (request.pathname === "/x/player/v2/ai/subtitle/search/stat") {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse({}, 404);
    });
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(video)).rejects.toMatchObject({
      code: "SUBTITLE_NOT_FOUND",
      retryable: false,
    });
  });
});
