import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SpeechAcquisitionPanel,
  type SpeechAcquisitionPanelProps,
} from "../../src/ui/asr/speech-acquisition-panel";

afterEach(cleanup);

function props(
  overrides: Partial<SpeechAcquisitionPanelProps> = {},
): SpeechAcquisitionPanelProps {
  return {
    completedChunks: 0,
    hasConfiguredKey: true,
    hasExistingSubtitle: false,
    languageMode: "mixed",
    onCancel: vi.fn(),
    onLanguageModeChange: vi.fn(),
    onRoutingModeChange: vi.fn(),
    onStart: vi.fn(),
    phase: "idle",
    routingMode: "balanced",
    totalChunks: 0,
    ...overrides,
  };
}

describe("SpeechAcquisitionPanel", () => {
  it("publishes language/model choices and requires destructive replacement confirmation", () => {
    const value = props({ hasExistingSubtitle: true });
    render(<SpeechAcquisitionPanel {...value} />);
    expect(
      screen.getByRole("option", {
        name: "交叉（推荐，交替用两模型防限额降费）",
      }),
    ).not.toBeNull();
    expect(screen.queryByRole("option", { name: "均衡" })).toBeNull();
    expect(
      screen.getByRole("option", { name: "whisper-large-v3（慢、精准）" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("option", {
        name: "whisper-large-v3-turbo（快、一般）",
      }),
    ).not.toBeNull();
    expect(
      screen.getByText("获取失败不会改变当前字幕", { exact: false }),
    ).not.toBeNull();
    fireEvent.input(screen.getByLabelText("语音请求语言"), {
      target: { value: "zh" },
    });
    fireEvent.input(screen.getByLabelText("语音模型策略"), {
      target: { value: "standard-first" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始语音转字幕" }));
    expect(value.onLanguageModeChange).toHaveBeenCalledWith("zh");
    expect(value.onRoutingModeChange).toHaveBeenCalledWith("standard-first");
    expect(value.onStart).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "确认覆盖当前字幕？" }),
    ).not.toBeNull();
    expect(
      screen.getByText("分段、总结、对话、消息、附件和未完成任务", {
        exact: false,
      }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认并开始" }));
    expect(value.onStart).toHaveBeenCalledOnce();
  });

  it("cancels replacement confirmation without starting speech transcription", () => {
    const value = props({ hasExistingSubtitle: true });
    render(<SpeechAcquisitionPanel {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音转字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(value.onStart).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "开始语音转字幕" }),
    ).not.toBeNull();
  });

  it("blocks start without a configured key and uses product terminology", () => {
    render(<SpeechAcquisitionPanel {...props({ hasConfiguredKey: false })} />);
    expect(
      (
        screen.getByRole("button", {
          name: "开始语音转字幕",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText("请先在设置中保存并测试 Groq 密钥。"),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Offscreen");
    expect(document.body.textContent).not.toContain("Service Worker");
  });

  it("shows resumable progress and a user cancellation action", () => {
    const value = props({
      completedChunks: 2,
      phase: "transcribing",
      totalChunks: 5,
    });
    render(<SpeechAcquisitionPanel {...value} />);
    expect(screen.getByRole("status").textContent).toContain("2/5");
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(
      2,
    );
    fireEvent.click(screen.getByRole("button", { name: "停止语音转字幕" }));
    expect(value.onCancel).toHaveBeenCalledOnce();
  });
  it("shows real media download progress instead of one opaque preparing state", () => {
    render(
      <SpeechAcquisitionPanel
        {...props({
          activity: {
            completedBytes: 5_242_880,
            phase: "downloading",
            totalBytes: 20_971_520,
          },
          phase: "preparing",
        })}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "正在下载完整音轨 5.0 MB / 20.0 MB",
    );
    const bar = screen.getByLabelText("语音处理进度") as HTMLProgressElement;
    expect(bar.max).toBe(20_971_520);
    expect(bar.value).toBe(5_242_880);
    expect(screen.getByText("语音转字幕 · 1/3 准备音频")).not.toBeNull();
  });

  it("names the chunking step and the transcription step separately", () => {
    const { rerender } = render(
      <SpeechAcquisitionPanel
        {...props({
          activity: { completedUnits: 2, phase: "encoding", totalUnits: 6 },
          phase: "preparing",
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "正在切分音频 2/6",
    );

    rerender(
      <SpeechAcquisitionPanel
        {...props({
          completedChunks: 3,
          phase: "transcribing",
          totalChunks: 6,
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "正在转写语音分片 3/6",
    );
    expect(screen.getByText("语音转字幕 · 2/3 转写")).not.toBeNull();
  });

  it("presents encoding progress as MiB plus a bounded percentage", () => {
    const completedBytes = Math.round(12.6 * 1_048_576);
    const totalBytes = Math.round(48.3 * 1_048_576);
    render(
      <SpeechAcquisitionPanel
        {...props({
          activity: {
            completedBytes,
            phase: "encoding",
            totalBytes,
          } as unknown as SpeechAcquisitionPanelProps["activity"],
          phase: "preparing",
        })}
      />,
    );

    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("正在处理音频 12.6 MB / 48.3 MB（26%）");
    expect(status).not.toMatch(/0\.\d{5,}|completedUnits|totalUnits/);
    const bar = screen.getByLabelText("语音处理进度") as HTMLProgressElement;
    expect(bar.max).toBe(totalBytes);
    expect(bar.value).toBe(completedBytes);
  });
});
