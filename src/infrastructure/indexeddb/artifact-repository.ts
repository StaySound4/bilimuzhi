import type {
  ArtifactCompletionInput,
  ArtifactFailureInput,
  ArtifactRepository,
  ArtifactScope,
} from "../../application/artifact-repository";
import { StorageError } from "../../application/storage";
import {
  createArtifact,
  createBranchPlacement,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type Artifact,
  type ArtifactKind,
  type GenerationRun,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export interface IndexedDbArtifactRepositoryDependencies {
  readonly now: () => number;
}

const OWNER_STORES = [
  "artifacts",
  "branchPlacements",
  "generationRuns",
  "sessions",
  "subtitleBranches",
  "subtitleSnapshots",
] as const;

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi artifact database");
}

function readArtifact(value: unknown): Artifact | null {
  try {
    return createArtifact(value as Artifact);
  } catch {
    return null;
  }
}

function readRun(value: unknown): GenerationRun | null {
  try {
    return createGenerationRun(value as GenerationRun);
  } catch {
    return null;
  }
}

function hasAuthoritativeScope(
  scope: ArtifactScope,
  storedSession: unknown,
  storedBranch: unknown,
  storedPlacement: unknown,
  storedSubtitle: unknown,
): boolean {
  try {
    const session = createSession(
      storedSession as Parameters<typeof createSession>[0],
    );
    const branch = createSubtitleBranch(
      storedBranch as Parameters<typeof createSubtitleBranch>[0],
    );
    const placement = createBranchPlacement(
      storedPlacement as Parameters<typeof createBranchPlacement>[0],
    );
    const subtitle = createSubtitleSnapshot(
      storedSubtitle as Parameters<typeof createSubtitleSnapshot>[0],
    );
    return (
      session.sessionId === scope.sessionId &&
      branch.sessionId === scope.sessionId &&
      branch.branchId === scope.branchId &&
      branch.activeSubtitleId === scope.subtitleId &&
      branch.contextRevision === scope.contextRevision &&
      placement.sessionId === scope.sessionId &&
      placement.branchId === scope.branchId &&
      placement.location !== "trash" &&
      subtitle.sessionId === scope.sessionId &&
      subtitle.branchId === scope.branchId &&
      subtitle.subtitleId === scope.subtitleId &&
      subtitle.status === "active"
    );
  } catch {
    return false;
  }
}

export class IndexedDbArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbArtifactRepositoryDependencies,
  ) {}

  async list(scope: ArtifactScope): Promise<readonly Artifact[]> {
    try {
      const transaction = this.database.transaction("artifacts", "readonly");
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const stored = (await requestResult(
        transaction
          .objectStore("artifacts")
          .index("bySessionId")
          .getAll(scope.sessionId),
      )) as readonly unknown[];
      await done;
      return Object.freeze(
        stored
          .map(readArtifact)
          .filter(
            (artifact): artifact is Artifact =>
              artifact !== null &&
              artifact.branchId === scope.branchId &&
              artifact.subtitleId === scope.subtitleId &&
              artifact.contextRevision === scope.contextRevision,
          )
          .sort((left, right) => left.kind.localeCompare(right.kind)),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async get(artifactId: string): Promise<Artifact | null> {
    try {
      const transaction = this.database.transaction("artifacts", "readonly");
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const stored = await requestResult(
        transaction.objectStore("artifacts").get(artifactId),
      );
      await done;
      return readArtifact(stored);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async ensure(input: {
    readonly artifactId: string;
    readonly kind: ArtifactKind;
    readonly scope: ArtifactScope;
  }): Promise<Artifact> {
    try {
      const transaction = this.database.transaction(
        [...OWNER_STORES],
        "readwrite",
      );
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const artifacts = transaction.objectStore("artifacts");
      const [
        existing,
        storedSession,
        storedBranch,
        storedPlacement,
        storedSubtitle,
      ] = await Promise.all([
        requestResult(
          artifacts
            .index("byOwnerKind")
            .get([
              input.scope.sessionId,
              input.scope.branchId,
              input.scope.subtitleId,
              input.kind,
            ]),
        ),
        requestResult(
          transaction.objectStore("sessions").get(input.scope.sessionId),
        ),
        requestResult(
          transaction.objectStore("subtitleBranches").get(input.scope.branchId),
        ),
        requestResult(
          transaction.objectStore("branchPlacements").get(input.scope.branchId),
        ),
        requestResult(
          transaction
            .objectStore("subtitleSnapshots")
            .get(input.scope.subtitleId),
        ),
      ]);
      if (
        !hasAuthoritativeScope(
          input.scope,
          storedSession,
          storedBranch,
          storedPlacement,
          storedSubtitle,
        )
      ) {
        transaction.abort();
        throw new StorageError(
          "The Bilimuzhi subtitle context is no longer authoritative",
        );
      }
      const current = readArtifact(existing);
      if (
        current !== null &&
        current.contextRevision === input.scope.contextRevision
      ) {
        await done;
        return current;
      }
      // 陈旧数据兜底：同 owner 已有原始记录但 readArtifact 校验失败
      // byOwnerKind 唯一索引冲突导致生成永远无法开始。
      if (current === null && existing !== undefined) {
        const stalePrimaryKey = await requestResult(
          artifacts
            .index("byOwnerKind")
            .getKey([
              input.scope.sessionId,
              input.scope.branchId,
              input.scope.subtitleId,
              input.kind,
            ]),
        );
        if (stalePrimaryKey !== undefined) {
          await requestResult(artifacts.delete(stalePrimaryKey));
        }
      }
      const staleArtifactId =
        current === null &&
        typeof (existing as { artifactId?: unknown } | null)?.artifactId ===
          "string"
          ? ((existing as { artifactId: string }).artifactId as string)
          : null;
      const now = this.dependencies.now();
      const created = createArtifact({
        artifactId: staleArtifactId ?? current?.artifactId ?? input.artifactId,
        artifactRevision: 0,
        branchId: input.scope.branchId,
        content: "",
        contextRevision: input.scope.contextRevision,
        createdAt: now,
        errorCode: null,
        kind: input.kind,
        modelId: null,
        segments: [],
        sessionId: input.scope.sessionId,
        status: "empty",
        subtitleId: input.scope.subtitleId,
        updatedAt: now,
      });
      artifacts.put(created);
      await done;
      return created;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async beginGeneration(input: {
    readonly artifactId: string;
    readonly modelId: string;
  }): Promise<Artifact> {
    try {
      const transaction = this.database.transaction(
        [...OWNER_STORES],
        "readwrite",
      );
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const artifacts = transaction.objectStore("artifacts");
      const current = readArtifact(
        await requestResult(artifacts.get(input.artifactId)),
      );
      if (current === null) {
        transaction.abort();
        throw new StorageError("The Bilimuzhi artifact no longer exists");
      }
      const [storedSession, storedBranch, storedPlacement, storedSubtitle] =
        await Promise.all([
          requestResult(
            transaction.objectStore("sessions").get(current.sessionId),
          ),
          requestResult(
            transaction.objectStore("subtitleBranches").get(current.branchId),
          ),
          requestResult(
            transaction.objectStore("branchPlacements").get(current.branchId),
          ),
          requestResult(
            transaction
              .objectStore("subtitleSnapshots")
              .get(current.subtitleId),
          ),
        ]);
      if (
        !hasAuthoritativeScope(
          current,
          storedSession,
          storedBranch,
          storedPlacement,
          storedSubtitle,
        )
      ) {
        transaction.abort();
        throw new StorageError(
          "The Bilimuzhi subtitle context is no longer authoritative",
        );
      }
      const now = this.dependencies.now();
      const next = createArtifact({
        ...current,
        artifactRevision: current.artifactRevision + 1,
        errorCode: null,
        modelId: input.modelId,
        status: "generating",
        updatedAt: Math.max(now, current.updatedAt),
      });
      artifacts.put(next);
      await done;
      return next;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  complete(input: ArtifactCompletionInput): Promise<Artifact | null> {
    return this.applyTerminal(
      input.artifactId,
      input.expectedRevision,
      (current, now) =>
        createArtifact({
          ...current,
          content: input.content,
          errorCode: null,
          segments: input.segments,
          status: "ready",
          updatedAt: Math.max(now, current.updatedAt),
        }),
    );
  }

  fail(input: ArtifactFailureInput): Promise<Artifact | null> {
    return this.applyTerminal(
      input.artifactId,
      input.expectedRevision,
      (current, now) =>
        createArtifact({
          ...current,
          content: current.content,
          errorCode: input.errorCode,
          segments: current.segments,
          status: "failed",
          updatedAt: Math.max(now, current.updatedAt),
        }),
    );
  }

  async clear(artifactId: string): Promise<Artifact | null> {
    try {
      const transaction = this.database.transaction(
        ["artifacts", "generationRuns"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const artifacts = transaction.objectStore("artifacts");
      const current = readArtifact(
        await requestResult(artifacts.get(artifactId)),
      );
      if (current === null) {
        await done;
        return null;
      }
      const now = this.dependencies.now();
      const next = createArtifact({
        ...current,
        artifactRevision: current.artifactRevision + 1,
        content: "",
        errorCode: null,
        modelId: null,
        segments: [],
        status: "empty",
        updatedAt: Math.max(now, current.updatedAt),
      });
      artifacts.put(next);
      await this.stopRunsForTarget(transaction, current, now);
      await done;
      return next;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  private async applyTerminal(
    artifactId: string,
    expectedRevision: number,
    project: (current: Artifact, now: number) => Artifact,
  ): Promise<Artifact | null> {
    try {
      const transaction = this.database.transaction("artifacts", "readwrite");
      const done = transactionDone(transaction);
      // An aborted guard transaction must not surface as an unhandled rejection.
      void done.catch(() => undefined);
      const artifacts = transaction.objectStore("artifacts");
      const current = readArtifact(
        await requestResult(artifacts.get(artifactId)),
      );
      if (
        current === null ||
        current.artifactRevision !== expectedRevision ||
        current.status !== "generating"
      ) {
        await done;
        return null;
      }
      const next = project(current, this.dependencies.now());
      artifacts.put(next);
      await done;
      return next;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  private async stopRunsForTarget(
    transaction: IDBTransaction,
    artifact: Artifact,
    now: number,
  ): Promise<void> {
    const runs = transaction.objectStore("generationRuns");
    const stored = (await requestResult(
      runs.index("byBranchId").getAll(artifact.branchId),
    )) as readonly unknown[];
    for (const value of stored) {
      const run = readRun(value);
      if (
        run === null ||
        run.targetId !== artifact.artifactId ||
        (run.status !== "queued" && run.status !== "running")
      ) {
        continue;
      }
      runs.put(
        createGenerationRun({
          ...run,
          completionSequence: null,
          errorCode: null,
          status: "stopped",
          stopReason: "owner-deleted",
          updatedAt: Math.max(now, run.updatedAt),
        }),
      );
    }
  }
}
