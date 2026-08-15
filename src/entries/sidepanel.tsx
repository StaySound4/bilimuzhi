import { render } from "preact";
import { t } from "../i18n";
import {
  isUiLanguage,
  type OutputLanguagePreference,
  type UiLanguage,
} from "../i18n/languages";
import { setIconLanguage } from "../ui/icons";
import {
  displayPresetContent,
  displayPresetName,
} from "../ui/prompt-preset-name";

import {
  createAiModelDescriptor,
  isBuiltInReasoningEffort,
  type AiModelDescriptor,
  type AiReasoningPreference,
} from "../application/ai/provider-contract";
import {
  AUTO_REBIND_MAX_ATTEMPTS,
  AUTO_REBIND_MISMATCH_MAX_ATTEMPTS,
  AUTO_REBIND_RETRY_DELAYS,
} from "../application/auto-rebind-policy";
import { AiProviderError } from "../application/ai/provider-error";
import { PROMPT_LANGUAGE_PACKS } from "../application/ai/prompt-language-pack";
import {
  createConservativeFallbackCapabilities,
  resolveKnownModelCapabilities,
} from "../infrastructure/ai/model-capability-registry";
import {
  BACKUP_GROUPS,
  BackupError,
  createV12BackupRuntime,
  type BackupImportPreview,
} from "../application/backup";
import { speechFailurePresentation } from "../application/asr/speech-failure-presentation";
import {
  projectActiveChatRunStatus,
  projectChatMessages,
} from "../application/chat-message-projection";
import type {
  ChatGenerationOptions,
  ChatRuntimeScope,
} from "../application/chat-runtime";
import { createAiModelSelection } from "../application/settings-contract";

import {
  createSessionWorkspaceCoordinator,
  type SessionWorkspaceSnapshot,
} from "../application/session-workspace";
import { StorageError } from "../application/storage";
import { activateWorkspaceSession } from "../application/workspace-restoration";
import {
  createSubtitleAcquisitionCoordinator,
  type SubtitleAcquisitionState,
} from "../application/subtitle-acquisition";
import {
  createSubtitleExport,
  type SubtitleExportFormat,
} from "../application/subtitle-export";
import {
  createVideoTimeNavigator,
  type VideoTimeNavigationOwner,
} from "../application/video-time-navigation";
import { createChromeSidePanelApi } from "../infrastructure/chrome-sidepanel-api";
import {
  ChromePlayerRuntimeError,
  createChromePlayerRuntimeClient,
} from "../infrastructure/chrome-player-runtime";
import { createChromeSubtitleRuntimeClient } from "../infrastructure/chrome-subtitle-runtime";
import { createChromeBackupDownloadRuntime } from "../infrastructure/chrome-backup-download";
import {
  ChromeSpeechRuntimeError,
  createChromeSpeechRuntimeClient,
} from "../infrastructure/chrome-speech-runtime";
import type { SubtitleAcquisitionOwner } from "../application/subtitle-acquisition-contract";
import type {
  AsrProgressActivity,
  GroqRoutingMode,
} from "../application/asr-contract";
import type { SpeechPanelPhase } from "../ui/asr/speech-acquisition-panel";
import {
  createChromeChatRuntimeClient,
  type ChromeChatRuntimeEvent,
} from "../infrastructure/chrome-chat-runtime";
import { createChromeRemoteMarkdownImageRuntimeClient } from "../infrastructure/chrome-remote-markdown-image-runtime";
import {
  createChromeArtifactRuntimeClient,
  type ChromeArtifactRuntimeEvent,
} from "../infrastructure/chrome-artifact-runtime";
import type { ArtifactScope } from "../application/artifact-repository";
import type { InsightWorkspaceProps } from "../ui/insights/insight-workspace";
import type {
  TaskModelProfileOption,
  TaskModelSelectionInput,
} from "../ui/task-model/task-model-picker";
import type {
  BatchExportEntry,
  BatchJobView,
} from "../application/batch-runtime";
import type { BatchSourceKind } from "../application/batch-source-contract";
import {
  ChromeBatchRuntimeError,
  createChromeBatchRuntimeClient,
} from "../infrastructure/chrome-batch-runtime";
import {
  acceptBatchPrepareEvent,
  createAppendBatchPrepareOwner,
  type BatchPrepareOwner,
} from "./batch-prepare-owner";
import {
  changeSurfaceAfterClearingBatchSelection,
  selectBatchJobAfterClearingPrevious,
} from "./batch-selection-transition";
import {
  noSubtitleStatusLabel,
  officialSubtitleDetailLabel,
  subtitleStatusLabel,
} from "../ui/subtitle-status-label";
import { createZipArchive, safeZipPath } from "../infrastructure/zip-writer";
import type {
  BatchExportFormat,
  BatchWorkspaceProps,
} from "../ui/batch/batch-workspace";
import type { BatchDrawerProps } from "../ui/batch/batch-drawer";
import {
  batchHelpContext,
  type BatchHelpContext,
} from "../ui/batch/batch-contracts";
import {
  TIMELINE_SYNC_INITIAL,
  timelineSyncReducer,
  type TimelineSyncState,
} from "../application/timeline-sync";
import type { SubtitleTimelineProps } from "../ui/subtitle-timeline";
import type { BatchArchiveWorkspaceProps } from "../ui/batch/batch-archive-workspace";
import type { BatchTrashWorkspaceProps } from "../ui/batch/batch-trash-workspace";
import { runBatchCommand } from "../ui/batch/batch-command-runner";
import type { AppDialogRequest } from "../ui/dialogs/app-dialog";
import {
  createChromeSettingsStore,
  EMPTY_TASK_MODELS,
  SETTINGS_PROMPT_PRESETS_STORAGE_KEY,
  SETTINGS_SECRET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_TASK_MODELS_STORAGE_KEY,
  SETTINGS_UI_PREFERENCES_STORAGE_KEY,
  type BilimuzhiTaskKind,
  type BilimuzhiTaskModels,
  type PromptPresetState,
  type SettingsEditorState,
} from "../infrastructure/chrome-settings-store";
import {
  migrateLegacySettingsToV12,
  migrateV12SettingsToV13,
  type ImageCapabilityProjection,
  type ModelReasoningOverride,
  type ProviderProfileProjection,
  type TaskSelectionProjection,
  type V12HostPermissions,
} from "../infrastructure/provider-profile-settings";
import { createChromeWorkspaceStateStore } from "../infrastructure/chrome-workspace-state-store";
import {
  createChromeHostPermissions,
  hostPermissionPattern,
  type ChromeHostPermissions,
} from "../infrastructure/chrome-permissions";
import { createChromeBilibiliVideoGateway } from "../infrastructure/bilibili-video-gateway";
import {
  createCurrentPageSyncBridge,
  syncStableCurrentPage,
} from "../infrastructure/current-page-sync";
import {
  createV12BackupDataPort,
  ROOT_ARCHIVE_FOLDER_ID,
} from "../infrastructure/indexeddb/muzhi-database";
import { createBilimuzhiDatabaseBootstrap } from "../infrastructure/indexeddb/muzhi-database-bootstrap";
import { IndexedDbArchiveRepository } from "../infrastructure/indexeddb/archive-repository";
import { IndexedDbTagRepository } from "../infrastructure/indexeddb/tag-repository";
import { IndexedDbTrashRepository } from "../infrastructure/indexeddb/trash-repository";
import type { TrashPermanentDeletionPreview } from "../infrastructure/indexeddb/trash-repository";
import { trashDeletionDescription } from "../ui/trash/trash-confirmation";
import { IndexedDbRetentionRepository } from "../infrastructure/indexeddb/retention-repository";
import { IndexedDbWorkspaceProjectionRepository } from "../infrastructure/indexeddb/workspace-projection-repository";
import { IndexedDbSessionRepository } from "../infrastructure/indexeddb/session-repository";
import { createIndexedDbAttachmentRepository } from "../infrastructure/indexeddb/attachment-repository";
import {
  inspectSingleSubtitleMigration,
  migrateToSingleSubtitleContexts,
} from "../infrastructure/indexeddb/single-subtitle-migration";
import { IndexedDbWorkspaceRestorationRepository } from "../infrastructure/indexeddb/workspace-restoration-repository";
import { PageStaleMonitor } from "../infrastructure/page-stale-monitor";
import { AiChatShell } from "../ui/ai-chat-shell";
import type {
  PromptManagerDialogProps,
  PromptManagerKind,
} from "../ui/prompts/prompt-manager-dialog";
import type {
  ArchiveSessionProjectionView,
  ArchiveWorkspaceProps,
} from "../ui/archive/archive-workspace";
import type {
  ActiveChatGenerationRun,
  ChatWorkspaceProps,
} from "../ui/chat/chat-workspace";
import { deriveValidatedTimeMarkers } from "../application/time-marker";
import type {
  RetentionChoice,
  SettingsDrawerProps,
} from "../ui/settings/settings-drawer";
import { resolveTrashRestoreIntents } from "../application/trash-restore-intents";
import type {
  TrashDeleteIntent,
  TrashListItem,
  TrashRestoreIntent,
  TrashWorkspaceProps,
} from "../ui/trash/trash-workspace";
import {
  isSessionVideoBound,
  createTrashRetentionPolicy,
  type Artifact,
  type ArtifactKind,
  type BatchJob,
  type ChatMessage,
  type ChatThread,
  type GenerationRun,
  type ImageAttachment,
  type VideoKey,
  type TrashRetentionPolicy,
} from "../domain";
import {
  APPEARANCE_STORAGE_KEY,
  defaultAppearanceState,
  isAppearanceState,
  upgradeLegacyAppearanceState,
} from "../ui/appearance-state";
import {
  artifactFailureMessage,
  generationFailureFor,
  safeBackupExportMessage,
  safeSessionActionMessage,
} from "../ui/error-presentation";
import {
  artifactMarkdown,
  downloadChatThread,
  downloadMarkdown,
  downloadSubtitleExport,
  downloadTextFile,
  pickTextFile,
} from "../ui/export-utils";
import {
  BACKUP_IMPORT_GROUP_LABELS,
  describeBackupImportPreview,
} from "../ui/backup-flow";
import type { SessionDrawerMessage } from "../ui/session-drawer";
import {
  SingleSubtitleMigrationBlockedGate,
  SingleSubtitleMigrationGate,
} from "../ui/single-subtitle-migration-gate";
import "../ui/ai-chat-shell.css";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Side Panel root element is missing");
}
const sidePanelRoot = root;
const trashSessionSelectionId = (sessionId: string): string =>
  `trash-session:${sessionId}`;
const PROVIDER_OPTIONS = Object.freeze([
  Object.freeze({ id: "openai", label: "OpenAI" }),
  Object.freeze({ id: "openrouter", label: "OpenRouter" }),
  Object.freeze({ id: "deepseek", label: "DeepSeek" }),
  Object.freeze({ id: "gemini", label: "Gemini" }),
  Object.freeze({ id: "groq", label: "Groq" }),
  Object.freeze({ id: "claude", label: "Claude" }),
  Object.freeze({ id: "zhipu", label: "智谱" }),
  Object.freeze({ id: "modelscope", label: "ModelScope" }),
  Object.freeze({ id: "kimi", label: "Kimi" }),
  Object.freeze({ id: "mimo", label: "MiMo" }),
  Object.freeze({ id: "custom", label: "自定义端点" }),
]);
const CUSTOM_PROVIDER_ID = "custom";
const TASK_MODEL_LABELS: readonly {
  readonly kind: BilimuzhiTaskKind;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ kind: "chat" as const, label: "对话" }),
  Object.freeze({ kind: "segments" as const, label: "分段" }),
  Object.freeze({ kind: "summary" as const, label: "总结" }),
]);
const PROVIDER_PRESETS = Object.freeze({
  claude: Object.freeze({
    baseUrl: "https://api.anthropic.com",
    protocol: "claude" as const,
  }),
  deepseek: Object.freeze({
    baseUrl: "https://api.deepseek.com",
    protocol: "openai" as const,
  }),
  gemini: Object.freeze({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini" as const,
  }),
  groq: Object.freeze({
    baseUrl: "https://api.groq.com/openai/v1",
    protocol: "openai" as const,
  }),
  kimi: Object.freeze({
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai" as const,
  }),
  mimo: Object.freeze({
    baseUrl: "https://api.xiaomimimo.com/v1",
    protocol: "openai" as const,
  }),
  modelscope: Object.freeze({
    baseUrl: "https://api-inference.modelscope.cn/v1",
    protocol: "openai" as const,
  }),
  openai: Object.freeze({
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai" as const,
  }),
  openrouter: Object.freeze({
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai" as const,
  }),
  zhipu: Object.freeze({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "openai" as const,
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The v12 profile store needs both request and revocation while the legacy
 * permission wrapper only exposes request/contains. Keep this adapter local to
 * the composition root so profile changes always use exact origins and a
 * restricted browser/test host fails closed instead of silently granting one.
 */
function createV12ProfileHostPermissions(
  chromeValue: unknown,
): V12HostPermissions {
  const permissions = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "permissions") as unknown)
    : null;
  const request = isRecord(permissions)
    ? Reflect.get(permissions, "request")
    : null;
  const remove = isRecord(permissions)
    ? Reflect.get(permissions, "remove")
    : null;
  return Object.freeze({
    async remove(input: { readonly origins: readonly string[] }) {
      if (
        !isRecord(permissions) ||
        typeof remove !== "function" ||
        input.origins.includes("<all_urls>")
      ) {
        return false;
      }
      return Boolean(await Reflect.apply(remove, permissions, [input]));
    },
    async request(input: { readonly origins: readonly string[] }) {
      if (
        !isRecord(permissions) ||
        typeof request !== "function" ||
        input.origins.includes("<all_urls>")
      ) {
        return false;
      }
      return Boolean(await Reflect.apply(request, permissions, [input]));
    },
  });
}

function formatTimestamp(value: number | null): string {
  return value === null
    ? "永久保留"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
}

function formatShortTimestamp(value: number | null): string {
  if (value === null || value <= 0) return "—";
  const date = new Date(value);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 迁移门渲染前预读界面语言（此时 settingsStore 尚未初始化）。 */
async function readStoredUiLanguage(
  storage: Pick<
    Awaited<ReturnType<typeof createChromeSidePanelApi>>["storage"],
    "get"
  >,
): Promise<UiLanguage> {
  try {
    const stored = (await storage.get(SETTINGS_UI_PREFERENCES_STORAGE_KEY))[
      SETTINGS_UI_PREFERENCES_STORAGE_KEY
    ] as { readonly uiLanguage?: unknown } | undefined;
    return typeof stored?.uiLanguage === "string" &&
      isUiLanguage(stored.uiLanguage)
      ? stored.uiLanguage
      : "zh-Hans";
  } catch {
    return "zh-Hans";
  }
}

async function passSingleSubtitleMigrationGate(
  database: IDBDatabase,
  uiLanguage: UiLanguage,
): Promise<boolean> {
  let preview;
  try {
    preview = await inspectSingleSubtitleMigration(database);
  } catch {
    render(
      <SingleSubtitleMigrationBlockedGate
        uiLanguage={uiLanguage}
        onRetry={() => globalThis.location.reload()}
      />,
      sidePanelRoot,
    );
    return false;
  }
  if (!preview.requiresConfirmation) {
    await migrateToSingleSubtitleContexts(database, {
      confirmed: false,
      now: Date.now(),
    });
    return true;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    render(
      <SingleSubtitleMigrationGate
        uiLanguage={uiLanguage}
        onCancel={() => finish(false)}
        onConfirm={async () => {
          await migrateToSingleSubtitleContexts(database, {
            confirmed: true,
            now: Date.now(),
          });
          finish(true);
        }}
        preview={preview}
      />,
      sidePanelRoot,
    );
  });
}

async function renderSidePanel(): Promise<void> {
  let database: IDBDatabase | undefined;
  try {
    const chromeValue = Reflect.get(globalThis, "chrome") as unknown;
    const remoteMarkdownImageClient =
      createChromeRemoteMarkdownImageRuntimeClient(chromeValue);
    const chromeApi = createChromeSidePanelApi(chromeValue);
    const stateStore = createChromeWorkspaceStateStore(chromeApi.storage);
    const settingsStore = createChromeSettingsStore(chromeApi.storage, {
      permissions: createV12ProfileHostPermissions(chromeValue),
    });
    const openSidePanelDatabase = createBilimuzhiDatabaseBootstrap(
      async () => (await settingsStore.loadUiPreferences()).speechLanguage,
    );
    let chatImageCapability: ImageCapabilityProjection = Object.freeze({
      modelId: "",
      profileId: "",
      state: "unknown",
    });
    await migrateLegacySettingsToV12(chromeApi.storage, {
      promptPresets: SETTINGS_PROMPT_PRESETS_STORAGE_KEY,
      secrets: SETTINGS_SECRET_STORAGE_KEY,
      settings: SETTINGS_STORAGE_KEY,
      taskModels: SETTINGS_TASK_MODELS_STORAGE_KEY,
      uiPreferences: SETTINGS_UI_PREFERENCES_STORAGE_KEY,
    });
    // v12 → v13 无感迁移（幂等；v12 数据保留作备份）。
    await migrateV12SettingsToV13(chromeApi.storage);
    const chatClient = createChromeChatRuntimeClient(chromeValue, undefined, {
      recordImageCapabilityEvidence: async (input) => {
        const projection =
          await settingsStore.recordImageCapabilityEvidence(input);
        const selection = taskSelections.chat;
        if (
          selection?.state === "ready" &&
          selection.profileId === projection.profileId &&
          selection.modelId === projection.modelId
        ) {
          chatImageCapability = projection;
          renderSnapshot();
        }
      },
    });
    const artifactClient = createChromeArtifactRuntimeClient(chromeValue);
    const batchClient = createChromeBatchRuntimeClient(chromeValue);
    const speechClient = createChromeSpeechRuntimeClient(chromeValue);
    const backupDownloadRuntime = createChromeBackupDownloadRuntime({
      createObjectURL: (blob) => URL.createObjectURL(blob),
      downloads: Reflect.get(chromeValue as object, "downloads") as Parameters<
        typeof createChromeBackupDownloadRuntime
      >[0]["downloads"],
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    });
    database = await openSidePanelDatabase();
    const gateLanguage = await readStoredUiLanguage(chromeApi.storage);
    if (!(await passSingleSubtitleMigrationGate(database, gateLanguage))) {
      database.close();
      database = undefined;
      return;
    }
    const backupRuntime = createV12BackupRuntime({
      crypto: globalThis.crypto,
      data: createV12BackupDataPort({
        database,
        settingsStorage: chromeApi.storage,
      }),
      now: () => Date.now(),
      randomUUID: () => globalThis.crypto.randomUUID(),
    });
    const attachmentRepository = createIndexedDbAttachmentRepository(database);
    let projectionRepository = new IndexedDbWorkspaceProjectionRepository(
      database,
    );
    const tagRepository = new IndexedDbTagRepository(database);
    const archiveRepository = new IndexedDbArchiveRepository(database, {
      now: () => Date.now(),
    });
    const trashRepository = new IndexedDbTrashRepository(database, {
      now: () => Date.now(),
    });
    const retentionRepository = new IndexedDbRetentionRepository(database, {
      now: () => Date.now(),
    });
    const videoGateway = createChromeBilibiliVideoGateway({
      fetch: (url, init) => globalThis.fetch(url, init),
      tabs: chromeApi.tabs,
    });
    const restorationRepository = new IndexedDbWorkspaceRestorationRepository(
      database,
    );
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => globalThis.crypto.randomUUID(),
      now: () => Date.now(),
    });
    const sessionCoordinator = createSessionWorkspaceCoordinator({
      archiveRepository,
      gateway: videoGateway,
      lifecycle: {
        cancelBackgroundTasks: async (videoKey) => {
          const records = await speechClient.active(videoKey);
          await Promise.all(
            records.map((record) => speechClient.cancel(record.owner)),
          );
        },
        reopenForRetry: async () => {
          const reopenedDatabase = await openSidePanelDatabase();
          try {
            if (
              !(await passSingleSubtitleMigrationGate(
                reopenedDatabase,
                uiLanguage,
              ))
            ) {
              throw new StorageError(
                "The reopened Bilimuzhi database did not pass migration",
                true,
                "CONNECTION_INVALID",
              );
            }
            const repository = new IndexedDbSessionRepository(
              reopenedDatabase,
              {
                createSessionId: () => globalThis.crypto.randomUUID(),
                now: () => Date.now(),
              },
            );
            const restorationRepository =
              new IndexedDbWorkspaceRestorationRepository(reopenedDatabase);
            const trashRepository = new IndexedDbTrashRepository(
              reopenedDatabase,
              {
                now: () => Date.now(),
              },
            );
            const reopenedProjectionRepository =
              new IndexedDbWorkspaceProjectionRepository(reopenedDatabase);
            const bundle = Object.freeze({
              repository,
              restorationRepository,
              trashRepository,
            });
            const previousDatabase = database;
            const previousProjectionRepository = projectionRepository;
            database = reopenedDatabase;
            projectionRepository = reopenedProjectionRepository;
            if (previousDatabase !== reopenedDatabase) {
              try {
                previousDatabase?.close();
              } catch (error) {
                database = previousDatabase;
                projectionRepository = previousProjectionRepository;
                throw error;
              }
            }
            return bundle;
          } catch (error) {
            try {
              reopenedDatabase.close();
            } catch {
              // Preserve the stable CONNECTION_INVALID failure below even if
              // closing the failed replacement connection also throws.
            }
            if (
              error instanceof StorageError &&
              error.reason === "CONNECTION_INVALID"
            ) {
              throw error;
            }
            throw new StorageError(
              "Unable to reopen the Bilimuzhi database",
              true,
              "CONNECTION_INVALID",
            );
          }
        },
      },
      repository: sessionRepository,
      restorationRepository,
      stateStore,
      trashRepository,
    });
    const currentPageSync = createCurrentPageSyncBridge(
      chromeApi.tabs,
      videoGateway,
    );
    const playerRuntime = createChromePlayerRuntimeClient(
      Reflect.get(globalThis, "chrome") as unknown,
      {
        confirmOpenTarget: async ({ canonicalUrl, seconds }) =>
          (await askDialog({
            confirmLabel: t(uiLanguage, "dialog.openAndJump"),
            description: t(uiLanguage, "dialog.openTargetDesc", {
              seconds,
              url: canonicalUrl,
            }),
            title: t(uiLanguage, "dialog.openTargetTitle"),
          })) !== null,
        createRequestId: () => globalThis.crypto.randomUUID(),
      },
    );
    let currentPage: Awaited<ReturnType<typeof currentPageSync.sync>> | null =
      null;
    let createdSessionPageRevision = 0;
    let currentTimeMs: number | undefined;
    let pageIsStale = false;
    let timelineSyncEnabled = false;
    let timelineSyncState: TimelineSyncState = TIMELINE_SYNC_INITIAL;
    let playerSyncTimer: ReturnType<typeof globalThis.setInterval> | null =
      null;
    let monitoredPlayerVideoKey: VideoKey | null = null;
    let playerSamplingBlockedVideoKey: VideoKey | null = null;
    let playerSamplingBlockedAt: number | null = null;
    let playerSamplingRetryTimer: ReturnType<
      typeof globalThis.setTimeout
    > | null = null;
    let playerSamplingRevision = 0;
    let playerReadSequence = 0;
    let latestBackgroundPlayerReadOwner: Readonly<{
      revision: number;
      sequence: number;
      videoKey: VideoKey;
    }> | null = null;
    let latestLocatePlayerReadOwner: Readonly<{
      revision: number;
      sequence: number;
      videoKey: VideoKey;
    }> | null = null;

    const stopBackgroundPlayerPolling = (): void => {
      latestBackgroundPlayerReadOwner = null;
      if (playerSyncTimer !== null) {
        globalThis.clearInterval(playerSyncTimer);
        playerSyncTimer = null;
      }
      monitoredPlayerVideoKey = null;
    };

    const clearPlayerSamplingBlock = (): void => {
      if (playerSamplingRetryTimer !== null) {
        globalThis.clearTimeout(playerSamplingRetryTimer);
        playerSamplingRetryTimer = null;
      }
      playerSamplingBlockedAt = null;
      playerSamplingBlockedVideoKey = null;
    };

    const stopTimelineSync = (): void => {
      playerSamplingRevision += 1;
      latestLocatePlayerReadOwner = null;
      stopBackgroundPlayerPolling();
    };

    /** owner 失效的统一关闭路径：停轮询、置位、状态机 owner-lost、清采样。 */
    const disableTimelineSync = (): void => {
      stopTimelineSync();
      timelineSyncEnabled = false;
      timelineSyncState = timelineSyncReducer(timelineSyncState, {
        kind: "owner-lost",
      });
      currentTimeMs = undefined;
    };

    const synchronizeCurrentPage =
      async (): Promise<SessionWorkspaceSnapshot> => {
        disableTimelineSync();
        const synced = await currentPageSync.sync();
        const routed = await restorationRepository.route(synced.video.videoKey);
        const nextSnapshot = routed
          ? await (async () => {
              await activateWorkspaceSession(
                stateStore,
                routed.session.sessionId,
              );
              return sessionCoordinator.initialize();
            })()
          : await sessionCoordinator.bind({
              kind: "resolved-video",
              video: synced.video,
            });
        currentPage = synced;
        pageIsStale = false;
        clearPlayerSamplingBlock();
        currentTimeMs = undefined;
        return nextSnapshot;
      };

    let snapshot: SessionWorkspaceSnapshot;
    try {
      snapshot = await synchronizeCurrentPage();
    } catch {
      // The panel can also be opened from an extension page or a non-video tab.
      // In that case retain the last user-selected workspace without treating it
      // as the current page's identity.
      snapshot = await sessionCoordinator.initialize();
    }
    let appearanceState = defaultAppearanceState();
    let shouldPersistAppearanceMigration = false;
    try {
      const stored = (await chromeApi.storage.get(APPEARANCE_STORAGE_KEY))[
        APPEARANCE_STORAGE_KEY
      ];
      if (isAppearanceState(stored)) {
        appearanceState = Object.freeze({
          appearance: Object.freeze({ ...stored.appearance }),
          conversationPaneWidthPx: stored.conversationPaneWidthPx,
          version: 2,
        });
      } else {
        const upgraded = upgradeLegacyAppearanceState(stored);
        if (upgraded !== null) {
          appearanceState = upgraded;
          shouldPersistAppearanceMigration = true;
        }
      }
    } catch {
      // Appearance is a local preference: a storage read failure must not hide
      // a recoverable subtitle workspace.
    }
    let workspaceProjection = await projectionRepository.load();
    let settingsEditor: SettingsEditorState =
      await settingsStore.loadEditorState();
    let providerProfiles: readonly ProviderProfileProjection[] =
      await settingsStore.loadProviderProfiles();
    // The earliest v12 migration snapshot did not serialize the model enabled
    // bit. Repair only that absent field through the public store; an explicit
    // false remains disabled and therefore continues to fail closed.
    for (const profile of providerProfiles) {
      for (const model of profile.models) {
        if (typeof model.enabled !== "boolean") {
          await settingsStore.setProfileModelEnabled(
            profile.id,
            model.id,
            true,
          );
        }
      }
    }
    providerProfiles = await settingsStore.loadProviderProfiles();
    let taskSelections = await settingsStore.loadTaskSelections();
    let modelReasoningOverrides: Readonly<
      Record<string, ModelReasoningOverride>
    > = await settingsStore.loadModelReasoningOverrides();
    let customReasoningEfforts: readonly string[] =
      await settingsStore.loadCustomReasoningEfforts();
    const loadChatImageCapability =
      async (): Promise<ImageCapabilityProjection> => {
        const selection = taskSelections.chat;
        if (selection === null || selection.state !== "ready") {
          return Object.freeze({
            modelId: selection?.modelId ?? "",
            profileId: selection?.profileId ?? "",
            state: "unknown",
          });
        }
        const persisted = await settingsStore.loadImageCapability({
          modelId: selection.modelId,
          profileId: selection.profileId,
        });
        if (persisted.state !== "unknown") return persisted;
        // 无真实证据时：只有模型能力表**明确支持**图片才标 supported；
        // 其余（含已知推理模型与未知模型的保守标注）一律 unknown，
        // 恢复 v12「按协议尝试发送」语义——能力表未声明视觉能力
        // （如 deepseek-v4 系列）不得作为拒绝证据，由 Provider 决定。
        const profile = providerProfiles.find(
          ({ id }) => id === selection.profileId,
        );
        const model = profile?.models.find(
          ({ id, enabled }) => id === selection.modelId && enabled,
        );
        if (model === undefined) return persisted;
        const knownCapabilities = resolveKnownModelCapabilities(model.id);
        return Object.freeze({
          modelId: selection.modelId,
          profileId: selection.profileId,
          state:
            knownCapabilities?.supportsAttachments === true
              ? "supported"
              : "unknown",
        });
      };
    chatImageCapability = await loadChatImageCapability();
    let groqKeyProjection = await settingsStore.loadGroqApiKeyProjection();
    let taskModels: BilimuzhiTaskModels = EMPTY_TASK_MODELS;
    try {
      taskModels = await settingsStore.loadTaskModels();
    } catch {
      // Per-task overrides are optional; the shared selection still applies.
    }
    let hostPermissions: ChromeHostPermissions | null = null;
    try {
      hostPermissions = createChromeHostPermissions(chromeValue);
    } catch {
      // Optional permissions are unavailable in restricted test hosts.
    }
    let customHostPermissionGranted = false;
    if (
      hostPermissions !== null &&
      settingsEditor.connection.providerId === CUSTOM_PROVIDER_ID
    ) {
      customHostPermissionGranted = await hostPermissions.contains(
        settingsEditor.connection.baseUrl,
      );
    }
    const storedUiPreferences = await settingsStore.loadUiPreferences();
    let promptPresetState: PromptPresetState =
      await settingsStore.loadPromptPresets();
    const loadedPromptSelections = (
      promptPresetState as PromptPresetState & {
        readonly selectedPromptPresetIds?: Readonly<
          Record<BilimuzhiTaskKind, string>
        >;
      }
    ).selectedPromptPresetIds;
    let selectedPromptPresetIds = Object.freeze({
      ...promptPresetState.defaultPromptPresetIds,
      ...(loadedPromptSelections ?? {}),
    });
    let discoveredModels: readonly AiModelDescriptor[] = Object.freeze([]);
    let settingsOpen = false;
    let promptManagerKind: PromptManagerKind | null = null;
    let settingsFeedback: SettingsDrawerProps["feedback"] = undefined;
    let lastBackupExport: Readonly<{
      downloadId: number;
      filename: string;
    }> | null = null;
    let promptTemplate = storedUiPreferences.promptTemplate;
    let taskPrompts = storedUiPreferences.taskPrompts;
    let speechLanguage: "中文" | "英文" | "其他" | "混合" =
      storedUiPreferences.speechLanguage;
    let exportPreference: SettingsDrawerProps["exportPreference"] =
      storedUiPreferences.exportPreference;
    let speechRoutingMode: GroqRoutingMode =
      storedUiPreferences.speechRoutingMode;
    let uiLanguage = storedUiPreferences.uiLanguage ?? "zh-Hans";
    let taskOutputLanguages: Readonly<
      Record<BilimuzhiTaskKind, OutputLanguagePreference>
    > = storedUiPreferences.taskOutputLanguages;
    let uiPreferenceWrite: Promise<void> = Promise.resolve();

    /** "auto"（不指定语言）→ undefined：供展示层回退界面语言翻译。 */
    const concreteOutputLanguage = (
      preference: OutputLanguagePreference,
    ): UiLanguage | undefined =>
      preference === "auto" ? undefined : preference;

    const controlPromptFor = (kind: BilimuzhiTaskKind): string => {
      const selected = promptPresetState.presets.find(
        (preset) =>
          preset.id === selectedPromptPresetIds[kind] && preset.kind === kind,
      );
      if (selected?.builtIn === true) {
        // 内置只读预设随该模式输出语言整体替换（语言包内容）；
        // "auto"（不指定语言）时使用简体中文内核，且不注入语言控制提示词。
        const preference = taskOutputLanguages[kind];
        const pack =
          PROMPT_LANGUAGE_PACKS[preference === "auto" ? "zh-Hans" : preference];
        return (
          pack.builtInPresets[
            selected.id as keyof typeof pack.builtInPresets
          ] ?? selected.content
        );
      }
      return selected?.content ?? taskPrompts[kind] ?? "";
    };
    let chatThreads: readonly ChatThread[] = Object.freeze([]);
    let activeChatThreadId: string | null = null;
    let chatMessages: readonly ChatMessage[] = Object.freeze([]);
    let chatAttachments: readonly {
      readonly attachmentId: string;
      readonly currentTimeMs: number;
      readonly name: string;
      readonly sizeBytes: number;
      readonly subtitleContextRevision: number;
      readonly subtitleId: string;
      readonly thumbnailUrl: string;
      readonly videoKey: VideoKey;
    }[] = Object.freeze([]);
    let chatMessageAttachments = new Map<
      string,
      readonly {
        readonly attachmentId: string;
        readonly currentTimeMs: number;
        readonly name: string;
        readonly subtitleContextRevision: number;
        readonly subtitleId: string;
        readonly thumbnailUrl: string;
        readonly videoKey: VideoKey;
      }[]
    >();
    let chatAttachmentObjectUrls = new Set<string>();
    let chatDraftAttachmentObjectUrls = new Set<string>();
    let activeChatRun: GenerationRun | null = null;
    const chatRunsByRunId = new Map<string, GenerationRun>();
    const transientReasoningByRunId = new Map<string, string>();
    const artifactByKind = new Map<ArtifactKind, Artifact>();
    const artifactRunByKind = new Map<ArtifactKind, GenerationRun>();
    const artifactProgressByKind = new Map<
      ArtifactKind,
      InsightWorkspaceProps["progress"]
    >();
    const artifactPartialByKind = new Map<ArtifactKind, string>();
    const artifactErrorByKind = new Map<ArtifactKind, string>();
    const artifactReasoningByKind = new Map<
      ArtifactKind,
      Readonly<{
        artifactId: string;
        runId: string;
        text: string;
      }>
    >();
    const artifactInstructionByKind = new Map<ArtifactKind, string>([
      ["segments", ""],
      ["summary", ""],
    ]);
    // 点击「生成」到 SW 返回初始 run 之间的窗口：用于立即把按钮切到「生成中」。
    const artifactStartPendingKinds = new Set<ArtifactKind>();
    let selectedArchiveBranchIds: readonly string[] = Object.freeze([]);
    let surface: "archive" | "trash" | "workspace" = "workspace" as
      "archive" | "trash" | "workspace";
    let batchModeActive = false;
    // 上次视图持久化：刷新/重开 sidepanel 后保留在归档区/回收站界面。
    const LAST_SURFACE_STORAGE_KEY = "muzhi.last-surface.v1";
    try {
      const storedSurface = (
        await chromeApi.storage.get(LAST_SURFACE_STORAGE_KEY)
      )[LAST_SURFACE_STORAGE_KEY] as
        { readonly batchMode?: boolean; readonly surface?: string } | undefined;
      if (storedSurface !== undefined) {
        if (
          storedSurface.surface === "archive" ||
          storedSurface.surface === "trash"
        ) {
          surface = storedSurface.surface;
        }
        batchModeActive = storedSurface.batchMode === true;
      }
    } catch {
      // 视图偏好读取失败时保持默认工作区。
    }
    let helpContext: BatchHelpContext | null = null;
    // Ticket 05 review：utilityView 必须是随 surface/batchModeActive 动态
    // 计算的值（曾为一次性常量，导致 AiChatShell 的 localUtilityView 无法
    // 通过 prop 同步，恢复后自动切换批量工作区不生效）。
    const currentUtilityView = ():
      | "archive"
      | "batch"
      | "batch-archive"
      | "batch-trash"
      | "trash"
      | "workspace" => {
      if (!batchModeActive) return surface;
      return surface === "archive"
        ? "batch-archive"
        : surface === "trash"
          ? "batch-trash"
          : "batch";
    };
    const helpContextForSurface = (): BatchHelpContext => {
      // 修复（Ticket 05）：surface 是动态状态，utilityView 是 renderSidePanel
      // 顶层的常量（仅首次求值，恒 workspace），按 utilityView 判断会导致
      // 批量归档/回收站的帮助 fallback 到批量工作区教程。
      const mode: "batch" | "session" = batchModeActive ? "batch" : "session";
      return batchHelpContext(mode, surface);
    };
    let batchView: BatchJobView | undefined;
    let batchListSelectionActive = false;
    let batchJobs: readonly {
      readonly job: BatchJob;
      readonly pinned: boolean;
    }[] = Object.freeze([]);
    let batchArchivedLists: readonly {
      readonly archivedAt: number;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
    }[] = Object.freeze([]);
    let batchTrashedLists: readonly {
      readonly deletionReason: string;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    }[] = Object.freeze([]);
    let batchInput = "";
    let batchIncludeAllPages = false;
    let batchLanguagePreference = "";
    let batchSourceKind: BatchSourceKind | "auto" = "single-video";
    let batchRetentionChoice: RetentionChoice = "7";
    let batchCustomRetentionDays = "7";
    let batchRetentionApplyTo: "existing" | "future" = "future";
    let batchErrorMessage: string | undefined;
    let batchStatusMessage: string | undefined;
    let batchPreparing = false;
    let batchPrepareGeneration = 0;
    let activeBatchPrepare: BatchPrepareOwner | undefined;
    // 本会话已取消的追加任务：迟到的 preparing 广播不得覆盖取消后的稳定投影。
    const suppressedBatchPrepareJobIds = new Set<string>();
    let busy = false;
    const taskModelSaveErrorByKind = new Map<BilimuzhiTaskKind, string>();
    const taskModelSavePendingKinds = new Set<BilimuzhiTaskKind>();
    let message: SessionDrawerMessage | undefined;
    try {
      const maintenance = await attachmentRepository.maintainOwnership();
      const statistics = await attachmentRepository.readStatistics();
      if (maintenance.deletedAttachmentIds.length > 0) {
        message = {
          kind: "status",
          text: t(uiLanguage, "toast.attachmentCleaned", {
            count: maintenance.deletedAttachmentIds.length,
            total: statistics.attachmentCount,
          }),
        };
      }
    } catch {
      message = {
        kind: "error",
        text: t(uiLanguage, "toast.attachmentMaintenanceFailed"),
      };
    }
    let acquisitionState: SubtitleAcquisitionState = Object.freeze({
      phase: "idle",
      selectedTrackId: null,
      tracks: Object.freeze([]),
    });
    let speechOwner: SubtitleAcquisitionOwner | null = null;
    let speechPhase: SpeechPanelPhase = "idle";
    let speechCompletedChunks = 0;
    let speechTotalChunks = 0;
    let speechRowCount = 0;
    let speechErrorMessage: string | undefined;
    let speechActivity: AsrProgressActivity | undefined;
    let speechPollRevision = 0;
    const speechRunningSessions = new Set<string>();
    let readOnlySessionId: string | null = null;
    let renderSnapshot = (): void => undefined;
    let pendingDialog:
      | {
          readonly request: AppDialogRequest;
          readonly resolve: (value: string | null) => void;
        }
      | undefined;

    /** In-app replacement for `confirm`/`prompt`; resolves `null` on cancel. */
    const askDialog = (request: AppDialogRequest): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        pendingDialog?.resolve(null);
        pendingDialog = { request, resolve };
        renderSnapshot();
      });

    const settleDialog = (value: string | null): void => {
      const current = pendingDialog;
      pendingDialog = undefined;
      current?.resolve(value);
      renderSnapshot();
    };

    const confirmDialog = async (
      request: Omit<AppDialogRequest, "defaultValue" | "options">,
    ): Promise<boolean> => (await askDialog(request)) !== null;

    const readOnlyIsActive = (): boolean =>
      readOnlySessionId !== null &&
      snapshot.restoredWorkspace?.session.sessionId === readOnlySessionId;

    const restoreReadOnlySession = async (): Promise<boolean> => {
      const sessionId = readOnlySessionId;
      if (sessionId === null) return false;
      const placement = workspaceProjection.archive.sessions.find(
        (session) => session.sessionId === sessionId,
      );
      if (placement !== undefined) {
        if (placement.branches.length === 0) {
          await archiveRepository.restoreEmptyArchivedSessionToWorkspace(
            sessionId,
          );
        } else {
          await archiveRepository.restoreArchivedBranchesToWorkspace(
            placement.branches.map((branch) => branch.branchId),
          );
        }
      }
      readOnlySessionId = null;
      snapshot = await sessionCoordinator.initialize();
      return true;
    };

    const guardReadOnly = async <T,>(
      action: () => Promise<T> | T,
    ): Promise<T | false> => {
      if (!readOnlyIsActive()) return action();
      const choice = await askDialog({
        cancelLabel: t(uiLanguage, "common.cancel"),
        confirmLabel: t(uiLanguage, "dialog.readOnlyConfirm"),
        description: t(uiLanguage, "dialog.readOnlyDesc"),
        title: t(uiLanguage, "dialog.readOnlyTitle"),
      });
      if (choice === null) return false;
      await restoreReadOnlySession();
      return action();
    };
    const currentVideoTimeNavigationOwner =
      (): VideoTimeNavigationOwner | null => {
        const workspace = snapshot.restoredWorkspace;
        if (!workspace?.branch || !workspace.subtitle) return null;
        return Object.freeze({
          revision: workspace.branch.contextRevision,
          sessionId: workspace.session.sessionId,
          subtitleId: workspace.subtitle.subtitleId,
          videoKey: workspace.subtitle.videoKey,
        });
      };
    const videoTimeNavigator = createVideoTimeNavigator({
      player: playerRuntime,
      readCurrentOwner: currentVideoTimeNavigationOwner,
    });

    /**
     * 附件时间：优先用轮询缓存；不可用时在添加时刻主动读一次播放器时间，
     * 不依赖后台轮询是否已启动（页面未同步/轮询尚未成功时也能拿到正确时间）。
     */
    const resolveAttachmentTimeMs = async (): Promise<number> => {
      if (typeof currentTimeMs === "number" && currentTimeMs > 0) {
        return currentTimeMs;
      }
      try {
        const owner = currentVideoTimeNavigationOwner();
        if (owner === null) return 0;
        const time = await videoTimeNavigator.readCurrentTime(owner);
        return time !== null && time > 0 ? time : 0;
      } catch {
        return 0;
      }
    };
    const navigateVideoTime = (seconds: number): void => {
      const owner = currentVideoTimeNavigationOwner();
      if (owner === null) return;
      let seekGeneration = timelineSyncState.generation;
      if (timelineSyncEnabled) {
        timelineSyncState = timelineSyncReducer(timelineSyncState, {
          kind: "seek-intent",
          targetMs: Math.round(seconds * 1_000),
        });
        // seek-intent 已递增 generation：响应必须携带意图对应的 generation，
        // 否则 reducer 会把它当作过期事件丢弃，状态将永远停在 seeking。
        seekGeneration = timelineSyncState.generation;
        // 使 seek 前已发出的在途采样立即失效，防止旧时间落回高亮。
        playerSamplingRevision += 1;
      }
      void videoTimeNavigator.navigate({ owner, seconds }).then((result) => {
        if (result.kind === "seeked") {
          currentTimeMs = Math.round(result.seconds * 1_000);
          if (timelineSyncEnabled) {
            timelineSyncState = timelineSyncReducer(timelineSyncState, {
              generation: seekGeneration,
              kind: "seek-resolved",
              timeMs: currentTimeMs,
            });
          }
          clearPlayerSamplingBlock();
          renderSnapshot();
          return;
        }
        if (result.kind === "failed") {
          if (timelineSyncEnabled) {
            timelineSyncState = timelineSyncReducer(timelineSyncState, {
              generation: seekGeneration,
              kind: "seek-failed",
            });
          }
          message = { kind: "error", text: result.message };
          renderSnapshot();
        }
      });
    };

    const currentChatScope = (): ChatRuntimeScope | null => {
      const workspace = snapshot.restoredWorkspace;
      if (!workspace?.branch || !workspace.subtitle) {
        return null;
      }
      const activeThread = chatThreads.find(
        (thread) => thread.chatThreadId === activeChatThreadId,
      );
      return Object.freeze({
        branchId: workspace.branch.branchId,
        contextRevision: workspace.branch.contextRevision,
        expectedOwnerRevision: activeThread?.conversationRevision ?? 0,
        sessionId: workspace.session.sessionId,
        subtitleId: workspace.subtitle.subtitleId,
      });
    };

    const currentArtifactScope = (): ArtifactScope | null => {
      const workspace = snapshot.restoredWorkspace;
      if (!workspace?.branch || !workspace.subtitle) return null;
      return Object.freeze({
        branchId: workspace.branch.branchId,
        contextRevision: workspace.branch.contextRevision,
        sessionId: workspace.session.sessionId,
        subtitleId: workspace.subtitle.subtitleId,
      });
    };

    const resetArtifactState = (): void => {
      artifactByKind.clear();
      artifactRunByKind.clear();
      artifactProgressByKind.clear();
      artifactPartialByKind.clear();
      artifactErrorByKind.clear();
      artifactReasoningByKind.clear();
      artifactStartPendingKinds.clear();
    };

    const loadArtifactState = async (): Promise<void> => {
      const scope = currentArtifactScope();
      resetArtifactState();
      if (scope === null) return;
      const artifacts = await artifactClient.list(scope);
      for (const artifact of artifacts) {
        artifactByKind.set(artifact.kind, artifact);
      }
      // 切回会话：恢复进行中任务的运行状态（run 不随 artifact 列表返回），
      const queriedRuns = await artifactClient.queryActiveRuns(scope);
      if (!Array.isArray(queriedRuns)) return;
      const activeRuns = queriedRuns as readonly GenerationRun[];
      for (const run of activeRuns) {
        if (run.kind === "chat") continue;
        const artifact = artifactByKind.get(run.kind);
        if (artifact === undefined) continue;
        if (
          artifact.artifactId !== run.targetId ||
          artifact.kind !== run.kind ||
          run.expectedOwnerRevision < artifact.artifactRevision
        ) {
          // 已被新一次生成取代的旧 run 不恢复。
          continue;
        }
        artifactRunByKind.set(run.kind, run);
        artifactPartialByKind.set(run.kind, run.partialOutput);
      }
    };

    const attachmentExtension = (attachment: ImageAttachment): string =>
      attachment.mimeType === "image/png"
        ? "png"
        : attachment.mimeType === "image/jpeg"
          ? "jpg"
          : "webp";

    const revokeChatAttachmentObjectUrls = (): void => {
      for (const url of chatAttachmentObjectUrls) {
        URL.revokeObjectURL(url);
      }
      chatAttachmentObjectUrls = new Set();
      chatMessageAttachments = new Map();
    };

    const revokeChatDraftAttachmentObjectUrls = (
      attachments = chatAttachments,
    ): void => {
      for (const attachment of attachments) {
        if (!chatDraftAttachmentObjectUrls.has(attachment.thumbnailUrl)) {
          continue;
        }
        URL.revokeObjectURL(attachment.thumbnailUrl);
        chatDraftAttachmentObjectUrls.delete(attachment.thumbnailUrl);
      }
      if (attachments === chatAttachments) {
        chatDraftAttachmentObjectUrls = new Set();
      }
    };

    const loadChatMessageAttachments = async (
      threadId: string | null,
      messages: readonly ChatMessage[],
    ): Promise<void> => {
      if (threadId === null || messages.length === 0) {
        revokeChatAttachmentObjectUrls();
        return;
      }
      const nextUrls = new Set<string>();
      const nextViews = new Map<
        string,
        readonly {
          readonly attachmentId: string;
          readonly currentTimeMs: number;
          readonly name: string;
          readonly subtitleContextRevision: number;
          readonly subtitleId: string;
          readonly thumbnailUrl: string;
          readonly videoKey: VideoKey;
        }[]
      >();
      try {
        for (const chatMessage of messages) {
          const attachments = await attachmentRepository.listByMessage({
            chatThreadId: threadId,
            messageId: chatMessage.messageId,
          });
          if (attachments.length === 0) continue;
          const views = attachments.map((attachment, index) => {
            if (
              attachment.thumbnailBlob.size <= 0 ||
              (attachment.thumbnailBlob.type !== "image/png" &&
                attachment.thumbnailBlob.type !== "image/jpeg" &&
                attachment.thumbnailBlob.type !== "image/webp")
            ) {
              throw new StorageError(
                t(uiLanguage, "error.imageThumbnailInvalid"),
              );
            }
            const thumbnailUrl = URL.createObjectURL(attachment.thumbnailBlob);
            nextUrls.add(thumbnailUrl);
            return Object.freeze({
              attachmentId: attachment.attachmentId,
              currentTimeMs: attachment.currentTimeMs,
              name: t(uiLanguage, "chat.attachmentName", {
                count: index + 1,
                ext: attachmentExtension(attachment),
              }),
              subtitleContextRevision: attachment.subtitleContextRevision,
              subtitleId: attachment.subtitleId,
              thumbnailUrl,
              videoKey: attachment.videoKey,
            });
          });
          nextViews.set(chatMessage.messageId, Object.freeze(views));
        }
      } catch (error) {
        for (const url of nextUrls) URL.revokeObjectURL(url);
        throw error;
      }
      revokeChatAttachmentObjectUrls();
      chatAttachmentObjectUrls = nextUrls;
      chatMessageAttachments = nextViews;
    };

    const resetChatState = (): void => {
      const draftIds = chatAttachments.map(
        (attachment) => attachment.attachmentId,
      );
      if (draftIds.length > 0) {
        void attachmentRepository
          .discardDrafts(draftIds)
          .catch(() => undefined);
      }
      revokeChatDraftAttachmentObjectUrls();
      chatAttachments = Object.freeze([]);
      chatThreads = Object.freeze([]);
      activeChatThreadId = null;
      chatMessages = Object.freeze([]);
      revokeChatAttachmentObjectUrls();
      activeChatRun = null;
      chatRunsByRunId.clear();
      transientReasoningByRunId.clear();
      stopChatRunReconciler();
    };

    let chatRunReconcileTimer: ReturnType<typeof setInterval> | null = null;
    const stopChatRunReconciler = (): void => {
      if (chatRunReconcileTimer !== null) {
        clearInterval(chatRunReconcileTimer);
        chatRunReconcileTimer = null;
      }
    };
    // 终态事件可能因 SW 中断/竞态缺失：生成期间轮询持久 run 状态自愈，
    // 避免 UI 卡在「正在保存/生成」而对话实际已结束。
    const reconcileChatRun = async (runId: string): Promise<boolean> => {
      if (activeChatRun === null || activeChatRun.runId !== runId) return true;
      try {
        const persisted = (await chatClient.listRuns([runId]))[0];
        if (
          persisted === undefined ||
          (persisted.status !== "completed" &&
            persisted.status !== "failed" &&
            persisted.status !== "stopped" &&
            persisted.status !== "cancelled" &&
            persisted.status !== "interrupted")
        ) {
          return false;
        }
        activeChatRun = persisted;
        chatRunsByRunId.set(persisted.runId, persisted);
        renderSnapshot();
        // 对话 run 终态后刷新工作区投影，解除会话圆点 running 与任务提示残留。
        void refreshProductProjection()
          .then(() => renderSnapshot())
          .catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    };
    const startChatRunReconciler = (runId: string): void => {
      stopChatRunReconciler();
      chatRunReconcileTimer = setInterval(() => {
        void reconcileChatRun(runId).then((done) => {
          if (done) stopChatRunReconciler();
        });
      }, 2_000);
    };
    const loadChatState = async (
      preferredThreadId: string | null = activeChatThreadId,
    ): Promise<void> => {
      const workspace = snapshot.restoredWorkspace;
      if (!workspace?.branch || !workspace.subtitle) {
        resetChatState();
        return;
      }
      const baseScope: ChatRuntimeScope = Object.freeze({
        branchId: workspace.branch.branchId,
        contextRevision: workspace.branch.contextRevision,
        expectedOwnerRevision: 0,
        sessionId: workspace.session.sessionId,
        subtitleId: workspace.subtitle.subtitleId,
      });
      chatThreads = await chatClient.listThreads(baseScope);
      const active =
        chatThreads.find(
          (thread) => thread.chatThreadId === preferredThreadId,
        ) ?? chatThreads[0];
      if (
        activeChatThreadId !== null &&
        activeChatThreadId !== (active?.chatThreadId ?? null) &&
        chatAttachments.length > 0
      ) {
        await attachmentRepository.discardDrafts(
          chatAttachments.map((attachment) => attachment.attachmentId),
        );
        revokeChatDraftAttachmentObjectUrls();
        chatAttachments = Object.freeze([]);
      }
      activeChatThreadId = active?.chatThreadId ?? null;
      chatMessages = active
        ? await chatClient.listMessages(active.chatThreadId, {
            ...baseScope,
            expectedOwnerRevision: active.conversationRevision,
          })
        : Object.freeze([]);
      await loadChatMessageAttachments(activeChatThreadId, chatMessages);
      chatRunsByRunId.clear();
      const runIds = [
        ...new Set(
          chatMessages.flatMap((item) =>
            item.generationRunId === null ? [] : [item.generationRunId],
          ),
        ),
      ];
      if (runIds.length > 0) {
        for (const persisted of await chatClient.listRuns(runIds)) {
          chatRunsByRunId.set(persisted.runId, persisted);
        }
      }
      activeChatRun = null;
      transientReasoningByRunId.clear();
      stopChatRunReconciler();
    };

    const refreshProductProjection = async (): Promise<void> => {
      const nextProjection = await projectionRepository.load();
      const visibleArchiveBranchIds = new Set(
        nextProjection.archive.sessions.flatMap((session) =>
          session.branches.map((branch) => branch.branchId),
        ),
      );
      selectedArchiveBranchIds = Object.freeze(
        selectedArchiveBranchIds.filter((branchId) =>
          visibleArchiveBranchIds.has(branchId),
        ),
      );
      workspaceProjection = nextProjection;
    };

    const reloadSettingsEditor = async (): Promise<void> => {
      settingsEditor = await settingsStore.loadEditorState();
    };

    const reloadV12Settings = async (): Promise<void> => {
      [
        customReasoningEfforts,
        modelReasoningOverrides,
        providerProfiles,
        taskSelections,
        groqKeyProjection,
      ] = await Promise.all([
        settingsStore.loadCustomReasoningEfforts(),
        settingsStore.loadModelReasoningOverrides(),
        settingsStore.loadProviderProfiles(),
        settingsStore.loadTaskSelections(),
        settingsStore.loadGroqApiKeyProjection(),
      ]);
      chatImageCapability = await loadChatImageCapability();
    };

    const persistUiPreferences = (): Promise<void> => {
      const next = {
        exportPreference,
        promptTemplate,
        speechLanguage,
        speechRoutingMode,
        taskPrompts,
        uiLanguage,
        taskOutputLanguages,
        version: 7 as const,
      };
      const write = async (): Promise<void> => {
        await settingsStore.saveUiPreferences(next);
      };
      uiPreferenceWrite = uiPreferenceWrite.then(write, write);
      return uiPreferenceWrite;
    };

    /**
     * Settings actions run behind a modal drawer, so the shell-level status bar
     * is not visible. Every settings action therefore reports its own result
     * inside the drawer, including while it is still running.
     */
    const runSettingsAction = async (
      pendingText: string,
      successText: string,
      action: () => Promise<string | void>,
    ): Promise<boolean> => {
      if (busy) {
        settingsFeedback = {
          kind: "error",
          text: "当前操作尚未完成，请稍候。",
        };
        renderSnapshot();
        return false;
      }
      busy = true;
      settingsFeedback = { kind: "pending", text: pendingText };
      renderSnapshot();
      try {
        const detail = await action();
        settingsFeedback = {
          kind: "status",
          text: typeof detail === "string" ? detail : successText,
        };
      } catch (error) {
        settingsFeedback = {
          kind: "error",
          text: safeSessionActionMessage(error, uiLanguage),
        };
        busy = false;
        renderSnapshot();
        return false;
      }
      busy = false;
      renderSnapshot();
      return true;
    };

    /**
     * Requests the optional host permission for the current custom endpoint.
     * Chrome only shows its prompt from a user gesture, which the settings
     * buttons provide.
     */
    const ensureCustomHostPermission = async (): Promise<void> => {
      const baseUrl = settingsEditor.connection.baseUrl;
      if (hostPermissionPattern(baseUrl) === null) {
        throw new StorageError(
          "The custom provider endpoint must use HTTPS or localhost",
        );
      }
      if (hostPermissions === null) {
        throw new StorageError("Optional host permissions are unavailable");
      }
      if (await hostPermissions.contains(baseUrl)) {
        customHostPermissionGranted = true;
        return;
      }
      const granted = await hostPermissions.request(baseUrl);
      if (!granted) {
        throw new StorageError("The host permission request was denied");
      }
      customHostPermissionGranted = true;
    };

    const discoverProviderModels = async (): Promise<void> => {
      discoveredModels = await chatClient.discoverModels();
      await reloadSettingsEditor();
    };

    const retentionChoice = (): RetentionChoice => {
      const policy = settingsEditor.retention.policy;
      if (policy.kind === "forever") return "forever";
      if (
        policy.durationDays === 7 ||
        policy.durationDays === 30 ||
        policy.durationDays === 365
      ) {
        return String(policy.durationDays) as RetentionChoice;
      }
      return "custom";
    };

    const selectedModelDescriptor = (
      taskKind: BilimuzhiTaskKind,
    ): AiModelDescriptor | null => {
      const selection = taskSelections[taskKind];
      if (selection === null || selection.state !== "ready") return null;
      const profile = providerProfiles.find(
        ({ id }) => id === selection.profileId,
      );
      const model = profile?.models.find(
        ({ id, enabled }) => id === selection.modelId && enabled,
      );
      if (
        !profile ||
        !model ||
        !profile.apiKey.configured ||
        profile.hostPermission !== "granted"
      ) {
        return null;
      }
      const baseCapabilities =
        resolveKnownModelCapabilities(model.id) ??
        createConservativeFallbackCapabilities();
      const concreteReasoning =
        selection.reasoningEffort === "provider-default"
          ? null
          : selection.reasoningEffort;
      // 自定义档位（自建值）不并入模型能力档位集合（该字段语义=内置能力），
      // 传输层对自定义值原样透传；内置档位不在支持集时并入以便描述符校验通过。
      const concreteIsBuiltIn =
        concreteReasoning !== null &&
        isBuiltInReasoningEffort(concreteReasoning);
      const supportedReasoningEfforts =
        concreteIsBuiltIn &&
        !baseCapabilities.supportedReasoningEfforts.includes(concreteReasoning)
          ? Object.freeze([
              ...baseCapabilities.supportedReasoningEfforts,
              concreteReasoning,
            ])
          : baseCapabilities.supportedReasoningEfforts;
      return createAiModelDescriptor({
        capabilities: {
          ...baseCapabilities,
          supportedReasoningEfforts,
          // The v12 profile projection currently has no persisted image
          // capability result. Chat therefore starts at unknown and must be
          // allowed to make the protocol attempt; it is never guessed false.
          supportsAttachments:
            taskKind === "chat" || baseCapabilities.supportsAttachments,
          supportsReasoning:
            concreteReasoning !== null || baseCapabilities.supportsReasoning,
        },
        discoveredAt: Date.now(),
        displayName: model.id,
        modelId: model.id,
        providerId: profile.id,
      });
    };

    /**
     * 三模式任务选择的统一投影（设置页删除确认层与各模式顶部选择器共用）：
     * 配置/模型失效、禁用、撤权或密钥被清时进入 needs-reselection，不自动回退。
     */
    const projectTaskChoice = (
      kind: BilimuzhiTaskKind,
    ): NonNullable<SettingsDrawerProps["taskChoices"]>[number] => {
      const selection = taskSelections[kind];
      const firstProfile = providerProfiles[0];
      const firstModel = firstProfile?.models.find(({ enabled }) => enabled);
      const selectedProfile = providerProfiles.find(
        ({ id }) => id === selection?.profileId,
      );
      const selectedModel = selectedProfile?.models.find(
        ({ id }) => id === selection?.modelId,
      );
      const projectionReady =
        selection !== null &&
        selection.state === "ready" &&
        selectedProfile?.apiKey.configured === true &&
        selectedProfile.hostPermission === "granted" &&
        selectedModel?.enabled === true;
      return {
        kind,
        modelId: selection?.modelId ?? firstModel?.id ?? "",
        profileId: selection?.profileId ?? firstProfile?.id ?? "",
        reasoningEffort: selection?.reasoningEffort ?? "provider-default",
        // 从未选择过时填充有效默认并视为 ready（首次使用不显示失效横幅）；
        // 只有既有选择真正失效（配置/模型被删、禁用、撤权、密钥被清）才 needs-reselection。
        state: projectionReady ? "ready" : "needs-reselection",
      };
    };
    const taskModelProfileOptions = (): readonly TaskModelProfileOption[] =>
      providerProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        models: profile.models.map((model) => ({
          enabled: model.enabled,
          id: model.id,
          label:
            model.verification === "unverified"
              ? `${model.id}${t(uiLanguage, "model.unverifiedSuffix")}`
              : model.id,
          reasoningEfforts:
            resolveKnownModelCapabilities(model.id)
              ?.supportedReasoningEfforts ?? [],
        })),
      }));

    const selectedGeneration = (
      taskKind: BilimuzhiTaskKind = "chat",
    ): ChatGenerationOptions | null => {
      const selection = taskSelections[taskKind];
      const descriptor = selectedModelDescriptor(taskKind);
      if (!selection || selection.state !== "ready" || !descriptor) {
        const taskLabel =
          TASK_MODEL_LABELS.find(({ kind }) => kind === taskKind)?.label ??
          "任务";
        // 任务模型选择已分散到各模式界面顶部：不可用时不再打开设置抽屉，
        // 在当前模式界面内报错，选择器保持可见可直接修正（不自动回退）。
        message = {
          kind: "error",
          text:
            selection?.state === "needs-reselection"
              ? t(uiLanguage, "chat.taskNeedsReselection", {
                  reason:
                    selection.reason ?? t(uiLanguage, "chat.configUnavailable"),
                  taskLabel,
                })
              : selection !== null
                ? t(uiLanguage, "chat.taskSelectionUnavailable")
                : providerProfiles.length === 0
                  ? t(uiLanguage, "chat.noProviderConfigured")
                  : t(uiLanguage, "chat.taskNotSelected", { taskLabel }),
        };
        renderSnapshot();
        return null;
      }
      const reasoningEffort: AiReasoningPreference =
        selection.reasoningEffort === "provider-default"
          ? "auto"
          : selection.reasoningEffort;
      return Object.freeze({
        model: descriptor,
        reasoningEffort,
      });
    };

    const runProductAction = async (
      successText: string,
      action: () => Promise<void>,
    ): Promise<boolean> => {
      if (busy) {
        message = { kind: "error", text: "当前操作尚未完成，请稍候。" };
        renderSnapshot();
        return false;
      }
      busy = true;
      message = undefined;
      renderSnapshot();
      try {
        await action();
      } catch (error) {
        console.error("[muzhi] product action failed:", error);
        message = {
          kind: "error",
          text: safeSessionActionMessage(error, uiLanguage),
        };
        busy = false;
        renderSnapshot();
        return false;
      }
      try {
        await refreshProductProjection();
        message = { kind: "status", text: successText };
      } catch {
        try {
          await refreshProductProjection();
          message = { kind: "status", text: successText };
        } catch {
          message = {
            kind: "error",
            text: t(uiLanguage, "toast.partialRefreshFailed", {
              successMessage: successText,
            }),
          };
        }
      }
      busy = false;
      renderSnapshot();
      return true;
    };

    /**
     * 各模式界面顶部的模型选择变更：立即持久化（有记忆），
     * 失败经安全文案反馈且不改变当前选择。
     */
    const saveTaskModelSelection = (
      kind: BilimuzhiTaskKind,
      selection: TaskModelSelectionInput,
    ): void => {
      if (busy || taskModelSavePendingKinds.has(kind)) return;
      taskModelSaveErrorByKind.delete(kind);
      taskModelSavePendingKinds.add(kind);
      renderSnapshot();
      void settingsStore
        .saveTaskSelection(kind, {
          modelId: selection.modelId,
          profileId: selection.profileId,
          reasoningEffort:
            selection.reasoningEffort as TaskSelectionProjection["reasoningEffort"],
        })
        .then(async (savedSelections) => {
          taskSelections = savedSelections;
          chatImageCapability = await loadChatImageCapability();
          message = {
            kind: "status",
            text: t(uiLanguage, "toast.taskModelSaved"),
          };
        })
        .catch((error: unknown) => {
          const safeMessage = safeSessionActionMessage(error, uiLanguage);
          taskModelSaveErrorByKind.set(kind, safeMessage);
          message = { kind: "error", text: safeMessage };
        })
        .finally(() => {
          taskModelSavePendingKinds.delete(kind);
          renderSnapshot();
        });
    };

    const selectPromptPreset = async (
      kind: BilimuzhiTaskKind,
      presetId: string,
    ): Promise<boolean> => {
      if (
        !promptPresetState.presets.some(
          (preset) => preset.id === presetId && preset.kind === kind,
        )
      ) {
        return false;
      }
      return runProductAction(
        t(uiLanguage, "toast.promptPresetSaved"),
        async () => {
          const store = settingsStore as typeof settingsStore & {
            selectPromptPreset?: (
              kind: BilimuzhiTaskKind,
              presetId: string,
            ) => Promise<PromptPresetState>;
          };
          if (typeof store.selectPromptPreset !== "function") {
            throw new StorageError(
              t(uiLanguage, "toast.promptPresetPersistenceUnavailable"),
              true,
            );
          }
          promptPresetState = await store.selectPromptPreset(kind, presetId);
          const persisted = (
            promptPresetState as PromptPresetState & {
              readonly selectedPromptPresetIds?: Readonly<
                Record<BilimuzhiTaskKind, string>
              >;
            }
          ).selectedPromptPresetIds;
          selectedPromptPresetIds = Object.freeze({
            ...promptPresetState.defaultPromptPresetIds,
            ...(persisted ?? { ...selectedPromptPresetIds, [kind]: presetId }),
          });
        },
      );
    };

    const createPromptPreset = async (
      kind: BilimuzhiTaskKind,
    ): Promise<boolean> => {
      const name = await askDialog({
        confirmLabel: t(uiLanguage, "prompts.createPreset"),
        defaultValue: t(uiLanguage, "prompts.newPreset"),
        inputLabel: "预设名称",
        title: t(uiLanguage, "prompts.newPresetTitle"),
      });
      if (name === null || name.trim().length === 0) return false;
      return runProductAction(
        t(uiLanguage, "toast.promptPresetCreated"),
        async () => {
          const before = new Set(
            promptPresetState.presets.map((preset) => preset.id),
          );
          promptPresetState = await settingsStore.createPromptPreset({
            kind,
            name: name.trim(),
          });
          const created = promptPresetState.presets.find(
            (preset) => preset.kind === kind && !before.has(preset.id),
          );
          if (created) {
            selectedPromptPresetIds = Object.freeze({
              ...selectedPromptPresetIds,
              [kind]: created.id,
            });
          }
        },
      );
    };

    const copyPromptPreset = async (presetId: string): Promise<boolean> => {
      const source = promptPresetState.presets.find(
        (preset) => preset.id === presetId,
      );
      if (!source) return false;
      try {
        await navigator.clipboard.writeText(
          displayPresetContent(
            source,
            uiLanguage,
            concreteOutputLanguage(taskOutputLanguages[source.kind]),
          ),
        );
        message = { kind: "status", text: t(uiLanguage, "toast.promptCopied") };
        renderSnapshot();
        return true;
      } catch {
        message = {
          kind: "error",
          text: t(uiLanguage, "toast.clipboardFailed"),
        };
        renderSnapshot();
        return false;
      }
    };

    const deletePromptPreset = async (presetId: string): Promise<boolean> => {
      const target = promptPresetState.presets.find(
        (preset) => preset.id === presetId,
      );
      if (!target || target.builtIn) return false;
      const confirmed = await confirmDialog({
        confirmLabel: t(uiLanguage, "prompts.deletePreset"),
        danger: true,
        description: t(uiLanguage, "dialog.deletePresetBody", {
          name: target.name,
        }),
        title: t(uiLanguage, "prompts.deletePresetTitle"),
      });
      if (!confirmed) return false;
      return runProductAction(
        t(uiLanguage, "toast.promptPresetDeleted"),
        async () => {
          promptPresetState = await settingsStore.deletePromptPreset(presetId);
          if (selectedPromptPresetIds[target.kind] === presetId) {
            selectedPromptPresetIds = Object.freeze({
              ...selectedPromptPresetIds,
              [target.kind]:
                promptPresetState.defaultPromptPresetIds[target.kind],
            });
          }
        },
      );
    };

    const setDefaultPromptPreset = (
      kind: BilimuzhiTaskKind,
      presetId: string,
    ): Promise<boolean> =>
      runProductAction(
        t(uiLanguage, "toast.defaultPromptPresetSaved"),
        async () => {
          promptPresetState = await settingsStore.selectDefaultPromptPreset(
            kind,
            presetId,
          );
        },
      );

    const updatePromptPreset = (value: {
      readonly content: string;
      readonly name: string;
      readonly presetId: string;
    }): Promise<boolean> =>
      runProductAction(
        t(uiLanguage, "toast.promptPresetSavedShort"),
        async () => {
          promptPresetState = await settingsStore.updatePromptPreset(
            value.presetId,
            { content: value.content, name: value.name },
          );
        },
      );
    const subtitleCoordinator = createSubtitleAcquisitionCoordinator({
      onChange: (state) => {
        acquisitionState = state;
        renderSnapshot();
      },
      runtime: createChromeSubtitleRuntimeClient(
        Reflect.get(globalThis, "chrome") as unknown,
      ),
    });
    const requestedSpeechLanguage = () =>
      speechLanguage === "中文"
        ? ("zh" as const)
        : speechLanguage === "英文"
          ? ("en" as const)
          : speechLanguage === "其他"
            ? ("other" as const)
            : ("mixed" as const);

    const applySpeechRecord = (
      record: Awaited<ReturnType<typeof speechClient.status>>,
    ): boolean => {
      if (record === null) {
        speechPhase = "error";
        speechErrorMessage = t(uiLanguage, "toast.speechStatusInvalid");
        return true;
      }
      speechCompletedChunks = record.progress.completedChunks;
      speechTotalChunks = record.progress.totalChunks;
      speechActivity =
        record.progress.audioPreparationBytes ?? record.progress.activity;
      if (record.status === "queued" || record.status === "running") {
        speechPhase = record.progress.stage;
        return false;
      }
      if (record.status === "completed") {
        speechPhase = "success";
        return true;
      }
      if (record.status === "cancelled") {
        speechPhase = "idle";
        return true;
      }
      speechPhase = "error";
      speechErrorMessage = speechFailurePresentation(
        record,
        uiLanguage,
      ).message;
      return true;
    };

    const observeSpeechTask = async (
      owner: SubtitleAcquisitionOwner,
      revision: number,
    ): Promise<void> => {
      let consecutiveTransportFailures = 0;
      while (
        speechOwner?.taskId === owner.taskId &&
        speechPollRevision === revision
      ) {
        try {
          const record = await speechClient.status(owner);
          const reconnected = consecutiveTransportFailures > 0;
          consecutiveTransportFailures = 0;
          if (reconnected) message = undefined;
          const terminal = applySpeechRecord(record);
          renderSnapshot();
          if (terminal) {
            speechRunningSessions.delete(owner.sessionId);
            if (record?.status === "completed") {
              // 语音字幕在 SW 侧已提交：重新加载会话快照与产品投影后再读行数，
              // 否则旧 snapshot 无字幕会显示「成功 0 行」，且界面不会立即出现字幕。
              snapshot = await sessionCoordinator.initialize();
              await refreshProductProjection();
              speechRowCount =
                snapshot.restoredWorkspace?.subtitle?.rows.length ?? 0;
              void refreshPlayerTime(
                snapshot.restoredWorkspace?.subtitle?.videoKey ?? null,
              );
            }
            renderSnapshot();
            return;
          }
        } catch (error) {
          if (speechPhase === "success") {
            message = {
              kind: "error",
              text: t(uiLanguage, "toast.speechSavedRefreshFailed"),
            };
            renderSnapshot();
            return;
          }
          if (
            error instanceof ChromeSpeechRuntimeError &&
            error.retryable &&
            consecutiveTransportFailures < 5
          ) {
            consecutiveTransportFailures += 1;
            message = {
              kind: "status",
              text: t(uiLanguage, "toast.speechReconnecting", {
                count: consecutiveTransportFailures,
              }),
            };
            renderSnapshot();
            await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
            continue;
          }
          speechPhase = "error";
          speechErrorMessage =
            error instanceof ChromeSpeechRuntimeError
              ? error.message
              : t(uiLanguage, "toast.speechStatusUnreadable");
          renderSnapshot();
          return;
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
      }
    };

    const attachActiveSpeechForCurrentWorkspace = async (): Promise<void> => {
      void refreshSpeechRunningIndicators().catch(() => undefined);
      const revision = ++speechPollRevision;
      speechOwner = null;
      speechPhase = "idle";
      speechCompletedChunks = 0;
      speechTotalChunks = 0;
      speechErrorMessage = undefined;
      const activeSession = snapshot.restoredWorkspace?.session;
      if (!activeSession || !isSessionVideoBound(activeSession)) return;
      const videoKey = activeSession.videoKey;
      const active = await speechClient.active(videoKey);
      const record = active[0];
      if (!record || revision !== speechPollRevision) return;
      speechOwner = record.owner;
      applySpeechRecord(record);
      renderSnapshot();
      void observeSpeechTask(record.owner, revision);
    };

    const cancelSpeechForVideo = async (
      videoKey: Parameters<typeof speechClient.active>[0],
    ): Promise<void> => {
      const records = await speechClient.active(videoKey);
      await Promise.all(
        records.map((record) => {
          speechRunningSessions.delete(record.owner.sessionId);
          return speechClient.cancel(record.owner);
        }),
      );
    };

    const stopRunsForSession = async (sessionId: string): Promise<void> => {
      const targets: GenerationRun[] = [];
      if (activeChatRun !== null && activeChatRun.sessionId === sessionId) {
        targets.push(activeChatRun);
      }
      for (const run of artifactRunByKind.values()) {
        if (run.sessionId === sessionId) targets.push(run);
      }
      if (targets.length === 0) return;
      // 在删除/归档事务提交前停止：owner 仍权威，stopByUser 才能提交并 abort
      // 执行器（chat 已注册 executor；artifact 依赖流式循环的终态退出兜底）。
      await Promise.all(
        targets.map(async (run) => {
          try {
            if (run.kind === "chat") {
              await chatClient.stop(run);
            } else {
              await artifactClient.stop(run);
            }
          } catch {
            // 停止是尽力而为；删除/归档事务仍会 owner-deleted 停止记录。
          }
        }),
      );
    };

    const refreshSpeechRunningIndicators = async (): Promise<void> => {
      const videoKeys = new Set(
        workspaceProjection.workspace.sessions
          .map((session) => session.videoKey)
          .filter((key): key is VideoKey => typeof key === "string"),
      );
      const entries = await Promise.all(
        [...videoKeys].map(async (videoKey) => {
          try {
            const records = await speechClient.active(videoKey);
            return records.map((record) => record.owner.sessionId);
          } catch {
            return [];
          }
        }),
      );
      const next = new Set(entries.flat());
      for (const sessionId of next) speechRunningSessions.add(sessionId);
      for (const sessionId of [...speechRunningSessions]) {
        if (!next.has(sessionId)) speechRunningSessions.delete(sessionId);
      }
      renderSnapshot();
    };

    const unsubscribeChat = chatClient.subscribe(
      (event: ChromeChatRuntimeEvent): void => {
        if (event.type === "muzhi.chat.reasoning") {
          if (event.payload.threadId !== activeChatThreadId) return;
          const ownsRun =
            activeChatRun?.runId === event.payload.runId ||
            chatMessages.some(
              (item) =>
                item.role === "assistant" &&
                item.generationRunId === event.payload.runId,
            );
          if (!ownsRun) return;
          transientReasoningByRunId.set(
            event.payload.runId,
            `${transientReasoningByRunId.get(event.payload.runId) ?? ""}${event.payload.text}`,
          );
          renderSnapshot();
          return;
        }
        if (event.payload.threadId !== activeChatThreadId) return;
        const updated = event.payload.message;
        const existingIndex = chatMessages.findIndex(
          (item) => item.messageId === updated.messageId,
        );
        chatMessages = Object.freeze(
          existingIndex < 0
            ? [...chatMessages, updated]
            : chatMessages.map((item, index) =>
                index === existingIndex ? updated : item,
              ),
        );
        activeChatRun = event.payload.run;
        chatRunsByRunId.set(event.payload.run.runId, event.payload.run);
        if (
          activeChatRun.status === "completed" ||
          activeChatRun.status === "failed" ||
          activeChatRun.status === "stopped" ||
          activeChatRun.status === "cancelled" ||
          activeChatRun.status === "interrupted"
        ) {
          stopChatRunReconciler();
          // 终态事件到达后刷新投影，解除会话圆点 running 与任务提示残留。
          void refreshProductProjection()
            .then(() => renderSnapshot())
            .catch(() => undefined);
        } else {
          startChatRunReconciler(activeChatRun.runId);
        }
        const ownedReasoningRunIds = new Set(
          chatMessages.flatMap((item) =>
            item.role === "assistant" && item.generationRunId !== null
              ? [item.generationRunId]
              : [],
          ),
        );
        for (const runId of transientReasoningByRunId.keys()) {
          if (!ownedReasoningRunIds.has(runId)) {
            transientReasoningByRunId.delete(runId);
          }
        }
        renderSnapshot();
      },
    );

    const unsubscribeBatch = batchClient.subscribe((event) => {
      const eventJobId = event.payload.job.batchJobId;
      if (
        suppressedBatchPrepareJobIds.has(eventJobId) &&
        event.payload.job.status === "preparing"
      ) {
        return;
      }
      const activePrepare = activeBatchPrepare;
      let acceptsEvent = false;

      if (activePrepare) {
        const accepted = acceptBatchPrepareEvent(activePrepare, {
          batchJobId: eventJobId,
          operationId: event.prepareOperationId,
          status: event.payload.job.status,
        });
        if (accepted.accepted) {
          activeBatchPrepare = accepted.owner;
          acceptsEvent = true;
        }
      } else {
        acceptsEvent =
          batchView === undefined || eventJobId === batchView.job.batchJobId;
      }

      if (!acceptsEvent) {
        // 非当前列表的后台更新：左侧列表状态仍需实时刷新。
        void refreshBatchJobs().then(() => renderSnapshot());
        return;
      }

      batchView = event.payload;
      // 任何批量事件都可能改变当前列表状态，左侧列表同时刷新。
      void refreshBatchJobs().then(() => renderSnapshot());
      if (event.payload.job.status === "preparing") {
        const failed = event.payload.items.filter(
          (item) => item.status === "failed",
        ).length;
        const completed =
          event.payload.progress?.completed ??
          event.payload.items.filter(
            (item) =>
              item.status === "failed" || item.progress?.stage === "listed",
          ).length;
        const total =
          event.payload.progress?.total ?? event.payload.items.length;
        batchPreparing = true;
        batchStatusMessage = t(uiLanguage, "batch.progressStatus", {
          added: Math.max(0, completed - failed),
          completed,
          failed,
          total,
        });
      } else if (batchPreparing) {
        batchPreparing = false;
      }
      renderSnapshot();
    });

    const refreshBatchJobs = async (): Promise<void> => {
      batchJobs = await batchClient.listJobs();
    };

    const refreshBatchArchive = async (): Promise<void> => {
      // Ticket 05：到期自动清理（对齐会话惰性语义）——刷新归档/回收站时
      // 永久删除已到期的批量回收站条目。
      try {
        await batchClient.permanentlyDeleteExpiredBatchTrash(Date.now());
      } catch {
        // 清理失败不阻塞列表展示。
      }
      const [lists, trashed] = await Promise.all([
        batchClient.listArchivedLists(),
        batchClient.listTrashedLists(),
      ]);
      batchArchivedLists = lists;
      batchTrashedLists = trashed;
      try {
        const policy = await batchClient.getRetentionPolicy();
        if (policy.kind === "forever") {
          batchRetentionChoice = "forever";
        } else {
          const days = String(policy.durationDays);
          batchRetentionChoice =
            days === "7" || days === "30" || days === "365"
              ? (days as RetentionChoice)
              : "custom";
          if (batchRetentionChoice === "custom")
            batchCustomRetentionDays = days;
        }
      } catch {
        // 保留期限读取失败时保持上次值。
      }
    };

    const runBatchAction = (
      successText: string | undefined,
      action: () => Promise<void>,
      options?: {
        readonly errorText?: string;
        readonly force?: boolean;
        readonly noTimeout?: boolean;
      },
    ): Promise<boolean> =>
      runBatchCommand(
        {
          isBusy: () => busy,
          onError: (message) => {
            batchErrorMessage = message;
          },
          onRender: renderSnapshot,
          onStatus: (message) => {
            batchStatusMessage = message;
          },
          setBusy: (value) => {
            busy = value;
          },
        },
        action,
        {
          errorText: (error) =>
            error instanceof ChromeBatchRuntimeError
              ? error.message
              : t(uiLanguage, "batch.fetchFailed"),
          ...(successText === undefined ? {} : { successText }),
          ...(options?.errorText === undefined
            ? {}
            : { errorText: options.errorText }),
          ...(options?.force === true ? { force: true } : {}),
          ...(options?.noTimeout === true ? {} : { timeoutMs: 10_000 }),
          timeoutText: t(uiLanguage, "batch.commandTimeout"),
        },
      );

    const downloadBlob = (filename: string, blob: Blob): void => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = filename;
      anchor.href = url;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const exportBatch = async (
      format: BatchExportFormat,
      requestedBatchItemIds?: readonly string[],
      options?: {
        readonly includeTimestamps?: boolean;
        readonly zip?: boolean;
      },
    ): Promise<void> => {
      const current = batchView;
      if (!current) return;
      const batchItemIds =
        requestedBatchItemIds ??
        current.items
          .filter(
            (item) =>
              item.selected && item.status === "succeeded" && item.rowCount > 0,
          )
          .map((item) => item.batchItemId);
      const entries: readonly BatchExportEntry[] =
        await batchClient.collectExport(current.job.batchJobId, batchItemIds);
      if (entries.length === 0) {
        throw new ChromeBatchRuntimeError(
          "SUBTITLE_NOT_FOUND",
          t(uiLanguage, "batch.noExportableSubtitle"),
          false,
        );
      }
      const jobName = safeZipPath(
        current.job.name ?? current.job.sourceLabel ?? "muzhi-batch",
        "muzhi-batch",
      );
      // 多选导出：默认打包 ZIP；取消勾选时逐个下载每个条目的字幕文件。
      if (entries.length > 1 && options?.zip !== false) {
        downloadBlob(
          `${jobName}.zip`,
          createZipArchive(
            entries.map((entry, index) => {
              const artifact = createSubtitleExport({
                format: format,
                includeTimestamps: options?.includeTimestamps,
                rows: entry.rows,
                title: entry.title,
              });
              const extension = format === "markdown" ? "md" : format;
              return {
                content: artifact.content,
                path: safeZipPath(
                  `${String(index + 1).padStart(3, "0")}-${entry.title}.${extension}`,
                  `subtitle-${index + 1}.${extension}`,
                ),
              };
            }),
          ),
        );
        return;
      }
      if (entries.length > 1) {
        // 未勾选 ZIP：每个条目单独下载一个文件（浏览器会提示允许下载多个文件）。
        for (const entry of entries) {
          const artifact = createSubtitleExport({
            format: format,
            includeTimestamps: options?.includeTimestamps,
            rows: entry.rows,
            title: entry.title,
          });
          downloadBlob(
            artifact.filename,
            new Blob([artifact.content], { type: artifact.mimeType }),
          );
        }
        return;
      }
      const entry = entries[0]!;
      const artifact = createSubtitleExport({
        format: format,
        includeTimestamps: options?.includeTimestamps,
        rows: entry.rows,
        title: entry.title,
      });
      downloadBlob(
        artifact.filename,
        new Blob([artifact.content], { type: artifact.mimeType }),
      );
    };

    /**
     * Bundles everything the current subtitle context owns into one archive:
     * the subtitle in all three formats, the segments and summary artifacts and
     * every conversation. File names are sanitised by the ZIP writer.
     */
    const unsubscribeArtifacts = artifactClient.subscribe(
      (event: ChromeArtifactRuntimeEvent): void => {
        if (event.type === "muzhi.artifact.reasoning") {
          const reasoning = event.payload;
          const scope = currentArtifactScope();
          const currentRun = artifactRunByKind.get(reasoning.kind);
          const currentArtifact = artifactByKind.get(reasoning.kind);
          if (
            scope === null ||
            currentRun === undefined ||
            currentArtifact === undefined ||
            currentRun.sessionId !== scope.sessionId ||
            currentRun.branchId !== scope.branchId ||
            currentRun.subtitleId !== scope.subtitleId ||
            currentRun.contextRevision !== scope.contextRevision ||
            currentRun.kind !== reasoning.kind ||
            currentRun.targetId !== reasoning.artifactId ||
            currentRun.runId !== reasoning.runId ||
            currentArtifact.artifactId !== reasoning.artifactId ||
            currentArtifact.kind !== reasoning.kind
          ) {
            return;
          }
          const previous = artifactReasoningByKind.get(reasoning.kind);
          artifactReasoningByKind.set(
            reasoning.kind,
            Object.freeze({
              artifactId: reasoning.artifactId,
              runId: reasoning.runId,
              text: `${
                previous?.artifactId === reasoning.artifactId &&
                previous.runId === reasoning.runId
                  ? previous.text
                  : ""
              }${reasoning.text}`,
            }),
          );
          renderSnapshot();
          return;
        }
        const update = event.payload;
        const scope = currentArtifactScope();
        if (
          scope === null ||
          update.run.sessionId !== scope.sessionId ||
          update.run.branchId !== scope.branchId ||
          update.run.subtitleId !== scope.subtitleId ||
          update.run.contextRevision !== scope.contextRevision
        ) {
          return;
        }
        const previousReasoning = artifactReasoningByKind.get(update.kind);
        if (
          previousReasoning !== undefined &&
          (previousReasoning.artifactId !== update.artifactId ||
            previousReasoning.runId !== update.run.runId)
        ) {
          artifactReasoningByKind.delete(update.kind);
        }
        artifactRunByKind.set(update.kind, update.run);
        artifactProgressByKind.set(update.kind, update.progress);
        artifactPartialByKind.set(update.kind, update.partialOutput);
        if (update.artifact !== null) {
          artifactByKind.set(update.kind, update.artifact);
          if (update.artifact.status === "ready") {
            artifactRunByKind.delete(update.kind);
            artifactProgressByKind.delete(update.kind);
            artifactPartialByKind.delete(update.kind);
            // 任务结束后刷新投影，避免抽屉 running 指标残留。
            void refreshProductProjection()
              .then(() => renderSnapshot())
              .catch(() => undefined);
          }
          if (update.artifact.status === "failed") {
            artifactErrorByKind.set(
              update.kind,
              artifactFailureMessage(
                update.artifact.errorCode,
                update.kind,
                uiLanguage,
              ),
            );
            // 失败同样属于任务结束：刷新投影，避免抽屉 running 指标残留。
            void refreshProductProjection()
              .then(() => renderSnapshot())
              .catch(() => undefined);
          } else {
            artifactErrorByKind.delete(update.kind);
          }
        }
        renderSnapshot();
      },
    );

    const persistAppearance = async (): Promise<void> => {
      await chromeApi.storage.set({
        [APPEARANCE_STORAGE_KEY]: appearanceState,
      });
    };

    if (shouldPersistAppearanceMigration) {
      void persistAppearance().catch(() => undefined);
    }

    const hasPendingLocateForCurrentPage = (videoKey: VideoKey): boolean => {
      const owner = latestLocatePlayerReadOwner;
      return (
        owner !== null &&
        owner.revision === playerSamplingRevision &&
        owner.videoKey === videoKey &&
        !pageIsStale &&
        currentPage?.video.videoKey === videoKey
      );
    };

    const refreshPlayerTime = async (
      videoKey: VideoKey | null,
      reportFailure = false,
    ): Promise<number | null> => {
      const createPlayerBindingError = (): ChromePlayerRuntimeError =>
        new ChromePlayerRuntimeError(
          "VIDEO_NOT_BOUND",
          t(uiLanguage, "error.playerBinding"),
          true,
        );
      if (videoKey === null) return null;
      if (
        pageIsStale ||
        currentPage?.video.videoKey !== videoKey ||
        (playerSamplingBlockedVideoKey === videoKey && !reportFailure)
      ) {
        if (reportFailure) {
          throw createPlayerBindingError();
        }
        return null;
      }
      const readGeneration = timelineSyncState.generation;
      const owner = Object.freeze({
        revision: playerSamplingRevision,
        sequence: (playerReadSequence += 1),
        videoKey,
      });
      if (reportFailure) {
        latestLocatePlayerReadOwner = owner;
      } else {
        latestBackgroundPlayerReadOwner = owner;
      }
      const ownsCurrentPlayerRead = (): boolean =>
        (reportFailure
          ? latestLocatePlayerReadOwner === owner
          : latestBackgroundPlayerReadOwner === owner) &&
        owner.revision === playerSamplingRevision &&
        !pageIsStale &&
        currentPage?.video.videoKey === owner.videoKey;
      try {
        const navigationOwner = currentVideoTimeNavigationOwner();
        if (navigationOwner === null || navigationOwner.videoKey !== videoKey) {
          if (reportFailure) throw createPlayerBindingError();
          return null;
        }
        const time = await videoTimeNavigator.readCurrentTime(navigationOwner);
        if (time === null) {
          if (reportFailure) throw createPlayerBindingError();
          return null;
        }
        if (!ownsCurrentPlayerRead()) {
          if (reportFailure) {
            throw createPlayerBindingError();
          }
          return null;
        }
        const preservePendingLocateLeaf =
          !reportFailure && hasPendingLocateForCurrentPage(videoKey);
        const backgroundPollingWasStopped = playerSyncTimer === null;
        if (reportFailure) {
          latestLocatePlayerReadOwner = null;
        }
        clearPlayerSamplingBlock();
        currentTimeMs = time;
        // 同步状态下：采样进入状态机，旧 generation 采样由 reducer fail-close。
        timelineSyncState = timelineSyncReducer(timelineSyncState, {
          generation: readGeneration,
          kind: "sample",
          timeMs: time,
        });
        if (!reportFailure && !preservePendingLocateLeaf) {
          renderSnapshot();
        } else if (reportFailure && backgroundPollingWasStopped) {
          monitorPlayerTime(videoKey);
        }
        return time;
      } catch (error) {
        if (reportFailure) {
          if (!ownsCurrentPlayerRead()) {
            throw createPlayerBindingError();
          }
          latestLocatePlayerReadOwner = null;
          throw error;
        }
        if (!ownsCurrentPlayerRead()) {
          return null;
        }
        const preservePendingLocateLeaf =
          hasPendingLocateForCurrentPage(videoKey);
        disableTimelineSync();
        playerSamplingBlockedVideoKey = videoKey;
        playerSamplingBlockedAt = Date.now();
        // 失败后不永久 block：5 秒后自动解除并重试轮询，
        // 避免播放器/内容脚本短暂不可用时附件时间恒为 0s。
        if (playerSamplingRetryTimer !== null) {
          globalThis.clearTimeout(playerSamplingRetryTimer);
        }
        playerSamplingRetryTimer = globalThis.setTimeout(() => {
          playerSamplingRetryTimer = null;
          if (
            playerSamplingBlockedVideoKey !== null &&
            playerSamplingBlockedAt !== null &&
            Date.now() - playerSamplingBlockedAt >= 5_000
          ) {
            playerSamplingBlockedVideoKey = null;
            playerSamplingBlockedAt = null;
            renderSnapshot();
          }
        }, 5_000);
        if (!preservePendingLocateLeaf) {
          renderSnapshot();
        }
        return null;
      }
    };

    const monitorPlayerTime = (videoKey: VideoKey | null): void => {
      if (
        monitoredPlayerVideoKey === videoKey &&
        (videoKey === null || playerSyncTimer !== null)
      ) {
        return;
      }
      stopTimelineSync();
      monitoredPlayerVideoKey = videoKey;
      if (videoKey === null) return;
      void refreshPlayerTime(videoKey);
      playerSyncTimer = globalThis.setInterval(() => {
        void refreshPlayerTime(videoKey);
      }, 750);
    };

    const setTimelineSyncEnabled = (
      enabled: boolean,
      videoKey: VideoKey,
    ): void => {
      const canSample =
        !pageIsStale &&
        currentPage?.video.videoKey === videoKey &&
        playerSamplingBlockedVideoKey !== videoKey;
      const nextEnabled = enabled && canSample;
      if (timelineSyncEnabled && !nextEnabled) {
        timelineSyncState = timelineSyncReducer(timelineSyncState, {
          kind: "toggle-off",
        });
      } else if (!timelineSyncEnabled && nextEnabled) {
        timelineSyncState = timelineSyncReducer(timelineSyncState, {
          kind: "toggle-on",
        });
      }
      timelineSyncEnabled = nextEnabled;
      monitorPlayerTime(canSample ? videoKey : null);
      renderSnapshot();
    };

    renderSnapshot = (): void => {
      setIconLanguage(uiLanguage);
      const restoredWorkspace = snapshot.restoredWorkspace;
      const subtitle = restoredWorkspace?.subtitle;
      const playerIsBound =
        !pageIsStale &&
        subtitle !== undefined &&
        subtitle !== null &&
        currentPage?.video.videoKey === subtitle.videoKey;
      const markdownTimeLinkScope =
        subtitle === undefined || subtitle === null
          ? undefined
          : Object.freeze({
              // Explicit generated time links remain owned by the persisted
              // subtitle even when its original player tab is stale/closed.
              // The Chrome player runtime owns activation/open confirmation.
              activeVideoKey: subtitle.videoKey,
              subtitleVideoKey: subtitle.videoKey,
            });
      monitorPlayerTime(
        currentUtilityView() === "workspace" &&
          playerIsBound &&
          playerSamplingBlockedVideoKey !== subtitle.videoKey
          ? subtitle.videoKey
          : null,
      );
      const currentVideo = playerIsBound ? currentPage?.video : undefined;
      const durationMs =
        currentVideo && typeof currentVideo.durationSec === "number"
          ? Math.round(currentVideo.durationSec * 1_000)
          : undefined;
      const subtitleTimelineOwner = subtitle
        ? Object.freeze({
            pageRevision: restoredWorkspace?.branch?.contextRevision ?? 0,
            videoKey: subtitle.videoKey,
          })
        : undefined;
      const playerTimelineOwner =
        playerIsBound &&
        restoredWorkspace?.branch?.videoKey === subtitle?.videoKey &&
        subtitleTimelineOwner !== undefined
          ? subtitleTimelineOwner
          : undefined;
      // Ticket 02：按钮 disabled 的 hover 原因（页面未连接 / 其他视频）。
      const playerDisconnectReason =
        subtitleTimelineOwner === undefined
          ? undefined
          : playerTimelineOwner !== undefined
            ? undefined
            : currentPage === null || pageIsStale
              ? autoRebindMismatch
                ? ("video-mismatch" as const)
                : ("no-video" as const)
              : ("video-mismatch" as const);
      const timeline: SubtitleTimelineProps | undefined = subtitle
        ? {
            uiLanguage,
            currentTimeMs,
            durationMs,
            onLocateCurrent: () => refreshPlayerTime(subtitle.videoKey, true),
            onSyncEnabledChange: (enabled: boolean) =>
              setTimelineSyncEnabled(enabled, subtitle.videoKey),
            playerDisconnectReason,
            onSeek: navigateVideoTime,
            syncEnabled: timelineSyncEnabled,
            syncState: timelineSyncState,
            onExport: (
              format: SubtitleExportFormat,
              options?: { readonly includeTimestamps?: boolean },
            ) =>
              downloadSubtitleExport(
                createSubtitleExport({
                  format,
                  includeTimestamps: options?.includeTimestamps,
                  rows: subtitle.rows,
                  title: restoredWorkspace.session.title,
                }),
              ),
            playerOwner: playerTimelineOwner,
            rows: subtitle.rows,
            subtitleOwner: subtitleTimelineOwner,
          }
        : restoredWorkspace != null &&
            isSessionVideoBound(restoredWorkspace.session)
          ? undefined
          : {
              availability: "no-video" as const,
              rows: [],
              uiLanguage,
            };

      const startBatch = (
        method?: "direct" | "speech",
        batchItemIds?: readonly string[],
        overwrite?: "skip" | "all",
        speechScope?: "zh" | "en" | "other" | "mixed" | "ja" | "item",
      ): void => {
        const current = batchView;
        if (!current) return;
        const originalSelectedIds = current.items
          .filter((item) => item.selected)
          .map((item) => item.batchItemId);
        batchErrorMessage = undefined;
        batchStatusMessage =
          method === "speech"
            ? t(uiLanguage, "batch.voiceStarted")
            : method === "direct"
              ? t(uiLanguage, "batch.directStarted")
              : t(uiLanguage, "batch.retryStarted");
        renderSnapshot();
        void (async () => {
          if (batchItemIds !== undefined) {
            await batchClient.setSelection(
              current.job.batchJobId,
              batchItemIds,
            );
          }
          try {
            const next = await batchClient.start({
              batchJobId: current.job.batchJobId,
              languagePreference: batchLanguagePreference,
              speechRoutingMode,
              ...(method === undefined ? {} : { method }),
              ...(overwrite === undefined ? {} : { overwrite }),
              ...(speechScope === undefined
                ? {}
                : { speechLanguageScope: speechScope }),
            });
            if (batchItemIds === undefined) return next;
            return (
              (await batchClient.setSelection(
                current.job.batchJobId,
                originalSelectedIds,
              )) ?? next
            );
          } catch (error) {
            if (batchItemIds !== undefined) {
              const restored = await batchClient.setSelection(
                current.job.batchJobId,
                originalSelectedIds,
              );
              if (restored) batchView = restored;
            }
            throw error;
          }
        })()
          .then((next) => {
            batchView = next;
            batchStatusMessage =
              method === "speech"
                ? t(uiLanguage, "batch.voiceFinished")
                : method === "direct"
                  ? t(uiLanguage, "batch.directFinished")
                  : t(uiLanguage, "batch.retryFinished");
            renderSnapshot();
          })
          .catch((error: unknown) => {
            batchErrorMessage =
              error instanceof ChromeBatchRuntimeError
                ? error.message
                : t(uiLanguage, "batch.fetchFailed");
            renderSnapshot();
          });
      };

      const batch: BatchWorkspaceProps = {
        busy,
        errorMessage: batchErrorMessage,
        includeAllPages: batchIncludeAllPages,
        input: batchInput,
        uiLanguage,
        hasLists: batchJobs.length > 0,
        speechConfigured: groqKeyProjection.configured,
        speechLanguageMode: requestedSpeechLanguage(),
        speechRoutingMode,
        onCreateList: () => {
          if (busy) return;
          void runBatchAction(t(uiLanguage, "batch.newList"), async () => {
            batchView = await batchClient.createList();
            batchStatusMessage = t(uiLanguage, "batch.newList");
            await refreshBatchJobs();
          });
        },
        onCancel: () => {
          const current = batchView;
          if (!current) return;
          if (activeBatchPrepare?.ownerJobId === current.job.batchJobId) {
            suppressedBatchPrepareJobIds.add(current.job.batchJobId);
            batchPrepareGeneration += 1;
            activeBatchPrepare = undefined;
            batchPreparing = false;
          }
          void batchClient
            .cancel(current.job.batchJobId)
            .then((next) => {
              if (next) batchView = next;
              renderSnapshot();
            })
            .catch(() => {
              batchErrorMessage = t(uiLanguage, "batch.stopFailed");
              renderSnapshot();
            });
        },

        onExport: (format, batchItemIds, options) => {
          void runBatchAction(t(uiLanguage, "batch.exported"), () =>
            exportBatch(format, batchItemIds, options),
          );
        },
        onIncludeAllPagesChange: (value) => {
          batchIncludeAllPages = value;
          renderSnapshot();
        },
        onInputChange: (value) => {
          batchInput = value;
          renderSnapshot();
        },
        onRefetchTrack: (batchItemId, trackId) => {
          const current = batchView;
          if (!current) return;
          void batchClient
            .refetchTrack(current.job.batchJobId, batchItemId, trackId)
            .then((next) => {
              if (next) batchView = next;
              batchStatusMessage = t(uiLanguage, "batch.trackUpdated");
              renderSnapshot();
            })
            .catch((error: unknown) => {
              batchErrorMessage =
                error instanceof ChromeBatchRuntimeError
                  ? error.message
                  : t(uiLanguage, "batch.trackUpdateFailed");
              renderSnapshot();
            });
        },
        onItemSpeechLanguageChange: (batchItemId, speechLanguageMode) => {
          const current = batchView;
          if (!current) return;
          void batchClient
            .setItemSpeechLanguage(
              current.job.batchJobId,
              batchItemId,
              speechLanguageMode,
            )
            .then((next) => {
              if (next) batchView = next;
              batchStatusMessage = t(uiLanguage, "batch.speechLanguageSaved");
              renderSnapshot();
            })
            .catch((error: unknown) => {
              batchErrorMessage =
                error instanceof ChromeBatchRuntimeError
                  ? error.message
                  : t(uiLanguage, "batch.trackUpdateFailed");
              renderSnapshot();
            });
        },
        onSpeechRoutingModeChange: (value) => {
          speechRoutingMode = value;
          void persistUiPreferences().catch((error: unknown) => {
            message = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
          });
          renderSnapshot();
        },
        onClearItem: (batchItemId) => {
          const current = batchView;
          if (!current) return;
          void batchClient
            .clearSubtitles(current.job.batchJobId, [batchItemId])
            .then((next) => {
              if (next) batchView = next;
              batchStatusMessage = t(uiLanguage, "batch.clearedItem");
              renderSnapshot();
            })
            .catch((error: unknown) => {
              batchErrorMessage =
                error instanceof ChromeBatchRuntimeError
                  ? error.message
                  : t(uiLanguage, "batch.clearFailed");
              renderSnapshot();
            });
        },
        onDeleteItems: (batchItemIds) => {
          const current = batchView;
          if (!current) return;
          void batchClient
            .deleteItems(current.job.batchJobId, batchItemIds)
            .then((next) => {
              if (next) batchView = next;
              batchStatusMessage = t(uiLanguage, "batch.deletedItems");
              renderSnapshot();
            })
            .catch((error: unknown) => {
              batchErrorMessage =
                error instanceof ChromeBatchRuntimeError
                  ? error.message
                  : t(uiLanguage, "batch.deleteItemsFailed");
              renderSnapshot();
            });
        },
        onLanguagePreferenceChange: (value) => {
          batchLanguagePreference = value;
          renderSnapshot();
        },
        onSpeechLanguageChange: (speechScope, batchItemIds) => {
          const current = batchView;
          if (!current) return;
          // "item"（按对应视频项设置）：不写入条目，保留各自操作列设置。
          if (speechScope === "item") return;
          void Promise.all(
            batchItemIds.map((batchItemId) =>
              batchClient.setItemSpeechLanguage(
                current.job.batchJobId,
                batchItemId,
                speechScope,
              ),
            ),
          )
            .then((nexts) => {
              const latest = nexts.find((next) => next !== null);
              if (latest) batchView = latest;
              batchStatusMessage = t(uiLanguage, "batch.speechLanguageSaved");
              renderSnapshot();
            })
            .catch(() => {
              batchErrorMessage = t(uiLanguage, "batch.speechLanguageFailed");
              renderSnapshot();
            });
        },
        onPrepare: () => {
          if (busy || !batchView) return;
          const targetBatchJobId = batchView.job.batchJobId;
          suppressedBatchPrepareJobIds.delete(targetBatchJobId);
          const generation = ++batchPrepareGeneration;
          const operationId = `append-${generation}-${globalThis.crypto.randomUUID()}`;
          activeBatchPrepare = createAppendBatchPrepareOwner(
            generation,
            targetBatchJobId,
            operationId,
          );
          batchPreparing = true;
          void runBatchAction(
            t(uiLanguage, "batch.prepared"),
            async () => {
              batchStatusMessage = t(uiLanguage, "batch.readingSource");
              renderSnapshot();
              const preparedView = await batchClient.prepare({
                batchJobId: targetBatchJobId,
                includeAllPages: batchIncludeAllPages,
                input: batchInput,
                method: "direct",
                operationId,
                sourceKind: batchSourceKind,
                speechLanguageMode: requestedSpeechLanguage(),
              });
              const activePrepare = activeBatchPrepare;
              if (!activePrepare || activePrepare.generation !== generation)
                return;
              if (activePrepare.ownerJobId !== preparedView.job.batchJobId) {
                return;
              }
              batchView = preparedView;
              await refreshBatchJobs();
            },
            // prepare 保持等待：104 个分 P 解析可能超过 10s，不做有界超时。
            { noTimeout: true },
          ).then((succeeded) => {
            if (activeBatchPrepare?.generation !== generation) return;
            activeBatchPrepare = undefined;
            batchPreparing = false;
            if (succeeded && batchView) {
              batchStatusMessage = t(uiLanguage, "batch.appendDone", {
                added: batchView.addedCount ?? 0,
                duplicate: batchView.duplicateCount ?? 0,
              });
            }
            renderSnapshot();
          });
        },
        onSelectionChange: (selectedItemIds) => {
          const current = batchView;
          if (!current) return Promise.resolve();
          return batchClient
            .setSelection(current.job.batchJobId, selectedItemIds)
            .then((next) => {
              if (next) batchView = next;
              renderSnapshot();
            })
            .catch(() => {
              batchErrorMessage = t(uiLanguage, "batch.selectionUpdateFailed");
              renderSnapshot();
            });
        },
        onSourceKindChange: (value) => {
          batchSourceKind = value;
          renderSnapshot();
        },
        onStart: startBatch,
        onFetchByCurrentPage: () => {
          if (!batchView) return false;
          return runBatchAction(
            t(uiLanguage, "batch.pageSyncedAsSource"),
            async () => {
              // v16 D6：等待页面 URL 稳定（长地址→裸 BV→/?p=22）后再解析，
              // 非视频页解析失败显示「未检测到当前页为可用视频页面」。
              const synced = await syncStableCurrentPage(currentPageSync);
              const targetBatchJobId = batchView?.job.batchJobId;
              if (!targetBatchJobId) return;
              suppressedBatchPrepareJobIds.delete(targetBatchJobId);
              const generation = ++batchPrepareGeneration;
              const operationId = `sync-${generation}-${globalThis.crypto.randomUUID()}`;
              activeBatchPrepare = createAppendBatchPrepareOwner(
                generation,
                targetBatchJobId,
                operationId,
              );
              batchPreparing = true;
              try {
                const preparedView = await batchClient.prepare({
                  batchJobId: targetBatchJobId,
                  includeAllPages: false,
                  operationId,
                  input: synced.video.canonicalUrl,
                  method: "direct",
                  // 修复:按当前页面获取时交给 parseBatchSource 自动识别来源——
                  // 分 P 地址(?p=6)展开整个选集,裸 BV(第 1P)保持单视频。
                  // 此前硬编码 single-video 会把分 P 地址强制成单分 P。
                  sourceKind: "auto",
                  speechLanguageMode: requestedSpeechLanguage(),
                });
                const activePrepare = activeBatchPrepare;
                if (
                  !activePrepare ||
                  activePrepare.generation !== generation ||
                  activePrepare.ownerJobId !== preparedView.job.batchJobId
                ) {
                  return;
                }
                batchView = preparedView;
                batchStatusMessage = t(uiLanguage, "batch.appendDone", {
                  added: preparedView.addedCount ?? 0,
                  duplicate: preparedView.duplicateCount ?? 0,
                });
                await refreshBatchJobs();
              } finally {
                if (activeBatchPrepare?.generation === generation) {
                  activeBatchPrepare = undefined;
                  batchPreparing = false;
                }
              }
            },
            { errorText: t(uiLanguage, "batch.pageNotVideo") },
          );
        },
        listSelectionActive: batchListSelectionActive,
        preparing: batchPreparing,
        sourceKind: batchSourceKind,
        statusMessage: batchStatusMessage,
        view: batchView,
      };

      const batchDrawer: BatchDrawerProps = {
        activeListId: batchView?.job.batchJobId ?? null,
        busy,
        message: batchStatusMessage
          ? { kind: "status", text: batchStatusMessage }
          : undefined,
        lists: batchJobs.map(({ job, pinned }) => ({
          createdAtLabel: formatTimestamp(job.createdAt),
          id: job.batchJobId,
          label:
            job.name ?? job.sourceLabel ?? t(uiLanguage, "batch.jobsTitle"),
          pinned,
          running: job.status === "running" || job.status === "preparing",
          status: job.status,
        })),
        pinnedListIds: batchJobs
          .filter(({ pinned }) => pinned)
          .map(({ job }) => job.batchJobId),
        uiLanguage,
        onArchive: (batchJobId) => {
          void runBatchAction(t(uiLanguage, "batch.listArchived"), async () => {
            await batchClient.archiveList(batchJobId);
            if (batchView?.job.batchJobId === batchJobId) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            // 侧边栏操作也必须刷新归档/回收站面板数据，
            // 否则当前打开的批量归档区/回收站不会更新。
            await refreshBatchArchive();
          });
        },
        onArchiveMany: (batchJobIds) => {
          void runBatchAction(t(uiLanguage, "batch.listArchived"), async () => {
            for (const batchJobId of batchJobIds) {
              await batchClient.archiveList(batchJobId);
            }
            if (
              batchView !== undefined &&
              batchJobIds.includes(batchView.job.batchJobId)
            ) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            // 同 onArchive：批量归档区面板同步刷新。
            await refreshBatchArchive();
          });
        },
        onDelete: (batchJobId) => {
          void runBatchAction(t(uiLanguage, "batch.listTrashed"), async () => {
            await batchClient.trashList(batchJobId);
            if (batchView?.job.batchJobId === batchJobId) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            // 同 onArchive：批量回收站面板同步刷新。
            await refreshBatchArchive();
          });
        },
        onDeleteMany: (batchJobIds) => {
          void runBatchAction(t(uiLanguage, "batch.listTrashed"), async () => {
            for (const batchJobId of batchJobIds) {
              await batchClient.trashList(batchJobId);
            }
            if (
              batchView !== undefined &&
              batchJobIds.includes(batchView.job.batchJobId)
            ) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            // 同 onArchive：批量回收站面板同步刷新。
            await refreshBatchArchive();
          });
        },
        onCreateList: () => {
          if (busy) return false;
          return runBatchAction(t(uiLanguage, "batch.newList"), async () => {
            batchView = await batchClient.createList();
            batchStatusMessage = t(uiLanguage, "batch.newList");
            await refreshBatchJobs();
          });
        },
        onListSelectionActiveChange: (active) => {
          if (batchListSelectionActive === active) return;
          batchListSelectionActive = active;
          if (active) {
            const current = batchView;
            if (current && current.items.some((item) => item.selected)) {
              void batchClient
                .setSelection(current.job.batchJobId, [])
                .then((next) => {
                  if (next) batchView = next;
                  renderSnapshot();
                })
                .catch(() => undefined);
            }
          }
          renderSnapshot();
        },
        onRename: (batchJobId, name) => {
          void runBatchAction(t(uiLanguage, "batch.listRenamed"), async () => {
            batchView =
              (await batchClient.renameList(batchJobId, name)) ?? undefined;
            await refreshBatchJobs();
          });
        },
        onSelect: (batchJobId) => {
          const previousBatchJobId = batchView?.job.batchJobId ?? null;
          void runBatchAction(undefined, async () => {
            batchView =
              (await selectBatchJobAfterClearingPrevious(
                batchClient,
                previousBatchJobId,
                batchJobId,
              )) ?? undefined;
          });
        },
        onTogglePinned: (batchJobId, pinned) => {
          void runBatchAction(t(uiLanguage, "batch.listPinned"), async () => {
            batchView =
              (await batchClient.setPinned(batchJobId, pinned)) ?? undefined;
            await refreshBatchJobs();
          });
        },
      };

      const artifactScope = currentArtifactScope();
      const buildInsight = (
        kind: ArtifactKind,
      ): InsightWorkspaceProps | undefined => {
        if (!restoredWorkspace) {
          return {
            availability: "no-video",
            content: "",
            hasSubtitle: false,
            instruction: "",
            kind,
            onClear: () => undefined,
            onExport: () => undefined,
            onGenerate: () => undefined,
            onInstructionChange: () => undefined,
            onStop: () => undefined,
            phase: "idle",
            segments: [],
            uiLanguage,
          };
        }
        const artifact = artifactByKind.get(kind);
        const run = artifactRunByKind.get(kind);
        // 启动窗口（点击后 SW 尚未返回 run）也视为 running，立即给出反馈。
        const startPending = artifactStartPendingKinds.has(kind);
        const running =
          startPending ||
          (run !== undefined &&
            (run.status === "queued" ||
              run.status === "running" ||
              run.status === "preparing" ||
              run.status === "requesting" ||
              run.status === "streaming" ||
              run.status === "validating" ||
              run.status === "saving"));
        const generationStatus: InsightWorkspaceProps["generationStatus"] =
          startPending
            ? "preparing"
            : run?.status === "preparing" || run?.status === "queued"
              ? "preparing"
              : run?.status === "requesting" || run?.status === "running"
                ? "requesting"
                : run?.status === "streaming"
                  ? "streaming"
                  : run?.status === "validating"
                    ? "validating"
                    : run?.status === "saving"
                      ? "saving"
                      : run?.status === "interrupted"
                        ? "interrupted"
                        : run?.status === "failed"
                          ? "failed"
                          : run?.status === "cancelled" ||
                              run?.status === "stopped"
                            ? "cancelled"
                            : undefined;
        const phase: InsightWorkspaceProps["phase"] = running
          ? "running"
          : artifact?.status === "ready"
            ? "ready"
            : artifact?.status === "failed"
              ? "failed"
              : "idle";
        const artifactFailure =
          artifact?.status === "failed" ||
          generationStatus === "interrupted" ||
          generationStatus === "cancelled"
            ? generationFailureFor({
                errorCode: artifact?.errorCode ?? run?.errorCode ?? null,
                hasPartialOutput:
                  (artifactPartialByKind.get(kind)?.length ?? 0) > 0,
                hasPreviousArtifact:
                  (artifact?.content.length ?? 0) > 0 ||
                  (artifact?.segments.length ?? 0) > 0,
                kind,
                status: run?.status,
              })
            : null;
        const startGeneration = (): void => {
          void guardReadOnly(async () => {
            const generation = selectedGeneration(kind);
            const scope = currentArtifactScope();
            if (!generation || !scope) {
              message = {
                kind: "error",
                text:
                  scope === null
                    ? t(uiLanguage, "chat.noActiveSubtitleForGenerate")
                    : t(uiLanguage, "chat.cannotStartGeneration"),
              };
              renderSnapshot();
              return;
            }
            artifactErrorByKind.delete(kind);
            artifactReasoningByKind.delete(kind);
            artifactPartialByKind.set(kind, "");
            artifactProgressByKind.set(kind, {
              completedChunks: 0,
              stage: "planning",
              totalChunks: 1,
            });
            // 立即标记「启动中」并刷新：点击按钮后马上出现「生成中」反馈，
            // 不等到 SW 返回初始 run（冷启动/设置读取可能延迟数百毫秒以上）。
            artifactStartPendingKinds.add(kind);
            renderSnapshot();
            void artifactClient
              .generate({
                generation,
                kind,
                scope,
                userInstruction:
                  kind === "summary"
                    ? (artifactInstructionByKind.get(kind) ?? "")
                    : "",
                userPrompt: kind === "summary" ? controlPromptFor(kind) : "",
              })
              .then((result) => {
                artifactStartPendingKinds.delete(kind);
                artifactByKind.set(kind, result.artifact);
                artifactRunByKind.set(kind, result.run);
                renderSnapshot();
                // 任务启动后刷新工作区投影，使抽屉 running 指标/任务提示立即可用。
                void refreshProductProjection()
                  .then(() => renderSnapshot())
                  .catch(() => undefined);
              })
              .catch((error: unknown) => {
                artifactStartPendingKinds.delete(kind);
                artifactProgressByKind.delete(kind);
                artifactErrorByKind.set(
                  kind,
                  error instanceof AiProviderError
                    ? artifactFailureMessage(error.code, kind, uiLanguage)
                    : t(uiLanguage, "chat.generationStartFailed"),
                );
                renderSnapshot();
              });
          });
        };
        const displayedContent =
          running || artifactFailure?.preservePartial
            ? (artifactPartialByKind.get(kind) ?? "")
            : (artifact?.content ?? "");
        const displayedReasoning = artifactReasoningByKind.get(kind)?.text;
        return {
          busy,
          uiLanguage,
          content: displayedContent,
          onTaskModelChange: (next) => saveTaskModelSelection(kind, next),
          taskContextError: taskModelSaveErrorByKind.get(kind),
          taskContextPending: taskModelSavePendingKinds.has(kind),
          taskModelProfiles: taskModelProfileOptions(),
          taskModelSelection: projectTaskChoice(kind),
          outputLanguage: taskOutputLanguages[kind],
          onOutputLanguageChange: (language) => {
            taskOutputLanguages = Object.freeze({
              ...taskOutputLanguages,
              [kind]: language,
            });
            renderSnapshot();
            return persistUiPreferences();
          },
          errorMessage:
            artifactFailure === null
              ? artifactErrorByKind.get(kind)
              : undefined,
          failure: artifactFailure ?? undefined,
          generationStatus,
          hasSubtitle: artifactScope !== null,
          incomplete:
            artifactFailure?.incomplete ??
            (generationStatus === "interrupted" ||
              generationStatus === "failed" ||
              generationStatus === "cancelled"),
          instruction: artifactInstructionByKind.get(kind) ?? "",
          kind,
          modelLabel:
            discoveredModels.find(
              (model) => model.modelId === artifact?.modelId,
            )?.displayName ??
            artifact?.modelId ??
            undefined,
          onClear: () => {
            const target = artifactByKind.get(kind);
            if (!target) return;
            void artifactClient
              .clear({ artifactId: target.artifactId })
              .then((cleared) => {
                if (cleared) artifactByKind.set(kind, cleared);
                artifactRunByKind.delete(kind);
                artifactProgressByKind.delete(kind);
                artifactPartialByKind.delete(kind);
                artifactErrorByKind.delete(kind);
                artifactReasoningByKind.delete(kind);
                renderSnapshot();
              })
              .catch(() => {
                artifactErrorByKind.set(
                  kind,
                  t(uiLanguage, "chat.clearFailed"),
                );
                renderSnapshot();
              });
          },
          onExport: () => {
            const target = artifactByKind.get(kind);
            if (!target) return;
            downloadMarkdown(
              `${restoredWorkspace.session.title}-${
                kind === "segments" ? "分段" : "总结"
              }`,
              artifactMarkdown(target, restoredWorkspace.session.title),
            );
          },
          onGenerate: startGeneration,
          onCopyContent:
            kind === "summary" && displayedContent.trim().length > 0
              ? () => {
                  void navigator.clipboard.writeText(displayedContent);
                }
              : undefined,
          onCopyReasoning:
            kind === "summary" && displayedReasoning?.trim()
              ? () => {
                  void navigator.clipboard.writeText(displayedReasoning.trim());
                }
              : undefined,
          onInstructionChange: (value) => {
            artifactInstructionByKind.set(kind, value);
            renderSnapshot();
          },
          onLoadRemoteImage: remoteMarkdownImageClient.load,
          onManageSummaryPresets:
            kind === "summary"
              ? () => {
                  promptManagerKind = "summary";
                  renderSnapshot();
                }
              : undefined,
          summaryPromptPresetOptions:
            kind === "summary"
              ? promptPresetState.presets
                  .filter((preset) => preset.kind === "summary")
                  .map((preset) => ({
                    id: preset.id,
                    name: displayPresetName(preset, uiLanguage),
                  }))
              : undefined,
          selectedSummaryPromptPresetId:
            kind === "summary" ? selectedPromptPresetIds.summary : undefined,
          onSelectSummaryPromptPreset:
            kind === "summary"
              ? (presetId) => selectPromptPreset("summary", presetId)
              : undefined,
          onSeek: subtitle ? navigateVideoTime : undefined,
          onStop: () => {
            const target = artifactRunByKind.get(kind);
            if (!target) return;
            void artifactClient
              .stop(target)
              .then((stopped) => {
                if (stopped) artifactByKind.set(kind, stopped);
                artifactRunByKind.delete(kind);
                artifactProgressByKind.delete(kind);
                renderSnapshot();
              })
              .catch(() => {
                artifactErrorByKind.set(kind, t(uiLanguage, "chat.stopFailed"));
                renderSnapshot();
              });
          },
          phase,
          progress: artifactProgressByKind.get(kind),
          reasoning: displayedReasoning,
          segments: artifact?.segments ?? [],
          subtitleRows: subtitle?.rows ?? [],
          timeLinkScope: markdownTimeLinkScope,
          validatedTimeLinks: deriveValidatedTimeMarkers(
            running
              ? (artifactPartialByKind.get(kind) ?? "")
              : (artifact?.content ?? ""),
            subtitle?.rows ?? [],
            markdownTimeLinkScope,
          ),
          updatedAtLabel:
            artifact && artifact.status === "ready"
              ? formatTimestamp(artifact.updatedAt)
              : undefined,
        };
      };

      const chatScope = currentChatScope();
      const chatFailure =
        activeChatRun !== null &&
        (activeChatRun.status === "failed" ||
          activeChatRun.status === "interrupted" ||
          activeChatRun.status === "cancelled" ||
          activeChatRun.status === "stopped")
          ? generationFailureFor({
              errorCode: activeChatRun.errorCode,
              hasPartialOutput: activeChatRun.partialOutput.length > 0,
              hasPreviousArtifact: false,
              kind: "chat",
              status: activeChatRun.status,
            })
          : null;
      const activeChatAssistant = activeChatRun
        ? chatMessages.find(
            (item) =>
              item.role === "assistant" &&
              item.generationRunId === activeChatRun?.runId,
          )
        : undefined;
      const activeChatOwnerStatus: ActiveChatGenerationRun["status"] | null =
        projectActiveChatRunStatus(activeChatRun);
      const activeChatGenerationOwner: ActiveChatGenerationRun | null =
        activeChatRun !== null &&
        activeChatOwnerStatus !== null &&
        activeChatAssistant !== undefined &&
        chatScope !== null &&
        activeChatRun.sessionId === chatScope.sessionId &&
        activeChatRun.targetId === activeChatThreadId
          ? Object.freeze({
              conversationId: activeChatRun.targetId,
              messageId: activeChatAssistant.messageId,
              runId: activeChatRun.runId,
              sessionId: activeChatRun.sessionId,
              status: activeChatOwnerStatus,
              stoppable: true as const,
            })
          : null;
      // 修复(T-B3):chat 无条件构造——无字幕(chatScope=null)时
      // loadChatState 已把线程/消息重置为空,各回调均有 scope 空守卫,
      // ChatWorkspace 依 availability 显示 no-subtitle 空状态卡片;
      // 此前 chat=undefined 会让 shell 回退到「尚未实现」占位。
      const chat: ChatWorkspaceProps = {
        uiLanguage,
        activeGenerationRun: activeChatGenerationOwner,
        activeThreadId: activeChatThreadId,
        attachments: chatAttachments,
        busy,
        controlPromptOptions: promptPresetState.presets
          .filter((preset) => preset.kind === "chat")
          .map((preset) => ({
            id: preset.id,
            name: displayPresetName(preset, uiLanguage),
          })),
        onTaskModelChange: (next) => saveTaskModelSelection("chat", next),
        taskModelProfiles: taskModelProfileOptions(),
        taskModelSelection: projectTaskChoice("chat"),
        taskContextError: taskModelSaveErrorByKind.get("chat"),
        taskContextPending: taskModelSavePendingKinds.has("chat"),
        outputLanguage: taskOutputLanguages.chat,
        outputLanguageLocked: chatMessages.length > 0,
        onOutputLanguageChange: (language) => {
          taskOutputLanguages = Object.freeze({
            ...taskOutputLanguages,
            chat: language,
          });
          renderSnapshot();
          return persistUiPreferences();
        },
        errorMessage: undefined,
        generationStatus:
          activeChatRun?.status === "preparing" ||
          activeChatRun?.status === "queued"
            ? "preparing"
            : activeChatRun?.status === "requesting" ||
                activeChatRun?.status === "running"
              ? "requesting"
              : activeChatRun?.status === "streaming"
                ? "streaming"
                : activeChatRun?.status === "validating"
                  ? "validating"
                  : activeChatRun?.status === "saving"
                    ? "saving"
                    : activeChatRun?.status === "interrupted"
                      ? "interrupted"
                      : activeChatRun?.status === "failed"
                        ? "failed"
                        : activeChatRun?.status === "cancelled" ||
                            activeChatRun?.status === "stopped"
                          ? "cancelled"
                          : undefined,
        incomplete:
          chatFailure?.incomplete ??
          (activeChatRun?.status === "interrupted" ||
            activeChatRun?.status === "failed" ||
            activeChatRun?.status === "cancelled" ||
            activeChatRun?.status === "stopped"),
        messages: projectChatMessages({
          activeRun: activeChatRun,
          messages: chatMessages,
          runsByRunId: chatRunsByRunId,
          transientReasoningByRunId,
        }).map((projection) => ({
          ...projection,
          attachments: chatMessageAttachments.get(projection.id),
        })),
        subtitleRows: subtitle?.rows ?? [],
        timeLinkScope: markdownTimeLinkScope,
        validatedTimeLinks: [],
        onCopyMessage: (messageId) => {
          const item = chatMessages.find(
            (candidate) => candidate.messageId === messageId,
          );
          if (item) void navigator.clipboard.writeText(item.content);
        },
        onAttachImages: (files) => {
          const scope = currentChatScope();
          if (
            !scope ||
            !subtitle ||
            !activeChatThreadId ||
            files.length === 0
          ) {
            return false;
          }
          if (chatImageCapability.state === "unsupported") {
            // 历史失败证据只作为提示，不作为拒绝依据：
            // 失败可能源于请求格式等可修复因素，Provider 是最终裁决。
            message = {
              kind: "status",
              text: t(uiLanguage, "chat.imageLastFailedHint"),
            };
            renderSnapshot();
          }
          const attachmentThreadId = activeChatThreadId;
          return runProductAction(
            t(uiLanguage, "chat.imagesQueued"),
            async () => {
              const attachmentTimeMs = await resolveAttachmentTimeMs();
              const attachmentVideoKey = subtitle.videoKey;
              const available = Math.max(0, 6 - chatAttachments.length);
              const selectedFiles = files.slice(0, available);
              if (selectedFiles.length === 0) {
                throw new StorageError(
                  t(uiLanguage, "chat.maxImagesPerMessage"),
                );
              }
              const staged = await attachmentRepository.stageImages({
                files: selectedFiles,
                owner: {
                  branchId: scope.branchId,
                  chatThreadId: attachmentThreadId,
                  currentTimeMs: attachmentTimeMs,
                  sessionId: scope.sessionId,
                  subtitleContextRevision: scope.contextRevision,
                  subtitleId: scope.subtitleId,
                  videoKey: attachmentVideoKey,
                },
              });
              const stagedBytes = staged.reduce(
                (sum, attachment) => sum + attachment.blob.size,
                0,
              );
              const queuedBytes = chatAttachments.reduce(
                (sum, attachment) => sum + attachment.sizeBytes,
                0,
              );
              if (queuedBytes + stagedBytes > 20 * 1_024 * 1_024) {
                await attachmentRepository.discardDrafts(
                  staged.map((attachment) => attachment.attachmentId),
                );
                throw new StorageError(t(uiLanguage, "chat.maxPendingBytes"));
              }
              const projectedDrafts: (typeof chatAttachments)[number][] = [];
              const nextDraftUrls = new Set<string>();
              try {
                staged.forEach((attachment, index) => {
                  const thumbnailUrl = URL.createObjectURL(
                    attachment.thumbnailBlob,
                  );
                  nextDraftUrls.add(thumbnailUrl);
                  projectedDrafts.push(
                    Object.freeze({
                      attachmentId: attachment.attachmentId,
                      currentTimeMs: attachment.currentTimeMs,
                      name:
                        selectedFiles[index]?.name ||
                        t(uiLanguage, "chat.imageDraft", {
                          count: index + 1,
                        }),
                      sizeBytes: attachment.blob.size,
                      subtitleContextRevision:
                        attachment.subtitleContextRevision,
                      subtitleId: attachment.subtitleId,
                      thumbnailUrl,
                      videoKey: attachment.videoKey,
                    }),
                  );
                });
              } catch (error) {
                for (const url of nextDraftUrls) URL.revokeObjectURL(url);
                await attachmentRepository.discardDrafts(
                  staged.map((attachment) => attachment.attachmentId),
                );
                throw error;
              }
              for (const url of nextDraftUrls) {
                chatDraftAttachmentObjectUrls.add(url);
              }
              chatAttachments = Object.freeze([
                ...chatAttachments,
                ...projectedDrafts,
              ]);
            },
          );
        },
        onClearAttachments: () => {
          revokeChatDraftAttachmentObjectUrls();
          chatAttachments = Object.freeze([]);
          renderSnapshot();
        },
        onCreateThread: () => {
          return runProductAction(
            t(uiLanguage, "chat.threadCreated"),
            async () => {
              const scope = currentChatScope();
              if (!scope) throw new Error("No active chat owner");
              const thread = await chatClient.createThread(scope, null);
              await loadChatState(thread.chatThreadId);
            },
          );
        },
        onDeleteThread: async (threadId) => {
          const confirmed = await confirmDialog({
            confirmLabel: t(uiLanguage, "dialog.deleteThread"),
            danger: true,
            description: t(uiLanguage, "dialog.deleteThreadBody"),
            title: t(uiLanguage, "dialog.deleteThreadTitle"),
          });
          if (!confirmed) return false;
          return runProductAction(
            t(uiLanguage, "chat.threadDeleted"),
            async () => {
              const scope = currentChatScope();
              if (!scope) throw new Error("No active chat owner");
              await chatClient.deleteThread(scope, threadId);
              await loadChatState(null);
            },
          );
        },
        onExportThread: (threadId) => {
          const thread = chatThreads.find(
            (candidate) => candidate.chatThreadId === threadId,
          );
          downloadChatThread(
            thread?.title ?? t(uiLanguage, "chat.exportFilename"),
            chatMessages,
          );
        },
        onLoadRemoteImage: remoteMarkdownImageClient.load,
        onManageControlPrompts: () => {
          promptManagerKind = "chat";
          renderSnapshot();
        },
        onRenameThread: async (threadId) => {
          const current = chatThreads.find(
            (candidate) => candidate.chatThreadId === threadId,
          );
          const title = await askDialog({
            confirmLabel: t(uiLanguage, "drawer.saveName"),
            defaultValue: current?.title ?? "",
            inputLabel: t(uiLanguage, "dialog.threadName"),
            title: t(uiLanguage, "dialog.renameThreadTitle"),
          });
          if (title === null) return false;
          return runProductAction(
            t(uiLanguage, "chat.threadNameSaved"),
            async () => {
              const scope = currentChatScope();
              if (!scope) throw new Error("No active chat owner");
              await chatClient.renameThread(scope, threadId, title || null);
              await loadChatState(threadId);
            },
          );
        },
        onRemoveAttachment: (attachmentId) => {
          return runProductAction(
            t(uiLanguage, "chat.imageRemoved"),
            async () => {
              const removed = chatAttachments.filter(
                (attachment) => attachment.attachmentId === attachmentId,
              );
              await attachmentRepository.discardDrafts([attachmentId]);
              revokeChatDraftAttachmentObjectUrls(removed);
              chatAttachments = Object.freeze(
                chatAttachments.filter(
                  (attachment) => attachment.attachmentId !== attachmentId,
                ),
              );
            },
          );
        },
        onSelectControlPrompt: (presetId) =>
          selectPromptPreset("chat", presetId),
        onRequestMessageMutation: async (intent) => {
          if (
            intent.requiresConfirmation &&
            !(await confirmDialog({
              confirmLabel: t(uiLanguage, "dialog.regenerateConfirm"),
              danger: true,
              description: t(uiLanguage, "dialog.regenerateBody", {
                count: intent.deletedTurnCount,
              }),
              title: t(uiLanguage, "dialog.regenerateTitle"),
            }))
          ) {
            return false;
          }
          const generation = selectedGeneration();
          const scope = currentChatScope();
          if (!generation || !scope || !activeChatThreadId) return false;
          return runProductAction(
            t(uiLanguage, "chat.regenerateStarted"),
            async () => {
              const result =
                intent.kind === "regenerate"
                  ? await chatClient.regenerate({
                      generation,
                      scope,
                      targetMessageId: intent.messageId,
                      threadId: activeChatThreadId!,
                    })
                  : await chatClient.editAndResend({
                      content: intent.content ?? "",
                      generation,
                      scope,
                      targetMessageId: intent.messageId,
                      threadId: activeChatThreadId!,
                    });
              activeChatRun = result.run;
              await loadChatState(activeChatThreadId);
            },
          );
        },
        onRetryMessage: (messageId) => {
          const generation = selectedGeneration();
          const scope = currentChatScope();
          if (!generation || !scope || !activeChatThreadId) return false;
          return runProductAction(t(uiLanguage, "chat.retried"), async () => {
            const result = await chatClient.retry({
              generation,
              scope,
              targetMessageId: messageId,
              threadId: activeChatThreadId!,
            });
            activeChatRun = result.run;
            await loadChatState(activeChatThreadId);
          });
        },
        onSelectThread: (threadId) => {
          return runProductAction(
            t(uiLanguage, "chat.threadSwitched"),
            async () => {
              await loadChatState(threadId);
            },
          );
        },
        onSeek: subtitle ? navigateVideoTime : undefined,
        onSeekAttachment: subtitle
          ? (attachment) => {
              const owner = currentVideoTimeNavigationOwner();
              if (
                owner === null ||
                owner.videoKey !== attachment.videoKey ||
                owner.subtitleId !== attachment.subtitleId ||
                owner.revision !== attachment.subtitleContextRevision
              ) {
                message = {
                  kind: "error",
                  text: t(uiLanguage, "chat.imageTimeNotInContext"),
                };
                renderSnapshot();
                return;
              }
              navigateVideoTime(attachment.currentTimeMs / 1_000);
            }
          : undefined,
        onSend: (threadId, content, attachmentIds) => {
          return guardReadOnly(async () => {
            const generation = selectedGeneration();
            const scope = currentChatScope();
            if (!generation || !scope) return false;
            if (
              attachmentIds !== undefined &&
              attachmentIds.length > 0 &&
              chatImageCapability.state === "unsupported"
            ) {
              // 历史失败证据只提示不阻止：Provider 是最终裁决，
              // 失败可能源于请求格式等可修复因素。
              message = {
                kind: "status",
                text: t(uiLanguage, "chat.imageProtocolRetry"),
              };
              renderSnapshot();
            }
            // 能力 unknown：按协议尝试发送——能力表未声明视觉能力
            // （如 deepseek-v4 系列）不作为拒绝依据，由 Provider 决定；
            // 这里临时修正 descriptor 以通过 SW 侧的能力校验。
            const attemptGeneration =
              attachmentIds !== undefined &&
              attachmentIds.length > 0 &&
              (chatImageCapability.state === "unknown" ||
                chatImageCapability.state === "unsupported")
                ? Object.freeze({
                    ...generation,
                    model: Object.freeze({
                      ...generation.model,
                      capabilities: Object.freeze({
                        ...generation.model.capabilities,
                        supportsAttachments: true,
                      }),
                    }),
                  })
                : generation;
            return runProductAction(t(uiLanguage, "chat.sent"), async () => {
              const result = await chatClient.send({
                ...(attachmentIds && attachmentIds.length > 0
                  ? { attachmentIds }
                  : {}),
                content,
                generation: attemptGeneration,
                scope,
                temporaryControlPrompt: controlPromptFor("chat"),
                threadId,
              });
              // send 响应携带初始 queued run；若事件流已送达更新的 run，
              // 不能回退覆盖（否则终态被陈旧状态替换导致转圈）。
              const existingRun =
                result.run === null
                  ? null
                  : chatRunsByRunId.get(result.run.runId);
              if (
                result.run !== null &&
                (existingRun === undefined ||
                  existingRun === null ||
                  existingRun.updatedAt < result.run.updatedAt)
              ) {
                activeChatRun = result.run;
                chatRunsByRunId.set(result.run.runId, result.run);
                startChatRunReconciler(result.run.runId);
              }
              // 订阅事件可能先于 send 响应到达（streaming 空壳消息）；
              // 手动追加前先移除同 messageId 的旧条目再追加到末尾，
              // 保证顺序始终是 […, 用户消息, 助手消息] 且不产生重复气泡。
              chatMessages = Object.freeze([
                ...chatMessages.filter(
                  (message) =>
                    message.messageId !== result.user.messageId &&
                    message.messageId !== result.assistant.messageId,
                ),
                result.user,
                result.assistant,
              ]);
              await loadChatMessageAttachments(threadId, chatMessages);
            });
          });
        },
        selectedControlPromptId: selectedPromptPresetIds.chat,
        onStop: (owner) => {
          const run = activeChatRun;
          if (
            run === null ||
            activeChatGenerationOwner === null ||
            owner.runId !== activeChatGenerationOwner.runId ||
            owner.sessionId !== activeChatGenerationOwner.sessionId ||
            owner.conversationId !== activeChatGenerationOwner.conversationId ||
            owner.messageId !== activeChatGenerationOwner.messageId
          ) {
            return false;
          }
          return runProductAction(
            t(uiLanguage, "chat.generationStopped"),
            async () => {
              const stopped = await chatClient.stop(run);
              if (stopped === null) {
                throw new StorageError(t(uiLanguage, "chat.stopUnconfirmed"));
              }
              await loadChatState(activeChatThreadId);
            },
          );
        },
        threads: chatThreads.map((thread, index) => ({
          id: thread.chatThreadId,
          title:
            thread.title ??
            t(uiLanguage, "chat.newThreadTitle", { count: index + 1 }),
        })),
        imageCapability: chatImageCapability.state,
      };

      const archiveTagRecords = workspaceProjection.archive.sessionTags ?? [];
      const archiveTags = workspaceProjection.archive.tags ?? [];
      const archiveTagCounts =
        workspaceProjection.archive.tagCounts ?? new Map<string, number>();
      const archiveSessionViews: ArchiveSessionProjectionView[] =
        workspaceProjection.archive.sessions.map((session) => {
          const tagRecord = archiveTagRecords.find(
            (record) => record.sessionId === session.sessionId,
          );
          return Object.freeze({
            archivedAtLabel: formatShortTimestamp(session.archivedAt),
            branchIds: Object.freeze(
              session.branches.map((branch) => branch.branchId),
            ),
            id: session.sessionId,
            kind: "session" as const,
            statusDetailLabel:
              session.branches.length === 0
                ? null
                : session.branches[0].source === "bilibili"
                  ? officialSubtitleDetailLabel(
                      session.branches[0].trackOrigin,
                      uiLanguage,
                    )
                  : null,
            statusLabel:
              session.branches.length === 0
                ? noSubtitleStatusLabel(uiLanguage)
                : subtitleStatusLabel({
                    languageMode: session.branches[0].requestedLanguageMode,
                    source: session.branches[0].source,
                    trackOrigin: session.branches[0].trackOrigin,
                    lang: uiLanguage,
                  }),
            tagIds: Object.freeze(tagRecord?.tagIds ?? []),
            title: session.title,
          });
        });
      const archiveTagViews = archiveTags.map((tag) => ({
        count: archiveTagCounts.get(tag.tagId) ?? 0,
        name: tag.name,
        tagId: tag.tagId,
      }));
      const archiveTagCount = archiveTags.length;
      const archive: ArchiveWorkspaceProps = {
        busy,
        uiLanguage,
        onCreateTag: (name) => {
          const normalized = name.trim();
          if (!normalized) return false;
          return runProductAction("标签已创建", async () => {
            await tagRepository.createTag(normalized);
          });
        },
        onDeleteTag: (tagId) => {
          return runProductAction("标签已删除", async () => {
            await tagRepository.deleteTag(tagId);
          });
        },
        onMoveTag: (tagId, beforeTagId) => {
          return runProductAction("标签顺序已保存", async () => {
            await tagRepository.moveTag(tagId, beforeTagId);
          });
        },
        onRenameTag: (tagId, name) => {
          const normalized = name.trim();
          if (!normalized) return false;
          return runProductAction("标签名已保存", async () => {
            await tagRepository.renameTag(tagId, normalized);
          });
        },
        onDeleteSessionProjection: (branchIds, sessionId) => {
          return runProductAction("归档会话已移入回收站", async () => {
            if (branchIds.length === 0 && sessionId !== undefined) {
              await trashRepository.moveArchivedEmptySessionToTrash(
                sessionId,
                "archive-session",
              );
            } else {
              await trashRepository.moveToTrash(branchIds, "archive-session");
            }
          });
        },
        onOpenSession: (sessionId) => {
          return runAction(t(uiLanguage, "toast.sessionOpened"), () =>
            sessionCoordinator.select(sessionId).then((nextSnapshot) => {
              readOnlySessionId = sessionId;
              surface = "workspace";
              return nextSnapshot;
            }),
          );
        },
        onRenameSession: (sessionId, title) => {
          const normalized = title.trim();
          if (!normalized) return false;
          return runProductAction(
            t(uiLanguage, "toast.sessionNameSaved"),
            async () => {
              await sessionRepository.rename(sessionId, normalized);
              await sessionCoordinator.initialize();
            },
          );
        },
        onRestoreToWorkspace: (branchIds, sessionId) => {
          return runAction("会话已恢复至工作区", async () => {
            if (branchIds.length === 0 && sessionId !== undefined) {
              await archiveRepository.restoreEmptyArchivedSessionToWorkspace(
                sessionId,
              );
            } else {
              await archiveRepository.restoreArchivedBranchesToWorkspace(
                branchIds,
              );
            }
            selectedArchiveBranchIds = Object.freeze([]);
            const snapshot = await sessionCoordinator.initialize();
            // 恢复后自动打开恢复的会话（保留当前归档界面，不切换视图）。
            const restoredSessionId =
              sessionId ??
              (branchIds.length > 0
                ? (workspaceProjection.archive.sessions.find((session) =>
                    session.branches.some((branch) =>
                      branchIds.includes(branch.branchId),
                    ),
                  )?.sessionId ?? null)
                : null);
            if (restoredSessionId !== null) {
              return sessionCoordinator.select(restoredSessionId);
            }
            return snapshot;
          });
        },
        // 组合方法：多选可能混合「有分支会话」与「空会话（无分支）」。
        // 单个 runProductAction 内串行处理全部（busy 锁只放行第一个 action，
        // 并行多次调用会失败），空会话不再被静默跳过。
        onDeleteSessionProjectionMany: (branchIds, emptySessionIds) => {
          return runProductAction("归档会话已移入回收站", async () => {
            if (branchIds.length > 0) {
              await trashRepository.moveToTrash(branchIds, "archive-session");
            }
            for (const sessionId of emptySessionIds) {
              await trashRepository.moveArchivedEmptySessionToTrash(
                sessionId,
                "archive-session",
              );
            }
          });
        },
        onRestoreToWorkspaceMany: (branchIds, emptySessionIds) => {
          return runAction("会话已恢复至工作区", async () => {
            if (branchIds.length > 0) {
              await archiveRepository.restoreArchivedBranchesToWorkspace(
                branchIds,
              );
            }
            for (const sessionId of emptySessionIds) {
              await archiveRepository.restoreEmptyArchivedSessionToWorkspace(
                sessionId,
              );
            }
            selectedArchiveBranchIds = Object.freeze([]);
            const snapshot = await sessionCoordinator.initialize();
            // 恢复后自动打开恢复的会话（保留当前归档界面，不切换视图）。
            const restoredSessionId =
              emptySessionIds[0] ??
              (branchIds.length > 0
                ? (workspaceProjection.archive.sessions.find((session) =>
                    session.branches.some((branch) =>
                      branchIds.includes(branch.branchId),
                    ),
                  )?.sessionId ?? null)
                : null);
            if (restoredSessionId !== null) {
              return sessionCoordinator.select(restoredSessionId);
            }
            return snapshot;
          });
        },
        onSelectedBranchIdsChange: (branchIds) => {
          selectedArchiveBranchIds = Object.freeze([...branchIds]);
          renderSnapshot();
        },
        onSetSessionTags: (sessionId, tagIds) => {
          return runProductAction("会话标签已保存", async () => {
            await tagRepository.setSessionTags(sessionId, tagIds);
          });
        },
        selectedBranchIds: selectedArchiveBranchIds,
        sessions: archiveSessionViews,
        tagCount: archiveTagCount,
        tags: archiveTagViews,
      };

      const restoreTrashItems = async (
        items: readonly TrashRestoreIntent[],
      ): Promise<SessionWorkspaceSnapshot> => {
        const { branchIds, emptySessionIds } =
          resolveTrashRestoreIntents(items);
        if (branchIds.length > 0) {
          await trashRepository.restoreToWorkspace(branchIds);
        }
        if (emptySessionIds.length > 0) {
          await trashRepository.restoreEmptySessionsToWorkspace(
            emptySessionIds,
          );
        }
        const snapshot = await sessionCoordinator.initialize();
        // 恢复后自动打开恢复的会话（保留当前回收站界面，不切换视图）。
        const restoredSessionId =
          emptySessionIds[0] ??
          (branchIds.length > 0
            ? (workspaceProjection.trash.sessions.find((session) =>
                session.branches.some((branch) =>
                  branchIds.includes(branch.branchId),
                ),
              )?.sessionId ?? null)
            : null);
        if (restoredSessionId !== null) {
          return sessionCoordinator.select(restoredSessionId);
        }
        return snapshot;
      };

      const trashItems: TrashListItem[] =
        workspaceProjection.trash.sessions.flatMap((session) => [
          ...session.branches.map((branch) => ({
            expiresAtLabel: formatTimestamp(branch.purgeAfter),
            id: branch.branchId,
            kind: "branch" as const,
            originKind: branch.trashOrigin,
            originLabel:
              branch.trashOrigin === "workspace"
                ? t(uiLanguage, "trash.originWorkspace")
                : (branch.trashOriginPathSnapshot ??
                  t(uiLanguage, "trash.originArchive")),
            statusLabel: subtitleStatusLabel({
              languageMode: branch.requestedLanguageMode,
              source: branch.source,
              trackOrigin: branch.trackOrigin,
              lang: uiLanguage,
            }),
            statusDetailLabel:
              branch.source === "bilibili"
                ? officialSubtitleDetailLabel(branch.trackOrigin, uiLanguage)
                : null,
            title: session.title,
            trashedAtLabel: formatTimestamp(branch.trashedAt),
          })),
          ...(session.emptySession
            ? [
                {
                  expiresAtLabel: formatTimestamp(
                    session.emptySession.purgeAfter,
                  ),
                  id: trashSessionSelectionId(session.sessionId),
                  kind: "session" as const,
                  originKind:
                    session.emptySession.trashOrigin === "archive"
                      ? ("archive" as const)
                      : ("workspace" as const),
                  originLabel:
                    session.emptySession.trashOrigin === "archive"
                      ? t(uiLanguage, "trash.originArchive")
                      : t(uiLanguage, "trash.originWorkspace"),
                  sessionId: session.sessionId,
                  statusDetailLabel: null,
                  statusLabel: noSubtitleStatusLabel(uiLanguage),
                  title: session.title,
                  trashedAtLabel: formatTimestamp(
                    session.emptySession.trashedAt,
                  ),
                },
              ]
            : []),
        ]);
      const trash: TrashWorkspaceProps = {
        uiLanguage,
        applyRetentionTo:
          settingsEditor.retention.applyMode === "apply-to-existing"
            ? "existing"
            : "future",
        busy,
        customRetentionDays:
          settingsEditor.retention.policy.kind === "duration"
            ? String(settingsEditor.retention.policy.durationDays)
            : "7",
        items: trashItems,
        onEmptyTrash: async () => {
          const branchIds = [
            ...new Set(
              workspaceProjection.trash.sessions.flatMap((session) =>
                session.branches.map((branch) => branch.branchId),
              ),
            ),
          ];
          const sessionIds = [
            ...new Set(
              workspaceProjection.trash.sessions.flatMap((session) =>
                session.emptySession ? [session.sessionId] : [],
              ),
            ),
          ];
          if (branchIds.length === 0 && sessionIds.length === 0) return false;
          let preview: TrashPermanentDeletionPreview;
          try {
            preview = await trashRepository.previewTrashPermanentDeletion({
              branchIds,
              sessionIds,
            });
          } catch (error) {
            message = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
            return false;
          }
          if (
            !(await confirmDialog({
              confirmLabel: t(uiLanguage, "toast.emptyTrash"),
              danger: true,
              description: trashDeletionDescription(preview, uiLanguage),
              title: t(uiLanguage, "toast.emptyTrashTitle"),
            }))
          ) {
            return false;
          }
          return runProductAction(
            t(uiLanguage, "toast.trashEmptied"),
            async () => {
              await trashRepository.permanentlyDeleteTrashContent({
                branchIds,
                sessionIds,
              });
            },
          );
        },
        onPermanentlyDelete: async (items: readonly TrashDeleteIntent[]) => {
          if (items.length === 0) {
            message = {
              kind: "error",
              text: "请先勾选要永久删除的回收站条目。",
            };
            renderSnapshot();
            return false;
          }
          const branchIds = [
            ...new Set(
              items.flatMap((item) =>
                item.kind === "branch" ? [item.branchId] : [],
              ),
            ),
          ];
          const sessionIds = [
            ...new Set(
              items.flatMap((item) =>
                item.kind === "session" ? [item.sessionId] : [],
              ),
            ),
          ];
          let preview: TrashPermanentDeletionPreview;
          try {
            preview = await trashRepository.previewTrashPermanentDeletion({
              branchIds,
              sessionIds,
            });
          } catch (error) {
            message = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
            return false;
          }
          if (
            !(await confirmDialog({
              confirmLabel: t(uiLanguage, "trash.deleteForever"),
              danger: true,
              description: trashDeletionDescription(preview, uiLanguage),
              title: t(uiLanguage, "toast.deleteForeverTitle"),
            }))
          ) {
            return false;
          }
          return runProductAction(
            t(uiLanguage, "toast.itemsPermanentlyDeleted"),
            async () => {
              await trashRepository.permanentlyDeleteTrashContent({
                branchIds,
                sessionIds,
              });
            },
          );
        },
        onRetentionChange: (value) => {
          return runProductAction(
            t(uiLanguage, "toast.retentionSaved"),
            async () => {
              const durationDays =
                value.retention === "custom"
                  ? Number(value.customDays)
                  : Number(value.retention);
              const policy = createTrashRetentionPolicy(
                value.retention === "forever"
                  ? { kind: "forever" }
                  : { durationDays, kind: "duration" },
              );
              const applyMode =
                value.applyTo === "existing"
                  ? "apply-to-existing"
                  : "future-only";
              await retentionRepository.updatePolicy(policy, applyMode);
              await settingsStore.updateRetention({ applyMode, policy });
              await reloadSettingsEditor();
            },
          );
        },
        onRestore: (intent) => {
          return runAction("会话已恢复至工作区", () =>
            restoreTrashItems([intent]),
          );
        },
        onRestoreSelected: (items) => {
          if (items.length === 0) return false;
          return runAction("会话已恢复至工作区", async () => {
            const snapshot = await restoreTrashItems(items);
            return snapshot;
          });
        },
        retention: retentionChoice(),
      };
      const selectedModelId =
        settingsEditor.provider.selectedModel?.modelId ?? "";
      const selectedReasoningEffort =
        settingsEditor.provider.selectedModel?.reasoningEffort ?? "auto";
      const currentRetentionChoice = retentionChoice();
      const v12ProfileOptions: NonNullable<SettingsDrawerProps["profiles"]> =
        providerProfiles.map((profile) => ({
          apiKey: profile.apiKey,
          baseUrl: profile.baseUrl,
          hostPermission: profile.hostPermission,
          id: profile.id,
          models: profile.models.map((model) => {
            // ollama-chat 端点类型按 providerId=ollama 识别家族档位。
            const registryProviderId =
              profile.protocol === "ollama-chat" ? "ollama" : undefined;
            const capabilities =
              resolveKnownModelCapabilities(model.id, registryProviderId) ??
              discoveredModels.find(
                (descriptor) => descriptor.modelId === model.id,
              )?.capabilities ??
              null;
            return {
              enabled: model.enabled,
              id: model.id,
              label:
                model.verification === "unverified"
                  ? `${model.id}${t(uiLanguage, "model.unverifiedSuffix")}`
                  : model.id,
              // 直接暴露模型能力声明的档位（none/minimal/low/medium/high/xhigh/max），
              // 不再硬编码 low/medium/high，否则 DeepSeek 的 max、GLM 的 minimal 等会丢失。
              reasoningEfforts: capabilities?.supportedReasoningEfforts ?? [],
              reasoningOverride:
                modelReasoningOverrides[`${profile.id}\u0000${model.id}`] ??
                null,
              verification: model.verification,
            };
          }),
          name: profile.name,
        }));
      const v12TaskChoices: NonNullable<SettingsDrawerProps["taskChoices"]> = (
        ["chat", "summary", "segments"] as const
      ).map((kind) => projectTaskChoice(kind));
      const settings: SettingsDrawerProps = {
        apiKey: "",
        apiKeyConfigured: settingsEditor.provider.apiKeyConfigured,
        applyRetentionTo:
          settingsEditor.retention.applyMode === "apply-to-existing"
            ? "existing"
            : "future",
        backupCounts: {
          archive: workspaceProjection.archive.sessions.length,
          languageModels: providerProfiles.length,
          prompts: {
            chat: promptPresetState.presets.filter(
              (preset) => preset.builtIn === false && preset.kind === "chat",
            ).length,
            summary: promptPresetState.presets.filter(
              (preset) => preset.builtIn === false && preset.kind === "summary",
            ).length,
          },
          trash: workspaceProjection.trash.sessions.length,
          workspace: workspaceProjection.workspace.sessions.length,
        },
        baseUrl: settingsEditor.connection.baseUrl,
        busy,
        customRetentionDays:
          settingsEditor.retention.policy.kind === "duration"
            ? String(settingsEditor.retention.policy.durationDays)
            : "7",
        exportPreference,
        feedback: settingsFeedback,
        lastBackupExportPath: lastBackupExport?.filename ?? null,
        groqApiKey: "",
        groqApiKeyConfigured: groqKeyProjection.configured,
        modelId: selectedModelId,
        models: discoveredModels.map((model) => ({
          id: model.modelId,
          label: model.displayName,
          reasoningEfforts: model.capabilities.supportedReasoningEfforts,
        })),
        groqKeyProjection,
        onRevealGroqKey: () => settingsStore.revealGroqApiKey(),
        profiles: v12ProfileOptions,
        customReasoningEfforts,
        selectedProfileId: providerProfiles[0]?.id,
        taskChoices: v12TaskChoices,
        onClose: () => {
          settingsOpen = false;
          settingsFeedback = undefined;
          renderSnapshot();
        },
        onCreateProfile: async ({ apiKey, baseUrl, name, protocol }) => {
          return runSettingsAction(
            "正在创建配置并请求精确主机权限…",
            "语言模型配置已创建。",
            async () => {
              const normalizedBaseUrl = baseUrl.trim();
              // Ollama 本地端点：强制 ollama-chat 端点类型（家族档位识别）。
              const profile = await settingsStore.createProviderProfile({
                baseUrl: normalizedBaseUrl,
                name,
                protocol: normalizedBaseUrl.startsWith("http://localhost:11434")
                  ? "ollama-chat"
                  : (protocol ?? "openai-chat"),
              });
              try {
                // Ollama 本地端点无 key：空 key 用占位值保证网关路径可用
                // （请求携带的 Authorization 头会被 Ollama 忽略）。
                const effectiveApiKey =
                  apiKey.trim().length > 0 ||
                  !baseUrl.trim().startsWith("http://localhost:11434")
                    ? apiKey.trim()
                    : "ollama";
                await settingsStore.saveProviderApiKey(
                  profile.id,
                  effectiveApiKey,
                );
              } catch (error) {
                // 创建与保存 Key 视为一个事务：Key 保存失败时回滚新建的配置。
                await settingsStore
                  .deleteProviderProfile(profile.id)
                  .catch(() => undefined);
                throw error;
              }
              await reloadV12Settings();
            },
          );
        },
        onRenameProfileModel: ({ modelId, nextModelId, profileId }) =>
          runSettingsAction("正在重命名模型…", "模型已重命名。", async () => {
            await settingsStore.renameProfileModel(
              profileId,
              modelId,
              nextModelId.trim(),
            );
            await reloadV12Settings();
          }),
        onDeleteProfileModel: ({ modelId, profileId }) =>
          runSettingsAction("正在删除模型…", "模型已删除。", async () => {
            await settingsStore.deleteProfileModel(profileId, modelId);
            await reloadV12Settings();
          }),
        onDeleteProfile: (profileId) =>
          runSettingsAction(
            "正在删除语言模型配置…",
            "语言模型配置已删除。",
            async () => {
              await settingsStore.deleteProviderProfile(profileId);
              await reloadV12Settings();
            },
          ),
        onAddManualProfileModel: ({ modelId, profileId }) =>
          runSettingsAction(
            "正在添加手工模型…",
            "手工模型已添加并标记为未验证。",
            async () => {
              await settingsStore.addManualProfileModel(profileId, modelId);
              await reloadV12Settings();
            },
          ),
        onReorderProfile: ({ profileId, toIndex }) =>
          runSettingsAction(
            "正在保存配置排序…",
            "配置排序已保存。",
            async () => {
              // 排序始终基于最新持久化列表执行：创建/删除后的过期快照不会
              // 触发「配置不存在」或排序不完整报错。
              providerProfiles = await settingsStore.moveProviderProfile(
                profileId,
                toIndex,
              );
              taskSelections = await settingsStore.loadTaskSelections();
            },
          ),
        onReorderProfileModel: ({ modelId, profileId, toIndex }) =>
          runSettingsAction(
            "正在保存模型排序…",
            "模型排序已保存。",
            async () => {
              await settingsStore.moveProfileModel(profileId, modelId, toIndex);
              await reloadV12Settings();
            },
          ),
        onCheckProfileAvailability: (profileId) =>
          runSettingsAction(
            "正在检测可用性…",
            "检测完成，精确主机权限已就绪。",
            async () => {
              await settingsStore.ensureProfileHostPermission(profileId);
              await reloadV12Settings();
            },
          ),
        onRevealProviderKey: (profileId) =>
          settingsStore.revealProviderApiKey(profileId),
        onDiscoverProfileModels: (profileId) =>
          runSettingsAction(
            "正在获取可用模型…",
            "可用模型已顺延追加到列表末尾。",
            async () => {
              await settingsStore.discoverProfileModels(profileId);
              await reloadV12Settings();
            },
          ),
        onAddCustomReasoningEffort: (effort) =>
          runSettingsAction(
            t(uiLanguage, "settings.savingModelReasoning"),
            t(uiLanguage, "settings.customEffortsAdd"),
            async () => {
              await settingsStore.saveCustomReasoningEfforts([
                ...customReasoningEfforts,
                effort,
              ]);
              await reloadV12Settings();
            },
          ),
        onRemoveCustomReasoningEffort: (effort) =>
          runSettingsAction(
            t(uiLanguage, "settings.savingModelReasoning"),
            t(uiLanguage, "settings.customEffortsDeleteAria", { effort }),
            async () => {
              // 删除档位：引用它的模型覆盖一并移除，回退到模型默认档位。
              const nextOverrides: Record<string, ModelReasoningOverride> = {};
              for (const [key, override] of Object.entries(
                modelReasoningOverrides,
              )) {
                if (override.effort !== effort) {
                  nextOverrides[key] = override;
                }
              }
              await settingsStore.saveCustomReasoningEfforts(
                customReasoningEfforts.filter(
                  (candidate) => candidate !== effort,
                ),
              );
              for (const [key, override] of Object.entries(nextOverrides)) {
                const [profileId, modelId] = key.split("\u0000");
                if (profileId && modelId) {
                  await settingsStore.saveModelReasoningOverride(
                    profileId,
                    modelId,
                    override,
                  );
                }
              }
              await reloadV12Settings();
            },
          ),
        onMoveCustomReasoningEffort: (effort, direction) =>
          runSettingsAction(
            t(uiLanguage, "settings.savingModelReasoning"),
            t(uiLanguage, "settings.customEffortsMoveUpAria", { effort }),
            async () => {
              const current = [...customReasoningEfforts];
              const fromIndex = current.indexOf(effort);
              if (fromIndex < 0) return;
              const toIndex =
                direction === "up" ? fromIndex - 1 : fromIndex + 1;
              if (toIndex < 0 || toIndex >= current.length) return;
              current.splice(fromIndex, 1);
              current.splice(toIndex, 0, effort);
              await settingsStore.saveCustomReasoningEfforts(current);
              await reloadV12Settings();
            },
          ),
        onSetModelReasoning: ({ enabled, effort, modelId, profileId }) =>
          runSettingsAction(
            t(uiLanguage, "settings.savingModelReasoning"),
            enabled
              ? t(uiLanguage, "settings.modelReasoningEnabled")
              : t(uiLanguage, "settings.modelReasoningDisabled"),
            async () => {
              await settingsStore.saveModelReasoningOverride(
                profileId,
                modelId,
                { effort, enabled },
              );
              await reloadV12Settings();
            },
          ),
        onSetProfileModelEnabled: ({ enabled, modelId, profileId }) =>
          runSettingsAction(
            "正在保存模型状态…",
            enabled ? "模型已启用。" : "模型已禁用。",
            async () => {
              await settingsStore.setProfileModelEnabled(
                profileId,
                modelId,
                enabled,
              );
              await reloadV12Settings();
            },
          ),
        onUpdateProfile: ({ apiKey, baseUrl, name, profileId, protocol }) =>
          runSettingsAction(
            "正在更新配置并请求精确主机权限…",
            "语言模型配置已更新。",
            async () => {
              await settingsStore.updateProviderProfile(profileId, {
                baseUrl,
                ...(name === undefined ? {} : { name }),
                ...(protocol === undefined ? {} : { protocol }),
              });
              if (apiKey !== undefined && apiKey.trim().length > 0) {
                await settingsStore.saveProviderApiKey(
                  profileId,
                  apiKey.trim(),
                );
              }
              await reloadV12Settings();
            },
          ),
        onOpenBackupExport: async (selection) => {
          if (busy) return false;
          busy = true;
          lastBackupExport = null;
          settingsFeedback = {
            kind: "pending",
            text: "正在导出所选备份…",
          };
          renderSnapshot();
          try {
            let confirmPlaintextSecrets = false;
            if (selection.includeKeys && !selection.password) {
              const warned = await confirmDialog({
                confirmLabel: t(uiLanguage, "dialog.backupKeyRiskKnown"),
                danger: true,
                description:
                  "此文件会包含未加密的 Provider/Groq API Key。任何拿到文件的人都可能使用这些密钥。",
                title: t(uiLanguage, "dialog.backupKeyWarningTitle"),
              });
              if (!warned) {
                settingsFeedback = undefined;
                return false;
              }
              confirmPlaintextSecrets = await confirmDialog({
                confirmLabel: t(uiLanguage, "dialog.exportPlainKeys"),
                danger: true,
                description:
                  "请再次确认：导出后请把文件保存到安全位置，避免同步或分享。",
                title: t(uiLanguage, "dialog.exportPlainKeysTitle"),
              });
              if (!confirmPlaintextSecrets) {
                settingsFeedback = undefined;
                return false;
              }
            }
            const result = await backupRuntime.exportBackup({
              confirmPlaintextSecrets,
              groups: selection.groups,
              includeKeys: selection.includeKeys,
              ...(selection.password ? { password: selection.password } : {}),
            });
            const download = await backupDownloadRuntime.exportJson({
              fileName: result.fileName,
              json: result.json,
            });
            if (download.cancelled) {
              settingsFeedback = undefined;
              return false;
            }
            lastBackupExport = Object.freeze({
              downloadId: download.downloadId,
              filename: download.filename,
            });
            settingsFeedback = { kind: "status", text: "备份已导出。" };
          } catch (error) {
            settingsFeedback = {
              kind: "error",
              text: safeBackupExportMessage(error, uiLanguage),
            };
            return false;
          } finally {
            busy = false;
            renderSnapshot();
          }
          return true;
        },
        onCopyBackupExportPath: async () => {
          if (lastBackupExport === null) return;
          try {
            await navigator.clipboard.writeText(lastBackupExport.filename);
          } catch {
            settingsFeedback = {
              kind: "error",
              text: "复制备份完整路径失败，请检查剪贴板权限后重试。",
            };
            renderSnapshot();
          }
        },
        onOpenBackupExportFolder: async () => {
          if (lastBackupExport === null) return;
          try {
            await backupDownloadRuntime.openContainingFolder(
              lastBackupExport.downloadId,
            );
          } catch {
            settingsFeedback = {
              kind: "error",
              text: "无法打开备份所在文件夹，请在浏览器下载记录中查看。",
            };
            renderSnapshot();
          }
        },
        onOpenBackupImport: async ({ json }) => {
          let password: string | undefined;
          let inspection;
          try {
            inspection = await backupRuntime.inspectBackupFile({ json });
          } catch (error) {
            if (
              error instanceof BackupError &&
              error.code === "BACKUP_PASSWORD_REQUIRED"
            ) {
              const entered = await askDialog({
                confirmLabel: t(uiLanguage, "dialog.unlockAndVerify"),
                defaultValue: "",
                description:
                  "此备份已加密。请输入导出时设置的备份密码；密码只用于本次本地核验。",
                inputLabel: t(uiLanguage, "dialog.backupPassword"),
                inputType: "password",
                title: "输入备份密码",
              });
              if (entered === null) return false;
              password = entered;
              try {
                inspection = await backupRuntime.inspectBackupFile({
                  json,
                  password,
                });
              } catch (passwordError) {
                settingsFeedback = {
                  kind: "error",
                  text: safeSessionActionMessage(passwordError, uiLanguage),
                };
                renderSnapshot();
                return false;
              }
            } else {
              settingsFeedback = {
                kind: "error",
                text: safeSessionActionMessage(error, uiLanguage),
              };
              renderSnapshot();
              return false;
            }
          }
          const options = [
            ...inspection.availableGroups.map((group) => ({
              label: BACKUP_IMPORT_GROUP_LABELS[group],
              value: group,
            })),
            ...(inspection.containsSecrets
              ? [{ label: "API 与密钥", value: "api-keys" }]
              : []),
          ];
          const selectedValue = await askDialog({
            confirmLabel: "预检所选板块",
            defaultValue: options.map(({ value }) => value).join(","),
            description:
              "请选择要完全覆盖的板块。未选择的本机板块保持不变。API 与密钥可独立选择。",
            inputLabel: "导入板块",
            multipleOptions: true,
            options,
            title: "选择要导入的板块",
          });
          if (selectedValue === null) return false;
          const selectedValues = selectedValue.split(",");
          const selectedGroups = BACKUP_GROUPS.filter((group) =>
            selectedValues.includes(group),
          );
          const includeKeys = selectedValues.includes("api-keys");
          if (selectedGroups.length === 0 && !includeKeys) return false;
          let preview: BackupImportPreview;
          try {
            preview = await backupRuntime.previewImport({
              groups: selectedGroups,
              includeKeys,
              json,
              ...(password ? { password } : {}),
            });
          } catch (error) {
            settingsFeedback = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
            return false;
          }
          if (preview.conflicts.length > 0) {
            settingsFeedback = {
              kind: "error",
              text: describeBackupImportPreview(preview, uiLanguage),
            };
            renderSnapshot();
            return false;
          }
          const confirmed = await confirmDialog({
            confirmLabel: "完全覆盖所选板块",
            danger: true,
            description: describeBackupImportPreview(preview, uiLanguage),
            title: "确认完全覆盖？",
          });
          if (!confirmed) return false;
          return runSettingsAction(
            "正在原子覆盖所选板块…",
            "备份导入完成。",
            async () => {
              await backupRuntime.commitImport({
                confirmation: "replace-selected-groups",
                preview,
              });
              await reloadV12Settings();
              snapshot = await sessionCoordinator.initialize();
              await Promise.all([
                refreshProductProjection(),
                loadChatState(),
                loadArtifactState(),
              ]);
            },
          );
        },
        onDiscoverModels: () => {
          return runSettingsAction(
            "正在探测可用模型…",
            "模型探测完成。",
            async () => {
              await discoverProviderModels();
              return t(uiLanguage, "settings.modelsDiscovered", {
                count: discoveredModels.length,
              });
            },
          );
        },
        onExportPreferenceChange: (value) => {
          exportPreference = Object.freeze({ ...value });
          void persistUiPreferences().catch((error: unknown) => {
            message = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
          });
          renderSnapshot();
        },
        onModelChange: (value) => {
          const descriptor = discoveredModels.find(
            (model) => model.modelId === value.modelId,
          );
          if (!descriptor) return false;
          return runProductAction("任务模型已保存", async () => {
            const selection = createAiModelSelection(
              descriptor,
              value.reasoningEffort as Parameters<
                typeof createAiModelSelection
              >[1],
            );
            await settingsStore.selectDiscoveredModel(descriptor, selection);
            await reloadSettingsEditor();
          });
        },
        defaultPromptPresetIds: promptPresetState.defaultPromptPresetIds,
        promptPresets: promptPresetState.presets,
        selectedPromptPresetIds,
        onSelectPromptPreset: (value) =>
          selectPromptPreset(value.kind, value.presetId),
        onCreatePromptPreset: createPromptPreset,
        onCopyPromptPreset: copyPromptPreset,
        onDeletePromptPreset: deletePromptPreset,
        onRestoreBuiltInPrompt: (kind) =>
          selectPromptPreset(
            kind,
            promptPresetState.defaultPromptPresetIds[kind],
          ),
        onSelectDefaultPromptPreset: (value) =>
          setDefaultPromptPreset(value.kind, value.presetId),
        onUpdatePromptPreset: updatePromptPreset,
        onExportPromptPresets: (format) => {
          return runProductAction("提示词预设已导出", async () => {
            const content = await settingsStore.exportPromptPresets(format);
            downloadTextFile(
              `muzhi-prompt-presets.${format === "json" ? "json" : "txt"}`,
              content,
              format === "json"
                ? "application/json;charset=utf-8"
                : "text/plain;charset=utf-8",
            );
          });
        },
        onImportPromptPresets: (format) => {
          return runProductAction("提示词预设已导入", async () => {
            const data = await pickTextFile(
              format === "json" ? "application/json,.json" : "text/plain,.txt",
            );
            if (data === null) throw new StorageError("未选择有效的导入文件");
            if (format === "json") {
              promptPresetState = await settingsStore.importPromptPresets({
                data,
                format,
              });
              return;
            }
            const task = await askDialog({
              confirmLabel: t(uiLanguage, "dialog.importContinue"),
              defaultValue: "chat",
              inputLabel: "任务（chat / summary / segments）",
              title: "选择纯文本提示词任务",
            });
            if (task !== "chat" && task !== "summary" && task !== "segments") {
              throw new StorageError("纯文本导入需要有效任务类型");
            }
            const name = await askDialog({
              confirmLabel: t(uiLanguage, "dialog.importPreset"),
              defaultValue: t(uiLanguage, "dialog.importedPrompt"),
              inputLabel: "预设名称",
              title: "命名提示词预设",
            });
            if (name === null || name.trim().length === 0) {
              throw new StorageError("提示词预设名称不能为空");
            }
            promptPresetState = await settingsStore.importPromptPresets({
              data,
              format,
              kind: task,
              name: name.trim(),
            });
          });
        },
        taskPrompts,
        onTaskPromptChange: (value) => {
          taskPrompts = Object.freeze({
            ...taskPrompts,
            [value.kind]: value.value,
          });
          void persistUiPreferences().catch((error: unknown) => {
            settingsFeedback = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
          });
          renderSnapshot();
        },
        onPromptTemplateChange: (value) => {
          promptTemplate = value;
          void persistUiPreferences().catch((error: unknown) => {
            message = {
              kind: "error",
              text: safeSessionActionMessage(error, uiLanguage),
            };
            renderSnapshot();
          });
          renderSnapshot();
        },
        onProviderChange: (value) => {
          const preset = Reflect.get(PROVIDER_PRESETS, value.providerId) as
            | {
                readonly baseUrl: string;
                readonly protocol: "claude" | "gemini" | "openai";
              }
            | undefined;
          const protocol =
            preset?.protocol ??
            (value.protocol === "anthropic"
              ? "claude"
              : value.protocol === "gemini"
                ? "gemini"
                : "openai");
          if (value.providerId !== settingsEditor.connection.providerId) {
            customHostPermissionGranted = false;
          }
          if (value.providerId === CUSTOM_PROVIDER_ID) {
            void hostPermissions
              ?.contains(value.baseUrl)
              .then((granted) => {
                if (granted === customHostPermissionGranted) return;
                customHostPermissionGranted = granted;
                renderSnapshot();
              })
              .catch(() => undefined);
          }
          settingsEditor = Object.freeze({
            ...settingsEditor,
            connection: Object.freeze({
              baseUrl: preset?.baseUrl ?? value.baseUrl,
              protocol,
              providerId: value.providerId,
            }),
            provider: Object.freeze({
              ...settingsEditor.provider,
              apiKeyConfigured: settingsEditor.configuredProviderIds.includes(
                value.providerId,
              ),
              protocol,
              providerId: value.providerId,
              selectedModel: null,
            }),
          });
          discoveredModels = Object.freeze([]);
          renderSnapshot();
        },
        onRetentionChange: (value) => {
          void runProductAction("回收站保留期限已保存", async () => {
            const durationDays =
              value.retention === "custom"
                ? Number(value.customDays)
                : Number(value.retention);
            const policy = createTrashRetentionPolicy(
              value.retention === "forever"
                ? { kind: "forever" }
                : { durationDays, kind: "duration" },
            );
            const applyMode =
              value.applyTo === "existing"
                ? "apply-to-existing"
                : "future-only";
            await retentionRepository.updatePolicy(policy, applyMode);
            await settingsStore.updateRetention({ applyMode, policy });
            await reloadSettingsEditor();
          });
        },
        onSaveGroqKey: (apiKey) => {
          return runSettingsAction(
            "正在保存 Groq 语音密钥…",
            "Groq 语音密钥已保存。",
            async () => {
              if (apiKey.trim().length === 0) {
                throw new StorageError("The Groq speech key is required");
              }
              await settingsStore.saveV12GroqApiKey(apiKey.trim());
              await reloadV12Settings();
            },
          );
        },
        onTaskModelChange: (value) => {
          const descriptor = discoveredModels.find(
            (model) => model.modelId === value.modelId,
          );
          if (value.modelId.length > 0 && !descriptor) return false;
          return runSettingsAction(
            "正在保存任务模型…",
            "任务模型已保存。",
            async () => {
              taskModels = await settingsStore.saveTaskModel(
                value.kind,
                descriptor
                  ? createAiModelSelection(
                      descriptor,
                      value.reasoningEffort as Parameters<
                        typeof createAiModelSelection
                      >[1],
                    )
                  : null,
              );
            },
          );
        },
        onSaveProviderKey: (apiKey) => {
          return runSettingsAction(
            t(uiLanguage, "settings.savingProvider"),
            t(uiLanguage, "settings.providerSaved"),
            async () => {
              // A custom endpoint is unusable without its host permission, so
              // saving requests it instead of leaving the user to discover a
              // separate button.
              if (settingsEditor.connection.providerId === CUSTOM_PROVIDER_ID) {
                await ensureCustomHostPermission();
              }
              await settingsStore.saveProviderConfiguration(
                settingsEditor.connection,
              );
              if (apiKey.trim().length > 0) {
                await settingsStore.saveApiKey(apiKey.trim());
              }
              if (apiKey.trim().length === 0) {
                await reloadSettingsEditor();
                return t(uiLanguage, "settings.providerSaved");
              }
              try {
                await discoverProviderModels();
                return discoveredModels.length === 0
                  ? t(uiLanguage, "settings.providerSavedNoModels")
                  : t(uiLanguage, "settings.providerSavedModels", {
                      count: discoveredModels.length,
                    });
              } catch (error) {
                await reloadSettingsEditor();
                return t(uiLanguage, "settings.providerSavedProbeFailed", {
                  error: safeSessionActionMessage(error, uiLanguage),
                });
              }
            },
          );
        },
        onTestProvider: () => {
          return runSettingsAction(
            t(uiLanguage, "settings.connectingProvider"),
            t(uiLanguage, "settings.connected"),
            async () => {
              await discoverProviderModels();
              return discoveredModels.length === 0
                ? t(uiLanguage, "settings.connectedNoModels")
                : t(uiLanguage, "settings.connectedModels", {
                    count: discoveredModels.length,
                  });
            },
          );
        },
        onThemeChange: (theme) => {
          appearanceState = Object.freeze({
            appearance: Object.freeze({ theme }),
            conversationPaneWidthPx: appearanceState.conversationPaneWidthPx,
            version: 2,
          });
          void persistAppearance().catch(() => undefined);
          renderSnapshot();
        },
        open: settingsOpen,
        promptTemplate,
        protocol:
          settingsEditor.connection.protocol === "claude"
            ? "anthropic"
            : settingsEditor.connection.protocol === "gemini"
              ? "gemini"
              : "openai-compatible",
        providerId: settingsEditor.connection.providerId,
        providers: PROVIDER_OPTIONS,
        reasoningEffort: selectedReasoningEffort,
        retention: currentRetentionChoice,
        taskModels: TASK_MODEL_LABELS.map((task) => ({
          kind: task.kind,
          label: task.label,
          modelId: taskModels[task.kind]?.modelId ?? "",
          reasoningEffort: taskModels[task.kind]?.reasoningEffort ?? "auto",
        })),
        connectionEditable:
          settingsEditor.connection.providerId === CUSTOM_PROVIDER_ID,
        hostPermissionGranted: customHostPermissionGranted,
        theme: appearanceState.appearance.theme,
        uiLanguage,
        onUiLanguageChange: (language) => {
          uiLanguage = language;
          renderSnapshot();
          return persistUiPreferences();
        },
      };
      const activePromptManagerKind = promptManagerKind;
      const promptManager: PromptManagerDialogProps | undefined =
        activePromptManagerKind === null
          ? undefined
          : {
              uiLanguage,
              outputLanguage: concreteOutputLanguage(
                taskOutputLanguages[activePromptManagerKind],
              ),
              busy,
              defaultPresetId:
                promptPresetState.defaultPromptPresetIds[
                  activePromptManagerKind
                ],
              kind: activePromptManagerKind,
              onClose: () => {
                promptManagerKind = null;
                renderSnapshot();
              },
              onCopyPreset: copyPromptPreset,
              onCreatePreset: () => createPromptPreset(activePromptManagerKind),
              onDeletePreset: deletePromptPreset,
              onSelectPreset: (presetId) =>
                selectPromptPreset(activePromptManagerKind, presetId),
              onSetDefaultPreset: (presetId) =>
                setDefaultPromptPreset(activePromptManagerKind, presetId),
              onUpdatePreset: updatePromptPreset,
              presets: promptPresetState.presets
                .filter((preset) => preset.kind === activePromptManagerKind)
                .map((preset) => ({
                  builtIn: preset.builtIn,
                  content: preset.content,
                  id: preset.id,
                  name: preset.name,
                })),
              selectedPresetId:
                selectedPromptPresetIds[activePromptManagerKind],
            };
      const batchArchive: BatchArchiveWorkspaceProps = {
        busy,
        uiLanguage,
        lists: batchArchivedLists,
        onRenameList: (batchJobId, name) =>
          runBatchAction(t(uiLanguage, "batch.listRenamed"), async () => {
            await batchClient.renameList(batchJobId, name);
            await refreshBatchArchive();
          }),
        onRestoreList: (batchJobId, selectAndSwitch) =>
          runBatchAction(t(uiLanguage, "batch.listRestored"), async () => {
            await batchClient.restoreList(batchJobId);
            await refreshBatchJobs();
            await refreshBatchArchive();
            if (selectAndSwitch !== false) {
              const restored = await batchClient.read(batchJobId);
              if (restored !== null) {
                // 恢复后选中该列表，但保留当前归档/回收站界面（不切走）。
                batchView = restored;
              }
            }
            renderSnapshot();
          }),
        // 批量方法：单个 runBatchAction 内循环处理全部，避免 busy 锁
        // 只放行第一个（多选批量操作只处理一条的问题根因）。
        onRestoreMany: (batchJobIds) =>
          runBatchAction(t(uiLanguage, "batch.listRestored"), async () => {
            let firstRestored: BatchJobView | null = null;
            for (const [index, batchJobId] of batchJobIds.entries()) {
              await batchClient.restoreList(batchJobId);
              if (index === 0) {
                firstRestored = await batchClient.read(batchJobId);
              }
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
            if (firstRestored !== null) {
              batchView = firstRestored;
            }
            renderSnapshot();
          }),
        onTrashMany: (batchJobIds) =>
          runBatchAction(t(uiLanguage, "batch.listTrashed"), async () => {
            for (const batchJobId of batchJobIds) {
              await batchClient.trashList(batchJobId);
            }
            if (
              batchView !== undefined &&
              batchJobIds.includes(batchView.job.batchJobId)
            ) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
          }),
        onTrashList: (batchJobId) =>
          runBatchAction(t(uiLanguage, "batch.listTrashed"), async () => {
            await batchClient.trashList(batchJobId);
            if (batchView?.job.batchJobId === batchJobId) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
          }),
      };
      const batchTrash: BatchTrashWorkspaceProps = {
        applyRetentionTo: batchRetentionApplyTo,
        busy,
        customRetentionDays: batchCustomRetentionDays,
        lists: batchTrashedLists,
        retention: batchRetentionChoice,
        onRetentionChange: (value) =>
          runBatchAction(t(uiLanguage, "batch.retentionSaved"), async () => {
            const policy: TrashRetentionPolicy =
              value.retention === "forever"
                ? { kind: "forever" }
                : {
                    durationDays:
                      value.retention === "custom"
                        ? Number(value.customDays)
                        : Number(value.retention),
                    kind: "duration",
                  };
            await batchClient.updateRetentionPolicy(
              policy,
              value.applyTo === "existing"
                ? "apply-to-existing"
                : "future-only",
            );
            batchRetentionChoice = value.retention;
            batchCustomRetentionDays = value.customDays;
            batchRetentionApplyTo = value.applyTo;
            await refreshBatchArchive();
          }),
        onRestoreList: (batchJobId, selectAndSwitch) =>
          runBatchAction(t(uiLanguage, "batch.listRestored"), async () => {
            await batchClient.restoreList(batchJobId);
            await refreshBatchJobs();
            await refreshBatchArchive();
            if (selectAndSwitch !== false) {
              const restored = await batchClient.read(batchJobId);
              if (restored !== null) {
                // 恢复后选中该列表，但保留当前回收站界面（不切走）。
                batchView = restored;
              }
            }
            renderSnapshot();
          }),
        // 批量方法：单个 runBatchAction 内循环处理全部（busy 锁修复）。
        onRestoreMany: (batchJobIds) =>
          runBatchAction(t(uiLanguage, "batch.listRestored"), async () => {
            let firstRestored: BatchJobView | null = null;
            for (const [index, batchJobId] of batchJobIds.entries()) {
              await batchClient.restoreList(batchJobId);
              if (index === 0) {
                firstRestored = await batchClient.read(batchJobId);
              }
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
            if (firstRestored !== null) {
              batchView = firstRestored;
            }
            renderSnapshot();
          }),
        onPurgeMany: (batchJobIds) =>
          runBatchAction(t(uiLanguage, "batch.listPurged"), async () => {
            for (const batchJobId of batchJobIds) {
              await batchClient.purgeList(batchJobId);
            }
            if (
              batchView !== undefined &&
              batchJobIds.includes(batchView.job.batchJobId)
            ) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
          }),
        onPurgeList: (batchJobId) =>
          runBatchAction(t(uiLanguage, "batch.listPurged"), async () => {
            await batchClient.purgeList(batchJobId);
            if (batchView?.job.batchJobId === batchJobId) {
              batchView = undefined;
            }
            await refreshBatchJobs();
            await refreshBatchArchive();
          }),
        onEmptyTrash: () =>
          runBatchAction(t(uiLanguage, "batch.trashEmptied"), async () => {
            for (const list of batchTrashedLists) {
              await batchClient.purgeList(list.job.batchJobId);
            }
            await refreshBatchArchive();
          }),
      };
      render(
        <AiChatShell
          actionMessage={message}
          archive={archive}
          onHelpClick={() => {
            helpContext = helpContext === null ? helpContextForSurface() : null;
            renderSnapshot();
          }}
          helpDialog={helpContext === null ? null : { context: helpContext }}
          appearance={appearanceState.appearance}
          batch={batch}
          batchDrawer={batchDrawer}
          batchArchive={batchArchive}
          batchTrash={batchTrash}
          chat={
            chat ??
            (restoredWorkspace != null &&
            isSessionVideoBound(restoredWorkspace.session)
              ? undefined
              : {
                  activeThreadId: null,
                  availability: "no-video" as const,
                  messages: [],
                  onCopyMessage: () => undefined,
                  onCreateThread: () => undefined,
                  onDeleteThread: () => undefined,
                  onExportThread: () => undefined,
                  onRequestMessageMutation: () => undefined,
                  onRenameThread: () => undefined,
                  onRetryMessage: () => undefined,
                  onSelectThread: () => undefined,
                  onSend: () => undefined,
                  onStop: () => undefined,
                  threads: [],
                  uiLanguage,
                })
          }
          uiLanguage={uiLanguage}
          conversationPaneWidthPx={appearanceState.conversationPaneWidthPx}
          dialog={
            pendingDialog
              ? {
                  uiLanguage,
                  ...pendingDialog.request,
                  // A dialog may be an input step inside the operation that owns
                  // the shared business lock. Reusing `busy` here would disable
                  // the only controls capable of settling that operation.
                  onCancel: () => settleDialog(null),
                  onConfirm: (value: string) => settleDialog(value),
                }
              : undefined
          }
          pageIsStale={pageIsStale}
          promptManager={promptManager}
          readOnly={
            readOnlyIsActive()
              ? {
                  onGuard: (action) => {
                    void guardReadOnly(action);
                  },
                  onRestoreToWorkspace: () => {
                    void runAction("会话已恢复至工作区", async () => {
                      await restoreReadOnlySession();
                      return snapshot;
                    });
                  },
                  onReturnToArchive: () => {
                    readOnlySessionId = null;
                    batchModeActive = false;
                    surface = "archive";
                    renderSnapshot();
                  },
                }
              : undefined
          }
          onAppearanceChange={(appearance) => {
            appearanceState = Object.freeze({
              appearance: Object.freeze({ ...appearance }),
              conversationPaneWidthPx: appearanceState.conversationPaneWidthPx,
              version: 2,
            });
            void persistAppearance().catch((error: unknown) => {
              message = {
                kind: "error",
                text: safeSessionActionMessage(error, uiLanguage),
              };
              renderSnapshot();
            });
            renderSnapshot();
          }}
          onConversationPaneWidthChange={(conversationPaneWidthPx) => {
            appearanceState = Object.freeze({
              appearance: appearanceState.appearance,
              conversationPaneWidthPx,
              version: 2,
            });
            void persistAppearance().catch((error: unknown) => {
              message = {
                kind: "error",
                text: safeSessionActionMessage(error, uiLanguage),
              };
              renderSnapshot();
            });
          }}
          onOpenSettings={() => {
            settingsOpen = true;
            settingsFeedback = undefined;
            renderSnapshot();
          }}
          onUtilityViewChange={(view) => {
            const applyUtilityView = (): void => {
              if (view !== "workspace") {
                disableTimelineSync();
              }
              if (
                (view === "archive" || view === "batch-archive") &&
                readOnlyIsActive()
              ) {
                readOnlySessionId = null;
              }
              batchModeActive =
                view === "batch" ||
                view === "batch-archive" ||
                view === "batch-trash";
              surface =
                view === "batch-archive" || view === "archive"
                  ? "archive"
                  : view === "batch-trash" || view === "trash"
                    ? "trash"
                    : "workspace";
              void chromeApi.storage.set({
                [LAST_SURFACE_STORAGE_KEY]: {
                  batchMode: batchModeActive,
                  surface,
                },
              });
              if (view === "batch-archive" || view === "batch-trash") {
                // 修复（Ticket 01）：刷新完成后必须重新渲染，
                // 否则归档/回收站首次打开显示 stale 空数据；
                // 失败时给出可见错误反馈（与 onError 文案一致）。
                void refreshBatchArchive()
                  .then(renderSnapshot)
                  .catch(() => {
                    batchErrorMessage = t(uiLanguage, "batch.fetchFailed");
                    renderSnapshot();
                  });
              }
              renderSnapshot();
            };
            const leavingBatchSurface =
              batchModeActive && surface !== "workspace";
            if (
              !leavingBatchSurface ||
              view === "batch" ||
              view === "batch-archive" ||
              view === "batch-trash"
            ) {
              applyUtilityView();
              return;
            }
            const currentBatchJobId = batchView?.job.batchJobId ?? null;
            void changeSurfaceAfterClearingBatchSelection(
              batchClient,
              currentBatchJobId,
              applyUtilityView,
            ).catch(() => {
              batchErrorMessage = t(uiLanguage, "batch.selectionUpdateFailed");
              renderSnapshot();
            });
          }}
          onWorkspaceViewChange={(state) => {
            void sessionCoordinator.saveView(state).catch((error: unknown) => {
              message = {
                kind: "error",
                text: safeSessionActionMessage(error, uiLanguage),
              };
              renderSnapshot();
            });
          }}
          restoredWorkspace={restoredWorkspace ?? undefined}
          segments={buildInsight("segments")}
          summary={buildInsight("summary")}
          sessionDrawer={{
            uiLanguage,
            activeSessionId: restoredWorkspace?.session.sessionId ?? null,
            busy,
            indicators: Object.fromEntries(
              workspaceProjection.workspace.sessions.map((session) => [
                session.sessionId,
                {
                  running:
                    session.branches.some((branch) => branch.running) ||
                    speechRunningSessions.has(session.sessionId),
                  unread: session.branches.some((branch) => branch.unread),
                },
              ]),
            ),
            message: undefined,
            onCreateSession: () => {
              return guardReadOnly(async () => {
                return runAction(
                  t(uiLanguage, "toast.sessionCreated"),
                  async () => {
                    // v16 D7：只创建未绑定会话（命名「新建会话N」），不自动同步当前页；
                    // 绑定由右侧 creator 的两种模式显式触发。
                    const created = await sessionCoordinator.createSession({
                      pageRevision: ++createdSessionPageRevision,
                      titleBase: t(uiLanguage, "session.newSessionTitle"),
                    });
                    snapshot = created;
                    surface = "workspace";
                    currentPage = null;
                    currentTimeMs = undefined;
                    renderSnapshot();
                    return created;
                  },
                );
              });
            },
            onReorder: (sessionId, beforeSessionId) => {
              return runAction("会话顺序已保存", () =>
                sessionCoordinator.reorder(sessionId, beforeSessionId),
              );
            },
            onBindCurrent: () => {
              return runAction(t(uiLanguage, "toast.pageSynced"), async () => {
                // v16 D7 模式一：稳定等待 URL（长地址→裸 BV→/?p=22）后把当前
                // 选中的未绑定会话绑定到该视频（标题更新）；非视频页/读取失败
                // 时提示错误，会话保留未绑定。
                let synced: Awaited<ReturnType<typeof currentPageSync.sync>>;
                try {
                  synced = await syncStableCurrentPage(currentPageSync);
                } catch {
                  message = {
                    kind: "error",
                    text: t(uiLanguage, "session.pageNotVideo"),
                  };
                  renderSnapshot();
                  return snapshot;
                }
                const sessionId = snapshot.restoredWorkspace?.session.sessionId;
                if (!sessionId) {
                  message = {
                    kind: "error",
                    text: t(uiLanguage, "session.pageNotVideo"),
                  };
                  renderSnapshot();
                  return snapshot;
                }
                const nextSnapshot =
                  await sessionCoordinator.synchronizeCreatedSession({
                    pageRevision: ++createdSessionPageRevision,
                    sessionId,
                    video: synced.video,
                  });
                if (currentPage) {
                  staleMonitor.markSynchronized(
                    synced.tabId,
                    synced.video.canonicalUrl,
                  );
                }
                // 手动绑定成功后解除采样阻塞（stale 期间可能已置位）。
                clearPlayerSamplingBlock();
                void refreshPlayerTime(
                  nextSnapshot.restoredWorkspace?.subtitle?.videoKey ?? null,
                );
                return nextSnapshot;
              });
            },
            onBindIdentifier: (value) => {
              return runAction(
                t(uiLanguage, "toast.sessionBound"),
                async () => {
                  const nextSnapshot = await sessionCoordinator.bind({
                    kind: "identifier",
                    value,
                  });
                  currentPage = null;
                  currentTimeMs = undefined;
                  return nextSnapshot;
                },
              );
            },
            onDelete: (sessionId) => {
              return guardReadOnly(async () => {
                return runAction("会话已移入回收站", async () => {
                  const target = snapshot.sessions.find(
                    (session) => session.sessionId === sessionId,
                  );
                  await stopRunsForSession(sessionId);
                  const next = await sessionCoordinator.delete(sessionId);
                  if (target && isSessionVideoBound(target)) {
                    // Background cancellation is best-effort cleanup after the
                    // local transaction. A stale page/SW channel must never
                    // block or roll back a confirmed local delete.
                    void cancelSpeechForVideo(target.videoKey).catch(
                      () => undefined,
                    );
                  }
                  return next;
                });
              });
            },
            onDeleteMany: (sessionIds) => {
              return guardReadOnly(async () => {
                return runAction(
                  `${sessionIds.length} 个会话已移入回收站`,
                  async () => {
                    const videoKeys = new Set(
                      snapshot.sessions
                        .filter((session) =>
                          sessionIds.includes(session.sessionId),
                        )
                        .filter(isSessionVideoBound)
                        .map((session) => session.videoKey),
                    );
                    for (const sessionId of sessionIds) {
                      await stopRunsForSession(sessionId);
                    }
                    const next =
                      await sessionCoordinator.deleteMany(sessionIds);
                    for (const videoKey of videoKeys) {
                      void cancelSpeechForVideo(videoKey).catch(
                        () => undefined,
                      );
                    }
                    return next;
                  },
                );
              });
            },
            onArchive: (sessionId) => {
              return runAction("会话已归档", async () => {
                const target = snapshot.sessions.find(
                  (session) => session.sessionId === sessionId,
                );
                if (target && isSessionVideoBound(target)) {
                  await cancelSpeechForVideo(target.videoKey);
                }
                await stopRunsForSession(sessionId);
                const projection = workspaceProjection.workspace.sessions.find(
                  (session) => session.sessionId === sessionId,
                );
                return sessionCoordinator.archive(
                  sessionId,
                  projection?.branches.map((branch) => branch.branchId) ?? [],
                  ROOT_ARCHIVE_FOLDER_ID,
                );
              });
            },
            onArchiveMany: (sessionIds) => {
              return runAction(
                `${sessionIds.length} 个会话已归档`,
                async () => {
                  const selected = sessionIds.map((sessionId) => ({
                    branchIds:
                      workspaceProjection.workspace.sessions
                        .find((session) => session.sessionId === sessionId)
                        ?.branches.map((branch) => branch.branchId) ?? [],
                    sessionId,
                  }));
                  const videoKeys = new Set(
                    snapshot.sessions
                      .filter((session) =>
                        sessionIds.includes(session.sessionId),
                      )
                      .filter(isSessionVideoBound)
                      .map((session) => session.videoKey),
                  );
                  for (const videoKey of videoKeys) {
                    await cancelSpeechForVideo(videoKey);
                  }
                  for (const sessionId of sessionIds) {
                    await stopRunsForSession(sessionId);
                  }
                  return sessionCoordinator.archiveMany(
                    selected,
                    ROOT_ARCHIVE_FOLDER_ID,
                  );
                },
              );
            },
            onRename: (sessionId, title) => {
              return guardReadOnly(async () =>
                runAction("会话名称已保存", () =>
                  sessionCoordinator.rename(sessionId, title),
                ),
              );
            },
            onTogglePinned: (sessionId, pinned) => {
              return runAction(pinned ? "会话已置顶" : "会话已取消置顶", () =>
                sessionCoordinator.setPinned(sessionId, pinned),
              );
            },
            onSelect: (sessionId) => {
              return runAction(
                t(uiLanguage, "toast.sessionRestored"),
                async () => {
                  const nextSnapshot =
                    await sessionCoordinator.select(sessionId);
                  surface = "workspace";
                  return nextSnapshot;
                },
              );
            },
            pinnedSessionIds: workspaceProjection.workspace.sessions
              .filter((session) => session.pinned)
              .map((session) => session.sessionId),
            sessions: snapshot.sessions.map((session) => ({
              ...session,
              title:
                workspaceProjection.workspace.sessions.find(
                  (projection) => projection.sessionId === session.sessionId,
                )?.title ?? session.title,
            })),
          }}
          subtitleAcquisition={
            restoredWorkspace && isSessionVideoBound(restoredWorkspace.session)
              ? {
                  uiLanguage,
                  hasExistingSubtitle:
                    subtitle !== undefined && subtitle !== null,
                  onAcquire: () => {
                    void guardReadOnly(async () => {
                      const result = await subtitleCoordinator.acquire(
                        restoredWorkspace.session.videoKey,
                      );
                      if (result.phase !== "success") {
                        return;
                      }
                      try {
                        snapshot = await sessionCoordinator.initialize();
                        message = {
                          kind: "status",
                          text: t(uiLanguage, "toast.subtitleAcquired", {
                            count: result.rowCount ?? 0,
                          }),
                        };
                        subtitleCoordinator.reset();
                        void refreshPlayerTime(
                          snapshot.restoredWorkspace?.subtitle?.videoKey ??
                            null,
                        );
                      } catch {
                        message = {
                          kind: "error",
                          text: t(
                            uiLanguage,
                            "toast.subtitleSavedRefreshFailed",
                          ),
                        };
                        renderSnapshot();
                      }
                    });
                  },
                  onCancel: () => {
                    subtitleCoordinator.cancel();
                  },
                  onDiscover: () => {
                    void subtitleCoordinator.discover(
                      restoredWorkspace.session.videoKey,
                    );
                  },
                  onSelect: (trackId) => {
                    subtitleCoordinator.select(trackId);
                  },
                  state: acquisitionState,
                }
              : undefined
          }
          speechAcquisition={
            restoredWorkspace && isSessionVideoBound(restoredWorkspace.session)
              ? {
                  uiLanguage,
                  activity: speechActivity,
                  completedChunks: speechCompletedChunks,
                  errorMessage: speechErrorMessage,
                  hasConfiguredKey: groqKeyProjection.configured,
                  hasExistingSubtitle:
                    subtitle !== undefined && subtitle !== null,
                  languageMode: requestedSpeechLanguage(),
                  onCancel: () => {
                    const owner = speechOwner;
                    if (!owner) return;
                    speechErrorMessage = undefined;
                    renderSnapshot();
                    void speechClient
                      .cancel(owner)
                      .then((cancelled) => {
                        if (!cancelled) {
                          speechErrorMessage = t(
                            uiLanguage,
                            "toast.speechStopUnconfirmed",
                          );
                          renderSnapshot();
                          return;
                        }
                        speechOwner = null;
                        speechPhase = "idle";
                        speechPollRevision += 1;
                        speechErrorMessage = undefined;
                        renderSnapshot();
                      })
                      .catch((error: unknown) => {
                        speechErrorMessage =
                          error instanceof ChromeSpeechRuntimeError
                            ? error.message
                            : "停止请求失败，任务仍可能继续运行；请重试。";
                        renderSnapshot();
                      });
                  },
                  onLanguageModeChange: (value) => {
                    speechLanguage =
                      value === "zh"
                        ? "中文"
                        : value === "en"
                          ? "英文"
                          : value === "other"
                            ? "其他"
                            : "混合";
                    void persistUiPreferences().catch((error: unknown) => {
                      message = {
                        kind: "error",
                        text: safeSessionActionMessage(error, uiLanguage),
                      };
                      renderSnapshot();
                    });
                    renderSnapshot();
                  },
                  onRoutingModeChange: (value) => {
                    speechRoutingMode = value;
                    void persistUiPreferences().catch((error: unknown) => {
                      message = {
                        kind: "error",
                        text: safeSessionActionMessage(error, uiLanguage),
                      };
                      renderSnapshot();
                    });
                    renderSnapshot();
                  },
                  onStart: () => {
                    void guardReadOnly(async () => {
                      speechPhase = "preparing";
                      speechErrorMessage = undefined;
                      renderSnapshot();
                      try {
                        const owner = await speechClient.start({
                          requestedLanguageMode: requestedSpeechLanguage(),
                          routingMode: speechRoutingMode,
                          videoKey: restoredWorkspace.session.videoKey,
                        });
                        speechOwner = owner;
                        speechRunningSessions.add(
                          restoredWorkspace.session.sessionId,
                        );
                        renderSnapshot();
                        const revision = ++speechPollRevision;
                        void observeSpeechTask(owner, revision);
                      } catch (error) {
                        speechPhase = "error";
                        speechErrorMessage =
                          error instanceof ChromeSpeechRuntimeError
                            ? error.message
                            : "语音转字幕未能启动，请重试。";
                        renderSnapshot();
                      }
                    });
                  },
                  phase: speechPhase,
                  routingMode: speechRoutingMode,
                  rowCount: speechRowCount,
                  totalChunks: speechTotalChunks,
                }
              : undefined
          }
          settings={settings}
          timeline={timeline}
          trash={trash}
          utilityView={currentUtilityView()}
        />,
        sidePanelRoot,
      );
    };

    const runAction = async (
      successMessage: string,
      action: () => Promise<SessionWorkspaceSnapshot>,
    ): Promise<boolean> => {
      if (busy) {
        message = { kind: "error", text: "当前操作尚未完成，请稍候。" };
        renderSnapshot();
        return false;
      }
      const previousActiveSessionId =
        snapshot.restoredWorkspace?.session.sessionId ?? null;
      busy = true;
      message = undefined;
      renderSnapshot();
      try {
        snapshot = await action();
      } catch (error) {
        message = {
          kind: "error",
          text: safeSessionActionMessage(error, uiLanguage),
        };
        busy = false;
        renderSnapshot();
        return false;
      }
      if (
        (snapshot.restoredWorkspace?.session.sessionId ?? null) !==
        previousActiveSessionId
      ) {
        // 切换会话：不停止旧会话进行中的生成——任务在 Service Worker 后台
        // 继续运行，run/partialOutput 持久化在 IndexedDB；切回时 loadArtifactState
        // 通过 queryActiveRuns 恢复运行状态，流式事件继续增量刷新。
        disableTimelineSync();
      }
      subtitleCoordinator.reset();
      let refreshFailed = false;
      try {
        await loadChatState();
      } catch {
        resetChatState();
        refreshFailed = true;
      }
      try {
        await loadArtifactState();
      } catch {
        resetArtifactState();
        refreshFailed = true;
      }
      try {
        await refreshProductProjection();
      } catch {
        try {
          await refreshProductProjection();
        } catch {
          refreshFailed = true;
        }
      }
      try {
        await attachActiveSpeechForCurrentWorkspace();
      } catch {
        refreshFailed = true;
      }
      message = refreshFailed
        ? {
            kind: "error",
            text: t(uiLanguage, "toast.partialRefreshFailed", {
              successMessage,
            }),
          }
        : { kind: "status", text: successMessage };
      busy = false;
      renderSnapshot();
      return true;
    };

    await loadChatState();
    try {
      await loadArtifactState();
    } catch {
      resetArtifactState();
    }
    await attachActiveSpeechForCurrentWorkspace();
    try {
      await refreshBatchJobs();
    } catch {
      // Batch history is optional for opening the subtitle workspace.
    }
    let autoRebindInFlight = false;
    let autoRebindRetryTimer: ReturnType<typeof globalThis.setTimeout> | null =
      null;
    let autoRebindAttempts = 0;
    let autoRebindMismatch = false;
    const attemptAutoRebind = async (): Promise<void> => {
      // Ticket 02：stale 后自动重绑。v16 起会话模式不再有「同步当前页面」
      // 入口，若不自动重绑，用户从非视频页打开面板再导航/切回绑定视频页
      // 后，定位/同步按钮将永久灰化。仅当新活动标签解析出的视频与当前
      // 字幕绑定一致时恢复；解析失败或不同视频保持灰（不自动切换会话）。
      const subtitle = snapshot.restoredWorkspace?.subtitle;
      if (subtitle === undefined || subtitle === null) return;
      if (autoRebindInFlight) return;
      let startTabId: number | null = null;
      try {
        startTabId = await chromeApi.tabs.getActiveTabId();
      } catch {
        // 读取失败时跳过在途变化检测，按单次重绑处理。
      }
      autoRebindInFlight = true;
      try {
        // 修复(T-B2):改用稳定等待同步(连续两次 canonicalUrl 相同才消费)。
        // 此前单次 sync 会在 B 站 URL 规范化中间态(长地址→裸 BV→?p=N)或
        // 新打开标签页加载途中误解析(裸 BV 无 p → 误判 P1 / 接口未就绪),
        // 导致 mismatch/失败后进入短重试窗口,耗尽后依赖下一次页面事件,
        // 表现为同步/定位按钮常驻灰、黄框持续。
        const synced = await syncStableCurrentPage(currentPageSync);
        if (synced.video.videoKey !== subtitle.videoKey) {
          // 解析到其他视频：保持灰，并让 disabled 原因反映「其他视频」。
          if (!autoRebindMismatch) {
            autoRebindMismatch = true;
            renderSnapshot();
          }
          // URL 归一化瞬态防护：mismatch 也退避重试(上限 4 次)，
          // 覆盖短链/?p= 归一化期间与选集页跳转的过渡窗口。
          autoRebindAttempts += 1;
          if (
            autoRebindAttempts <= AUTO_REBIND_MISMATCH_MAX_ATTEMPTS &&
            autoRebindRetryTimer === null
          ) {
            autoRebindRetryTimer = globalThis.setTimeout(() => {
              autoRebindRetryTimer = null;
              void attemptAutoRebind();
            }, 1_500);
          }
          return;
        }
        autoRebindMismatch = false;
        currentPage = synced;
        pageIsStale = false;
        clearPlayerSamplingBlock();
        autoRebindAttempts = 0;
        try {
          staleMonitor.markSynchronized(
            synced.tabId,
            synced.video.canonicalUrl,
          );
        } catch {
          // markSynchronized 失败不阻塞重绑（stale 状态由 pageIsStale 承载）。
        }
        renderSnapshot();
      } catch {
        // 当前页尚不可解析（如新打开的视频页 content script 未就绪）：
        // 指数退避重试上限 8 次(累计约 40s)，覆盖新标签页加载窗口；
        // 耗尽后仍保持灰，等待下一次页面事件重新触发。
        if (autoRebindMismatch) {
          // 解析失败 ≠ 当前页是其他视频：恢复「未连接」原因。
          autoRebindMismatch = false;
          renderSnapshot();
        }
        autoRebindAttempts += 1;
        if (
          autoRebindAttempts <= AUTO_REBIND_MAX_ATTEMPTS &&
          autoRebindRetryTimer === null
        ) {
          const delayMs =
            AUTO_REBIND_RETRY_DELAYS[
              Math.min(
                autoRebindAttempts - 1,
                AUTO_REBIND_RETRY_DELAYS.length - 1,
              )
            ] ?? 15_000;
          autoRebindRetryTimer = globalThis.setTimeout(() => {
            autoRebindRetryTimer = null;
            void attemptAutoRebind();
          }, delayMs);
        }
      } finally {
        autoRebindInFlight = false;
        // 在途期间活动标签再次变化（快速切走-切回）：立即重触发，
        // 否则本次解析结果会覆盖用户最后意图，且要等下一次页面事件。
        if (startTabId !== null) {
          try {
            const activeTabId = await chromeApi.tabs.getActiveTabId();
            if (activeTabId !== startTabId && !autoRebindInFlight) {
              void attemptAutoRebind();
            }
          } catch {
            // 读取失败：保持现状，等待下一次页面事件。
          }
        }
      }
    };
    const staleMonitor = new PageStaleMonitor(chromeApi.tabs, (state) => {
      pageIsStale = state.stale;
      if (state.stale) {
        disableTimelineSync();
        clearPlayerSamplingBlock();
        playerSamplingBlockedVideoKey =
          snapshot.restoredWorkspace?.subtitle?.videoKey ?? null;
        void attemptAutoRebind();
      }
      renderSnapshot();
    });
    try {
      await staleMonitor.start();
    } catch {
      // Current-page actions will remain unavailable until an explicit sync.
      currentPage = null;
      currentTimeMs = undefined;
    }

    globalThis.addEventListener(
      "pagehide",
      () => {
        speechPollRevision += 1;
        stopTimelineSync();
        staleMonitor.stop();
        if (autoRebindRetryTimer !== null) {
          globalThis.clearTimeout(autoRebindRetryTimer);
          autoRebindRetryTimer = null;
        }
        clearPlayerSamplingBlock();
        remoteMarkdownImageClient.dispose();
        revokeChatAttachmentObjectUrls();
        revokeChatDraftAttachmentObjectUrls();
        unsubscribeChat();
        unsubscribeArtifacts();
        unsubscribeBatch();
        database?.close();
        database = undefined;
      },
      { once: true },
    );
    renderSnapshot();
    void refreshPlayerTime(
      snapshot.restoredWorkspace?.subtitle?.videoKey ?? null,
    );
  } catch {
    database?.close();
    render(<AiChatShell />, sidePanelRoot);
  }
}

void renderSidePanel();
