import { assertNonEmptyString, assertPositiveSafeInteger } from "./validation";

export interface ContentOwner {
  readonly sessionId: string;
  readonly branchId: string;
  readonly subtitleId: string;
  readonly contextRevision: number;
}

export function createContentOwner(input: ContentOwner): ContentOwner {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.branchId, "branchId");
  assertNonEmptyString(input.subtitleId, "subtitleId");
  assertPositiveSafeInteger(input.contextRevision, "contextRevision");
  return Object.freeze({
    branchId: input.branchId.trim(),
    contextRevision: input.contextRevision,
    sessionId: input.sessionId.trim(),
    subtitleId: input.subtitleId.trim(),
  });
}
