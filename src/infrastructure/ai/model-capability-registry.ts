import type {
  AiModelCapabilities,
  AiReasoningEffort,
} from "../../application/ai/provider-contract";

const NON_REASONING_CAPABILITIES = Object.freeze({
  contextWindowCharacters: 32_000,
  maxOutputCharacters: 8_000,
  supportedReasoningEfforts: Object.freeze(["none"] as const),
  supportsAttachments: false,
  supportsReasoning: false,
  supportsStreaming: true,
  supportsWebSearch: false,
});

function reasoningCapabilities(
  efforts: AiModelCapabilities["supportedReasoningEfforts"],
): AiModelCapabilities {
  return Object.freeze({
    contextWindowCharacters: 120_000,
    maxOutputCharacters: 32_000,
    supportedReasoningEfforts: Object.freeze([...efforts]),
    supportsAttachments: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsWebSearch: false,
  });
}

/**
 * 显式家族条目表（数据表驱动）：运行时只消费本表，不做散落正则。
 * 匹配规则集中在条目的 `matches` 谓词；档位集合、默认档位与来源
 * URL 均为可审计数据。命中顺序 = 表顺序（先具体后宽泛）。
 */
export interface ModelFamilyEntry {
  readonly familyId: string;
  /** 官方文档来源标注（供 UI/帮助文案引用）。 */
  readonly sourceUrl: string;
  /** 服务端官方映射表（如 DeepSeek medium→high）；UI 据此展示映射说明。 */
  readonly effortMappings?: Readonly<Record<string, string>>;
  readonly defaultReasoningEffort: AiReasoningEffort;
  readonly supportedReasoningEfforts: readonly AiReasoningEffort[];
  readonly capabilities: AiModelCapabilities;
  matches(modelId: string, providerId?: string): boolean;
}

function familyEntry(
  entry: Omit<ModelFamilyEntry, "capabilities"> & {
    readonly capabilities?: AiModelCapabilities;
  },
): ModelFamilyEntry {
  return Object.freeze({
    ...entry,
    capabilities: Object.freeze(
      entry.capabilities ??
        reasoningCapabilities(entry.supportedReasoningEfforts),
    ),
  });
}

const ALL_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AiReasoningEffort[]);

const MODEL_FAMILIES: readonly ModelFamilyEntry[] = Object.freeze([
  // OpenRouter：官方 reasoning_effort enum（xhigh/high/medium/low/minimal/none）。
  // 按 providerId 识别（OpenRouter 模型 ID 透传各家命名，无统一前缀）。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "openrouter",
    matches: (modelId, providerId) =>
      providerId === "openrouter" || /^openrouter\//i.test(modelId),
    sourceUrl: "https://openrouter.ai/docs/api-reference/parameters",
    supportedReasoningEfforts: Object.freeze([
      "xhigh",
      "high",
      "medium",
      "low",
      "minimal",
      "none",
    ]),
  }),
  // Ollama：reasoning_effort high/medium/low/max/none（OpenAI 兼容端点）。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "ollama",
    matches: (modelId, providerId) =>
      providerId === "ollama" || /^ollama\//i.test(modelId),
    sourceUrl: "https://docs.ollama.com/openai",
    supportedReasoningEfforts: Object.freeze([
      "high",
      "medium",
      "low",
      "max",
      "none",
    ]),
  }),
  // OpenAI gpt-5.6-sol（官方模型页）：none/low/medium(默认)/high/xhigh/max，
  // 无 minimal、无 ultra。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "openai-gpt-5.6-sol",
    matches: (modelId) => /^(?:openai\/)?gpt-5\.6-sol$/i.test(modelId),
    sourceUrl: "https://platform.openai.com/docs/models/gpt-5.6-sol",
    supportedReasoningEfforts: Object.freeze([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
  }),
  // OpenAI 官方明确档位的 gpt-5.2/5.3/5.4/codex 系列：none..xhigh。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "openai-gpt-5-extended",
    matches: (modelId) =>
      /^(?:openai\/)?gpt-5(?:[.-](?:2|3|4|codex))(?:\b|$)/i.test(modelId),
    sourceUrl: "https://platform.openai.com/docs/guides/reasoning",
    supportedReasoningEfforts: Object.freeze([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
  // gpt-5 基础版官方档位明确：none..high。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "openai-gpt-5",
    matches: (modelId) => /^(?:openai\/)?gpt-5$/i.test(modelId),
    sourceUrl: "https://platform.openai.com/docs/guides/reasoning",
    supportedReasoningEfforts: Object.freeze([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
    ]),
  }),
  // 其余 gpt-5.x（5.1/5.5/5.6-luna 等第三方网关变体）档位拿不准，
  // 按产品规则放宽到全部档位。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "openai-gpt-5-full",
    matches: (modelId) => /^(?:openai\/)?gpt-5[.-]/i.test(modelId),
    sourceUrl: "https://platform.openai.com/docs/guides/reasoning",
    supportedReasoningEfforts: ALL_EFFORTS,
  }),
  // OpenAI o 系列：none..high。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "openai-o-series",
    matches: (modelId) => /^(?:openai\/)?o[134](?:$|[.-])/i.test(modelId),
    sourceUrl: "https://platform.openai.com/docs/guides/reasoning",
    supportedReasoningEfforts: Object.freeze(["none", "low", "medium", "high"]),
  }),
  // DeepSeek（官方 thinking 指南）：请求可选档位仅 low/high/max，
  // medium/xhigh 服务端按 high 处理不提供；none = 关闭思考。
  // deepseek-pro 等此前漏匹配的变体必须归入本家族。
  familyEntry({
    defaultReasoningEffort: "high",
    effortMappings: Object.freeze({ medium: "high", xhigh: "high" }),
    familyId: "deepseek",
    matches: (modelId) =>
      /^(?:[^/]+\/)?deepseek-(?:chat|reasoner|pro|v[0-9]|r[0-9])/i.test(
        modelId,
      ),
    sourceUrl: "https://api-docs.deepseek.com/guides/thinking_mode",
    supportedReasoningEfforts: Object.freeze(["none", "low", "high", "max"]),
  }),
  // Anthropic Claude（Effort 参数）：low/medium/high/xhigh/max，默认 high；
  // xhigh 需显式设置；none = 关闭思考。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "anthropic",
    matches: (modelId) => /^(?:anthropic\/)?claude-/i.test(modelId),
    sourceUrl: "https://docs.claude.com/en/docs/build-with-claude/effort",
    supportedReasoningEfforts: Object.freeze([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
  }),
  // Gemini：thinkingConfig.thinkingBudget 是 token 预算而非枚举档位，
  // 档位集合映射为 none/低/中/高（预算档位）。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "gemini",
    matches: (modelId) => /^(?:google\/)?gemini-/i.test(modelId),
    sourceUrl: "https://ai.google.dev/gemini-api/docs/thinking",
    supportedReasoningEfforts: Object.freeze(["none", "low", "medium", "high"]),
  }),
  // 智谱 GLM-5.2+（官方深度思考文档）：顶层 reasoning_effort，
  // 可选 max/xhigh/high/medium/low/minimal/none。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "glm",
    matches: (modelId) => /^(?:[^/]+\/)?glm-5/i.test(modelId),
    sourceUrl: "https://docs.z.ai",
    supportedReasoningEfforts: ALL_EFFORTS,
  }),
  // Kimi K3（官方文档）：顶层 reasoning_effort，仅 low/high/max，
  // 始终推理不可关闭（不提供 none）。
  familyEntry({
    defaultReasoningEffort: "high",
    familyId: "kimi-k3",
    matches: (modelId) => /^(?:[^/]+\/)?kimi-k3/i.test(modelId),
    sourceUrl: "https://platform.moonshot.cn/docs",
    supportedReasoningEfforts: Object.freeze(["low", "high", "max"]),
  }),
  // 以下第三方/网关模型档位拿不准，全部放宽到全档位（传输层自动降级）。
  familyEntry({
    defaultReasoningEffort: "medium",
    familyId: "full-reasoning-fallback",
    matches: (modelId) =>
      /^(?:[^/]+\/)?(?:kimi-k2|grok-4|mimo(?:-v2)?|minimax-m[23]|qwen3|hy3)(?:$|[.-])/i.test(
        modelId,
      ),
    sourceUrl: "https://platform.openai.com/docs/guides/reasoning",
    supportedReasoningEfforts: ALL_EFFORTS,
  }),
]);

export function resolveKnownModelFamilies(): readonly ModelFamilyEntry[] {
  return MODEL_FAMILIES;
}

export function resolveKnownModelFamily(
  modelId: string,
  providerId?: string,
): ModelFamilyEntry | null {
  const normalized = modelId.toLowerCase();
  for (const entry of MODEL_FAMILIES) {
    if (entry.matches(normalized, providerId)) return entry;
  }
  return null;
}

export function resolveKnownModelCapabilities(
  modelId: string,
  providerId?: string,
): AiModelCapabilities | null {
  return resolveKnownModelFamily(modelId, providerId)?.capabilities ?? null;
}

export function createConservativeFallbackCapabilities(): AiModelCapabilities {
  return NON_REASONING_CAPABILITIES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function firstPositiveInteger(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = positiveInteger(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Tokens are converted with a deliberately conservative characters-per-token
 * factor. CJK subtitles use far fewer characters per token than English, so
 * over-estimating would push requests past the real provider limit.
 */
const CHARACTERS_PER_TOKEN = 2;
const MAX_DECLARED_CHARACTERS = 8_000_000;

function charactersFromTokens(tokens: number): number {
  return Math.min(MAX_DECLARED_CHARACTERS, tokens * CHARACTERS_PER_TOKEN);
}

/**
 * Derives capabilities from what the provider's own model listing declares.
 * Only fields the provider actually reports are used; anything absent stays
 * with the known-model registry or the conservative fallback, so a reasoning
 * effort is never offered because of a hard-coded guess.
 */
export function readDeclaredModelCapabilities(
  entry: unknown,
  providerId?: string,
): Partial<AiModelCapabilities> | null {
  if (!isRecord(entry)) return null;
  const declared: Record<string, unknown> = {};

  const contextTokens = firstPositiveInteger(entry, [
    "context_length",
    "context_window",
    "contextWindow",
    "inputTokenLimit",
    "max_context_length",
    "max_input_tokens",
  ]);
  if (contextTokens !== null) {
    declared.contextWindowCharacters = charactersFromTokens(contextTokens);
  }

  const topProvider = isRecord(entry.top_provider) ? entry.top_provider : {};
  const outputTokens =
    firstPositiveInteger(entry, [
      "outputTokenLimit",
      "max_output_tokens",
      "max_completion_tokens",
    ]) ?? firstPositiveInteger(topProvider, ["max_completion_tokens"]);
  if (outputTokens !== null) {
    declared.maxOutputCharacters = charactersFromTokens(outputTokens);
  }

  const supportedParameters = stringList(entry.supported_parameters);
  if (supportedParameters.length > 0) {
    const supportsReasoning = supportedParameters.some(
      (parameter) =>
        parameter === "reasoning" ||
        parameter === "reasoning_effort" ||
        parameter === "include_reasoning" ||
        parameter === "thinking",
    );
    declared.supportsReasoning = supportsReasoning;
    // DeepSeek 的官方档位（low/high/max）由已知模型注册表提供，
    // 声明分支的泛化档位不覆盖，避免 UI 出现官方不支持的 medium。
    if (supportsReasoning && providerId !== "deepseek") {
      declared.supportedReasoningEfforts = Object.freeze([
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ] as const);
    }
    declared.supportsWebSearch = supportedParameters.some(
      (parameter) =>
        parameter === "web_search_options" || parameter === "web_search",
    );
  } else if (entry.thinking === true) {
    declared.supportsReasoning = true;
    declared.supportedReasoningEfforts = Object.freeze([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] as const);
  }

  const generationMethods = stringList(entry.supportedGenerationMethods);
  if (generationMethods.length > 0) {
    declared.supportsStreaming = generationMethods.some((method) =>
      method.toLowerCase().includes("stream"),
    );
  }

  const architecture = isRecord(entry.architecture) ? entry.architecture : null;
  if (architecture !== null) {
    const modalities = stringList(architecture.input_modalities);
    if (modalities.length > 0) {
      declared.supportsAttachments = modalities.includes("image");
    }
  }

  return Object.keys(declared).length === 0
    ? null
    : (Object.freeze(declared) as Partial<AiModelCapabilities>);
}

export function mergeModelCapabilities(
  base: AiModelCapabilities,
  declared: Partial<AiModelCapabilities> | null,
): AiModelCapabilities {
  if (declared === null) return base;
  const supportsReasoning =
    declared.supportsReasoning ?? base.supportsReasoning;
  const supportedReasoningEfforts =
    declared.supportedReasoningEfforts ?? base.supportedReasoningEfforts;
  return Object.freeze({
    contextWindowCharacters:
      declared.contextWindowCharacters ?? base.contextWindowCharacters,
    maxOutputCharacters:
      declared.maxOutputCharacters ?? base.maxOutputCharacters,
    supportedReasoningEfforts: supportsReasoning
      ? Object.freeze<
          readonly AiModelCapabilities["supportedReasoningEfforts"][number][]
        >(
          supportedReasoningEfforts.some((effort) => effort !== "none")
            ? [...supportedReasoningEfforts]
            : ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        )
      : Object.freeze(["none"] as const),
    supportsAttachments:
      declared.supportsAttachments ?? base.supportsAttachments,
    supportsReasoning,
    supportsStreaming: declared.supportsStreaming ?? base.supportsStreaming,
    supportsWebSearch: declared.supportsWebSearch ?? base.supportsWebSearch,
  });
}

/** 档位顺序（弱→强），用于就近映射的距离计算。 */
const EFFORT_ORDER = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AiReasoningEffort[]);

/**
 * 就近映射：内置档位不在模型支持集时，按档位顺序映射到最近的受支持档位。
 * 仅对内置档位使用；用户自定义档位（自建值）不映射、原样透传。
 * 调用方应优先查家族条目的 effortMappings（服务端官方映射表），
 * 无映射条目时再回退到本函数。
 */
export function nearestSupportedEffort(
  effort: AiReasoningEffort,
  supported: readonly AiReasoningEffort[],
): AiReasoningEffort {
  if (supported.includes(effort)) return effort;
  const targetIndex = EFFORT_ORDER.indexOf(effort);
  let best: AiReasoningEffort | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of supported) {
    const distance = Math.abs(targetIndex - EFFORT_ORDER.indexOf(candidate));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ?? effort;
}
