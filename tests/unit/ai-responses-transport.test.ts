import { describe, expect, it, vi } from "vitest";

import type { AiGenerationRequest } from "../../src/application/ai/provider-contract";
import { HttpAiProviderTransport } from "../../src/infrastructure/ai/http-provider-transport";

interface TestFetchInit {
  readonly body?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET" | "POST";
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

const reasoningCapabilities = {
  contextWindowCharacters: 120_000,
  maxOutputCharacters: 32_000,
  supportedReasoningEfforts: ["none", "low", "high"] as const,
  supportsAttachments: false,
  supportsReasoning: true,
  supportsStreaming: true,
  supportsWebSearch: false,
};

const request: AiGenerationRequest = {
  kind: "summary",
  messages: [
    { content: "你是字幕助手。", role: "system" },
    { content: "第二条系统规则", role: "system" },
    { content: "请总结字幕", role: "user" },
  ],
  model: {
    capabilities: reasoningCapabilities,
    discoveredAt: 1,
    displayName: "Responses model",
    modelId: "gpt-5.6-sol",
    providerId: "provider-a",
  },
  reasoningEffort: "high",
};

function sseResponse(events: readonly string[]) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }
        controller.close();
      },
    }),
    json: async () => ({}),
    ok: true,
    status: 200,
    text: async () => "",
  };
}

async function collect(source: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
}

describe("OpenAI Responses protocol transport (ticket 06)", () => {
  it("posts to /v1/responses with merged instructions and input messages", async () => {
    const bodies: string[] = [];
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string, init: TestFetchInit) => {
      urls.push(url);
      bodies.push(init.body ?? "");
      return sseResponse([
        '{"type":"response.output_text.delta","delta":{"text":"总结内容"}}',
        '{"type":"response.completed"}',
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });

    const events = await collect(transport.stream(request));

    expect(urls[0]).toBe("https://api.example.test/v1/responses");
    const body = JSON.parse(bodies[0]) as Record<string, unknown>;
    // system 合并为 instructions（多 system 用换行连接），非 system 进 input。
    expect(body.instructions).toBe("你是字幕助手。\n\n第二条系统规则");
    expect(body.input).toEqual([{ content: "请总结字幕", role: "user" }]);
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high" },
      stream: true,
    });
    expect(events).toEqual([
      { type: "started" },
      { delta: "总结内容", type: "delta" },
      { output: "总结内容", type: "completed" },
    ]);
  });

  it("parses reasoning summary deltas into reasoning events", async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        '{"type":"response.reasoning_summary_text.delta","delta":{"text":"先想一步"}}',
        '{"type":"response.output_text.delta","delta":{"text":"答案"}}',
        '{"type":"response.completed"}',
      ]),
    );
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    const events = await collect(transport.stream(request));
    expect(events).toEqual([
      { type: "started" },
      { delta: "先想一步", type: "reasoning" },
      { delta: "答案", type: "delta" },
      { output: "答案", type: "completed" },
    ]);
  });

  it("uses the raised summary output budget because max_output_tokens includes reasoning tokens", async () => {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(init.body ?? "");
      return sseResponse([
        '{"type":"response.output_text.delta","delta":{"text":"总结"}}',
        '{"type":"response.completed"}',
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    await collect(transport.stream(request));
    // summary（非 chat）在 responses 协议下给 32K 完整预算（含推理 token）。
    expect(JSON.parse(bodies[0])).toMatchObject({ max_output_tokens: 32_768 });
  });

  it("reports response.failed as a failed event through the shared attempt loop", async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        '{"type":"response.failed","error":{"code":"rate_limit_exceeded","message":"slow down"}}',
      ]),
    );
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    await expect(collect(transport.stream(request))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("retries an empty responses stream with lowered reasoning effort", async () => {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(init.body ?? "");
      if (bodies.length === 1) {
        return sseResponse([
          '{"type":"response.reasoning_summary_text.delta","delta":{"text":"只思考"}}',
          '{"type":"response.completed"}',
        ]);
      }
      return sseResponse([
        '{"type":"response.output_text.delta","delta":{"text":"降档后输出"}}',
        '{"type":"response.completed"}',
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    const events = await collect(
      transport.stream({ ...request, reasoningEffort: "max" }),
    );
    expect(events.at(-1)).toEqual({
      output: "降档后输出",
      type: "completed",
    });
    expect(JSON.parse(bodies[0]).reasoning).toEqual({ effort: "max" });
    // 空响应降档：max → xhigh。
    expect(JSON.parse(bodies[1]).reasoning).toEqual({ effort: "xhigh" });
  });

  it("parses response.reasoning_text.delta as the full reasoning chain", async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        '{"type":"response.reasoning_text.delta","delta":{"text":"完整思维链第一步"}}',
        '{"type":"response.reasoning_text.delta","delta":{"text":"完整思维链第二步"}}',
        '{"type":"response.output_text.delta","delta":{"text":"答案"}}',
        '{"type":"response.completed"}',
      ]),
    );
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    const events = await collect(transport.stream(request));
    expect(events).toEqual([
      { type: "started" },
      { delta: "完整思维链第一步", type: "reasoning" },
      { delta: "完整思维链第二步", type: "reasoning" },
      { delta: "答案", type: "delta" },
      { output: "答案", type: "completed" },
    ]);
  });

  it("prefers reasoning_text content over summary in non-streaming output", async () => {
    const payload = JSON.stringify({
      output: [
        {
          type: "reasoning",
          content: [{ text: "完整推理内容", type: "reasoning_text" }],
          summary: [{ text: "仅摘要", type: "summary_text" }],
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "答案" }],
        },
      ],
    });
    const encoder = new TextEncoder();
    const fetch = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(payload));
          controller.close();
        },
      }),
      json: async () => JSON.parse(payload),
      ok: true,
      status: 200,
      text: async () => payload,
    }));
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai-responses",
    });
    const events = await collect(transport.stream(request));
    expect(events).toEqual([
      { type: "started" },
      { delta: "完整推理内容", type: "reasoning" },
      { delta: "答案", type: "delta" },
      { output: "答案", type: "completed" },
    ]);
  });
});
