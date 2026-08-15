import {
  DomainValidationError,
  assertNonEmptyString,
  assertPositiveSafeInteger,
  hasOnlyKeys,
  isPlainRecord,
} from "./validation";

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const VIDEO_KEY_PATTERN =
  /^bvid:(BV[0-9A-Za-z]{10}):cid:([1-9]\d*):p:([1-9]\d*)$/;

export type VideoKey = `bvid:${string}:cid:${number}:p:${number}`;

export interface VideoIdentity {
  readonly bvid: string;
  readonly cid: number;
  readonly page: number;
}

export interface VideoRef extends VideoIdentity {
  readonly videoKey: VideoKey;
  readonly aid?: number;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly coverUrl?: string;
  readonly durationSec?: number;
}

export interface CreateVideoRefInput extends VideoIdentity {
  readonly aid?: number;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly coverUrl?: string;
  readonly durationSec?: number;
}

function assertBvid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !BVID_PATTERN.test(value)) {
    throw new DomainValidationError(
      "bvid",
      "bvid must be a canonical BV identifier",
    );
  }
}

function assertVideoIdentity(identity: VideoIdentity): void {
  assertBvid(identity.bvid);
  assertPositiveSafeInteger(identity.cid, "cid");
  assertPositiveSafeInteger(identity.page, "page");
}

export function createVideoKey(identity: VideoIdentity): VideoKey {
  assertVideoIdentity(identity);
  return `bvid:${identity.bvid}:cid:${identity.cid}:p:${identity.page}`;
}

export function parseVideoKey(value: string): VideoIdentity {
  const match = VIDEO_KEY_PATTERN.exec(value);
  if (!match) {
    throw new DomainValidationError(
      "videoKey",
      "videoKey has an invalid format",
    );
  }

  const identity = {
    bvid: match[1],
    cid: Number(match[2]),
    page: Number(match[3]),
  };
  assertVideoIdentity(identity);

  if (createVideoKey(identity) !== value) {
    throw new DomainValidationError("videoKey", "videoKey is not canonical");
  }

  return Object.freeze(identity);
}

export function isVideoKey(value: unknown): value is VideoKey {
  if (typeof value !== "string") {
    return false;
  }

  try {
    parseVideoKey(value);
    return true;
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return false;
    }
    throw error;
  }
}

function isCanonicalVideoUrl(
  value: unknown,
  bvid: string,
  page: number,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const isBilibiliHost =
      url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com");
    const pathParts = url.pathname.split("/").filter(Boolean);
    const part = url.searchParams.get("p");
    const hasExactPart = part === null ? page === 1 : part === String(page);
    return (
      url.protocol === "https:" &&
      isBilibiliHost &&
      pathParts.length === 2 &&
      pathParts[0] === "video" &&
      pathParts[1] === bvid &&
      hasExactPart
    );
  } catch {
    return false;
  }
}

export function isVideoRef(value: unknown): value is VideoRef {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      "videoKey",
      "bvid",
      "cid",
      "aid",
      "page",
      "title",
      "canonicalUrl",
      "coverUrl",
      "durationSec",
    ]) ||
    !isVideoKey(value.videoKey)
  ) {
    return false;
  }

  try {
    assertVideoIdentity({
      bvid: value.bvid as string,
      cid: value.cid as number,
      page: value.page as number,
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return false;
    }
    throw error;
  }

  if (
    value.videoKey !==
      createVideoKey({
        bvid: value.bvid as string,
        cid: value.cid as number,
        page: value.page as number,
      }) ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title !== value.title.trim() ||
    !isCanonicalVideoUrl(
      value.canonicalUrl,
      value.bvid as string,
      value.page as number,
    )
  ) {
    return false;
  }

  if (
    value.aid !== undefined &&
    (typeof value.aid !== "number" ||
      !Number.isSafeInteger(value.aid) ||
      value.aid <= 0)
  ) {
    return false;
  }

  if (
    value.coverUrl !== undefined &&
    (typeof value.coverUrl !== "string" || value.coverUrl.trim().length === 0)
  ) {
    return false;
  }

  return (
    value.durationSec === undefined ||
    (typeof value.durationSec === "number" &&
      Number.isFinite(value.durationSec) &&
      value.durationSec > 0)
  );
}

export function createVideoRef(input: CreateVideoRefInput): VideoRef {
  assertVideoIdentity(input);
  assertNonEmptyString(input.title, "title");

  const video: VideoRef = {
    videoKey: createVideoKey(input),
    bvid: input.bvid,
    cid: input.cid,
    page: input.page,
    title: input.title.trim(),
    canonicalUrl: input.canonicalUrl,
    ...(input.aid === undefined ? {} : { aid: input.aid }),
    ...(input.coverUrl === undefined ? {} : { coverUrl: input.coverUrl }),
    ...(input.durationSec === undefined
      ? {}
      : { durationSec: input.durationSec }),
  };

  if (!isVideoRef(video)) {
    throw new DomainValidationError(
      "video",
      "video reference has invalid fields",
    );
  }

  return Object.freeze(video);
}
