import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { SubtitleAcquisitionState } from "../application/subtitle-acquisition";

export interface SubtitleAcquisitionPanelProps {
  readonly uiLanguage?: UiLanguage;
  readonly hasExistingSubtitle?: boolean;
  readonly onAcquire: () => void;
  readonly onCancel: () => void;
  readonly onDiscover: () => void;
  readonly onSelect: (trackId: string) => void;
  readonly reacquiring?: boolean;
  readonly state: SubtitleAcquisitionState;
}

function sourceLabel(source: "ai" | "official", lang: UiLanguage): string {
  return source === "ai"
    ? t(lang, "status.aiSubtitle")
    : t(lang, "subtitleAcquisition.sourceOfficial");
}

export function SubtitleAcquisitionPanel({
  uiLanguage,
  hasExistingSubtitle = false,
  onAcquire,
  onCancel,
  onDiscover,
  onSelect,
  reacquiring = false,
  state,
}: SubtitleAcquisitionPanelProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [confirmingReplacement, setConfirmingReplacement] = useState(false);
  const selectedTrack = state.tracks.find(
    (track) => track.trackId === state.selectedTrackId,
  );
  const handleSubmit = (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAcquire();
  };

  if (state.phase === "idle" && hasExistingSubtitle && confirmingReplacement) {
    return (
      <section
        aria-labelledby="subtitle-replacement-title"
        class="subtitle-acquisition subtitle-acquisition--confirmation"
      >
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "speech.replaceEyebrow")}
        </p>
        <h2 id="subtitle-replacement-title">
          {t(lang, "speech.replaceTitle")}
        </h2>
        <p class="subtitle-acquisition__warning">
          {t(lang, "subtitleAcquisition.replaceWarning")}
        </p>
        <p>{t(lang, "subtitleAcquisition.replaceSafe")}</p>
        <div class="subtitle-acquisition__actions">
          <button
            class="subtitle-acquisition__danger-action"
            onClick={() => {
              setConfirmingReplacement(false);
              onDiscover();
            }}
            type="button"
          >
            {t(lang, "subtitleAcquisition.confirmAndContinue")}
          </button>
          <button onClick={() => setConfirmingReplacement(false)} type="button">
            {t(lang, "common.cancel")}
          </button>
        </div>
      </section>
    );
  }

  if (state.phase === "finding") {
    return (
      <div class="subtitle-acquisition">
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "subtitleAcquisition.findingEyebrow")}
        </p>
        <h2>{t(lang, "subtitleAcquisition.findingTitle")}</h2>
        <p aria-live="polite" role="status">
          {t(lang, "subtitleAcquisition.findingStatus")}
        </p>
        <progress
          aria-label={t(lang, "subtitleAcquisition.findingProgressAria")}
          max={1}
        />
        <button disabled type="button">
          {t(lang, "subtitleAcquisition.finding")}
        </button>
      </div>
    );
  }

  if (state.phase === "selecting") {
    return (
      <form class="subtitle-acquisition" onSubmit={handleSubmit}>
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "subtitleAcquisition.eyebrow")}
        </p>
        <h2>{t(lang, "subtitleAcquisition.selectTitle")}</h2>
        <fieldset>
          <legend>{t(lang, "subtitleAcquisition.available")}</legend>
          {state.tracks.map((track) => (
            <label class="subtitle-acquisition__track" key={track.trackId}>
              <input
                checked={state.selectedTrackId === track.trackId}
                name="subtitle-track"
                onChange={() => onSelect(track.trackId)}
                type="radio"
                value={track.trackId}
              />
              <span>
                <strong>{track.name}</strong>
                <small>
                  {track.language} · {sourceLabel(track.source, lang)}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <div class="subtitle-acquisition__actions">
          <button disabled={selectedTrack === undefined} type="submit">
            {t(lang, "subtitleAcquisition.acquireSelected")}
          </button>
          <button onClick={onCancel} type="button">
            {t(lang, "common.cancel")}
          </button>
        </div>
      </form>
    );
  }

  if (state.phase === "acquiring") {
    return (
      <div class="subtitle-acquisition">
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "subtitleAcquisition.acquiringEyebrow")}
        </p>
        <h2>{t(lang, "subtitleAcquisition.acquiringTitle")}</h2>
        <p aria-live="polite" role="status">
          {t(lang, "subtitleAcquisition.acquiringStatus", {
            name: selectedTrack
              ? `“${selectedTrack.name}”`
              : t(lang, "subtitleAcquisition.selectedTrack"),
          })}
        </p>
        <progress
          aria-label={t(lang, "subtitleAcquisition.acquiringProgressAria")}
          max={1}
        />
        <button disabled type="button">
          {t(lang, "subtitleAcquisition.acquiring")}
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div class="subtitle-acquisition">
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "subtitleAcquisition.eyebrow")}
        </p>
        <h2>{t(lang, "subtitleAcquisition.failedTitle")}</h2>
        <p class="subtitle-acquisition__error" role="alert">
          {state.error?.message ?? t(lang, "subtitleAcquisition.failedGeneric")}
        </p>
        <div class="subtitle-acquisition__actions">
          <button
            onClick={state.retry === "acquire" ? onAcquire : onDiscover}
            type="button"
          >
            {state.retry === "acquire"
              ? t(lang, "subtitleAcquisition.retryAcquire")
              : t(lang, "subtitleAcquisition.retryFind")}
          </button>
          {state.tracks.length > 0 ? (
            <button onClick={onCancel} type="button">
              {t(lang, "common.cancel")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div class="subtitle-acquisition">
        <p role="status">
          {t(lang, "subtitleAcquisition.successStatus", {
            count: state.rowCount ?? 0,
          })}
        </p>
      </div>
    );
  }

  return (
    <div class="subtitle-acquisition">
      <p class="subtitle-acquisition__eyebrow">
        {reacquiring
          ? t(lang, "shell.reacquireSubtitle")
          : hasExistingSubtitle
            ? t(lang, "speech.replaceEyebrow")
            : t(lang, "speech.noSubtitle")}
      </p>
      <h2>{t(lang, "subtitleAcquisition.title")}</h2>
      <p>
        {reacquiring
          ? t(lang, "subtitleAcquisition.descReacquiring")
          : hasExistingSubtitle
            ? t(lang, "subtitleAcquisition.descReplace")
            : t(lang, "subtitleAcquisition.descFirst")}
      </p>
      <button
        onClick={() => {
          if (hasExistingSubtitle && !reacquiring) {
            setConfirmingReplacement(true);
          } else {
            onDiscover();
          }
        }}
        type="button"
      >
        {t(lang, "subtitleAcquisition.title")}
      </button>
    </div>
  );
}
