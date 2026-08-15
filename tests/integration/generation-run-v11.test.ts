import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { ArtifactScope } from "../../src/application/artifact-repository";
import {
  createSubtitleSnapshot,
  createVideoRef,
  type GenerationRun,
} from "../../src/domain";
import { IndexedDbArtifactRepository } from "../../src/infrastructure/indexeddb/artifact-repository";
import { IndexedDbGenerationRepository } from "../../src/infrastructure/indexeddb/generation-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
    ),
  );
});

async function fixture() {
  const databaseName = `muzhi-generation-v11-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: databaseName,
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=1",
    cid: 30_000_000_001,
    page: 1,
    title: "generation snapshot",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "generation-session",
    now: () => 100,
  }).create(video);
  const acquisition = {
    acquisitionId: "generation-acquisition",
    draftBranchId: "generation-branch",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "generation-acquisition-task",
    videoKey: video.videoKey,
  };
  const subtitles = new IndexedDbSubtitleRepository(database, {
    now: () => 200,
  });
  await subtitles.beginAcquisition(acquisition, {
    method: "direct",
    trackId: "official:zh:1",
  });
  await subtitles.commitAcquisition(
    acquisition,
    createSubtitleSnapshot({
      branchId: acquisition.draftBranchId,
      contentHash: "sha256:generation-v11",
      createdAt: 200,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
      sessionId: acquisition.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "generation-subtitle",
      videoKey: acquisition.videoKey,
    }),
  );
  const scope: ArtifactScope = {
    branchId: acquisition.draftBranchId,
    contextRevision: 1,
    sessionId: acquisition.sessionId,
    subtitleId: "generation-subtitle",
  };
  const artifacts = new IndexedDbArtifactRepository(database, {
    now: () => 300,
  });
  const artifact = await artifacts.ensure({
    artifactId: "generation-artifact",
    kind: "summary",
    scope,
  });
  const generating = await artifacts.beginGeneration({
    artifactId: artifact.artifactId,
    modelId: "model-v11",
  });
  return {
    generating,
    repository: new IndexedDbGenerationRepository(database, { now: () => 400 }),
    scope,
  };
}

function queuedRun(
  scope: ArtifactScope,
  artifactId: string,
  artifactRevision: number,
): GenerationRun {
  return {
    branchId: scope.branchId,
    browserSessionId: "browser-v11",
    completionSequence: null,
    contextRevision: scope.contextRevision,
    createdAt: 400,
    errorCode: null,
    expectedOwnerRevision: artifactRevision,
    kind: "summary",
    partialOutput: "",
    runId: "run-v11",
    sessionId: scope.sessionId,
    status: "queued",
    stopReason: null,
    subtitleId: scope.subtitleId,
    targetId: artifactId,
    taskId: "task-v11",
    updatedAt: 400,
  };
}

describe("IndexedDB GenerationRun v11 snapshot", () => {
  it("persists only safe hashes and exact conversation/run revisions across reopen", async () => {
    const { generating, repository, scope } = await fixture();
    const input = {
      ...queuedRun(scope, generating.artifactId, generating.artifactRevision),
      contextHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      conversationRevision: generating.artifactRevision,
      modelHash:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      prompt: "PRIVATE PROMPT sk-secret-value",
      promptHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runRevision: 3,
    } as GenerationRun & {
      readonly contextHash: string;
      readonly conversationRevision: number;
      readonly modelHash: string;
      readonly prompt: string;
      readonly promptHash: string;
      readonly runRevision: number;
    };

    await repository.begin(input);
    const reopened = (await repository.listQueuedOrRunning())[0] as
      | (GenerationRun & {
          readonly contextHash: string;
          readonly conversationRevision: number;
          readonly modelHash: string;
          readonly promptHash: string;
          readonly runRevision: number;
        })
      | undefined;

    expect(reopened).toMatchObject({
      contextHash: input.contextHash,
      conversationRevision: generating.artifactRevision,
      modelHash: input.modelHash,
      promptHash: input.promptHash,
      runRevision: 3,
    });
    expect(JSON.stringify(reopened)).not.toContain("PRIVATE PROMPT");
    expect(JSON.stringify(reopened)).not.toContain("sk-secret-value");
  });

  it("reopens a legacy record with non-secret compatibility defaults", async () => {
    const { generating, repository, scope } = await fixture();
    await repository.begin(
      queuedRun(scope, generating.artifactId, generating.artifactRevision),
    );

    const reopened = (await repository.listQueuedOrRunning())[0] as
      | (GenerationRun & {
          readonly contextHash: string | null;
          readonly conversationRevision: number;
          readonly modelHash: string | null;
          readonly promptHash: string | null;
          readonly runRevision: number;
        })
      | undefined;
    expect(reopened).toMatchObject({
      contextHash: null,
      conversationRevision: reopened?.expectedOwnerRevision,
      modelHash: null,
      promptHash: null,
      runRevision: 0,
    });
  });
});
