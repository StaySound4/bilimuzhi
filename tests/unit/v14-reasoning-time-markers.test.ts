import { describe, expect, it, vi } from "vitest";

import type {
  AiGenerationRequest,
  AiProviderStreamEvent,
} from "../../src/application/ai/provider-contract";
import { HttpAiProviderTransport } from "../../src/infrastructure/ai/http-provider-transport";
import { deriveValidatedMarkdownTimeLinks } from "../../src/ui/markdown";

const fixtureCredential = "fixture-v14-token-not-a-real-credential";

function request(): AiGenerationRequest {
  return {
    kind: "chat",
    messages: [{ content: "保留正文和显式推理块", role: "user" }],
    model: {
      capabilities: {
        contextWindowCharacters: 64_000,
        maxOutputCharacters: 8_000,
        supportedReasoningEfforts: ["none", "high"],
        supportsAttachments: false,
        supportsReasoning: true,
        supportsStreaming: true,
        supportsWebSearch: false,
      },
      discoveredAt: 14,
      displayName: "v14 fixture model",
      modelId: "model-v14",
      providerId: "provider-v14",
    },
    reasoningEffort: "high",
  };
}

function sseResponse(payloads: readonly unknown[]) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of payloads) {
          const serialized =
            typeof payload === "string" ? payload : JSON.stringify(payload);
          controller.enqueue(encoder.encode(`data: ${serialized}\n\n`));
        }
        controller.close();
      },
    }),
    json: vi.fn(async () => ({})),
    ok: true,
    status: 200,
    text: vi.fn(async () => ""),
  };
}

function transport(
  protocol: "claude" | "gemini" | "openai",
  payloads: readonly unknown[],
): HttpAiProviderTransport {
  return new HttpAiProviderTransport({
    apiKey: fixtureCredential,
    baseUrl:
      protocol === "claude"
        ? "https://api.anthropic.fixture"
        : protocol === "gemini"
          ? "https://generativelanguage.fixture/v1beta"
          : "https://openai-compatible.fixture/v1",
    fetch: vi.fn(async () => sseResponse(payloads)) as never,
    protocol,
  });
}

async function collect(
  source: AsyncIterable<unknown>,
): Promise<readonly AiProviderStreamEvent[]> {
  const events: AiProviderStreamEvent[] = [];
  for await (const event of source) {
    events.push(event as AiProviderStreamEvent);
  }
  return events;
}

function joinedDeltas(
  events: readonly AiProviderStreamEvent[],
  type: "delta" | "reasoning",
): string {
  return events
    .filter(
      (
        event,
      ): event is Extract<
        AiProviderStreamEvent,
        { readonly type: typeof type }
      > => event.type === type,
    )
    .map((event) => event.delta)
    .join("");
}

describe("v14 A2 explicit Provider reasoning normalization", () => {
  it("keeps OpenAI-compatible scalar reasoning separate from unchanged body text", async () => {
    const events = await collect(
      transport("openai", [
        {
          choices: [
            {
              delta: {
                content: "标量正文",
                reasoning_content: "标量推理",
              },
              finish_reason: "stop",
            },
          ],
        },
      ]).stream(request()),
    );

    expect(events).toEqual([
      { type: "started" },
      { delta: "标量推理", type: "reasoning" },
      { delta: "标量正文", type: "delta" },
      { output: "标量正文", type: "completed" },
    ]);
  });

  it("preserves OpenAI-compatible reasoning arrays as distinct readable blocks", async () => {
    const events = await collect(
      transport("openai", [
        {
          choices: [
            {
              delta: {
                content: "数组形状正文",
                reasoning_content: ["数组推理一", "数组推理二"],
              },
              finish_reason: "stop",
            },
          ],
        },
      ]).stream(request()),
    );

    expect(joinedDeltas(events, "reasoning")).toBe("数组推理一\n\n数组推理二");
    expect(joinedDeltas(events, "delta")).toBe("数组形状正文");
    expect(events.at(-1)).toEqual({
      output: "数组形状正文",
      type: "completed",
    });
  });

  it("preserves OpenAI reasoning-summary and content block boundaries", async () => {
    const events = await collect(
      transport("openai", [
        {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: [
                  { text: "正文第一块", type: "output_text" },
                  { text: "正文第二块", type: "output_text" },
                ],
                reasoning_summary: [
                  { text: "推理标题", type: "summary_text" },
                  { text: "推理说明", type: "summary_text" },
                ],
              },
            },
          ],
        },
      ]).stream(request()),
    );

    expect(joinedDeltas(events, "reasoning")).toBe("推理标题\n\n推理说明");
    expect(joinedDeltas(events, "delta")).toBe("正文第一块\n\n正文第二块");
    expect(events.at(-1)).toEqual({
      output: "正文第一块\n\n正文第二块",
      type: "completed",
    });
  });

  it("keeps separate Claude thinking and text content blocks separated", async () => {
    const events = await collect(
      transport("claude", [
        {
          content_block: { type: "thinking" },
          index: 0,
          type: "content_block_start",
        },
        {
          delta: { thinking: "Claude 思考一", type: "thinking_delta" },
          index: 0,
          type: "content_block_delta",
        },
        { index: 0, type: "content_block_stop" },
        {
          content_block: { type: "thinking" },
          index: 1,
          type: "content_block_start",
        },
        {
          delta: { thinking: "Claude 思考二", type: "thinking_delta" },
          index: 1,
          type: "content_block_delta",
        },
        { index: 1, type: "content_block_stop" },
        {
          content_block: { type: "text" },
          index: 2,
          type: "content_block_start",
        },
        {
          delta: { text: "Claude 正文一", type: "text_delta" },
          index: 2,
          type: "content_block_delta",
        },
        { index: 2, type: "content_block_stop" },
        {
          content_block: { type: "text" },
          index: 3,
          type: "content_block_start",
        },
        {
          delta: { text: "Claude 正文二", type: "text_delta" },
          index: 3,
          type: "content_block_delta",
        },
        { type: "message_stop" },
      ]).stream(request()),
    );

    expect(joinedDeltas(events, "reasoning")).toBe(
      "Claude 思考一\n\nClaude 思考二",
    );
    expect(joinedDeltas(events, "delta")).toBe(
      "Claude 正文一\n\nClaude 正文二",
    );
    expect(events.at(-1)).toEqual({
      output: "Claude 正文一\n\nClaude 正文二",
      type: "completed",
    });
  });

  it("keeps Gemini thought and body parts in their original readable blocks", async () => {
    const events = await collect(
      transport("gemini", [
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Gemini 推理标题", thought: true },
                  { text: "Gemini 推理说明", thought: true },
                  { text: "Gemini 正文一" },
                  { text: "Gemini 正文二" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      ]).stream(request()),
    );

    expect(joinedDeltas(events, "reasoning")).toBe(
      "Gemini 推理标题\n\nGemini 推理说明",
    );
    expect(joinedDeltas(events, "delta")).toBe(
      "Gemini 正文一\n\nGemini 正文二",
    );
    expect(events.at(-1)).toEqual({
      output: "Gemini 正文一\n\nGemini 正文二",
      type: "completed",
    });
  });
});

describe("v14 A7 compact time-marker validation", () => {
  const fullRows = [
    {
      endMs: 3_800_000,
      lineId: "line-v14",
      startMs: 0,
      text: "完整字幕范围",
    },
  ] as const;
  const matchingOwner = {
    activeVideoKey: "bvid:BV1V14:cid:14:p:1",
    subtitleVideoKey: "bvid:BV1V14:cid:14:p:1",
  } as const;

  it("accepts compact points, a compact range, and multiple independent brackets", () => {
    expect(
      deriveValidatedMarkdownTimeLinks(
        "[16s] [3m48s] [1h2m3s] [5m38s–6m45s] [7m46s]",
        fullRows,
        matchingOwner,
      ),
    ).toEqual([
      { label: "16s", seconds: 16 },
      { label: "3m48s", seconds: 228 },
      { label: "1h2m3s", seconds: 3_723 },
      { label: "5m38s–6m45s", seconds: 338 },
      { label: "7m46s", seconds: 466 },
    ]);
  });

  it("continues accepting the existing mm:ss and h:mm:ss compatibility forms", () => {
    expect(
      deriveValidatedMarkdownTimeLinks(
        "兼容 [03:48] 与 [1:02:03]",
        fullRows,
        matchingOwner,
      ),
    ).toEqual([
      { label: "03:48", seconds: 228 },
      { label: "1:02:03", seconds: 3_723 },
    ]);
  });

  it("rejects an out-of-range point, an out-of-range range end, and an unclosed stream fragment", () => {
    const boundedRows = [
      { endMs: 500_000, startMs: 0, text: "只到 8m20s" },
    ] as const;
    const links = deriveValidatedMarkdownTimeLinks(
      "有效 [16s] [5m38s–6m45s]；越界 [8m21s] [5m38s–8m45s]；未闭合 [3m48s",
      boundedRows,
      matchingOwner,
    );

    expect(links).toEqual([
      { label: "16s", seconds: 16 },
      { label: "5m38s–6m45s", seconds: 338 },
    ]);
  });

  it("rejects every otherwise-valid marker when subtitle and active video owners differ", () => {
    expect(
      deriveValidatedMarkdownTimeLinks("[16s] [5m38s–6m45s]", fullRows, {
        activeVideoKey: "bvid:BV1OTHER:cid:99:p:1",
        subtitleVideoKey: matchingOwner.subtitleVideoKey,
      }),
    ).toEqual([]);
  });
});
