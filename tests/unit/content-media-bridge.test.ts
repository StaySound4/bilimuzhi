import { describe, expect, it } from "vitest";
import { sanitizeMediaPageMessage } from "../../src/infrastructure/content-media-bridge";

describe("content media bridge", () => {
  it("forwards only bounded media fields and strips the page marker", () => {
    expect(
      sanitizeMediaPageMessage({
        __muzhiMedia: true,
        data: "AQI=",
        index: 0,
        requestId: "media-request-1",
        secretUrl: "https://cdn.example/token=secret",
        type: "muzhi.media.chunk",
      }),
    ).toEqual({
      data: "AQI=",
      index: 0,
      requestId: "media-request-1",
      type: "muzhi.media.chunk",
    });
  });

  it.each([
    { __muzhiMedia: false, requestId: "x", type: "muzhi.media.failed" },
    {
      __muzhiMedia: true,
      data: "not base64!",
      index: 0,
      requestId: "x",
      type: "muzhi.media.chunk",
    },
    {
      __muzhiMedia: true,
      requestId: "../../escape",
      type: "muzhi.media.failed",
    },
  ])("rejects untrusted page messages", (message) => {
    expect(sanitizeMediaPageMessage(message)).toBeNull();
  });
});
