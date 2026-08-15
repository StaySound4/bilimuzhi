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

const initialDatabase = Object.freeze({
  close: vi.fn(),
  label: "initial-database",
});
const reopenedDatabase = Object.freeze({
  close: vi.fn(),
  label: "reopened-database",
});
const openBilimuzhiDatabase = vi
  .fn<() => Promise<IDBDatabase>>()
  .mockResolvedValueOnce(initialDatabase as unknown as IDBDatabase)
  .mockResolvedValueOnce(reopenedDatabase as unknown as IDBDatabase);

const repositoryInstances: RepositoryInstance[] = [];
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

const emptySnapshot: SessionWorkspaceSnapshot = Object.freeze({
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
  return <main aria-label="v14-production-composition" />;
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
          initialize: vi.fn(async () => emptySnapshot),
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
    expect(latestShellProps?.settings?.onOpenBackupExport).toBeTypeOf(
      "function",
    );
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

describe("v14 final real SidePanel production composition", () => {
  it("A5 supplies a retry lifecycle that rebuilds the complete repository bundle from a newly opened database", async () => {
    const lifecycle = coordinatorDependencies?.lifecycle;
    expect(
      lifecycle,
      "A5 product RED: SidePanel omitted lifecycle",
    ).toBeDefined();
    expect(
      lifecycle?.reopenForRetry,
      "A5 product RED: SidePanel omitted lifecycle.reopenForRetry",
    ).toBeTypeOf("function");

    const bundle = await lifecycle!.reopenForRetry();

    expect(openBilimuzhiDatabase).toHaveBeenCalledTimes(2);
    expect(reopenedDatabase).not.toBe(initialDatabase);
    expect(bundle).toEqual({
      repository: expect.objectContaining({
        database: reopenedDatabase,
        kind: "session",
      }),
      restorationRepository: expect.objectContaining({
        database: reopenedDatabase,
        kind: "restoration",
      }),
      trashRepository: expect.objectContaining({
        database: reopenedDatabase,
        kind: "trash",
      }),
    });
    expect(
      repositoryInstances.filter(
        ({ database }) =>
          database === (reopenedDatabase as unknown as IDBDatabase),
      ),
    ).toHaveLength(3);
    expect(bundle.repository).not.toBe(coordinatorDependencies?.repository);
    expect(bundle.restorationRepository).not.toBe(
      coordinatorDependencies?.restorationRepository,
    );
    expect(bundle.trashRepository).not.toBe(
      coordinatorDependencies?.trashRepository,
    );
  });

  it("A8 routes a successful export through the Chrome runtime and exposes the exact completed path actions", async () => {
    const settingsBefore = latestShellProps?.settings;
    expect(settingsBefore?.onOpenBackupExport).toBeTypeOf("function");
    exportJson.mockReset();
    exportJson.mockResolvedValue(finalDownload);

    const exported = await settingsBefore!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: false,
    });

    expect(
      createChromeBackupDownloadRuntime,
      "A8 product RED: SidePanel never created the Chrome backup download runtime",
    ).toHaveBeenCalledOnce();
    expect(exportBackup).toHaveBeenCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["workspace"],
      includeKeys: false,
    });
    expect(exportJson).toHaveBeenCalledWith({
      fileName: backupArtifact.fileName,
      json: backupArtifact.json,
    });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(exported).toBe(true);

    const completedSettings = latestShellProps?.settings;
    expect(completedSettings?.lastBackupExportPath).toBe(
      finalDownload.filename,
    );
    expect(completedSettings?.onCopyBackupExportPath).toBeTypeOf("function");
    expect(completedSettings?.onOpenBackupExportFolder).toBeTypeOf("function");
    await completedSettings!.onCopyBackupExportPath!();
    await completedSettings!.onOpenBackupExportFolder!();
    expect(clipboardWriteText).toHaveBeenCalledWith(finalDownload.filename);
    expect(openContainingFolder).toHaveBeenCalledWith(finalDownload.downloadId);
  });

  it("A8 clears the prior completed path when a new save is cancelled without reporting success", async () => {
    exportJson.mockReset();
    exportJson.mockResolvedValue({ cancelled: true });
    const cancellationResult = await latestShellProps!.settings!
      .onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: false,
    });

    expect(cancellationResult).toBe(false);
    expect(exportJson).toHaveBeenCalledWith({
      fileName: backupArtifact.fileName,
      json: backupArtifact.json,
    });
    expect(latestShellProps?.settings?.lastBackupExportPath).toBeNull();
    expect(latestShellProps?.settings?.feedback).not.toMatchObject({
      kind: "status",
      text: expect.stringContaining("备份已导出"),
    });
  });
});
