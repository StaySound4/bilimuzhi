import {
  isWorkspaceState,
  type WorkspaceState,
  type WorkspaceStateStore,
} from "../application/workspace-restoration";
import { StorageError } from "../application/storage";

export const WORKSPACE_STATE_STORAGE_KEY = "muzhi.workspace.v1";

export interface ChromeWorkspaceStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function freezeWorkspaceState(state: WorkspaceState): WorkspaceState {
  const sessions = state.sessions.map((session) =>
    Object.freeze({
      activeMode: session.activeMode,
      scrollTopByMode: Object.freeze({ ...session.scrollTopByMode }),
      sessionId: session.sessionId,
    }),
  );
  return Object.freeze({
    activeSessionId: state.activeSessionId,
    sessions: Object.freeze(sessions),
    version: 1,
  });
}

function normalizeStorageError(error: unknown, message: string): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError(message, true);
}

export function createChromeWorkspaceStateStore(
  storage: ChromeWorkspaceStorageArea,
): WorkspaceStateStore {
  return Object.freeze({
    async load(): Promise<WorkspaceState | null> {
      try {
        const stored = (await storage.get(WORKSPACE_STATE_STORAGE_KEY))[
          WORKSPACE_STATE_STORAGE_KEY
        ];
        if (stored === undefined) {
          return null;
        }
        if (!isWorkspaceState(stored)) {
          throw new StorageError("The saved Bilimuzhi workspace state is invalid");
        }
        return freezeWorkspaceState(stored);
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to read the Bilimuzhi workspace state",
        );
      }
    },

    async save(state: WorkspaceState): Promise<void> {
      try {
        if (!isWorkspaceState(state)) {
          throw new StorageError("The Bilimuzhi workspace state is invalid");
        }
        await storage.set({
          [WORKSPACE_STATE_STORAGE_KEY]: freezeWorkspaceState(state),
        });
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to save the Bilimuzhi workspace state",
        );
      }
    },
  });
}
