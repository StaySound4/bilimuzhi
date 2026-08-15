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
  BackupFileInspection,
  BackupImportPreview,
} from "../../src/application/backup";
import type { SessionWorkspaceSnapshot } from "../../src/application/session-workspace";
import {
  ChromeBackupDownloadError,
  type ChromeBackupDownloadResult,
} from "../../src/infrastructure/chrome-backup-download";
import type { AiChatShellProps } from "../../src/ui/ai-chat-shell";

const database = Object.freeze({ close: vi.fn(), label: "v15-backup-db" });
const openBilimuzhiDatabase = vi.fn(async () => database as unknown as IDBDatabase);
let latestShellProps: AiChatShellProps | undefined;

const backupArtifact = Object.freeze({
  fileName: "muzhi-v15-production.json",
  json: '{"version":15}',
  notice: "备份成功",
});
const completedDownload = Object.freeze({
  cancelled: false as const,
  downloadId: 615,
  filename: "D:\\Bilimuzhi备份\\Bilimuzhi-v15-final.json",
});
const exportBackup = vi.fn(async () => backupArtifact);
const inspectBackupFile = vi.fn<() => Promise<BackupFileInspection>>(
  async () => ({
    availableGroups: ["application-ai", "workspace"],
    containsSecrets: false,
    containsUnencryptedSecrets: false,
    encrypted: false,
  }),
);
const previewImport = vi.fn<() => Promise<BackupImportPreview>>(async () => ({
  conflicts: [],
  includeKeys: false,
  selectedGroups: ["workspace"],
  statistics: {
    "application-ai": { incoming: 0, replaced: 0 },
    archive: { incoming: 0, replaced: 0 },
    prompts: { incoming: 0, replaced: 0 },
    trash: { incoming: 0, replaced: 0 },
    "batch-archive": { incoming: 0, replaced: 0 },
    "batch-trash": { incoming: 0, replaced: 0 },
    "batch-workspace": { incoming: 0, replaced: 0 },
    workspace: { incoming: 1, replaced: 1 },
  },
}));
const commitImport = vi.fn(async () => undefined);
const exportJson = vi.fn<
  (input: {
    readonly fileName: string;
    readonly json: string;
  }) => Promise<ChromeBackupDownloadResult>
>(async () => completedDownload);
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
  return <main aria-label="v15-backup-production-composition" />;
}

async function waitForDialog(title: string) {
  await waitFor(() => expect(latestShellProps?.dialog?.title).toBe(title));
  return latestShellProps!.dialog!;
}

async function successfulExport(
  filename: string = completedDownload.filename,
  downloadId: number = completedDownload.downloadId,
): Promise<void> {
  exportJson.mockResolvedValueOnce({ cancelled: false, downloadId, filename });
  await expect(
    latestShellProps!.settings!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: false,
    }),
  ).resolves.toBe(true);
  await waitFor(() =>
    expect(latestShellProps?.settings?.lastBackupExportPath).toBe(filename),
  );
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: Object.freeze({ writeText: clipboardWriteText }),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:chrome-extension://muzhi/v15-backup",
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

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
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
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
      createSessionWorkspaceCoordinator: () =>
        asyncProxy({
          initialize: vi.fn(async () => emptySnapshot),
          saveView: vi.fn(async () => undefined),
        }),
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
          commitImport,
          exportBackup,
          inspectBackupFile,
          previewImport,
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
  for (const modulePath of [
    "../../src/infrastructure/indexeddb/archive-repository",
    "../../src/infrastructure/indexeddb/retention-repository",
    "../../src/infrastructure/indexeddb/session-repository",
    "../../src/infrastructure/indexeddb/workspace-restoration-repository",
    "../../src/infrastructure/indexeddb/trash-repository",
  ]) {
    const exportName = modulePath.includes("archive-repository")
      ? "IndexedDbArchiveRepository"
      : modulePath.includes("retention-repository")
        ? "IndexedDbRetentionRepository"
        : modulePath.includes("session-repository")
          ? "IndexedDbSessionRepository"
          : modulePath.includes("workspace-restoration")
            ? "IndexedDbWorkspaceRestorationRepository"
            : "IndexedDbTrashRepository";
    vi.doMock(modulePath, () => ({
      [exportName]: class {
        constructor() {
          return asyncProxy();
        }
      },
    }));
  }

  await import("../../src/entries/sidepanel");
  await waitFor(() =>
    expect(latestShellProps?.settings?.onOpenBackupExport).toBeTypeOf(
      "function",
    ),
  );
});

afterEach(() => {
  commitImport.mockClear();
  exportBackup.mockClear();
  inspectBackupFile.mockReset();
  inspectBackupFile.mockResolvedValue({
    availableGroups: ["application-ai", "workspace"],
    containsSecrets: false,
    containsUnencryptedSecrets: false,
    encrypted: false,
  });
  previewImport.mockReset();
  previewImport.mockResolvedValue({
    conflicts: [],
    includeKeys: false,
    selectedGroups: ["workspace"],
    statistics: {
      "application-ai": { incoming: 0, replaced: 0 },
      archive: { incoming: 0, replaced: 0 },
      prompts: { incoming: 0, replaced: 0 },
      trash: { incoming: 0, replaced: 0 },
      "batch-archive": { incoming: 0, replaced: 0 },
      "batch-trash": { incoming: 0, replaced: 0 },
      "batch-workspace": { incoming: 0, replaced: 0 },
      workspace: { incoming: 1, replaced: 1 },
    },
  });
  exportJson.mockReset();
  exportJson.mockResolvedValue(completedDownload);
  openContainingFolder.mockReset();
  openContainingFolder.mockResolvedValue(undefined);
  clipboardWriteText.mockReset();
  clipboardWriteText.mockResolvedValue(undefined);
});

afterAll(() => {
  globalThis.dispatchEvent(new Event("pagehide"));
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/ui/ai-chat-shell");
});

describe("v15 backup real SidePanel production state machine (B1-B4)", () => {
  it("requires both plaintext-key confirmations, while password and keyless cases show no plaintext warning", async () => {
    const settings = latestShellProps!.settings!;

    const firstCancelled = settings.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: true,
    });
    (await waitForDialog("警告：备份将包含明文密钥")).onCancel();
    await expect(firstCancelled).resolves.toBe(false);
    expect(exportBackup).not.toHaveBeenCalled();
    expect(exportJson).not.toHaveBeenCalled();

    const secondCancelled = latestShellProps!.settings!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: true,
    });
    (await waitForDialog("警告：备份将包含明文密钥")).onConfirm("");
    (await waitForDialog("再次确认未加密密钥备份")).onCancel();
    await expect(secondCancelled).resolves.toBe(false);
    expect(exportBackup).not.toHaveBeenCalled();
    expect(exportJson).not.toHaveBeenCalled();

    const confirmed = latestShellProps!.settings!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: true,
    });
    (await waitForDialog("警告：备份将包含明文密钥")).onConfirm("");
    (await waitForDialog("再次确认未加密密钥备份")).onConfirm("");
    await expect(confirmed).resolves.toBe(true);
    expect(exportBackup).toHaveBeenLastCalledWith({
      confirmPlaintextSecrets: true,
      groups: ["workspace"],
      includeKeys: true,
    });

    exportBackup.mockClear();
    await expect(
      latestShellProps!.settings!.onOpenBackupExport!({
        groups: ["workspace"],
        includeKeys: true,
        password: "fixture encrypted backup password",
      }),
    ).resolves.toBe(true);
    expect(latestShellProps?.dialog).toBeUndefined();
    expect(exportBackup).toHaveBeenLastCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["workspace"],
      includeKeys: true,
      password: "fixture encrypted backup password",
    });

    exportBackup.mockClear();
    await expect(
      latestShellProps!.settings!.onOpenBackupExport!({
        groups: ["workspace"],
        includeKeys: false,
        password: "fixture whole backup password",
      }),
    ).resolves.toBe(true);
    expect(latestShellProps?.dialog).toBeUndefined();
    expect(exportBackup).toHaveBeenLastCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["workspace"],
      includeKeys: false,
      password: "fixture whole backup password",
    });
  });

  it("clears the previous path at the start, exposes pending, blocks duplicates, and leaves cancellation retryable", async () => {
    await successfulExport("D:\\old\\previous-backup.json", 401);
    exportBackup.mockClear();
    exportJson.mockReset();
    let resolveDownload!: (value: ChromeBackupDownloadResult) => void;
    exportJson.mockImplementationOnce(
      async () =>
        await new Promise<ChromeBackupDownloadResult>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const inFlight = latestShellProps!.settings!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: false,
    });
    await waitFor(() => expect(latestShellProps?.settings?.busy).toBe(true));

    expect.soft(latestShellProps?.settings).toMatchObject({
      busy: true,
      feedback: { kind: "pending", text: expect.stringContaining("正在导出") },
      lastBackupExportPath: null,
    });
    const duplicate = await latestShellProps!.settings!.onOpenBackupExport!({
      groups: ["workspace"],
      includeKeys: false,
    });
    expect(duplicate).toBe(false);
    expect(exportBackup).toHaveBeenCalledOnce();
    expect(exportJson).toHaveBeenCalledOnce();

    resolveDownload({ cancelled: true });
    await expect(inFlight).resolves.toBe(false);
    await waitFor(() => expect(latestShellProps?.settings?.busy).toBe(false));
    expect.soft(latestShellProps?.settings?.lastBackupExportPath).toBeNull();
    expect(latestShellProps?.settings?.feedback).not.toMatchObject({
      kind: "status",
      text: expect.stringContaining("已导出"),
    });
  });

  it("projects a safe specific failure, clears stale path, and permits a successful retry", async () => {
    await successfulExport("D:\\old\\stale-before-failure.json", 402);
    exportJson.mockReset();
    exportJson.mockRejectedValueOnce(
      new ChromeBackupDownloadError(
        "DOWNLOAD_INTERRUPTED",
        "备份下载未完成，请重试。",
      ),
    );

    await expect(
      latestShellProps!.settings!.onOpenBackupExport!({
        groups: ["workspace"],
        includeKeys: false,
      }),
    ).resolves.toBe(false);
    expect.soft(latestShellProps?.settings?.lastBackupExportPath).toBeNull();
    expect.soft(latestShellProps?.settings?.feedback).toMatchObject({
      kind: "error",
      text: expect.stringMatching(/备份.*(未完成|中断).*重试/),
    });

    exportJson.mockResolvedValueOnce(completedDownload);
    await expect(
      latestShellProps!.settings!.onOpenBackupExport!({
        groups: ["workspace"],
        includeKeys: false,
      }),
    ).resolves.toBe(true);
    expect(latestShellProps?.settings?.lastBackupExportPath).toBe(
      completedDownload.filename,
    );
  });

  it("inspects the chosen file, lets the user choose supported groups, and warns before complete replacement", async () => {
    const importPromise = latestShellProps!.settings!.onOpenBackupImport!({
      json: '{"version":1,"groups":{}}',
    });
    const selectionDialog = await waitForDialog("选择要导入的板块");
    expect(selectionDialog.multipleOptions).toBe(true);
    expect(selectionDialog.options).toEqual([
      { label: "应用与 AI 配置", value: "application-ai" },
      { label: "工作区会话", value: "workspace" },
    ]);
    selectionDialog.onConfirm("workspace");

    const confirmation = await waitForDialog("确认完全覆盖？");
    expect(confirmation.description).toContain(
      "导入会完全覆盖所选板块的本机内容",
    );
    expect(confirmation.description).toContain("工作区会话");
    confirmation.onConfirm("");

    await expect(importPromise).resolves.toBe(true);
    expect(inspectBackupFile).toHaveBeenCalledWith({
      json: '{"version":1,"groups":{}}',
    });
    expect(previewImport).toHaveBeenCalledWith({
      groups: ["workspace"],
      includeKeys: false,
      json: '{"version":1,"groups":{}}',
    });
    expect(commitImport).toHaveBeenCalledOnce();
  });

  it("discloses when an exact backed-up workspace Branch will be moved back from trash", async () => {
    previewImport.mockResolvedValueOnce({
      conflicts: [],
      includeKeys: false,
      relocations: [
        {
          branchCount: 1,
          from: "trash",
          sessionId: "session-restored-from-trash",
          to: "workspace",
        },
      ],
      selectedGroups: ["workspace"],
      statistics: {
        "application-ai": { incoming: 0, replaced: 0 },
        archive: { incoming: 0, replaced: 0 },
        prompts: { incoming: 0, replaced: 0 },
        trash: { incoming: 0, replaced: 1 },
        "batch-archive": { incoming: 0, replaced: 0 },
        "batch-trash": { incoming: 0, replaced: 0 },
        "batch-workspace": { incoming: 0, replaced: 0 },
        workspace: { incoming: 1, replaced: 0 },
      },
    });
    const importPromise = latestShellProps!.settings!.onOpenBackupImport!({
      json: '{"version":1,"groups":{}}',
    });
    (await waitForDialog("选择要导入的板块")).onConfirm("workspace");

    const confirmation = await waitForDialog("确认完全覆盖？");
    expect(confirmation.description).toContain(
      "1 个字幕内容将从回收站移回工作区会话",
    );
    confirmation.onCancel();
    await expect(importPromise).resolves.toBe(false);
  });

  it("prompts for a password only after detecting an encrypted backup", async () => {
    const { BackupError } = await import("../../src/application/backup");
    inspectBackupFile
      .mockRejectedValueOnce(
        new BackupError("BACKUP_PASSWORD_REQUIRED", "此备份需要密码。"),
      )
      .mockResolvedValueOnce({
        availableGroups: ["workspace"],
        containsSecrets: false,
        containsUnencryptedSecrets: false,
        encrypted: true,
      });
    const importPromise = latestShellProps!.settings!.onOpenBackupImport!({
      json: "encrypted-fixture",
    });

    const passwordDialog = await waitForDialog("输入备份密码");
    expect(passwordDialog.inputType).toBe("password");
    passwordDialog.onConfirm("fixture-password");
    (await waitForDialog("选择要导入的板块")).onCancel();

    await expect(importPromise).resolves.toBe(false);
    expect(inspectBackupFile).toHaveBeenNthCalledWith(2, {
      json: "encrypted-fixture",
      password: "fixture-password",
    });
  });

  it("copies and opens the completed path, while action failures keep the success result and expose specific safe reasons", async () => {
    await successfulExport();
    const completedSettings = latestShellProps!.settings!;

    await completedSettings.onCopyBackupExportPath!();
    await completedSettings.onOpenBackupExportFolder!();
    expect(clipboardWriteText).toHaveBeenCalledWith(completedDownload.filename);
    expect(openContainingFolder).toHaveBeenCalledWith(
      completedDownload.downloadId,
    );

    clipboardWriteText.mockRejectedValueOnce(
      new Error("raw clipboard failure fixture"),
    );
    await latestShellProps!.settings!.onCopyBackupExportPath!();
    expect
      .soft(latestShellProps?.settings?.lastBackupExportPath)
      .toBe(completedDownload.filename);
    expect.soft(latestShellProps?.settings?.feedback).toMatchObject({
      kind: "error",
      text: expect.stringMatching(/(复制.*失败|无法.*复制)/),
    });
    expect(JSON.stringify(latestShellProps?.settings?.feedback)).not.toContain(
      "raw clipboard failure fixture",
    );

    openContainingFolder.mockRejectedValueOnce(
      new Error("raw folder failure fixture"),
    );
    await latestShellProps!.settings!.onOpenBackupExportFolder!();
    expect
      .soft(latestShellProps?.settings?.lastBackupExportPath)
      .toBe(completedDownload.filename);
    expect.soft(latestShellProps?.settings?.feedback).toMatchObject({
      kind: "error",
      text: expect.stringMatching(/(打开.*文件夹.*失败|无法.*打开.*文件夹)/),
    });
    expect(JSON.stringify(latestShellProps?.settings?.feedback)).not.toContain(
      "raw folder failure fixture",
    );
  });
});
