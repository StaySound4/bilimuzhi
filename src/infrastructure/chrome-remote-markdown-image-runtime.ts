import type {
  AiProviderImageMimeType,
  AiProviderImageOutputDescriptor,
} from "../application/ai/provider-contract";
import type { ProcessedAttachmentImage } from "../application/attachment-repository";
import type {
  RemoteMarkdownImageRequest,
  RemoteMarkdownImageResult,
} from "../ui/markdown";

const REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION = 1;
const REMOTE_MARKDOWN_IMAGE_MAX_BYTES = 5 * 1_024 * 1_024;
const REMOTE_MARKDOWN_IMAGE_ASSET_TTL_MS = 5 * 60 * 1_000;
const REMOTE_MARKDOWN_IMAGE_CACHE_NAME = "muzhi-remote-markdown-images-v1";
const REMOTE_MARKDOWN_IMAGE_CACHE_PREFIX =
  "https://muzhi-runtime.invalid/remote-markdown-image/";
const REMOTE_MARKDOWN_IMAGE_ASSET_EXPIRY_HEADER = "x-muzhi-asset-expires-at";
const ASSET_HANDLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RemoteMarkdownImageCommand = Readonly<{
  payload: Readonly<{ url: string }>;
  protocolVersion: typeof REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION;
  requestId: string;
  type: "muzhi.remote-markdown-image.load";
}>;

type RemoteMarkdownImageEvent =
  | Readonly<{
      assetHandle: string;
      protocolVersion: typeof REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION;
      requestId: string;
      type: "muzhi.remote-markdown-image.loaded";
    }>
  | Readonly<{
      protocolVersion: typeof REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION;
      requestId: string;
      type: "muzhi.remote-markdown-image.failed";
    }>;

interface RemoteMarkdownImageAssetStore {
  consume(assetHandle: string): Promise<Blob | null>;
  discard(assetHandle: string): Promise<void>;
  put(blob: Blob): Promise<string>;
  sweepExpired(): Promise<void>;
}

export interface ChromeRemoteMarkdownImageRuntimeClient {
  readonly load: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
  dispose(): void;
}

export interface ChromeRemoteMarkdownImageRuntimeClientDependencies {
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly createRequestId?: () => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export type RemoteMarkdownImageProcessor = (
  descriptor: AiProviderImageOutputDescriptor,
) => Promise<ProcessedAttachmentImage>;

export class ChromeRemoteMarkdownImageRuntimeError extends Error {
  constructor(
    readonly code: "IMAGE_OUTPUT_REJECTED" | "INTERNAL_ERROR",
    readonly retryable: boolean,
  ) {
    super("远程图片加载失败，请重试。");
    this.name = "ChromeRemoteMarkdownImageRuntimeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageMimeType(value: unknown): value is AiProviderImageMimeType {
  return (
    value === "image/jpeg" || value === "image/png" || value === "image/webp"
  );
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      /\.svg$/i.test(url.pathname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isCommand(value: unknown): value is RemoteMarkdownImageCommand {
  if (
    !isRecord(value) ||
    value.type !== "muzhi.remote-markdown-image.load" ||
    value.protocolVersion !== REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.requestId.length > 256 ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  return safeRemoteUrl(value.payload.url) !== null;
}

function failedEvent(requestId: string): RemoteMarkdownImageEvent {
  return Object.freeze({
    protocolVersion: REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.remote-markdown-image.failed",
  });
}

function detectedMimeType(bytes: Uint8Array): AiProviderImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function safeAssetHandle(value: unknown): string | null {
  return typeof value === "string" && ASSET_HANDLE_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function createAssetHandle(): string {
  const handle = globalThis.crypto.randomUUID().toLowerCase();
  if (!ASSET_HANDLE_PATTERN.test(handle)) {
    throw new Error("Unable to create a remote image asset handle");
  }
  return handle;
}

function cacheRequest(assetHandle: string): Request {
  return new Request(`${REMOTE_MARKDOWN_IMAGE_CACHE_PREFIX}${assetHandle}`, {
    method: "GET",
  });
}

function createCacheAssetStore(
  cacheStorage: CacheStorage,
): RemoteMarkdownImageAssetStore {
  const openCache = () => cacheStorage.open(REMOTE_MARKDOWN_IMAGE_CACHE_NAME);
  return Object.freeze({
    async consume(assetHandle: string) {
      const handle = safeAssetHandle(assetHandle);
      if (handle === null) return null;
      const cache = await openCache();
      const request = cacheRequest(handle);
      const response = await cache.match(request);
      if (response === undefined || !(await cache.delete(request))) return null;
      const expiresAt = Number(
        response.headers.get(REMOTE_MARKDOWN_IMAGE_ASSET_EXPIRY_HEADER),
      );
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      return response.blob();
    },
    async discard(assetHandle: string) {
      const handle = safeAssetHandle(assetHandle);
      if (handle === null) return;
      await (await openCache()).delete(cacheRequest(handle));
    },
    async put(blob: Blob) {
      const assetHandle = createAssetHandle();
      const cache = await openCache();
      await cache.put(
        cacheRequest(assetHandle),
        new Response(blob, {
          headers: {
            [REMOTE_MARKDOWN_IMAGE_ASSET_EXPIRY_HEADER]: String(
              Date.now() + REMOTE_MARKDOWN_IMAGE_ASSET_TTL_MS,
            ),
            "content-type": blob.type,
          },
        }),
      );
      return assetHandle;
    },
    async sweepExpired() {
      const cache = await openCache();
      const now = Date.now();
      for (const request of await cache.keys()) {
        if (!request.url.startsWith(REMOTE_MARKDOWN_IMAGE_CACHE_PREFIX)) {
          continue;
        }
        const response = await cache.match(request);
        const expiresAt = Number(
          response?.headers.get(REMOTE_MARKDOWN_IMAGE_ASSET_EXPIRY_HEADER),
        );
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
          await cache.delete(request);
        }
      }
    },
  });
}

interface InMemoryAsset {
  readonly blob: Blob;
  readonly expiresAt: number;
}

// Unit/SSR environments do not expose CacheStorage. This fallback is never
// selected in extension production contexts, where both the Service Worker and
// SidePanel share the origin-scoped CacheStorage instance above.
const nonBrowserAssetFallback = new Map<string, InMemoryAsset>();

function createNonBrowserAssetStore(): RemoteMarkdownImageAssetStore {
  return Object.freeze({
    async consume(assetHandle: string) {
      const handle = safeAssetHandle(assetHandle);
      if (handle === null) return null;
      const asset = nonBrowserAssetFallback.get(handle);
      nonBrowserAssetFallback.delete(handle);
      if (asset === undefined || asset.expiresAt <= Date.now()) return null;
      return asset.blob;
    },
    async discard(assetHandle: string) {
      const handle = safeAssetHandle(assetHandle);
      if (handle !== null) nonBrowserAssetFallback.delete(handle);
    },
    async put(blob: Blob) {
      const assetHandle = createAssetHandle();
      nonBrowserAssetFallback.set(
        assetHandle,
        Object.freeze({
          blob,
          expiresAt: Date.now() + REMOTE_MARKDOWN_IMAGE_ASSET_TTL_MS,
        }),
      );
      return assetHandle;
    },
    async sweepExpired() {
      const now = Date.now();
      for (const [assetHandle, asset] of nonBrowserAssetFallback) {
        if (asset.expiresAt <= now) nonBrowserAssetFallback.delete(assetHandle);
      }
    },
  });
}

function createDefaultAssetStore(): RemoteMarkdownImageAssetStore {
  const cacheStorage = Reflect.get(globalThis, "caches") as unknown;
  return isRecord(cacheStorage) && typeof cacheStorage.open === "function"
    ? createCacheAssetStore(cacheStorage as unknown as CacheStorage)
    : createNonBrowserAssetStore();
}

function assertEvent(
  value: unknown,
  requestId: string,
): RemoteMarkdownImageEvent {
  if (
    !isRecord(value) ||
    value.protocolVersion !== REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION ||
    value.requestId !== requestId
  ) {
    throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
  }
  if (value.type === "muzhi.remote-markdown-image.loaded") {
    if (
      Object.keys(value).length !== 4 ||
      safeAssetHandle(value.assetHandle) === null
    ) {
      throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
    }
  } else if (value.type === "muzhi.remote-markdown-image.failed") {
    if (Object.keys(value).length !== 3) {
      throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
    }
  } else {
    throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
  }
  return value as RemoteMarkdownImageEvent;
}

function safeRevokeObjectUrl(
  revokeObjectUrl: (url: string) => void,
  objectUrl: string,
): void {
  try {
    revokeObjectUrl(objectUrl);
  } catch {
    // Component cleanup and pagehide disposal may release the same URL.
  }
}

export function createChromeRemoteMarkdownImageRuntimeClient(
  chromeValue: unknown,
  dependencies: ChromeRemoteMarkdownImageRuntimeClientDependencies = {},
): ChromeRemoteMarkdownImageRuntimeClient {
  const runtime = isRecord(chromeValue) ? chromeValue.runtime : null;
  const sendMessage = isRecord(runtime) ? runtime.sendMessage : null;
  if (!isRecord(runtime) || typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const assetStore = createDefaultAssetStore();
  const createRequestId =
    dependencies.createRequestId ?? (() => globalThis.crypto.randomUUID());
  const createObjectUrl =
    dependencies.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const objectUrls = new Set<string>();
  let disposed = false;

  void assetStore.sweepExpired().catch(() => undefined);

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const objectUrl of objectUrls) {
        safeRevokeObjectUrl(revokeObjectUrl, objectUrl);
      }
      objectUrls.clear();
    },
    async load(request: RemoteMarkdownImageRequest) {
      if (disposed) {
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      const url = safeRemoteUrl(request.url);
      if (url === null) {
        throw new ChromeRemoteMarkdownImageRuntimeError(
          "IMAGE_OUTPUT_REJECTED",
          false,
        );
      }
      const requestId = createRequestId();
      const command: RemoteMarkdownImageCommand = Object.freeze({
        payload: Object.freeze({ url }),
        protocolVersion: REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION,
        requestId,
        type: "muzhi.remote-markdown-image.load",
      });
      let event: RemoteMarkdownImageEvent;
      try {
        event = assertEvent(
          await Reflect.apply(sendMessage, runtime, [command]),
          requestId,
        );
      } catch (error) {
        if (error instanceof ChromeRemoteMarkdownImageRuntimeError) throw error;
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      if (event.type === "muzhi.remote-markdown-image.failed") {
        throw new ChromeRemoteMarkdownImageRuntimeError(
          "IMAGE_OUTPUT_REJECTED",
          true,
        );
      }
      const assetHandle = event.assetHandle;
      if (disposed) {
        await assetStore.discard(assetHandle).catch(() => undefined);
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      let blob: Blob | null;
      try {
        blob = await assetStore.consume(assetHandle);
      } catch {
        blob = null;
      }
      if (
        !(blob instanceof Blob) ||
        blob.size <= 0 ||
        blob.size > REMOTE_MARKDOWN_IMAGE_MAX_BYTES ||
        !isImageMimeType(blob.type)
      ) {
        throw new ChromeRemoteMarkdownImageRuntimeError(
          "IMAGE_OUTPUT_REJECTED",
          true,
        );
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (detectedMimeType(bytes) !== blob.type || disposed) {
        throw new ChromeRemoteMarkdownImageRuntimeError(
          "IMAGE_OUTPUT_REJECTED",
          !disposed,
        );
      }
      const ownedBytes = new Uint8Array(bytes.byteLength);
      ownedBytes.set(bytes);
      let objectUrl: string;
      try {
        objectUrl = createObjectUrl(
          new Blob([ownedBytes.buffer], { type: blob.type }),
        );
      } catch {
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      if (!objectUrl.startsWith("blob:") || objectUrl.length > 2_048) {
        if (objectUrl.startsWith("blob:")) {
          safeRevokeObjectUrl(revokeObjectUrl, objectUrl);
        }
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      if (disposed) {
        safeRevokeObjectUrl(revokeObjectUrl, objectUrl);
        throw new ChromeRemoteMarkdownImageRuntimeError("INTERNAL_ERROR", true);
      }
      objectUrls.add(objectUrl);
      return Object.freeze({ objectUrl: objectUrl as `blob:${string}` });
    },
  });
}

export function installChromeRemoteMarkdownImageRuntimeListener(
  chromeValue: unknown,
  processImage: RemoteMarkdownImageProcessor,
): void {
  const runtime = isRecord(chromeValue) ? chromeValue.runtime : null;
  const onMessage = isRecord(runtime) ? runtime.onMessage : null;
  const addListener = isRecord(onMessage) ? onMessage.addListener : null;
  if (!isRecord(onMessage) || typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }
  const assetStore = createDefaultAssetStore();
  void assetStore.sweepExpired().catch(() => undefined);
  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: RemoteMarkdownImageEvent) => void,
    ): boolean => {
      if (!isCommand(message)) return false;
      const command = message;
      void (async (): Promise<void> => {
        let assetHandle: string | null = null;
        try {
          await assetStore.sweepExpired();
          const image = await processImage({
            kind: "remote",
            url: command.payload.url,
          });
          if (
            !(image.blob instanceof Blob) ||
            image.blob.size <= 0 ||
            image.blob.size > REMOTE_MARKDOWN_IMAGE_MAX_BYTES ||
            !isImageMimeType(image.mimeType) ||
            image.blob.type !== image.mimeType
          ) {
            throw new Error("Invalid processed remote image");
          }
          const bytes = new Uint8Array(await image.blob.arrayBuffer());
          if (detectedMimeType(bytes) !== image.mimeType) {
            throw new Error("Invalid processed remote image");
          }
          assetHandle = await assetStore.put(image.blob);
          try {
            sendResponse(
              Object.freeze({
                assetHandle,
                protocolVersion: REMOTE_MARKDOWN_IMAGE_PROTOCOL_VERSION,
                requestId: command.requestId,
                type: "muzhi.remote-markdown-image.loaded",
              }),
            );
          } catch {
            await assetStore.discard(assetHandle);
          }
        } catch {
          if (assetHandle !== null) {
            await assetStore.discard(assetHandle).catch(() => undefined);
          }
          try {
            sendResponse(failedEvent(command.requestId));
          } catch {
            // A closed runtime channel has no response recipient.
          }
        }
      })();
      return true;
    },
  ]);
}
