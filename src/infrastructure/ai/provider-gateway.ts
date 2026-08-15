import type { AiProviderGateway } from "../../application/ai/provider-contract";
import type { AiProviderProtocol } from "../../application/settings-contract";
import {
  HttpAiProviderTransport,
  type AiHttpProtocol,
  type HttpAiProviderTransportDependencies,
} from "./http-provider-transport";
import {
  createConservativeFallbackCapabilities,
  mergeModelCapabilities,
  readDeclaredModelCapabilities,
  resolveKnownModelCapabilities,
  resolveKnownModelFamily,
} from "./model-capability-registry";
import { StreamingProviderAdapter } from "./streaming-provider-adapter";

export interface AiProviderGatewayDependencies {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: HttpAiProviderTransportDependencies["fetch"];
  readonly now: () => number;
  readonly protocol: AiHttpProtocol;
  readonly providerId: string;
  readonly resolveAttachment?: HttpAiProviderTransportDependencies["resolveAttachment"];
  readonly timeoutMs?: number;
}

/** Infrastructure-only connection data. */
export interface AiProviderConnection {
  readonly baseUrl: string;
  readonly protocol: AiProviderProtocol;
  readonly providerId: string;
}

export interface AiProviderGatewayFromSettingsDependencies {
  readonly apiKey: string;
  readonly fetch: HttpAiProviderTransportDependencies["fetch"];
  readonly now: () => number;
  readonly resolveAttachment?: HttpAiProviderTransportDependencies["resolveAttachment"];
  readonly settings: AiProviderConnection;
  readonly timeoutMs?: number;
}

export function createAiProviderGateway(
  dependencies: AiProviderGatewayDependencies,
): AiProviderGateway {
  const transport = new HttpAiProviderTransport({
    apiKey: dependencies.apiKey,
    baseUrl: dependencies.baseUrl,
    fetch: dependencies.fetch,
    protocol: dependencies.protocol,
    providerId: dependencies.providerId,
    resolveAttachment: dependencies.resolveAttachment,
    timeoutMs: dependencies.timeoutMs,
  });
  return new StreamingProviderAdapter({
    fallbackCapabilities: createConservativeFallbackCapabilities(),
    mergeCapabilities: mergeModelCapabilities,
    now: dependencies.now,
    providerId: dependencies.providerId,
    readDeclaredCapabilities: readDeclaredModelCapabilities,
    resolveCapabilities: resolveKnownModelCapabilities,
    resolveFamily: resolveKnownModelFamily,
    transport,
  });
}

export function createAiProviderGatewayFromSettings(
  dependencies: AiProviderGatewayFromSettingsDependencies,
): AiProviderGateway {
  return createAiProviderGateway({
    apiKey: dependencies.apiKey,
    baseUrl: dependencies.settings.baseUrl,
    fetch: dependencies.fetch,
    now: dependencies.now,
    // openai-chat/openai 别名统一映射为 openai（chat/completions 路径），
    // openai-responses 走 Responses 端点。
    protocol:
      dependencies.settings.protocol === "openai-responses"
        ? "openai-responses"
        : "openai",
    providerId: dependencies.settings.providerId,
    resolveAttachment: dependencies.resolveAttachment,
    timeoutMs: dependencies.timeoutMs,
  });
}
