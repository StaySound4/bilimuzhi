import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";

interface V11InsightWorkspaceProps extends InsightWorkspaceProps {
  readonly generationStatus?:
    | "preparing"
    | "requesting"
    | "streaming"
    | "validating"
    | "saving"
    | "interrupted"
    | "failed"
    | "cancelled";
  readonly incomplete?: boolean;
  readonly subtitleRows?: readonly {
    readonly endMs: number;
    readonly startMs: number;
    readonly text: string;
  }[];
}

const V11InsightWorkspace =
  InsightWorkspace as FunctionComponent<V11InsightWorkspaceProps>;

afterEach(cleanup);

function props(
  overrides: Partial<InsightWorkspaceProps> = {},
): InsightWorkspaceProps {
  return {
    content: "",
    hasSubtitle: true,
    instruction: "",
    kind: "summary",
    onClear: vi.fn(),
    onExport: vi.fn(),
    onGenerate: vi.fn(),
    onInstructionChange: vi.fn(),
    onStop: vi.fn(),
    phase: "idle",
    segments: [],
    ...overrides,
  };
}

describe("InsightWorkspace", () => {
  it("blocks generation until the session owns an active subtitle", () => {
    render(<InsightWorkspace {...props({ hasSubtitle: false })} />);

    expect(screen.getByText("尚无字幕")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "生成总结" })).toBeNull();
  });

  it("starts a first generation without a confirmation step", () => {
    const value = props();
    render(<InsightWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "生成总结" }));

    expect(value.onGenerate).toHaveBeenCalledOnce();
  });

  it("requires confirmation before discarding an existing result", () => {
    const value = props({ content: "旧总结", phase: "ready" });
    render(<InsightWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "重新生成总结" }));
    expect(value.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));
    expect(value.onGenerate).toHaveBeenCalledOnce();
  });

  it("cancels the regeneration confirmation without generating", () => {
    const value = props({ content: "旧总结", phase: "ready" });
    render(<InsightWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "重新生成总结" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(value.onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirms before clearing an existing result", () => {
    const value = props({ content: "旧总结", phase: "ready" });
    render(<InsightWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(value.onClear).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "清除" });
    fireEvent.click(within(dialog).getByRole("button", { name: "清除" }));
    expect(value.onClear).toHaveBeenCalledOnce();
  });

  it("renders markdown structure instead of raw markup", () => {
    render(
      <InsightWorkspace
        {...props({
          content: "## 关键要点\n- 第一点\n- 第二点",
          phase: "ready",
        })}
      />,
    );

    expect(screen.getByText("关键要点")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows chunk progress while a long subtitle is mapped", () => {
    render(
      <InsightWorkspace
        {...props({
          phase: "running",
          progress: { completedChunks: 2, stage: "mapping", totalChunks: 5 },
        })}
      />,
    );

    expect(
      screen.getByText("正在处理长字幕分片 2/5…", { exact: false }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "停止生成" })).not.toBeNull();
  });

  it("seeks the player from a segment timestamp", () => {
    const onSeek = vi.fn();
    render(
      <InsightWorkspace
        {...props({
          kind: "segments",
          onSeek,
          phase: "ready",
          segments: [
            {
              detail: "开场描述",
              endMs: 65_000,
              startMs: 5_000,
              title: "开场",
              isAdvertisement: false,
            },
          ],
        })}
      />,
    );

    const segment = screen.getByText("开场").closest(".muzhi-insight__segment");
    expect(segment).not.toBeNull();
    // 整行可 seek：Enter/Space/click 都调用原 startMs。
    fireEvent.click(segment as HTMLElement);
    expect(onSeek).toHaveBeenCalledWith(5);
    fireEvent.keyDown(segment as HTMLElement, { key: "Enter" });
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  it("disables seeking when the player is not bound to this page", () => {
    render(
      <InsightWorkspace
        {...props({
          kind: "segments",
          phase: "ready",
          segments: [
            {
              detail: "",
              endMs: 65_000,
              startMs: 5_000,
              title: "开场",
              isAdvertisement: false,
            },
          ],
        })}
      />,
    );

    const segment = screen.getByText("开场").closest(".muzhi-insight__segment");
    // 未绑定播放器：行无 tabIndex（不可聚焦 seek）。
    expect(segment?.getAttribute("tabindex")).toBeNull();
  });

  it("surfaces a stable failure message", () => {
    render(
      <InsightWorkspace
        {...props({ errorMessage: "AI Provider 密钥缺失", phase: "failed" })}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "AI Provider 密钥缺失",
    );
  });

  it("shades a sponsored segment so it can be recognised and skipped", () => {
    const { container } = render(
      <InsightWorkspace
        {...props({
          kind: "segments",
          onSeek: vi.fn(),
          phase: "ready",
          segments: [
            {
              detail: "正片",
              endMs: 65_000,
              isAdvertisement: false,
              startMs: 5_000,
              title: "开场",
            },
            {
              detail: "恰饭环节",
              endMs: 120_000,
              isAdvertisement: true,
              startMs: 65_000,
              title: "本期赞助商",
            },
          ],
        })}
      />,
    );

    const cards = container.querySelectorAll(".muzhi-insight__segment");
    expect(cards).toHaveLength(2);
    expect(cards[0].className).not.toContain("muzhi-insight__segment--ad");
    expect(cards[1].className).toContain("muzhi-insight__segment--ad");
    expect(screen.getByText("广告")).not.toBeNull();
  });

  it("renders content and advertisement as compact full-card seek targets without end range, expansion, copy, or transcript", () => {
    const onSeek = vi.fn();
    render(
      <V11InsightWorkspace
        {...props({
          kind: "segments",
          onSeek,
          phase: "ready",
          segments: [
            {
              detail: "正片的完整核心内容与必要细节",
              endLineId: "line-b",
              endMs: 15_000,
              isAdvertisement: false,
              startLineId: "line-a",
              startMs: 5_000,
              title: "正片开场",
              type: "content",
            },
            {
              detail: "赞助口播的完整正文与折扣说明",
              endLineId: "line-d",
              endMs: 30_000,
              isAdvertisement: true,
              startLineId: "line-c",
              startMs: 20_000,
              title: "赞助口播",
              type: "advertisement",
            },
          ],
        })}
        subtitleRows={[
          { endMs: 10_000, startMs: 5_000, text: "这里是正片字幕" },
          { endMs: 25_000, startMs: 20_000, text: "这里是广告字幕" },
        ]}
      />,
    );

    const cards = [
      screen
        .getByText("正片开场")
        .closest<HTMLElement>(".muzhi-insight__segment"),
      screen
        .getByText("赞助口播")
        .closest<HTMLElement>(".muzhi-insight__segment"),
    ];
    expect(cards.every((card) => card !== null)).toBe(true);
    expect(cards[0]?.textContent).toContain("00:05");
    expect(cards[1]?.textContent).toContain("00:20");
    expect(cards[0]?.textContent).not.toContain("00:15");
    expect(cards[1]?.textContent).not.toContain("00:30");
    expect(screen.getByText("正片的完整核心内容与必要细节")).not.toBeNull();
    expect(screen.getByText("赞助口播的完整正文与折扣说明")).not.toBeNull();
    expect(screen.queryByText("这里是正片字幕")).toBeNull();
    expect(screen.queryByText("这里是广告字幕")).toBeNull();
    expect(screen.queryByRole("button", { name: /展开|收起|复制/ })).toBeNull();

    fireEvent.click(cards[0] as HTMLElement);
    fireEvent.click(cards[1] as HTMLElement);
    expect(onSeek).toHaveBeenNthCalledWith(1, 5);
    expect(onSeek).toHaveBeenNthCalledWith(2, 20);
  });

  it("exposes a complete advertisement title, stable badge, shading, aria semantics, and full-card seek without a hidden body", () => {
    const onSeek = vi.fn();
    render(
      <V11InsightWorkspace
        {...props({
          kind: "segments",
          onSeek,
          phase: "ready",
          segments: [
            {
              detail: "完整广告正文与优惠细节",
              endLineId: "line-b",
              endMs: 25_000,
              isAdvertisement: true,
              startLineId: "line-a",
              startMs: 10_000,
              title: "品牌赞助提供限时优惠",
              type: "advertisement",
            },
          ],
        })}
        subtitleRows={[
          { endMs: 25_000, startMs: 10_000, text: "完整广告字幕正文" },
        ]}
      />,
    );

    const advertisement = screen
      .getByText("品牌赞助提供限时优惠")
      .closest<HTMLElement>(".muzhi-insight__segment");
    expect(advertisement).not.toBeNull();
    expect(advertisement?.className).toContain("muzhi-insight__segment--ad");
    expect(advertisement?.getAttribute("aria-label") ?? "").toContain(
      "广告分段：品牌赞助提供限时优惠",
    );
    expect(
      within(advertisement as HTMLElement).getByText("广告"),
    ).not.toBeNull();
    expect(advertisement?.textContent).not.toContain("00:25");
    expect(advertisement?.textContent).toContain("完整广告正文与优惠细节");
    expect(advertisement?.textContent).not.toContain("完整广告字幕正文");
    expect(
      within(advertisement as HTMLElement).queryByRole("button", {
        name: /展开|收起|复制/,
      }),
    ).toBeNull();

    fireEvent.click(advertisement as HTMLElement);
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it("uses a divider list without the old segment-card anatomy", async () => {
    const css = await readFile(
      resolve("src/ui/insights/insight-workspace.css"),
      "utf8",
    );

    expect(css).toMatch(/\.muzhi-insight__segments\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(
      /\.muzhi-insight__segment\s*\{[^}]*grid-template-columns:/s,
    );
    // 无 Card anatomy 与后置覆盖。
    expect(css).not.toMatch(/segment-card/s);
    // divider 由 border-bottom 表达。
    expect(css).toMatch(/\.muzhi-insight__segment\s*\{[^}]*border-bottom:/s);
    // 广告有文字 badge + 语义表面（非只颜色）。
    expect(css).toMatch(/\.muzhi-insight__segment-badge\s*\{[^}]*border:/s);
    expect(css).toMatch(/\.muzhi-insight__segment--ad\s*\{[^}]*background:/s);
  });

  it("offers the summary preset in the main UI but never applies it to segments", () => {
    const onSelectSummaryPromptPreset = vi.fn();
    const view = render(
      <V11InsightWorkspace
        {...props({
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
          summaryPromptPresetOptions: [
            { id: "summary-balanced", name: "平衡" },
            { id: "summary-custom", name: "我的总结提示词" },
          ],
          selectedSummaryPromptPresetId: "summary-balanced",
          onSelectSummaryPromptPreset,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    const selector = screen.getByRole("combobox", {
      name: "总结预设",
    }) as HTMLSelectElement;
    expect(selector.value).toBe("summary-balanced");
    fireEvent.input(selector, { target: { value: "summary-custom" } });
    expect(onSelectSummaryPromptPreset).toHaveBeenCalledWith("summary-custom");
    // 总结详略已随预设体系合并移除：不再存在第二个详略下拉框。
    expect(screen.queryByRole("combobox", { name: "总结详略" })).toBeNull();

    view.rerender(<V11InsightWorkspace {...props({ kind: "segments" })} />);
    expect(screen.queryByRole("combobox", { name: "总结预设" })).toBeNull();
  });

  it("treats validating as visibly non-terminal and preserves interrupted partial output as incomplete", () => {
    const view = render(
      <V11InsightWorkspace
        {...props({ content: "已经确认的部分总结", phase: "idle" })}
        generationStatus="validating"
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("正在校验");
    expect(screen.getByRole("button", { name: "停止生成" })).not.toBeNull();
    expect(
      view.container.querySelector("[data-generation-active='true']"),
    ).not.toBeNull();

    view.rerender(
      <V11InsightWorkspace
        {...props({ content: "已经确认的部分总结", phase: "idle" })}
        generationStatus="interrupted"
        incomplete
      />,
    );
    expect(screen.getByText("不完整", { exact: false })).not.toBeNull();
    expect(screen.getByText("已经确认的部分总结")).not.toBeNull();
  });

  it.each([
    ["preparing", "正在准备"],
    ["requesting", "正在请求模型"],
    ["streaming", "正在生成"],
    ["validating", "正在校验"],
    ["saving", "正在保存"],
  ] as const)(
    "keeps the persisted %s artifact phase visibly active with spinner, text, and stop",
    (generationStatus, label) => {
      const view = render(
        <V11InsightWorkspace
          {...props({ phase: "idle" })}
          generationStatus={generationStatus}
        />,
      );

      const status = screen.getByRole("status");
      expect(status.textContent).toContain(label);
      expect(status.querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(
        view.container.querySelector("[data-generation-active='true']"),
      ).not.toBeNull();
      expect(screen.getByRole("button", { name: "停止生成" })).not.toBeNull();
      expect(view.container.textContent).not.toContain("未在输出");
    },
  );

  it("derives streaming time links only from complete markers backed by real subtitle rows", () => {
    const onSeek = vi.fn();
    render(
      <V11InsightWorkspace
        {...props({
          content: "有效 [00:05]，越界 [00:09]，未闭合 [00:",
          onSeek,
          phase: "running",
        })}
        generationStatus="streaming"
        subtitleRows={[{ endMs: 7_000, startMs: 5_000, text: "真实字幕行" }]}
        timeLinkScope={{
          activeVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
          subtitleVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳转到 00:05" }));
    expect(onSeek).toHaveBeenCalledWith(5);
    expect(screen.queryByRole("button", { name: "跳转到 9s" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /跳转到/ })).toHaveLength(1);
  });
  it("renders the per-mode task model picker at the top with the persisted selection", () => {
    render(
      <InsightWorkspace
        {...props({
          kind: "summary",
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
    expect(screen.queryByLabelText("总结模型提供商")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(
      (screen.getByLabelText("总结模型提供商") as HTMLSelectElement).value,
    ).toBe("profile-alpha");
    expect(
      (screen.getByLabelText("总结模型配置") as HTMLSelectElement).value,
    ).toBe("alpha-summary");
  });

  it("keeps segments free of summary presets and user instruction controls", () => {
    render(
      <InsightWorkspace
        {...props({
          kind: "segments",
          taskModelProfiles: [
            {
              id: "profile-alpha",
              name: "配置1",
              models: [
                {
                  enabled: true,
                  id: "alpha-segments",
                  label: "Alpha Segments",
                  reasoningEfforts: [],
                },
              ],
            },
          ],
          taskModelSelection: {
            modelId: "alpha-segments",
            profileId: "profile-alpha",
            reasoningEffort: "provider-default",
            state: "ready",
          },
          onTaskModelChange: vi.fn(),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(screen.queryByLabelText("总结预设")).toBeNull();
    expect(screen.queryByText("管理提示词")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("labels the picker by mode so summary and segments stay independent", () => {
    render(
      <InsightWorkspace
        {...props({
          kind: "segments",
          taskModelProfiles: [],
          taskModelSelection: null,
          onTaskModelChange: vi.fn(),
        })}
      />,
    );
    // 无可用配置投影时选择器不渲染（sidepanel 始终提供投影，空数组为未接线态）。
    expect(screen.queryByLabelText("分段模型提供商")).toBeNull();
  });

  it.each([
    ["segments", "尚未生成分段", "生成后，分段章节会显示在这里。"],
    ["summary", "尚未生成总结", "生成后，总结正文会显示在这里。"],
  ] as const)(
    "uses the shared no-content empty state for %s",
    (kind, title, description) => {
      const view = render(
        <InsightWorkspace
          {...props({ kind, phase: "idle", content: "", segments: [] })}
        />,
      );
      const empty = view.container.querySelector(".muzhi-workspace-empty");
      expect(empty?.getAttribute("data-empty-variant")).toBe("no-content");
      expect(empty?.textContent).toContain(title);
      expect(empty?.textContent).toContain(description);
      expect(
        view.container.querySelector(".muzhi-insight__empty-state"),
      ).toBeNull();
    },
  );

  it("shows readable task context labels and keeps summary detail separate from the real prompt preset", () => {
    const onSelectSummaryPromptPreset = vi.fn();
    render(
      <InsightWorkspace
        {...props({
          kind: "summary",
          taskModelProfiles: [
            {
              id: "profile-alpha",
              name: "生产配置",
              models: [
                {
                  enabled: true,
                  id: "internal-model-id",
                  label: "可读模型名",
                  reasoningEfforts: ["high"],
                },
              ],
            },
          ],
          taskModelSelection: {
            modelId: "internal-model-id",
            profileId: "profile-alpha",
            reasoningEffort: "high",
            state: "ready",
          },
          outputLanguage: "zh-Hans",
          summaryPromptPresetOptions: [
            { id: "summary-default", name: "标准总结提示词" },
            { id: "summary-custom", name: "我的总结提示词" },
          ],
          selectedSummaryPromptPresetId: "summary-custom",
          onSelectSummaryPromptPreset,
          onManageSummaryPresets: vi.fn(),
          onTaskModelChange: vi.fn(),
        })}
      />,
    );
    const summary = document.querySelector(".muzhi-task-context__summary");
    expect(summary?.textContent).toContain("生产配置");
    expect(summary?.textContent).toContain("可读模型名");
    expect(summary?.textContent).toContain("高");
    expect(summary?.textContent).toContain("中文（简体）");
    expect(summary?.textContent).toContain("我的总结提示词");
    expect(summary?.textContent).not.toContain("internal-model-id");

    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    const preset = screen.getByRole("combobox", { name: "总结预设" });
    // 总结详略已并入预设：配置面板中不再出现第二个详略下拉框。
    expect(screen.queryByRole("combobox", { name: "总结详略" })).toBeNull();
    expect((preset as HTMLSelectElement).value).toBe("summary-custom");
    fireEvent.input(preset, { target: { value: "summary-default" } });
    expect(onSelectSummaryPromptPreset).toHaveBeenCalledWith("summary-default");
    expect(screen.getByRole("button", { name: "管理总结预设" })).not.toBeNull();
  });

  it.each([
    { phase: "running", expected: "正在生成" },
    { phase: "failed", expected: "总结生成失败" },
  ] as const)(
    "keeps $phase status visible in the collapsed task context",
    ({ phase, expected }) => {
      render(
        <InsightWorkspace
          {...props({
            kind: "summary",
            phase,
            taskModelProfiles: [
              {
                id: "p",
                name: "配置",
                models: [
                  {
                    enabled: true,
                    id: "m",
                    label: "模型",
                    reasoningEfforts: [],
                  },
                ],
              },
            ],
            taskModelSelection: {
              modelId: "m",
              profileId: "p",
              reasoningEffort: "provider-default",
              state: "ready",
            },
            onTaskModelChange: vi.fn(),
          })}
        />,
      );
      expect(
        document.querySelector(".muzhi-task-context__summary")?.textContent,
      ).toContain(expected);
    },
  );

  it("announces task-model save pending and errors in the collapsed inspector", () => {
    const base = {
      kind: "summary" as const,
      taskModelProfiles: [
        {
          id: "p",
          name: "配置",
          models: [
            {
              enabled: true,
              id: "m",
              label: "模型",
              reasoningEfforts: [],
            },
          ],
        },
      ],
      taskModelSelection: {
        modelId: "m",
        profileId: "p",
        reasoningEffort: "provider-default" as const,
        state: "ready" as const,
      },
      onTaskModelChange: vi.fn(),
    };
    const view = render(
      <InsightWorkspace {...props({ ...base, taskContextPending: true })} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "正在保存任务模型选择",
    );

    view.rerender(
      <InsightWorkspace
        {...props({ ...base, taskContextError: "任务模型保存失败" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "任务模型保存失败",
    );
  });

  it("uses a generic workspace-busy status instead of batch selection copy", () => {
    render(
      <InsightWorkspace
        {...props({
          busy: true,
          kind: "segments",
          taskModelProfiles: [
            {
              id: "p",
              name: "配置",
              models: [
                {
                  enabled: true,
                  id: "m",
                  label: "模型",
                  reasoningEfforts: [],
                },
              ],
            },
          ],
          taskModelSelection: {
            modelId: "m",
            profileId: "p",
            reasoningEffort: "provider-default",
            state: "ready",
          },
          onTaskModelChange: vi.fn(),
        })}
      />,
    );
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("当前工作区操作正在进行");
    expect(status).not.toContain("批量选择");
  });
});
