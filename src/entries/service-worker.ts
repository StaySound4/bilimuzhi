import {
  createSubtitleFailureEvent,
  createSubtitleRuntimeHandler,
  type SubtitleRuntimeHandler,
} from "../application/subtitle-runtime";
import {
  createGenerationTaskCoordinator,
  type GenerationTaskCoordinator,
} from "../application/task";
import {
  createChatRuntime,
  type ChatAssistantUpdate,
  type ChatRuntime,
} from "../application/chat-runtime";
import {
  createArtifactRuntime,
  type ArtifactRuntime,
  type ArtifactUpdate,
} from "../application/artifact-runtime";
import { installChromeArtifactRuntimeListener } from "../infrastructure/chrome-artifact-runtime";
import {
  createBatchRuntime,
  type BatchJobView,
  type BatchRuntime,
} from "../application/batch-runtime";
import { installChromeBatchRuntimeListener } from "../infrastructure/chrome-batch-runtime";
import { createBilibiliBatchSourceGateway } from "../infrastructure/bilibili-batch-sources";
import { IndexedDbBatchRepository } from "../infrastructure/indexeddb/batch-repository";
import { IndexedDbSubtitleContextReader } from "../infrastructure/indexeddb/subtitle-context-reader";
import { createChromeBilibiliVideoGateway } from "../infrastructure/bilibili-video-gateway";
import { IndexedDbArtifactRepository } from "../infrastructure/indexeddb/artifact-repository";
import type {
  AiGenerationRequest,
  AiProviderGateway,
} from "../application/ai/provider-contract";
import { createSpeechAcquisitionCoordinator } from "../application/asr/speech-acquisition-coordinator";
import { createSpeechAcquisitionExecutor } from "../application/asr/speech-acquisition-executor";
import {
  SPEECH_RUNTIME_PROTOCOL_VERSION,
  safeSpeechRuntimeFailure,
  type SpeechRuntimeEvent,
} from "../application/asr/speech-runtime";
import { parseVideoKey, type TaskOwner } from "../domain";
import { createBranchSubtitleAcquisitionService } from "../application/branch-subtitle-acquisition";
import { createDirectSubtitleAcquirer } from "../application/subtitle-gateway";
import {
  createChromeBilibiliSubtitleGateway,
  type BilibiliSubtitleRequestOwner,
} from "../infrastructure/bilibili-subtitle-gateway";
import { createBilibiliMediaGateway } from "../infrastructure/bilibili-media-gateway";
import {
  createChromeBilibiliPageFetchFromChrome,
  type ChromeBilibiliPageFetch,
} from "../infrastructure/chrome-bilibili-page-fetch";
import {
  createChromeBilibiliMediaFetchFromChrome,
  type ChromeBilibiliMediaFetch,
} from "../infrastructure/chrome-bilibili-media-fetch";
import { mergeTimestampedChunkRows } from "../infrastructure/asr/chunk-merger";
import { createChromeOffscreenAudioChunkProcessor } from "../infrastructure/chrome-offscreen-audio";
import {
  createChromeOffscreenGroqChunkTranscriber,
  installChromeGroqOffscreenCredentialBroker,
} from "../infrastructure/chrome-offscreen-groq";
import { resolveGroqApiKeyFromStorage } from "../infrastructure/chrome-offscreen-groq";
import { createChromeOffscreenSpeechTaskKeepalive } from "../infrastructure/chrome-offscreen-keepalive";
import {
  createChromeSpeechAcquisitionStore,
  type ChromeAsrStorageArea,
  type ChromeOffscreenApi,
} from "../infrastructure/chrome-asr-runtime";
import { installChromeSpeechRuntimeListener } from "../infrastructure/chrome-speech-runtime";
import { installChromeContentPlayerRelay } from "../infrastructure/chrome-content-player-relay";
import { createChromeSeekSequenceAllocator } from "../infrastructure/chrome-seek-sequence";
import { installChromeChatRuntimeListener } from "../infrastructure/chrome-chat-runtime";
import { installChromeGenerationRuntimeListener } from "../infrastructure/chrome-generation-runtime";
import { createChromeSettingsStore } from "../infrastructure/chrome-settings-store";
import { installChromeSubtitleRuntimeListener } from "../infrastructure/chrome-subtitle-runtime";
import { createChromeTaskRuntime } from "../infrastructure/chrome-task-runtime";
import type { ChromeWorkspaceStorageArea } from "../infrastructure/chrome-workspace-state-store";
import { IndexedDbGenerationRepository } from "../infrastructure/indexeddb/generation-repository";
import { IndexedDbChatRepository } from "../infrastructure/indexeddb/chat-repository";
import {
  createAttachmentBlobResolver,
  createIndexedDbAttachmentRepository,
} from "../infrastructure/indexeddb/attachment-repository";
import {
  createProviderImageOutputProcessor,
  processImageAttachment,
  type ProviderImageOutputProcessorDependencies,
} from "../infrastructure/image-attachment-processor";
import { installChromeRemoteMarkdownImageRuntimeListener } from "../infrastructure/chrome-remote-markdown-image-runtime";
import { createBilimuzhiDatabaseBootstrap } from "../infrastructure/indexeddb/muzhi-database-bootstrap";
import { IndexedDbSubtitleRepository } from "../infrastructure/indexeddb/subtitle-repository";
import { hashSubtitleRows } from "../infrastructure/subtitle-content-hash";
import type {
  BranchSubtitleRepository,
  InitialSubtitleCommitResult,
  SubtitleAcquisitionContext,
} from "../application/subtitle-repository";
import {
  createBatchSubtitle,
  createSession,
  type BatchItem,
  type SubtitleSnapshot,
  type VideoKey,
} from "../domain";

const chromeValue = Reflect.get(globalThis, "chrome") as unknown;
const taskRuntime = createChromeTaskRuntime(chromeValue, {
  createBrowserSessionId: () => globalThis.crypto.randomUUID(),
});

// 点击扩展图标直接打开侧边栏（Chrome 126+ 需要显式声明面板行为）。
// 失败静默：侧边栏仍可通过右键图标 →「在侧边栏中打开」访问。
const sidePanelApi = Reflect.get(chromeValue as object, "sidePanel") as
  | {
      setPanelBehavior(input: {
        openPanelOnActionClick: boolean;
      }): Promise<void>;
    }
  | undefined;
void sidePanelApi
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);

let subtitleHandler: Promise<SubtitleRuntimeHandler> | null = null;
let generationRecovery: Promise<void> | null = null;
let generationCoordinator: Promise<GenerationTaskCoordinator> | null = null;
let chatRuntime: Promise<ChatRuntime> | null = null;
let artifactRuntime: Promise<ArtifactRuntime> | null = null;
let batchRuntime: Promise<BatchRuntime> | null = null;
let speechCoordinator: Promise<
  ReturnType<typeof createSpeechAcquisitionCoordinator>
> | null = null;
let batchSpeechCoordinator: Promise<
  ReturnType<typeof createSpeechAcquisitionCoordinator>
> | null = null;
let checkpointMigrationCleanup: Promise<void> | null = null;
const batchSpeechTargets = new Map<VideoKey, string>();
const bilibiliPageFetch: ChromeBilibiliPageFetch =
  createChromeBilibiliPageFetchFromChrome(chromeValue);
const bilibiliMediaFetch: ChromeBilibiliMediaFetch =
  createChromeBilibiliMediaFetchFromChrome(chromeValue);
const PROVIDER_IMAGE_DOWNLOAD_MAX_BYTES = 5 * 1_024 * 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const providerImageOutputProcessorDependencies: ProviderImageOutputProcessorDependencies =
  Object.freeze({
    async download(
      input: Parameters<
        ProviderImageOutputProcessorDependencies["download"]
      >[0],
    ) {
      const response = await globalThis.fetch(input.url, {
        credentials: input.credentials,
        redirect: input.redirect,
      });
      if (!response.ok || response.body === null) {
        throw new Error("Provider image download failed");
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > PROVIDER_IMAGE_DOWNLOAD_MAX_BYTES
      ) {
        throw new Error("Provider image download failed");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > PROVIDER_IMAGE_DOWNLOAD_MAX_BYTES) {
            await reader.cancel();
            throw new Error("Provider image download failed");
          }
          chunks.push(result.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return Object.freeze({
        bytes,
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: response.url,
      });
    },
    async reencode(
      input: Parameters<
        ProviderImageOutputProcessorDependencies["reencode"]
      >[0],
    ) {
      const ownedBytes = new Uint8Array(input.bytes.byteLength);
      ownedBytes.set(input.bytes);
      return processImageAttachment(
        new File([ownedBytes.buffer], "provider-image", {
          type: input.mimeType,
        }),
        {
          correctOrientation: true,
          maxBytes: PROVIDER_IMAGE_DOWNLOAD_MAX_BYTES,
          stripMetadata: true,
        },
      );
    },
  });

function getBilibiliPageFetch(): ChromeBilibiliPageFetch {
  return bilibiliPageFetch;
}

function getBilibiliMediaFetch(): ChromeBilibiliMediaFetch {
  return bilibiliMediaFetch;
}

function isBilibiliAuthenticationFailure(error: unknown): boolean {
  return isRecord(error) && error.code === "AUTHENTICATION_REQUIRED";
}

function apiReferer(url: string): string {
  try {
    const target = new URL(url);
    const bvid = target.searchParams.get("bvid");
    return bvid !== null && /^BV[0-9A-Za-z]{10}$/.test(bvid)
      ? `https://www.bilibili.com/video/${bvid}`
      : "https://www.bilibili.com/";
  } catch {
    return "https://www.bilibili.com/";
  }
}

function authenticationFailureResponse() {
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error("Bilibili login is required"));
  return Object.freeze({
    ok: false,
    status: 401,
    arrayBuffer: unavailable,
    json: unavailable,
  });
}

async function fetchAuthorizedBilibiliApi(
  url: string,
  init: {
    readonly credentials: "include";
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "GET";
    readonly owner?: BilibiliSubtitleRequestOwner;
    readonly signal?: AbortSignal;
  },
) {
  try {
    return await getBilibiliPageFetch()(url, {
      credentials: "include",
      headers: Object.freeze({
        Accept: init.headers.Accept ?? "application/json",
        Referer: init.headers.Referer ?? apiReferer(url),
      }),
      method: "GET",
      ...(init.owner === undefined ? {} : { owner: init.owner }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
  } catch (error) {
    if (isBilibiliAuthenticationFailure(error)) {
      return authenticationFailureResponse();
    }
    throw error;
  }
}

async function fetchAuthorizedBilibiliMedia(
  url: string,
  init: {
    readonly credentials: "include" | "omit";
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "GET";
    readonly redirect: "error";
    readonly signal?: AbortSignal;
  },
) {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return globalThis.fetch(url, init);
  }
  if (
    target.hostname === "api.bilibili.com" &&
    (target.pathname === "/x/player/v2" ||
      target.pathname === "/x/player/playurl")
  ) {
    const response = await fetchAuthorizedBilibiliApi(url, {
      credentials: "include",
      headers: init.headers,
      method: init.method,
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
    return Object.freeze({
      ...response,
      headers: Object.freeze({ get: () => null }),
    });
  }
  const host = target.hostname.toLowerCase();
  if (
    init.credentials === "omit" &&
    (host === "bilibili.com" ||
      host.endsWith(".bilibili.com") ||
      host === "bilivideo.com" ||
      host.endsWith(".bilivideo.com") ||
      host === "hdslb.com" ||
      host.endsWith(".hdslb.com"))
  ) {
    return getBilibiliMediaFetch()(url, {
      credentials: "omit",
      headers: init.headers,
      method: "GET",
      redirect: "error",
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
  }
  return globalThis.fetch(url, init);
}

function readChromeLocalStorage(
  chromeApi: unknown,
): ChromeWorkspaceStorageArea & ChromeAsrStorageArea {
  const storage = isRecord(chromeApi)
    ? (Reflect.get(chromeApi, "storage") as unknown)
    : null;
  const local = isRecord(storage)
    ? (Reflect.get(storage, "local") as unknown)
    : null;
  const get = isRecord(local) ? (Reflect.get(local, "get") as unknown) : null;
  const remove = isRecord(local)
    ? (Reflect.get(local, "remove") as unknown)
    : null;
  const set = isRecord(local) ? (Reflect.get(local, "set") as unknown) : null;
  if (
    !isRecord(local) ||
    typeof get !== "function" ||
    typeof set !== "function"
  ) {
    throw new Error("Chrome local settings storage is unavailable");
  }
  return Object.freeze({
    async get(key: string | null): Promise<Record<string, unknown>> {
      const result = await Reflect.apply(get, local, [key]);
      if (!isRecord(result)) {
        throw new Error("Chrome local settings storage returned invalid data");
      }
      return Object.freeze({ ...result });
    },
    ...(typeof remove === "function"
      ? {
          async remove(keys: string | readonly string[]): Promise<void> {
            await Reflect.apply(remove, local, [keys]);
          },
        }
      : {}),
    async set(items: Record<string, unknown>): Promise<void> {
      await Reflect.apply(set, local, [items]);
    },
  });
}

const V9_CHECKPOINT_CLEANUP_MARKER =
  "muzhi.batch.independent-migration-v9.checkpoints-cleared";

async function cleanupV9LegacyCheckpoints(): Promise<void> {
  if (checkpointMigrationCleanup !== null) return checkpointMigrationCleanup;
  const pending = (async () => {
    const storage = readChromeLocalStorage(chromeValue);
    const marker = await storage.get(V9_CHECKPOINT_CLEANUP_MARKER);
    if (marker[V9_CHECKPOINT_CLEANUP_MARKER] === true) return;
    const all = await storage.get(null);
    const ownedKeys = Object.keys(all).filter(
      (key) =>
        key.startsWith("muzhi.speech.acquisition.v1:") ||
        key.startsWith(BATCH_SPEECH_RECORD_PREFIX),
    );
    if (ownedKeys.length > 0) {
      if (storage.remove === undefined) {
        throw new Error("Chrome local settings deletion is unavailable");
      }
      await storage.remove(ownedKeys);
    }
    await storage.set({ [V9_CHECKPOINT_CLEANUP_MARKER]: true });
  })();
  checkpointMigrationCleanup = pending;
  try {
    await pending;
  } catch (error) {
    if (checkpointMigrationCleanup === pending)
      checkpointMigrationCleanup = null;
    throw error;
  }
}

function readChromeOffscreen(chromeApi: unknown): ChromeOffscreenApi {
  const offscreen = isRecord(chromeApi)
    ? (Reflect.get(chromeApi, "offscreen") as unknown)
    : null;
  const createDocument = isRecord(offscreen)
    ? Reflect.get(offscreen, "createDocument")
    : null;
  const hasDocument = isRecord(offscreen)
    ? Reflect.get(offscreen, "hasDocument")
    : null;
  if (!isRecord(offscreen) || typeof createDocument !== "function") {
    throw new Error("Chrome Offscreen API is unavailable");
  }
  return Object.freeze({
    createDocument: (
      input: Parameters<ChromeOffscreenApi["createDocument"]>[0],
    ) => Reflect.apply(createDocument, offscreen, [input]),
    hasDocument:
      typeof hasDocument === "function"
        ? () => Reflect.apply(hasDocument, offscreen, [])
        : undefined,
  });
}

async function getGenerationCoordinator(): Promise<GenerationTaskCoordinator> {
  if (generationCoordinator !== null) return generationCoordinator;
  const pending = (async (): Promise<GenerationTaskCoordinator> => {
    const database = await openServiceWorkerDatabase();
    return createGenerationTaskCoordinator({
      browserSessionId: await taskRuntime.getBrowserSessionId(),
      createRunId: () => globalThis.crypto.randomUUID(),
      executorRegistry: taskRuntime.executors,
      now: () => Date.now(),
      store: new IndexedDbGenerationRepository(database, {
        now: () => Date.now(),
      }),
    });
  })();
  generationCoordinator = pending;
  try {
    return await pending;
  } catch (error) {
    if (generationCoordinator === pending) generationCoordinator = null;
    throw error;
  }
}

function createTaskRoutedProvider(
  input: {
    readonly resolveAttachment?: ReturnType<
      typeof createAttachmentBlobResolver
    >;
  } = {},
): AiProviderGateway {
  return Object.freeze({
    // Model discovery is initiated from the profile-specific settings path.
    // Retain the legacy discovery entry only for older runtime clients; it is
    // never used to choose a generation route.
    async discoverModels() {
      const gateway = await settingsStore.createProviderGateway({
        fetch: (url, init) => globalThis.fetch(url, init),
        now: () => Date.now(),
        resolveAttachment: input.resolveAttachment,
      });
      return gateway.discoverModels();
    },
    async *stream(request: AiGenerationRequest) {
      const gateway = await settingsStore.createTaskProviderGateway(
        request.kind,
        {
          modelId: request.model.modelId,
          reasoningEffort: request.reasoningEffort,
        },
        {
          fetch: (url, init) => globalThis.fetch(url, init),
          now: () => Date.now(),
          resolveAttachment: input.resolveAttachment,
        },
      );
      yield* gateway.stream(request);
    },
  });
}

async function getChatRuntime(
  onAssistantUpdate: (update: ChatAssistantUpdate) => void,
): Promise<ChatRuntime> {
  if (chatRuntime !== null) return chatRuntime;
  const pending = (async (): Promise<ChatRuntime> => {
    const database = await openServiceWorkerDatabase();
    const tasks = await getGenerationCoordinator();
    const attachmentRepository = createIndexedDbAttachmentRepository(database);
    const resolveAttachment =
      createAttachmentBlobResolver(attachmentRepository);
    const provider = createTaskRoutedProvider({ resolveAttachment });
    const repository = new IndexedDbChatRepository(database, {
      now: () => Date.now(),
    });
    if (typeof repository.commitAssistantImageOutputs !== "function") {
      throw new Error("Provider image persistence is unavailable");
    }
    const processImageOutput = createProviderImageOutputProcessor(
      providerImageOutputProcessorDependencies,
    );
    return createChatRuntime({
      attachmentRepository,
      // AI 输出默认语言：每次生成前按任务模式从设置读取（docs/i18n-spec.md §5）。
      outputLanguage: async (kind) => {
        const preference = (await settingsStore.loadUiPreferences())
          .taskOutputLanguages[kind];
        // "auto"（不指定语言）→ undefined：不注入任何语言控制提示词，
        // 让模型跟随用户在同一对话中自由切换语言。
        return preference === "auto" ? undefined : preference;
      },
      abortCancelledRun: (run) => taskRuntime.executors.abort(run),
      createMessageId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      createThreadId: () => globalThis.crypto.randomUUID(),
      now: () => Date.now(),
      onAssistantUpdate,
      processImageOutput,
      provider,
      async readSubtitleContext(scope) {
        const context = await new IndexedDbSubtitleContextReader(database).read(
          scope,
        );
        if (context === null) return null;
        const video = parseVideoKey(context.videoKey);
        return Object.freeze({
          meta: Object.freeze({
            bvid: video?.bvid ?? "",
            durationSec: null,
            title: context.title,
          }),
          rows: context.rows,
        });
      },
      async readUserPrompt() {
        const promptState = await settingsStore.loadPromptPresets();
        const defaultPrompt = promptState.presets.find(
          (preset) =>
            preset.kind === "chat" &&
            preset.id === promptState.defaultPromptPresetIds.chat,
        );
        if (defaultPrompt) {
          return defaultPrompt.content;
        }
        return (await settingsStore.loadUiPreferences()).taskPrompts.chat;
      },
      repository,
      tasks,
    });
  })();
  chatRuntime = pending;
  try {
    return await pending;
  } catch (error) {
    if (chatRuntime === pending) chatRuntime = null;
    throw error;
  }
}

async function getArtifactRuntime(
  onUpdate: (update: ArtifactUpdate) => void,
): Promise<ArtifactRuntime> {
  if (artifactRuntime !== null) return artifactRuntime;
  const pending = (async (): Promise<ArtifactRuntime> => {
    const database = await openServiceWorkerDatabase();
    const tasks = await getGenerationCoordinator();
    return createArtifactRuntime({
      createArtifactId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      now: () => Date.now(),
      onUpdate,
      provider: createTaskRoutedProvider(),
      repository: new IndexedDbArtifactRepository(database, {
        now: () => Date.now(),
      }),
      tasks,
      // AI 输出默认语言：每次生成前按任务模式从设置读取（docs/i18n-spec.md §5）。
      outputLanguage: async (kind) => {
        const preference = (await settingsStore.loadUiPreferences())
          .taskOutputLanguages[kind];
        // "auto"（不指定语言）→ undefined：不注入任何语言控制提示词，
        // 让模型跟随用户在同一对话中自由切换语言。
        return preference === "auto" ? undefined : preference;
      },
    });
  })();
  artifactRuntime = pending;
  try {
    return await pending;
  } catch (error) {
    if (artifactRuntime === pending) artifactRuntime = null;
    throw error;
  }
}

function reconcileGenerationRuntime(): Promise<void> {
  if (generationRecovery !== null) return generationRecovery;
  const pending = (async (): Promise<void> => {
    const database = await openServiceWorkerDatabase();
    try {
      await taskRuntime.reconcileAfterBackgroundStart(
        new IndexedDbGenerationRepository(database, {
          now: () => Date.now(),
        }),
        Date.now(),
      );
    } finally {
      database.close();
    }
  })();
  generationRecovery = pending;
  return pending;
}

interface SubtitleServices {
  readonly branchAcquisition: ReturnType<
    typeof createBranchSubtitleAcquisitionService
  >;
  readonly database: IDBDatabase;
  readonly gateway: ReturnType<typeof createChromeBilibiliSubtitleGateway>;
  readonly handler: SubtitleRuntimeHandler;
  readonly repository: IndexedDbSubtitleRepository;
}

let subtitleServices: Promise<SubtitleServices> | null = null;

async function getSubtitleServices(): Promise<SubtitleServices> {
  if (subtitleServices !== null) return subtitleServices;
  const pending = (async (): Promise<SubtitleServices> => {
    const database = await openServiceWorkerDatabase();
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => Date.now(),
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => globalThis.crypto.randomUUID(),
      fetch: async (url, init) => {
        if (init.credentials === "include") {
          return fetchAuthorizedBilibiliApi(url, {
            credentials: "include",
            headers: init.headers,
            method: init.method,
            ...(init.owner === undefined ? {} : { owner: init.owner }),
          });
        }
        return getBilibiliPageFetch()(url, init);
      },
    });
    const directAcquirer = createDirectSubtitleAcquirer({
      createSubtitleId: () => globalThis.crypto.randomUUID(),
      gateway,
      hashRows: hashSubtitleRows,
      now: () => Date.now(),
    });
    const branchAcquisition = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => globalThis.crypto.randomUUID(),
      createDraftBranchId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      directAcquirer,
      repository,
    });
    return Object.freeze({
      branchAcquisition,
      database,
      gateway,
      handler: createSubtitleRuntimeHandler({
        acquireDirect: directAcquirer,
        branchAcquisition,
        gateway,
        repository,
      }),
      repository,
    });
  })();
  subtitleServices = pending;
  try {
    return await pending;
  } catch (error) {
    if (subtitleServices === pending) subtitleServices = null;
    throw error;
  }
}

async function getSubtitleHandler(): Promise<SubtitleRuntimeHandler> {
  if (subtitleHandler !== null) {
    return subtitleHandler;
  }
  const pending = getSubtitleServices().then((services) => services.handler);
  subtitleHandler = pending;
  try {
    return await pending;
  } catch (error) {
    if (subtitleHandler === pending) {
      subtitleHandler = null;
    }
    throw error;
  }
}

function readChromeTabs(chromeApi: unknown): {
  get(tabId: number): Promise<{ readonly url?: string }>;
} {
  const tabs = isRecord(chromeApi)
    ? (Reflect.get(chromeApi, "tabs") as unknown)
    : null;
  const get = isRecord(tabs) ? Reflect.get(tabs, "get") : null;
  if (!isRecord(tabs) || typeof get !== "function") {
    return {
      get: () => Promise.reject(new Error("Chrome tabs are unavailable")),
    };
  }
  return {
    get: (tabId: number) =>
      Reflect.apply(get, tabs, [tabId]) as Promise<{ readonly url?: string }>,
  };
}

const BATCH_SPEECH_RECORD_PREFIX = "muzhi.batch.speech.acquisition.v1:";
const BATCH_SPEECH_SESSION_PREFIX = "batch-item:";

function batchSpeechSessionId(batchItemId: string): string {
  return `${BATCH_SPEECH_SESSION_PREFIX}${batchItemId}`;
}

function batchItemIdFromSpeechSession(sessionId: string): string | null {
  if (!sessionId.startsWith(BATCH_SPEECH_SESSION_PREFIX)) return null;
  const batchItemId = sessionId.slice(BATCH_SPEECH_SESSION_PREFIX.length);
  return batchItemId.length === 0 ? null : batchItemId;
}

async function findBatchSpeechItem(
  repository: IndexedDbBatchRepository,
  videoKey: VideoKey,
  preferredItemId?: string,
): Promise<BatchItem | null> {
  const lists = await repository.listWorkspaceLists();
  const jobs = lists.map((entry) => entry.job);
  let videoMatch: BatchItem | null = null;
  for (const job of jobs) {
    const stored = await repository.read(job.batchJobId);
    if (stored === null) continue;
    for (const item of stored.items) {
      if (item.videoKey !== videoKey) continue;
      if (
        preferredItemId !== undefined &&
        item.batchItemId === preferredItemId
      ) {
        return item;
      }
      if (videoMatch === null && item.status === "running") videoMatch = item;
    }
  }
  return preferredItemId === undefined ? videoMatch : null;
}

async function getBatchSpeechCoordinator() {
  if (batchSpeechCoordinator !== null) return batchSpeechCoordinator;
  const pending = (async () => {
    const database = await openServiceWorkerDatabase();
    await cleanupV9LegacyCheckpoints();
    const batchRepository = new IndexedDbBatchRepository(database, {
      now: () => Date.now(),
    });
    const resolver = createChromeBilibiliVideoGateway({
      fetch: fetchAuthorizedBilibiliApi,
      tabs: readChromeTabs(chromeValue),
    });
    const storage = readChromeLocalStorage(chromeValue);
    const store = createChromeSpeechAcquisitionStore(
      storage,
      BATCH_SPEECH_RECORD_PREFIX,
    );
    for (const record of await store.listActive()) {
      const batchItemId = batchItemIdFromSpeechSession(record.owner.sessionId);
      if (batchItemId !== null) {
        batchSpeechTargets.set(record.owner.videoKey, batchItemId);
      }
    }

    const readContext = async (
      videoKey: VideoKey,
    ): Promise<SubtitleAcquisitionContext | null> => {
      const preferredItemId = batchSpeechTargets.get(videoKey);
      const item = await findBatchSpeechItem(
        batchRepository,
        videoKey,
        preferredItemId,
      );
      if (item === null) return null;
      const video = await resolver.resolve(
        item.cid === null || item.cid === undefined
          ? Object.freeze({
              kind: "identifier" as const,
              value: `https://www.bilibili.com/video/${item.bvid}?p=${item.page}`,
            })
          : Object.freeze({
              bvid: item.bvid,
              cid: item.cid,
              kind: "selection" as const,
              page: item.page,
            }),
      );
      if (
        video.videoKey !== videoKey ||
        (item.aid !== null && item.aid !== undefined && video.aid !== item.aid)
      ) {
        return null;
      }
      const now = Date.now();
      return Object.freeze({
        expectedContextRevision: 1,
        session: createSession({
          activeBranchId: null,
          createdAt: now,
          customTitle: false,
          lastActivityAt: now,
          selectionRevision: 0,
          sessionId: batchSpeechSessionId(item.batchItemId),
          title: item.title,
          updatedAt: now,
          videoKey,
        }),
        video,
      });
    };

    const repository: BranchSubtitleRepository = Object.freeze({
      async beginAcquisition(
        owner: Parameters<BranchSubtitleRepository["beginAcquisition"]>[0],
      ) {
        const context = await readContext(owner.videoKey);
        if (
          context === null ||
          context.session.sessionId !== owner.sessionId ||
          owner.expectedContextRevision !== context.expectedContextRevision ||
          owner.expectedSelectionRevision !== context.session.selectionRevision
        ) {
          throw Object.assign(new Error("The batch speech owner is stale"), {
            code: "VIDEO_NOT_BOUND",
          });
        }
        return context;
      },
      async commitAcquisition(
        owner: Parameters<BranchSubtitleRepository["commitAcquisition"]>[0],
        stagedSubtitle: SubtitleSnapshot,
      ) {
        const batchItemId = batchItemIdFromSpeechSession(owner.sessionId);
        if (
          batchItemId === null ||
          stagedSubtitle.sessionId !== owner.sessionId ||
          stagedSubtitle.branchId !== owner.draftBranchId ||
          stagedSubtitle.videoKey !== owner.videoKey
        ) {
          throw Object.assign(new Error("The batch speech result is stale"), {
            code: "VIDEO_NOT_BOUND",
          });
        }
        const item = await findBatchSpeechItem(
          batchRepository,
          owner.videoKey,
          batchItemId,
        );
        if (item === null) {
          throw Object.assign(new Error("The batch item no longer exists"), {
            code: "VIDEO_NOT_BOUND",
          });
        }
        await batchRepository.writeSubtitle(
          createBatchSubtitle({
            batchItemId,
            language: stagedSubtitle.language,
            rows: stagedSubtitle.rows,
            source: "speech",
            trackId: null,
            updatedAt: Date.now(),
          }),
        );

        // The shared ASR executor only reads branchId, subtitleId and rows from
        // this result. These objects are transient compatibility projections;
        // no Session, branch or placement is written to IndexedDB.
        return Object.freeze({
          branch: Object.freeze({ branchId: owner.draftBranchId }),
          placement: Object.freeze({}),
          session: batchSpeechSyntheticSession(owner, item.title),
          subtitle: stagedSubtitle,
        }) as InitialSubtitleCommitResult;
      },
      commitInitialAcquisition() {
        return Promise.reject(
          new Error("Batch speech does not commit Session subtitles"),
        );
      },
      finishAcquisition() {
        return Promise.resolve();
      },
      readAcquisitionContext: readContext,
    });

    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: createChromeOffscreenAudioChunkProcessor(
        chromeValue,
        readChromeOffscreen(chromeValue),
      ),
      createSubtitleId: () => globalThis.crypto.randomUUID(),
      hashRows: hashSubtitleRows,
      keepalive: createChromeOffscreenSpeechTaskKeepalive(
        chromeValue,
        readChromeOffscreen(chromeValue),
      ),
      mediaGateway: createBilibiliMediaGateway({
        fetch: fetchAuthorizedBilibiliMedia,
      }),
      mergeTimedRows: mergeTimestampedChunkRows,
      now: () => Date.now(),
      repository,
      transcriber: createChromeOffscreenGroqChunkTranscriber(
        chromeValue,
        readChromeOffscreen(chromeValue),
        {
          now: () => Date.now(),
        },
      ),
    });
    return createSpeechAcquisitionCoordinator({
      browserSessionId: await taskRuntime.getBrowserSessionId(),
      createAcquisitionId: () => globalThis.crypto.randomUUID(),
      createDraftBranchId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      executor,
      now: () => Date.now(),
      readOwnerContext: async (videoKey) => {
        const item = await findBatchSpeechItem(
          batchRepository,
          videoKey,
          batchSpeechTargets.get(videoKey),
        );
        return item === null
          ? null
          : Object.freeze({
              expectedContextRevision: 1,
              expectedSelectionRevision: 0,
              sessionId: batchSpeechSessionId(item.batchItemId),
            });
      },
      store,
    });
  })();
  batchSpeechCoordinator = pending;
  try {
    return await pending;
  } catch (error) {
    if (batchSpeechCoordinator === pending) batchSpeechCoordinator = null;
    throw error;
  }
}

function batchSpeechSyntheticSession(
  owner: Parameters<BranchSubtitleRepository["beginAcquisition"]>[0],
  title: string,
) {
  return createSession({
    activeBranchId: null,
    createdAt: Date.now(),
    customTitle: false,
    lastActivityAt: Date.now(),
    selectionRevision: owner.expectedSelectionRevision,
    sessionId: owner.sessionId,
    title,
    updatedAt: Date.now(),
    videoKey: owner.videoKey,
  });
}

async function getBatchRuntime(
  onUpdate: (view: BatchJobView) => void,
): Promise<BatchRuntime> {
  if (batchRuntime !== null) return batchRuntime;
  const pending = (async (): Promise<BatchRuntime> => {
    const services = await getSubtitleServices();
    const database = services.database;
    const speechPreference = (await settingsStore.loadUiPreferences())
      .speechLanguage;
    const repository = new IndexedDbBatchRepository(database, {
      defaultSpeechLanguageMode:
        speechPreference === "中文"
          ? "zh"
          : speechPreference === "英文"
            ? "en"
            : speechPreference === "其他"
              ? "other"
              : "mixed",
      now: () => Date.now(),
    });
    const runtime = createBatchRuntime({
      browserSessionId: await taskRuntime.getBrowserSessionId(),
      createId: () => globalThis.crypto.randomUUID(),
      gateway: services.gateway,
      now: () => Date.now(),
      onUpdate,
      repository,
      resolver: createChromeBilibiliVideoGateway({
        fetch: fetchAuthorizedBilibiliApi,
        tabs: readChromeTabs(chromeValue),
      }),
      speechClient: {
        async cancel(owner) {
          return (await getBatchSpeechCoordinator()).cancel(owner);
        },
        async cancelItem(batchItemId) {
          const store = createChromeSpeechAcquisitionStore(
            readChromeLocalStorage(chromeValue),
            BATCH_SPEECH_RECORD_PREFIX,
          );
          const record = (await store.listActive()).find(
            (candidate) =>
              batchItemIdFromSpeechSession(candidate.owner.sessionId) ===
              batchItemId,
          );
          return record === undefined
            ? false
            : (await getBatchSpeechCoordinator()).cancel(record.owner);
        },
        async purgeItem(batchItemId) {
          const storage = readChromeLocalStorage(chromeValue);
          const all = await storage.get(null);
          const sessionId = batchSpeechSessionId(batchItemId);
          const ownedKeys = Object.entries(all).flatMap(([key, value]) => {
            if (
              !key.startsWith(BATCH_SPEECH_RECORD_PREFIX) ||
              !isRecord(value)
            ) {
              return [];
            }
            const owner = isRecord(value.owner) ? value.owner : null;
            return owner?.sessionId === sessionId ? [key] : [];
          });
          if (ownedKeys.length > 0) await storage.remove?.(ownedKeys);
        },
        async start(input) {
          batchSpeechTargets.set(input.videoKey, input.batchItemId);
          const handle = await (
            await getBatchSpeechCoordinator()
          ).start({
            parameters: Object.freeze({
              model: "whisper-large-v3",
              provider: "groq",
              requestedLanguageMode: input.requestedLanguageMode,
              routingMode: input.routingMode,
            }),
            videoKey: input.videoKey,
          });
          void handle.result
            .finally(() => {
              if (
                batchSpeechTargets.get(input.videoKey) === input.batchItemId
              ) {
                batchSpeechTargets.delete(input.videoKey);
              }
            })
            .catch(() => undefined);
          return handle.owner;
        },
        status(owner) {
          return createChromeSpeechAcquisitionStore(
            readChromeLocalStorage(chromeValue),
            BATCH_SPEECH_RECORD_PREFIX,
          ).get(owner);
        },
        async result(owner) {
          const batchItemId = batchItemIdFromSpeechSession(owner.sessionId);
          if (batchItemId === null) return null;
          const subtitle = await new IndexedDbBatchRepository(database, {
            now: () => Date.now(),
          }).readSubtitle(batchItemId);
          return subtitle === null
            ? null
            : Object.freeze({
                language: subtitle.language,
                rows: subtitle.rows,
              });
        },
      },
      sourceGateway: createBilibiliBatchSourceGateway({
        createRequestNonce: () => globalThis.crypto.randomUUID(),
        fetch: fetchAuthorizedBilibiliApi,
        now: () => Date.now(),
      }),
    });
    const recoveryHandles = await (await getBatchSpeechCoordinator()).recover();
    if (recoveryHandles.length === 0) {
      await runtime.reconcile();
    } else {
      void Promise.allSettled(recoveryHandles.map((handle) => handle.result))
        .then(() => runtime.reconcile())
        .catch(() => undefined);
    }
    return runtime;
  })();
  batchRuntime = pending;
  try {
    return await pending;
  } catch (error) {
    if (batchRuntime === pending) batchRuntime = null;
    throw error;
  }
}

async function getSpeechCoordinator() {
  if (speechCoordinator !== null) return speechCoordinator;
  const pending = (async () => {
    const database = await openServiceWorkerDatabase();
    await cleanupV9LegacyCheckpoints();
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => Date.now(),
    });
    const storage = readChromeLocalStorage(chromeValue);
    const store = createChromeSpeechAcquisitionStore(storage);
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: createChromeOffscreenAudioChunkProcessor(
        chromeValue,
        readChromeOffscreen(chromeValue),
      ),
      createSubtitleId: () => globalThis.crypto.randomUUID(),
      hashRows: hashSubtitleRows,
      keepalive: createChromeOffscreenSpeechTaskKeepalive(
        chromeValue,
        readChromeOffscreen(chromeValue),
      ),
      mediaGateway: createBilibiliMediaGateway({
        fetch: fetchAuthorizedBilibiliMedia,
      }),
      mergeTimedRows: mergeTimestampedChunkRows,
      now: () => Date.now(),
      repository,
      transcriber: createChromeOffscreenGroqChunkTranscriber(
        chromeValue,
        readChromeOffscreen(chromeValue),
        {
          now: () => Date.now(),
        },
      ),
    });
    return createSpeechAcquisitionCoordinator({
      browserSessionId: await taskRuntime.getBrowserSessionId(),
      createAcquisitionId: () => globalThis.crypto.randomUUID(),
      createDraftBranchId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      executor,
      now: () => Date.now(),
      readOwnerContext: async (videoKey) => {
        const context = await repository.readAcquisitionContext(videoKey);
        return context === null
          ? null
          : Object.freeze({
              expectedContextRevision: context.expectedContextRevision,
              expectedSelectionRevision: context.session.selectionRevision,
              sessionId: context.session.sessionId,
            });
      },
      store,
    });
  })();
  speechCoordinator = pending;
  try {
    return await pending;
  } catch (error) {
    if (speechCoordinator === pending) speechCoordinator = null;
    throw error;
  }
}

installChromeSubtitleRuntimeListener(chromeValue, async (command) => {
  try {
    return await (
      await getSubtitleHandler()
    )(command);
  } catch (error) {
    return createSubtitleFailureEvent(command, error);
  }
});

installChromeSpeechRuntimeListener(chromeValue, async (command) => {
  try {
    const coordinator = await getSpeechCoordinator();
    if (command.type === "muzhi.speech.start") {
      const handle = await coordinator.start({
        parameters: Object.freeze({
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: command.payload.requestedLanguageMode,
          routingMode: command.payload.routingMode,
        }),
        taskId: command.requestId,
        videoKey: command.payload.videoKey,
      });
      void handle.result.catch(() => undefined);
      return Object.freeze({
        payload: Object.freeze({ owner: handle.owner }),
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.speech.started",
      });
    }
    if (command.type === "muzhi.speech.status") {
      const record = await readChromeLocalStorage(chromeValue);
      const store = createChromeSpeechAcquisitionStore(record);
      return Object.freeze({
        payload: Object.freeze({
          record: await store.get(command.payload.owner),
        }),
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.speech.statused",
      });
    }
    if (command.type === "muzhi.speech.active") {
      const records = (
        await createChromeSpeechAcquisitionStore(
          readChromeLocalStorage(chromeValue),
        ).listActive()
      ).filter((record) => record.owner.videoKey === command.payload.videoKey);
      return Object.freeze({
        payload: Object.freeze({ records }),
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.speech.active-listed",
      });
    }
    return Object.freeze({
      payload: Object.freeze({
        cancelled: await coordinator.cancel(command.payload.owner),
        owner: command.payload.owner,
      }),
      protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.speech.cancelled",
    });
  } catch (error) {
    return safeSpeechRuntimeFailure(command, error) as SpeechRuntimeEvent;
  }
});

installChromeContentPlayerRelay(chromeValue, {
  allocateSeekSequence: createChromeSeekSequenceAllocator(chromeValue),
});

const settingsStore = createChromeSettingsStore(
  readChromeLocalStorage(chromeValue),
);
const openServiceWorkerDatabase = createBilimuzhiDatabaseBootstrap(
  async () => (await settingsStore.loadUiPreferences()).speechLanguage,
);
installChromeGroqOffscreenCredentialBroker(chromeValue, async () => {
  // 修复:broker 此前只读 v12/legacy,而 saveV12GroqApiKey 写入 v13,
  // 导致新保存的 Groq key 首次语音转录必失败(not-configured)。
  // 统一走 v13 → v12 → legacy 解析,并保留 legacy 迁移路径。
  const storage = readChromeLocalStorage(chromeValue);
  return resolveGroqApiKeyFromStorage(storage, {
    loadLegacy: () => settingsStore.load(),
  });
});
const generationTasks: GenerationTaskCoordinator = Object.freeze({
  async applyEvent(event: unknown) {
    return (await getGenerationCoordinator()).applyEvent(event);
  },
  async start(owner: TaskOwner) {
    return (await getGenerationCoordinator()).start(owner);
  },
  async stop(owner: TaskOwner) {
    return (await getGenerationCoordinator()).stop(owner);
  },
});
installChromeGenerationRuntimeListener(chromeValue, {
  async createProvider() {
    return createTaskRoutedProvider();
  },
  executors: taskRuntime.executors,
  tasks: generationTasks,
});
installChromeRemoteMarkdownImageRuntimeListener(
  chromeValue,
  createProviderImageOutputProcessor(providerImageOutputProcessorDependencies),
);
installChromeBatchRuntimeListener(chromeValue, {
  getRuntime: getBatchRuntime,
});
installChromeArtifactRuntimeListener(chromeValue, {
  getRuntime: getArtifactRuntime,
  async readSubtitleContext(scope) {
    // Reuses the cached subtitle services connection so each generation does
    // not leak another IndexedDB handle in a long-lived Service Worker.
    const services = await getSubtitleServices();
    return new IndexedDbSubtitleContextReader(services.database).read(scope);
  },
  async queryActiveRuns(scope) {
    // 切回会话时恢复进行中任务的运行状态（UI 显示"正在生成"而非空状态）。
    const database = await openServiceWorkerDatabase();
    try {
      const repository = new IndexedDbGenerationRepository(database, {
        now: () => Date.now(),
      });
      const runs = await repository.listQueuedOrRunning();
      return runs.filter(
        (run) =>
          run.kind !== "chat" &&
          run.sessionId === scope.sessionId &&
          run.branchId === scope.branchId &&
          run.subtitleId === scope.subtitleId &&
          run.contextRevision === scope.contextRevision,
      );
    } finally {
      database.close();
    }
  },
});
installChromeChatRuntimeListener(chromeValue, {
  async discoverModels() {
    const gateway = await settingsStore.createProviderGateway({
      fetch: (url, init) => globalThis.fetch(url, init),
      now: () => Date.now(),
    });
    return gateway.discoverModels();
  },
  getRuntime: getChatRuntime,
});

void reconcileGenerationRuntime().catch(() => {
  if (generationRecovery !== null) generationRecovery = null;
});

void getSpeechCoordinator()
  .then((coordinator) => coordinator.recover())
  .then((handles) => {
    for (const handle of handles) void handle.result.catch(() => undefined);
  })
  .catch(() => {
    speechCoordinator = null;
  });

globalThis.addEventListener("install", () => undefined);
