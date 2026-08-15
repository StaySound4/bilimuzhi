import { useState } from "preact/hooks";

import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import type { SingleSubtitleMigrationPreview } from "../infrastructure/indexeddb/single-subtitle-migration";

export interface SingleSubtitleMigrationGateProps {
  readonly uiLanguage?: UiLanguage;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
  readonly preview: SingleSubtitleMigrationPreview;
}

export interface SingleSubtitleMigrationBlockedGateProps {
  readonly uiLanguage?: UiLanguage;
  readonly onRetry: () => void;
}

type GateState =
  | { readonly phase: "ready" | "cancelled" | "migrating" }
  | { readonly message: string; readonly phase: "error" };

export function SingleSubtitleMigrationGate({
  uiLanguage,
  onCancel,
  onConfirm,
  preview,
}: SingleSubtitleMigrationGateProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [state, setState] = useState<GateState>({ phase: "ready" });
  const migrating = state.phase === "migrating";

  const confirm = async (): Promise<void> => {
    if (migrating) return;
    setState({ phase: "migrating" });
    try {
      await onConfirm();
    } catch {
      setState({
        message: t(lang, "gate.migrationBlocked"),
        phase: "error",
      });
    }
  };

  return (
    <main
      aria-labelledby="single-subtitle-migration-title"
      class="migration-gate"
    >
      <section class="migration-gate__card">
        <div aria-hidden="true" class="migration-gate__icon">
          <span />
        </div>
        <p class="migration-gate__eyebrow">{t(lang, "gate.eyebrow")}</p>
        <h1 id="single-subtitle-migration-title">{t(lang, "gate.title")}</h1>
        <p class="migration-gate__lead">{t(lang, "gate.lead")}</p>
        <div class="migration-gate__summary" role="status">
          <strong>
            {t(lang, "gate.affectedCount", {
              count: preview.affectedSessionCount,
            })}
          </strong>
          <span>
            {t(lang, "gate.deleteHistory", {
              count: preview.branchesToDelete,
            })}
          </span>
        </div>
        <ul class="migration-gate__details">
          <li>
            {t(lang, "gate.deleteSubtitles", {
              count: preview.subtitleSnapshotsToDelete,
            })}
          </li>
          <li>
            {t(lang, "gate.deleteArtifacts", {
              count: preview.artifactsToDelete,
              chats: preview.chatThreadsToDelete,
            })}
          </li>
          <li>
            {t(lang, "gate.deleteMessages", {
              attachments: preview.attachmentsToDelete,
              count: preview.chatMessagesToDelete,
            })}
          </li>
          <li>
            {t(lang, "gate.deleteRuns", {
              count: preview.generationRunsToDelete,
            })}
          </li>
        </ul>
        <p class="migration-gate__warning">{t(lang, "gate.warning")}</p>
        {state.phase === "cancelled" ? (
          <p class="migration-gate__notice" role="alert">
            {t(lang, "gate.cancelled")}
          </p>
        ) : state.phase === "error" ? (
          <p class="migration-gate__notice" role="alert">
            {state.message}
          </p>
        ) : null}
        <div class="migration-gate__actions">
          <button
            class="migration-gate__confirm muzhi-btn muzhi-btn--destructive muzhi-btn--lg"
            disabled={migrating}
            onClick={() => void confirm()}
            type="button"
          >
            {migrating
              ? t(lang, "gate.migrating")
              : t(lang, "gate.confirmMigration")}
          </button>
          <button
            class="muzhi-btn muzhi-btn--secondary muzhi-btn--lg"
            disabled={migrating}
            onClick={() => {
              setState({ phase: "cancelled" });
              onCancel();
            }}
            type="button"
          >
            {t(lang, "gate.cancel")}
          </button>
        </div>
      </section>
    </main>
  );
}

export function SingleSubtitleMigrationBlockedGate({
  uiLanguage,
  onRetry,
}: SingleSubtitleMigrationBlockedGateProps) {
  const lang = uiLanguage ?? "zh-Hans";
  return (
    <main
      aria-labelledby="single-subtitle-migration-blocked-title"
      class="migration-gate"
    >
      <section class="migration-gate__card">
        <div aria-hidden="true" class="migration-gate__icon">
          <span />
        </div>
        <p class="migration-gate__eyebrow">{t(lang, "gate.blockedEyebrow")}</p>
        <h1 id="single-subtitle-migration-blocked-title">
          {t(lang, "gate.blockedTitle")}
        </h1>
        <p class="migration-gate__lead">{t(lang, "gate.blockedLead")}</p>
        <p class="migration-gate__notice" role="alert">
          {t(lang, "gate.blockedAlert")}
        </p>
        <div class="migration-gate__actions">
          <button
            class="migration-gate__confirm muzhi-btn muzhi-btn--destructive muzhi-btn--lg"
            onClick={onRetry}
            type="button"
          >
            {t(lang, "gate.retry")}
          </button>
        </div>
      </section>
    </main>
  );
}
