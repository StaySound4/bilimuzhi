/**
 * 切片 4 附件时间来源接线：轮询读到的播放器时间必须进入附件 currentTimeMs，
 * 并在待发送队列与消息附件中显示为紧凑时间文本（用户症状：恒显示 0s）。
 */
import { cleanup, screen, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { SessionWorkspaceSnapshot } from "../../src/application/session-workspace";
import type { AiChatShellProps } from "../../src/ui/ai-chat-shell";
import { ChatWorkspace } from "../../src/ui/chat/chat-workspace";
import {
  createBranchPlacement,
  createChatThread,
  createImageAttachment,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type ImageAttachment,
} from "../../src/domain";

const videoKey = "bvid:BV1Q541167Qg:cid:1:p:1" as const;
const sessionId = "session-attachment-time";
const branchId = "branch-attachment-time";
const subtitleId = "subtitle-attachment-time";

const session = createSession({
  activeBranchId: branchId,
  createdAt: 1,
  customTitle: false,
  lastActivityAt: 1,
  selectionRevision: 1,
  sessionId,
  title: "attachment time fixture",
  updatedAt: 1,
  videoBound: true,
  videoKey,
});

const branch = createSubtitleBranch({
  activeSubtitleId: subtitleId,
  branchId,
  contextRevision: 7,
  createdAt: 1,
  detectedLanguage: null,
  language: "zh-CN",
  lastOpenedAt: 1,
  lastSelectedAt: 1,
  requestedLanguageMode: null,
  sessionId,
  source: "bilibili",
  title: "attachment time fixture",
  updatedAt: 1,
  videoKey,
});

const subtitle = createSubtitleSnapshot({
  branchId,
  contentHash: "sha256:attachment-time-fixture",
  createdAt: 1,
  language: "zh-CN",
  rows: [{ endMs: 1_000, lineId: "line-1", startMs: 0, text: "字幕" }],
  sessionId,
  source: "bilibili",
  status: "active",
  subtitleId,
  videoKey,
});

const placement = createBranchPlacement({
  branchId,
  deletionReason: null,
  location: "workspace",
  order: 0,
  purgeAfter: null,
  retentionStartedAt: null,
  sessionId,
  trashedAt: null,
  trashOrigin: null,
  trashOriginFolderId: null,
  trashOriginPathSnapshot: null,
});

const snapshot: SessionWorkspaceSnapshot = Object.freeze({
  restoredWorkspace: Object.freeze({
    activeMode: "chat",
    branch,
    placement,
    scrollTopByMode: Object.freeze({
      chat: 0,
      segments: 0,
      summary: 0,
      timeline: 0,
    }),
    session,
    subtitle,
  }),
  sessions: Object.freeze([session]),
});

const thread = createChatThread({
  branchId,
  chatThreadId: "thread-attachment-time",
  conversationRevision: 1,
  createdAt: 1,
  order: 0,
  sessionId,
  subtitleId,
  title: "附件时间",
  updatedAt: 1,
});

const emptyProjection = Object.freeze({
  archive: Object.freeze({
    folders: Object.freeze([
      Object.freeze({
        childFolderIds: Object.freeze([]),
        folderId: "archive-root",
        isRoot: true,
        order: 0,
        parentFolderId: null,
        sessionIds: Object.freeze([]),
        title: "归档",
      }),
    ]),
    sessions: Object.freeze([]),
  }),
  trash: Object.freeze({ sessions: Object.freeze([]) }),
  workspace: Object.freeze({ sessions: Object.freeze([]) }),
});

let latestShellProps: AiChatShellProps | undefined;
let chatSubscription: ((event: unknown) => void) | undefined;

function ProductionConsumers(props: AiChatShellProps): ComponentChildren {
  latestShellProps = props;
  const { chat } = props;
  return (
    <main>
      {chat ? (
        <section aria-label="production-chat-consumer">
          <ChatWorkspace {...chat} />
        </section>
      ) : null}
    </main>
  );
}

function asyncProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return vi.fn(async () => undefined);
    },
  });
}

const clipboardWrite = vi.fn<(text: string) => Promise<void>>(
  async () => undefined,
);
const stageImages = vi.fn();
const readTime = vi.fn<(videoKey: string) => Promise<number | null>>(
  async () => 65_000,
);

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: Object.freeze({ writeText: clipboardWrite }),
  });
  // jsdom 未实现 object URL；sidepanel 用它为缩略图生成 blob URL。
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:attachment-time-mock",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });

  const storageValues: Record<string, unknown> = {};
  const storage = Object.freeze({
    async get(key: string) {
      return key in storageValues ? { [key]: storageValues[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(storageValues, items);
    },
  });
  const chromeValue = {
    permissions: {
      contains: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn(async () => undefined),
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: chromeValue,
  });

  vi.doMock("../../src/ui/ai-chat-shell", () => ({
    AiChatShell: ProductionConsumers,
  }));
  vi.doMock("../../src/application/session-workspace", () => ({
    createSessionWorkspaceCoordinator: () =>
      asyncProxy({
        bind: vi.fn(async () => snapshot),
        initialize: vi.fn(async () => snapshot),
        saveView: vi.fn(async () => undefined),
      }),
  }));
  vi.doMock("../../src/infrastructure/chrome-sidepanel-api", () => ({
    createChromeSidePanelApi: () => ({ storage, tabs: asyncProxy() }),
  }));
  vi.doMock("../../src/infrastructure/current-page-sync", () => ({
    createCurrentPageSyncBridge: () => ({
      sync: vi.fn(async () => {
        throw new Error("fixture has no current page");
      }),
    }),
  }));
  vi.doMock("../../src/infrastructure/chrome-player-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-player-runtime")
    >("../../src/infrastructure/chrome-player-runtime");
    return {
      ...actual,
      createChromePlayerRuntimeClient: () => asyncProxy({ readTime }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-chat-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-chat-runtime")
    >("../../src/infrastructure/chrome-chat-runtime");
    return {
      ...actual,
      createChromeChatRuntimeClient: () =>
        asyncProxy({
          listMessages: vi.fn(async () => []),
          listRuns: vi.fn(async () => []),
          listThreads: vi.fn(async () => [thread]),
          subscribe: vi.fn((listener: (event: unknown) => void) => {
            chatSubscription = listener;
            return vi.fn();
          }),
        }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-artifact-runtime", () => ({
    createChromeArtifactRuntimeClient: () =>
      asyncProxy({
        clear: vi.fn(async () => null),
        generate: vi.fn(),
        list: vi.fn(async () => []),
        stop: vi.fn(async () => null),
        subscribe: vi.fn(() => vi.fn()),
      }),
  }));
  vi.doMock("../../src/infrastructure/chrome-speech-runtime", () => ({
    createChromeSpeechRuntimeClient: () =>
      asyncProxy({ active: vi.fn(async () => []) }),
  }));
  vi.doMock("../../src/infrastructure/chrome-subtitle-runtime", () => ({
    createChromeSubtitleRuntimeClient: () => asyncProxy(),
  }));
  vi.doMock("../../src/infrastructure/chrome-batch-runtime", () => ({
    createChromeBatchRuntimeClient: () =>
      asyncProxy({
        listJobs: vi.fn(async () => []),
        subscribe: vi.fn(() => vi.fn()),
      }),
  }));
  vi.doMock("../../src/infrastructure/chrome-backup-download", () => ({
    createChromeBackupDownloadRuntime: () =>
      asyncProxy({ exportJson: vi.fn(), openContainingFolder: vi.fn() }),
  }));
  vi.doMock("../../src/infrastructure/page-stale-monitor", () => ({
    PageStaleMonitor: class {
      markSynchronized() {}
      async start() {}
      stop() {}
    },
  }));
  vi.doMock("../../src/infrastructure/indexeddb/muzhi-database", () => ({
    ROOT_ARCHIVE_FOLDER_ID: "archive-root",
    createV12BackupDataPort: () => asyncProxy(),
    openBilimuzhiDatabase: vi.fn(async () => ({ close: vi.fn() })),
  }));
  vi.doMock(
    "../../src/infrastructure/indexeddb/single-subtitle-migration",
    () => ({
      inspectSingleSubtitleMigration: vi.fn(async () => ({
        requiresConfirmation: false,
      })),
      migrateToSingleSubtitleContexts: vi.fn(async () => undefined),
    }),
  );
  vi.doMock(
    "../../src/infrastructure/indexeddb/workspace-projection-repository",
    () => ({
      IndexedDbWorkspaceProjectionRepository: class {
        async load() {
          return emptyProjection;
        }
      },
    }),
  );
  vi.doMock("../../src/infrastructure/indexeddb/attachment-repository", () => ({
    createIndexedDbAttachmentRepository: () =>
      asyncProxy({
        listByMessage: vi.fn(async () => []),
        maintainOwnership: vi.fn(async () => ({
          deletedAttachmentIds: [],
        })),
        readStatistics: vi.fn(async () => ({ attachmentCount: 0 })),
        stageImages: vi.fn(async (input: unknown) => {
          const value = input as {
            readonly files: readonly File[];
            readonly owner: {
              readonly branchId: string;
              readonly chatThreadId: string;
              readonly currentTimeMs: number;
              readonly sessionId: string;
              readonly subtitleContextRevision: number;
              readonly subtitleId: string;
              readonly videoKey: string;
            };
          };
          stageImages(value.owner.currentTimeMs);
          return value.files.map((file, index) =>
            createImageAttachment({
              attachmentId: `attachment-time-${index}`,
              blob: new Blob([file], { type: file.type }),
              branchId: value.owner.branchId,
              chatThreadId: value.owner.chatThreadId,
              currentTimeMs: value.owner.currentTimeMs,
              height: 10,
              messageId: null,
              mimeType: file.type as ImageAttachment["mimeType"],
              sessionId: value.owner.sessionId,
              subtitleContextRevision: value.owner.subtitleContextRevision,
              subtitleId: value.owner.subtitleId,
              thumbnailBlob: new Blob([file], { type: file.type }),
              videoKey: value.owner.videoKey as typeof videoKey,
              width: 10,
            }),
          );
        }),
      }),
  }));
  vi.doMock(
    "../../src/infrastructure/indexeddb/workspace-restoration-repository",
    () => ({
      IndexedDbWorkspaceRestorationRepository: class {
        async route() {
          return null;
        }
      },
    }),
  );
  for (const [modulePath, exportName] of [
    [
      "../../src/infrastructure/indexeddb/archive-repository",
      "IndexedDbArchiveRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/trash-repository",
      "IndexedDbTrashRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/retention-repository",
      "IndexedDbRetentionRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/session-repository",
      "IndexedDbSessionRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/subtitle-repository",
      "IndexedDbSubtitleRepository",
    ],
  ] as const) {
    vi.doMock(modulePath, () => ({ [exportName]: class {} }));
  }

  const unhandled: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) =>
    unhandled.push(event.reason);
  globalThis.addEventListener("unhandledrejection", onRejection);
  await import("../../src/entries/sidepanel");
  try {
    await waitFor(() => {
      expect(latestShellProps?.chat).toBeDefined();
      expect(chatSubscription).toBeTypeOf("function");
    });
  } catch (error) {
    console.error(
      "[DEBUG-att] unhandled rejections:",
      unhandled.map((value) => String(value)),
    );
    console.error(
      "[DEBUG-att] latestShellProps keys:",
      latestShellProps === undefined
        ? "undefined"
        : Object.keys(latestShellProps),
    );
    console.error("[DEBUG-att] chatSubscription:", typeof chatSubscription);
    throw error;
  }
  globalThis.removeEventListener("unhandledrejection", onRejection);
});

afterAll(() => {
  globalThis.dispatchEvent(new Event("pagehide"));
  cleanup();
  vi.doUnmock("../../src/ui/ai-chat-shell");
});

describe("v15 附件时间来源 offline（页面未同步 → 轮询不启动）", () => {
  it("页面同步失败、后台轮询从未启动时，添加附件仍主动读取播放器时间（用户症状 1）", async () => {
    const file = new File(["fixture"], "photo.png", { type: "image/png" });
    const chat = latestShellProps?.chat;
    expect(chat).toBeDefined();

    const result = chat!.onAttachImages?.([file]);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
    await waitFor(() => {
      expect(stageImages).toHaveBeenCalledWith(65_000);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "跳转到图片添加时间 01:05" }),
      ).not.toBeNull();
    });
    expect(screen.queryByText("00:00")).toBeNull();
  });
});
