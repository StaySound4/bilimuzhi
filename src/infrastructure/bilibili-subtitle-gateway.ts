import {
  SubtitleGatewayError,
  type DirectSubtitle,
  type DirectSubtitleGateway,
  type SubtitleTrackOption,
} from "../application/subtitle-gateway";
import { createVideoRef } from "../domain";
import type {
  SubtitleRow,
  SubtitleTrackOrigin,
  VideoKey,
  VideoRef,
} from "../domain";
import { decodeBilibiliSubtitleWebView } from "./bilibili-subtitle-web-view";
import {
  createBilibiliWbiUrlSigner,
  type BilibiliWbiParameter,
} from "./bilibili-wbi";

interface GatewayResponse {
  readonly authorizationContext?: "off-page" | "page";
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer?(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export interface BilibiliSubtitleRequestOwner {
  readonly aid: number;
  readonly bvid: string;
  readonly cid: number;
  readonly page: number;
  readonly pageRevision: number;
  readonly requestOwner: string;
  readonly trackId: string;
  readonly videoKey: VideoKey;
}

interface GatewayFetchInit {
  readonly credentials: "include" | "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly owner?: BilibiliSubtitleRequestOwner;
  readonly signal?: AbortSignal;
}

interface BilibiliSubtitleGatewayDependencies {
  readonly fetch: (
    url: string,
    init: GatewayFetchInit,
  ) => Promise<GatewayResponse>;
  readonly createRequestNonce?: () => string;
  readonly signWbiUrl?: (
    pathname: string,
    parameters: Readonly<Record<string, BilibiliWbiParameter>>,
    referer: string,
  ) => Promise<string>;
}

interface ChromeBilibiliSubtitleGatewayDependencies {
  readonly createRequestNonce?: () => string;
  readonly fetch: BilibiliSubtitleGatewayDependencies["fetch"];
  readonly now?: () => number;
}

interface ResolvedSubtitleTrack extends SubtitleTrackOption {
  readonly url: string | null;
  readonly trackOrigin: SubtitleTrackOrigin | null;
}

interface TrackDiscoveryResult {
  readonly authorizationContext?: "off-page" | "page";
  readonly needLogin: boolean;
  readonly tracks: readonly ResolvedSubtitleTrack[];
}

interface GatewayOperation {
  readonly pageRevision: number;
  readonly requestOwner: string;
  readonly signal?: AbortSignal;
  readonly trackId: string;
  readonly videoKey: VideoKey;
}

type RequestPhase = "authorization" | "content" | "track";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authenticationRequired(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "AUTHENTICATION_REQUIRED",
    "Bilibili login is required to access these subtitles",
  );
}

function permissionDenied(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "PERMISSION_DENIED",
    "The current Bilibili account cannot access these subtitles",
  );
}

function subtitleNotFound(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "SUBTITLE_NOT_FOUND",
    "The bound Bilibili video has no direct subtitles",
  );
}

function subtitleUrlExpired(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "SUBTITLE_URL_EXPIRED",
    "The Bilibili subtitle URL has expired",
    true,
  );
}

function authorizedRequestPathUnresolved(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "NETWORK_ERROR",
    "The authorized Bilibili page request could not be confirmed",
    true,
  );
}

function chargedContentUnsupported(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "CHARGED_CONTENT_UNSUPPORTED",
    "Charged content subtitles are not supported",
  );
}

function safeRequestError(
  status: number,
  phase: RequestPhase,
): SubtitleGatewayError {
  if (
    phase === "content" &&
    (status === 401 || status === 403 || status === 404 || status === 410)
  ) {
    return subtitleUrlExpired();
  }
  if (status === 401) return authenticationRequired();
  if (status === 403) return permissionDenied();
  return new SubtitleGatewayError(
    "NETWORK_ERROR",
    "Unable to load Bilibili subtitles",
    true,
  );
}

function invalidResponse(): SubtitleGatewayError {
  return new SubtitleGatewayError(
    "VALIDATION_FAILED",
    "The Bilibili subtitle response is invalid",
  );
}

function normalizeFallbackError(error: unknown): SubtitleGatewayError {
  return error instanceof SubtitleGatewayError ? error : invalidResponse();
}

function isAuthorizationError(error: SubtitleGatewayError): boolean {
  return (
    error.code === "AUTHENTICATION_REQUIRED" ||
    error.code === "PERMISSION_DENIED"
  );
}

function isChargedContent(data: Record<string, unknown>): boolean {
  const entitlementKeys = [
    "is_upower_exclusive",
    "is_ugc_pay_preview",
  ] as const;
  for (const key of entitlementKeys) {
    if (data[key] !== undefined && typeof data[key] !== "boolean") {
      throw invalidResponse();
    }
  }
  return data.is_upower_exclusive === true || data.is_ugc_pay_preview === true;
}

/**
 * `api.bilibili.com` answers a credentialed cross-origin request with an exact
 * allow-origin, so the login session must be attached there. Subtitle bodies
 * live on the `*.hdslb.com` CDN, which answers with a wildcard allow-origin:
 * attaching credentials there makes the browser reject the response outright,
 * which previously surfaced as an unexplained `NETWORK_ERROR` right after a
 * successful track discovery. Those asset reads are public and need no session.
 */
export function subtitleRequestCredentials(url: string): "include" | "omit" {
  try {
    return new URL(url).hostname.toLowerCase() === "api.bilibili.com"
      ? "include"
      : "omit";
  } catch {
    return "omit";
  }
}

function normalizeSubtitleUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResponse();
  }
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalidResponse();
  }
  const allowedHost =
    url.hostname === "bilibili.com" ||
    url.hostname.endsWith(".bilibili.com") ||
    url.hostname === "hdslb.com" ||
    url.hostname.endsWith(".hdslb.com");
  if (url.protocol !== "https:" || !allowedHost) {
    throw invalidResponse();
  }
  return url.toString();
}

function normalizeOptionalSubtitleUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return normalizeSubtitleUrl(value);
}

function normalizeTrackId(
  value: unknown,
  language: string,
  name: string,
  source: SubtitleTrackOption["source"],
): string {
  if (
    (typeof value === "string" && /^[A-Za-z0-9._-]{1,96}$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  ) {
    return `id:${String(value)}`;
  }
  const safeLanguage = language.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fallback:${source}:${safeLanguage || "unknown"}:${hash.toString(16).padStart(8, "0")}`;
}

function normalizeTracks(
  value: unknown,
  classification: "exact" | "unknown" = "exact",
): readonly ResolvedSubtitleTrack[] {
  if (!Array.isArray(value) || value.length > 50) throw invalidResponse();
  const tracksById = new Map<string, ResolvedSubtitleTrack>();
  for (const rawTrack of value) {
    if (
      !isRecord(rawTrack) ||
      typeof rawTrack.lan !== "string" ||
      rawTrack.lan.trim().length === 0
    ) {
      throw invalidResponse();
    }
    const language = rawTrack.lan.trim();
    const name =
      typeof rawTrack.lan_doc === "string" && rawTrack.lan_doc.trim().length > 0
        ? rawTrack.lan_doc.trim()
        : language;
    if (language.length > 64 || name.length > 128) throw invalidResponse();

    const aiType = rawTrack.ai_type;
    if (
      aiType !== undefined &&
      typeof aiType !== "boolean" &&
      !(typeof aiType === "number" && Number.isSafeInteger(aiType))
    ) {
      throw invalidResponse();
    }
    const isAi =
      language.startsWith("ai-") ||
      aiType === true ||
      (typeof aiType === "number" && aiType !== 0);
    const source = isAi ? "ai" : "official";

    const authorMid = rawTrack.author_mid;
    if (
      authorMid !== undefined &&
      (typeof authorMid !== "number" || !Number.isSafeInteger(authorMid))
    ) {
      throw invalidResponse();
    }
    const trackOrigin: SubtitleTrackOrigin | null =
      classification === "unknown"
        ? isAi
          ? "ai"
          : null
        : authorMid !== undefined && authorMid !== 0
          ? "user-upload"
          : isAi
            ? "ai"
            : "official-cc";
    const trackId = normalizeTrackId(rawTrack.id, language, name, source);
    const track = Object.freeze({
      language,
      name,
      source,
      trackId,
      trackOrigin,
      url: normalizeOptionalSubtitleUrl(rawTrack.subtitle_url),
    });
    const existing = tracksById.get(trackId);
    if (existing === undefined) {
      tracksById.set(trackId, track);
      continue;
    }
    if (
      existing.language !== track.language ||
      existing.name !== track.name ||
      existing.source !== track.source ||
      (existing.trackOrigin !== null &&
        track.trackOrigin !== null &&
        existing.trackOrigin !== track.trackOrigin)
    ) {
      throw invalidResponse();
    }
    if (existing.url === null && track.url !== null) {
      tracksById.set(trackId, track);
    } else if (existing.trackOrigin === null && track.trackOrigin !== null) {
      tracksById.set(trackId, Object.freeze({ ...existing, trackOrigin }));
    }
  }
  return Object.freeze([...tracksById.values()]);
}

function readPlayerResponse(
  value: unknown,
  authorizationContext?: "off-page" | "page",
): TrackDiscoveryResult {
  if (!isRecord(value)) throw invalidResponse();
  if (value.code === -101) throw authenticationRequired();
  if (value.code === -403) {
    if (authorizationContext === "off-page") {
      throw authorizedRequestPathUnresolved();
    }
    throw permissionDenied();
  }
  if (value.code !== 0 || !isRecord(value.data)) throw invalidResponse();
  if (isChargedContent(value.data)) throw chargedContentUnsupported();
  const needLogin = value.data.need_login_subtitle === true;
  const subtitle = value.data.subtitle;
  if (!isRecord(subtitle) || !Array.isArray(subtitle.subtitles)) {
    throw invalidResponse();
  }
  const tracks = normalizeTracks(subtitle.subtitles);
  if (
    tracks.length === 0 &&
    typeof value.data.need_login_subtitle !== "boolean"
  ) {
    throw invalidResponse();
  }
  return Object.freeze({
    ...(authorizationContext === undefined ? {} : { authorizationContext }),
    needLogin,
    tracks,
  });
}

/**
 * Confirms the exact `BVID + page + CID` identity against Bilibili and returns
 * the authoritative `aid` for it.
 *
 * `aid` is not part of the VideoKey and is persisted with the session, so a
 * stored VideoRef can carry an `aid` that belongs to a different video. Both
 * `/x/v2/subtitle/web/view` (`pid`) and the AI subtitle endpoint (`aid`) key
 * off it, and Bilibili happily answers with that other video's tracks, which is
 * how a session could end up showing subtitles from a completely unrelated
 * video. The identity that the user actually chose is `BVID + page + CID`, so a
 * disagreeing `aid` is repaired from the response instead of trusted.
 */
function readExactWbiVideoIdentity(value: unknown, video: VideoRef): number {
  if (!isRecord(value)) throw invalidResponse();
  if (value.code === -101) throw authenticationRequired();
  if (value.code === -403) throw permissionDenied();
  if (value.code !== 0 || !isRecord(value.data) || !isRecord(value.data.View)) {
    throw invalidResponse();
  }
  const view = value.data.View;
  if (
    view.bvid !== video.bvid ||
    typeof view.aid !== "number" ||
    !Number.isSafeInteger(view.aid) ||
    view.aid <= 0 ||
    !Array.isArray(view.pages) ||
    view.pages.length === 0 ||
    view.pages.length > 10_000
  ) {
    throw invalidResponse();
  }
  const page = view.pages.find(
    (candidate) => isRecord(candidate) && candidate.page === video.page,
  );
  if (
    !isRecord(page) ||
    typeof page.cid !== "number" ||
    !Number.isSafeInteger(page.cid) ||
    page.cid !== video.cid
  ) {
    throw invalidResponse();
  }
  return view.aid;
}

function readAiTracks(value: unknown): readonly ResolvedSubtitleTrack[] {
  if (!isRecord(value)) throw invalidResponse();
  if (value.code === -101) throw authenticationRequired();
  if (value.code === -403) throw permissionDenied();
  if (value.code !== 0 || !isRecord(value.data)) throw invalidResponse();
  if (value.data.subtitle_url === undefined || value.data.subtitle_url === "") {
    return Object.freeze([]);
  }
  return normalizeTracks([
    {
      ai_type: 1,
      id: "ai-fallback",
      lan:
        typeof value.data.lan === "string" && value.data.lan.trim().length > 0
          ? value.data.lan
          : "ai-zh",
      lan_doc:
        typeof value.data.lan_doc === "string" &&
        value.data.lan_doc.trim().length > 0
          ? value.data.lan_doc
          : "自动生成字幕",
      subtitle_url: value.data.subtitle_url,
    },
  ]);
}

function throwAuthorizationError(value: unknown): never {
  if (
    !isRecord(value) ||
    value.code !== 0 ||
    !isRecord(value.data) ||
    typeof value.data.isLogin !== "boolean"
  ) {
    throw invalidResponse();
  }
  if (!value.data.isLogin) throw authenticationRequired();
  throw permissionDenied();
}

function milliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidResponse();
  }
  const result = Math.round(value * 1_000);
  if (!Number.isSafeInteger(result)) throw invalidResponse();
  return result;
}

function readRows(value: unknown): readonly SubtitleRow[] {
  if (!isRecord(value) || !Array.isArray(value.body)) throw invalidResponse();
  const rows = value.body.map((item): SubtitleRow => {
    if (
      !isRecord(item) ||
      typeof item.content !== "string" ||
      item.content.trim().length === 0
    ) {
      throw invalidResponse();
    }
    const startMs = milliseconds(item.from);
    const endMs = milliseconds(item.to);
    if (endMs <= startMs) throw invalidResponse();
    return { endMs, startMs, text: item.content.trim() };
  });
  if (rows.length === 0) {
    throw new SubtitleGatewayError(
      "SUBTITLE_NOT_FOUND",
      "The bound Bilibili subtitle track is empty",
    );
  }
  return Object.freeze(
    [...rows].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    ),
  );
}

function findMatchingTrack(
  tracks: readonly ResolvedSubtitleTrack[],
  target: Pick<
    ResolvedSubtitleTrack,
    "language" | "name" | "source" | "trackId"
  >,
): ResolvedSubtitleTrack | null {
  return (
    tracks.find(
      (track) =>
        track.trackId === target.trackId &&
        track.language === target.language &&
        track.name === target.name &&
        track.source === target.source,
    ) ?? null
  );
}

function reconcileTracks(
  groups: readonly (readonly ResolvedSubtitleTrack[])[],
): readonly ResolvedSubtitleTrack[] {
  const tracksById = new Map<string, ResolvedSubtitleTrack>();
  for (const tracks of groups) {
    for (const track of tracks) {
      const existing = tracksById.get(track.trackId);
      if (existing === undefined) {
        tracksById.set(track.trackId, track);
        continue;
      }
      if (
        existing.language !== track.language ||
        existing.name !== track.name ||
        existing.source !== track.source ||
        (existing.trackOrigin !== null &&
          track.trackOrigin !== null &&
          existing.trackOrigin !== track.trackOrigin)
      ) {
        throw invalidResponse();
      }
      if (existing.url === null && track.url !== null) {
        tracksById.set(track.trackId, track);
      } else if (existing.trackOrigin === null && track.trackOrigin !== null) {
        tracksById.set(
          track.trackId,
          Object.freeze({ ...existing, trackOrigin: track.trackOrigin }),
        );
      }
    }
  }
  return Object.freeze([...tracksById.values()]);
}

/**
 * Signed WBI and Web View are independent authoritative projections of the
 * same exact AID/CID. The stable descriptor must agree. Subtitle addresses are
 * short-lived capability URLs, so a later exact Web View projection may rotate
 * only that address; this is distinct from accepting an unsigned wrong URL.
 */
function reconcileAuthoritativeTracks(
  groups: readonly (readonly ResolvedSubtitleTrack[])[],
): readonly ResolvedSubtitleTrack[] {
  const tracksById = new Map<string, ResolvedSubtitleTrack>();
  for (const tracks of groups) {
    for (const track of tracks) {
      const existing = tracksById.get(track.trackId);
      if (existing === undefined) {
        tracksById.set(track.trackId, track);
        continue;
      }
      if (
        existing.language !== track.language ||
        existing.name !== track.name ||
        existing.source !== track.source ||
        (existing.trackOrigin !== null &&
          track.trackOrigin !== null &&
          existing.trackOrigin !== track.trackOrigin)
      ) {
        throw invalidResponse();
      }
      if (existing.url === null && track.url !== null) {
        tracksById.set(track.trackId, track);
      } else if (existing.trackOrigin === null && track.trackOrigin !== null) {
        tracksById.set(
          track.trackId,
          Object.freeze({ ...existing, trackOrigin: track.trackOrigin }),
        );
      }
    }
  }
  return Object.freeze([...tracksById.values()]);
}

class BilibiliSubtitleGateway implements DirectSubtitleGateway {
  private readonly trackCache = new Map<
    VideoKey,
    readonly ResolvedSubtitleTrack[]
  >();
  private readonly identityCache = new Map<VideoKey, VideoRef>();
  private readonly operationRevisions = new Map<VideoKey, number>();
  private requestSequence = 0;

  constructor(
    private readonly dependencies: BilibiliSubtitleGatewayDependencies,
  ) {}

  private beginOperation(
    video: VideoRef,
    trackId: string,
    signal?: AbortSignal,
  ): GatewayOperation {
    const pageRevision = (this.operationRevisions.get(video.videoKey) ?? 0) + 1;
    this.operationRevisions.set(video.videoKey, pageRevision);
    this.requestSequence += 1;
    const requestOwner =
      this.dependencies.createRequestNonce?.() ??
      `subtitle:${pageRevision}:${this.requestSequence}`;
    if (
      requestOwner.length === 0 ||
      requestOwner.length > 512 ||
      trackId.length === 0 ||
      trackId.length > 512
    ) {
      throw invalidResponse();
    }
    return Object.freeze({
      pageRevision,
      requestOwner,
      ...(signal === undefined ? {} : { signal }),
      trackId,
      videoKey: video.videoKey,
    });
  }

  private assertCurrentOperation(operation?: GatewayOperation): void {
    if (
      operation !== undefined &&
      this.operationRevisions.get(operation.videoKey) !== operation.pageRevision
    ) {
      throw invalidResponse();
    }
  }

  private async fetchResponse(
    video: VideoRef,
    url: string,
    accept: string,
    operation?: GatewayOperation,
  ): Promise<GatewayResponse> {
    this.assertCurrentOperation(operation);
    let response: GatewayResponse;
    try {
      response = await this.dependencies.fetch(url, {
        credentials: subtitleRequestCredentials(url),
        headers: { Accept: accept, Referer: video.canonicalUrl },
        method: "GET",
        ...(operation === undefined || video.aid === undefined
          ? {}
          : {
              owner: Object.freeze({
                aid: video.aid,
                bvid: video.bvid,
                cid: video.cid,
                page: video.page,
                pageRevision: operation.pageRevision,
                requestOwner: operation.requestOwner,
                trackId: operation.trackId,
                videoKey: video.videoKey,
              }),
            }),
        ...(operation?.signal === undefined
          ? {}
          : { signal: operation.signal }),
      });
    } catch {
      throw new SubtitleGatewayError(
        "NETWORK_ERROR",
        "Unable to load Bilibili subtitles",
        true,
      );
    }
    if (
      !isRecord(response) ||
      typeof response.ok !== "boolean" ||
      !Number.isInteger(response.status) ||
      (response.authorizationContext !== undefined &&
        response.authorizationContext !== "off-page" &&
        response.authorizationContext !== "page") ||
      typeof response.json !== "function"
    ) {
      throw invalidResponse();
    }
    this.assertCurrentOperation(operation);
    return response;
  }

  private async requestJsonResponse(
    video: VideoRef,
    url: string,
    phase: RequestPhase,
    operation?: GatewayOperation,
  ): Promise<{
    readonly authorizationContext?: "off-page" | "page";
    readonly body: unknown;
  }> {
    const response = await this.fetchResponse(
      video,
      url,
      "application/json, text/plain, */*",
      operation,
    );
    if (!response.ok) {
      if (
        phase !== "content" &&
        response.authorizationContext === "off-page" &&
        response.status === 403
      ) {
        throw authorizedRequestPathUnresolved();
      }
      throw safeRequestError(response.status, phase);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse();
    }
    if (
      phase === "track" &&
      response.authorizationContext === "off-page" &&
      isRecord(body) &&
      body.code === -403
    ) {
      throw authorizedRequestPathUnresolved();
    }
    return Object.freeze({
      ...(response.authorizationContext === undefined
        ? {}
        : { authorizationContext: response.authorizationContext }),
      body,
    });
  }

  private async requestJson(
    video: VideoRef,
    url: string,
    phase: RequestPhase,
    operation?: GatewayOperation,
  ): Promise<unknown> {
    return (await this.requestJsonResponse(video, url, phase, operation)).body;
  }

  private async requestBinary(
    video: VideoRef,
    url: string,
    operation?: GatewayOperation,
  ): Promise<ArrayBuffer> {
    const response = await this.fetchResponse(
      video,
      url,
      "application/x-protobuf, application/octet-stream, */*",
      operation,
    );
    if (!response.ok) {
      if (
        response.authorizationContext === "off-page" &&
        response.status === 403
      ) {
        throw authorizedRequestPathUnresolved();
      }
      throw safeRequestError(response.status, "track");
    }
    if (typeof response.arrayBuffer !== "function") throw invalidResponse();
    try {
      return await response.arrayBuffer();
    } catch {
      throw invalidResponse();
    }
  }

  private async fetchPlayerTracks(
    video: VideoRef,
    wbi: boolean,
    operation?: GatewayOperation,
  ): Promise<TrackDiscoveryResult> {
    let url: string;
    if (wbi && video.aid !== undefined) {
      url =
        this.dependencies.signWbiUrl === undefined
          ? `https://api.bilibili.com/x/player/wbi/v2?aid=${encodeURIComponent(
              String(video.aid),
            )}&cid=${encodeURIComponent(String(video.cid))}`
          : await this.dependencies.signWbiUrl(
              "/x/player/wbi/v2",
              { aid: video.aid, cid: video.cid },
              video.canonicalUrl,
            );
    } else {
      url = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(
        video.bvid,
      )}&cid=${encodeURIComponent(String(video.cid))}`;
    }
    const response = await this.requestJsonResponse(
      video,
      url,
      "track",
      operation,
    );
    return readPlayerResponse(response.body, response.authorizationContext);
  }

  private async assertExactWbiVideoIdentity(
    video: VideoRef,
    operation?: GatewayOperation,
  ): Promise<void> {
    if (video.aid === undefined || this.dependencies.signWbiUrl === undefined) {
      return;
    }
    await this.exactVideo(video, operation);
  }

  /**
   * Returns the VideoRef with an `aid` confirmed to belong to this exact
   * `BVID + page + CID`. The result is cached per VideoKey so one acquisition
   * does not repeat the signed lookup for every endpoint.
   */
  private async exactVideo(
    video: VideoRef,
    operation?: GatewayOperation,
  ): Promise<VideoRef> {
    if (this.dependencies.signWbiUrl === undefined) return video;
    const cached = this.identityCache.get(video.videoKey);
    if (cached !== undefined) return cached;
    const url = await this.dependencies.signWbiUrl(
      "/x/web-interface/wbi/view/detail",
      { bvid: video.bvid, need_elec: 1 },
      video.canonicalUrl,
    );
    const aid = readExactWbiVideoIdentity(
      await this.requestJson(video, url, "track", operation),
      video,
    );
    const exact = video.aid === aid ? video : createVideoRef({ ...video, aid });
    this.identityCache.set(video.videoKey, exact);
    return exact;
  }

  private async fetchWebViewTracks(
    video: VideoRef,
    operation?: GatewayOperation,
  ): Promise<readonly ResolvedSubtitleTrack[]> {
    if (video.aid === undefined) return Object.freeze([]);
    const parameters = new URLSearchParams({
      context_ext: JSON.stringify({ video_type: 1 }),
      oid: String(video.cid),
      pid: String(video.aid),
      type: "1",
    });
    try {
      return normalizeTracks(
        decodeBilibiliSubtitleWebView(
          await this.requestBinary(
            video,
            `https://api.bilibili.com/x/v2/subtitle/web/view?${parameters.toString()}`,
            operation,
          ),
        ),
        "unknown",
      );
    } catch (error) {
      throw normalizeFallbackError(error);
    }
  }

  private async fetchAiTracks(
    video: VideoRef,
    operation?: GatewayOperation,
  ): Promise<readonly ResolvedSubtitleTrack[]> {
    if (video.aid === undefined) return Object.freeze([]);
    return readAiTracks(
      await this.requestJson(
        video,
        `https://api.bilibili.com/x/player/v2/ai/subtitle/search/stat?aid=${encodeURIComponent(
          String(video.aid),
        )}&cid=${encodeURIComponent(String(video.cid))}`,
        "track",
        operation,
      ),
    );
  }

  private async discoverTracks(
    video: VideoRef,
    refreshTarget?: ResolvedSubtitleTrack,
    operation?: GatewayOperation,
  ): Promise<readonly ResolvedSubtitleTrack[]> {
    const groups: (readonly ResolvedSubtitleTrack[])[] = [];
    const hasAuthoritativeIdentity = this.dependencies.signWbiUrl !== undefined;
    let needLogin = false;
    let authorizationFailure: SubtitleGatewayError | null = null;
    let deferredFailure: SubtitleGatewayError | null = null;
    let auxiliaryNetworkFailure: SubtitleGatewayError | null = null;
    let observedConfirmedEmptyTrackList = false;
    let observedOffPageAuthority = false;
    let observedPageAuthority = false;

    const collect = async (
      operation: () => Promise<
        TrackDiscoveryResult | readonly ResolvedSubtitleTrack[]
      >,
      source: "ai" | "player" | "web-view",
    ): Promise<void> => {
      try {
        const result = await operation();
        if (Array.isArray(result)) {
          groups.push(result as readonly ResolvedSubtitleTrack[]);
        } else {
          const discovery = result as TrackDiscoveryResult;
          observedOffPageAuthority ||=
            discovery.authorizationContext === "off-page";
          observedPageAuthority ||= discovery.authorizationContext === "page";
          needLogin ||= discovery.needLogin;
          if (discovery.tracks.length === 0 && !discovery.needLogin) {
            observedConfirmedEmptyTrackList = true;
          }
          groups.push(discovery.tracks);
        }
      } catch (error) {
        const failure = normalizeFallbackError(error);
        if (failure.code === "CHARGED_CONTENT_UNSUPPORTED") {
          // 充电/付费内容一旦识别,立即短路,不继续尝试其他轨道端点。
          throw failure;
        }
        if (isAuthorizationError(failure)) {
          authorizationFailure ??= failure;
        } else if (source !== "player" && failure.code === "NETWORK_ERROR") {
          auxiliaryNetworkFailure ??= failure;
        } else {
          deferredFailure ??= failure;
        }
      }
    };

    // Identity is confirmed before any track is read, never after. The AV id is
    // not part of the VideoKey and can be stale on a stored VideoRef, and the
    // discovery endpoints key off it, so verifying afterwards would allow an
    // unverified first response to be returned as the answer.
    let exact = video;
    if (this.dependencies.signWbiUrl !== undefined) {
      // Signed detail is the authority that proves the stored AID belongs to
      // this exact BVID/page/CID. If that proof is temporarily unavailable we
      // must fail closed; querying AID-keyed endpoints with the stored value
      // can return a completely valid track from another video and poison the
      // cache before a later retry repairs the identity.
      exact = await this.exactVideo(video, operation);
    }

    const finishIfSufficient = (): readonly ResolvedSubtitleTrack[] | null => {
      if (refreshTarget !== undefined) return null;
      const tracks = hasAuthoritativeIdentity
        ? reconcileAuthoritativeTracks(groups)
        : reconcileTracks(groups);
      const hasOfficialTrack = tracks.some(
        (track) => track.source === "official",
      );
      const hasUnresolvedTrack = tracks.some((track) => track.url === null);
      const sufficient =
        this.dependencies.signWbiUrl === undefined
          ? hasOfficialTrack || hasUnresolvedTrack
          : !hasUnresolvedTrack;
      if (tracks.length > 0 && sufficient) {
        this.trackCache.set(video.videoKey, tracks);
        return tracks;
      }
      return null;
    };

    if (hasAuthoritativeIdentity) {
      // Keep the unsigned call only as a bounded diagnostic probe. It has been
      // observed returning unrelated videos and same-id wrong URLs, so no part
      // of its result (including entitlement flags) enters the authoritative
      // groups, URL resolution, failures, or cache.
      try {
        await this.fetchPlayerTracks(exact, false, operation);
      } catch {
        // A diagnostic source cannot decide the acquisition outcome.
      }
    } else {
      try {
        const ordinary = await this.fetchPlayerTracks(exact, false, operation);
        needLogin ||= ordinary.needLogin;
        if (ordinary.tracks.length === 0 && !ordinary.needLogin) {
          observedConfirmedEmptyTrackList = true;
        }
        groups.push(ordinary.tracks);
      } catch (error) {
        const failure = normalizeFallbackError(error);
        if (
          failure.code === "VALIDATION_FAILED" ||
          failure.code === "CHARGED_CONTENT_UNSUPPORTED" ||
          isAuthorizationError(failure)
        ) {
          throw failure;
        }
        deferredFailure ??= failure;
      }
      const ordinaryResult = finishIfSufficient();
      if (ordinaryResult !== null) return ordinaryResult;
    }

    if (exact.aid !== undefined) {
      await collect(
        () => this.fetchPlayerTracks(exact, true, operation),
        "player",
      );
      // With signed identity support, Web View must still be consulted before
      // returning so a same-id metadata/URL conflict fails closed. Legacy
      // no-signer gateways retain their existing player fallback behavior.
      if (!hasAuthoritativeIdentity) {
        const playerResult = finishIfSufficient();
        if (playerResult !== null) return playerResult;
      }
    }

    await collect(() => this.fetchWebViewTracks(exact, operation), "web-view");
    const webViewResult = finishIfSufficient();
    if (webViewResult !== null) return webViewResult;

    const reconciledBeforeAi = hasAuthoritativeIdentity
      ? reconcileAuthoritativeTracks(groups)
      : reconcileTracks(groups);
    if (reconciledBeforeAi.length === 0) {
      await collect(() => this.fetchAiTracks(exact, operation), "ai");
    }

    let tracks = hasAuthoritativeIdentity
      ? reconcileAuthoritativeTracks(groups)
      : reconcileTracks(groups);
    if (refreshTarget !== undefined) {
      let refreshedMatch: ResolvedSubtitleTrack | null = null;
      for (const group of groups) {
        const candidate = findMatchingTrack(group, refreshTarget);
        if (candidate?.url && candidate.url !== refreshTarget.url) {
          refreshedMatch = candidate;
        }
      }
      tracks = Object.freeze(
        tracks.flatMap((track) => {
          if (findMatchingTrack([track], refreshTarget) === null) {
            return [track];
          }
          return refreshedMatch === null ? [] : [refreshedMatch];
        }),
      );
      if (refreshedMatch === null && authorizationFailure !== null) {
        throw authorizationFailure;
      }
    }
    if (tracks.length > 0) {
      // A forced refresh deliberately skips the endpoints that produced the
      // stale address, so its result is a narrower view of the same video. It
      // must not replace the authoritative track list, otherwise a failed
      // acquisition would leave the picker showing fewer languages than the
      // video really has.
      if (refreshTarget === undefined) {
        this.trackCache.set(video.videoKey, tracks);
      }
      return tracks;
    }

    if (authorizationFailure !== null) throw authorizationFailure;
    if (
      hasAuthoritativeIdentity &&
      observedOffPageAuthority &&
      !observedPageAuthority
    ) {
      throw authorizedRequestPathUnresolved();
    }

    if (needLogin) {
      throwAuthorizationError(
        await this.requestJson(
          video,
          "https://api.bilibili.com/x/web-interface/nav",
          "authorization",
          operation,
        ),
      );
    }
    if (deferredFailure !== null) throw deferredFailure;
    if (auxiliaryNetworkFailure !== null && !observedConfirmedEmptyTrackList) {
      throw auxiliaryNetworkFailure;
    }
    throw subtitleNotFound();
  }

  private async resolveTrackUrl(
    video: VideoRef,
    track: ResolvedSubtitleTrack,
    operation?: GatewayOperation,
  ): Promise<string> {
    if (track.url !== null) return track.url;
    try {
      const webViewTracks = await this.fetchWebViewTracks(
        await this.exactVideo(video, operation),
        operation,
      );
      const webViewMatch = findMatchingTrack(webViewTracks, track);
      if (webViewMatch?.url) return webViewMatch.url;
    } catch (error) {
      const failure = normalizeFallbackError(error);
      if (isAuthorizationError(failure)) throw failure;
    }
    try {
      const aiTracks = await this.fetchAiTracks(
        await this.exactVideo(video, operation),
        operation,
      );
      const aiMatch = findMatchingTrack(aiTracks, track);
      if (aiMatch?.url) return aiMatch.url;
    } catch (error) {
      const failure = normalizeFallbackError(error);
      if (isAuthorizationError(failure)) throw failure;
    }
    throw subtitleUrlExpired();
  }

  async listTracks(
    video: VideoRef,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly SubtitleTrackOption[]> {
    const operation = this.beginOperation(video, "discovery", options?.signal);
    const tracks = await this.discoverTracks(video, undefined, operation);
    return Object.freeze(
      tracks.map(({ language, name, source, trackId, trackOrigin }) =>
        Object.freeze({
          language,
          name,
          source,
          trackId,
          ...(trackOrigin === null ? {} : { origin: trackOrigin }),
        }),
      ),
    );
  }

  async acquire(
    video: VideoRef,
    trackId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DirectSubtitle> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(trackId)) throw invalidResponse();
    const operation = this.beginOperation(video, trackId, options?.signal);
    const exact = await this.exactVideo(video, operation);
    const cached = this.trackCache.get(video.videoKey);
    const available =
      cached ?? (await this.discoverTracks(exact, undefined, operation));
    const selected = available.find((track) => track.trackId === trackId);
    if (!selected) {
      throw new SubtitleGatewayError(
        "SUBTITLE_NOT_FOUND",
        "The selected Bilibili subtitle track is unavailable",
      );
    }

    let track = selected;
    if (this.dependencies.signWbiUrl !== undefined && cached !== undefined) {
      const confirmed = await this.discoverTracks(exact, undefined, operation);
      const confirmedTrack = findMatchingTrack(confirmed, selected);
      if (confirmedTrack === null) {
        throw new SubtitleGatewayError(
          "SUBTITLE_NOT_FOUND",
          "The selected Bilibili subtitle track is unavailable",
        );
      }
      track = confirmedTrack;
    }
    let content: unknown;
    let requestedUrl: string | null = null;
    try {
      requestedUrl = await this.resolveTrackUrl(exact, track, operation);
      content = await this.requestJson(
        exact,
        requestedUrl,
        "content",
        operation,
      );
    } catch (error) {
      if (
        !(error instanceof SubtitleGatewayError) ||
        (error.code !== "SUBTITLE_URL_EXPIRED" &&
          !(error.code === "NETWORK_ERROR" && error.retryable))
      ) {
        throw error;
      }
      const initialFailure = error;
      try {
        this.trackCache.delete(video.videoKey);
        const refreshed = await this.discoverTracks(
          exact,
          initialFailure.code === "NETWORK_ERROR" && requestedUrl !== null
            ? Object.freeze({ ...selected, url: requestedUrl })
            : undefined,
          operation,
        );
        const matched = findMatchingTrack(refreshed, selected);
        if (matched === null) throw initialFailure;
        track = matched;
        content = await this.requestJson(
          exact,
          await this.resolveTrackUrl(exact, track, operation),
          "content",
          operation,
        );
      } catch (refreshError) {
        if (refreshError instanceof SubtitleGatewayError) throw refreshError;
        throw initialFailure;
      }
    }
    return Object.freeze({
      language: track.language,
      rows: readRows(content),
      ...(track.trackOrigin === null ? {} : { trackOrigin: track.trackOrigin }),
    });
  }
}

export function createBilibiliSubtitleGateway(
  dependencies: BilibiliSubtitleGatewayDependencies,
): DirectSubtitleGateway {
  return new BilibiliSubtitleGateway(dependencies);
}

export function createChromeBilibiliSubtitleGateway(
  dependencies: ChromeBilibiliSubtitleGatewayDependencies,
): DirectSubtitleGateway {
  const signer = createBilibiliWbiUrlSigner({
    ...(dependencies.createRequestNonce === undefined
      ? {}
      : { createRequestNonce: dependencies.createRequestNonce }),
    fetch: dependencies.fetch,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  return createBilibiliSubtitleGateway({
    ...(dependencies.createRequestNonce === undefined
      ? {}
      : { createRequestNonce: dependencies.createRequestNonce }),
    fetch: dependencies.fetch,
    signWbiUrl: (pathname, parameters, referer) =>
      signer.sign(pathname, parameters, referer),
  });
}
