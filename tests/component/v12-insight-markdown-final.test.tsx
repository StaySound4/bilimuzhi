import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactSegment } from "../../src/domain";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";

afterEach(cleanup);

function props(
  overrides: Partial<InsightWorkspaceProps> = {},
): InsightWorkspaceProps {
  return {
    content:
      "# 总结\n\n---\n\n| 项目 | 值 |\n| --- | --- |\n| 公式 | $x^2$ |\n\n[00:05]",
    hasSubtitle: true,
    instruction: "",
    kind: "summary",
    onClear: vi.fn(),
    onExport: vi.fn(),
    onGenerate: vi.fn(),
    onInstructionChange: vi.fn(),
    onSeek: vi.fn(),
    onStop: vi.fn(),
    phase: "ready",
    segments: [],
    subtitleRows: [
      { endMs: 6_000, lineId: "line-1", startMs: 0, text: "证据" },
    ],
    timeLinkScope: {
      activeVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
      subtitleVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
    },
    ...overrides,
  };
}

function segment(): ArtifactSegment {
  return {
    detail: "不得显示的字幕正文",
    endLineId: "line-2",
    endMs: 9_000,
    isAdvertisement: true,
    startLineId: "line-1",
    startMs: 5_000,
    title: "赞助商提供的优惠",
    type: "advertisement",
  };
}

describe("v12 insight, prompt, and Markdown final contract", () => {
  it("renders full Markdown including thematic rules, tables, KaTeX, and validated time seek", () => {
    const onSeek = vi.fn();
    render(<InsightWorkspace {...props({ onSeek })} />);

    expect(document.querySelector("hr")).not.toBeNull();
    expect(screen.getByRole("table")).not.toBeNull();
    expect(document.querySelector("[role='math']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "跳转到 00:05" }));
    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it("uses a divider row: click-anywhere seek, stable advertisement semantics, and no exposed transcript/actions", () => {
    const onSeek = vi.fn();
    render(
      <InsightWorkspace
        {...props({
          content: "",
          kind: "segments",
          onSeek,
          segments: [segment()],
        })}
      />,
    );

    const row = screen.getByRole("button", {
      name: "广告分段：赞助商提供的优惠",
    });
    fireEvent.click(row);
    expect(onSeek).toHaveBeenCalledWith(5);
    expect(row.textContent).not.toContain("00:09");
    expect(row.textContent).toContain("不得显示的字幕正文");
    expect(screen.queryByRole("button", { name: /展开|复制/ })).toBeNull();
    expect(screen.getByText("广告")).not.toBeNull();
  });

  it("removes the segment prompt and summary font controls while keeping summary preset management", () => {
    const segments = render(
      <InsightWorkspace
        {...props({ content: "", kind: "segments", phase: "idle" })}
      />,
    );
    expect(screen.queryByLabelText("附加要求（可选）")).toBeNull();
    segments.unmount();

    const onManageSummaryPresets = vi.fn();
    const onSelectSummaryPromptPreset = vi.fn();
    render(
      <InsightWorkspace
        {...props({
          onManageSummaryPresets,
          onSelectSummaryPromptPreset,
          summaryPromptPresetOptions: [
            { id: "summary-balanced", name: "平衡" },
          ],
          selectedSummaryPromptPresetId: "summary-balanced",
          taskModelProfiles: [
            {
              id: "profile-alpha",
              name: "配置1",
              models: [
                {
                  enabled: true,
                  id: "alpha-summary",
                  label: "Alpha Summary",
                  reasoningEfforts: [],
                },
              ],
            },
          ],
          taskModelSelection: {
            modelId: "alpha-summary",
            profileId: "profile-alpha",
            reasoningEffort: "provider-default",
            state: "ready",
          },
          onTaskModelChange: vi.fn(),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    fireEvent.click(screen.getByRole("button", { name: "管理总结预设" }));
    expect(onManageSummaryPresets).toHaveBeenCalledOnce();
    const preset = screen.getByRole("combobox", { name: "总结预设" });
    fireEvent.input(preset, { target: { value: "summary-balanced" } });
    expect(onSelectSummaryPromptPreset).toHaveBeenCalledWith(
      "summary-balanced",
    );
    // 总结详略已并入预设：配置面板中不再出现第二个详略下拉框。
    expect(screen.queryByRole("combobox", { name: "总结详略" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /字体/ })).toBeNull();
    expect(screen.queryByRole("slider", { name: /字号|字体大小/ })).toBeNull();
    expect(
      screen.queryByRole("spinbutton", { name: /字号|字体大小/ }),
    ).toBeNull();
  });
});
