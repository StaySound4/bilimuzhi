import type {
  AiGenerationRequest,
  AiPromptMessage,
  AiReasoningEffort,
} from "../../application/ai/provider-contract";
import { AiProviderError } from "../../application/ai/provider-error";
import type { UntrustedAiProviderTransport } from "./streaming-provider-adapter";

export type AiHttpProtocol =
  "claude" | "gemini" | "openai" | "openai-responses";

interface FetchResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface FetchInit {
  readonly body?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET" | "POST";
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

export interface HttpAiProviderTransportDependencies {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: (url: string, init: FetchInit) => Promise<FetchResponse>;
  readonly protocol: AiHttpProtocol;
  readonly providerId?: string;
  /** Resolves a processed local Blob only at the final HTTP boundary. */
  readonly resolveAttachment?: (attachmentId: string) => Promise<Blob | null>;
  readonly timeoutMs?: number;
}

interface AttemptOptions {
  readonly omitReasoning: boolean;
  /** 0: 完整预算；1: 保守预算；2: 完全不带 max_tokens。 */
  readonly tokenLimitStage: number;
}

interface RequestShape {
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
}

interface ResolvedAttachment {
  readonly base64: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI provider base URL is invalid",
      false,
    );
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password
  ) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI provider base URL is invalid",
      false,
    );
  }
  url.search = "";
  url.hash = "";
  return url;
}

function appendPath(baseUrl: URL, path: string): URL {
  const result = new URL(baseUrl.toString());
  const basePath = result.pathname.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  result.pathname = `${basePath}${normalizedPath}`.replace(/\/{2,}/g, "/");
  return result;
}

/**
 * Resolves an OpenAI-compatible endpoint without assuming that the configured
 * value is only an origin. Users commonly paste either the provider root, its
 * versioned compatibility prefix, or the complete chat endpoint. Treat the
 * terminal endpoint as configuration syntax rather than another path segment
 * so `/chat/completions`, `/responses`, `/messages` and `/models` are each
 * present exactly once.
 */
function openAiEndpoint(
  baseUrl: URL,
  endpoint: "chat/completions" | "models" | "messages" | "responses",
): URL {
  const result = new URL(baseUrl.toString());
  const segments = result.pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  if (
    segments.length >= 2 &&
    segments.at(-2) === "chat" &&
    segments.at(-1) === "completions"
  ) {
    segments.splice(-2, 2);
  } else if (
    segments.at(-1) === "models" ||
    segments.at(-1) === "messages" ||
    segments.at(-1) === "responses"
  ) {
    segments.pop();
  }
  segments.push(...endpoint.split("/"));
  result.pathname = `/${segments.join("/")}`;
  return result;
}

function headersFor(
  protocol: AiHttpProtocol,
  apiKey: string,
  providerId?: string,
) {
  if (protocol === "claude") {
    return Object.freeze({
      "anthropic-version": "2023-06-01",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    });
  }
  if (protocol === "gemini") {
    return Object.freeze({
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    });
  }
  if (providerId === "mimo") {
    return Object.freeze({
      Accept: "text/event-stream",
      "api-key": apiKey,
      "Content-Type": "application/json",
    });
  }
  return Object.freeze({
    Accept: "text/event-stream",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
}

function modelHeadersFor(
  protocol: AiHttpProtocol,
  apiKey: string,
  providerId?: string,
) {
  const headers = { ...headersFor(protocol, apiKey, providerId) };
  delete (headers as { "Content-Type"?: string })["Content-Type"];
  (headers as { Accept?: string }).Accept = "application/json";
  return Object.freeze(headers);
}

function normalizeSystemMessages(messages: readonly AiPromptMessage[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
}

/**
 * 候选护栏（aliuapi 调查，见 .scratch/reasoning-effort-suite/
 * 09-aliuapi-experiment-design.md）：多条 system 合并为单条（换行连接）。
 * 默认不启用——仅当对照实验证明「多 system 丢弃」是根因后才接入
 * openAiBody。本函数作为可测的组装原语供回归测试验证护栏有效性。
 */
export function mergeSystemMessages(
  messages: readonly AiPromptMessage[],
): readonly AiPromptMessage[] {
  const systems = messages.filter((message) => message.role === "system");
  if (systems.length <= 1) return messages;
  return Object.freeze([
    Object.freeze({
      content: normalizeSystemMessages(messages),
      role: "system",
    }),
    ...messages.filter((message) => message.role !== "system"),
  ]);
}

function finalUserMessageIndex(messages: readonly AiPromptMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function openAiMessages(
  request: AiGenerationRequest,
  attachments: readonly ResolvedAttachment[],
): readonly unknown[] {
  if (attachments.length === 0) return request.messages;
  const target = finalUserMessageIndex(request.messages);
  if (target < 0) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI image request has no user message",
      false,
    );
  }
  return request.messages.map((message, index) =>
    index === target
      ? {
          content: [
            { text: message.content, type: "text" },
            ...attachments.map((attachment) => ({
              image_url: {
                url: `data:${attachment.mimeType};base64,${attachment.base64}`,
              },
              type: "image_url",
            })),
          ],
          role: message.role,
        }
      : message,
  );
}

function isDeepSeekModel(
  providerId: string | undefined,
  modelId: string,
): boolean {
  // 与 model-capability-registry 的已知模型判定保持一致，
  // 避免未知 deepseek- 前缀模型获得 DeepSeek 专属参数。
  return (
    providerId === "deepseek" ||
    /(?:^|\/)deepseek-(?:chat|reasoner|v[0-9]|r[0-9])/i.test(modelId)
  );
}

// opencode.ai zen/go 网关的模型表明确按端点区分：
// gpt-5.6-luna 走 Responses API（/responses），
// MiniMax M2/M3 与 Qwen3.x 走 Anthropic 兼容（/messages），
// 其余走 OpenAI 兼容（/chat/completions）。路由只在该网关生效，
// 其他 baseUrl（如 wawazz.xyz）保持默认 chat/completions，避免误路由。
const OPCODE_AI_GATEWAY_HOSTS = new Set(["opencode.ai", "www.opencode.ai"]);

function isResponsesApiModel(modelId: string): boolean {
  return /^gpt-5\.6-luna$/i.test(modelId);
}

function isAnthropicMessagesModel(modelId: string): boolean {
  return /^(?:minimax-m\d(?:\.\d+)?|qwen3(?:\.\d+)?(?:[-.]|$))/i.test(modelId);
}

type OpenAiEndpointKind = "chat" | "messages" | "responses";

function resolveOpenAiEndpointKind(
  baseUrl: URL,
  modelId: string,
): OpenAiEndpointKind {
  if (!OPCODE_AI_GATEWAY_HOSTS.has(baseUrl.hostname)) return "chat";
  if (isResponsesApiModel(modelId)) return "responses";
  if (isAnthropicMessagesModel(modelId)) return "messages";
  return "chat";
}
function outputTokenLimit(
  request: AiGenerationRequest,
  providerId: string | undefined,
  conservative: boolean,
  protocol?: AiHttpProtocol,
): number {
  // DeepSeek 思考模式会把 reasoning 与正文都算进 max_tokens；
  // V4 官方输出上限 384K，完整预算给足 32K；
  // 若端点拒绝（中转站常见限制），降级到 16K 再重试。
  if (isDeepSeekModel(providerId, request.model.modelId)) {
    return conservative ? 16_384 : 32_768;
  }
  // Responses 协议的 max_output_tokens 同样包含推理 token
  // （官方建议预留 ≥25k 推理预算）：summary 给 16K/32K 档，
  // 与 deepseek 分支的预算逻辑对齐；chat/completions 保持原预算。
  if (protocol === "openai-responses" && request.kind === "summary") {
    return conservative ? 16_384 : 32_768;
  }
  return request.kind === "chat" ? 4_096 : 8_192;
}

// DeepSeek 官方映射表（api-docs.deepseek.com/guides/thinking_mode）：
// minimal 无对应档 → 最低的 low；medium/xhigh 服务端按 high 处理，客户端直接发 high；
// 用户自定义档位（自建值）不套任何映射，原样透传。
function deepSeekReasoningEffort(effort: string): string {
  if (effort === "minimal") return "low";
  if (effort === "medium" || effort === "xhigh") return "high";
  return effort;
}

// Anthropic extended thinking / MiniMax/Qwen Anthropic 兼容端点的思考预算：
// 档位 → budget_tokens（1024 的倍数，官方下限 1024）。
const ANTHROPIC_THINKING_BUDGET: Readonly<
  Record<Exclude<AiReasoningEffort, "none">, number>
> = Object.freeze({
  minimal: 1_024,
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  xhigh: 16_384,
  max: 32_768,
});

function openAiBody(
  request: AiGenerationRequest,
  options: AttemptOptions,
  attachments: readonly ResolvedAttachment[],
  providerId: string | undefined,
): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    messages: openAiMessages(request, attachments),
    model: request.model.modelId,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.tokenLimitStage < 2) {
    body.max_tokens = outputTokenLimit(
      request,
      providerId,
      options.tokenLimitStage === 1,
    );
  }
  if (!options.omitReasoning) {
    const effort = request.reasoningEffort;
    if (isDeepSeekModel(providerId, request.model.modelId)) {
      // DeepSeek 思考开关与强度是独立参数：thinking.type 控制开关，
      // 顶层 reasoning_effort 控制强度；auto 交给服务端默认。
      if (effort === "none") {
        body.thinking = { type: "disabled" };
      } else if (effort !== "auto") {
        body.thinking = { type: "enabled" };
        body.reasoning_effort = deepSeekReasoningEffort(effort);
      }
    } else if (effort !== "auto" && effort !== "none") {
      body.reasoning_effort = effort;
    }
  }
  return Object.freeze(body);
}

function openAiResponsesInput(
  request: AiGenerationRequest,
  attachments: readonly ResolvedAttachment[],
): readonly unknown[] {
  // system 消息已合并进 instructions，input 只含 user/assistant 历史。
  const nonSystem = request.messages.filter(
    (message) => message.role !== "system",
  );
  if (attachments.length === 0) {
    return nonSystem.map((message) =>
      Object.freeze({ content: message.content, role: message.role }),
    );
  }
  const target = finalUserMessageIndex(nonSystem);
  if (target < 0) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI image request has no user message",
      false,
    );
  }
  return nonSystem.map((message, index) =>
    index === target
      ? Object.freeze({
          content: [
            Object.freeze({ text: message.content, type: "input_text" }),
            ...attachments.map((attachment) =>
              Object.freeze({
                image_url: `data:${attachment.mimeType};base64,${attachment.base64}`,
                type: "input_image",
              }),
            ),
          ],
          role: message.role,
        })
      : Object.freeze({ content: message.content, role: message.role }),
  );
}

/**
 * OpenAI Responses API 请求体（gpt-5.6-luna 等）。
 * 流式事件与 chat/completions 不同：正文走 response.output_text.delta，
 * 推理可见部分走 response.reasoning_summary_text.delta。
 */
function responsesBody(
  request: AiGenerationRequest,
  options: AttemptOptions,
  attachments: readonly ResolvedAttachment[],
  providerId: string | undefined,
  protocol: AiHttpProtocol,
): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    input: openAiResponsesInput(request, attachments),
    model: request.model.modelId,
    stream: true,
  };
  // system 消息全部合并为 instructions（多 system 用换行连接）。
  const instructions = normalizeSystemMessages(request.messages);
  if (instructions) body.instructions = instructions;
  if (options.tokenLimitStage < 2) {
    body.max_output_tokens = outputTokenLimit(
      request,
      providerId,
      options.tokenLimitStage === 1,
      protocol,
    );
  }
  if (!options.omitReasoning) {
    const effort = request.reasoningEffort;
    // Responses API 的 reasoning.effort 不接收 none：关闭思考时不传该字段。
    if (effort !== "auto" && effort !== "none") {
      body.reasoning = { effort };
    }
  }
  return Object.freeze(body);
}

function claudeBody(
  request: AiGenerationRequest,
  options: AttemptOptions,
  attachments: readonly ResolvedAttachment[],
  providerId: string | undefined,
): Readonly<Record<string, unknown>> {
  const nonSystem = request.messages.filter(
    (message) => message.role !== "system",
  );
  const target = finalUserMessageIndex(nonSystem);
  if (attachments.length > 0 && target < 0) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI image request has no user message",
      false,
    );
  }
  const body: Record<string, unknown> = {
    messages: nonSystem.map((message, index) => ({
      content: [
        { text: message.content, type: "text" },
        ...(index === target
          ? attachments.map((attachment) => ({
              source: {
                data: attachment.base64,
                media_type: attachment.mimeType,
                type: "base64",
              },
              type: "image",
            }))
          : []),
      ],
      role: message.role,
    })),
    model: request.model.modelId,
    stream: true,
  };
  const system = normalizeSystemMessages(request.messages);
  if (system) body.system = system;
  if (options.tokenLimitStage < 2) {
    body.max_tokens = outputTokenLimit(
      request,
      providerId,
      options.tokenLimitStage === 1,
    );
  }
  if (!options.omitReasoning) {
    const effort = request.reasoningEffort;
    // Anthropic 原生与 MiniMax/Qwen 的 Anthropic 兼容端点共用 thinking 参数：
    // enabled 需要 budget_tokens（1024 的倍数）；档位拿不准时按档位给预算，
    // 端点拒绝会走传输层降级重试（omitReasoning）。
    if (effort === "none") {
      body.thinking = { type: "disabled" };
    } else if (effort !== "auto") {
      // 自定义档位没有 budget 映射，按中间档 medium 的预算启用思考。
      const budget =
        (ANTHROPIC_THINKING_BUDGET as Readonly<Record<string, number>>)[
          effort
        ] ?? ANTHROPIC_THINKING_BUDGET.medium;
      body.thinking = {
        budget_tokens: budget,
        type: "enabled",
      };
    }
  }
  return Object.freeze(body);
}

function geminiBody(
  request: AiGenerationRequest,
  options: AttemptOptions,
  attachments: readonly ResolvedAttachment[],
  providerId: string | undefined,
): Readonly<Record<string, unknown>> {
  const nonSystem = request.messages.filter(
    (message) => message.role !== "system",
  );
  const target = finalUserMessageIndex(nonSystem);
  if (attachments.length > 0 && target < 0) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The AI image request has no user message",
      false,
    );
  }
  const body: Record<string, unknown> = {
    contents: nonSystem.map((message, index) => ({
      parts: [
        { text: message.content },
        ...(index === target
          ? attachments.map((attachment) => ({
              inlineData: {
                data: attachment.base64,
                mimeType: attachment.mimeType,
              },
            }))
          : []),
      ],
      role: message.role === "assistant" ? "model" : "user",
    })),
  };
  const system = normalizeSystemMessages(request.messages);
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (options.tokenLimitStage < 2) {
    body.generationConfig = {
      maxOutputTokens: outputTokenLimit(
        request,
        providerId,
        options.tokenLimitStage === 1,
      ),
    };
  }
  return Object.freeze(body);
}

function createRequestShape(
  baseUrl: URL,
  apiKey: string,
  protocol: AiHttpProtocol,
  providerId: string | undefined,
  request: AiGenerationRequest,
  options: AttemptOptions,
  attachments: readonly ResolvedAttachment[],
): RequestShape {
  if (protocol === "claude") {
    return Object.freeze({
      body: claudeBody(request, options, attachments, providerId),
      headers: headersFor(protocol, apiKey, providerId),
      url: appendPath(baseUrl, "/v1/messages").toString(),
    });
  }
  if (protocol === "gemini") {
    const url = appendPath(
      baseUrl,
      `/models/${encodeURIComponent(request.model.modelId)}:streamGenerateContent`,
    );
    url.searchParams.set("alt", "sse");
    return Object.freeze({
      body: geminiBody(request, options, attachments, providerId),
      headers: headersFor(protocol, apiKey, providerId),
      url: url.toString(),
    });
  }
  // 显式 openai-responses 协议：直接走 Responses 端点（不依赖网关路由）。
  if (protocol === "openai-responses") {
    return Object.freeze({
      body: responsesBody(request, options, attachments, providerId, protocol),
      headers: headersFor("openai", apiKey, providerId),
      url: openAiEndpoint(baseUrl, "responses").toString(),
    });
  }
  // openai 协议内按（网关, 模型）路由：Responses / Anthropic 兼容 / chat。
  const endpointKind = resolveOpenAiEndpointKind(
    baseUrl,
    request.model.modelId,
  );
  if (endpointKind === "responses") {
    return Object.freeze({
      body: responsesBody(request, options, attachments, providerId, protocol),
      headers: headersFor("openai", apiKey, providerId),
      url: openAiEndpoint(baseUrl, "responses").toString(),
    });
  }
  if (endpointKind === "messages") {
    return Object.freeze({
      body: claudeBody(request, options, attachments, providerId),
      headers: headersFor("claude", apiKey, providerId),
      url: openAiEndpoint(baseUrl, "messages").toString(),
    });
  }
  return Object.freeze({
    body: openAiBody(request, options, attachments, providerId),
    headers: headersFor("openai", apiKey, providerId),
    url: openAiEndpoint(baseUrl, "chat/completions").toString(),
  });
}

async function boundedResponseText(response: FetchResponse): Promise<string> {
  try {
    return (await response.text()).slice(0, 32_768);
  } catch {
    return "";
  }
}

function isReasoningParameterRejected(status: number, text: string): boolean {
  return (
    (status === 400 || status === 422) &&
    /(?:reasoning(?:_effort)?|thinking)/i.test(text) &&
    /(?:unsupported|unknown|unrecognized|invalid|not allowed)/i.test(text)
  );
}

function isTokenLimitRejected(status: number, text: string): boolean {
  // 任何 max_tokens 相关的 400/422 都降级重试（预算分档），
  // 中转站常见的 “exceeds the maximum” 措辞不匹配 unsupported 类关键词，
  // 不应因此让请求直接失败。
  return (
    (status === 400 || status === 422) &&
    /(?:max_tokens|max_output_tokens|maxoutputtokens|max token)/i.test(text)
  );
}

function responseError(status: number, text: string): AiProviderError {
  if (status === 401) {
    return new AiProviderError(
      "AUTHENTICATION_REQUIRED",
      "The AI provider requires authentication",
      false,
    );
  }
  if (status === 403) {
    return new AiProviderError(
      "PERMISSION_DENIED",
      "The AI provider denied this request",
      false,
    );
  }
  if (status === 413 || /context|too many tokens|token limit/i.test(text)) {
    return new AiProviderError(
      "CONTEXT_TOO_LONG",
      "The AI request exceeds the available context",
      false,
    );
  }
  if (status === 429) {
    return new AiProviderError(
      "RATE_LIMITED",
      "The AI provider is rate limited",
      true,
    );
  }
  if (status >= 500 && status <= 599) {
    return new AiProviderError(
      "NETWORK_ERROR",
      "The AI provider is temporarily unavailable",
      true,
    );
  }
  if (status === 400 || status === 422) {
    return new AiProviderError(
      "UNSUPPORTED_CAPABILITY",
      "The AI provider rejected this request configuration",
      false,
    );
  }
  return new AiProviderError(
    "NETWORK_ERROR",
    "The AI provider request could not be completed",
    true,
  );
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completeBody = "";
  let emittedSsePayload = false;
  let idleExpired = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // 帧活性检测：只要流在持续到达（reasoning/正文/keep-alive 都算），
  // 计时器不断重置；只有超过 idleTimeoutMs 一帧都没有才判定挂起，
  // 推理再长也不会被时钟误杀。
  const armIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = globalThis.setTimeout(() => {
      idleExpired = true;
      void reader.cancel().catch(() => undefined);
    }, idleTimeoutMs);
  };
  try {
    armIdle();
    while (true) {
      const { done, value } = await reader.read();
      armIdle();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      if (
        !emittedSsePayload &&
        completeBody.length + decoded.length > 2_000_000
      ) {
        throw new AiProviderError(
          "INTERNAL_ERROR",
          "The AI provider returned an invalid response",
          false,
        );
      }
      if (!emittedSsePayload) completeBody += decoded;
      buffer += decoded;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const payload = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (payload) {
          emittedSsePayload = true;
          completeBody = "";
          yield payload;
        }
      }
    }
    const tail = decoder.decode();
    if (!emittedSsePayload && completeBody.length + tail.length > 2_000_000) {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "The AI provider returned an invalid response",
        false,
      );
    }
    if (!emittedSsePayload) completeBody += tail;
    buffer += tail;
    const payload = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (payload) {
      emittedSsePayload = true;
      completeBody = "";
      yield payload;
    }
    // Some OpenAI-compatible providers honor the same endpoint and request
    // schema but return one ordinary JSON object. Only use this fallback when
    // no SSE `data:` frame was observed, so trailing bytes after `[DONE]` can
    // never be reinterpreted as a second response.
    if (idleExpired) {
      // 帧活性超时：流彻底静默，绝不把半截数据当作完成结果。
      throw new AiProviderError(
        "TIMEOUT",
        "The AI provider stream stopped responding",
        true,
      );
    }
    if (!emittedSsePayload && completeBody.trim().length > 0) {
      yield completeBody.trim();
    }
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer);
    reader.releaseLock();
  }
}

function safeString(value: unknown): string {
  return typeof value === "string" && value.length <= 2_000_000 ? value : "";
}

interface ProviderTextBlock {
  readonly blockId: string | null;
  readonly text: string;
}

interface ProviderTextBoundaryState {
  emitted: boolean;
  lastBlockId: string | null;
}

function providerTextBlocks(
  value: unknown,
  blockPrefix: string,
): readonly ProviderTextBlock[] {
  if (typeof value === "string") {
    const text = safeString(value);
    return text.length === 0 ? [] : [Object.freeze({ blockId: null, text })];
  }
  if (!Array.isArray(value)) return [];
  return Object.freeze(
    value.flatMap((candidate, index): ProviderTextBlock[] => {
      const text =
        typeof candidate === "string"
          ? safeString(candidate)
          : isRecord(candidate)
            ? safeString(
                candidate.text ?? candidate.content ?? candidate.summary,
              )
            : "";
      return text.length === 0
        ? []
        : [
            Object.freeze({
              blockId: `${blockPrefix}:${index}`,
              text,
            }),
          ];
    }),
  );
}

function appendProviderTextBlocks(
  blocks: readonly ProviderTextBlock[],
  state: ProviderTextBoundaryState,
): string {
  let value = "";
  for (const block of blocks) {
    if (
      state.emitted &&
      block.blockId !== null &&
      block.blockId !== state.lastBlockId
    ) {
      value += "\n\n";
    }
    value += block.text;
    state.emitted = true;
    state.lastBlockId = block.blockId;
  }
  return value;
}

type TransportImageDescriptor =
  | { readonly kind: "remote"; readonly url: string }
  | {
      readonly base64: string;
      readonly kind: "inline";
      readonly mimeType: string;
    };

function remoteImageDescriptor(
  value: unknown,
): TransportImageDescriptor | null {
  const url =
    typeof value === "string"
      ? value
      : isRecord(value) && typeof value.url === "string"
        ? value.url
        : null;
  return url !== null && url.length > 0 && url.length <= 2_048
    ? { kind: "remote", url }
    : null;
}

function inlineImageDescriptor(
  value: unknown,
): TransportImageDescriptor | null {
  if (!isRecord(value)) return null;
  const base64 = value.data ?? value.base64 ?? value.b64_json;
  const mimeType = value.mimeType ?? value.mime_type ?? value.media_type;
  if (
    typeof base64 !== "string" ||
    base64.length === 0 ||
    base64.length > Math.ceil((5 * 1_024 * 1_024 * 4) / 3) + 4 ||
    typeof mimeType !== "string" ||
    mimeType.length > 64
  ) {
    return null;
  }
  return { base64, kind: "inline", mimeType };
}

function appendImage(
  target: TransportImageDescriptor[],
  descriptor: TransportImageDescriptor | null,
): void {
  if (descriptor !== null && target.length < 16) target.push(descriptor);
}

function openAiImages(value: unknown): readonly TransportImageDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.choices)) return [];
  const images: TransportImageDescriptor[] = [];
  for (const choice of value.choices) {
    if (!isRecord(choice)) continue;
    for (const container of [choice.delta, choice.message]) {
      if (!isRecord(container)) continue;
      if (Array.isArray(container.images)) {
        for (const image of container.images) {
          if (!isRecord(image)) continue;
          appendImage(
            images,
            inlineImageDescriptor(image) ??
              remoteImageDescriptor(image.image_url ?? image.url),
          );
        }
      }
      if (Array.isArray(container.content)) {
        for (const part of container.content) {
          if (!isRecord(part)) continue;
          if (part.type === "image_url" || part.type === "output_image") {
            appendImage(
              images,
              inlineImageDescriptor(part) ??
                remoteImageDescriptor(part.image_url ?? part.url),
            );
          }
        }
      }
    }
  }
  if (Array.isArray(value.data)) {
    for (const image of value.data) {
      appendImage(
        images,
        inlineImageDescriptor(image) ?? remoteImageDescriptor(image),
      );
    }
  }
  return images;
}

function claudeImages(value: unknown): readonly TransportImageDescriptor[] {
  if (!isRecord(value) || value.type !== "content_block_start") return [];
  if (!isRecord(value.content_block)) return [];
  const block = value.content_block;
  if (block.type !== "image" || !isRecord(block.source)) return [];
  return [
    inlineImageDescriptor(block.source) ??
      remoteImageDescriptor(block.source.url),
  ].filter(
    (descriptor): descriptor is TransportImageDescriptor => descriptor !== null,
  );
}

function geminiImages(value: unknown): readonly TransportImageDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return [];
  const images: TransportImageDescriptor[] = [];
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
    if (!Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue;
      appendImage(
        images,
        inlineImageDescriptor(part.inlineData ?? part.inline_data) ??
          remoteImageDescriptor(
            isRecord(part.fileData)
              ? part.fileData.fileUri
              : isRecord(part.file_data)
                ? part.file_data.file_uri
                : null,
          ),
      );
    }
  }
  return images;
}

function openAiDeltas(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  if (!isRecord(choice)) return null;
  const delta = isRecord(choice.delta) ? choice.delta : null;
  const message = isRecord(choice.message) ? choice.message : null;
  // 兼容层可能把增量放进 message 字段，甚至与 delta 并存；
  // 合并两者以免丢失 reasoning 或正文，delta 优先。
  const content =
    delta === null && message === null
      ? null
      : { ...(message ?? {}), ...(delta ?? {}) };
  if (content === null) return null;
  return {
    reasoning: providerTextBlocks(
      content.reasoning_content ??
        content.reasoning_summary ??
        content.reasoning ??
        content.thinking,
      "openai:reasoning",
    ),
    text: providerTextBlocks(content.content ?? content.text, "openai:content"),
  };
}

function responsesDeltaText(value: Record<string, unknown>): string {
  return isRecord(value.delta) && typeof value.delta.text === "string"
    ? safeString(value.delta.text)
    : "";
}

function responsesStreamError(value: Record<string, unknown>): AiProviderError {
  const error = isRecord(value.error) ? value.error : value;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (/rate_limit/i.test(code)) {
    return new AiProviderError(
      "RATE_LIMITED",
      "The AI provider is rate limited",
      true,
    );
  }
  if (/auth/i.test(code)) {
    return new AiProviderError(
      "AUTHENTICATION_REQUIRED",
      "The AI provider requires authentication",
      false,
    );
  }
  if (/permission/i.test(code)) {
    return new AiProviderError(
      "PERMISSION_DENIED",
      "The AI provider denied this request",
      false,
    );
  }
  if (/context|token/i.test(code)) {
    return new AiProviderError(
      "CONTEXT_TOO_LONG",
      "The AI request exceeds the available context",
      false,
    );
  }
  if (/invalid|unsupported|not_found|unknown/i.test(code)) {
    return new AiProviderError(
      "UNSUPPORTED_CAPABILITY",
      message || "The AI provider rejected this request configuration",
      false,
    );
  }
  return new AiProviderError(
    "NETWORK_ERROR",
    "The AI provider request could not be completed",
    true,
  );
}

type NormalizedResponsesPayload = {
  readonly done: boolean;
  readonly images: readonly TransportImageDescriptor[];
  readonly reasoning: readonly ProviderTextBlock[];
  readonly text: readonly ProviderTextBlock[];
};
/**
 * 提取 OpenAI Responses reasoning item 的文本：content（reasoning_text
 * 完整思维链）优先，summary（推理摘要）兜底。content/summary 均可能是
 * 字符串或 [{ text, type }] 数组。
 */
function reasoningItemText(item: Record<string, unknown>): string {
  const content = item.content;
  if (Array.isArray(content)) {
    const parts = content
      .flatMap((part) =>
        isRecord(part) && typeof part.text === "string"
          ? [safeString(part.text)]
          : [],
      )
      .join("");
    if (parts.length > 0) return parts;
  } else if (typeof content === "string") {
    const text = safeString(content);
    if (text.length > 0) return text;
  }
  const summary = item.summary;
  if (typeof summary === "string") return safeString(summary);
  if (Array.isArray(summary)) {
    return summary
      .flatMap((part) =>
        isRecord(part) && typeof part.text === "string"
          ? [safeString(part.text)]
          : [],
      )
      .join("");
  }
  return "";
}

/**
 * OpenAI Responses API（gpt-5.6-luna）统一解析：流式事件与一次性 JSON。
 * 事件：response.output_text.delta（正文）、response.reasoning_summary_text.delta
 * （推理摘要）、response.completed（终态）、response.incomplete / response.failed
 * / error（错误）；非流式回退解析 {output: [...]}。
 */
function normalizeResponsesPayload(
  value: Record<string, unknown>,
): NormalizedResponsesPayload | null {
  if (
    typeof value.type === "string" &&
    (value.type === "error" || value.type.startsWith("response."))
  ) {
    const type = value.type;
    if (type === "response.output_text.delta") {
      const text = responsesDeltaText(value);
      return {
        done: false,
        images: [],
        reasoning: [],
        text: text.length === 0 ? [] : [Object.freeze({ blockId: null, text })],
      };
    }
    // 完整思维链（reasoning_text）与摘要（summary_text）都是 reasoning 增量。
    if (
      type === "response.reasoning_text.delta" ||
      type === "response.reasoning_summary_text.delta"
    ) {
      const text = responsesDeltaText(value);
      return {
        done: false,
        images: [],
        reasoning:
          text.length === 0 ? [] : [Object.freeze({ blockId: null, text })],
        text: [],
      };
    }
    if (type === "response.completed") {
      return { done: true, images: [], reasoning: [], text: [] };
    }
    if (type === "response.incomplete") {
      const details = isRecord(value.incomplete_details)
        ? value.incomplete_details
        : {};
      const reason = typeof details.reason === "string" ? details.reason : "";
      if (/max_output_tokens/i.test(reason)) {
        throw new AiProviderError(
          "OUTPUT_LIMIT_REACHED",
          "The AI provider reached its output limit",
          true,
        );
      }
      if (/filter|safety|blocked/i.test(reason)) {
        throw new AiProviderError(
          "CONTENT_SAFETY_BLOCKED",
          "The AI provider blocked this content",
          false,
        );
      }
      throw new AiProviderError(
        "NETWORK_ERROR",
        "The AI provider response was interrupted",
        true,
      );
    }
    if (type === "response.failed" || type === "error") {
      throw responsesStreamError(value);
    }
    return null;
  }
  if (Array.isArray(value.output)) {
    const text: ProviderTextBlock[] = [];
    const reasoning: ProviderTextBlock[] = [];
    for (const item of value.output) {
      if (!isRecord(item)) continue;
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!isRecord(part)) continue;
          const partText =
            typeof part.text === "string" ? safeString(part.text) : "";
          if (partText.length === 0) continue;
          if (part.type === "output_text") {
            text.push(Object.freeze({ blockId: null, text: partText }));
          } else if (
            part.type === "reasoning" ||
            part.type === "summary_text"
          ) {
            reasoning.push(Object.freeze({ blockId: null, text: partText }));
          }
        }
      } else if (item.type === "reasoning") {
        // content（reasoning_text 完整思维链）优先，summary 兜底
        // （对齐 Cherry Studio 的 reasoningItemText 语义）。
        const chainText = reasoningItemText(item);
        if (chainText.length > 0) {
          reasoning.push(Object.freeze({ blockId: null, text: chainText }));
        }
      }
    }
    return {
      done: true,
      images: [],
      reasoning: Object.freeze(reasoning),
      text: Object.freeze(text),
    };
  }
  if (isRecord(value.error)) {
    throw responsesStreamError(value);
  }
  return null;
}
function claudeDeltas(value: unknown) {
  if (!isRecord(value) || value.type !== "content_block_delta") return null;
  if (!isRecord(value.delta)) return null;
  const index =
    typeof value.index === "number" && Number.isSafeInteger(value.index)
      ? value.index
      : null;
  if (value.delta.type === "text_delta") {
    const text = safeString(value.delta.text);
    return {
      reasoning: [],
      text:
        text.length === 0
          ? []
          : [
              Object.freeze({
                blockId: index === null ? null : `claude:text:${index}`,
                text,
              }),
            ],
    };
  }
  if (value.delta.type === "thinking_delta") {
    const text = safeString(value.delta.thinking);
    return {
      reasoning:
        text.length === 0
          ? []
          : [
              Object.freeze({
                blockId: index === null ? null : `claude:thinking:${index}`,
                text,
              }),
            ],
      text: [],
    };
  }
  return null;
}

function geminiDeltas(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return null;
  const candidate = value.candidates[0];
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    return null;
  }
  const text: ProviderTextBlock[] = [];
  const reasoning: ProviderTextBlock[] = [];
  for (const [index, part] of candidate.content.parts.entries()) {
    if (!isRecord(part)) continue;
    const partText = safeString(part.text);
    if (!partText) continue;
    (part.thought === true ? reasoning : text).push(
      Object.freeze({
        blockId: `gemini:${part.thought === true ? "thought" : "text"}:${index}`,
        text: partText,
      }),
    );
  }
  return {
    reasoning: Object.freeze(reasoning),
    text: Object.freeze(text),
  };
}

function normalizePayload(protocol: AiHttpProtocol, payload: string) {
  if (payload === "[DONE]") {
    return { done: true, images: [], reasoning: [], text: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (protocol === "claude" && isRecord(value)) {
    const stopReason =
      value.type === "message_delta" && isRecord(value.delta)
        ? value.delta.stop_reason
        : undefined;
    if (stopReason === "max_tokens") {
      throw new AiProviderError(
        "OUTPUT_LIMIT_REACHED",
        "The AI provider reached its output limit",
        true,
      );
    }
    if (
      typeof stopReason === "string" &&
      /content_filter|safety|blocked|refusal/i.test(stopReason)
    ) {
      throw new AiProviderError(
        "CONTENT_SAFETY_BLOCKED",
        "The AI provider blocked this content",
        false,
      );
    }
    if (value.type === "message_stop") {
      return { done: true, images: [], reasoning: [], text: [] };
    }
  }
  if (
    (protocol === "openai" || protocol === "openai-responses") &&
    isRecord(value)
  ) {
    const responses = normalizeResponsesPayload(value);
    if (responses !== null) return responses;
  }
  const deltas =
    protocol === "claude"
      ? claudeDeltas(value)
      : protocol === "gemini"
        ? geminiDeltas(value)
        : openAiDeltas(value);
  if (deltas === null) return null;
  let done = false;
  if (
    (protocol === "openai" || protocol === "openai-responses") &&
    isRecord(value) &&
    Array.isArray(value.choices)
  ) {
    const finishReasons = value.choices.flatMap((choice) =>
      isRecord(choice) && typeof choice.finish_reason === "string"
        ? [choice.finish_reason]
        : [],
    );
    if (finishReasons.some((reason) => reason === "length")) {
      throw new AiProviderError(
        "OUTPUT_LIMIT_REACHED",
        "The AI provider reached its output limit",
        true,
      );
    }
    if (
      finishReasons.some(
        (reason) =>
          reason === "insufficient_system_resource" ||
          reason === "insufficient_system_resources",
      )
    ) {
      // DeepSeek 在系统推理资源不足时会打断生成（思考或正文只剩半截）。
      // 这是 Provider 侧容量问题而非输出上限，用独立可重试错误码，
      // 避免误导用户去精简输出。
      throw new AiProviderError(
        "PROVIDER_BUSY",
        "The AI provider interrupted generation due to limited system resources",
        true,
      );
    }
    if (
      finishReasons.some((reason) =>
        /content_filter|safety|blocked/i.test(reason),
      )
    ) {
      throw new AiProviderError(
        "CONTENT_SAFETY_BLOCKED",
        "The AI provider blocked this content",
        false,
      );
    }
    done = finishReasons.length > 0;
  }
  if (
    protocol === "gemini" &&
    isRecord(value) &&
    Array.isArray(value.candidates)
  ) {
    const finishReasons = value.candidates.flatMap((candidate) =>
      isRecord(candidate) && typeof candidate.finishReason === "string"
        ? [candidate.finishReason]
        : [],
    );
    if (finishReasons.some((reason) => reason === "MAX_TOKENS")) {
      throw new AiProviderError(
        "OUTPUT_LIMIT_REACHED",
        "The AI provider reached its output limit",
        true,
      );
    }
    if (
      finishReasons.some((reason) =>
        /SAFETY|BLOCKLIST|PROHIBITED|RECITATION/i.test(reason),
      )
    ) {
      throw new AiProviderError(
        "CONTENT_SAFETY_BLOCKED",
        "The AI provider blocked this content",
        false,
      );
    }
    done = finishReasons.length > 0;
  }
  const images =
    protocol === "claude"
      ? claudeImages(value)
      : protocol === "gemini"
        ? geminiImages(value)
        : openAiImages(value);
  return { done, images, ...deltas };
}

function normalizeGeminiModelList(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.models)) return value;
  return {
    models: value.models.map((model) => {
      if (!isRecord(model) || typeof model.name !== "string") return model;
      const modelId = model.name.replace(/^models\//, "");
      return {
        id: modelId,
        // Capability fields the Gemini listing actually declares are kept so
        // reasoning support and context limits come from the provider itself.
        ...(typeof model.inputTokenLimit === "number"
          ? { inputTokenLimit: model.inputTokenLimit }
          : {}),
        ...(typeof model.outputTokenLimit === "number"
          ? { outputTokenLimit: model.outputTokenLimit }
          : {}),
        ...(Array.isArray(model.supportedGenerationMethods)
          ? { supportedGenerationMethods: model.supportedGenerationMethods }
          : {}),
        ...(model.thinking === true ? { thinking: true } : {}),
        name:
          typeof model.displayName === "string" ? model.displayName : modelId,
      };
    }),
  };
}

function readModelArray(
  value: unknown,
  key: "data" | "models",
): readonly unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function bytesToBase64(bytes: Uint8Array): string {
  // 24 KiB is divisible by three, so concatenating independently encoded
  // chunks introduces no intermediate padding and avoids argument limits.
  const chunkSize = 24 * 1_024;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = "";
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index] ?? 0);
    }
    chunks.push(btoa(binary));
  }
  return chunks.join("");
}

async function resolveRequestAttachments(
  request: AiGenerationRequest,
  resolver: HttpAiProviderTransportDependencies["resolveAttachment"],
): Promise<readonly ResolvedAttachment[]> {
  const handles = request.attachments ?? [];
  if (handles.length === 0) return Object.freeze([]);
  if (resolver === undefined) {
    throw new AiProviderError(
      "INTERNAL_ERROR",
      "The local image attachment resolver is unavailable",
      false,
    );
  }
  const resolved: ResolvedAttachment[] = [];
  for (const handle of handles) {
    let blob: Blob | null;
    try {
      blob = await resolver(handle.attachmentId);
    } catch {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "The local image attachment could not be read",
        false,
      );
    }
    if (
      !(blob instanceof Blob) ||
      blob.type !== handle.mimeType ||
      blob.size !== handle.sizeBytes
    ) {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "The local image attachment is no longer authoritative",
        false,
      );
    }
    let bytes: ArrayBuffer;
    try {
      // The processed Blob is read exactly once; bounded compatibility retries
      // reuse only the transient base64 already destined for provider JSON.
      bytes = await blob.arrayBuffer();
    } catch {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "The local image attachment could not be read",
        false,
      );
    }
    resolved.push({
      base64: bytesToBase64(new Uint8Array(bytes)),
      mimeType: handle.mimeType,
    });
  }
  return Object.freeze(resolved);
}

export class HttpAiProviderTransport implements UntrustedAiProviderTransport {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(
    private readonly dependencies: HttpAiProviderTransportDependencies,
  ) {
    this.baseUrl = safeBaseUrl(dependencies.baseUrl);
    this.timeoutMs = dependencies.timeoutMs ?? 120_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1_000 ||
      this.timeoutMs > 300_000
    ) {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "The AI provider timeout is invalid",
        false,
      );
    }
  }

  private async fetch(
    url: string,
    init: Omit<FetchInit, "redirect" | "signal">,
  ): Promise<FetchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.dependencies.fetch(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AiProviderError(
          "TIMEOUT",
          "The AI provider request timed out",
          true,
        );
      }
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError(
        "NETWORK_ERROR",
        "The AI provider request could not be completed",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async discoverModels(): Promise<unknown> {
    const url =
      this.dependencies.protocol === "openai" ||
      this.dependencies.protocol === "openai-responses"
        ? openAiEndpoint(this.baseUrl, "models")
        : appendPath(
            this.baseUrl,
            this.dependencies.protocol === "claude" ? "/v1/models" : "/models",
          );
    const collected: unknown[] = [];
    for (let page = 0; page < 10; page += 1) {
      const response = await this.fetch(url.toString(), {
        headers: modelHeadersFor(
          this.dependencies.protocol,
          this.dependencies.apiKey,
          this.dependencies.providerId,
        ),
        method: "GET",
      });
      if (!response.ok) {
        throw responseError(
          response.status,
          await boundedResponseText(response),
        );
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new AiProviderError(
          "INTERNAL_ERROR",
          "The AI provider returned an invalid model list",
          false,
        );
      }
      if (
        this.dependencies.protocol === "openai" ||
        this.dependencies.protocol === "openai-responses"
      ) {
        return value;
      }

      if (this.dependencies.protocol === "gemini") {
        const normalized = normalizeGeminiModelList(value);
        collected.push(...readModelArray(normalized, "models"));
        if (collected.length > 1_000) break;
        const nextPageToken =
          isRecord(value) && typeof value.nextPageToken === "string"
            ? value.nextPageToken
            : "";
        if (!nextPageToken) return { models: collected };
        url.searchParams.set("pageToken", nextPageToken);
        continue;
      }

      collected.push(...readModelArray(value, "data"));
      if (collected.length > 1_000) break;
      const hasMore = isRecord(value) && value.has_more === true;
      const lastId =
        isRecord(value) && typeof value.last_id === "string"
          ? value.last_id
          : "";
      if (!hasMore || !lastId) return { data: collected };
      url.searchParams.set("after_id", lastId);
    }
    return this.dependencies.protocol === "gemini"
      ? { models: collected.slice(0, 1_000) }
      : { data: collected.slice(0, 1_000) };
  }

  async *stream(request: AiGenerationRequest): AsyncIterable<unknown> {
    const attachments = await resolveRequestAttachments(
      request,
      this.dependencies.resolveAttachment,
    );
    let omitReasoning = false;
    let tokenLimitStage = 0;
    // 空响应重试时逐级降低推理档位：中转站对高推理档位偶发「只思考不
    // 输出正文」的空响应，降档后模型更可能直接产出正文。
    let effectiveRequest = request;
    const EFFORT_DESCENT: Readonly<Record<string, AiReasoningEffort | null>> =
      Object.freeze({
        auto: "high",
        max: "xhigh",
        xhigh: "high",
        high: "medium",
        medium: "low",
        low: "minimal",
        minimal: "none",
        none: null,
      });
    // 请求与流消费共用 attempt 循环：HTTP 层失败、参数被拒、以及
    // 「流正常关闭但没有产出正文」（服务端偶发空响应，常见于中转站对
    // 推理模型限流/负载抖动）都会整体重试。空响应重试时关闭 reasoning
    // 参数（omitReasoning），让重试请求直接产出正文，避免重复思维链。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: FetchResponse | null = null;
      for (let requestAttempt = 0; requestAttempt < 3; requestAttempt += 1) {
        const shape = createRequestShape(
          this.baseUrl,
          this.dependencies.apiKey,
          this.dependencies.protocol,
          this.dependencies.providerId,
          effectiveRequest,
          { omitReasoning, tokenLimitStage },
          attachments,
        );
        try {
          response = await this.fetch(shape.url, {
            body: JSON.stringify(shape.body),
            headers: shape.headers,
            method: "POST",
          });
        } catch (error) {
          // 网络层失败（连接重置/瞬时超时，如 wawazz 等中转站间歇性
          // reset）在 requestAttempt 内重试；非可重试错误（鉴权/权限/
          // 参数被拒）直接抛出，不浪费重试。
          if (!(error instanceof AiProviderError) || !error.retryable) {
            throw error;
          }
          if (requestAttempt < 2) continue;
          throw error;
        }
        if (response.ok) break;
        const text = await boundedResponseText(response);
        if (
          !omitReasoning &&
          effectiveRequest.reasoningEffort !== "auto" &&
          effectiveRequest.reasoningEffort !== "none" &&
          isReasoningParameterRejected(response.status, text)
        ) {
          omitReasoning = true;
          continue;
        }
        if (
          this.dependencies.protocol !== "claude" &&
          tokenLimitStage < 2 &&
          isTokenLimitRejected(response.status, text)
        ) {
          tokenLimitStage += 1;
          continue;
        }
        throw responseError(response.status, text);
      }

      if (response === null || !response.ok) {
        throw new AiProviderError(
          "UNSUPPORTED_CAPABILITY",
          "The AI provider rejected this request configuration",
          false,
        );
      }
      if (response.body === null) {
        throw new AiProviderError(
          "NETWORK_ERROR",
          "The AI provider returned no response stream",
          true,
        );
      }

      yield { type: "started" };
      let output = "";
      const reasoningBoundary: ProviderTextBoundaryState = {
        emitted: false,
        lastBlockId: null,
      };
      const textBoundary: ProviderTextBoundaryState = {
        emitted: false,
        lastBlockId: null,
      };
      const emittedImages = new Set<string>();
      for await (const payload of readSseData(
        response.body,
        // 帧活性阈值与响应头超时共用：120 秒无任何帧即判定挂起。
        this.timeoutMs,
      )) {
        const normalized = normalizePayload(
          this.dependencies.protocol,
          payload,
        );
        if (normalized === null) continue;
        const reasoning = appendProviderTextBlocks(
          normalized.reasoning,
          reasoningBoundary,
        );
        if (reasoning) {
          yield { delta: reasoning, type: "reasoning" };
        }
        for (const descriptor of normalized.images) {
          const key =
            descriptor.kind === "remote"
              ? `remote:${descriptor.url}`
              : `inline:${descriptor.mimeType}:${descriptor.base64}`;
          if (emittedImages.has(key)) continue;
          emittedImages.add(key);
          yield { descriptor, type: "image-output" };
        }
        const text = appendProviderTextBlocks(normalized.text, textBoundary);
        if (text) {
          if (output.length + text.length > 2_000_000) {
            throw new AiProviderError(
              "INTERNAL_ERROR",
              "The AI provider returned an invalid response",
              false,
            );
          }
          output += text;
          yield { delta: text, type: "delta" };
        }
        if (normalized.done) {
          break;
        }
      }
      // 终态以显式 finish_reason 为准（message 形态的中间帧不算）；
      // 兼容层若正常关闭流但不发终态信号，只要已有正文也视为完成。
      if (output.length > 0) {
        yield { output, type: "completed" };
        return;
      }
      // 流已关闭但没有产出任何正文（可能只输出了思维链，或完全静默）：
      // 服务端偶发，逐级降低推理档位重试（auto 也改为显式档位），
      // 高推理档位无法继续降级时按可重试错误上报。
      const lowered = EFFORT_DESCENT[effectiveRequest.reasoningEffort];
      if (lowered !== null && attempt < 3) {
        effectiveRequest = {
          ...effectiveRequest,
          reasoningEffort: lowered,
        };
        continue;
      }
      break;
    }
    throw new AiProviderError(
      "PROVIDER_EARLY_END",
      "The AI provider ended without producing any output",
      true,
    );
  }
}

export function createHttpAiProviderTransport(
  dependencies: HttpAiProviderTransportDependencies,
): UntrustedAiProviderTransport {
  return new HttpAiProviderTransport(dependencies);
}
