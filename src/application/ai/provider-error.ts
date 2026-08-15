export const AI_PROVIDER_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "CONTEXT_TOO_LONG",
  "PROVIDER_EARLY_END",
  "PROVIDER_BUSY",
  "OUTPUT_LIMIT_REACHED",
  "CONTENT_SAFETY_BLOCKED",
  "STRUCTURED_OUTPUT_INVALID",
  "PERSISTENCE_FAILED",
  "BACKGROUND_RECOVERY_FAILED",
  "USER_CANCELLED",
  "UNSUPPORTED_CAPABILITY",
  "INTERNAL_ERROR",
] as const;

export type AiProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
