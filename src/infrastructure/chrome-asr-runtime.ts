import type {
  AsrProgress,
  AsrProgressActivity,
} from "../application/asr-contract";
import type {
  SpeechAcquisitionRecord,
  SpeechAcquisitionStore,
} from "../application/asr/speech-acquisition-coordinator";
import type { SubtitleAcquisitionOwner } from "../application/subtitle-acquisition-contract";

const SPEECH_RECORD_PREFIX = "muzhi.speech.acquisition.v1:";

export interface ChromeAsrStorageArea {
  get(key: string | null): Promise<Record<string, unknown>>;
  remove?(keys: string | readonly string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeOffscreenApi {
  createDocument(input: {
    readonly justification: string;
    readonly reasons: readonly ["WORKERS"];
    readonly url: string;
  }): Promise<void>;
  hasDocument?(): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FORBIDDEN_PERSISTED_FIELDS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "mediaurl",
  "providermessage",
  "providerresponse",
  "rawproviderbody",
]);

function containsForbiddenPersistedField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenPersistedField);
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_PERSISTED_FIELDS.has(key.toLowerCase()) ||
      containsForbiddenPersistedField(nested),
  );
}

function hasSafeRecordShape(value: unknown): value is SpeechAcquisitionRecord {
  if (
    !isRecord(value) ||
    !isRecord(value.owner) ||
    !isRecord(value.parameters)
  ) {
    return false;
  }
  return (
    typeof value.owner.taskId === "string" &&
    value.owner.taskId.length > 0 &&
    typeof value.browserSessionId === "string" &&
    value.browserSessionId.length > 0 &&
    (value.status === "queued" ||
      value.status === "running" ||
      value.status === "completed" ||
      value.status === "cancelled" ||
      value.status === "interrupted" ||
      value.status === "failed") &&
    value.parameters.provider === "groq" &&
    typeof value.parameters.model === "string" &&
    !containsForbiddenPersistedField(value)
  );
}

function freezeRecord(
  record: SpeechAcquisitionRecord,
): SpeechAcquisitionRecord {
  return Object.freeze({
    ...record,
    checkpoint:
      record.checkpoint === null
        ? null
        : Object.freeze({
            ...record.checkpoint,
            completedChunks: Object.freeze(
              record.checkpoint.completedChunks.map((chunk) =>
                Object.freeze({ ...chunk }),
              ),
            ),
          }),
    owner: Object.freeze({ ...record.owner }),
    parameters: Object.freeze({ ...record.parameters }),
    progress: freezeProgress(record.progress),
  });
}

function safeFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function freezeActivity(value: unknown): AsrProgressActivity | undefined {
  if (!isRecord(value) || typeof value.phase !== "string") return undefined;
  if (
    (value.phase === "uploading" ||
      value.phase === "waiting-response" ||
      value.phase === "switching-model" ||
      value.phase === "rate-limited") &&
    Number.isSafeInteger(value.currentChunk) &&
    Number(value.currentChunk) > 0 &&
    Number.isSafeInteger(value.totalChunks) &&
    Number(value.totalChunks) >= Number(value.currentChunk)
  ) {
    const retryAfterSeconds = safeFiniteNonNegative(value.retryAfterSeconds)
      ? Math.ceil(value.retryAfterSeconds)
      : undefined;
    return Object.freeze({
      currentChunk: Number(value.currentChunk),
      phase: value.phase,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      totalChunks: Number(value.totalChunks),
    });
  }
  if (
    "completedBytes" in value &&
    safeFiniteNonNegative(value.completedBytes) &&
    value.phase === "encoding" &&
    safeFiniteNonNegative(value.totalBytes)
  ) {
    return Object.freeze({
      completedBytes: value.completedBytes,
      phase: "encoding",
      totalBytes: value.totalBytes,
    });
  }
  if (
    "completedBytes" in value &&
    (value.phase === "entitlement" ||
      value.phase === "metadata" ||
      value.phase === "downloading" ||
      value.phase === "hashing") &&
    safeFiniteNonNegative(value.completedBytes) &&
    (value.totalBytes === null || safeFiniteNonNegative(value.totalBytes))
  ) {
    return Object.freeze({
      completedBytes: value.completedBytes,
      phase: value.phase,
      totalBytes: value.totalBytes,
    });
  }
  if (
    (value.phase === "loading" ||
      value.phase === "encoding" ||
      value.phase === "reading") &&
    safeFiniteNonNegative(value.completedUnits) &&
    safeFiniteNonNegative(value.totalUnits)
  ) {
    return Object.freeze({
      completedUnits: value.completedUnits,
      phase: value.phase,
      totalUnits: value.totalUnits,
    });
  }
  return undefined;
}

function freezeProgress(progress: AsrProgress): AsrProgress {
  const activity = freezeActivity(progress.activity);
  const audioPreparationBytes = freezeActivity(progress.audioPreparationBytes);
  return Object.freeze({
    ...(activity === undefined ? {} : { activity }),
    ...(audioPreparationBytes?.phase === "encoding" &&
    "completedBytes" in audioPreparationBytes
      ? { audioPreparationBytes }
      : {}),
    completedChunks: progress.completedChunks,
    stage: progress.stage,
    totalChunks: progress.totalChunks,
  });
}

function sameOwner(
  left: SubtitleAcquisitionOwner,
  right: SubtitleAcquisitionOwner,
): boolean {
  return (
    left.taskId === right.taskId &&
    left.acquisitionId === right.acquisitionId &&
    left.sessionId === right.sessionId &&
    left.draftBranchId === right.draftBranchId &&
    left.videoKey === right.videoKey &&
    left.expectedSelectionRevision === right.expectedSelectionRevision &&
    left.expectedContextRevision === right.expectedContextRevision
  );
}

export function createChromeSpeechAcquisitionStore(
  storage: ChromeAsrStorageArea,
  recordPrefix = SPEECH_RECORD_PREFIX,
): SpeechAcquisitionStore {
  const recordKey = (taskId: string): string => `${recordPrefix}${taskId}`;
  const writeQueues = new Map<string, Promise<unknown>>();
  const enqueueWrite = <T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    writeQueues.set(key, next);
    return next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
  };
  async function read(owner: SubtitleAcquisitionOwner) {
    const value = (await storage.get(recordKey(owner.taskId)))[
      recordKey(owner.taskId)
    ];
    return hasSafeRecordShape(value) && sameOwner(value.owner, owner)
      ? freezeRecord(value)
      : null;
  }

  const store: SpeechAcquisitionStore = Object.freeze({
    async begin(record: Parameters<SpeechAcquisitionStore["begin"]>[0]) {
      const key = recordKey(record.owner.taskId);
      return await enqueueWrite(key, async () => {
        const existing = (await storage.get(key))[key];
        if (hasSafeRecordShape(existing)) {
          if (!sameOwner(existing.owner, record.owner)) {
            throw new Error("The speech task ID belongs to another owner");
          }
          return freezeRecord(existing);
        }
        const running = freezeRecord({ ...record, status: "running" });
        await storage.set({ [key]: running });
        return running;
      });
    },
    get: read,
    async listActive() {
      const values = await storage.get(null);
      return Object.freeze(
        Object.entries(values)
          .filter(([key]) => key.startsWith(recordPrefix))
          .map(([, value]) => value)
          .filter(hasSafeRecordShape)
          .filter(
            (record) =>
              record.status === "queued" || record.status === "running",
          )
          .map(freezeRecord),
      );
    },
    async updateCheckpoint(
      owner: Parameters<SpeechAcquisitionStore["updateCheckpoint"]>[0],
      input: Parameters<SpeechAcquisitionStore["updateCheckpoint"]>[1],
    ) {
      const key = recordKey(owner.taskId);
      return await enqueueWrite(key, async () => {
        const current = await read(owner);
        if (
          current === null ||
          (current.status !== "queued" && current.status !== "running")
        ) {
          return null;
        }
        const updated = freezeRecord({
          ...current,
          checkpoint: input.checkpoint,
          progress: input.progress,
          updatedAt: Math.max(current.updatedAt, input.now),
        });
        await storage.set({ [key]: updated });
        return updated;
      });
    },
    async finish(
      owner: Parameters<SpeechAcquisitionStore["finish"]>[0],
      input: Parameters<SpeechAcquisitionStore["finish"]>[1],
    ) {
      const key = recordKey(owner.taskId);
      return await enqueueWrite(key, async () => {
        const current = await read(owner);
        if (current === null) return null;
        if (current.status !== "queued" && current.status !== "running") {
          return current;
        }
        const terminal: SpeechAcquisitionRecord = Object.freeze({
          ...current,
          errorCode: input.status === "failed" ? input.errorCode : null,
          status: input.status,
          updatedAt: Math.max(current.updatedAt, input.now),
        });
        await storage.set({ [key]: terminal });
        return terminal;
      });
    },
  });
  return store;
}

export function createChromeOffscreenSpeechRuntime(
  offscreen: ChromeOffscreenApi,
) {
  let creation: Promise<void> | null = null;
  return Object.freeze({
    async ensureDocument(): Promise<void> {
      if ((await offscreen.hasDocument?.()) === true) return;
      if (creation !== null) return creation;
      creation = offscreen
        .createDocument({
          justification: "处理用户明确启动的语音转字幕任务",
          reasons: ["WORKERS"],
          url: "offscreen.html",
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          if (/single offscreen document|already exists/i.test(message)) return;
          throw error;
        })
        .finally(() => {
          creation = null;
        });
      return creation;
    },
  });
}

export { SPEECH_RECORD_PREFIX };
