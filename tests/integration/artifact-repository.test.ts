import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { ArtifactScope } from "../../src/application/artifact-repository";
import { createSubtitleSnapshot, createVideoRef } from "../../src/domain";
import { IndexedDbArtifactRepository } from "../../src/infrastructure/indexeddb/artifact-repository";
import { IndexedDbGenerationRepository } from "../../src/infrastructure/indexeddb/generation-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-artifact-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

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

async function createFixture() {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=3",
    cid: 30_000_000_003,
    page: 3,
    title: "artifact repository",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "artifact-session",
    now: () => 100,
  }).create(video);
  const acquisition = {
    acquisitionId: "artifact-acquisition",
    draftBranchId: "artifact-branch",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "artifact-acquisition-task",
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
      contentHash: "sha256:artifact",
      createdAt: 200,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
      sessionId: acquisition.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "artifact-subtitle",
      videoKey: acquisition.videoKey,
    }),
  );
  const scope: ArtifactScope = Object.freeze({
    branchId: acquisition.draftBranchId,
    contextRevision: 1,
    sessionId: acquisition.sessionId,
    subtitleId: "artifact-subtitle",
  });
  return {
    database,
    repository: new IndexedDbArtifactRepository(database, { now: () => 500 }),
    scope,
  };
}

describe("IndexedDbArtifactRepository", () => {
  it("recovers from a stale owner record that no longer passes artifact validation", async () => {
    const { database, repository, scope } = await createFixture();

    // 写入同 owner 的陈旧记录（status ready 却带 errorCode，违反校验，
    // readArtifact 会失败；此前 ensure 会因此触发 byOwnerKind 唯一索引
    // ConstraintError，导致该字幕上下文永远无法开始生成）。
    const raw = {
      artifactId: "artifact-stale",
      artifactRevision: 1,
      branchId: scope.branchId,
      content: "",
      contextRevision: 1,
      createdAt: 400,
      errorCode: "OLD_LEGACY_ERROR",
      kind: "summary",
      modelId: "model-1",
      segments: [],
      sessionId: scope.sessionId,
      status: "ready",
      subtitleId: scope.subtitleId,
      updatedAt: 450,
    };
    const seeded = await new Promise<IDBValidKey>((resolve, reject) => {
      const transaction = database.transaction("artifacts", "readwrite");
      const request = transaction.objectStore("artifacts").add(raw);
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    expect(seeded).toBe("artifact-stale");

    // ensure 必须成功：清理陈旧记录后重建空 artifact，而不是抛错。
    const ensured = await repository.ensure({
      artifactId: "artifact-fresh",
      kind: "summary",
      scope,
    });
    expect(ensured.status).toBe("empty");
    expect(ensured.artifactId).toBe("artifact-stale");
    const listed = await repository.list(scope);
    expect(listed).toHaveLength(1);
    expect(listed[0].errorCode).toBeNull();
  });

  it("creates one artifact per kind and returns the same one on repeat", async () => {
    const { repository, scope } = await createFixture();

    const first = await repository.ensure({
      artifactId: "artifact-1",
      kind: "summary",
      scope,
    });
    const second = await repository.ensure({
      artifactId: "artifact-2",
      kind: "summary",
      scope,
    });
    const segments = await repository.ensure({
      artifactId: "artifact-3",
      kind: "segments",
      scope,
    });

    expect(first.artifactId).toBe("artifact-1");
    expect(second.artifactId).toBe("artifact-1");
    expect(second.status).toBe("empty");
    expect(segments.artifactId).toBe("artifact-3");
    await expect(repository.list(scope)).resolves.toHaveLength(2);
  });

  it("refuses to create an artifact outside the active subtitle context", async () => {
    const { repository, scope } = await createFixture();

    await expect(
      repository.ensure({
        artifactId: "artifact-x",
        kind: "summary",
        scope: { ...scope, contextRevision: 9 },
      }),
    ).rejects.toThrow();
  });

  it("bumps the artifact revision on every generation start", async () => {
    const { repository, scope } = await createFixture();
    await repository.ensure({ artifactId: "a", kind: "summary", scope });

    const first = await repository.beginGeneration({
      artifactId: "a",
      modelId: "model-1",
    });
    const second = await repository.beginGeneration({
      artifactId: "a",
      modelId: "model-2",
    });

    expect(first.artifactRevision).toBe(1);
    expect(second.artifactRevision).toBe(2);
    expect(second.status).toBe("generating");
    expect(second.modelId).toBe("model-2");
  });

  it("ignores a completion from a superseded revision", async () => {
    const { repository, scope } = await createFixture();
    await repository.ensure({ artifactId: "a", kind: "summary", scope });
    const stale = await repository.beginGeneration({
      artifactId: "a",
      modelId: "model-1",
    });
    await repository.beginGeneration({ artifactId: "a", modelId: "model-2" });

    await expect(
      repository.complete({
        artifactId: "a",
        content: "迟到结果",
        expectedRevision: stale.artifactRevision,
        segments: [],
      }),
    ).resolves.toBeNull();
    await expect(repository.get("a")).resolves.toMatchObject({
      content: "",
      status: "generating",
    });
  });

  it("stores parsed segments and reopens them from storage", async () => {
    const { repository, scope } = await createFixture();
    await repository.ensure({ artifactId: "a", kind: "segments", scope });
    await repository.beginGeneration({ artifactId: "a", modelId: "model-1" });

    const stored = await repository.complete({
      artifactId: "a",
      content: "## [00:00 - 00:01] 开场\n描述",
      expectedRevision: 1,
      segments: [
        {
          detail: "描述",
          endMs: 1_000,
          startMs: 0,
          title: "开场",
          isAdvertisement: false,
        },
      ],
    });

    expect(stored?.status).toBe("ready");
    await expect(repository.get("a")).resolves.toMatchObject({
      segments: [
        {
          detail: "描述",
          endMs: 1_000,
          startMs: 0,
          title: "开场",
          isAdvertisement: false,
        },
      ],
      status: "ready",
    });
  });

  it("clearing an artifact stops its running generation run", async () => {
    const { database, repository, scope } = await createFixture();
    const artifact = await repository.ensure({
      artifactId: "a",
      kind: "summary",
      scope,
    });
    const begun = await repository.beginGeneration({
      artifactId: artifact.artifactId,
      modelId: "model-1",
    });
    const generations = new IndexedDbGenerationRepository(database, {
      now: () => 600,
    });
    const run = await generations.begin({
      branchId: scope.branchId,
      browserSessionId: "browser-1",
      completionSequence: null,
      contextRevision: scope.contextRevision,
      createdAt: 600,
      errorCode: null,
      expectedOwnerRevision: begun.artifactRevision,
      kind: "summary",
      partialOutput: "",
      runId: "run-1",
      sessionId: scope.sessionId,
      status: "queued",
      stopReason: null,
      subtitleId: scope.subtitleId,
      targetId: artifact.artifactId,
      taskId: "task-1",
      updatedAt: 600,
    });

    expect(run.status).toBe("queued");
    const cleared = await repository.clear(artifact.artifactId);

    expect(cleared?.status).toBe("empty");
    expect(cleared?.artifactRevision).toBe(begun.artifactRevision + 1);
    const remaining = await generations.listQueuedOrRunning();
    expect(remaining.some((value) => value.runId === run.runId)).toBe(false);
  });
});
