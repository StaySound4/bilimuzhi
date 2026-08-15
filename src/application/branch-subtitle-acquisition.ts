import type { VideoKey } from "../domain";
import type { DirectSubtitleAcquirer } from "./subtitle-gateway";
import {
  SubtitleRepositoryError,
  type BranchSubtitleRepository,
  type InitialSubtitleCommitResult,
} from "./subtitle-repository";
import type { SubtitleAcquisitionOwner } from "./subtitle-acquisition-contract";

export interface StartDirectSubtitleAcquisitionInput {
  readonly operationRevision?: number;
  readonly requestId?: string;
  readonly taskId?: string;
  readonly trackId: string;
  readonly videoKey: VideoKey;
}

export interface BranchSubtitleAcquisitionHandle {
  readonly owner: SubtitleAcquisitionOwner;
  readonly result: Promise<InitialSubtitleCommitResult>;
  cancel(): Promise<void>;
}

export interface BranchSubtitleAcquisitionService {
  startDirect(
    input: StartDirectSubtitleAcquisitionInput,
  ): Promise<BranchSubtitleAcquisitionHandle>;
  /** Exact runtime entry used by v11; optional for v10-compatible adapters. */
  startDirectOwned?(
    input: StartDirectSubtitleAcquisitionInput & {
      readonly operationRevision: number;
      readonly requestId: string;
    },
  ): Promise<BranchSubtitleAcquisitionHandle>;
}

export interface BranchSubtitleAcquisitionServiceDependencies {
  readonly createAcquisitionId: () => string;
  readonly createDraftBranchId: () => string;
  readonly createTaskId: () => string;
  readonly directAcquirer: DirectSubtitleAcquirer;
  readonly repository: BranchSubtitleRepository;
}

function directOperationKey(
  input: StartDirectSubtitleAcquisitionInput,
): string {
  if (input.requestId !== undefined) {
    return `direct:request:${input.requestId}`;
  }
  return `direct:${input.videoKey}:${input.trackId}:${input.operationRevision ?? "legacy"}`;
}

class DefaultBranchSubtitleAcquisitionService implements BranchSubtitleAcquisitionService {
  private readonly active = new Map<
    string,
    Promise<BranchSubtitleAcquisitionHandle>
  >();
  private readonly retainedRequestKeys: string[] = [];

  constructor(
    private readonly dependencies: BranchSubtitleAcquisitionServiceDependencies,
  ) {}

  startDirect(
    input: StartDirectSubtitleAcquisitionInput,
  ): Promise<BranchSubtitleAcquisitionHandle> {
    const key = directOperationKey(input);
    const existing = this.active.get(key);
    if (existing) {
      return existing;
    }
    const start = this.startDirectOperation(input);
    this.active.set(key, start);
    void start
      .then((handle) => handle.result)
      .catch(() => undefined)
      .finally(() => {
        if (input.requestId !== undefined) {
          this.retainedRequestKeys.push(key);
          while (this.retainedRequestKeys.length > 128) {
            const staleKey = this.retainedRequestKeys.shift();
            if (staleKey !== undefined && staleKey !== key) {
              this.active.delete(staleKey);
            }
          }
          return;
        }
        if (this.active.get(key) === start) {
          this.active.delete(key);
        }
      });
    return start;
  }

  startDirectOwned(
    input: StartDirectSubtitleAcquisitionInput & {
      readonly operationRevision: number;
      readonly requestId: string;
    },
  ): Promise<BranchSubtitleAcquisitionHandle> {
    return this.startDirect(input);
  }

  private async startDirectOperation(
    input: StartDirectSubtitleAcquisitionInput,
  ): Promise<BranchSubtitleAcquisitionHandle> {
    const context = await this.dependencies.repository.readAcquisitionContext(
      input.videoKey,
    );
    if (context === null) {
      throw new SubtitleRepositoryError(
        "VIDEO_NOT_BOUND",
        "The subtitle acquisition video is not bound",
      );
    }
    const taskId = input.taskId ?? this.dependencies.createTaskId();
    const owner: SubtitleAcquisitionOwner = Object.freeze({
      acquisitionId: this.dependencies.createAcquisitionId(),
      aid: context.video.aid,
      bvid: context.video.bvid,
      cid: context.video.cid,
      draftBranchId: this.dependencies.createDraftBranchId(),
      expectedContextRevision: context.expectedContextRevision,
      expectedSelectionRevision: context.session.selectionRevision,
      operationRevision: input.operationRevision ?? 0,
      page: context.video.page,
      pageRevision: input.operationRevision ?? 0,
      requestId: input.requestId ?? taskId,
      requestOwner: input.requestId ?? taskId,
      sessionId: context.session.sessionId,
      subtitleContextRevision: context.expectedContextRevision,
      taskId,
      trackId: input.trackId,
      videoKey: input.videoKey,
    });
    const acquisitionContext =
      await this.dependencies.repository.beginAcquisition(owner, {
        method: "direct",
        trackId: input.trackId,
      });
    const result = (async (): Promise<InitialSubtitleCommitResult> => {
      try {
        const staged = await this.dependencies.directAcquirer({
          branchId: owner.draftBranchId,
          session: acquisitionContext.session,
          trackId: input.trackId,
          video: acquisitionContext.video,
        });
        return await this.dependencies.repository.commitAcquisition(
          owner,
          staged,
        );
      } catch (error) {
        try {
          await this.dependencies.repository.finishAcquisition(owner, "failed");
        } catch {
          // Preserve the original acquisition failure for the caller.
        }
        throw error;
      }
    })();
    return Object.freeze({
      cancel: () =>
        this.dependencies.repository.finishAcquisition(owner, "cancelled"),
      owner,
      result,
    });
  }
}

export function createBranchSubtitleAcquisitionService(
  dependencies: BranchSubtitleAcquisitionServiceDependencies,
): BranchSubtitleAcquisitionService {
  return new DefaultBranchSubtitleAcquisitionService(dependencies);
}
