import type { Page } from "playwright/test";

export const SEED_BASE_TIME = 1_752_729_600_000;

export async function seedAttackWorkspace(page: Page): Promise<void> {
  await page.evaluate(
    async ({ baseTime }) => {
      try {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("muzhi");
          request.addEventListener("success", () => resolve(request.result), {
            once: true,
          });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        });
        const transaction = database.transaction(
          [
            "archiveFolders",
            "archiveSessionPlacements",
            "archiveSessionTags",
            "branchPlacements",
            "generationRuns",
            "sessions",
            "subtitleBranches",
            "subtitleSnapshots",
            "tags",
            "trashSessionPlacements",
            "videos",
            "workspaceSessionPlacements",
          ],
          "readwrite",
        );
        const stores = {
          archiveFolders: transaction.objectStore("archiveFolders"),
          archiveSessions: transaction.objectStore("archiveSessionPlacements"),
          placements: transaction.objectStore("branchPlacements"),
          runs: transaction.objectStore("generationRuns"),
          sessions: transaction.objectStore("sessions"),
          branches: transaction.objectStore("subtitleBranches"),
          snapshots: transaction.objectStore("subtitleSnapshots"),
          trashSessions: transaction.objectStore("trashSessionPlacements"),
          videos: transaction.objectStore("videos"),
          workspaceSessions: transaction.objectStore(
            "workspaceSessionPlacements",
          ),
          archiveSessionTags: transaction.objectStore("archiveSessionTags"),
          tags: transaction.objectStore("tags"),
        };

        stores.archiveFolders.put({
          folderId: "archive-root",
          order: 0,
          parentFolderId: null,
          title: "归档",
        });
        stores.archiveFolders.put({
          folderId: "folder-course",
          order: 1,
          parentFolderId: "archive-root",
          title: "课程",
        });

        const addSession = (value: {
          branchId: string;
          cid: number;
          language: string;
          location: "archive" | "trash" | "workspace";
          order: number;
          page: number;
          sessionId: string;
          source: "bilibili" | "groq-whisper";
          title: string;
          trashOrigin?: "archive" | "workspace";
          requestedLanguageMode?: "zh" | "en" | "other" | "mixed" | null;
          withRows?: boolean;
          folderId?: string;
        }): void => {
          const bvid = "BV1zt4y1z72D";
          const videoKey = `bvid:${bvid}:cid:${value.cid}:p:${value.page}`;
          stores.videos.put({
            bvid,
            canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=${value.page}`,
            cid: value.cid,
            page: value.page,
            title: value.title,
            videoKey,
          });
          stores.sessions.put({
            activeBranchId: value.branchId,
            createdAt: baseTime + value.order,
            customTitle: false,
            lastActivityAt: baseTime + value.order + 200,
            selectionRevision: 1,
            sessionId: value.sessionId,
            title: value.title,
            updatedAt: baseTime + value.order + 200,
            videoKey,
          });
          if (value.withRows !== false) {
            stores.branches.put({
              activeSubtitleId: `subtitle-${value.branchId}`,
              branchId: value.branchId,
              completionSequence: value.location === "workspace" ? 1 : 0,
              contextRevision: 1,
              createdAt: baseTime + value.order + 50,
              detectedLanguage:
                value.source === "groq-whisper" ? value.language : null,
              language: value.language,
              lastOpenedAt: baseTime + value.order + 180,
              lastReadCompletionSequence: 0,
              lastSelectedAt: baseTime + value.order + 180,
              requestedLanguageMode: value.requestedLanguageMode ?? null,
              sessionId: value.sessionId,
              source: value.source,
              title: `${value.title} 分支`,
              updatedAt: baseTime + value.order + 180,
              videoKey,
            });
            stores.snapshots.put({
              branchId: value.branchId,
              contentHash: `sha256:attack-${value.branchId}`,
              createdAt: baseTime + value.order + 60,
              language: value.language,
              rows: [
                {
                  endMs: 8_000,
                  startMs: 0,
                  text: `${value.title} 的字幕`,
                },
              ],
              sessionId: value.sessionId,
              source: value.source,
              status: "active",
              subtitleId: `subtitle-${value.branchId}`,
              videoKey,
            });
          }
          if (value.location === "trash") {
            const trashedAt = baseTime + value.order + 300;
            const trashOrigin = value.trashOrigin ?? "workspace";
            stores.placements.put({
              branchId: value.branchId,
              deletionReason: "attack-fixture",
              location: "trash",
              order: value.order,
              purgeAfter: trashedAt + 7 * 86_400_000,
              retentionStartedAt: trashedAt,
              sessionId: value.sessionId,
              trashedAt,
              trashOrigin,
              trashOriginFolderId:
                trashOrigin === "archive" ? "folder-course" : null,
              trashOriginPathSnapshot:
                trashOrigin === "archive" ? "归档 / 课程" : null,
            });
            return;
          }
          stores.placements.put({
            branchId: value.branchId,
            deletionReason: null,
            location: value.location,
            order: value.order,
            purgeAfter: null,
            retentionStartedAt: null,
            sessionId: value.sessionId,
            trashedAt: null,
            trashOrigin: null,
            trashOriginFolderId: null,
            trashOriginPathSnapshot: null,
          });
          if (value.location === "workspace") {
            stores.workspaceSessions.put({
              order: value.order,
              pinned: false,
              sessionId: value.sessionId,
            });
          } else {
            stores.archiveSessions.put({
              folderId: value.folderId ?? "archive-root",
              order: value.order,
              pinned: false,
              sessionId: value.sessionId,
            });
          }
        };

        // 工作区：3 个有字幕（不同语言模式）+ 1 个空会话
        addSession({
          branchId: "ws-branch-1",
          cid: 30_000_000_001,
          language: "zh-CN",
          location: "workspace",
          order: 1,
          page: 1,
          requestedLanguageMode: null,
          sessionId: "ws-session-1",
          source: "bilibili",
          title: "中文会话",
        });
        addSession({
          branchId: "ws-branch-2",
          cid: 30_000_000_002,
          language: "en-US",
          location: "workspace",
          order: 2,
          page: 2,
          requestedLanguageMode: null,
          sessionId: "ws-session-2",
          source: "bilibili",
          title: "英文会话",
        });
        addSession({
          branchId: "ws-branch-3",
          cid: 30_000_000_003,
          language: "zh-CN",
          location: "workspace",
          order: 3,
          page: 3,
          requestedLanguageMode: "en",
          sessionId: "ws-session-3",
          source: "groq-whisper",
          title: "语音会话",
        });
        // 空会话（无分支）：workspace placement 但无 branchPlacement
        stores.sessions.put({
          activeBranchId: null,
          createdAt: baseTime + 400,
          customTitle: false,
          lastActivityAt: baseTime + 400,
          selectionRevision: 0,
          sessionId: "ws-empty",
          title: "空会话",
          updatedAt: baseTime + 400,
          videoKey: "bvid:BV1zt4y1z72D:cid:30000000004:p:4",
        });
        stores.workspaceSessions.put({
          order: 4,
          pinned: false,
          sessionId: "ws-empty",
        });
        stores.videos.put({
          bvid: "BV1zt4y1z72D",
          canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=4",
          cid: 30_000_000_004,
          page: 4,
          title: "空会话",
          videoKey: "bvid:BV1zt4y1z72D:cid:30000000004:p:4",
        });
        // 运行任务会话（workspace，有 running generation run）
        addSession({
          branchId: "ws-branch-run",
          cid: 30_000_000_005,
          language: "zh-CN",
          location: "workspace",
          order: 5,
          page: 5,
          requestedLanguageMode: null,
          sessionId: "ws-session-run",
          source: "bilibili",
          title: "运行任务会话",
        });
        stores.runs.put({
          branchId: "ws-branch-run",
          browserSessionId: "attack-browser",
          completionSequence: null,
          contextRevision: 1,
          createdAt: baseTime + 900,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "",
          runId: "run-attack-1",
          sessionId: "ws-session-run",
          status: "requesting",
          stopReason: null,
          subtitleId: "subtitle-ws-branch-run",
          targetId: "target-attack-1",
          taskId: "task-attack-1",
          updatedAt: baseTime + 900,
        });

        // 归档：3 个有字幕（不同时间顺序）+ 1 个空会话
        addSession({
          branchId: "ar-branch-1",
          cid: 30_000_000_011,
          folderId: "folder-course",
          language: "zh-CN",
          location: "archive",
          order: 11,
          page: 11,
          requestedLanguageMode: null,
          sessionId: "ar-session-1",
          source: "bilibili",
          title: "归档甲",
        });
        addSession({
          branchId: "ar-branch-2",
          cid: 30_000_000_012,
          folderId: "folder-course",
          language: "en-US",
          location: "archive",
          order: 12,
          page: 12,
          requestedLanguageMode: null,
          sessionId: "ar-session-2",
          source: "bilibili",
          title: "归档乙",
        });
        addSession({
          branchId: "ar-branch-3",
          cid: 30_000_000_013,
          folderId: "archive-root",
          language: "ja-JP",
          location: "archive",
          order: 13,
          page: 13,
          requestedLanguageMode: "other",
          sessionId: "ar-session-3",
          source: "groq-whisper",
          title: "归档丙",
        });
        // 归档空会话
        stores.sessions.put({
          activeBranchId: null,
          createdAt: baseTime + 400,
          customTitle: false,
          lastActivityAt: baseTime + 400,
          selectionRevision: 0,
          sessionId: "ar-empty",
          title: "归档空会话",
          updatedAt: baseTime + 400,
          videoKey: "bvid:BV1zt4y1z72D:cid:30000000014:p:14",
        });
        stores.archiveSessions.put({
          folderId: "folder-course",
          order: 14,
          pinned: false,
          sessionId: "ar-empty",
        });
        stores.videos.put({
          bvid: "BV1zt4y1z72D",
          canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=14",
          cid: 30_000_000_014,
          page: 14,
          title: "归档空会话",
          videoKey: "bvid:BV1zt4y1z72D:cid:30000000014:p:14",
        });

        // 回收站：1 个 workspace 来源 + 1 个 archive 来源
        addSession({
          branchId: "tr-branch-1",
          cid: 30_000_000_021,
          language: "zh-CN",
          location: "trash",
          order: 21,
          page: 21,
          requestedLanguageMode: null,
          sessionId: "tr-session-1",
          source: "bilibili",
          title: "回收站甲",
          trashOrigin: "workspace",
        });
        addSession({
          branchId: "tr-branch-2",
          cid: 30_000_000_022,
          language: "zh-CN",
          location: "trash",
          order: 22,
          page: 22,
          requestedLanguageMode: null,
          sessionId: "tr-session-2",
          source: "bilibili",
          title: "回收站乙",
          trashOrigin: "archive",
        });

        stores.tags.put({ tagId: "tag:考试", name: "考试", order: 0 });
        stores.tags.put({ tagId: "tag:复习", name: "复习", order: 1 });
        stores.tags.put({ tagId: "tag:动漫", name: "动漫", order: 2 });
        stores.archiveSessionTags.put({
          sessionId: "ar-session-1",
          tagIds: ["tag:考试"],
        });
        stores.archiveSessionTags.put({
          sessionId: "ar-session-2",
          tagIds: ["tag:考试", "tag:复习"],
        });
        stores.archiveSessionTags.put({
          sessionId: "ar-session-3",
          tagIds: ["tag:动漫"],
        });

        await new Promise<void>((resolve, reject) => {
          transaction.addEventListener("complete", () => resolve(), {
            once: true,
          });
          transaction.addEventListener(
            "abort",
            () => reject(transaction.error),
            {
              once: true,
            },
          );
          transaction.addEventListener(
            "error",
            () => reject(transaction.error),
            {
              once: true,
            },
          );
        });
        database.close();
      } catch (error) {
        return `seed-error: ${String(error)}`;
      }
      return "seed-ok";
    },
    { baseTime: SEED_BASE_TIME },
  );
}
