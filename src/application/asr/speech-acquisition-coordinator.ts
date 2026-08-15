import type {
  AsrCheckpoint,
  AsrProgress,
  GroqRoutingMode,
} from "../asr-contract";
import { GROQ_CHUNK_BUDGET_MS } from "../asr-contract";
import type {
  SubtitleAcquisitionOwner,
  SubtitleLanguageMode,
} from "../subtitle-acquisition-contract";

export type SpeechAcquisitionStatus =
  "queued" | "running" | "completed" | "cancelled" | "interrupted" | "failed";

export interface SpeechAcquisitionParameters {
  readonly requestedLanguageMode: SubtitleLanguageMode;
  readonly routingMode: GroqRoutingMode;
  readonly provider: "groq";
  readonly model: string;
}

export interface SpeechAcquisitionRecord {
  readonly owner: SubtitleAcquisitionOwner;
  readonly browserSessionId: string;
  readonly parameters: SpeechAcquisitionParameters;
  readonly checkpoint: AsrCheckpoint | null;
  readonly progress: AsrProgress;
  readonly status: SpeechAcquisitionStatus;
  readonly errorCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SpeechAcquisitionResult {
  readonly branchId: string;
  readonly subtitleId: string;
  readonly rowCount: number;
  readonly detectedLanguage: string | null;
}

export interface SpeechAcquisitionStore {
  begin(record: SpeechAcquisitionRecord): Promise<SpeechAcquisitionRecord>;
  get(owner: SubtitleAcquisitionOwner): Promise<SpeechAcquisitionRecord | null>;
  listActive(): Promise<readonly SpeechAcquisitionRecord[]>;
  updateCheckpoint(
    owner: SubtitleAcquisitionOwner,
    input: {
      readonly checkpoint: AsrCheckpoint;
      readonly progress: AsrProgress;
      readonly now: number;
    },
  ): Promise<SpeechAcquisitionRecord | null>;
  finish(
    owner: SubtitleAcquisitionOwner,
    input:
      | { readonly status: "completed"; readonly now: number }
      | {
          readonly status: "cancelled" | "interrupted";
          readonly now: number;
        }
      | {
          readonly status: "failed";
          readonly errorCode: string;
          readonly now: number;
        },
  ): Promise<SpeechAcquisitionRecord | null>;
}

export interface SpeechAcquisitionExecutor {
  cancel(owner: SubtitleAcquisitionOwner): Promise<void>;
  execute(input: {
    readonly record: SpeechAcquisitionRecord;
    readonly signal: AbortSignal;
    readonly onCheckpoint: (
      checkpoint: AsrCheckpoint,
      progress: AsrProgress,
    ) => Promise<void>;
  }): Promise<SpeechAcquisitionResult>;
}

export interface SpeechAcquisitionCoordinatorDependencies {
  readonly browserSessionId: string;
  readonly createAcquisitionId: () => string;
  readonly createDraftBranchId: () => string;
  readonly createTaskId: () => string;
  readonly executor: SpeechAcquisitionExecutor;
  readonly inactivityTimeoutMs?: number;
  readonly now: () => number;
  readonly readOwnerContext: (
    videoKey: SubtitleAcquisitionOwner["videoKey"],
  ) => Promise<Pick<
    SubtitleAcquisitionOwner,
    "sessionId" | "expectedSelectionRevision" | "expectedContextRevision"
  > | null>;
  readonly store: SpeechAcquisitionStore;
}

export interface SpeechAcquisitionHandle {
  readonly owner: SubtitleAcquisitionOwner;
  readonly result: Promise<SpeechAcquisitionResult>;
  cancel(): Promise<void>;
}

export class SpeechAcquisitionError extends Error {
  constructor(
    readonly code:
      | "VIDEO_NOT_BOUND"
      | "BACKGROUND_RECOVERY_FAILED"
      | "CANCELLED"
      | "EXECUTION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SpeechAcquisitionError";
  }
}

function operationKey(
  videoKey: SubtitleAcquisitionOwner["videoKey"],
  parameters: SpeechAcquisitionParameters,
): string {
  return [
    videoKey,
    parameters.provider,
    parameters.model,
    parameters.routingMode,
    parameters.requestedLanguageMode,
  ].join("\u0000");
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "SPEECH_TRANSCRIPTION_FAILED";
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

export function createSpeechAcquisitionCoordinator(
  dependencies: SpeechAcquisitionCoordinatorDependencies,
) {
  const inactivityTimeoutMs = dependencies.inactivityTimeoutMs ?? 240_000;
  if (!Number.isSafeInteger(inactivityTimeoutMs) || inactivityTimeoutMs <= 0) {
    throw new Error("The speech inactivity timeout is invalid");
  }
  const active = new Map<
    string,
    {
      readonly controller: AbortController;
      readonly handle: SpeechAcquisitionHandle;
    }
  >();
  const pendingStarts = new Map<string, Promise<SpeechAcquisitionHandle>>();

  async function executeRecord(
    key: string,
    record: SpeechAcquisitionRecord,
  ): Promise<SpeechAcquisitionHandle> {
    const existing = active.get(key);
    if (existing) return existing.handle;
    const controller = new AbortController();
    const result = (async (): Promise<SpeechAcquisitionResult> => {
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let rejectInactivity: (reason: unknown) => void = () => undefined;
      let timedOut = false;
      const inactivity = new Promise<never>((_resolve, reject) => {
        rejectInactivity = reject;
      });
      const armInactivityTimer = (): void => {
        if (inactivityTimer !== null) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          rejectInactivity(
            new SpeechAcquisitionError(
              "EXECUTION_FAILED",
              "Speech transcription stopped publishing progress",
            ),
          );
        }, inactivityTimeoutMs);
      };
      try {
        armInactivityTimer();
        const completed = await Promise.race([
          dependencies.executor.execute({
            onCheckpoint: async (checkpoint, progress) => {
              const updated = await dependencies.store.updateCheckpoint(
                record.owner,
                { checkpoint, now: dependencies.now(), progress },
              );
              if (updated === null) {
                controller.abort();
                return;
              }
              armInactivityTimer();
            },
            record,
            signal: controller.signal,
          }),
          inactivity,
        ]);
        const finished = await dependencies.store.finish(record.owner, {
          now: dependencies.now(),
          status: "completed",
        });
        if (finished === null || finished.status !== "completed") {
          throw new SpeechAcquisitionError(
            finished?.status === "cancelled" ? "CANCELLED" : "EXECUTION_FAILED",
            "The speech acquisition owner is no longer active",
          );
        }
        return completed;
      } catch (error) {
        if (timedOut) {
          try {
            await dependencies.executor.cancel(record.owner);
          } catch {
            // The terminal timeout state is authoritative even if cleanup fails.
          }
          await dependencies.store.finish(record.owner, {
            errorCode: "TIMEOUT",
            now: dependencies.now(),
            status: "failed",
          });
          throw new SpeechAcquisitionError(
            "EXECUTION_FAILED",
            "Speech transcription timed out",
          );
        }
        if (controller.signal.aborted) {
          await dependencies.store.finish(record.owner, {
            now: dependencies.now(),
            status: "cancelled",
          });
          throw new SpeechAcquisitionError(
            "CANCELLED",
            "Speech transcription was cancelled",
          );
        }
        await dependencies.store.finish(record.owner, {
          errorCode: safeErrorCode(error),
          now: dependencies.now(),
          status: "failed",
        });
        throw error;
      } finally {
        if (inactivityTimer !== null) clearTimeout(inactivityTimer);
        if (active.get(key)?.controller === controller) active.delete(key);
      }
    })();
    const handle: SpeechAcquisitionHandle = Object.freeze({
      cancel: async () => {
        controller.abort();
        await dependencies.executor.cancel(record.owner);
        await dependencies.store.finish(record.owner, {
          now: dependencies.now(),
          status: "cancelled",
        });
      },
      owner: record.owner,
      result,
    });
    active.set(key, Object.freeze({ controller, handle }));
    return handle;
  }

  return Object.freeze({
    async cancel(owner: SubtitleAcquisitionOwner): Promise<boolean> {
      for (const entry of active.values()) {
        if (sameOwner(entry.handle.owner, owner)) {
          await entry.handle.cancel();
          return true;
        }
      }
      const persisted = (await dependencies.store.listActive()).find((record) =>
        sameOwner(record.owner, owner),
      );
      if (persisted === undefined) return false;
      await dependencies.executor.cancel(owner);
      await dependencies.store.finish(owner, {
        now: dependencies.now(),
        status: "cancelled",
      });
      return true;
    },

    start(input: {
      readonly videoKey: SubtitleAcquisitionOwner["videoKey"];
      readonly parameters: SpeechAcquisitionParameters;
      readonly taskId?: string;
    }): Promise<SpeechAcquisitionHandle> {
      const key = operationKey(input.videoKey, input.parameters);
      const existing = active.get(key);
      if (existing) return Promise.resolve(existing.handle);
      const pending = pendingStarts.get(key);
      if (pending) return pending;
      const operation = (async (): Promise<SpeechAcquisitionHandle> => {
        const context = await dependencies.readOwnerContext(input.videoKey);
        if (context === null) {
          throw new SpeechAcquisitionError(
            "VIDEO_NOT_BOUND",
            "The speech acquisition video is not bound",
          );
        }
        const owner: SubtitleAcquisitionOwner = Object.freeze({
          acquisitionId: dependencies.createAcquisitionId(),
          draftBranchId: dependencies.createDraftBranchId(),
          expectedContextRevision: context.expectedContextRevision,
          expectedSelectionRevision: context.expectedSelectionRevision,
          sessionId: context.sessionId,
          taskId: input.taskId ?? dependencies.createTaskId(),
          videoKey: input.videoKey,
        });
        const now = dependencies.now();
        const record = await dependencies.store.begin(
          Object.freeze({
            browserSessionId: dependencies.browserSessionId,
            checkpoint: null,
            createdAt: now,
            errorCode: null,
            owner,
            parameters: Object.freeze({ ...input.parameters }),
            progress: Object.freeze({
              completedChunks: 0,
              stage: "preparing",
              totalChunks: 0,
            }),
            status: "queued",
            updatedAt: now,
          }),
        );
        return executeRecord(key, record);
      })();
      pendingStarts.set(key, operation);
      const clear = (): void => {
        if (pendingStarts.get(key) === operation) pendingStarts.delete(key);
      };
      void operation.then(clear, clear);
      return operation;
    },

    async recover(): Promise<readonly SpeechAcquisitionHandle[]> {
      const records = await dependencies.store.listActive();
      const handles: SpeechAcquisitionHandle[] = [];
      for (const record of records) {
        if (
          record.browserSessionId !== dependencies.browserSessionId ||
          (record.checkpoint !== null &&
            record.checkpoint.browserSessionId !==
              dependencies.browserSessionId)
        ) {
          await dependencies.store.finish(record.owner, {
            now: dependencies.now(),
            status: "interrupted",
          });
          continue;
        }
        if (
          record.checkpoint !== null &&
          record.checkpoint.uncertainChunkIndex !== null &&
          (record.checkpoint.uncertainChunkRetryCount === 1 ||
            !Number.isFinite(record.updatedAt) ||
            dependencies.now() - record.updatedAt >= GROQ_CHUNK_BUDGET_MS)
        ) {
          await dependencies.store.finish(record.owner, {
            now: dependencies.now(),
            status: "interrupted",
          });
          continue;
        }
        handles.push(
          await executeRecord(
            operationKey(record.owner.videoKey, record.parameters),
            record,
          ),
        );
      }
      return Object.freeze(handles);
    },
  });
}
