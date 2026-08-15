import type {
  Session,
  VideoKey,
  VideoRef,
  WorkspaceSessionPlacement,
} from "../domain";

export interface SessionRepository {
  list(): Promise<readonly Session[]>;
  getByVideoKey(videoKey: VideoKey): Promise<Session | null>;
  create(video: VideoRef): Promise<Session>;
  /** Optional for structural compatibility with repositories predating empty sessions. */
  createEmpty?(input: { readonly title: string }): Promise<Session>;
  /** Optional for structural compatibility; production repositories should persist the binding. */
  synchronizeCreatedSession?(
    sessionId: string,
    video: VideoRef,
  ): Promise<Session>;
  rename(sessionId: string, title: string): Promise<Session>;
  touch(sessionId: string): Promise<Session>;
  setPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<WorkspaceSessionPlacement>;
  reorder(
    sessionId: string,
    beforeSessionId: string | null,
  ): Promise<readonly WorkspaceSessionPlacement[]>;
  deleteCascade(sessionId: string): Promise<void>;
}
