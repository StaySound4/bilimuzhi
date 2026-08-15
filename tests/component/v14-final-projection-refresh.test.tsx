import { cleanup, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  SessionWorkspaceCoordinatorDependencies,
  SessionWorkspaceSnapshot,
} from "../../src/application/session-workspace";
import type { ChromeBackupDownloadResult } from "../../src/infrastructure/chrome-backup-download";
import type { AiChatShellProps } from "../../src/ui/ai-chat-shell";

interface RepositoryInstance {
  readonly database: IDBDatabase;
  readonly kind: "restoration" | "session" | "trash";
}

interface ProjectionRepositoryInstance {
  readonly database: IDBDatabase;
  readonly load: () => Promise<typeof emptyProjection>;
}

const startupDatabase = Object.freeze({
  close: vi.fn(),
  label: "startup-database",
});
const reopenedDatabase = Object.freeze({
  close: vi.fn(),
  label: "reopened-database",
});
const openBilimuzhiDatabase = vi
  .fn<() => Promise<IDBDatabase>>()
  .mockResolvedValueOnce(startupDatabase as unknown as IDBDatabase)
  .mockResolvedValueOnce(reopenedDatabase as unknown as IDBDatabase);

const repositoryInstances: RepositoryInstance[] = [];
const projectionRepositoryInstances: ProjectionRepositoryInstance[] = [];
let coordinatorDependencies:
  SessionWorkspaceCoordinatorDependencies | undefined;
let latestShellProps: AiChatShellProps | undefined;

const backupArtifact = Object.freeze({
  fileName: "muzhi-v14-production.json",
  json: '{"version":14}',
  notice: "备份成功",
});
const finalDownload = Object.freeze({
  cancelled: false as const,
  downloadId: 314,
  filename: "D:\\Bilimuzhi备份\\Bilimuzhi-v14-final.json",
});
const exportBackup = vi.fn(async () => backupArtifact);
const exportJson = vi.fn<
  (input: {
    readonly fileName: string;
    readonly json: string;
  }) => Promise<ChromeBackupDownloadResult>
>(async () => finalDownload);
const openContainingFolder = vi.fn<(downloadId: number) => Promise<void>>(
  async () => undefined,
);
const createChromeBackupDownloadRuntime = vi.fn(() => ({
  exportJson,
  openContainingFolder,
}));
const clipboardWriteText = vi.fn<(text: string) => Promise<void>>(
  async () => undefined,
);

const deletedSnapshot: SessionWorkspaceSnapshot = Object.freeze({
  restoredWorkspace: null,
  sessions: Object.freeze([]),
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

const startupProjectionLoad = vi
  .fn<() => Promise<typeof emptyProjection>>()
  .mockResolvedValueOnce(emptyProjection)
  .mockRejectedValue(
    new Error("CONNECTION_INVALID: startup projection repository is stale"),
  );
const reopenedProjectionLoad = vi.fn<() => Promise<typeof emptyProjection>>(
  async () => emptyProjection,
);

function asyncProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return vi.fn(async () => undefined);
    },
  });
}

function CaptureShell(props: AiChatShellProps): ComponentChildren {
  latestShellProps = props;
  return <main aria-label="v14-production-projection-refresh" />;
}

function repositoryClass(kind: RepositoryInstance["kind"]) {
  return class {
    constructor(database: IDBDatabase) {
      const instance = asyncProxy({
        database,
        kind,
      }) as unknown as RepositoryInstance;
      repositoryInstances.push(instance);
      return instance;
    }
  };
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: Object.freeze({ writeText: clipboardWriteText }),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:chrome-extension://muzhi/legacy-anchor",
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );

  const storageValues: Record<string, unknown> = {};
  const storage = Object.freeze({
    async get(key: string) {
      return key in storageValues ? { [key]: storageValues[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(storageValues, items);
    },
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
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
    },
  });

  vi.doMock("../../src/ui/ai-chat-shell", () => ({
    AiChatShell: CaptureShell,
  }));
  vi.doMock("../../src/application/session-workspace", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/application/session-workspace")
    >("../../src/application/session-workspace");
    return {
      ...actual,
      createSessionWorkspaceCoordinator: (
        dependencies: SessionWorkspaceCoordinatorDependencies,
      ) => {
        coordinatorDependencies = dependencies;
        return asyncProxy({
          delete: vi.fn(async () => {
            const reopenForRetry = dependencies.lifecycle?.reopenForRetry;
            if (!reopenForRetry) {
              throw new Error(
                "fixture expected CONNECTION_INVALID lifecycle recovery",
              );
            }
            await reopenForRetry();
            return deletedSnapshot;
          }),
          initialize: vi.fn(async () => deletedSnapshot),
          saveView: vi.fn(async () => undefined),
        });
      },
    };
  });
  vi.doMock("../../src/application/backup", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/application/backup")
    >("../../src/application/backup");
    return {
      ...actual,
      createV12BackupRuntime: () =>
        asyncProxy({
          exportBackup,
          previewImport: vi.fn(),
        }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-backup-download", () => ({
    createChromeBackupDownloadRuntime,
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
  vi.doMock("../../src/infrastructure/chrome-artifact-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-artifact-runtime")
    >("../../src/infrastructure/chrome-artifact-runtime");
    return {
      ...actual,
      createChromeArtifactRuntimeClient: () =>
        asyncProxy({
          list: vi.fn(async () => []),
          subscribe: vi.fn(() => vi.fn()),
        }),
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
          listThreads: vi.fn(async () => []),
          subscribe: vi.fn(() => vi.fn()),
        }),
    };
  });
  vi.doMock(
    "../../src/infrastructure/chrome-remote-markdown-image-runtime",
    () => ({
      createChromeRemoteMarkdownImageRuntimeClient: () => ({
        dispose: vi.fn(),
        load: vi.fn(async () => {
          throw new Error("remote images are outside this fixture");
        }),
      }),
    }),
  );
  vi.doMock("../../src/infrastructure/chrome-batch-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-batch-runtime")
    >("../../src/infrastructure/chrome-batch-runtime");
    return {
      ...actual,
      createChromeBatchRuntimeClient: () =>
        asyncProxy({
          listJobs: vi.fn(async () => []),
          subscribe: vi.fn(() => vi.fn()),
        }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-player-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-player-runtime")
    >("../../src/infrastructure/chrome-player-runtime");
    return {
      ...actual,
      createChromePlayerRuntimeClient: () =>
        asyncProxy({ readTime: vi.fn(async () => null) }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-speech-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-speech-runtime")
    >("../../src/infrastructure/chrome-speech-runtime");
    return {
      ...actual,
      createChromeSpeechRuntimeClient: () =>
        asyncProxy({ active: vi.fn(async () => []) }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-subtitle-runtime", () => ({
    createChromeSubtitleRuntimeClient: () => asyncProxy(),
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
    openBilimuzhiDatabase,
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
        constructor(database: IDBDatabase) {
          const instance = Object.freeze({
            database,
            load:
              database === (startupDatabase as unknown as IDBDatabase)
                ? startupProjectionLoad
                : reopenedProjectionLoad,
          });
          projectionRepositoryInstances.push(instance);
          return instance;
        }
      },
    }),
  );
  vi.doMock("../../src/infrastructure/indexeddb/attachment-repository", () => ({
    createIndexedDbAttachmentRepository: () =>
      asyncProxy({
        listByMessage: vi.fn(async () => []),
        maintainOwnership: vi.fn(async () => ({ deletedAttachmentIds: [] })),
        readStatistics: vi.fn(async () => ({ attachmentCount: 0 })),
      }),
  }));
  vi.doMock("../../src/infrastructure/indexeddb/archive-repository", () => ({
    IndexedDbArchiveRepository: class {
      constructor() {
        return asyncProxy();
      }
    },
  }));
  vi.doMock("../../src/infrastructure/indexeddb/retention-repository", () => ({
    IndexedDbRetentionRepository: class {
      constructor() {
        return asyncProxy();
      }
    },
  }));
  vi.doMock("../../src/infrastructure/indexeddb/session-repository", () => ({
    IndexedDbSessionRepository: repositoryClass("session"),
  }));
  vi.doMock(
    "../../src/infrastructure/indexeddb/workspace-restoration-repository",
    () => ({
      IndexedDbWorkspaceRestorationRepository: repositoryClass("restoration"),
    }),
  );
  vi.doMock("../../src/infrastructure/indexeddb/trash-repository", () => ({
    IndexedDbTrashRepository: repositoryClass("trash"),
  }));

  await import("../../src/entries/sidepanel");
  await waitFor(() => {
    expect(coordinatorDependencies).toBeDefined();
    expect(latestShellProps?.sessionDrawer?.onDelete).toBeTypeOf("function");
    expect(startupProjectionLoad).toHaveBeenCalledOnce();
  });
});

afterEach(() => {
  clipboardWriteText.mockClear();
  exportJson.mockClear();
  openContainingFolder.mockClear();
  vi.mocked(HTMLAnchorElement.prototype.click).mockClear();
});

afterAll(() => {
  globalThis.dispatchEvent(new Event("pagehide"));
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/ui/ai-chat-shell");
});

describe("v14 final SidePanel projection refresh after lifecycle recovery", () => {
  it("A5 reloads the deleted workspace projection from the reopened database and reports pure success", async () => {
    const onDelete = latestShellProps?.sessionDrawer?.onDelete;
    expect(onDelete).toBeTypeOf("function");

    const deleted = await onDelete!("session-with-invalid-connection");

    expect(deleted).toBe(true);
    expect(openBilimuzhiDatabase).toHaveBeenCalledTimes(2);
    expect.soft(startupProjectionLoad).toHaveBeenCalledOnce();
    expect.soft(projectionRepositoryInstances).toContainEqual({
      database: reopenedDatabase,
      load: reopenedProjectionLoad,
    });
    expect.soft(reopenedProjectionLoad).toHaveBeenCalled();
    expect.soft(latestShellProps?.actionMessage).toEqual({
      kind: "status",
      text: "会话已移入回收站",
    });
    expect
      .soft(latestShellProps?.actionMessage?.text)
      .not.toContain("部分界面未刷新");
    expect
      .soft(latestShellProps?.actionMessage?.text)
      .not.toContain("请重新打开侧栏");
  });
});
