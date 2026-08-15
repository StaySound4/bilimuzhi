import type { Artifact, ArtifactKind, ArtifactSegment } from "../domain";

export interface ArtifactScope {
  readonly sessionId: string;
  readonly branchId: string;
  readonly subtitleId: string;
  readonly contextRevision: number;
}

export interface ArtifactCompletionInput {
  readonly artifactId: string;
  readonly content: string;
  readonly expectedRevision: number;
  readonly segments: readonly ArtifactSegment[];
}

export interface ArtifactFailureInput {
  readonly artifactId: string;
  readonly errorCode: string;
  readonly expectedRevision: number;
}

export interface ArtifactRepository {
  list(scope: ArtifactScope): Promise<readonly Artifact[]>;
  get(artifactId: string): Promise<Artifact | null>;
  /**
   * Returns the artifact owning (scope, kind), creating an empty one when the
   * subtitle context does not have it yet. The scope must still be the active
   * subtitle context of a non-trashed session.
   */
  ensure(input: {
    readonly artifactId: string;
    readonly kind: ArtifactKind;
    readonly scope: ArtifactScope;
  }): Promise<Artifact>;
  /**
   * Increments the artifact revision, clears previous content and marks the
   * artifact as generating. Every explicit regeneration therefore invalidates
   * late events from the superseded run.
   */
  beginGeneration(input: {
    readonly artifactId: string;
    readonly modelId: string;
  }): Promise<Artifact>;
  /** Applies output only when the artifact revision still matches. */
  complete(input: ArtifactCompletionInput): Promise<Artifact | null>;
  fail(input: ArtifactFailureInput): Promise<Artifact | null>;
  /** Resets to the empty state and invalidates any in-flight run. */
  clear(artifactId: string): Promise<Artifact | null>;
}
