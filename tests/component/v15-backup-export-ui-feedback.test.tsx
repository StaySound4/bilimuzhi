import { cleanup, fireEvent, screen, waitFor } from "@testing-library/preact";
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

import type { SessionWorkspaceSnapshot } from "../../src/application/session-workspace";
import {
  ChromeBackupDownloadError,
  type ChromeBackupDownloadResult,
} from "../../src/infrastructure/chrome-backup-download";
import { AiChatShell, type AiChatShellProps } from "../../src/ui/ai-chat-shell";

const database = Object.freeze({ close: vi.fn(), label: "v15-backup-ui-db" });
const openBilimuzhiDatabase = vi.fn(async () => database as unknown as IDBDatabase);
let productionShellProps: AiChatShellProps | undefined;

const backupArtifact = Object.freeze({
  fileName: "muzhi-v15-ui-feedback.json",
  json: '{"version":15}',
  notice: "备份成功",
});
const completedDownload = Object.freeze({
  cancelled: false as const,
  downloadId: 715,
  filename: "D:\\Bilimuzhi备份\\Bilimuzhi-v15-ui-feedback.json",
});
const exportBackup = vi.fn(async () => backupArtifact);
const exportJson = vi.fn<
  (input: {
    readonly fileName: string;
    readonly json: string;
  }) => Promise<ChromeBackupDownloadResult>
>(async () => completedDownload);
const openContainingFolder = vi.fn<(downloadId: number) => Promise<void>>(
  async () => undefined,
);
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

function ProductionShell(props: AiChatShellProps): ComponentChildren {
  productionShellProps = props;
  return <AiChatShell {...props} />;
}

async function openBackupSettings(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
  fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
  await screen.findByRole("dialog", { name: "设置" });
  fireEvent.click(screen.getByRole("tab", { name: "备份" }));
}

function selectApiKeys(): void {
  const apiKeys = screen.getByRole("button", { name: "API 与密钥" });
  if (apiKeys.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(apiKeys);
  }
  expect(apiKeys.getAttribute("aria-pressed")).toBe("true");
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: Object.freeze({ writeText: clipboardWriteText }),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:chrome-extension://muzhi/v15-backup-ui-feedback",
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
    AiChatShell: ProductionShell,
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
        asyncProxy({ exportBackup, previewImport: vi.fn() }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-backup-download", () => ({
    createChromeBackupDownloadRuntime: () => ({
      exportJson,
      openContainingFolder,
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
    expect(productionShellProps?.settings?.onOpenBackupExport).toBeTypeOf(
      "function",
    ),
  );
});

afterEach(() => {
  const closeSettings = screen.queryByRole("button", { name: "关闭设置" });
  if (closeSettings) fireEvent.click(closeSettings);
  exportBackup.mockClear();
  exportJson.mockReset();
  exportJson.mockResolvedValue(completedDownload);
  openContainingFolder.mockClear();
  clipboardWriteText.mockClear();
});

afterAll(() => {
  globalThis.dispatchEvent(new Event("pagehide"));
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/ui/ai-chat-shell");
});

describe("v15 backup export user-visible DOM feedback", () => {
  it("exports selected API keys with a password without showing a plaintext warning", async () => {
    await openBackupSettings();
    selectApiKeys();
    fireEvent.input(screen.getByLabelText("备份密码（可选）"), {
      target: { value: "fixture-encrypted-backup-password" },
    });

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));

    await waitFor(() => expect(exportBackup).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("alertdialog", {
        name: "警告：备份将包含明文密钥",
      }),
    ).toBeNull();
    expect(exportBackup).toHaveBeenCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["application-ai", "prompts", "workspace", "archive", "trash"],
      includeKeys: true,
      password: "fixture-encrypted-backup-password",
    });
    expect(exportJson).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "复制导出路径" }));
    fireEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(
        completedDownload.filename,
      );
      expect(openContainingFolder).toHaveBeenCalledWith(
        completedDownload.downloadId,
      );
    });
  });

  it("exports a keyless backup without a password or plaintext warning", async () => {
    await openBackupSettings();

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));

    await waitFor(() => expect(exportBackup).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("alertdialog", {
        name: "警告：备份将包含明文密钥",
      }),
    ).toBeNull();
    expect(exportBackup).toHaveBeenCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["application-ai", "prompts", "workspace", "archive", "trash"],
      includeKeys: false,
    });
    expect(exportJson).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();
  });

  it("lets the user complete both plaintext-key confirmations and see the final full path", async () => {
    await openBackupSettings();
    selectApiKeys();

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));

    await screen.findByRole("alertdialog", {
      name: "警告：备份将包含明文密钥",
    });
    const acknowledgeRisk = screen.getByRole("button", {
      name: "我已了解风险",
    }) as HTMLButtonElement;
    expect(acknowledgeRisk.disabled).toBe(false);
    fireEvent.click(acknowledgeRisk);

    await screen.findByRole("alertdialog", {
      name: "再次确认未加密密钥备份",
    });
    fireEvent.click(screen.getByRole("button", { name: "确认导出明文密钥" }));

    await waitFor(() => expect(exportBackup).toHaveBeenCalledOnce());
    expect(exportBackup).toHaveBeenCalledWith({
      confirmPlaintextSecrets: true,
      groups: ["application-ai", "prompts", "workspace", "archive", "trash"],
      includeKeys: true,
    });
    expect(exportJson).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();
  });

  it.each(["Escape", "backdrop"] as const)(
    "releases the export lock after dismissing the second plaintext warning through %s",
    async (dismissal) => {
      await openBackupSettings();
      selectApiKeys();

      fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
      await screen.findByRole("alertdialog", {
        name: "警告：备份将包含明文密钥",
      });
      fireEvent.click(screen.getByRole("button", { name: "我已了解风险" }));
      const confirmation = await screen.findByRole("alertdialog", {
        name: "再次确认未加密密钥备份",
      });
      if (dismissal === "Escape") {
        fireEvent.keyDown(confirmation, { key: "Escape" });
      } else {
        fireEvent.click(screen.getByLabelText("关闭对话框背景"));
      }

      await waitFor(() =>
        expect(
          screen.queryByRole("alertdialog", {
            name: "再次确认未加密密钥备份",
          }),
        ).toBeNull(),
      );
      await waitFor(() =>
        expect(screen.queryByText("正在导出所选备份…")).toBeNull(),
      );
      expect(exportBackup).not.toHaveBeenCalled();
      expect(exportJson).not.toHaveBeenCalled();

      fireEvent.input(screen.getByLabelText("备份密码（可选）"), {
        target: { value: `fixture-password-after-${dismissal}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));

      await waitFor(() => expect(exportBackup).toHaveBeenCalledOnce());
      expect(exportJson).toHaveBeenCalledOnce();
      expect(
        await screen.findByText(`已导出到：${completedDownload.filename}`),
      ).not.toBeNull();
    },
  );

  it("disables the real backup controls while an export is in progress and restores them after cancellation", async () => {
    await openBackupSettings();
    let finishDownload!: (result: ChromeBackupDownloadResult) => void;
    exportJson.mockImplementationOnce(
      async () =>
        await new Promise<ChromeBackupDownloadResult>((resolve) => {
          finishDownload = resolve;
        }),
    );

    const exportButton = screen.getByRole("button", {
      name: "导出所选备份",
    }) as HTMLButtonElement;
    const importFile = screen.getByLabelText(
      "选择备份文件",
    ) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(
      "备份密码（可选）",
    ) as HTMLInputElement;
    const backupCards = screen
      .getByLabelText("备份内容分类")
      .querySelectorAll("button");

    fireEvent.click(exportButton);
    await screen.findByText("正在导出所选备份…");

    expect(exportButton.disabled).toBe(true);
    expect(importFile.disabled).toBe(true);
    expect(passwordInput.disabled).toBe(true);
    expect([...backupCards].every((card) => card.disabled)).toBe(true);
    fireEvent.click(exportButton);
    expect(exportJson).toHaveBeenCalledOnce();

    finishDownload({ cancelled: true });
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    expect(importFile.disabled).toBe(false);
    expect(passwordInput.disabled).toBe(false);
    expect([...backupCards].every((card) => !card.disabled)).toBe(true);
  });

  it("treats a cancelled system save as no success and permits a retry", async () => {
    await openBackupSettings();
    fireEvent.input(screen.getByLabelText("备份密码（可选）"), {
      target: { value: "fixture-system-save-cancel" },
    });
    exportJson.mockResolvedValueOnce({ cancelled: true });

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    await waitFor(() => expect(exportJson).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByText("正在导出所选备份…")).toBeNull(),
    );
    expect(screen.queryByText(/已导出到：/u)).toBeNull();
    expect(screen.queryByText("备份已导出。")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开所在文件夹" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    await waitFor(() => expect(exportJson).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();
  });

  it("shows a specific safe download reason, clears success actions, and permits a retry", async () => {
    await openBackupSettings();
    fireEvent.input(screen.getByLabelText("备份密码（可选）"), {
      target: { value: "fixture-download-failure" },
    });
    exportJson.mockRejectedValueOnce(
      new ChromeBackupDownloadError(
        "DOWNLOAD_INTERRUPTED",
        "raw fixture must not be shown",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    expect(
      await screen.findByText("备份下载已中断或未完成，请重试。"),
    ).not.toBeNull();
    expect(screen.queryByText(/已导出到：/u)).toBeNull();
    expect(document.body.textContent).not.toContain(
      "raw fixture must not be shown",
    );
    await waitFor(() =>
      expect(screen.queryByText("正在导出所选备份…")).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    await waitFor(() => expect(exportJson).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();
  });

  it("releases the export lock after dismissing the first risk warning through the backdrop so a password retry can succeed", async () => {
    await openBackupSettings();
    selectApiKeys();

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    await screen.findByRole("alertdialog", {
      name: "警告：备份将包含明文密钥",
    });
    fireEvent.click(screen.getByLabelText("关闭对话框背景"));

    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", {
          name: "警告：备份将包含明文密钥",
        }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByText("正在导出所选备份…")).toBeNull(),
    );
    expect(exportBackup).not.toHaveBeenCalled();
    expect(exportJson).not.toHaveBeenCalled();

    fireEvent.input(screen.getByLabelText("备份密码（可选）"), {
      target: { value: "fixture-password-after-cancel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));

    await waitFor(() => expect(exportBackup).toHaveBeenCalledOnce());
    expect(exportBackup).toHaveBeenCalledWith({
      confirmPlaintextSecrets: false,
      groups: ["application-ai", "prompts", "workspace", "archive", "trash"],
      includeKeys: true,
      password: "fixture-password-after-cancel",
    });
    expect(exportJson).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(`已导出到：${completedDownload.filename}`),
    ).not.toBeNull();
  });
});
