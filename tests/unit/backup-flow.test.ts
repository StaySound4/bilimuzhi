import { describe, expect, it } from "vitest";

import { describeBackupImportPreview } from "../../src/ui/backup-flow";
import type { BackupImportPreview } from "../../src/application/backup";

describe("describeBackupImportPreview", () => {
  it("lists per-group incoming/replaced statistics", () => {
    const preview: BackupImportPreview = {
      selectedGroups: ["workspace", "archive"],
      statistics: {
        workspace: { incoming: 3, replaced: 1 },
        "batch-archive": { incoming: 0, replaced: 0 },
        "batch-trash": { incoming: 0, replaced: 0 },
        "batch-workspace": { incoming: 0, replaced: 0 },
        archive: { incoming: 2, replaced: 2 },
        trash: { incoming: 0, replaced: 0 },
        prompts: { incoming: 0, replaced: 0 },
        "application-ai": { incoming: 0, replaced: 0 },
      },
      includeKeys: false,
      conflicts: [],
    };
    const output = describeBackupImportPreview(preview);
    expect(output).toContain("工作区会话：导入 3，完全覆盖本机 1");
    expect(output).toContain("归档：导入 2，完全覆盖本机 2");
    expect(output).toContain("未选板块保持不变");
  });

  it("announces full key replacement only when includeKeys is set", () => {
    const preview: BackupImportPreview = {
      selectedGroups: ["application-ai"],
      statistics: {
        "application-ai": { incoming: 1, replaced: 1 },
        "batch-archive": { incoming: 0, replaced: 0 },
        "batch-trash": { incoming: 0, replaced: 0 },
        "batch-workspace": { incoming: 0, replaced: 0 },
        workspace: { incoming: 0, replaced: 0 },
        archive: { incoming: 0, replaced: 0 },
        trash: { incoming: 0, replaced: 0 },
        prompts: { incoming: 0, replaced: 0 },
      },
      includeKeys: true,
      conflicts: [],
    };
    expect(describeBackupImportPreview(preview)).toContain(
      "API 与密钥：完全替换本机已保存的 Provider/Groq 密钥",
    );
  });

  it("describes relocations and conflicts without leaking raw data", () => {
    const preview: BackupImportPreview = {
      selectedGroups: ["workspace"],
      statistics: {
        workspace: { incoming: 1, replaced: 0 },
        "batch-archive": { incoming: 0, replaced: 0 },
        "batch-trash": { incoming: 0, replaced: 0 },
        "batch-workspace": { incoming: 0, replaced: 0 },
        archive: { incoming: 0, replaced: 0 },
        trash: { incoming: 0, replaced: 0 },
        prompts: { incoming: 0, replaced: 0 },
        "application-ai": { incoming: 0, replaced: 0 },
      },
      includeKeys: false,
      relocations: [
        {
          sessionId: "session-abc",
          branchCount: 2,
          from: "trash",
          to: "workspace",
        },
      ],
      conflicts: [{ code: "OWNERSHIP_CONFLICT", sessionId: "session-xyz" }],
    };
    const output = describeBackupImportPreview(preview);
    expect(output).toContain(
      "恢复移动：会话 session-abc 的 2 个字幕内容将从回收站移回工作区会话",
    );
    expect(output).toContain("冲突 OWNERSHIP_CONFLICT（session-xyz）");
  });

  it("旧备份含批量标签数据时追加 tagsIgnored 说明", () => {
    const text = describeBackupImportPreview(
      {
        conflicts: [],
        ignoredBatchTags: true,
        includeKeys: false,
        selectedGroups: ["batch-archive"],
        statistics: {
          "batch-archive": {
            incoming: { items: 2, lists: 1, subtitles: 0 },
            replaced: 0,
          },
        },
      } as unknown as BackupImportPreview,
      "zh-Hans",
    );
    expect(text).toContain("旧版批量标签数据已跳过");
  });
});
