import {
  createSession as createDomainSession,
  createVideoKey,
  type Session,
  type VideoRef,
} from "../domain";
import type { SessionRepository } from "./session-repository";
import type { VideoGateway, VideoResolveInput } from "./video-gateway";

export interface BindVideoSessionDependencies {
  readonly gateway: VideoGateway;
  readonly repository: SessionRepository;
}

export type BindVideoSessionInput =
  | VideoResolveInput
  | { readonly kind: "resolved-video"; readonly video: VideoRef };

export async function bindVideoSession(
  dependencies: BindVideoSessionDependencies,
  input: BindVideoSessionInput,
): Promise<Session> {
  const video =
    input.kind === "resolved-video"
      ? input.video
      : await dependencies.gateway.resolve(input);
  return dependencies.repository.create(video);
}

export interface CreateEmptySessionInput {
  readonly sessionId: string;
  readonly title: string;
  readonly now: number;
}

function unboundBvid(sessionId: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of sessionId) {
    const value = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + first), 0x85ebca6b) >>> 0;
  }
  return `BV${first.toString(36).padStart(7, "0").slice(-7)}${second
    .toString(36)
    .padStart(3, "0")
    .slice(-3)}`;
}

/**
 * Produces a canonical, locally-scoped placeholder identity. The identity is
 * never exposed as a page binding; `videoBound` is the authority for that.
 */
export function createEmptySessionRecord({
  sessionId,
  title,
  now,
}: CreateEmptySessionInput): Session {
  return createDomainSession({
    activeBranchId: null,
    createdAt: now,
    customTitle: false,
    lastActivityAt: now,
    selectionRevision: 0,
    sessionId,
    title,
    updatedAt: now,
    videoBound: false,
    videoKey: createVideoKey({ bvid: unboundBvid(sessionId), cid: 1, page: 1 }),
  });
}

export function nextEmptySessionTitle(
  sessions: readonly { readonly title: string }[],
  baseLabel = "新建会话",
): string {
  const pattern = new RegExp(`^${baseLabel}([1-9]\\d*)$`);
  const occupied = new Set<number>();
  for (const session of sessions) {
    const match = pattern.exec(session.title.trim());
    if (match) occupied.add(Number(match[1]));
  }
  let suffix = 1;
  while (occupied.has(suffix)) suffix += 1;
  return `${baseLabel}${suffix}`;
}
