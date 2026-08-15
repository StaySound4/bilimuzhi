import type { VideoKey } from "./video";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";
import { isVideoKey } from "./video";

export interface Session {
  readonly sessionId: string;
  readonly videoKey: VideoKey;
  /** False only while a newly-created workspace session is not bound to a page. */
  readonly videoBound?: boolean;
  readonly title: string;
  readonly customTitle: boolean;
  readonly activeBranchId: string | null;
  readonly selectionRevision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastActivityAt: number;
}

export function createSession(input: Session): Session {
  assertNonEmptyString(input.sessionId, "sessionId");
  if (!isVideoKey(input.videoKey)) {
    throw new DomainValidationError("videoKey", "videoKey must be canonical");
  }
  if (input.videoBound !== undefined && typeof input.videoBound !== "boolean") {
    throw new DomainValidationError("videoBound", "videoBound must be boolean");
  }
  assertNonEmptyString(input.title, "title");
  if (typeof input.customTitle !== "boolean") {
    throw new DomainValidationError(
      "customTitle",
      "customTitle must be boolean",
    );
  }
  if (input.activeBranchId !== null) {
    assertNonEmptyString(input.activeBranchId, "activeBranchId");
  }
  assertNonNegativeSafeInteger(input.selectionRevision, "selectionRevision");
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  assertNonNegativeSafeInteger(input.lastActivityAt, "lastActivityAt");

  if (input.updatedAt < input.createdAt) {
    throw new DomainValidationError(
      "updatedAt",
      "updatedAt cannot precede createdAt",
    );
  }
  if (input.lastActivityAt < input.createdAt) {
    throw new DomainValidationError(
      "lastActivityAt",
      "lastActivityAt cannot precede createdAt",
    );
  }

  return Object.freeze({
    sessionId: input.sessionId.trim(),
    videoKey: input.videoKey,
    ...(input.videoBound === undefined ? {} : { videoBound: input.videoBound }),
    title: input.title.trim(),
    customTitle: input.customTitle,
    activeBranchId: input.activeBranchId?.trim() ?? null,
    selectionRevision: input.selectionRevision,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastActivityAt: input.lastActivityAt,
  });
}

export function isSessionVideoBound(session: Session): boolean {
  return session.videoBound !== false;
}
