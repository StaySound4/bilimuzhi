import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubtitleTimeline } from "../../src/ui/subtitle-timeline";

afterEach(cleanup);

const owner = {
  pageRevision: 13,
  videoKey: "bvid:BV1v13ViSuAl:cid:7130001:p:1",
} as const;

describe("v13 A9 subtitle timeline visual and accessibility contract", () => {
  it("renders a genuine empty state without a stray horizontal rule", () => {
    const { container } = render(
      <SubtitleTimeline
        rows={[]}
        currentTimeMs={0}
        durationMs={0}
        playerOwner={owner}
        subtitleOwner={owner}
        onExport={vi.fn()}
        onLocateCurrent={vi.fn(async () => null)}
        onSeek={vi.fn()}
      />,
    );

    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(
      screen.getByText(/尚无字幕|暂无字幕|没有字幕|字幕为空/),
    ).not.toBeNull();
  });

  it("gives every reachable timeline control a non-empty accessible name", () => {
    const { container } = render(
      <SubtitleTimeline
        rows={[
          { startMs: 0, endMs: 1_800, text: "第一条字幕" },
          { startMs: 1_800, endMs: 4_200, text: "第二条字幕" },
        ]}
        currentTimeMs={2_100}
        durationMs={5_000}
        playerOwner={owner}
        subtitleOwner={owner}
        syncEnabled
        onExport={vi.fn()}
        onLocateCurrent={vi.fn(async () => 1_800)}
        onSeek={vi.fn()}
        onSyncEnabledChange={vi.fn()}
      />,
    );

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, [tabindex='0']",
      ),
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name =
        control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim()).not.toBe("");
      if (control.tagName === "BUTTON") {
        expect(control.getAttribute("type")).toBe("button");
      }
    }
    expect(screen.getByRole("button", { name: /同步|跟随/ })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /定位|当前字幕/ }),
    ).not.toBeNull();
  });

  it("keeps seeking, synchronization, locating, and export controls keyboard-reachable", async () => {
    const onSeek = vi.fn();
    const onSyncEnabledChange = vi.fn();
    const onLocateCurrent = vi.fn(async () => 2_000);
    const onExport = vi.fn();
    render(
      <SubtitleTimeline
        rows={[{ startMs: 2_000, endMs: 3_500, text: "可触达字幕" }]}
        currentTimeMs={2_200}
        durationMs={4_000}
        playerOwner={owner}
        subtitleOwner={owner}
        syncEnabled={false}
        onExport={onExport}
        onLocateCurrent={onLocateCurrent}
        onSeek={onSeek}
        onSyncEnabledChange={onSyncEnabledChange}
      />,
    );

    const row = screen.getByText("可触达字幕").closest("li") as HTMLElement;
    const seek = within(row).getByRole("button");
    seek.focus();
    expect(document.activeElement).toBe(seek);
    fireEvent.click(seek);
    expect(onSeek).toHaveBeenCalledWith(2);

    const sync = screen.getByRole("button", { name: /同步|跟随/ });
    expect(sync.getAttribute("aria-pressed")).toBe("false");
    sync.focus();
    expect(document.activeElement).toBe(sync);
    fireEvent.click(sync);
    expect(onSyncEnabledChange).toHaveBeenCalledWith(true);

    const locate = screen.getByRole("button", { name: /定位|当前字幕/ });
    fireEvent.click(locate);
    await waitFor(() => expect(onLocateCurrent).toHaveBeenCalledTimes(1));
    expect(onSeek).toHaveBeenLastCalledWith(2);

    // v16：四个导出按钮合并为一个「导出」按钮 + 导出对话框。
    const exportButton = screen.getByRole("button", { name: /^导出/ });
    exportButton.focus();
    expect(document.activeElement).toBe(exportButton);
    fireEvent.click(exportButton);
    const dialog = screen.getByRole("alertdialog", { name: "选择导出格式" });
    expect(dialog.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
    // narrow 形态：select 选格式（默认 txt），confirm 导出。
    fireEvent.click(within(dialog).getByRole("button", { name: "导出" }));
    expect(onExport).toHaveBeenCalledWith("txt", { includeTimestamps: true });
  });
});
