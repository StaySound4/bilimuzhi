export interface ChromeBackupDownloadDelta {
  readonly error?: { readonly current?: string };
  readonly id: number;
  readonly state?: {
    readonly current?: "complete" | "in_progress" | "interrupted";
  };
}

export interface ChromeBackupDownloadItem {
  readonly error?: string;
  readonly filename: string;
  readonly id: number;
  readonly state: "complete" | "in_progress" | "interrupted";
}

export interface ChromeBackupDownloadDependencies {
  readonly createObjectURL: (blob: Blob) => string;
  readonly downloads: {
    download(options: {
      readonly filename: string;
      readonly saveAs: true;
      readonly url: string;
    }): Promise<number | undefined>;
    readonly onChanged: {
      addListener(listener: (delta: ChromeBackupDownloadDelta) => void): void;
      removeListener(
        listener: (delta: ChromeBackupDownloadDelta) => void,
      ): void;
    };
    search(query: {
      readonly id: number;
    }): Promise<readonly ChromeBackupDownloadItem[]>;
    show(downloadId: number): Promise<void>;
  };
  readonly revokeObjectURL: (url: string) => void;
}

export type ChromeBackupDownloadResult =
  | { readonly cancelled: true }
  | {
      readonly cancelled: false;
      readonly downloadId: number;
      readonly filename: string;
    };

export class ChromeBackupDownloadError extends Error {
  readonly retryable = true;

  constructor(
    readonly code:
      | "DOWNLOAD_START_FAILED"
      | "DOWNLOAD_STATUS_FAILED"
      | "DOWNLOAD_STATUS_UNCONFIRMED"
      | "DOWNLOAD_INTERRUPTED"
      | "DOWNLOAD_ITEM_MISSING"
      | "DOWNLOAD_PATH_MISSING"
      | "DOWNLOAD_OPEN_FOLDER_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ChromeBackupDownloadError";
  }
}

type TerminalDownloadState = "cancelled" | "complete" | "interrupted";

const DOWNLOAD_STATUS_CONFIRMATION_TIMEOUT_MS = 30_000;
const USER_CANCELLED_DOWNLOAD_ERROR = "USER_CANCELED";

// Chromium reports a cancelled save-as picker through the download interrupt
// reason instead of a distinct WebExtension cancellation result. Depending on
// the promise wrapper/version, callers may observe USER_CANCELED either as the
// rejected error message or on the interrupted DownloadItem.
function isUserCancelledDownloadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalized = message.toUpperCase();
  return (
    normalized.includes(USER_CANCELLED_DOWNLOAD_ERROR) ||
    normalized.includes("USER CANCELLED") ||
    normalized.includes("USER CANCELED")
  );
}

function terminalStateFromDelta(
  delta: ChromeBackupDownloadDelta,
): TerminalDownloadState | null {
  if (isUserCancelledDownloadError(delta.error?.current)) {
    return "cancelled";
  }
  if (delta.error?.current || delta.state?.current === "interrupted") {
    return "interrupted";
  }
  return delta.state?.current === "complete" ? "complete" : null;
}

async function searchDownloadItem(
  dependencies: ChromeBackupDownloadDependencies,
  downloadId: number,
): Promise<ChromeBackupDownloadItem | null> {
  try {
    return (
      (await dependencies.downloads.search({ id: downloadId })).find(
        (candidate) => candidate.id === downloadId,
      ) ?? null
    );
  } catch {
    throw new ChromeBackupDownloadError(
      "DOWNLOAD_STATUS_FAILED",
      "无法查询备份下载状态，请重试。",
    );
  }
}

function completedDownloadResult(
  item: ChromeBackupDownloadItem | null,
  downloadId: number,
): ChromeBackupDownloadResult {
  if (item === null) {
    throw new ChromeBackupDownloadError(
      "DOWNLOAD_ITEM_MISSING",
      "无法确认备份下载项，请重试。",
    );
  }
  if (
    item.state === "interrupted" &&
    isUserCancelledDownloadError(item.error)
  ) {
    return Object.freeze({ cancelled: true as const });
  }
  if (item.state === "interrupted") {
    throw new ChromeBackupDownloadError(
      "DOWNLOAD_INTERRUPTED",
      "备份下载已中断或未完成，请重试。",
    );
  }
  if (item.state !== "complete") {
    throw new ChromeBackupDownloadError(
      "DOWNLOAD_STATUS_UNCONFIRMED",
      "备份下载状态无法确认，请重试。",
    );
  }
  if (typeof item.filename !== "string" || item.filename.trim() === "") {
    throw new ChromeBackupDownloadError(
      "DOWNLOAD_PATH_MISSING",
      "备份已完成，但浏览器未返回最终文件路径。",
    );
  }
  return Object.freeze({
    cancelled: false as const,
    downloadId,
    filename: item.filename,
  });
}

export function createChromeBackupDownloadRuntime(
  dependencies: ChromeBackupDownloadDependencies,
) {
  return Object.freeze({
    async exportJson(input: {
      readonly fileName: string;
      readonly json: string;
    }): Promise<ChromeBackupDownloadResult> {
      let objectUrl: string | null = null;
      let listenerAdded = false;
      const observedTerminalStates = new Map<number, TerminalDownloadState>();
      let waiting:
        | Readonly<{
            downloadId: number;
            resolve: (state: TerminalDownloadState) => void;
          }>
        | undefined;
      const listener = (delta: ChromeBackupDownloadDelta): void => {
        const state = terminalStateFromDelta(delta);
        if (state === null) return;
        observedTerminalStates.set(delta.id, state);
        if (waiting?.downloadId === delta.id) {
          const resolve = waiting.resolve;
          waiting = undefined;
          resolve(state);
        }
      };
      const waitForTerminalState = (
        downloadId: number,
      ): Promise<TerminalDownloadState> => {
        const observed = observedTerminalStates.get(downloadId);
        if (observed !== undefined) return Promise.resolve(observed);
        return new Promise((resolve, reject) => {
          let settled = false;
          const timeout = globalThis.setTimeout(() => {
            if (settled) return;
            settled = true;
            if (waiting?.downloadId === downloadId) waiting = undefined;
            reject(
              new ChromeBackupDownloadError(
                "DOWNLOAD_STATUS_UNCONFIRMED",
                "备份下载状态在限定时间内无法确认，请重试。",
              ),
            );
          }, DOWNLOAD_STATUS_CONFIRMATION_TIMEOUT_MS);
          const settle = (state: TerminalDownloadState): void => {
            if (settled) return;
            settled = true;
            globalThis.clearTimeout(timeout);
            if (waiting?.downloadId === downloadId) waiting = undefined;
            resolve(state);
          };
          waiting = Object.freeze({ downloadId, resolve: settle });
          const raced = observedTerminalStates.get(downloadId);
          if (raced !== undefined && waiting?.downloadId === downloadId) {
            settle(raced);
          }
        });
      };
      try {
        objectUrl = dependencies.createObjectURL(
          new Blob([input.json], { type: "application/json;charset=utf-8" }),
        );
        let downloadId: number | undefined;
        try {
          downloadId = await dependencies.downloads.download({
            filename: input.fileName,
            saveAs: true,
            url: objectUrl,
          });
        } catch (error) {
          if (isUserCancelledDownloadError(error)) {
            return Object.freeze({ cancelled: true as const });
          }
          throw new ChromeBackupDownloadError(
            "DOWNLOAD_START_FAILED",
            "无法启动备份下载，请重试。",
          );
        }
        if (downloadId === undefined) {
          return Object.freeze({ cancelled: true as const });
        }
        if (!Number.isSafeInteger(downloadId) || downloadId < 0) {
          throw new ChromeBackupDownloadError(
            "DOWNLOAD_START_FAILED",
            "浏览器未返回有效的备份下载标识，请重试。",
          );
        }
        dependencies.downloads.onChanged.addListener(listener);
        listenerAdded = true;
        const initialItem = await searchDownloadItem(dependencies, downloadId);
        if (initialItem === null || initialItem.state === "complete") {
          return completedDownloadResult(initialItem, downloadId);
        }
        if (initialItem.state === "interrupted") {
          return completedDownloadResult(initialItem, downloadId);
        }
        const terminalState = await waitForTerminalState(downloadId);
        if (terminalState === "cancelled") {
          return Object.freeze({ cancelled: true as const });
        }
        return completedDownloadResult(
          await searchDownloadItem(dependencies, downloadId),
          downloadId,
        );
      } catch (error) {
        if (error instanceof ChromeBackupDownloadError) throw error;
        throw new ChromeBackupDownloadError(
          "DOWNLOAD_START_FAILED",
          "无法启动备份下载，请重试。",
        );
      } finally {
        waiting = undefined;
        if (listenerAdded) {
          try {
            dependencies.downloads.onChanged.removeListener(listener);
          } catch {
            // The terminal result remains authoritative if Chrome teardown fails.
          }
        }
        if (objectUrl !== null) {
          try {
            dependencies.revokeObjectURL(objectUrl);
          } catch {
            // The object URL is already unreachable after this operation returns.
          }
        }
      }
    },

    async openContainingFolder(downloadId: number): Promise<void> {
      try {
        await dependencies.downloads.show(downloadId);
      } catch {
        throw new ChromeBackupDownloadError(
          "DOWNLOAD_OPEN_FOLDER_FAILED",
          "无法打开备份所在文件夹，请在浏览器下载记录中查看。",
        );
      }
    },
  });
}
