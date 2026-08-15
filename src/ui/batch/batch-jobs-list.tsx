/**
 * BatchJobsList — 批量列表侧栏 seam 子组件（Ticket 01 从 BatchWorkspace 抽离）。
 *
 * 这是 Ticket 02 侧栏的基础 seam：结构契约 A3（行、激活态、状态槽、
 * 三点菜单锚点）与回调语义在这里冻结。对话框（重命名/归档/删除确认）
 * 仍由父组件 BatchWorkspace 持有，本组件只上报请求。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type { BatchJob } from "../../domain";
import { CompactActionMenu } from "../primitives/compact-action-menu";
import { jobStatusLabel } from "./batch-labels";

export interface BatchJobSummary {
  readonly createdAtLabel: string;
  readonly id: string;
  readonly label: string;
  readonly pinned: boolean;
  readonly status: BatchJob["status"];
}

export interface BatchJobsListProps {
  readonly uiLanguage?: UiLanguage;
  readonly jobs: readonly BatchJobSummary[];
  readonly activeJobId?: string;
  readonly busy?: boolean;
  /** 活动列表的完成/失败计数（只用于活动行 meta 展示）。 */
  readonly summary?: { readonly succeeded: number; readonly failed: number };
  readonly onSelectJob: (batchJobId: string) => void;
  readonly onRenameRequest: (batchJobId: string, label: string) => void;
  readonly onTogglePinned: (batchJobId: string, pinned: boolean) => void;
  readonly onArchiveRequest: (batchJobId: string) => void;
  readonly onTrashRequest: (batchJobId: string) => void;
}

export function BatchJobsList({
  activeJobId,
  busy = false,
  jobs,
  onArchiveRequest,
  onRenameRequest,
  onSelectJob,
  onTogglePinned,
  onTrashRequest,
  summary,
  uiLanguage,
}: BatchJobsListProps) {
  const lang = uiLanguage ?? "zh-Hans";
  if (jobs.length === 0) return null;

  return (
    <section class="muzhi-batch__jobs" aria-labelledby="batch-jobs-title">
      <h3 id="batch-jobs-title">{t(lang, "batch.jobsTitle")}</h3>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              aria-current={activeJobId === job.id}
              class={activeJobId === job.id ? "is-active" : undefined}
              disabled={busy}
              onClick={() => onSelectJob(job.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                class={`muzhi-batch__job-state${
                  job.status === "running" ? " is-running" : ""
                }`}
                data-status={job.status}
              />
              <span class="muzhi-batch__job-label">{job.label}</span>
              <span class="muzhi-batch__job-meta">
                {jobStatusLabel(lang, job.status)} · {job.createdAtLabel}
                {activeJobId === job.id && summary !== undefined
                  ? ` · ${summary.succeeded}/${summary.failed}`
                  : ""}
              </span>
            </button>
            <CompactActionMenu
              ariaLabel={t(lang, "batch.jobActionsAria", {
                label: job.label,
              })}
              items={[
                {
                  disabled: busy,
                  icon: "pencil",
                  kind: "item",
                  label: t(lang, "drawer.actionRename"),
                  onSelect: () => onRenameRequest(job.id, job.label),
                },
                {
                  disabled: busy,
                  icon: job.pinned ? "pin-off" : "pin",
                  kind: "item",
                  label: job.pinned
                    ? t(lang, "drawer.actionUnpin")
                    : t(lang, "drawer.actionPin"),
                  onSelect: () => onTogglePinned(job.id, !job.pinned),
                },
                {
                  disabled: busy,
                  icon: "archive",
                  kind: "item",
                  label: t(lang, "drawer.actionArchive"),
                  onSelect: () => onArchiveRequest(job.id),
                },
                { kind: "separator" },
                {
                  danger: true,
                  disabled: busy,
                  icon: "trash",
                  kind: "item",
                  label: t(lang, "drawer.actionDelete"),
                  onSelect: () => onTrashRequest(job.id),
                },
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
