import { describe, expect, it, vi } from "vitest";

import type { AiGenerationRequest } from "../../src/application/ai/provider-contract";
import { HttpAiProviderTransport } from "../../src/infrastructure/ai/http-provider-transport";
import {
  createConservativeFallbackCapabilities,
  readDeclaredModelCapabilities,
  resolveKnownModelCapabilities,
} from "../../src/infrastructure/ai/model-capability-registry";
import { createAiProviderGateway } from "../../src/infrastructure/ai/provider-gateway";

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
  kind: "chat",
  messages: [
    { content: "You are helpful.", role: "system" },
    { content: "你好", role: "user" },
  ],
  model: {
    capabilities: reasoningCapabilities,
    discoveredAt: 1,
    displayName: "Reasoning model",
    modelId: "gpt-5-test",
    providerId: "provider-a",
  },
  reasoningEffort: "high",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    body: null,
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

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

function plainBodyResponse(raw: string) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(raw));
        controller.close();
      },
    }),
    json: async () => ({}),
    ok: true,
    status: 200,
    text: async () => raw,
  };
}

async function collect(source: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
}

describe("HTTP AI provider transport", () => {
  it("resolves safe local image handles only at the provider boundary and emits no Blob URL", async () => {
    const bodies: string[] = [];
    const resolveAttachment = vi.fn(async (attachmentId: string) => {
      expect(attachmentId).toBe("attachment-provider-image");
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    });
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(init.body ?? "");
      return sseResponse([
        '{"choices":[{"delta":{"content":"图片说明"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    });
    const dependencies = {
      apiKey: "provider-secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai" as const,
      resolveAttachment,
    };
    const transport = new HttpAiProviderTransport(dependencies);
    const imageRequest: AiGenerationRequest = {
      attachments: [
        {
          attachmentId: "attachment-provider-image",
          currentTimeMs: 12_000,
          mimeType: "image/png",
          sizeBytes: 3,
          videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
        },
      ],
      kind: "chat",
      messages: [{ content: "解释这张图", role: "user" }],
      model: {
        ...request.model,
        capabilities: {
          ...request.model.capabilities,
          supportsAttachments: true,
        },
      },
      reasoningEffort: "none",
    };

    await collect(transport.stream(imageRequest));

    expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(
      "attachment-provider-image",
    );
    expect(bodies[0]).toContain("AQID");
    expect(bodies[0]).not.toMatch(/blob:/i);
    expect(JSON.stringify(imageRequest)).not.toMatch(/AQID|data:image|blob:/i);
  });

  it("uses provider-specific model discovery endpoints without exposing credentials", async () => {
    const fetch = vi.fn(async (url: string, init: TestFetchInit) => {
      void url;
      void init;
      return jsonResponse({ data: [{ id: "model-a" }] });
    });
    const openAi = new HttpAiProviderTransport({
      apiKey: "openai-secret",
      baseUrl: "https://api.example.test/v1/",
      fetch,
      protocol: "openai",
    });
    await expect(openAi.discoverModels()).resolves.toEqual({
      data: [{ id: "model-a" }],
    });
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.test/v1/models");
    expect(fetch.mock.calls[0][1].headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer openai-secret",
    });

    fetch.mockClear();
    const claude = new HttpAiProviderTransport({
      apiKey: "claude-secret",
      baseUrl: "https://api.anthropic.test",
      fetch,
      protocol: "claude",
    });
    await claude.discoverModels();
    expect(fetch.mock.calls[0][0]).toBe("https://api.anthropic.test/v1/models");
    expect(fetch.mock.calls[0][1].headers).toEqual({
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
      "x-api-key": "claude-secret",
    });

    fetch.mockClear();
    const gemini = new HttpAiProviderTransport({
      apiKey: "gemini-secret",
      baseUrl: "https://generativelanguage.test/v1beta",
      fetch,
      protocol: "gemini",
    });
    await gemini.discoverModels();
    const geminiUrl = new URL(String(fetch.mock.calls[0][0]));
    expect(`${geminiUrl.origin}${geminiUrl.pathname}`).toBe(
      "https://generativelanguage.test/v1beta/models",
    );
    expect(geminiUrl.searchParams.get("key")).toBeNull();
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      "x-goog-api-key": "gemini-secret",
    });
  });

  it("streams OpenAI text and reasoning separately and bounds both compatibility fallbacks", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return jsonResponse(
          { error: { message: "unsupported parameter reasoning_effort" } },
          400,
        );
      }
      if (bodies.length === 2) {
        return jsonResponse(
          { error: { message: "unknown parameter max_tokens" } },
          422,
        );
      }
      return sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: { content: "回答", reasoning_content: "思考" },
            },
          ],
        }),
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai",
    });

    await expect(collect(transport.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "思考", type: "reasoning" },
      { delta: "回答", type: "delta" },
      { output: "回答", type: "completed" },
    ]);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({
      max_tokens: 4_096,
      reasoning_effort: "high",
    });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1]).toHaveProperty("max_tokens", 4_096);
    expect(bodies[2]).not.toHaveProperty("reasoning_effort");
    // token 预算分档降级：stage1 仍携带保守档 max_tokens。
    expect(bodies[2]).toHaveProperty("max_tokens", 4_096);
  });

  it("maps Claude and Gemini stream frames into safe text and reasoning events", async () => {
    const claudeFetch = vi.fn(async (url: string, init: TestFetchInit) => {
      void url;
      void init;
      return sseResponse([
        JSON.stringify({
          delta: { thinking: "Claude 思考", type: "thinking_delta" },
          type: "content_block_delta",
        }),
        JSON.stringify({
          delta: { text: "Claude 回答", type: "text_delta" },
          type: "content_block_delta",
        }),
        JSON.stringify({ type: "message_stop" }),
      ]);
    });
    const claude = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.anthropic.test",
      fetch: claudeFetch,
      protocol: "claude",
    });
    await expect(collect(claude.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "Claude 思考", type: "reasoning" },
      { delta: "Claude 回答", type: "delta" },
      { output: "Claude 回答", type: "completed" },
    ]);
    const claudeBody = JSON.parse(
      String(claudeFetch.mock.calls[0][1].body),
    ) as Record<string, unknown>;
    expect(claudeBody.system).toBe("You are helpful.");
    expect(claudeBody.messages).toEqual([
      {
        content: [{ text: "你好", type: "text" }],
        role: "user",
      },
    ]);

    const geminiFetch = vi.fn(async (url: string, init: TestFetchInit) => {
      void url;
      void init;
      return sseResponse([
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Gemini 思考", thought: true },
                  { text: "Gemini 回答" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
      ]);
    });
    const gemini = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://generativelanguage.test/v1beta",
      fetch: geminiFetch,
      protocol: "gemini",
    });
    await expect(collect(gemini.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "Gemini 思考", type: "reasoning" },
      { delta: "Gemini 回答", type: "delta" },
      { output: "Gemini 回答", type: "completed" },
    ]);
  });

  it("normalizes Gemini model names and keeps the API key out of request URLs", async () => {
    const fetch = vi.fn(async (url: string, init: TestFetchInit) => {
      expect(url).not.toContain("gemini-secret");
      expect(init.headers).toMatchObject({
        "x-goog-api-key": "gemini-secret",
      });
      return jsonResponse({
        models: [
          { displayName: "Gemini Dynamic", name: "models/gemini-dynamic" },
        ],
      });
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "gemini-secret",
      baseUrl: "https://generativelanguage.test/v1beta",
      fetch,
      protocol: "gemini",
    });
    await expect(transport.discoverModels()).resolves.toEqual({
      models: [{ id: "gemini-dynamic", name: "Gemini Dynamic" }],
    });
  });

  it("collects bounded Claude and Gemini model-list pages", async () => {
    const claudeUrls: string[] = [];
    const claudeFetch = vi.fn(async (url: string, init: TestFetchInit) => {
      void init;
      claudeUrls.push(url);
      return claudeUrls.length === 1
        ? jsonResponse({
            data: [{ id: "claude-a" }],
            has_more: true,
            last_id: "cursor-a",
          })
        : jsonResponse({ data: [{ id: "claude-b" }], has_more: false });
    });
    const claude = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.anthropic.test",
      fetch: claudeFetch,
      protocol: "claude",
    });
    await expect(claude.discoverModels()).resolves.toEqual({
      data: [{ id: "claude-a" }, { id: "claude-b" }],
    });
    expect(new URL(claudeUrls[1] ?? "").searchParams.get("after_id")).toBe(
      "cursor-a",
    );

    const geminiUrls: string[] = [];
    const geminiFetch = vi.fn(async (url: string, init: TestFetchInit) => {
      void init;
      geminiUrls.push(url);
      return geminiUrls.length === 1
        ? jsonResponse({
            models: [{ name: "models/gemini-a" }],
            nextPageToken: "cursor-g",
          })
        : jsonResponse({ models: [{ name: "models/gemini-b" }] });
    });
    const gemini = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://generativelanguage.test/v1beta",
      fetch: geminiFetch,
      protocol: "gemini",
    });
    await expect(gemini.discoverModels()).resolves.toEqual({
      models: [
        { id: "gemini-a", name: "gemini-a" },
        { id: "gemini-b", name: "gemini-b" },
      ],
    });
    expect(new URL(geminiUrls[1] ?? "").searchParams.get("pageToken")).toBe(
      "cursor-g",
    );
  });

  it("composes HTTP transport, dynamic discovery, capability hints, and safe streaming", async () => {
    const fetch = vi.fn(async (url: string, init: TestFetchInit) => {
      if (init.method === "GET") {
        return jsonResponse({
          data: [{ id: "gpt-5" }, { id: "provider/unknown-model" }],
        });
      }
      expect(url).toBe("https://api.example.test/v1/chat/completions");
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "完成" } }] }),
        "[DONE]",
      ]);
    });
    const gateway = createAiProviderGateway({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      now: () => 50,
      protocol: "openai",
      providerId: "openai-compatible",
    });
    const models = await gateway.discoverModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      modelId: "gpt-5",
      capabilities: { supportsReasoning: true },
    });
    expect(models[1]).toMatchObject({
      modelId: "provider/unknown-model",
      capabilities: {
        supportedReasoningEfforts: ["none"],
        supportsReasoning: false,
      },
    });
    await expect(
      collect(
        gateway.stream({
          kind: "chat",
          messages: [{ content: "你好", role: "user" }],
          model: models[0],
          reasoningEffort: "high",
        }),
      ),
    ).resolves.toEqual([
      { type: "started" },
      { delta: "完成", type: "delta" },
      { output: "完成", type: "completed" },
    ]);
  });

  it("returns stable redacted errors and does not classify every 422 as context overflow", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: "secret-value",
      baseUrl: "https://api.example.test/v1",
      fetch: async () =>
        jsonResponse(
          { error: { message: "invalid request secret-value raw payload" } },
          422,
        ),
      protocol: "openai",
    });
    await expect(collect(transport.stream(request))).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
      message: "The AI provider rejected this request configuration",
    });
    await expect(collect(transport.stream(request))).rejects.not.toThrow(
      /secret-value|raw payload/,
    );
  });
});

describe("AI model capability registry", () => {
  it("provides model-family hints without upgrading unknown dynamic models", () => {
    expect(resolveKnownModelCapabilities("gpt-5")).toMatchObject({
      supportedReasoningEfforts: ["none", "minimal", "low", "medium", "high"],
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("gpt-5.2-codex")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ],
    });
    expect(resolveKnownModelCapabilities("unknown-live-model")).toBeNull();
    // DeepSeek V3/V4 系列（官方 thinking 指南）：可选档位 low/high/max，
    // medium/xhigh 服务端按 high 处理不提供。
    expect(resolveKnownModelCapabilities("deepseek-chat")).toMatchObject({
      supportedReasoningEfforts: ["none", "low", "high", "max"],
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("deepseek-v4-flash")).toMatchObject({
      supportedReasoningEfforts: ["none", "low", "high", "max"],
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("deepseek-v4-pro")).toMatchObject({
      supportsReasoning: true,
    });
    expect(
      resolveKnownModelCapabilities("deepseek/deepseek-chat"),
    ).toMatchObject({
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("deepseek-reasoner")).toMatchObject({
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("deepseek-not-a-model")).toBeNull();
    expect(createConservativeFallbackCapabilities()).toMatchObject({
      supportedReasoningEfforts: ["none"],
      supportsAttachments: false,
      supportsReasoning: false,
      supportsWebSearch: false,
    });
  });

  it("keeps generic declared efforts away from DeepSeek so official levels win", () => {
    const declared = readDeclaredModelCapabilities(
      { supported_parameters: ["reasoning", "thinking"] },
      "deepseek",
    );
    expect(declared).toMatchObject({ supportsReasoning: true });
    expect(declared).not.toHaveProperty("supportedReasoningEfforts");
    // 非 DeepSeek 的 openai 兼容 provider 仍获得泛化档位（放宽到全档）。
    const generic = readDeclaredModelCapabilities(
      { supported_parameters: ["reasoning"] },
      "openrouter",
    );
    expect(generic).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
  });

  it("gives every gpt-5.x variant at least xhigh and full efforts for gateway variants", () => {
    // gpt-5.6-sol 官方档位：none/low/medium/high/xhigh/max（无 minimal）。
    expect(resolveKnownModelCapabilities("gpt-5.6-sol")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
    expect(resolveKnownModelCapabilities("gpt-5.6-luna")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
    expect(resolveKnownModelCapabilities("gpt-5.1")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
  });

  it("registers every gateway model family with relaxed or official efforts", () => {
    const fullEfforts = [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ];
    for (const modelId of [
      "grok-4.5",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.8-max",
      "qwen3.7-plus",
      "qwen3.6-plus",
      "hy3",
    ]) {
      expect(resolveKnownModelCapabilities(modelId)).toMatchObject({
        supportedReasoningEfforts: fullEfforts,
        supportsReasoning: true,
      });
    }
    // 官方明确档位保持精确：K3 始终推理（无 none），GLM-5 全档位。
    expect(resolveKnownModelCapabilities("kimi-k3")).toMatchObject({
      supportedReasoningEfforts: ["low", "high", "max"],
    });
    expect(resolveKnownModelCapabilities("glm-5.1")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
  });

  it("routes opencode.ai gateway models to their declared endpoints", async () => {
    const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetch: vi.fn(async (url: string, init: TestFetchInit) => {
        calls.push({
          body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
          url,
        });
        return sseResponse([
          '{"type":"response.output_text.delta","delta":{"text":"hello"}}\n\n',
          '{"type":"response.completed"}\n\n',
        ]);
      }) as never,
      protocol: "openai",
      providerId: "opencode",
    });

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "gpt-5.6-luna" },
      }),
    );
    expect(calls[0].url).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(calls[0].body).toMatchObject({
      model: "gpt-5.6-luna",
      stream: true,
      reasoning: { effort: "high" },
    });
    expect(calls[0].body).not.toHaveProperty("messages");
    expect(calls[0].body).toHaveProperty("input");
    expect(calls[0].body).toHaveProperty("max_output_tokens");

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "minimax-m3" },
      }),
    );
    expect(calls[1].url).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(calls[1].body).toMatchObject({
      model: "minimax-m3",
      stream: true,
      thinking: { budget_tokens: 8_192, type: "enabled" },
    });
    expect(calls[1].body).toHaveProperty("messages");

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "qwen3.8-max" },
      }),
    );
    expect(calls[2].url).toBe("https://opencode.ai/zen/go/v1/messages");

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "deepseek-v4-flash" },
      }),
    );
    expect(calls[3].url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("keeps non-gateway baseUrls on chat/completions and maps responses stream events", async () => {
    const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.xyz/v1",
      fetch: vi.fn(async (url: string, init: TestFetchInit) => {
        calls.push({
          body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
          url,
        });
        return sseResponse([
          '{"choices":[{"delta":{"content":"普通分段输出"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
      providerId: "wawazz",
    });

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "gpt-5.6-sol" },
      }),
    );
    expect(calls[0].url).toBe("https://wawazz.xyz/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ model: "gpt-5.6-sol" });

    const responsesTransport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          '{"type":"response.reasoning_summary_text.delta","delta":{"text":"先想"}}\n\n',
          '{"type":"response.output_text.delta","delta":{"text":"再写"}}\n\n',
          '{"type":"response.completed"}\n\n',
        ]),
      ) as never,
      protocol: "openai",
      providerId: "opencode",
    });
    expect(
      await collect(
        responsesTransport.stream({
          ...request,
          model: { ...request.model, modelId: "gpt-5.6-luna" },
        }),
      ),
    ).toEqual([
      { type: "started" },
      { delta: "先想", type: "reasoning" },
      { delta: "再写", type: "delta" },
      { type: "completed", output: "再写" },
    ]);
  });

  it("maps responses non-streaming JSON and terminal errors", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetch: vi.fn(async () =>
        plainBodyResponse(
          JSON.stringify({
            output: [
              {
                content: [{ text: "一次性结果", type: "output_text" }],
                role: "assistant",
                type: "message",
              },
            ],
          }),
        ),
      ) as never,
      protocol: "openai",
      providerId: "opencode",
    });
    expect(
      await collect(
        transport.stream({
          ...request,
          model: { ...request.model, modelId: "gpt-5.6-luna" },
        }),
      ),
    ).toEqual([
      { type: "started" },
      { delta: "一次性结果", type: "delta" },
      { type: "completed", output: "一次性结果" },
    ]);

    const failing = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          '{"type":"error","code":"rate_limit_exceeded","message":"slow down"}\n\n',
        ]),
      ) as never,
      protocol: "openai",
      providerId: "opencode",
    });
    await expect(
      collect(
        failing.stream({
          ...request,
          model: { ...request.model, modelId: "gpt-5.6-luna" },
        }),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("adds Anthropic thinking parameters for claude-protocol reasoning efforts", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.anthropic.com",
      fetch: vi.fn(async (_url: string, init: TestFetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        return sseResponse([
          '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"正文"}}\n\n',
          '{"type":"message_stop"}\n\n',
        ]);
      }) as never,
      protocol: "claude",
      providerId: "anthropic",
    });

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "claude-sonnet" },
        reasoningEffort: "high",
      }),
    );
    expect(bodies[0].thinking).toEqual({
      budget_tokens: 8_192,
      type: "enabled",
    });

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "claude-sonnet" },
        reasoningEffort: "none",
      }),
    );
    expect(bodies[1].thinking).toEqual({ type: "disabled" });

    await collect(
      transport.stream({
        ...request,
        model: { ...request.model, modelId: "claude-sonnet" },
        reasoningEffort: "auto",
      }),
    );
    expect(bodies[2]).not.toHaveProperty("thinking");
  });
  it("retries an empty response stream with a lowered reasoning effort and still yields the final text", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.xyz/v1",
      fetch: vi.fn(async (_url: string, init: TestFetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        // 第一次：只有 reasoning 没有正文（服务端偶发空响应）；
        // 第二次：正常正文。
        if (bodies.length === 1) {
          return sseResponse([
            '{"choices":[{"delta":{"reasoning_content":"先想一想"}}]}\n\n',
          ]);
        }
        return sseResponse([
          '{"choices":[{"delta":{"reasoning_content":"再想想"}}]}\n\n',
          '{"choices":[{"delta":{"content":"降档后成功输出"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
      providerId: "wawazz",
    });

    await expect(
      collect(
        transport.stream({
          ...request,
          model: { ...request.model, modelId: "gpt-5.6-sol" },
          reasoningEffort: "max",
        }),
      ),
    ).resolves.toEqual([
      { type: "started" },
      { type: "reasoning", delta: "先想一想" },
      { type: "started" },
      { type: "reasoning", delta: "再想想" },
      { type: "delta", delta: "降档后成功输出" },
      { type: "completed", output: "降档后成功输出" },
    ]);
    // 空响应重试时降档：max → xhigh。
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reasoning_effort).toBe("max");
    expect(bodies[1].reasoning_effort).toBe("xhigh");
  });

  it("fails with a retryable PROVIDER_EARLY_END after repeated empty responses", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.xyz/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          '{"choices":[{"delta":{"reasoning_content":"只有思考"}}]}\n\n',
        ]),
      ) as never,
      protocol: "openai",
      providerId: "wawazz",
    });

    await expect(
      collect(
        transport.stream({
          ...request,
          model: { ...request.model, modelId: "gpt-5.6-sol" },
          reasoningEffort: "high",
        }),
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_EARLY_END",
      retryable: true,
    });
  });

  it("keeps a long reasoning stream alive as long as frames keep arriving", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch: vi.fn(
        async () =>
          ({
            body,
            json: vi.fn(async () => ({})),
            ok: true,
            status: 200,
            text: vi.fn(async () => ""),
          }) as never,
      ) as never,
      protocol: "openai",
      // 1 秒 idle：模拟 120 秒真实阈值的小倍数（构造器下限 1000ms）。
      timeoutMs: 1_000,
    });
    const collected = collect(transport.stream(request));
    // 每 300ms 推一帧，持续 5 帧（总时长 1500ms，远超 1000ms idle 阈值）：
    // 只要有帧到达就绝不能中断。
    for (const frame of [
      'data: {"choices":[{"delta":{"reasoning_content":"思考一"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"思考二"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"思考三"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"思考四"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":"stop"}]}\n\n',
    ]) {
      await vi.advanceTimersByTimeAsync(300);
      controller!.enqueue(encoder.encode(frame));
    }
    controller!.enqueue(encoder.encode("data: [DONE]\n\n"));
    await vi.advanceTimersByTimeAsync(10);
    await expect(collected).resolves.toEqual([
      { type: "started" },
      { type: "reasoning", delta: "思考一" },
      { type: "reasoning", delta: "思考二" },
      { type: "reasoning", delta: "思考三" },
      { type: "reasoning", delta: "思考四" },
      { type: "delta", delta: "正文" },
      { type: "completed", output: "正文" },
    ]);
    vi.useRealTimers();
  });

  it("fails with TIMEOUT when the response stream goes completely silent", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch: vi.fn(
        async () =>
          ({
            body,
            json: vi.fn(async () => ({})),
            ok: true,
            status: 200,
            text: vi.fn(async () => ""),
          }) as never,
      ) as never,
      protocol: "openai",
      timeoutMs: 1_000,
    });
    const collected = collect(transport.stream(request));
    // 先挂载断言再推进时钟，避免提前 reject 变成 unhandled rejection。
    const outcome = expect(collected).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller!.enqueue(
      encoder.encode(
        'data: {"choices":[{"delta":{"reasoning_content":"开头"}}]}\n\n',
      ),
    );
    // 之后不再有任何帧：idle 到期必须判定挂起。
    await vi.advanceTimersByTimeAsync(2_000);
    await outcome;
    vi.useRealTimers();
  });

  it("passes user-defined custom reasoning efforts through verbatim", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return sseResponse([
        '{"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai",
    });
    await collect(transport.stream({ ...request, reasoningEffort: "ultra" }));
    expect(bodies[0].reasoning_effort).toBe("ultra");
  });

  it("keeps custom efforts unmapped on the DeepSeek branch and applies official mappings to built-ins", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return sseResponse([
        '{"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.deepseek.com",
      fetch,
      protocol: "openai",
    });
    const deepSeekModel = {
      ...request.model,
      modelId: "deepseek-v4-flash",
    };
    // 自定义档位不套 minimal→low 映射，原样透传。
    await collect(
      transport.stream({
        ...request,
        model: deepSeekModel,
        reasoningEffort: "ultra",
      }),
    );
    expect(bodies[0]).toMatchObject({
      reasoning_effort: "ultra",
      thinking: { type: "enabled" },
    });
    // 官方映射表：minimal→low、medium→high、xhigh→high。
    for (const [selected, sent] of [
      ["minimal", "low"],
      ["medium", "high"],
      ["xhigh", "high"],
    ] as const) {
      await collect(
        transport.stream({
          ...request,
          model: deepSeekModel,
          reasoningEffort: selected,
        }),
      );
      expect(bodies.at(-1), selected).toMatchObject({
        reasoning_effort: sent,
        thinking: { type: "enabled" },
      });
    }
  });

  it("drops reasoning on retry when the endpoint rejects a custom effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return jsonResponse(
          { error: { message: "unsupported parameter reasoning_effort" } },
          400,
        );
      }
      return sseResponse([
        '{"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.example.test/v1",
      fetch,
      protocol: "openai",
    });
    await collect(transport.stream({ ...request, reasoningEffort: "ultra" }));
    expect(bodies[0]).toMatchObject({ reasoning_effort: "ultra" });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("retries transient network failures (connection reset) inside the request attempt loop", async () => {
    // wawazz 等中转站会间歇性重置连接（fetch 抛 TypeError）：
    // 网络错误必须走 requestAttempt 重试，不能直接让任务失败。
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
      bodies.push(init.body ?? "");
      if (bodies.length < 3) {
        throw new TypeError("fetch failed");
      }
      return sseResponse([
        '{"choices":[{"delta":{"content":"重试后成功"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.example/v1",
      fetch,
      protocol: "openai",
    });
    const events = await collect(transport.stream(request));
    expect(events.at(-1)).toEqual({
      output: "重试后成功",
      type: "completed",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after three consecutive network failures with a retryable error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.example/v1",
      fetch,
      protocol: "openai",
    });
    await expect(collect(transport.stream(request))).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors such as authentication failures", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.example/v1",
      fetch,
      protocol: "openai",
    });
    // 401 类错误由 responseError 抛出（非 retryable），不触发网络重试。
    const authFetch = vi.fn(async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401),
    );
    const authTransport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://wawazz.example/v1",
      fetch: authFetch,
      protocol: "openai",
    });
    await expect(collect(authTransport.stream(request))).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    });
    expect(authFetch).toHaveBeenCalledTimes(1);
    void transport;
  });
});
