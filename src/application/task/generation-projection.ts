import {
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  type GenerationRun,
  type Session,
  type SubtitleBranch,
} from "../../domain";
import { isGenerationRunNonTerminal } from "../generation-runtime-contract";

export interface GenerationBranchTaskProjection {
  readonly branchId: string;
  readonly running: boolean;
  readonly sessionId: string;
  readonly unread: boolean;
}

export interface GenerationSessionTaskProjection {
  readonly running: boolean;
  readonly sessionId: string;
  readonly unread: boolean;
}

export interface GenerationTaskProjection {
  readonly branches: readonly GenerationBranchTaskProjection[];
  readonly sessions: readonly GenerationSessionTaskProjection[];
}

function runBelongsToCurrentBranch(
  run: GenerationRun,
  branch: SubtitleBranch,
): boolean {
  return (
    run.sessionId === branch.sessionId &&
    run.branchId === branch.branchId &&
    run.subtitleId === branch.activeSubtitleId &&
    run.contextRevision === branch.contextRevision
  );
}

function isRunning(run: GenerationRun): boolean {
  return isGenerationRunNonTerminal(run.status);
}

export function createGenerationTaskProjection(input: {
  readonly branches: readonly SubtitleBranch[];
  readonly runs: readonly GenerationRun[];
  readonly sessions: readonly Session[];
}): GenerationTaskProjection {
  const branches = input.branches.map(createSubtitleBranch);
  const runs = input.runs.map(createGenerationRun);
  const sessions = input.sessions.map(createSession);
  const seenBranchIds = new Set<string>();
  const branchProjections = branches.map((branch) => {
    if (seenBranchIds.has(branch.branchId)) {
      throw new Error("The generation projection contains a duplicate Branch");
    }
    seenBranchIds.add(branch.branchId);
    return Object.freeze({
      branchId: branch.branchId,
      running: runs.some(
        (run) => isRunning(run) && runBelongsToCurrentBranch(run, branch),
      ),
      sessionId: branch.sessionId,
      unread: branch.completionSequence > branch.lastReadCompletionSequence,
    });
  });

  const seenSessionIds = new Set<string>();
  const sessionProjections = sessions.map((session) => {
    if (seenSessionIds.has(session.sessionId)) {
      throw new Error("The generation projection contains a duplicate Session");
    }
    seenSessionIds.add(session.sessionId);
    const childBranches = branchProjections.filter(
      (branch) => branch.sessionId === session.sessionId,
    );
    return Object.freeze({
      running: childBranches.some((branch) => branch.running),
      sessionId: session.sessionId,
      unread: childBranches.some((branch) => branch.unread),
    });
  });

  return Object.freeze({
    branches: Object.freeze(branchProjections),
    sessions: Object.freeze(sessionProjections),
  });
}

/**
 * Marking completion notifications read is a Branch-level action. It does
 * not update a Session and callers must prove that the exact Branch is open.
 */
export function advanceGenerationBranchReadCursor(
  inputBranch: SubtitleBranch,
  input: {
    readonly branchId: string;
    readonly now: number;
    readonly sessionId: string;
  },
): SubtitleBranch {
  const branch = createSubtitleBranch(inputBranch);
  if (
    input.sessionId !== branch.sessionId ||
    input.branchId !== branch.branchId
  ) {
    throw new Error("The generation read cursor requires the exact Branch");
  }
  return createSubtitleBranch({
    ...branch,
    lastReadCompletionSequence: branch.completionSequence,
    updatedAt: Math.max(branch.updatedAt, input.now),
  });
}
