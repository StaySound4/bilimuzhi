import { createContentOwner, type ContentOwner } from "./ownership";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type ArtifactKind = "segments" | "summary";
export type ArtifactStatus = "empty" | "generating" | "ready" | "failed";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = Object.freeze([
  "segments",
  "summary",
]);

/** One AI-produced chapter of the current subtitle context. */
export interface ArtifactSegment {
  readonly startLineId?: string;
  readonly endLineId?: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly title: string;
  readonly detail: string;
  /** Sponsored / promotional stretch, surfaced so it can be skipped. */
  readonly isAdvertisement: boolean;
  readonly type?: "content" | "advertisement";
}

export interface Artifact extends ContentOwner {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  /**
   * Owner revision for generation runs targeting this artifact. Every explicit
   * regeneration increments it so late events from a superseded run are
   * rejected instead of overwriting fresh content.
   */
  readonly artifactRevision: number;
  readonly status: ArtifactStatus;
  readonly content: string;
  readonly segments: readonly ArtifactSegment[];
  readonly modelId: string | null;
  readonly errorCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const MAX_ARTIFACT_CONTENT_LENGTH = 2_000_000;
const MAX_ARTIFACT_SEGMENTS = 2_000;

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return value === "segments" || value === "summary";
}

function assertNullableIdentifier(value: unknown, field: string): void {
  if (value !== null) assertNonEmptyString(value, field);
}

export function createArtifactSegment(input: ArtifactSegment): ArtifactSegment {
  assertNonNegativeSafeInteger(input.startMs, "startMs");
  assertNonNegativeSafeInteger(input.endMs, "endMs");
  if (input.endMs < input.startMs) {
    throw new DomainValidationError("endMs", "endMs cannot precede startMs");
  }
  if (
    typeof input.title !== "string" ||
    input.title.trim().length === 0 ||
    input.title.length > 400
  ) {
    throw new DomainValidationError("title", "segment title is invalid");
  }
  if (typeof input.detail !== "string" || input.detail.length > 20_000) {
    throw new DomainValidationError("detail", "segment detail is invalid");
  }
  if (typeof input.isAdvertisement !== "boolean") {
    throw new DomainValidationError(
      "isAdvertisement",
      "segment advertisement flag is invalid",
    );
  }
  if (input.startLineId !== undefined) {
    assertNonEmptyString(input.startLineId, "startLineId");
  }
  if (input.endLineId !== undefined) {
    assertNonEmptyString(input.endLineId, "endLineId");
  }
  if (
    input.type !== undefined &&
    input.type !== "content" &&
    input.type !== "advertisement"
  ) {
    throw new DomainValidationError("type", "segment type is invalid");
  }
  if (
    input.type !== undefined &&
    (input.type === "advertisement") !== input.isAdvertisement
  ) {
    throw new DomainValidationError(
      "type",
      "segment type and advertisement flag disagree",
    );
  }
  return Object.freeze({
    detail: input.detail.trim(),
    endMs: input.endMs,
    isAdvertisement: input.isAdvertisement,
    startMs: input.startMs,
    title: input.title.trim(),
    ...(input.startLineId === undefined
      ? {}
      : { startLineId: input.startLineId.trim() }),
    ...(input.endLineId === undefined
      ? {}
      : { endLineId: input.endLineId.trim() }),
    ...(input.type === undefined ? {} : { type: input.type }),
  });
}

export function createArtifact(input: Artifact): Artifact {
  const owner = createContentOwner(input);
  assertNonEmptyString(input.artifactId, "artifactId");
  if (!isArtifactKind(input.kind)) {
    throw new DomainValidationError("kind", "artifact kind is unsupported");
  }
  assertNonNegativeSafeInteger(input.artifactRevision, "artifactRevision");
  if (
    input.status !== "empty" &&
    input.status !== "generating" &&
    input.status !== "ready" &&
    input.status !== "failed"
  ) {
    throw new DomainValidationError("status", "artifact status is unsupported");
  }
  if (
    typeof input.content !== "string" ||
    input.content.length > MAX_ARTIFACT_CONTENT_LENGTH
  ) {
    throw new DomainValidationError("content", "artifact content is invalid");
  }
  if (
    !Array.isArray(input.segments) ||
    input.segments.length > MAX_ARTIFACT_SEGMENTS
  ) {
    throw new DomainValidationError(
      "segments",
      "artifact segments are invalid",
    );
  }
  if (input.kind === "summary" && input.segments.length > 0) {
    throw new DomainValidationError(
      "segments",
      "a summary artifact cannot own segments",
    );
  }
  assertNullableIdentifier(input.modelId, "modelId");
  assertNullableIdentifier(input.errorCode, "errorCode");
  if (input.status !== "failed" && input.errorCode !== null) {
    throw new DomainValidationError(
      "errorCode",
      "only a failed artifact has an error code",
    );
  }
  if (input.status === "failed" && input.errorCode === null) {
    throw new DomainValidationError(
      "errorCode",
      "a failed artifact requires an error code",
    );
  }
  if (input.status === "empty" && input.content.length > 0) {
    throw new DomainValidationError(
      "content",
      "an empty artifact cannot own content",
    );
  }
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  if (input.updatedAt < input.createdAt) {
    throw new DomainValidationError(
      "updatedAt",
      "updatedAt cannot precede createdAt",
    );
  }
  const segments = input.segments.map(createArtifactSegment);
  for (const [index, segment] of segments.entries()) {
    const previous = segments[index - 1];
    if (previous !== undefined && segment.startMs < previous.startMs) {
      throw new DomainValidationError(
        "segments",
        "artifact segments must be ordered by start time",
      );
    }
  }
  return Object.freeze({
    ...owner,
    artifactId: input.artifactId.trim(),
    artifactRevision: input.artifactRevision,
    content: input.content,
    createdAt: input.createdAt,
    errorCode: input.errorCode?.trim() ?? null,
    kind: input.kind,
    modelId: input.modelId?.trim() ?? null,
    segments: Object.freeze(segments),
    status: input.status,
    updatedAt: input.updatedAt,
  });
}
