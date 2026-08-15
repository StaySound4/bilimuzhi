import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubtitleRow } from "../../src/domain";
import { SubtitleTimeline } from "../../src/ui/subtitle-timeline";

afterEach(cleanup);

function createRows(count: number): SubtitleRow[] {
  return Array.from({ length: count }, (_, index) => ({
    endMs: index * 2_000 + 1_500,
    startMs: index * 2_000,
    text: `字幕行 ${index}`,
  }));
}

describe("SubtitleTimeline", () => {
  it("virtualizes 10,000 rows and searches before rendering the window", () => {
    render(
      <SubtitleTimeline
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        rows={createRows(10_000)}
        viewportHeight={240}
      />,
    );

    expect(screen.getAllByTestId("subtitle-row").length).toBeLessThan(20);
    expect(screen.getByText("字幕行 0")).not.toBeNull();
    expect(screen.queryByText("字幕行 9999")).toBeNull();

    fireEvent.input(screen.getByRole("searchbox", { name: "搜索字幕" }), {
      target: { value: "字幕行 9999" },
    });

    expect(screen.getAllByTestId("subtitle-row")).toHaveLength(1);
    expect(screen.getByText("字幕行 9999")).not.toBeNull();
    expect(screen.queryByText("字幕行 0")).toBeNull();
    expect(document.querySelector("mark")?.textContent).toBe("字幕行 9999");
  });

  it("locates the controlled current row without mounting the full list", () => {
    render(
      <SubtitleTimeline
        currentTimeMs={100_250}
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );

    expect(screen.queryByText("字幕行 50")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "定位当前字幕" }));

    const current = screen.getByText("字幕行 50").closest("li");
    expect(current?.getAttribute("aria-current")).toBe("true");
    expect(screen.getAllByTestId("subtitle-row").length).toBeLessThan(20);
  });

  it("reads the current player time before locating when the host supplies it", async () => {
    const onLocateCurrent = vi.fn(async () => 100_250);
    render(
      <SubtitleTimeline
        onLocateCurrent={onLocateCurrent}
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "定位当前字幕" }));

    await vi.waitFor(() => expect(onLocateCurrent).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.getByText("字幕行 50")).toBeTruthy());
    // 成功定位不增加布局状态文字（Ticket 08）。
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses the freshly read player time for both centering and highlighting", async () => {
    const onLocateCurrent = vi.fn(async () => 100_250);
    render(
      <SubtitleTimeline
        currentTimeMs={250}
        onLocateCurrent={onLocateCurrent}
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "定位当前字幕" }));

    await vi.waitFor(() => expect(screen.getByText("字幕行 50")).toBeTruthy());
    expect(
      screen.getByText("字幕行 50").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.getByRole("region", { name: "字幕时间线" }).scrollTop).toBe(
      1_920,
    );
  });

  it("keeps the last verified row and scroll position when a fresh locate sample fails", async () => {
    const onLocateCurrent = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(100_250)
      .mockRejectedValueOnce(new Error("player unavailable"));
    render(
      <SubtitleTimeline
        onLocateCurrent={onLocateCurrent}
        overscan={2}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );

    const locate = screen.getByRole("button", { name: "定位当前字幕" });
    fireEvent.click(locate);
    await vi.waitFor(() => expect(screen.getByText("字幕行 50")).toBeTruthy());
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    const verifiedScrollTop = viewport.scrollTop;

    fireEvent.click(locate);
    await vi.waitFor(() => expect(onLocateCurrent).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "无法读取当前播放位置",
      ),
    );
    expect(
      screen.getByText("字幕行 50").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
    expect(viewport.scrollTop).toBe(verifiedScrollTop);
  });

  it("locates the last started subtitle while playback is inside a subtitle gap", async () => {
    render(
      <SubtitleTimeline
        onLocateCurrent={async () => 101_750}
        overscan={2}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "定位当前字幕" }));

    await vi.waitFor(() => expect(screen.getByText("字幕行 50")).toBeTruthy());
    expect(
      screen.getByText("字幕行 50").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains when the current player time has no matching subtitle row", async () => {
    render(
      <SubtitleTimeline
        onLocateCurrent={async () => 999_999}
        rows={createRows(3)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "定位当前字幕" }));

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "当前播放位置没有匹配的字幕。",
      ),
    );
  });

  it("restores the virtual window scroll and reports later scroll changes", () => {
    const onScrollTopChange = vi.fn();
    render(
      <SubtitleTimeline
        initialScrollTop={2_000}
        onScrollTopChange={onScrollTopChange}
        rowHeight={40}
        rows={createRows(100)}
        viewportHeight={200}
      />,
    );

    expect(screen.getByText("字幕行 50")).not.toBeNull();
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    fireEvent.scroll(viewport, { target: { scrollTop: 2_400 } });

    expect(screen.getByText("字幕行 60")).not.toBeNull();
    expect(onScrollTopChange).toHaveBeenLastCalledWith(2_400);
  });

  it("creates a scrollable timeline viewport as soon as a long timeline mounts", () => {
    render(
      <SubtitleTimeline
        rowHeight={40}
        rows={createRows(100)}
        viewportHeight={200}
      />,
    );

    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.style.overflowY).toBe("scroll");
    expect(viewport.style.scrollbarGutter).toBe("stable");

    fireEvent.scroll(viewport, { target: { scrollTop: 800 } });
    expect(screen.getByText("字幕行 20")).not.toBeNull();
  });

  it("becomes scrollable immediately when subtitle rows arrive after the empty state", () => {
    const view = render(
      <SubtitleTimeline rowHeight={40} rows={[]} viewportHeight={200} />,
    );

    view.rerender(
      <SubtitleTimeline
        rowHeight={40}
        rows={createRows(100)}
        viewportHeight={200}
      />,
    );

    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.style.overflowY).toBe("scroll");
    expect(viewport.style.scrollbarGutter).toBe("stable");

    fireEvent.scroll(viewport, { target: { scrollTop: 800 } });
    expect(screen.getByText("字幕行 20")).not.toBeNull();
  });

  it("keeps an active subtitle visible while sync mode is enabled and locks locate", () => {
    const onSyncEnabledChange = vi.fn();
    render(
      <SubtitleTimeline
        currentTimeMs={100_250}
        onSyncEnabledChange={onSyncEnabledChange}
        rows={createRows(1_000)}
        rowHeight={40}
        syncEnabled
        viewportHeight={200}
      />,
    );

    expect(screen.getByText("字幕行 50")).not.toBeNull();
    expect(screen.getByRole("button", { name: "定位当前字幕" })).toHaveProperty(
      "disabled",
      true,
    );
    const sync = screen.getByRole("button", { name: "同步模式" });
    expect(sync.getAttribute("aria-pressed")).toBe("true");
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.classList).toContain("is-synced");
    expect(viewport.style.overflowY).toBe("hidden");
    expect(viewport.style.scrollbarGutter).toBe("auto");

    fireEvent.click(sync);
    expect(onSyncEnabledChange).toHaveBeenCalledWith(false);
  });

  it("recenters the active subtitle on the next player sample after manual scrolling", () => {
    const view = render(
      <SubtitleTimeline
        currentTimeMs={100_250}
        rowHeight={40}
        rows={createRows(1_000)}
        syncEnabled
        viewportHeight={200}
      />,
    );
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.scrollTop).toBe(1_920);

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(viewport.scrollTop).toBe(0);

    view.rerender(
      <SubtitleTimeline
        currentTimeMs={100_500}
        rowHeight={40}
        rows={createRows(1_000)}
        syncEnabled
        viewportHeight={200}
      />,
    );

    expect(viewport.scrollTop).toBe(1_920);
    expect(
      screen.getByText("字幕行 50").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("does not persist follow-scroll and restores the prior free position when sync closes", () => {
    const onScrollTopChange = vi.fn();
    const view = render(
      <SubtitleTimeline
        currentTimeMs={100_250}
        initialScrollTop={800}
        onScrollTopChange={onScrollTopChange}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.scrollTop).toBe(800);

    view.rerender(
      <SubtitleTimeline
        currentTimeMs={100_250}
        initialScrollTop={800}
        onScrollTopChange={onScrollTopChange}
        rowHeight={40}
        rows={createRows(1_000)}
        syncEnabled
        viewportHeight={200}
      />,
    );
    expect(viewport.scrollTop).toBe(1_920);
    fireEvent.scroll(viewport, { target: { scrollTop: 1_920 } });
    expect(onScrollTopChange).not.toHaveBeenCalled();

    view.rerender(
      <SubtitleTimeline
        currentTimeMs={100_250}
        initialScrollTop={800}
        onScrollTopChange={onScrollTopChange}
        rowHeight={40}
        rows={createRows(1_000)}
        viewportHeight={200}
      />,
    );
    expect(viewport.scrollTop).toBe(800);
    expect(viewport.style.overflowY).toBe("scroll");
  });

  it("keeps the last started subtitle visible when sync advances into a subtitle gap", () => {
    const view = render(
      <SubtitleTimeline
        currentTimeMs={250}
        rowHeight={40}
        rows={createRows(1_000)}
        syncEnabled
        viewportHeight={200}
      />,
    );

    view.rerender(
      <SubtitleTimeline
        currentTimeMs={101_750}
        rowHeight={40}
        rows={createRows(1_000)}
        syncEnabled
        viewportHeight={200}
      />,
    );

    const current = screen.getByText("字幕行 50").closest("li");
    expect(current?.getAttribute("aria-current")).toBe("true");
  });

  it("publishes a request to enable sync mode", () => {
    const onSyncEnabledChange = vi.fn();
    render(
      <SubtitleTimeline
        onSyncEnabledChange={onSyncEnabledChange}
        rows={createRows(1)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "同步模式" }));
    expect(onSyncEnabledChange).toHaveBeenCalledWith(true);
  });

  it("seeks only finite non-negative row times within the video duration", () => {
    const onSeek = vi.fn();
    const rows = [
      { endMs: 2_000, startMs: 1_000, text: "合法时间" },
      { endMs: 3_000, startMs: -1, text: "负数时间" },
      { endMs: 8_000, startMs: 7_000, text: "超出时长" },
      { endMs: 4_000, startMs: Number.NaN, text: "非有限时间" },
      { endMs: 3_000, startMs: 4_000, text: "倒置区间" },
    ] as SubtitleRow[];
    render(<SubtitleTimeline durationMs={5_000} onSeek={onSeek} rows={rows} />);

    fireEvent.click(
      screen.getByRole("button", { name: "跳转到 00:01：合法时间" }),
    );
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(1);
    expect(
      screen.queryByRole("button", {
        name: /负数时间|超出时长|非有限时间|倒置区间/,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByText("负数时间"));
    fireEvent.click(screen.getByText("超出时长"));
    fireEvent.click(screen.getByText("非有限时间"));
    fireEvent.click(screen.getByText("倒置区间"));
    expect(onSeek).toHaveBeenCalledOnce();
  });

  it("opens one export dialog and publishes TXT/SRT/Markdown intents with the timestamp option", () => {
    const onExport = vi.fn();
    render(
      <SubtitleTimeline
        onExport={onExport}
        onSeek={() => undefined}
        rows={createRows(1)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    screen.getByRole("alertdialog", { name: "选择导出格式" });
    // narrow 形态：AppDialog 单选格式（时间戳默认包含）。
    expect(
      (screen.getByRole("combobox", { name: "选择" }) as HTMLSelectElement)
        .value,
    ).toBe("txt");
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "导出",
      }),
    );
    expect(onExport.mock.calls).toEqual([["txt", { includeTimestamps: true }]]);
  });

  it("offers only TXT/SRT/Markdown in the unified dialog without a ZIP button", () => {
    render(
      <SubtitleTimeline
        onExport={() => undefined}
        onSeek={() => undefined}
        rows={createRows(1)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    const dialog = screen.getByRole("alertdialog", { name: "选择导出格式" });
    expect(screen.queryByRole("button", { name: "导出会话 ZIP" })).toBeNull();
    expect(dialog.textContent).toContain("TXT");
    expect(dialog.textContent).toContain("SRT");
    expect(dialog.textContent).toContain("Markdown");
  });

  it("disables export intents when the timeline has no subtitle rows", () => {
    render(
      <SubtitleTimeline
        onExport={() => undefined}
        onSeek={() => undefined}
        rows={[]}
      />,
    );

    for (const button of screen.getAllByRole("button", { name: /导出/ })) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});

it("measures the real viewport height and expands the virtual window after resize", async () => {
  let resizeCallback: ResizeObserverCallback | undefined;
  const originalResizeObserver = globalThis.ResizeObserver;
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver;

  try {
    render(
      <SubtitleTimeline overscan={0} rowHeight={40} rows={createRows(100)} />,
    );
    const viewport = screen.getByRole("region", { name: "字幕时间线" });
    expect(viewport.style.height).toBe("");
    expect(screen.getAllByTestId("subtitle-row")).toHaveLength(8);

    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 480,
    });
    resizeCallback?.([], {} as ResizeObserver);

    await vi.waitFor(() =>
      expect(screen.getAllByTestId("subtitle-row")).toHaveLength(12),
    );
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

it("distinguishes no-video, no-subtitle, and no-match empty states", () => {
  const view = render(<SubtitleTimeline availability="no-video" rows={[]} />);
  expect(screen.getByText("尚未选择视频")).not.toBeNull();
  view.rerender(<SubtitleTimeline availability="no-subtitle" rows={[]} />);
  expect(screen.getByText("尚无字幕")).not.toBeNull();
  view.rerender(<SubtitleTimeline rows={createRows(2)} />);
  fireEvent.input(screen.getByRole("searchbox", { name: "搜索字幕" }), {
    target: { value: "不存在" },
  });
  expect(screen.getByText("没有匹配的字幕")).not.toBeNull();
});

describe("Ticket 08 同步状态机在时间轴组件中的投影", () => {
  it("同步中 following 用最近采样高亮（旧 currentTimeMs 不回跳）", () => {
    render(
      <SubtitleTimeline
        currentTimeMs={9_000}
        durationMs={1_000 * 1_000}
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        playerOwner={{
          pageRevision: 1,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
        rows={createRows(1_000)}
        subtitleOwner={{
          pageRevision: 1,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
        syncEnabled
        syncState={{
          generation: 3,
          lastSampleMs: 12_000,
          phase: "following",
        }}
        viewportHeight={200}
      />,
    );
    expect(
      screen.getByText("字幕行 6").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("同步中 seeking 锁定 seek 目标行高亮", () => {
    render(
      <SubtitleTimeline
        currentTimeMs={9_000}
        durationMs={1_000 * 1_000}
        onSeek={() => undefined}
        overscan={2}
        rowHeight={40}
        playerOwner={{
          pageRevision: 1,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
        rows={createRows(1_000)}
        subtitleOwner={{
          pageRevision: 1,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
        syncEnabled
        syncState={{
          generation: 4,
          phase: "seeking",
          seekTargetMs: 60_000,
        }}
        viewportHeight={200}
      />,
    );
    expect(
      screen.getByText("字幕行 30").closest("li")?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("owner 不匹配（不同 videoKey / pageRevision）时定位与同步都禁用", () => {
    const base = {
      currentTimeMs: 10_000,
      onSeek: () => undefined,
      onSyncEnabledChange: vi.fn(),
      overscan: 2,
      rowHeight: 40,
      rows: createRows(1_000),
      subtitleOwner: {
        pageRevision: 2,
        videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
      },
      viewportHeight: 200,
    };
    // 不同 videoKey（不同视频）
    const { rerender } = render(
      <SubtitleTimeline
        {...base}
        playerOwner={{
          pageRevision: 2,
          videoKey: "bvid:BV1zt4y1z72D:cid:2:p:1" as never,
        }}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "定位当前字幕",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "同步模式" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // 同 videoKey 不同 pageRevision（页面刷新后）
    rerender(
      <SubtitleTimeline
        {...base}
        playerOwner={{
          pageRevision: 3,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "定位当前字幕",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // 关闭视频页：playerOwner 缺失
    rerender(<SubtitleTimeline {...base} playerOwner={undefined} />);
    expect(
      (
        screen.getByRole("button", {
          name: "定位当前字幕",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // 匹配恢复后可用
    rerender(
      <SubtitleTimeline
        {...base}
        playerOwner={{
          pageRevision: 2,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "定位当前字幕",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("定位/同步按钮为图标按钮并带 title 与 aria-label", () => {
    const onSyncEnabledChange = vi.fn();
    render(
      <SubtitleTimeline
        onSeek={() => undefined}
        onSyncEnabledChange={onSyncEnabledChange}
        rows={createRows(1_000)}
      />,
    );
    const locate = screen.getByRole("button", { name: "定位当前字幕" });
    expect(locate.querySelector('[data-icon="locate"]')).not.toBeNull();
    expect(locate.getAttribute("title")).toBe("定位当前字幕");
    const sync = screen.getByRole("button", { name: "同步模式" });
    expect(sync.querySelector('[data-icon="sync"]')).not.toBeNull();
    expect(sync.getAttribute("aria-pressed")).toBe("false");
  });

  it("disabled 时 title 显示断开原因（no-video / video-mismatch）", () => {
    const base = {
      onSeek: () => undefined,
      onSyncEnabledChange: () => undefined,
      rows: createRows(1_000),
      subtitleOwner: {
        pageRevision: 1,
        videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
      },
    };
    const { rerender } = render(
      <SubtitleTimeline
        {...base}
        playerDisconnectReason="no-video"
        playerOwner={undefined}
      />,
    );
    let locate = screen.getByRole("button", { name: "定位当前字幕" });
    let sync = screen.getByRole("button", { name: "同步模式" });
    expect((locate as HTMLButtonElement).disabled).toBe(true);
    expect(locate.getAttribute("title")).toBe(
      "请先打开并连接该视频的播放器页面",
    );
    expect(sync.getAttribute("title")).toBe("请先打开并连接该视频的播放器页面");
    // 其他视频
    rerender(
      <SubtitleTimeline
        {...base}
        playerDisconnectReason="video-mismatch"
        playerOwner={undefined}
      />,
    );
    locate = screen.getByRole("button", { name: "定位当前字幕" });
    sync = screen.getByRole("button", { name: "同步模式" });
    expect(locate.getAttribute("title")).toBe(
      "当前页面是其他视频，请切换到已绑定视频的页面",
    );
    expect(sync.getAttribute("title")).toBe(
      "当前页面是其他视频，请切换到已绑定视频的页面",
    );
    // 匹配恢复：title 回到默认
    rerender(
      <SubtitleTimeline
        {...base}
        playerOwner={{
          pageRevision: 1,
          videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1" as never,
        }}
      />,
    );
    locate = screen.getByRole("button", { name: "定位当前字幕" });
    expect(locate.getAttribute("title")).toBe("定位当前字幕");
  });
});
