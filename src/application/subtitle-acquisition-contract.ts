import type { SubtitleLanguageMode, VideoKey } from "../domain";
import type { SubtitleTrackOption } from "./subtitle-gateway";

export type SubtitleAcquisitionMethod = "direct" | "speech";

export interface SubtitleAcquisitionOwner {
  readonly acquisitionId: string;
  /** Runtime request that owns this acquisition. Repeated delivery is idempotent. */
  readonly requestId?: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly draftBranchId: string;
  readonly videoKey: VideoKey;
  readonly expectedSelectionRevision: number;
  readonly expectedContextRevision: number;
  /**
   * Exact immutable direct-subtitle identity. These fields are optional only
   * for persisted v10 speech runs and their compatibility readers.
   */
  readonly subtitleContextRevision?: number;
  /** Stable v12 name for the runtime request that owns this exact response. */
  readonly requestOwner?: string;
  /** Stable v12 name for the exact player-page revision captured at request time. */
  readonly pageRevision?: number;
  readonly operationRevision?: number;
  readonly trackId?: string;
  readonly bvid?: string;
  readonly aid?: number;
  readonly cid?: number;
  readonly page?: number;
}

export interface DirectSubtitleAcquisitionParameters {
  readonly method: "direct";
  readonly trackId: string;
}

export interface SpeechSubtitleAcquisitionParameters {
  readonly method: "speech";
  readonly requestedLanguageMode: SubtitleLanguageMode;
  readonly provider: string;
  readonly model: string;
  readonly mediaIdentity: string;
}

export type SubtitleAcquisitionParameters =
  DirectSubtitleAcquisitionParameters | SpeechSubtitleAcquisitionParameters;

export interface SubtitleAcquisitionRequest {
  readonly owner: SubtitleAcquisitionOwner;
  readonly parameters: SubtitleAcquisitionParameters;
}

export interface SubtitleAcquisitionResult {
  readonly owner: SubtitleAcquisitionOwner;
  readonly branchId: string;
  readonly subtitleId: string;
  readonly rowCount: number;
}

export interface SubtitleAcquisitionService {
  listTracks(
    owner: SubtitleAcquisitionOwner,
  ): Promise<readonly SubtitleTrackOption[]>;
  acquire(
    request: SubtitleAcquisitionRequest,
  ): Promise<SubtitleAcquisitionResult>;
}

export type { SubtitleLanguageMode } from "../domain";
