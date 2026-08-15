import type { ArchiveSessionTags, SubtitleTrackOrigin, Tag } from "../domain";

export interface WorkspaceBranchProjection {
  readonly branchId: string;
  readonly createdAt: number;
  readonly detectedLanguage: string | null;
  readonly language: string;
  readonly requestedLanguageMode: "zh" | "en" | "other" | "mixed" | "ja" | null;
  readonly running: boolean;
  readonly source: "bilibili" | "groq-whisper";
  readonly title: string | null;
  readonly trackOrigin: SubtitleTrackOrigin | null;
  readonly unread: boolean;
}

/** Metadata-only by contract: no subtitle, AI, attachment, or run content. */
export interface TrashBranchProjection {
  readonly branchId: string;
  readonly createdAt: number;
  readonly detectedLanguage: string | null;
  readonly language: string;
  readonly purgeAfter: number | null;
  readonly requestedLanguageMode: "zh" | "en" | "other" | "mixed" | "ja" | null;
  readonly source: "bilibili" | "groq-whisper";
  readonly title: string | null;
  readonly trackOrigin: SubtitleTrackOrigin | null;
  readonly trashedAt: number;
  readonly trashOrigin: "workspace" | "archive";
  readonly trashOriginFolderId: string | null;
  readonly trashOriginPathSnapshot: string | null;
}

export interface WorkspaceSessionProjection {
  readonly branches: readonly WorkspaceBranchProjection[];
  /** 归档时间戳（毫秒），仅归档位置存在；旧数据缺失时由投影回退为 order。 */
  readonly archivedAt: number | null;
  readonly folderId: string | null;
  readonly location: "workspace" | "archive";
  readonly order: number;
  readonly pinned: boolean;
  readonly sessionId: string;
  readonly title: string;
  readonly videoKey: string;
}

export interface TrashSessionProjection {
  readonly branches: readonly TrashBranchProjection[];
  readonly emptySession?: {
    readonly purgeAfter: number | null;
    readonly trashedAt: number;
    readonly trashOrigin: "workspace" | "archive";
  };
  readonly location: "trash";
  readonly sessionId: string;
  readonly title: string;
  readonly videoKey: string;
}

export interface ArchiveFolderProjection {
  readonly childFolderIds: readonly string[];
  readonly folderId: string;
  readonly isRoot: boolean;
  readonly order: number;
  readonly parentFolderId: string | null;
  readonly sessionIds: readonly string[];
  readonly title: string;
}

export interface WorkspaceProductProjection {
  readonly archive: {
    readonly folders: readonly ArchiveFolderProjection[];
    readonly sessions: readonly WorkspaceSessionProjection[];
    /** 标签全量（按类、类内排序）。 */
    readonly tags: readonly Tag[];
    /** 会话 → 标签 id 集合。 */
    readonly sessionTags: readonly ArchiveSessionTags[];
    /** 标签 → 引用会话数。 */
    readonly tagCounts: ReadonlyMap<string, number>;
    /** 预设筛选组合（8b）。 */
  };
  readonly trash: { readonly sessions: readonly TrashSessionProjection[] };
  readonly workspace: {
    readonly sessions: readonly WorkspaceSessionProjection[];
  };
}

export interface WorkspaceProjectionReader {
  load(): Promise<WorkspaceProductProjection>;
}
