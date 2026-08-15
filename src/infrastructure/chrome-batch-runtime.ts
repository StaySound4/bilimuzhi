import type {
  BatchExportEntry,
  BatchJobView,
  BatchRuntime,
} from "../application/batch-runtime";
import { BatchSourceError } from "../application/batch-source-contract";
import type { GroqRoutingMode } from "../application/asr-contract";
import type { TrashRetentionApplyMode, TrashRetentionPolicy } from "../domain";
import {
  BATCH_SOURCE_KINDS,
  type BatchSourceKind,
} from "../application/batch-source-contract";
import {
  createBatchItem,
  createBatchJob,
  type BatchAcquisitionMethod,
  type BatchItem,
  type BatchJob,
  type SubtitleLanguageMode,
} from "../domain";

export const BATCH_RUNTIME_PROTOCOL_VERSION = 1 as const;

type BatchCommandType =
  | "muzhi.batch.list.create"
  | "muzhi.batch.prepare"
  | "muzhi.batch.start"
  | "muzhi.batch.cancel"
  | "muzhi.batch.read"
  | "muzhi.batch.jobs.list"
  | "muzhi.batch.list.rename"
  | "muzhi.batch.list.pin"
  | "muzhi.batch.list.archive"
  | "muzhi.batch.list.trash"
  | "muzhi.batch.archive.lists"
  | "muzhi.batch.trash.lists"
  | "muzhi.batch.list.restore"
  | "muzhi.batch.list.purge"
  | "muzhi.batch.retention.get"
  | "muzhi.batch.retention.update"
  | "muzhi.batch.retention.purge-expired"
  | "muzhi.batch.selection"
  | "muzhi.batch.item-speech-language"
  | "muzhi.batch.refetch-track"
  | "muzhi.batch.clear-subtitles"
  | "muzhi.batch.delete-items"
  | "muzhi.batch.delete"
  | "muzhi.batch.export";
interface BatchCommand {
  readonly payload: Record<string, unknown>;
  readonly protocolVersion: typeof BATCH_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: BatchCommandType;
}

interface BatchResponse {
  readonly payload:
    | { readonly data: unknown; readonly ok: true }
    | {
        readonly errorCode: string;
        readonly message: string;
        readonly ok: false;
        readonly retryable: boolean;
      };
  readonly protocolVersion: typeof BATCH_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "muzhi.batch.response";
}

export interface ChromeBatchRuntimeEvent {
  readonly payload: BatchJobView;
  readonly prepareOperationId?: string;
  readonly protocolVersion: typeof BATCH_RUNTIME_PROTOCOL_VERSION;
  readonly type: "muzhi.batch.updated";
}

export class ChromeBatchRuntimeError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ChromeBatchRuntimeError";
    this.retryable = retryable;
  }
}

export interface ChromeBatchRuntimeClient {
  createList(): Promise<BatchJobView>;
  prepare(input: {
    readonly batchJobId: string;
    readonly operationId: string;
    readonly includeAllPages: boolean;
    readonly input: string;
    readonly method: BatchAcquisitionMethod;
    readonly sourceKind?: BatchSourceKind | "auto";
    readonly speechLanguageMode?: SubtitleLanguageMode;
  }): Promise<BatchJobView>;
  start(input: {
    readonly batchJobId: string;
    readonly languagePreference: string;
    readonly method?: BatchAcquisitionMethod;
    readonly overwrite?: "skip" | "all";
    readonly speechRoutingMode?: GroqRoutingMode;
    readonly speechLanguageScope?: SubtitleLanguageMode | "item";
  }): Promise<BatchJobView>;
  cancel(batchJobId: string): Promise<BatchJobView | null>;
  read(batchJobId: string): Promise<BatchJobView | null>;
  listJobs(): Promise<
    readonly { readonly job: BatchJob; readonly pinned: boolean }[]
  >;
  renameList(batchJobId: string, name: string): Promise<BatchJobView | null>;
  setPinned(batchJobId: string, pinned: boolean): Promise<BatchJobView | null>;
  archiveList(batchJobId: string): Promise<BatchJobView | null>;
  trashList(batchJobId: string): Promise<BatchJobView | null>;
  listArchivedLists(): Promise<
    readonly {
      readonly archivedAt: number;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
    }[]
  >;
  listTrashedLists(): Promise<
    readonly {
      readonly deletionReason: string;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    }[]
  >;
  restoreList(batchJobId: string): Promise<BatchJobView | null>;
  purgeList(batchJobId: string): Promise<void>;
  getRetentionPolicy(): Promise<TrashRetentionPolicy>;
  updateRetentionPolicy(
    policy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<void>;
  permanentlyDeleteExpiredBatchTrash(now: number): Promise<readonly string[]>;
  setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  setItemSpeechLanguage(
    batchJobId: string,
    batchItemId: string,
    speechLanguageMode: SubtitleLanguageMode,
  ): Promise<BatchJobView | null>;
  refetchTrack(
    batchJobId: string,
    batchItemId: string,
    trackId: string,
  ): Promise<BatchJobView | null>;
  clearSubtitles(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  deleteItems(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  deleteJob(batchJobId: string): Promise<void>;
  collectExport(
    batchJobId: string,
    batchItemIds?: readonly string[],
  ): Promise<readonly BatchExportEntry[]>;
  subscribe(listener: (event: ChromeBatchRuntimeEvent) => void): () => void;
}

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

interface ChromeRuntimeApi {
  readonly onMessage: {
    addListener(listener: MessageListener): void;
    removeListener?(listener: MessageListener): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function readRuntime(chromeValue: unknown): ChromeRuntimeApi {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
    : null;
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  const removeListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "removeListener")
    : null;
  const sendMessage = isRecord(runtime)
    ? Reflect.get(runtime, "sendMessage")
    : null;
  if (
    !isRecord(runtime) ||
    !isRecord(onMessage) ||
    typeof addListener !== "function" ||
    typeof sendMessage !== "function"
  ) {
    throw new Error("Chrome batch runtime is unavailable");
  }
  return Object.freeze({
    onMessage: Object.freeze({
      addListener(listener: MessageListener): void {
        Reflect.apply(addListener, onMessage, [listener]);
      },
      removeListener:
        typeof removeListener === "function"
          ? (listener: MessageListener): void => {
              Reflect.apply(removeListener, onMessage, [listener]);
            }
          : undefined,
    }),
    async sendMessage(message: unknown): Promise<unknown> {
      return Reflect.apply(sendMessage, runtime, [message]);
    },
  });
}

function isBatchCommand(value: unknown): value is BatchCommand {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) ||
    value.protocolVersion !== BATCH_RUNTIME_PROTOCOL_VERSION ||
    !safeId(value.requestId) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  switch (value.type) {
    case "muzhi.batch.list.create":
      return exactKeys(value.payload, []);
    case "muzhi.batch.prepare": {
      const legacy =
        exactKeys(value.payload, ["includeAllPages", "input", "method"]) ||
        exactKeys(value.payload, [
          "includeAllPages",
          "input",
          "method",
          "sourceKind",
        ]);
      const append =
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "sourceKind",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "operationId",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "operationId",
          "sourceKind",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "operationId",
          "sourceKind",
          "speechLanguageMode",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "operationId",
          "speechLanguageMode",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "speechLanguageMode",
        ]) ||
        exactKeys(value.payload, [
          "batchJobId",
          "includeAllPages",
          "input",
          "method",
          "sourceKind",
          "speechLanguageMode",
        ]);
      return (
        (legacy || append) &&
        (value.payload.batchJobId === undefined ||
          safeId(value.payload.batchJobId)) &&
        (value.payload.operationId === undefined ||
          safeId(value.payload.operationId)) &&
        typeof value.payload.includeAllPages === "boolean" &&
        typeof value.payload.input === "string" &&
        value.payload.input.trim().length > 0 &&
        value.payload.input.length <= 2_048 &&
        (value.payload.method === "direct" ||
          value.payload.method === "speech") &&
        (value.payload.speechLanguageMode === undefined ||
          value.payload.speechLanguageMode === "zh" ||
          value.payload.speechLanguageMode === "en" ||
          value.payload.speechLanguageMode === "other" ||
          value.payload.speechLanguageMode === "mixed" ||
          value.payload.speechLanguageMode === "ja") &&
        (value.payload.sourceKind === undefined ||
          value.payload.sourceKind === "auto" ||
          BATCH_SOURCE_KINDS.includes(
            value.payload.sourceKind as BatchSourceKind,
          ))
      );
    }
    case "muzhi.batch.start":
      return (
        (exactKeys(value.payload, ["batchJobId", "languagePreference"]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "method",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "method",
            "overwrite",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "overwrite",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "method",
            "overwrite",
            "speechRoutingMode",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "speechRoutingMode",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "overwrite",
            "speechRoutingMode",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "method",
            "speechRoutingMode",
          ]) ||
          exactKeys(value.payload, [
            "batchJobId",
            "languagePreference",
            "method",
            "overwrite",
            "speechRoutingMode",
            "speechLanguageScope",
          ])) &&
        safeId(value.payload.batchJobId) &&
        typeof value.payload.languagePreference === "string" &&
        value.payload.languagePreference.length <= 32 &&
        (value.payload.method === undefined ||
          value.payload.method === "direct" ||
          value.payload.method === "speech") &&
        (value.payload.overwrite === undefined ||
          value.payload.overwrite === "skip" ||
          value.payload.overwrite === "all") &&
        (value.payload.speechRoutingMode === undefined ||
          value.payload.speechRoutingMode === "balanced" ||
          value.payload.speechRoutingMode === "standard-first" ||
          value.payload.speechRoutingMode === "turbo-first") &&
        (value.payload.speechLanguageScope === undefined ||
          value.payload.speechLanguageScope === "zh" ||
          value.payload.speechLanguageScope === "en" ||
          value.payload.speechLanguageScope === "other" ||
          value.payload.speechLanguageScope === "mixed" ||
          value.payload.speechLanguageScope === "ja" ||
          value.payload.speechLanguageScope === "item")
      );
    case "muzhi.batch.cancel":
    case "muzhi.batch.read":
    case "muzhi.batch.delete":
      return (
        exactKeys(value.payload, ["batchJobId"]) &&
        safeId(value.payload.batchJobId)
      );
    case "muzhi.batch.export":
      return (
        (exactKeys(value.payload, ["batchJobId"]) ||
          exactKeys(value.payload, ["batchItemIds", "batchJobId"])) &&
        safeId(value.payload.batchJobId) &&
        (value.payload.batchItemIds === undefined ||
          (Array.isArray(value.payload.batchItemIds) &&
            value.payload.batchItemIds.length <= 2_000 &&
            value.payload.batchItemIds.every(safeId)))
      );
    case "muzhi.batch.jobs.list":
      return exactKeys(value.payload, []);
    case "muzhi.batch.archive.lists":
    case "muzhi.batch.trash.lists":
      return exactKeys(value.payload, []);
    case "muzhi.batch.list.restore":
    case "muzhi.batch.list.purge":
      return (
        exactKeys(value.payload, ["batchJobId"]) &&
        safeId(value.payload.batchJobId)
      );
    case "muzhi.batch.retention.get":
      return exactKeys(value.payload, []);
    case "muzhi.batch.retention.update":
      return (
        exactKeys(value.payload, ["applyMode", "policy"]) &&
        (value.payload.applyMode === "apply-to-existing" ||
          value.payload.applyMode === "future-only")
      );
    case "muzhi.batch.retention.purge-expired":
      return (
        exactKeys(value.payload, ["now"]) &&
        typeof value.payload.now === "number" &&
        Number.isSafeInteger(value.payload.now) &&
        value.payload.now >= 0
      );
    case "muzhi.batch.list.rename":
      return (
        exactKeys(value.payload, ["batchJobId", "name"]) &&
        safeId(value.payload.batchJobId) &&
        typeof value.payload.name === "string" &&
        value.payload.name.trim().length > 0 &&
        value.payload.name.length <= 200
      );
    case "muzhi.batch.list.pin":
      return (
        exactKeys(value.payload, ["batchJobId", "pinned"]) &&
        safeId(value.payload.batchJobId) &&
        typeof value.payload.pinned === "boolean"
      );
    case "muzhi.batch.list.archive":
    case "muzhi.batch.list.trash":
      return (
        exactKeys(value.payload, ["batchJobId"]) &&
        safeId(value.payload.batchJobId)
      );
    case "muzhi.batch.selection":
      return (
        exactKeys(value.payload, ["batchJobId", "selectedItemIds"]) &&
        safeId(value.payload.batchJobId) &&
        Array.isArray(value.payload.selectedItemIds) &&
        value.payload.selectedItemIds.length <= 2_000 &&
        value.payload.selectedItemIds.every(safeId)
      );
    case "muzhi.batch.item-speech-language":
      return (
        exactKeys(value.payload, [
          "batchItemId",
          "batchJobId",
          "speechLanguageMode",
        ]) &&
        safeId(value.payload.batchItemId) &&
        safeId(value.payload.batchJobId) &&
        (value.payload.speechLanguageMode === "zh" ||
          value.payload.speechLanguageMode === "en" ||
          value.payload.speechLanguageMode === "other" ||
          value.payload.speechLanguageMode === "mixed" ||
          value.payload.speechLanguageMode === "ja")
      );
    case "muzhi.batch.refetch-track":
      return (
        exactKeys(value.payload, ["batchItemId", "batchJobId", "trackId"]) &&
        safeId(value.payload.batchItemId) &&
        safeId(value.payload.batchJobId) &&
        typeof value.payload.trackId === "string" &&
        value.payload.trackId.length > 0 &&
        value.payload.trackId.length <= 200
      );
    case "muzhi.batch.clear-subtitles":
    case "muzhi.batch.delete-items":
      return (
        exactKeys(value.payload, ["batchItemIds", "batchJobId"]) &&
        safeId(value.payload.batchJobId) &&
        Array.isArray(value.payload.batchItemIds) &&
        value.payload.batchItemIds.length <= 2_000 &&
        value.payload.batchItemIds.every(safeId)
      );
    default:
      return false;
  }
}

function success(requestId: string, data: unknown): BatchResponse {
  return Object.freeze({
    payload: Object.freeze({ data, ok: true as const }),
    protocolVersion: BATCH_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.batch.response" as const,
  });
}

function failure(requestId: string, error: unknown): BatchResponse {
  const known = error instanceof BatchSourceError;
  return Object.freeze({
    payload: Object.freeze({
      errorCode: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "批量操作失败，请重试。",
      ok: false as const,
      retryable: known ? error.retryable : false,
    }),
    protocolVersion: BATCH_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.batch.response" as const,
  });
}

export function installChromeBatchRuntimeListener(
  chromeValue: unknown,
  dependencies: {
    readonly getRuntime: (
      onUpdate: (view: BatchJobView) => void,
    ) => Promise<BatchRuntime>;
  },
): void {
  const runtimeApi = readRuntime(chromeValue);
  const onUpdate = (view: BatchJobView): void => {
    void runtimeApi
      .sendMessage({
        payload: view,
        ...(view.prepareOperationId === undefined
          ? {}
          : { prepareOperationId: view.prepareOperationId }),
        protocolVersion: BATCH_RUNTIME_PROTOCOL_VERSION,
        type: "muzhi.batch.updated",
      })
      .catch(() => undefined);
  };

  const execute = async (command: BatchCommand): Promise<unknown> => {
    const runtime = await dependencies.getRuntime(onUpdate);
    switch (command.type) {
      case "muzhi.batch.list.create":
        if (runtime.createList === undefined)
          throw new Error("Batch list creation is unavailable");
        return runtime.createList();
      case "muzhi.batch.prepare":
        return runtime.prepare({
          ...(command.payload.batchJobId === undefined
            ? {}
            : {
                batchJobId: command.payload.batchJobId as string,
                operationId:
                  command.payload.operationId === undefined
                    ? command.requestId
                    : (command.payload.operationId as string),
              }),
          includeAllPages: command.payload.includeAllPages as boolean,
          input: command.payload.input as string,
          method: command.payload.method as BatchAcquisitionMethod,
          ...(command.payload.speechLanguageMode === undefined
            ? {}
            : {
                speechLanguageMode: command.payload
                  .speechLanguageMode as SubtitleLanguageMode,
              }),
          ...(command.payload.sourceKind === undefined
            ? {}
            : {
                sourceKind: command.payload.sourceKind as
                  BatchSourceKind | "auto",
              }),
        });
      case "muzhi.batch.start":
        return runtime.start({
          batchJobId: command.payload.batchJobId as string,
          languagePreference: command.payload.languagePreference as string,
          ...(command.payload.method === undefined
            ? {}
            : { method: command.payload.method as BatchAcquisitionMethod }),
          ...(command.payload.overwrite === undefined
            ? {}
            : { overwrite: command.payload.overwrite as "skip" | "all" }),
          ...(command.payload.speechRoutingMode === undefined
            ? {}
            : {
                speechRoutingMode: command.payload
                  .speechRoutingMode as GroqRoutingMode,
              }),
          ...(command.payload.speechLanguageScope === undefined
            ? {}
            : {
                speechLanguageScope: command.payload.speechLanguageScope as
                  SubtitleLanguageMode | "item",
              }),
        });
      case "muzhi.batch.cancel":
        return runtime.cancel(command.payload.batchJobId as string);
      case "muzhi.batch.read":
        return runtime.read(command.payload.batchJobId as string);
      case "muzhi.batch.jobs.list":
        return runtime.listWorkspaceLists();
      case "muzhi.batch.list.rename":
        return runtime.renameList(
          command.payload.batchJobId as string,
          command.payload.name as string,
        );
      case "muzhi.batch.list.pin":
        return runtime.setPinned(
          command.payload.batchJobId as string,
          command.payload.pinned as boolean,
        );
      case "muzhi.batch.list.archive":
        return runtime.archiveList(command.payload.batchJobId as string);
      case "muzhi.batch.list.trash":
        return runtime.trashList(command.payload.batchJobId as string);
      case "muzhi.batch.archive.lists":
        return runtime.listArchivedLists();
      case "muzhi.batch.trash.lists":
        return runtime.listTrashedLists();
      case "muzhi.batch.list.restore":
        return runtime.restoreList(command.payload.batchJobId as string);
      case "muzhi.batch.list.purge":
        return runtime.purgeList(command.payload.batchJobId as string);
      case "muzhi.batch.retention.get":
        return runtime.getRetentionPolicy();
      case "muzhi.batch.retention.update":
        return runtime.updateRetentionPolicy(
          command.payload.policy as TrashRetentionPolicy,
          command.payload.applyMode as TrashRetentionApplyMode,
        );
      case "muzhi.batch.retention.purge-expired":
        return runtime.permanentlyDeleteExpiredBatchTrash(
          command.payload.now as number,
        );
      case "muzhi.batch.selection":
        return runtime.setSelection(
          command.payload.batchJobId as string,
          command.payload.selectedItemIds as readonly string[],
        );
      case "muzhi.batch.item-speech-language":
        return runtime.setItemSpeechLanguage(
          command.payload.batchJobId as string,
          command.payload.batchItemId as string,
          command.payload.speechLanguageMode as SubtitleLanguageMode,
        );
      case "muzhi.batch.refetch-track":
        return runtime.refetchTrack(
          command.payload.batchJobId as string,
          command.payload.batchItemId as string,
          command.payload.trackId as string,
        );
      case "muzhi.batch.clear-subtitles":
        return runtime.clearSubtitles(
          command.payload.batchJobId as string,
          command.payload.batchItemIds as readonly string[],
        );
      case "muzhi.batch.delete-items":
        return runtime.deleteItems(
          command.payload.batchJobId as string,
          command.payload.batchItemIds as readonly string[],
        );
      case "muzhi.batch.delete":
        await runtime.deleteJob(command.payload.batchJobId as string);
        return null;
      case "muzhi.batch.export":
        return runtime.collectExport(
          command.payload.batchJobId as string,
          command.payload.batchItemIds as readonly string[] | undefined,
        );
    }
  };

  runtimeApi.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBatchCommand(message)) return false;
    const command = message;
    let responded = false;
    const respond = (response: BatchResponse): void => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(response);
      } catch {
        // 通道已关闭等异常视为已响应，不再重试，避免二次异常。
      }
    };
    void (async () => {
      try {
        const data = await execute(command);
        respond(success(command.requestId, data));
      } catch (error) {
        respond(failure(command.requestId, error));
      } finally {
        // 兜底：无论成功、失败还是意外异常，都必须 settle 消息通道，
        // 绝不无限挂起 sendResponse（respond 保证至多一次）。
        respond(
          failure(
            command.requestId,
            new Error("The batch command did not settle"),
          ),
        );
      }
    })();
    return true;
  });
}

function isResponse(value: unknown, requestId: string): value is BatchResponse {
  return (
    isRecord(value) &&
    exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) &&
    value.protocolVersion === BATCH_RUNTIME_PROTOCOL_VERSION &&
    value.requestId === requestId &&
    value.type === "muzhi.batch.response" &&
    isRecord(value.payload)
  );
}

function readView(value: unknown): BatchJobView {
  if (!isRecord(value)) throw new Error("Bilimuzhi批量响应无效");
  const items = Array.isArray(value.items) ? value.items : [];
  return Object.freeze({
    items: Object.freeze(
      items.map((item) => createBatchItem(item as BatchItem)),
    ),
    job: createBatchJob(value.job as BatchJob),
    addedCount:
      typeof value.addedCount === "number" &&
      Number.isSafeInteger(value.addedCount)
        ? value.addedCount
        : undefined,
    duplicateCount:
      typeof value.duplicateCount === "number" &&
      Number.isSafeInteger(value.duplicateCount)
        ? value.duplicateCount
        : undefined,
    overwriteCount:
      typeof value.overwriteCount === "number" &&
      Number.isSafeInteger(value.overwriteCount) &&
      value.overwriteCount >= 0
        ? value.overwriteCount
        : 0,
    prepareOperationId: safeId(value.prepareOperationId)
      ? value.prepareOperationId
      : undefined,
  });
}

function readExportEntries(value: unknown): readonly BatchExportEntry[] {
  if (!Array.isArray(value)) throw new Error("Bilimuzhi批量导出响应无效");
  return Object.freeze(
    value.flatMap((entry): BatchExportEntry[] => {
      if (
        !isRecord(entry) ||
        typeof entry.bvid !== "string" ||
        typeof entry.language !== "string" ||
        typeof entry.title !== "string" ||
        typeof entry.page !== "number" ||
        !Array.isArray(entry.rows)
      ) {
        return [];
      }
      return [
        Object.freeze({
          bvid: entry.bvid,
          language: entry.language,
          page: entry.page,
          rows: Object.freeze(
            entry.rows.flatMap((row) =>
              isRecord(row) &&
              typeof row.startMs === "number" &&
              typeof row.endMs === "number" &&
              typeof row.text === "string"
                ? [
                    Object.freeze({
                      endMs: row.endMs,
                      startMs: row.startMs,
                      text: row.text,
                    }),
                  ]
                : [],
            ),
          ),
          title: entry.title,
        }),
      ];
    }),
  );
}

export function createChromeBatchRuntimeClient(
  chromeValue: unknown,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
): ChromeBatchRuntimeClient {
  const runtimeApi = readRuntime(chromeValue);
  const send = async (
    type: BatchCommandType,
    payload: Record<string, unknown>,
  ): Promise<unknown> => {
    const requestId = createRequestId();
    let response: unknown;
    try {
      response = await runtimeApi.sendMessage({
        payload,
        protocolVersion: BATCH_RUNTIME_PROTOCOL_VERSION,
        requestId,
        type,
      });
    } catch {
      throw new ChromeBatchRuntimeError(
        "INTERNAL_ERROR",
        "无法连接Bilimuzhi批量后台，请重试。",
        true,
      );
    }
    if (!isResponse(response, requestId)) {
      throw new ChromeBatchRuntimeError(
        "INTERNAL_ERROR",
        "Bilimuzhi批量后台响应无效，请重试。",
        true,
      );
    }
    if (response.payload.ok !== true) {
      const payload = response.payload;
      throw new ChromeBatchRuntimeError(
        typeof payload.errorCode === "string"
          ? payload.errorCode
          : "INTERNAL_ERROR",
        typeof payload.message === "string"
          ? payload.message
          : "批量操作失败，请重试。",
        payload.retryable === true,
      );
    }
    return response.payload.data;
  };

  const client: ChromeBatchRuntimeClient = {
    async createList() {
      return readView(await send("muzhi.batch.list.create", {}));
    },
    async prepare(input) {
      return readView(await send("muzhi.batch.prepare", { ...input }));
    },
    async start(input) {
      return readView(await send("muzhi.batch.start", { ...input }));
    },
    async cancel(batchJobId) {
      const data = await send("muzhi.batch.cancel", { batchJobId });
      return data === null ? null : readView(data);
    },
    async read(batchJobId) {
      const data = await send("muzhi.batch.read", { batchJobId });
      return data === null ? null : readView(data);
    },
    async listJobs() {
      const data = await send("muzhi.batch.jobs.list", {});
      if (!Array.isArray(data)) throw new Error("Bilimuzhi批量任务响应无效");
      return Object.freeze(
        data.flatMap((entry) => {
          if (!isRecord(entry) || !isRecord(entry.job)) return [];
          const job = createBatchJob(entry.job as unknown as BatchJob);
          return [
            Object.freeze({
              job,
              pinned: entry.pinned === true,
            }),
          ];
        }),
      );
    },
    async renameList(batchJobId, name) {
      const data = await send("muzhi.batch.list.rename", {
        batchJobId,
        name,
      });
      return data === null ? null : readView(data);
    },
    async setPinned(batchJobId, pinned) {
      const data = await send("muzhi.batch.list.pin", {
        batchJobId,
        pinned,
      });
      return data === null ? null : readView(data);
    },
    async archiveList(batchJobId) {
      const data = await send("muzhi.batch.list.archive", { batchJobId });
      return data === null ? null : readView(data);
    },
    async trashList(batchJobId) {
      const data = await send("muzhi.batch.list.trash", { batchJobId });
      return data === null ? null : readView(data);
    },
    async listArchivedLists() {
      const data = await send("muzhi.batch.archive.lists", {});
      if (!Array.isArray(data)) throw new Error("Bilimuzhi批量归档响应无效");
      return Object.freeze(
        data.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          return [
            Object.freeze({
              archivedAt:
                typeof entry.archivedAt === "number" ? entry.archivedAt : 0,
              job: createBatchJob(entry.job as unknown as BatchJob),
              order: typeof entry.order === "number" ? entry.order : 0,
              pinned: entry.pinned === true,
            }),
          ];
        }),
      );
    },
    async listTrashedLists() {
      const data = await send("muzhi.batch.trash.lists", {});
      if (!Array.isArray(data)) throw new Error("Bilimuzhi批量回收站响应无效");
      return Object.freeze(
        data.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          return [
            Object.freeze({
              deletionReason:
                typeof entry.deletionReason === "string"
                  ? entry.deletionReason
                  : "unknown",
              job: createBatchJob(entry.job as unknown as BatchJob),
              order: typeof entry.order === "number" ? entry.order : 0,
              pinned: entry.pinned === true,
              purgeAfter:
                typeof entry.purgeAfter === "number" ? entry.purgeAfter : null,
              retentionStartedAt:
                typeof entry.retentionStartedAt === "number"
                  ? entry.retentionStartedAt
                  : 0,
              trashedAt:
                typeof entry.trashedAt === "number" ? entry.trashedAt : 0,
              trashOrigin:
                entry.trashOrigin === "archive" ? "archive" : "workspace",
            }),
          ];
        }),
      );
    },
    async restoreList(batchJobId) {
      const data = await send("muzhi.batch.list.restore", { batchJobId });
      return data === null ? null : readView(data);
    },
    async purgeList(batchJobId) {
      await send("muzhi.batch.list.purge", { batchJobId });
    },
    async getRetentionPolicy() {
      const data = await send("muzhi.batch.retention.get", {});
      return data as
        { durationDays: number; kind: "duration" } | { kind: "forever" };
    },
    async updateRetentionPolicy(policy, applyMode) {
      await send("muzhi.batch.retention.update", { applyMode, policy });
    },
    async permanentlyDeleteExpiredBatchTrash(now) {
      const data = await send("muzhi.batch.retention.purge-expired", { now });
      return Array.isArray(data) ? (data as string[]) : [];
    },
    async setSelection(batchJobId, selectedItemIds) {
      const data = await send("muzhi.batch.selection", {
        batchJobId,
        selectedItemIds,
      });
      return data === null ? null : readView(data);
    },
    async setItemSpeechLanguage(batchJobId, batchItemId, speechLanguageMode) {
      const data = await send("muzhi.batch.item-speech-language", {
        batchItemId,
        batchJobId,
        speechLanguageMode,
      });
      return data === null ? null : readView(data);
    },
    async refetchTrack(batchJobId, batchItemId, trackId) {
      const data = await send("muzhi.batch.refetch-track", {
        batchItemId,
        batchJobId,
        trackId,
      });
      return data === null ? null : readView(data);
    },
    async clearSubtitles(batchJobId, batchItemIds) {
      const data = await send("muzhi.batch.clear-subtitles", {
        batchItemIds,
        batchJobId,
      });
      return data === null ? null : readView(data);
    },
    async deleteItems(batchJobId, batchItemIds) {
      const data = await send("muzhi.batch.delete-items", {
        batchItemIds,
        batchJobId,
      });
      return data === null ? null : readView(data);
    },
    async deleteJob(batchJobId) {
      await send("muzhi.batch.delete", { batchJobId });
    },
    async collectExport(batchJobId, batchItemIds) {
      return readExportEntries(
        await send("muzhi.batch.export", {
          batchJobId,
          ...(batchItemIds === undefined ? {} : { batchItemIds }),
        }),
      );
    },
    subscribe(listener) {
      const runtimeListener: MessageListener = (message) => {
        if (
          isRecord(message) &&
          message.protocolVersion === BATCH_RUNTIME_PROTOCOL_VERSION &&
          message.type === "muzhi.batch.updated"
        ) {
          try {
            listener({
              payload: readView(message.payload),
              ...(safeId(message.prepareOperationId)
                ? { prepareOperationId: message.prepareOperationId }
                : {}),
              protocolVersion: BATCH_RUNTIME_PROTOCOL_VERSION,
              type: "muzhi.batch.updated",
            });
          } catch {
            // A malformed broadcast cannot break the panel.
          }
        }
        return false;
      };
      runtimeApi.onMessage.addListener(runtimeListener);
      return () => runtimeApi.onMessage.removeListener?.(runtimeListener);
    },
  };
  return Object.freeze(client);
}
