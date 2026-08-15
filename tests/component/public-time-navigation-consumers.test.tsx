import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatWorkspace } from "../../src/ui/chat/chat-workspace";
import { InsightWorkspace } from "../../src/ui/insights/insight-workspace";

const videoKey = "bvid:BV1Q541167Qg:cid:30000000002:p:2";
const subtitleRows = [
  { endMs: 410_000, startMs: 0, text: "当前精确非 P1 视频字幕" },
] as const;
const screenshotLikeSubtitleRows = [
  { endMs: 4_420, startMs: 3_180, text: "签约可能出现变故" },
  { endMs: 11_760, startMs: 10_240, text: "周一仍没有实质进展" },
  { endMs: 17_420, startMs: 16_180, text: "转会时间已经紧张" },
  { endMs: 20_640, startMs: 19_120, text: "8月10日锁定参赛名单" },
  { endMs: 40_360, startMs: 39_140, text: "Bin 回归传闻增加变数" },
  { endMs: 58_380, startMs: 57_160, text: "结论仍属未经证实" },
  { endMs: 63_420, startMs: 62_180, text: "粉丝原本期待再次搭档" },
  { endMs: 69_360, startMs: 68_140, text: "签约流程仍然停滞" },
  { endMs: 72_860, startMs: 72_220, text: "视频强调以官宣为准" },
  { endMs: 77_860, startMs: 77_120, text: "粉后讨论最新内容" },
  { endMs: 78_900, startMs: 78_020, text: "视频片尾" },
] as const;
afterEach(cleanup);

const timeLinkScope = {
  activeVideoKey: videoKey,
  subtitleVideoKey: videoKey,
};

function commonInsightProps() {
  return {
    content: ["结论 [00:25][3m48s]", "范围 [05:38–06:45]，越界 [8m21s]"].join(
      "\n\n",
    ),
    hasSubtitle: true,
    instruction: "",
    kind: "summary" as const,
    onClear: vi.fn(),
    onExport: vi.fn(),
    onGenerate: vi.fn(),
    onInstructionChange: vi.fn(),
    onStop: vi.fn(),
    phase: "ready" as const,
    segments: [],
    subtitleRows,
    timeLinkScope,
  };
}

describe("时间导航消费者", () => {
  it("总结消费公共点/范围契约，范围保留完整可访问标签并跳到起点", () => {
    const onSeek = vi.fn();
    render(<InsightWorkspace {...commonInsightProps()} onSeek={onSeek} />);

    // 时间不重叠的点各自保留原位：不再被合并成一个范围。
    fireEvent.click(screen.getByLabelText("跳转到 00:25"));
    expect(onSeek).toHaveBeenNthCalledWith(1, 25);
    fireEvent.click(screen.getByLabelText("跳转到 03:48"));
    expect(onSeek).toHaveBeenNthCalledWith(2, 228);
    fireEvent.click(screen.getByLabelText("跳转到 05:38–06:45"));
    expect(onSeek).toHaveBeenNthCalledWith(3, 338);
    expect(screen.queryByLabelText("跳转到 8m21s")).toBeNull();
    expect(screen.getByText(/越界 \[8m21s\]/)).not.toBeNull();
  });

  it("总结每个原时间位置只渲染一个单点或范围控件", () => {
    const onSeek = vi.fn();
    render(
      <InsightWorkspace
        {...commonInsightProps()}
        content={[
          "**签约可能出现变故 3s**",
          "此前爆料仍没有实质动静。00:10 16s",
          "## 转会时间已经紧张 19s",
          "## Bin 回归传闻增加变数 39s",
          "*结论：目前仍属未经证实的爆料 57s*",
          "视频强调以官宣为准。01:02 1m8s 1m12s 01:17",
        ].join("\n\n")}
        onSeek={onSeek}
        subtitleRows={screenshotLikeSubtitleRows}
      />,
    );

    // 时间不重叠的点各自保留原位；仅重叠表述合并为范围。
    for (const label of [
      "00:03",
      "00:10",
      "00:16",
      "00:19",
      "00:39",
      "00:57",
      "01:02",
      "01:08",
      "01:12",
      "01:17",
    ]) {
      expect(screen.getByLabelText(`跳转到 ${label}`)).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { name: /跳转到/ })).toHaveLength(10);
    fireEvent.click(screen.getByLabelText("跳转到 01:02"));
    expect(onSeek).toHaveBeenCalledWith(62);
    fireEvent.click(screen.getByLabelText("跳转到 01:08"));
    expect(onSeek).toHaveBeenCalledWith(68);
    fireEvent.click(screen.getByLabelText("跳转到 01:12"));
    expect(onSeek).toHaveBeenCalledWith(72);
    fireEvent.click(screen.getByLabelText("跳转到 01:17"));
    expect(onSeek).toHaveBeenCalledWith(77);
  });

  it("总结兼容模型输出的裸时间点和裸范围，并渲染为可点击小框", () => {
    const onSeek = vi.fn();
    render(
      <InsightWorkspace
        {...commonInsightProps()}
        content={["标题 7s", "正文时间 12s 14s", "范围 01:12–01:17。"].join(
          "\n\n",
        )}
        onSeek={onSeek}
      />,
    );

    // 12s 与 14s 是两个不重叠的点：各自保留原位渲染。
    fireEvent.click(screen.getByLabelText("跳转到 00:07"));
    fireEvent.click(screen.getByLabelText("跳转到 00:12"));
    fireEvent.click(screen.getByLabelText("跳转到 00:14"));
    fireEvent.click(screen.getByLabelText("跳转到 01:12–01:17"));
    expect(onSeek).toHaveBeenNthCalledWith(1, 7);
    expect(onSeek).toHaveBeenNthCalledWith(2, 12);
    expect(onSeek).toHaveBeenNthCalledWith(3, 14);
    expect(onSeek).toHaveBeenNthCalledWith(4, 72);
  });

  it("总结完成后正文不再保留流式浅灰状态", () => {
    const view = render(
      <InsightWorkspace
        {...commonInsightProps()}
        content="> 最后一段曾经处于生成中"
      />,
    );

    expect(
      view.container
        .querySelector(".muzhi-insight__result")
        ?.getAttribute("data-streaming"),
    ).toBe("false");
    expect(view.container.querySelector("blockquote")?.className).toContain(
      "muzhi-markdown__quote--complete",
    );
  });

  it("对话截图中的裸时间全部渲染为主题时间控件并可跳转", () => {
    const onSeek = vi.fn();
    render(
      <ChatWorkspace
        activeThreadId="thread-a"
        messages={[
          {
            content: "此前爆料仍没有实质进展 00:10；最新变化 39s；结论 1m12s。",
            id: "message-screenshot",
            role: "assistant",
            status: "complete",
          },
        ]}
        onCopyMessage={vi.fn()}
        onCreateThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onExportThread={vi.fn()}
        onRenameThread={vi.fn()}
        onRequestMessageMutation={vi.fn()}
        onRetryMessage={vi.fn()}
        onSeek={onSeek}
        onSelectThread={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        subtitleRows={subtitleRows}
        timeLinkScope={timeLinkScope}
        threads={[{ id: "thread-a", title: "对话 1" }]}
      />,
    );

    const answer = screen.getByRole("article", { name: "回答" });
    for (const label of ["00:10", "00:39", "01:12"]) {
      const control = within(answer).getByLabelText(`跳转到 ${label}`);
      expect(control.className).toContain("muzhi-markdown__time-link");
    }
    fireEvent.click(within(answer).getByLabelText("跳转到 01:12"));
    expect(onSeek).toHaveBeenCalledWith(72);
  });

  it("对话流式正文只链接完整标记，相邻标记保持两个独立控件", () => {
    const onSeek = vi.fn();
    render(
      <ChatWorkspace
        activeThreadId="thread-a"
        messages={[
          {
            content: "[00:25][3m48s] 尾部 [5m",
            id: "message-a",
            role: "assistant",
            status: "streaming",
          },
        ]}
        onCopyMessage={vi.fn()}
        onCreateThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onExportThread={vi.fn()}
        onRenameThread={vi.fn()}
        onRequestMessageMutation={vi.fn()}
        onRetryMessage={vi.fn()}
        onSeek={onSeek}
        onSelectThread={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        subtitleRows={subtitleRows}
        timeLinkScope={timeLinkScope}
        threads={[{ id: "thread-a", title: "对话 1" }]}
      />,
    );

    const answer = screen.getByRole("article", { name: "回答" });
    expect(
      within(answer).getAllByRole("button", { name: /跳转到/ }),
    ).toHaveLength(2);
    expect(within(answer).queryByLabelText("跳转到 5m")).toBeNull();
  });
});
