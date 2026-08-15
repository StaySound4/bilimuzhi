import { describe, expect, it, vi } from "vitest";

import { HttpAiProviderTransport } from "../../src/infrastructure/ai/http-provider-transport";

const testCredential = "fixture-token-v13-not-a-real-credential";

type FetchInit = {
  body?: string;
  headers: Readonly<Record<string, string>>;
  method: "GET" | "POST";
};

function model(modelId = "deepseek-chat") {
  return {
    capabilities: {
      contextWindowCharacters: 64_000,
      maxOutputCharacters: 8_000,
      supportedReasoningEfforts: ["none", "high"],
      supportsAttachments: false,
      supportsReasoning: true,
      supportsStreaming: true,
      supportsWebSearch: false,
    },
    discoveredAt: 13,
    displayName: modelId,
    modelId,
    providerId: "fixture-provider",
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    kind: "chat",
    messages: [{ role: "user", content: "用一句话回答" }],
    model: model(),
    reasoningEffort: "high",
    ...overrides,
  } as never;
}

function jsonResponse(value: unknown, status = 200) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    json: vi.fn(async () => value),
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => JSON.stringify(value)),
  };
}

function textResponse(value: string, status: number) {
  return {
    body: null,
    json: vi.fn(async () => {
      throw new Error("not json");
    }),
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => value),
  };
}

function sseResponse(chunks: readonly string[], status = 200) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    json: vi.fn(async () => ({})),
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => chunks.join("")),
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("v13 A6 OpenAI-compatible base URL and authorization", () => {
  it.each([
    ["https://api.deepseek.com", "/chat/completions", "/models"],
    ["https://api.deepseek.com/v1", "/v1/chat/completions", "/v1/models"],
    [
      "https://api.groq.com/openai/v1",
      "/openai/v1/chat/completions",
      "/openai/v1/models",
    ],
    [
      "https://fixture.example/compatible/openai/v1/",
      "/compatible/openai/v1/chat/completions",
      "/compatible/openai/v1/models",
    ],
  ])(
    "preserves the configured prefix exactly once for %s",
    async (baseUrl, chatPath, modelsPath) => {
      const calls: Array<{ url: URL; init: FetchInit }> = [];
      const fetch = vi.fn(async (rawUrl: string, init: FetchInit) => {
        calls.push({ url: new URL(rawUrl), init });
        if (init.method === "GET")
          return jsonResponse({ data: [{ id: "deepseek-chat" }] });
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      });
      const transport = new HttpAiProviderTransport({
        apiKey: testCredential,
        baseUrl,
        fetch: fetch as never,
        protocol: "openai",
      });

      await transport.discoverModels();
      await collect(transport.stream(request()));

      expect(calls.map((call) => call.url.pathname)).toEqual([
        modelsPath,
        chatPath,
      ]);
      expect(
        calls.every((call) => !call.url.pathname.includes("/v1/v1/")),
      ).toBe(true);
      expect(
        calls.every(
          (call) =>
            call.init.headers.Authorization === `Bearer ${testCredential}`,
        ),
      ).toBe(true);
      expect(calls[0].init.headers.Accept).toBe("application/json");
      expect(calls[1].init.headers.Accept).toBe("text/event-stream");
    },
  );

  it("does not turn an existing compatible prefix into a duplicated chat suffix", async () => {
    const urls: string[] = [];
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://fixture.example/openai/v1/chat/completions",
      fetch: vi.fn(async (url: string) => {
        urls.push(url);
        return sseResponse([
          '{"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
    });
    await collect(transport.stream(request()));
    expect(new URL(urls[0]).pathname).toBe("/openai/v1/chat/completions");
  });
});

describe("v13 A6 ordinary JSON, SSE reasoning, completion, and failures", () => {
  it("normalizes a successful ordinary JSON chat response into the same event boundary", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "普通响应结论",
              reasoning_content: "普通响应思考",
            },
          },
        ],
      }),
    );
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: fetch as never,
      protocol: "openai",
    });

    await expect(collect(transport.stream(request()))).resolves.toEqual([
      { type: "started" },
      { type: "reasoning", delta: "普通响应思考" },
      { type: "delta", delta: "普通响应结论" },
      { type: "completed", output: "普通响应结论" },
    ]);
  });

  it("streams Provider reasoning separately, joins text, and terminates exactly once on [DONE]", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          ": keep-alive\n\n",
          'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning":"再想","content":"案"}}]}\n\n',
          "data: [DONE]\n\n",
          'data: {"choices":[{"delta":{"content":"不得出现"}}]}\n\n',
        ]),
      ) as never,
      protocol: "openai",
    });

    expect(await collect(transport.stream(request()))).toEqual([
      { type: "started" },
      { type: "reasoning", delta: "先想" },
      { type: "delta", delta: "答" },
      { type: "reasoning", delta: "再想" },
      { type: "delta", delta: "案" },
      { type: "completed", output: "答案" },
    ]);
  });

  it("does not treat message-shaped streaming deltas as terminal before an explicit finish signal", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"message":{"reasoning_content":"先分析"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"补充分析"},"message":{"content":"完整回答"},"finish_reason":"stop"}]}\n\n',
        ]),
      ) as never,
      protocol: "openai",
    });

    expect(await collect(transport.stream(request()))).toEqual([
      { type: "started" },
      { type: "reasoning", delta: "先分析" },
      { type: "reasoning", delta: "补充分析" },
      { type: "delta", delta: "完整回答" },
      { type: "completed", output: "完整回答" },
    ]);
  });

  it("reports an explicit output-limit failure instead of validating truncated output", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"半截 JSON"},"finish_reason":"length"}]}\n\n',
        ]),
      ) as never,
      protocol: "openai",
    });

    await expect(
      collect(transport.stream(request({ kind: "segments" }))),
    ).rejects.toMatchObject({
      code: "OUTPUT_LIMIT_REACHED",
      retryable: true,
    });
  });

  it.each([
    [
      "claude",
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
    ],
    [
      "gemini",
      'data: {"candidates":[{"content":{"parts":[{"text":"半截"}]},"finishReason":"MAX_TOKENS"}]}\n\n',
    ],
  ] as const)(
    "maps %s output limits to OUTPUT_LIMIT_REACHED",
    async (protocol, frame) => {
      const transport = new HttpAiProviderTransport({
        apiKey: testCredential,
        baseUrl: "https://provider.example.test/v1",
        fetch: vi.fn(async () => sseResponse([frame])) as never,
        protocol,
      });

      await expect(
        collect(transport.stream(request({ kind: "summary" }))),
      ).rejects.toMatchObject({
        code: "OUTPUT_LIMIT_REACHED",
        retryable: true,
      });
    },
  );

  it("allocates a larger output budget to summary and segment artifacts", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async (_url: string, init: FetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
    });

    await collect(transport.stream(request({ kind: "chat" })));
    await collect(transport.stream(request({ kind: "summary" })));
    await collect(transport.stream(request({ kind: "segments" })));

    expect(bodies.map((body) => body.max_tokens)).toEqual([
      // deepseek-chat 模型按 DeepSeek 预算分配（含思考额度）。
      32_768, 32_768, 32_768,
    ]);
  });

  it("retries only rejected optional parameters and keeps the successful request authorized", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string, init: FetchInit) => {
      bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      if (bodies.length === 1)
        return textResponse("reasoning_effort is unsupported", 400);
      if (bodies.length === 2)
        return textResponse("max_tokens is unsupported", 422);
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"降级成功"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    });
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: fetch as never,
      protocol: "openai",
    });

    expect(await collect(transport.stream(request()))).toContainEqual({
      type: "completed",
      output: "降级成功",
    });
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toHaveProperty("reasoning_effort");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1].max_tokens).toBe(32_768);
    expect(bodies[2]).not.toHaveProperty("reasoning_effort");
    // token 预算按档降级：stage1 使用保守预算而不是直接去掉。
    expect(bodies[2].max_tokens).toBe(16_384);
  });

  it("returns a typed redacted provider error instead of echoing credentials or request content", async () => {
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async () =>
        textResponse(
          `upstream rejected ${testCredential} and 用一句话回答`,
          500,
        ),
      ) as never,
      protocol: "openai",
    });

    let caught: unknown;
    try {
      await collect(transport.stream(request()));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "NETWORK_ERROR", retryable: true });
    expect(String((caught as Error).message)).not.toContain(testCredential);
    expect(String((caught as Error).message)).not.toContain("用一句话回答");
  });
});

describe("v13 A7 DeepSeek thinking-mode parameters", () => {
  async function deepseekTransport(
    fetch: (url: string, init: FetchInit) => Promise<unknown>,
  ) {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async (url: string, init: FetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        return fetch(url, init);
      }) as never,
      protocol: "openai",
      providerId: "deepseek",
    });
    return { bodies, transport };
  }

  it.each([
    // 官方映射表（api-docs.deepseek.com/guides/thinking_mode）：
    // minimal→low；medium/xhigh 服务端按 high 处理，客户端直接发 high。
    ["low", "low"],
    ["minimal", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "high"],
    ["max", "max"],
  ] as const)(
    "maps effort %s to reasoning_effort=%s with thinking enabled",
    async (effort, expectedEffort) => {
      const { bodies, transport } = await deepseekTransport(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
        ]),
      );
      await collect(transport.stream(request({ reasoningEffort: effort })));
      expect(bodies[0].thinking).toEqual({ type: "enabled" });
      expect(bodies[0].reasoning_effort).toBe(expectedEffort);
    },
  );

  it("disables thinking for none and omits parameters for auto", async () => {
    const { bodies, transport } = await deepseekTransport(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
      ]),
    );
    await collect(transport.stream(request({ reasoningEffort: "none" })));
    await collect(transport.stream(request({ reasoningEffort: "auto" })));
    expect(bodies[0].thinking).toEqual({ type: "disabled" });
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1]).not.toHaveProperty("thinking");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("allocates a larger output budget to DeepSeek chat and artifacts", async () => {
    const { bodies, transport } = await deepseekTransport(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
      ]),
    );
    await collect(transport.stream(request({ kind: "chat" })));
    await collect(transport.stream(request({ kind: "summary" })));
    await collect(transport.stream(request({ kind: "segments" })));
    expect(bodies.map((body) => body.max_tokens)).toEqual([
      32_768, 32_768, 32_768,
    ]);
  });

  it("reports insufficient system resources as a retryable provider-busy failure", async () => {
    const { transport } = await deepseekTransport(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"半截正文"},"finish_reason":"insufficient_system_resource"}]}\n\n',
      ]),
    );
    await expect(collect(transport.stream(request()))).rejects.toMatchObject({
      code: "PROVIDER_BUSY",
      retryable: true,
    });
  });

  it("completes with collected text when a compatible stream closes without a terminal signal", async () => {
    const { transport } = await deepseekTransport(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"完整正文"}}]}\n\n']),
    );
    expect(await collect(transport.stream(request()))).toEqual([
      { type: "started" },
      { type: "delta", delta: "完整正文" },
      { type: "completed", output: "完整正文" },
    ]);
  });

  it("never requests json_object for segments", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async (_url: string, init: FetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        return sseResponse([
          '{"choices":[{"delta":{"content":"分段输出"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
      providerId: "deepseek",
    });

    await collect(transport.stream(request({ kind: "segments" })));
    await collect(transport.stream(request({ kind: "chat" })));
    await collect(transport.stream(request({ kind: "summary" })));
    // 切片 9 之后分段是两行文本格式契约，不再强制 json_object，
    // 也不会因端点拒绝 response_format 而发起去格式重试。
    for (const body of bodies) {
      expect(body).not.toHaveProperty("response_format");
    }
    expect(bodies).toHaveLength(3);
  });

  it("drops max_tokens entirely when the endpoint keeps rejecting the budget", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const transport = new HttpAiProviderTransport({
      apiKey: testCredential,
      baseUrl: "https://api.deepseek.com/v1",
      fetch: vi.fn(async (_url: string, init: FetchInit) => {
        bodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
        if (bodies.length <= 2)
          return textResponse("max_tokens exceeds the maximum allowed", 400);
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"降级完成"},"finish_reason":"stop"}]}\n\n',
        ]);
      }) as never,
      protocol: "openai",
      providerId: "deepseek",
    });
    expect(await collect(transport.stream(request()))).toContainEqual({
      type: "completed",
      output: "降级完成",
    });
    expect(bodies.map((body) => body.max_tokens)).toEqual([
      32_768,
      16_384,
      undefined,
    ]);
  });
});
