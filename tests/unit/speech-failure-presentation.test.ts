import { describe, expect, it } from "vitest";

import { speechFailurePresentation } from "../../src/application/asr/speech-failure-presentation";

describe("speech failure presentation", () => {
  it("presents exhausted server 413 as a safe explicit file-too-large retry", () => {
    const record = {
      errorCode: "FILE_TOO_LARGE",
      providerDetail: "raw-provider-body fixture must stay hidden",
      status: "failed" as const,
    };
    const presentation = speechFailurePresentation(record) as ReturnType<
      typeof speechFailurePresentation
    > & { readonly title?: unknown };

    expect(presentation.retryable).toBe(true);
    expect(presentation.title).toEqual(expect.any(String));
    expect(String(presentation.title)).toMatch(/(?:音频|文件).*过大/u);
    expect(presentation.message).toMatch(/音频分片.*过大/u);
    expect(JSON.stringify(presentation)).not.toContain("raw-provider-body");
  });

  it("turns a persisted media download failure into an actionable message", () => {
    expect(
      speechFailurePresentation({
        errorCode: "NETWORK_ERROR",
        status: "failed",
      }),
    ).toEqual({
      message:
        "无法下载完整音频或连接语音服务。请保持当前视频页打开，并检查网络后重试。",
      retryable: true,
    });
  });

  it("keeps an interrupted browser task distinct from a provider failure", () => {
    expect(
      speechFailurePresentation({
        errorCode: null,
        status: "interrupted",
      }),
    ).toEqual({
      message: "插件后台无法安全续作该任务，请重新开始。",
      retryable: false,
    });
  });

  it("does not expose unknown backend details", () => {
    expect(
      speechFailurePresentation({
        errorCode: "INTERNAL_PRIVATE_DETAIL",
        status: "failed",
      }),
    ).toEqual({
      message: "语音服务未能生成可用字幕，请重试。",
      retryable: false,
    });
  });
});
