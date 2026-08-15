import { AuthorizedMediaGatewayError } from "../application/authorized-media-gateway";
import type { VideoRef } from "../domain";
import { parseBilibiliPageIdentity } from "./bilibili-page-identity";

export interface PageMediaDownload {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface PageMediaDownloader {
  download(
    video: VideoRef,
    urls: readonly string[],
  ): Promise<PageMediaDownload>;
}

interface ChromePageMediaDownloaderOptions {
  readonly createRequestId: () => string;
  readonly timeoutMs?: number;
}

interface ChromePageMediaDownloaderDependencies {
  readonly runtime: {
    readonly onMessage: {
      addListener(listener: (...args: unknown[]) => void): void;
      removeListener(listener: (...args: unknown[]) => void): void;
    };
  };
  readonly scripting: {
    executeScript(injection: {
      readonly args: readonly [string, readonly string[]];
      readonly func: (
        requestId: string,
        urls: readonly string[],
      ) => Promise<void>;
      readonly target: { readonly tabId: number };
      readonly world: "MAIN";
    }): Promise<unknown>;
  };
  readonly tabs: {
    query(queryInfo: {
      readonly active?: boolean;
      readonly currentWindow?: boolean;
      readonly lastFocusedWindow?: boolean;
      readonly url?: string | readonly string[];
    }): Promise<unknown>;
  };
}

const MAX_MEDIA_BYTES = 1_000_000_000;
const MAX_MESSAGE_BYTES = 512 * 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaFailure(
  code: "MEDIA_INCOMPLETE" | "NETWORK_ERROR",
  message: string,
  retryable: boolean,
): AuthorizedMediaGatewayError {
  return new AuthorizedMediaGatewayError(code, message, retryable);
}

function safeMediaUrl(value: string): string | null {
  if (value.length === 0 || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !(
        host === "bilibili.com" ||
        host.endsWith(".bilibili.com") ||
        host === "bilivideo.com" ||
        host.endsWith(".bilivideo.com") ||
        host === "hdslb.com" ||
        host.endsWith(".hdslb.com")
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function findExactMediaTab(value: unknown, video: VideoRef): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const tabId = candidate.id;
    const tabUrl = candidate.url;
    if (
      typeof tabId !== "number" ||
      !Number.isSafeInteger(tabId) ||
      tabId <= 0 ||
      typeof tabUrl !== "string"
    ) {
      continue;
    }
    const identity = parseBilibiliPageIdentity(tabUrl);
    if (
      identity !== null &&
      identity.bvid === video.bvid &&
      identity.page === video.page
    ) {
      return tabId;
    }
  }
  return null;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length > MAX_MESSAGE_BYTES * 2) {
    throw mediaFailure("MEDIA_INCOMPLETE", "页面返回了无效的音轨分块。", false);
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw mediaFailure("MEDIA_INCOMPLETE", "页面返回了无效的音轨分块。", false);
  }
  if (binary.length === 0 || binary.length > MAX_MESSAGE_BYTES) {
    throw mediaFailure("MEDIA_INCOMPLETE", "页面返回了无效的音轨分块。", false);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function combine(parts: readonly Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function downloadBilibiliMediaInMainWorld(
  requestId: string,
  urls: readonly string[],
): Promise<void> {
  const maxMediaBytes = 1_000_000_000;
  const maxMessageBytes = 512 * 1_024;
  const post = (message: Record<string, unknown>): void => {
    window.postMessage(
      { __muzhiMedia: true, requestId, ...message },
      window.location.origin,
    );
  };
  const toBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8_000) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + 0x8_000),
      );
    }
    return window.btoa(binary);
  };
  for (const url of urls) {
    try {
      const response = await window.fetch(url, {
        // The media CDN answers with a wildcard allow-origin, which the
        // browser rejects for a credentialed cross-origin request. The URL is
        // already signed for this session, so the referrer is what authorizes
        // it -- exactly how the Bilibili player itself fetches the stream.
        credentials: "omit",
        method: "GET",
        redirect: "follow",
        referrer: window.location.href,
        referrerPolicy: "strict-origin-when-cross-origin",
      });
      if (!response.ok || response.status === 206) continue;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > maxMediaBytes) {
        continue;
      }
      const reportedLength = Number(response.headers.get("content-length"));
      if (
        Number.isSafeInteger(reportedLength) &&
        reportedLength > 0 &&
        reportedLength !== buffer.byteLength
      ) {
        continue;
      }
      const mimeType =
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        "audio/mp4";
      post({
        byteLength: buffer.byteLength,
        mimeType,
        type: "muzhi.media.started",
      });
      const bytes = new Uint8Array(buffer);
      let index = 0;
      for (let offset = 0; offset < bytes.length; offset += maxMessageBytes) {
        post({
          data: toBase64(bytes.subarray(offset, offset + maxMessageBytes)),
          index,
          type: "muzhi.media.chunk",
        });
        index += 1;
      }
      post({
        byteLength: buffer.byteLength,
        type: "muzhi.media.completed",
      });
      return;
    } catch {
      // Try the next bounded URL without exposing the address or raw failure.
    }
  }
  post({ type: "muzhi.media.failed" });
}

export function createChromePageMediaDownloader(
  dependencies: ChromePageMediaDownloaderDependencies,
  options: ChromePageMediaDownloaderOptions,
): PageMediaDownloader {
  const downloader: PageMediaDownloader = {
    async download(video: VideoRef, inputUrls: readonly string[]) {
      const urls = inputUrls
        .map((url) => safeMediaUrl(url))
        .filter((url): url is string => url !== null)
        .filter((url, index, all) => all.indexOf(url) === index);
      if (urls.length === 0 || urls.length > 20) {
        throw mediaFailure(
          "MEDIA_INCOMPLETE",
          "Bilibili 返回了无效的音轨地址。",
          false,
        );
      }
      const focusedTabs = await dependencies.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      let tabId = findExactMediaTab(focusedTabs, video);
      if (tabId === null) {
        const videoTabs = await dependencies.tabs.query({
          url: ["https://www.bilibili.com/video/*"],
        });
        tabId = findExactMediaTab(videoTabs, video);
      }
      if (tabId === null) {
        throw mediaFailure(
          "NETWORK_ERROR",
          "请先打开并保持当前视频页面，再进行语音转字幕。",
          true,
        );
      }
      const requestId = options.createRequestId();
      if (!/^[A-Za-z0-9._-]{1,96}$/.test(requestId)) {
        throw mediaFailure("NETWORK_ERROR", "无法创建页面音轨下载任务。", true);
      }

      const parts: Uint8Array[] = [];
      let expectedLength: number | null = null;
      let mimeType = "audio/mp4";
      let nextIndex = 0;
      let total = 0;
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let resolveResult: (value: PageMediaDownload) => void = () => undefined;
      let rejectResult: (reason: unknown) => void = () => undefined;
      const result = new Promise<PageMediaDownload>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const cleanup = (): void => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        dependencies.runtime.onMessage.removeListener(listener);
      };
      const fail = (error: AuthorizedMediaGatewayError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectResult(error);
      };
      const listener = (...args: unknown[]): void => {
        const message = args[0];
        const sender = args[1];
        if (
          settled ||
          !isRecord(message) ||
          message.requestId !== requestId ||
          !isRecord(sender) ||
          !isRecord(sender.tab) ||
          sender.tab.id !== tabId
        ) {
          return;
        }
        try {
          if (message.type === "muzhi.media.started") {
            if (
              expectedLength !== null ||
              typeof message.byteLength !== "number" ||
              !Number.isSafeInteger(message.byteLength) ||
              message.byteLength <= 0 ||
              message.byteLength > MAX_MEDIA_BYTES ||
              typeof message.mimeType !== "string" ||
              message.mimeType.length === 0 ||
              message.mimeType.length > 128
            ) {
              throw mediaFailure(
                "MEDIA_INCOMPLETE",
                "页面返回了无效的音轨元数据。",
                false,
              );
            }
            expectedLength = message.byteLength;
            mimeType = message.mimeType;
            return;
          }
          if (message.type === "muzhi.media.chunk") {
            if (
              expectedLength === null ||
              message.index !== nextIndex ||
              typeof message.data !== "string"
            ) {
              throw mediaFailure(
                "MEDIA_INCOMPLETE",
                "页面返回了乱序或缺失的音轨分块。",
                false,
              );
            }
            const part = decodeBase64(message.data);
            total += part.byteLength;
            if (total > expectedLength || total > MAX_MEDIA_BYTES) {
              throw mediaFailure(
                "MEDIA_INCOMPLETE",
                "页面返回的音轨长度不一致。",
                false,
              );
            }
            parts.push(part);
            nextIndex += 1;
            return;
          }
          if (message.type === "muzhi.media.completed") {
            if (
              expectedLength === null ||
              message.byteLength !== expectedLength ||
              total !== expectedLength
            ) {
              throw mediaFailure(
                "MEDIA_INCOMPLETE",
                "页面返回的音轨长度不一致。",
                false,
              );
            }
            settled = true;
            cleanup();
            resolveResult(
              Object.freeze({
                bytes: combine(parts, total),
                mimeType,
              }),
            );
            return;
          }
          if (message.type === "muzhi.media.failed") {
            throw mediaFailure(
              "NETWORK_ERROR",
              "当前 Bilibili 页面无法下载完整音轨。",
              true,
            );
          }
        } catch (error) {
          fail(
            error instanceof AuthorizedMediaGatewayError
              ? error
              : mediaFailure(
                  "MEDIA_INCOMPLETE",
                  "页面返回了无效的音轨数据。",
                  false,
                ),
          );
        }
      };

      dependencies.runtime.onMessage.addListener(listener);
      timeoutId = setTimeout(
        () =>
          fail(
            mediaFailure("NETWORK_ERROR", "页面音轨下载超时，请重试。", true),
          ),
        options.timeoutMs ?? 180_000,
      );
      void dependencies.scripting
        .executeScript({
          args: [requestId, Object.freeze(urls)],
          func: downloadBilibiliMediaInMainWorld,
          target: { tabId },
          world: "MAIN",
        })
        .catch(() =>
          fail(
            mediaFailure(
              "NETWORK_ERROR",
              "无法连接当前 Bilibili 页面下载音轨。",
              true,
            ),
          ),
        );
      return result;
    },
  };
  return Object.freeze(downloader);
}

export function createChromePageMediaDownloaderFromChrome(
  chromeValue: unknown,
  options: ChromePageMediaDownloaderOptions,
): PageMediaDownloader {
  if (!isRecord(chromeValue)) {
    throw new Error("Chrome page media APIs are unavailable");
  }
  const runtime = Reflect.get(chromeValue, "runtime") as unknown;
  const scripting = Reflect.get(chromeValue, "scripting") as unknown;
  const tabs = Reflect.get(chromeValue, "tabs") as unknown;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
    : null;
  const addListener = isRecord(onMessage)
    ? (Reflect.get(onMessage, "addListener") as unknown)
    : null;
  const removeListener = isRecord(onMessage)
    ? (Reflect.get(onMessage, "removeListener") as unknown)
    : null;
  const executeScript = isRecord(scripting)
    ? (Reflect.get(scripting, "executeScript") as unknown)
    : null;
  const query = isRecord(tabs) ? (Reflect.get(tabs, "query") as unknown) : null;
  if (
    !isRecord(onMessage) ||
    typeof addListener !== "function" ||
    typeof removeListener !== "function" ||
    !isRecord(scripting) ||
    typeof executeScript !== "function" ||
    !isRecord(tabs) ||
    typeof query !== "function"
  ) {
    throw new Error("Chrome page media APIs are unavailable");
  }
  return createChromePageMediaDownloader(
    {
      runtime: {
        onMessage: {
          addListener: (listener) =>
            Reflect.apply(addListener, onMessage, [listener]),
          removeListener: (listener) =>
            Reflect.apply(removeListener, onMessage, [listener]),
        },
      },
      scripting: {
        executeScript: (injection) =>
          Reflect.apply(executeScript, scripting, [injection]),
      },
      tabs: {
        query: (queryInfo) => Reflect.apply(query, tabs, [queryInfo]),
      },
    },
    options,
  );
}
