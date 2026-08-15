import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SpeechAcquisitionPanel,
  type SpeechAcquisitionPanelProps,
} from "../../src/ui/asr/speech-acquisition-panel";

type V15TranscriptionActivity =
  | {
      readonly currentChunk: number;
      readonly phase: "uploading" | "waiting-response" | "switching-model";
      readonly providerMessage?: string;
      readonly totalChunks: number;
    }
  | {
      readonly currentChunk: number;
      readonly phase: "rate-limited";
      readonly providerMessage?: string;
      readonly retryAfterSeconds: number;
      readonly totalChunks: number;
    };

type V15SpeechPanelProps = Omit<SpeechAcquisitionPanelProps, "activity"> & {
  readonly activity?:
    SpeechAcquisitionPanelProps["activity"] | V15TranscriptionActivity;
};

afterEach(cleanup);

function props(
  overrides: Partial<V15SpeechPanelProps> = {},
): V15SpeechPanelProps {
  return {
    completedChunks: 1,
    hasConfiguredKey: true,
    hasExistingSubtitle: false,
    languageMode: "mixed",
    onCancel: vi.fn(),
    onLanguageModeChange: vi.fn(),
    onRoutingModeChange: vi.fn(),
    onStart: vi.fn(),
    phase: "transcribing",
    routingMode: "balanced",
    totalChunks: 5,
    ...overrides,
  };
}

function renderPanel(value: V15SpeechPanelProps) {
  return render(
    <SpeechAcquisitionPanel
      {...(value as unknown as SpeechAcquisitionPanelProps)}
    />,
  );
}

describe("v15 Groq progress and terminal projection (G3/G4)", () => {
  it.each([
    [
      { currentChunk: 2, phase: "uploading", totalChunks: 5 },
      ["分片 2/5", "正在上传"],
    ],
    [
      { currentChunk: 2, phase: "waiting-response", totalChunks: 5 },
      ["分片 2/5", "等待 Groq 返回结果"],
    ],
    [
      { currentChunk: 2, phase: "switching-model", totalChunks: 5 },
      ["分片 2/5", "切换备用模型"],
    ],
    [
      {
        currentChunk: 2,
        phase: "rate-limited",
        retryAfterSeconds: 18,
        totalChunks: 5,
      },
      ["分片 2/5", "限流", "18 秒"],
    ],
  ] as const)("projects the safe %s state", (activity, expectedParts) => {
    renderPanel(
      props({
        activity: {
          ...activity,
          providerMessage: "raw-provider-body fixture must stay hidden",
        },
      }),
    );

    const status = screen.getByRole("status").textContent ?? "";
    for (const expected of expectedParts) expect(status).toContain(expected);
    expect(document.body.textContent).not.toContain("raw-provider-body");
    expect(document.body.textContent).not.toContain("Authorization");
  });

  it("turns the stop action into an AbortSignal without exposing runtime internals", () => {
    const controller = new AbortController();
    const onCancel = vi.fn(() => controller.abort());
    renderPanel(
      props({
        activity: {
          currentChunk: 2,
          phase: "waiting-response",
          totalChunks: 5,
        },
        onCancel,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "停止语音转字幕" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
    expect(document.body.textContent).not.toContain("Service Worker");
    expect(document.body.textContent).not.toContain("Offscreen");
  });

  it("restores the retry action for an already-sanitized terminal failure", () => {
    const onStart = vi.fn();
    renderPanel(
      props({
        errorMessage: "Groq 请求过于频繁，请稍后重试。",
        onStart,
        phase: "error",
      }),
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Groq 请求过于频繁，请稍后重试。",
    );
    expect(document.body.textContent).not.toContain("raw-provider-body");
    fireEvent.click(screen.getByRole("button", { name: "重试语音转字幕" }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
