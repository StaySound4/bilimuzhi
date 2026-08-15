import { describe, expect, it, vi } from "vitest";

import type { AiGenerationRequest } from "../../src/application/ai/provider-contract";
import {
  HttpAiProviderTransport,
  mergeSystemMessages,
} from "../../src/infrastructure/ai/http-provider-transport";

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

function requestFor(
  messages: readonly {
    content: string;
    role: "assistant" | "system" | "user";
  }[],
): AiGenerationRequest {
  return {
    kind: "summary",
    messages,
    model: {
      capabilities: reasoningCapabilities,
      discoveredAt: 1,
      displayName: "gpt-5.6-sol",
      modelId: "gpt-5.6-sol",
      providerId: "provider-a",
    },
    reasoningEffort: "high",
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

async function collect(source: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
}

/**
 * 模拟 aliuapi 行为差异的 mock 端点：
 * - 收到多于一条 system 消息时，如同真实 aliuapi 表现——只回
 *   "未提供字幕内容"（不引用字幕参考块）；
 * - 收到合并后的单条 system 时正常回答。
 * 该行为差异是 2026-08-14 调查的候选根因之一（见
 * .scratch/reasoning-effort-suite/09-aliuapi-experiment-design.md）。
 */
function aliuapiLikeEndpoint() {
  const bodies: string[] = [];
  const fetch = vi.fn(async (_url: string, init: TestFetchInit) => {
    const body = JSON.parse(init.body ?? "{}") as {
      messages: readonly { role: string; content: string }[];
    };
    bodies.push(init.body ?? "");
    const systemCount = body.messages.filter(
      (message) => message.role === "system",
    ).length;
    if (systemCount > 1) {
      return sseResponse([
        '{"choices":[{"delta":{"content":"未提供字幕内容"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]);
    }
    return sseResponse([
      '{"choices":[{"delta":{"content":"总结字幕内容"},"finish_reason":"stop"}]}',
      "[DONE]",
    ]);
  });
  return { bodies, fetch };
}

describe("aliuapi multi-system regression guard (ticket 09)", () => {
  const multiSystemMessages = [
    { content: "你是字幕助手。", role: "system" },
    { content: "规则：只依据字幕内容回答。", role: "system" },
    { content: "【字幕参考块】...", role: "user" },
  ] as const;

  it("records the current baseline: the transport sends multiple system messages verbatim", async () => {
    const { bodies, fetch } = aliuapiLikeEndpoint();
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.aliuapi.example/v1",
      fetch,
      protocol: "openai",
    });
    const events = await collect(
      transport.stream(requestFor(multiSystemMessages)),
    );
    const body = JSON.parse(bodies[0]) as {
      messages: readonly { role: string }[];
    };
    // 基线：多条 system 原样发送（aliuapi 行为差异暴露面）。
    expect(
      body.messages.filter((message) => message.role === "system"),
    ).toHaveLength(2);
    expect(events.at(-1)).toEqual({
      output: "未提供字幕内容",
      type: "completed",
    });
  });

  it("proves the candidate guard: merging system messages succeeds on the aliuapi-like endpoint", async () => {
    const { fetch } = aliuapiLikeEndpoint();
    const transport = new HttpAiProviderTransport({
      apiKey: "secret",
      baseUrl: "https://api.aliuapi.example/v1",
      fetch,
      protocol: "openai",
    });
    const merged = mergeSystemMessages(multiSystemMessages);
    expect(merged).toEqual([
      {
        content: "你是字幕助手。\n\n规则：只依据字幕内容回答。",
        role: "system",
      },
      { content: "【字幕参考块】...", role: "user" },
    ]);
    const events = await collect(transport.stream(requestFor(merged)));
    expect(events.at(-1)).toEqual({
      output: "总结字幕内容",
      type: "completed",
    });
  });

  it("keeps the merge helper idempotent and position-stable", () => {
    const single = [{ content: "单条规则", role: "system" }] as const;
    expect(mergeSystemMessages(single)).toBe(single);
    const withUser = [
      { content: "a", role: "system" },
      { content: "u", role: "user" },
      { content: "b", role: "system" },
    ] as const;
    expect(mergeSystemMessages(withUser)).toEqual([
      { content: "a\n\nb", role: "system" },
      { content: "u", role: "user" },
    ]);
  });
});
