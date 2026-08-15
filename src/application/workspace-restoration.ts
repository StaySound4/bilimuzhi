import type {
  BranchPlacement,
  Session,
  SubtitleBranch,
  SubtitleSnapshot,
  VideoKey,
} from "../domain";

export type WorkspaceMode = "chat" | "segments" | "summary" | "timeline";

export interface WorkspaceScrollPositions {
  readonly chat: number;
  readonly segments: number;
  readonly summary: number;
  readonly timeline: number;
}

export interface SessionWorkspaceState {
  readonly activeMode: WorkspaceMode;
  readonly scrollTopByMode: WorkspaceScrollPositions;
  readonly sessionId: string;
}

export interface WorkspaceState {
  readonly activeSessionId: string | null;
  readonly sessions: readonly SessionWorkspaceState[];
  readonly version: 1;
}

export interface WorkspaceStateStore {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): Promise<void>;
}

export interface RestorableWorkspaceData {
  readonly branch: SubtitleBranch | null;
  readonly placement: BranchPlacement | null;
  readonly session: Session;
  readonly subtitle: SubtitleSnapshot | null;
}

export interface WorkspaceRestorationRepository {
  restore(sessionId: string): Promise<RestorableWorkspaceData | null>;
}

export type WorkspaceRouteLocation = "archive" | "workspace";

export interface RoutedWorkspaceData extends RestorableWorkspaceData {
  readonly location: WorkspaceRouteLocation;
}

export interface WorkspaceStartupRouter {
  route(videoKey: VideoKey): Promise<RoutedWorkspaceData | null>;
}

export interface RestoredWorkspace extends RestorableWorkspaceData {
  readonly activeMode: WorkspaceMode;
  readonly scrollTopByMode: WorkspaceScrollPositions;
}

export interface RestoreWorkspaceDependencies {
  readonly repository: WorkspaceRestorationRepository;
  readonly stateStore: WorkspaceStateStore;
}

const workspaceModes = new Set<string>([
  "chat",
  "segments",
  "summary",
  "timeline",
]);
const emptyScrollPositions: WorkspaceScrollPositions = Object.freeze({
  chat: 0,
  segments: 0,
  summary: 0,
  timeline: 0,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value === value.trim()
  );
}

function isScrollTop(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isScrollPositions(value: unknown): value is WorkspaceScrollPositions {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["chat", "segments", "summary", "timeline"]) &&
    isScrollTop(value.chat) &&
    isScrollTop(value.segments) &&
    isScrollTop(value.summary) &&
    isScrollTop(value.timeline)
  );
}

function isSessionWorkspaceState(
  value: unknown,
): value is SessionWorkspaceState {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["activeMode", "scrollTopByMode", "sessionId"]) &&
    typeof value.activeMode === "string" &&
    workspaceModes.has(value.activeMode) &&
    isScrollPositions(value.scrollTopByMode) &&
    isNonEmptyTrimmedString(value.sessionId)
  );
}

function freezeSessionWorkspaceState(
  state: SessionWorkspaceState,
): SessionWorkspaceState {
  return Object.freeze({
    activeMode: state.activeMode,
    scrollTopByMode: Object.freeze({ ...state.scrollTopByMode }),
    sessionId: state.sessionId,
  });
}

function freezeWorkspaceState(
  activeSessionId: string | null,
  sessions: readonly SessionWorkspaceState[],
): WorkspaceState {
  return Object.freeze({
    activeSessionId,
    sessions: Object.freeze(sessions.map(freezeSessionWorkspaceState)),
    version: 1,
  });
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["activeSessionId", "sessions", "version"]) ||
    value.version !== 1 ||
    (value.activeSessionId !== null &&
      !isNonEmptyTrimmedString(value.activeSessionId)) ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every(isSessionWorkspaceState)
  ) {
    return false;
  }

  const sessionIds = value.sessions.map((session) => session.sessionId);
  if (new Set(sessionIds).size !== sessionIds.length) {
    return false;
  }
  return (
    value.activeSessionId === null || sessionIds.includes(value.activeSessionId)
  );
}

export async function saveWorkspaceView(
  stateStore: WorkspaceStateStore,
  sessionState: SessionWorkspaceState,
): Promise<WorkspaceState> {
  if (!isSessionWorkspaceState(sessionState)) {
    throw new TypeError("The workspace session state is invalid");
  }
  const current = await stateStore.load();
  const normalizedSessionState = freezeSessionWorkspaceState(sessionState);
  const existingSessions = current?.sessions ?? [];
  const existingIndex = existingSessions.findIndex(
    (candidate) => candidate.sessionId === sessionState.sessionId,
  );
  const sessions = [...existingSessions];
  if (existingIndex < 0) {
    sessions.push(normalizedSessionState);
  } else {
    sessions[existingIndex] = normalizedSessionState;
  }
  const next = freezeWorkspaceState(sessionState.sessionId, sessions);
  await stateStore.save(next);
  return next;
}

export async function activateWorkspaceSession(
  stateStore: WorkspaceStateStore,
  sessionId: string,
): Promise<WorkspaceState> {
  if (!isNonEmptyTrimmedString(sessionId)) {
    throw new TypeError("The workspace session identity is invalid");
  }
  const current = await stateStore.load();
  const sessions = [...(current?.sessions ?? [])];
  if (!sessions.some((session) => session.sessionId === sessionId)) {
    sessions.push({
      activeMode: "timeline",
      scrollTopByMode: emptyScrollPositions,
      sessionId,
    });
  }
  const next = freezeWorkspaceState(sessionId, sessions);
  await stateStore.save(next);
  return next;
}

export async function removeWorkspaceSession(
  stateStore: WorkspaceStateStore,
  sessionId: string,
): Promise<WorkspaceState> {
  if (!isNonEmptyTrimmedString(sessionId)) {
    throw new TypeError("The workspace session identity is invalid");
  }
  const current = await stateStore.load();
  if (!current) {
    return freezeWorkspaceState(null, []);
  }
  const sessions = current.sessions.filter(
    (session) => session.sessionId !== sessionId,
  );
  const activeSessionId =
    current.activeSessionId === sessionId ? null : current.activeSessionId;
  const next = freezeWorkspaceState(activeSessionId, sessions);
  await stateStore.save(next);
  return next;
}

export async function restoreWorkspace({
  repository,
  stateStore,
}: RestoreWorkspaceDependencies): Promise<RestoredWorkspace | null> {
  const state = await stateStore.load();
  if (state?.activeSessionId === null || state === null) {
    return null;
  }
  const sessionState = state.sessions.find(
    (candidate) => candidate.sessionId === state.activeSessionId,
  );
  if (!sessionState) {
    return null;
  }
  const restored = await repository.restore(state.activeSessionId);
  if (!restored) {
    return null;
  }

  return Object.freeze({
    activeMode: sessionState.activeMode,
    branch: restored.branch,
    placement: restored.placement,
    scrollTopByMode: Object.freeze({ ...sessionState.scrollTopByMode }),
    session: restored.session,
    subtitle: restored.subtitle,
  });
}
