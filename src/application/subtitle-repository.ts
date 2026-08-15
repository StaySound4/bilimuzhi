import type {
  BranchPlacement,
  Session,
  SubtitleBranch,
  SubtitleSnapshot,
  VideoKey,
  VideoRef,
} from "../domain";
import type {
  SubtitleAcquisitionOwner,
  SubtitleAcquisitionParameters,
} from "./subtitle-acquisition-contract";

export type SubtitleRepositoryErrorCode =
  | "VALIDATION_FAILED"
  | "VIDEO_NOT_BOUND"
  | "SUBTITLE_REPLACEMENT_REQUIRED"
  | "STORAGE_TRANSACTION_FAILED";

export class SubtitleRepositoryError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: SubtitleRepositoryErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "SubtitleRepositoryError";
    this.retryable = retryable;
  }
}

export interface SubtitleAcquisitionContext {
  /**
   * Next subtitle context revision that a fresh acquisition owner must claim.
   * Empty sessions start at 1; after an active context exists this is
   * activeContextRevision + 1 so overwrite attempts stay fail-safe and ordered.
   */
  readonly expectedContextRevision: number;
  readonly session: Session;
  readonly video: VideoRef;
}

export interface InitialSubtitleCommitResult {
  readonly branch: SubtitleBranch;
  readonly placement: BranchPlacement;
  readonly session: Session;
  readonly subtitle: SubtitleSnapshot;
}

export interface SubtitleRepository {
  readAcquisitionContext(
    videoKey: VideoKey,
  ): Promise<SubtitleAcquisitionContext | null>;
  commitInitialAcquisition(
    stagedSubtitle: SubtitleSnapshot,
  ): Promise<InitialSubtitleCommitResult>;
}

export type AcquisitionRunCompletion = "cancelled" | "failed";

export interface BranchSubtitleRepository extends SubtitleRepository {
  beginAcquisition(
    owner: SubtitleAcquisitionOwner,
    parameters: SubtitleAcquisitionParameters,
  ): Promise<SubtitleAcquisitionContext>;
  commitAcquisition(
    owner: SubtitleAcquisitionOwner,
    stagedSubtitle: SubtitleSnapshot,
  ): Promise<InitialSubtitleCommitResult>;
  finishAcquisition(
    owner: SubtitleAcquisitionOwner,
    completion: AcquisitionRunCompletion,
  ): Promise<void>;
}
