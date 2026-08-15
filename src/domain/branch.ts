import type { SubtitleSource, SubtitleTrackOrigin } from "./subtitle";
import type { VideoKey } from "./video";
import { isVideoKey } from "./video";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
} from "./validation";

export type SubtitleLanguageMode = "zh" | "en" | "other" | "mixed" | "ja";

export interface SubtitleBranch {
  readonly branchId: string;
  readonly sessionId: string;
  readonly videoKey: VideoKey;
  readonly title: string | null;
  readonly activeSubtitleId: string;
  readonly contextRevision: number;
  readonly source: SubtitleSource;
  readonly language: string;
  readonly trackOrigin?: SubtitleTrackOrigin;
  readonly requestedLanguageMode: SubtitleLanguageMode | null;
  readonly detectedLanguage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastSelectedAt: number;
  readonly lastOpenedAt: number;
  readonly completionSequence: number;
  readonly lastReadCompletionSequence: number;
}

export interface CreateSubtitleBranchInput extends Omit<
  SubtitleBranch,
  "completionSequence" | "lastReadCompletionSequence"
> {
  readonly completionSequence?: number;
  readonly lastReadCompletionSequence?: number;
}

const languageModes = new Set<SubtitleLanguageMode>([
  "zh",
  "en",
  "other",
  "ja",
  "mixed",
]);

function assertNullableString(value: unknown, field: string): void {
  if (value !== null) {
    assertNonEmptyString(value, field);
  }
}

export function createSubtitleBranch(
  input: CreateSubtitleBranchInput,
): SubtitleBranch {
  assertNonEmptyString(input.branchId, "branchId");
  assertNonEmptyString(input.sessionId, "sessionId");
  if (!isVideoKey(input.videoKey)) {
    throw new DomainValidationError("videoKey", "videoKey must be canonical");
  }
  assertNullableString(input.title, "title");
  assertNonEmptyString(input.activeSubtitleId, "activeSubtitleId");
  assertPositiveSafeInteger(input.contextRevision, "contextRevision");
  if (input.source !== "bilibili" && input.source !== "groq-whisper") {
    throw new DomainValidationError("source", "source is unsupported");
  }
  assertNonEmptyString(input.language, "language");
  if (
    input.trackOrigin !== undefined &&
    input.trackOrigin !== "official-cc" &&
    input.trackOrigin !== "ai" &&
    input.trackOrigin !== "user-upload"
  ) {
    throw new DomainValidationError(
      "trackOrigin",
      "trackOrigin is unsupported",
    );
  }
  if (input.source === "groq-whisper" && input.trackOrigin !== undefined) {
    throw new DomainValidationError(
      "trackOrigin",
      "speech branches cannot carry a track origin",
    );
  }
  if (
    input.requestedLanguageMode !== null &&
    !languageModes.has(input.requestedLanguageMode)
  ) {
    throw new DomainValidationError(
      "requestedLanguageMode",
      "requestedLanguageMode is unsupported",
    );
  }
  if (
    (input.source === "bilibili" && input.requestedLanguageMode !== null) ||
    (input.source === "groq-whisper" && input.requestedLanguageMode === null)
  ) {
    throw new DomainValidationError(
      "requestedLanguageMode",
      "requestedLanguageMode does not match the subtitle source",
    );
  }
  assertNullableString(input.detectedLanguage, "detectedLanguage");
  if (input.source === "bilibili" && input.detectedLanguage !== null) {
    throw new DomainValidationError(
      "detectedLanguage",
      "Bilibili branches use the selected track language",
    );
  }
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  assertNonNegativeSafeInteger(input.lastSelectedAt, "lastSelectedAt");
  assertNonNegativeSafeInteger(input.lastOpenedAt, "lastOpenedAt");
  const completionSequence = input.completionSequence ?? 0;
  const lastReadCompletionSequence = input.lastReadCompletionSequence ?? 0;
  assertNonNegativeSafeInteger(completionSequence, "completionSequence");
  assertNonNegativeSafeInteger(
    lastReadCompletionSequence,
    "lastReadCompletionSequence",
  );
  if (lastReadCompletionSequence > completionSequence) {
    throw new DomainValidationError(
      "lastReadCompletionSequence",
      "last read completion cannot exceed branch completion sequence",
    );
  }
  if (
    input.updatedAt < input.createdAt ||
    input.lastSelectedAt < input.createdAt ||
    input.lastOpenedAt < input.createdAt
  ) {
    throw new DomainValidationError(
      "timestamps",
      "branch timestamps cannot precede createdAt",
    );
  }

  return Object.freeze({
    activeSubtitleId: input.activeSubtitleId.trim(),
    branchId: input.branchId.trim(),
    contextRevision: input.contextRevision,
    completionSequence,
    createdAt: input.createdAt,
    detectedLanguage: input.detectedLanguage?.trim() ?? null,
    language: input.language.trim(),
    lastReadCompletionSequence,
    lastOpenedAt: input.lastOpenedAt,
    lastSelectedAt: input.lastSelectedAt,
    requestedLanguageMode: input.requestedLanguageMode,
    sessionId: input.sessionId.trim(),
    source: input.source,
    ...(input.trackOrigin === undefined
      ? {}
      : { trackOrigin: input.trackOrigin }),
    title: input.title?.trim() ?? null,
    updatedAt: input.updatedAt,
    videoKey: input.videoKey,
  });
}
