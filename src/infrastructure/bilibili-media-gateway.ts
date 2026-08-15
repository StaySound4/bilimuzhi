import {
  AuthorizedMediaGatewayError,
  type AuthorizedMedia,
} from "../application/authorized-media-gateway";
import type {
  AsrAuthorizedMediaGateway,
  AsrMediaAcquisitionOptions,
  AsrMediaAcquisitionProgress,
} from "../application/asr-contract";
import type { VideoRef } from "../domain";
import type { PageMediaDownloader } from "./chrome-page-media-downloader";

interface MediaFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?:
    | Response["body"]
    | {
        getReader(): {
          cancel(reason?: unknown): Promise<void>;
          read(): Promise<ReadableStreamReadResult<Uint8Array>>;
        };
      };
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

interface MediaRequestInit {
  readonly credentials: "include" | "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly redirect: "error";
  readonly signal?: AbortSignal;
}

export interface BilibiliMediaGatewayDependencies {
  readonly fetch: (
    url: string,
    init: MediaRequestInit,
  ) => Promise<MediaFetchResponse>;
  readonly pageDownloader?: PageMediaDownloader;
  readonly sha256?: (bytes: Readonly<Uint8Array>) => Promise<string>;
}

interface MediaCandidate {
  readonly bandwidth: number;
  readonly urls: readonly string[];
}

const MAX_MEDIA_BYTES = 1_000_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host !== "bilibili.com" &&
      !host.endsWith(".bilibili.com") &&
      host !== "bilivideo.com" &&
      !host.endsWith(".bilivideo.com") &&
      host !== "hdslb.com" &&
      !host.endsWith(".hdslb.com")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeUrls(raw: Record<string, unknown>): readonly string[] {
  const urls = [
    raw.baseUrl,
    raw.base_url,
    raw.url,
    ...(Array.isArray(raw.backupUrl) ? raw.backupUrl : []),
    ...(Array.isArray(raw.backup_url) ? raw.backup_url : []),
  ];
  return Object.freeze(
    urls
      .map(safeMediaUrl)
      .filter((url): url is string => url !== null)
      .filter((url, index, all) => all.indexOf(url) === index),
  );
}

function mediaCandidates(value: unknown): readonly MediaCandidate[] {
  if (!record(value) || !record(value.data)) return Object.freeze([]);
  const candidates: MediaCandidate[] = [];
  if (record(value.data.dash) && Array.isArray(value.data.dash.audio)) {
    for (const raw of value.data.dash.audio) {
      if (!record(raw)) continue;
      const bandwidth = Number(raw.bandwidth);
      for (const url of safeUrls(raw)) {
        candidates.push(
          Object.freeze({
            bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
            urls: Object.freeze([url]),
          }),
        );
      }
    }
  }
  if (Array.isArray(value.data.durl)) {
    const urls = value.data.durl
      .map((raw) => (record(raw) ? (safeUrls(raw)[0] ?? null) : null))
      .filter((url): url is string => url !== null);
    if (urls.length === value.data.durl.length && urls.length > 0) {
      candidates.push(
        Object.freeze({ bandwidth: -1, urls: Object.freeze(urls) }),
      );
    }
  }
  return Object.freeze(
    candidates.sort((left, right) => right.bandwidth - left.bandwidth),
  );
}

function apiFailure(value: unknown): AuthorizedMediaGatewayError | null {
  if (!record(value) || typeof value.code !== "number") {
    return new AuthorizedMediaGatewayError(
      "NETWORK_ERROR",
      "Bilibili 返回了无效媒体信息。",
      true,
    );
  }
  if (value.code === 0) return null;
  if (value.code === -101) {
    return new AuthorizedMediaGatewayError(
      "AUTHENTICATION_REQUIRED",
      "请先登录 Bilibili 后重试。",
      false,
    );
  }
  if (value.code === -10403 || value.code === -403) {
    return new AuthorizedMediaGatewayError(
      "PERMISSION_DENIED",
      "当前账号无权播放完整媒体。",
      false,
    );
  }
  return new AuthorizedMediaGatewayError(
    "NETWORK_ERROR",
    "暂时无法读取 Bilibili 媒体信息。",
    true,
  );
}

function assertEntitlement(value: unknown): void {
  const failure = apiFailure(value);
  if (failure) throw failure;
  if (!record(value) || !record(value.data)) return;
  const data = value.data;
  if (data.is_upower_exclusive === true || data.is_ugc_pay_preview === true) {
    throw new AuthorizedMediaGatewayError(
      "UNSUPPORTED_CAPABILITY",
      "不支持充电/付费视频的媒体获取。",
      false,
    );
  }
  if (data.need_login_subtitle === true) {
    throw new AuthorizedMediaGatewayError(
      "AUTHENTICATION_REQUIRED",
      "请先登录 Bilibili 后重试。",
      false,
    );
  }
}
function reportedDurationMs(value: unknown): number | null {
  if (!record(value) || !record(value.data)) return null;
  const timeLength = Number(value.data.timelength);
  if (Number.isSafeInteger(timeLength) && timeLength > 0) return timeLength;
  if (record(value.data.dash)) {
    const seconds = Number(value.data.dash.duration);
    if (Number.isFinite(seconds) && seconds > 0)
      return Math.round(seconds * 1_000);
  }
  return null;
}

function assertCompleteDuration(
  value: unknown,
  expectedDurationMs: number,
): void {
  const actualDurationMs = reportedDurationMs(value);
  if (actualDurationMs === null) {
    throw new AuthorizedMediaGatewayError(
      "MEDIA_INCOMPLETE",
      "无法验证媒体是否完整，已拒绝创建字幕。",
      false,
    );
  }
  const toleranceMs = Math.max(2_000, Math.round(expectedDurationMs * 0.02));
  if (actualDurationMs + toleranceMs < expectedDurationMs) {
    throw new AuthorizedMediaGatewayError(
      "MEDIA_INCOMPLETE",
      "只取得了试看或不完整媒体，已拒绝创建字幕。",
      false,
    );
  }
}

function abortError(): DOMException {
  return new DOMException(
    "Speech media acquisition was cancelled",
    "AbortError",
  );
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

async function publishProgress(
  options: AsrMediaAcquisitionOptions | undefined,
  progress: AsrMediaAcquisitionProgress,
): Promise<void> {
  assertNotAborted(options?.signal);
  await options?.onProgress?.(Object.freeze(progress));
  assertNotAborted(options?.signal);
}

async function awaitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  assertNotAborted(signal);
  if (signal === undefined) return await operation;
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Only api.bilibili.com accepts a credentialed cross-origin request. The
 * signed media CDN answers with a wildcard allow-origin, so credentials there
 * make the browser drop the response before it is delivered.
 */
function mediaRequestCredentials(url: string): "include" | "omit" {
  try {
    return new URL(url).hostname.toLowerCase() === "api.bilibili.com"
      ? "include"
      : "omit";
  } catch {
    return "omit";
  }
}

function requestInit(
  video: VideoRef,
  signal: AbortSignal | undefined,
  url: string,
): MediaRequestInit {
  return {
    credentials: mediaRequestCredentials(url),
    headers: Object.freeze({
      Accept: "application/json, */*",
      Referer: video.canonicalUrl,
    }),
    method: "GET",
    redirect: "error",
    signal,
  };
}

async function readJson(
  dependencies: BilibiliMediaGatewayDependencies,
  url: string,
  video: VideoRef,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  assertNotAborted(signal);
  let response: MediaFetchResponse;
  try {
    response = await awaitWithAbort(
      dependencies.fetch(url, requestInit(video, signal, url)),
      signal,
    );
  } catch {
    if (signal?.aborted) throw abortError();
    throw new AuthorizedMediaGatewayError(
      "NETWORK_ERROR",
      "无法连接 Bilibili 媒体服务。",
      true,
    );
  }
  assertNotAborted(signal);
  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthorizedMediaGatewayError(
        "AUTHENTICATION_REQUIRED",
        "请先登录 Bilibili 后重试。",
        false,
      );
    }
    if (response.status === 403) {
      throw new AuthorizedMediaGatewayError(
        "PERMISSION_DENIED",
        "当前账号无权播放完整媒体。",
        false,
      );
    }
    throw new AuthorizedMediaGatewayError(
      "NETWORK_ERROR",
      "暂时无法读取 Bilibili 媒体信息。",
      true,
    );
  }
  try {
    const value = await awaitWithAbort(response.json(), signal);
    assertNotAborted(signal);
    return value;
  } catch {
    if (signal?.aborted) throw abortError();
    throw new AuthorizedMediaGatewayError(
      "NETWORK_ERROR",
      "Bilibili 返回了无效媒体信息。",
      true,
    );
  }
}

async function defaultSha256(bytes: Readonly<Uint8Array>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function readMediaBytes(
  response: MediaFetchResponse,
  options: AsrMediaAcquisitionOptions | undefined,
): Promise<Uint8Array> {
  const expectedLength = Number(response.headers.get("content-length"));
  const expected =
    Number.isSafeInteger(expectedLength) && expectedLength > 0
      ? expectedLength
      : null;
  if (expected !== null && expected > MAX_MEDIA_BYTES) {
    throw new AuthorizedMediaGatewayError(
      "MEDIA_INCOMPLETE",
      "媒体超过安全下载上限，已拒绝创建字幕。",
      false,
    );
  }
  if (response.body === undefined || response.body === null) {
    const bytes = new Uint8Array(
      await awaitWithAbort(response.arrayBuffer(), options?.signal),
    );
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new AuthorizedMediaGatewayError(
        "MEDIA_INCOMPLETE",
        "媒体超过安全下载上限，已拒绝创建字幕。",
        false,
      );
    }
    await publishProgress(options, {
      completedBytes: bytes.byteLength,
      phase: "downloading",
      totalBytes: expected,
    });
    return bytes;
  }

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let byteLength = 0;
  const cancelReader = (): void => {
    void reader.cancel(abortError()).catch(() => undefined);
  };
  options?.signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      const item = await awaitWithAbort(
        reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>,
        options?.signal,
      );
      if (item.done) break;
      assertNotAborted(options?.signal);
      const part = Uint8Array.from(item.value);
      if (part.byteLength === 0) continue;
      byteLength += part.byteLength;
      if (
        byteLength > MAX_MEDIA_BYTES ||
        (expected !== null && byteLength > expected)
      ) {
        await reader.cancel();
        throw new AuthorizedMediaGatewayError(
          "MEDIA_INCOMPLETE",
          "媒体完整性校验失败，已拒绝创建字幕。",
          false,
        );
      }
      parts.push(part);
      await publishProgress(options, {
        completedBytes: byteLength,
        phase: "downloading",
        totalBytes: expected,
      });
    }
  } finally {
    options?.signal?.removeEventListener("abort", cancelReader);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function downloadCandidate(
  dependencies: BilibiliMediaGatewayDependencies,
  candidate: MediaCandidate,
  video: VideoRef,
  options: AsrMediaAcquisitionOptions | undefined,
): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  assertNotAborted(options?.signal);
  // The signed CDN rejects a Service Worker request: `Referer` is a forbidden
  // fetch header there, so the stream answers 403 and used to be reported as
  // "media URL expired". The page context is the only place the correct
  // referrer and origin exist, so it is used whenever it is available. A
  // cancellation still lands: the abort is checked around the download.
  if (dependencies.pageDownloader !== undefined) {
    try {
      const downloaded = await dependencies.pageDownloader.download(
        video,
        candidate.urls,
      );
      assertNotAborted(options?.signal);
      if (downloaded.bytes.byteLength === 0) {
        throw new AuthorizedMediaGatewayError(
          "MEDIA_INCOMPLETE",
          "页面返回了空音轨，已拒绝创建字幕。",
          false,
        );
      }
      return Object.freeze({
        bytes: new Uint8Array(downloaded.bytes),
        mimeType: downloaded.mimeType,
      });
    } catch (error) {
      // Page-context download is the only credentialed path for signed CDN
      // media. Do not fall through to Service Worker fetch and mislabel a
      // missing/open page as "media URL expired".
      if (error instanceof AuthorizedMediaGatewayError) {
        throw error;
      }
      throw new AuthorizedMediaGatewayError(
        "NETWORK_ERROR",
        "无法通过当前 Bilibili 页面下载完整音轨，请保持视频页打开后重试。",
        true,
      );
    }
  }
  const parts: Uint8Array[] = [];
  let mimeType = "audio/mp4";
  for (const url of candidate.urls) {
    assertNotAborted(options?.signal);
    let response: MediaFetchResponse;
    try {
      response = await dependencies.fetch(
        url,
        requestInit(video, options?.signal, url),
      );
    } catch {
      if (options?.signal?.aborted) throw abortError();
      throw new AuthorizedMediaGatewayError(
        "NETWORK_ERROR",
        "完整音轨下载失败。",
        true,
      );
    }
    if ([401, 403, 404, 410].includes(response.status)) {
      throw new AuthorizedMediaGatewayError(
        "MEDIA_URL_EXPIRED",
        "媒体地址已经过期。",
        true,
      );
    }
    if (!response.ok || response.status === 206) {
      throw new AuthorizedMediaGatewayError(
        "MEDIA_INCOMPLETE",
        "只取得了部分媒体，已拒绝创建字幕。",
        false,
      );
    }
    assertNotAborted(options?.signal);
    const bytes = await readMediaBytes(response, options);
    const expectedLength = Number(response.headers.get("content-length"));
    if (
      bytes.byteLength === 0 ||
      (Number.isSafeInteger(expectedLength) &&
        expectedLength > 0 &&
        expectedLength !== bytes.byteLength)
    ) {
      throw new AuthorizedMediaGatewayError(
        "MEDIA_INCOMPLETE",
        "媒体完整性校验失败，已拒绝创建字幕。",
        false,
      );
    }
    mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || mimeType;
    parts.push(bytes);
  }
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return Object.freeze({ bytes: combined, mimeType });
}

function playerEndpoint(video: VideoRef): string {
  const endpoint = new URL("https://api.bilibili.com/x/player/v2");
  endpoint.searchParams.set("bvid", video.bvid);
  endpoint.searchParams.set("cid", String(video.cid));
  return endpoint.toString();
}

function playUrlEndpoint(video: VideoRef): string {
  const endpoint = new URL("https://api.bilibili.com/x/player/playurl");
  endpoint.searchParams.set("bvid", video.bvid);
  endpoint.searchParams.set("cid", String(video.cid));
  endpoint.searchParams.set("fnval", "16");
  endpoint.searchParams.set("fourk", "1");
  return endpoint.toString();
}

export function createBilibiliMediaGateway(
  dependencies: BilibiliMediaGatewayDependencies,
): AsrAuthorizedMediaGateway {
  const hash = dependencies.sha256 ?? defaultSha256;
  return Object.freeze({
    async acquireCompleteAudio(
      video: VideoRef,
      options?: AsrMediaAcquisitionOptions,
    ): Promise<AuthorizedMedia> {
      assertNotAborted(options?.signal);
      if (
        typeof video.durationSec !== "number" ||
        !Number.isFinite(video.durationSec) ||
        video.durationSec <= 0
      ) {
        throw new AuthorizedMediaGatewayError(
          "VALIDATION_FAILED",
          "当前视频缺少可验证的完整时长。",
          false,
        );
      }
      const expectedDurationMs = Math.round(video.durationSec * 1_000);
      const entitlement = await readJson(
        dependencies,
        playerEndpoint(video),
        video,
        options?.signal,
      );
      assertEntitlement(entitlement);
      await publishProgress(options, {
        completedBytes: 0,
        phase: "entitlement",
        totalBytes: null,
      });

      let refreshed = false;
      while (true) {
        const metadata = await readJson(
          dependencies,
          playUrlEndpoint(video),
          video,
          options?.signal,
        );
        const failure = apiFailure(metadata);
        if (failure) throw failure;
        assertCompleteDuration(metadata, expectedDurationMs);
        await publishProgress(options, {
          completedBytes: 0,
          phase: "metadata",
          totalBytes: null,
        });
        const candidates = mediaCandidates(metadata);
        if (candidates.length === 0) {
          throw new AuthorizedMediaGatewayError(
            "UNSUPPORTED_CAPABILITY",
            "当前视频没有可用的完整音轨。",
            false,
          );
        }
        let lastError: unknown;
        let sawExpiredUrl = false;
        for (const candidate of candidates) {
          try {
            const downloaded = await downloadCandidate(
              dependencies,
              candidate,
              video,
              options,
            );
            await publishProgress(options, {
              completedBytes: 0,
              phase: "hashing",
              totalBytes: downloaded.bytes.byteLength,
            });
            const mediaIdentity = `sha256:${await awaitWithAbort(
              hash(downloaded.bytes),
              options?.signal,
            )}`;
            assertNotAborted(options?.signal);
            await publishProgress(options, {
              completedBytes: downloaded.bytes.byteLength,
              phase: "hashing",
              totalBytes: downloaded.bytes.byteLength,
            });
            return Object.freeze({
              byteLength: downloaded.bytes.byteLength,
              bytes: new Uint8Array(downloaded.bytes),
              durationMs: expectedDurationMs,
              mediaIdentity,
              mimeType: downloaded.mimeType,
              videoKey: video.videoKey,
            });
          } catch (error) {
            lastError = error;
            if (!(error instanceof AuthorizedMediaGatewayError)) throw error;
            if (error.code === "MEDIA_URL_EXPIRED") {
              sawExpiredUrl = true;
              continue;
            }
            if (error.retryable) continue;
            throw error;
          }
        }
        if (!refreshed && sawExpiredUrl) {
          refreshed = true;
          continue;
        }
        throw lastError;
      }
    },
  });
}
