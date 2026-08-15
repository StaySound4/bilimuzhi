import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown, type MarkdownProps } from "../../src/ui/markdown";

afterEach(cleanup);

interface ValidatedTimeLink {
  readonly label: string;
  readonly seconds: number;
}

interface V11MarkdownProps extends MarkdownProps {
  readonly onSeek: (seconds: number) => void;
  readonly validatedTimeLinks: readonly ValidatedTimeLink[];
}

const V11Markdown = Markdown as FunctionComponent<V11MarkdownProps>;

describe("v11 safe streaming Markdown", () => {
  it("activates a complete validated time marker during streaming but leaves an incomplete marker as text", () => {
    const onSeek = vi.fn();
    const view = render(
      <V11Markdown
        onSeek={onSeek}
        text="关键结论 [01:40]；下一处仍在生成 [02:"
        validatedTimeLinks={[{ label: "01:40", seconds: 100 }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳转到 01:40" }));
    expect(onSeek).toHaveBeenCalledWith(100);
    expect(view.container.textContent).toContain("[02:");
    expect(screen.queryByRole("button", { name: /跳转到 02/ })).toBeNull();
  });

  it("routes only validated normalized time and subtitle-line references through the unified seek handler", () => {
    const onSeek = vi.fn();
    render(
      <V11Markdown
        onSeek={onSeek}
        text="规范时间 [00:05]，字幕行 [line-a]。"
        validatedTimeLinks={[
          { label: "00:05", seconds: 5 },
          { label: "line-a", seconds: 5 },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳转到 00:05" }));
    fireEvent.click(screen.getByRole("button", { name: "跳转到 line-a" }));
    expect(onSeek).toHaveBeenNthCalledWith(1, 5);
    expect(onSeek).toHaveBeenNthCalledWith(2, 5);
  });

  it("degrades Bilibili time URLs for the current, another video, or another page to inert text while preserving ordinary safe links", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <V11Markdown
        onSeek={onSeek}
        text={[
          "[00:05](https://www.bilibili.com/video/BV1xx411c7mD?p=1&t=5)",
          "[跳转到 00:05](https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=5)",
          "[另一个视频 00:05](https://www.bilibili.com/video/BV17x411w7KC?p=1&t=5)",
          "[普通安全说明](https://example.test/docs)",
        ].join("\n")}
        validatedTimeLinks={[{ label: "00:05", seconds: 5 }]}
      />,
    );

    expect(screen.getByRole("link", { name: "普通安全说明" })).not.toBeNull();
    expect(
      container.querySelector("a[href*='bilibili.com'][href*='t=']"),
    ).toBeNull();
    expect(container.textContent).toContain("00:05");
    expect(container.textContent).toContain("跳转到 00:05");
    expect(container.textContent).toContain("另一个视频 00:05");
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "跳转到 00:05" })).toBeNull();
  });

  it("renders GFM tables and real restricted LaTeX", () => {
    const { container } = render(
      <V11Markdown
        onSeek={vi.fn()}
        text={[
          "| 指标 | 值 |",
          "| --- | --- |",
          "| 速度 | $v=\\frac{s}{t}$ |",
        ].join("\n")}
        validatedTimeLinks={[]}
      />,
    );

    expect(screen.getByRole("table")).not.toBeNull();
    const renderedMathSelector =
      "math, [role='math'], .katex, [data-math-rendered='true'], [aria-label^='数学公式']";
    const renderedMath = container.querySelector(renderedMathSelector);
    expect(renderedMath).not.toBeNull();

    const sourceOnlyPlaceholder = container.querySelector(
      ".muzhi-markdown__latex[data-latex]",
    );
    if (sourceOnlyPlaceholder !== null) {
      expect(
        sourceOnlyPlaceholder.matches(renderedMathSelector) ||
          sourceOnlyPlaceholder.querySelector(renderedMathSelector) !== null,
      ).toBe(true);
    }
  });

  it("continues blocking raw HTML, javascript/data URLs, and event attributes", () => {
    const { container } = render(
      <V11Markdown
        onSeek={vi.fn()}
        text={[
          "<img src=x onerror=alert(1)>",
          "[危险](javascript:alert(1))",
          "[数据](data:text/html,<script>alert(1)</script>)",
          '<button onclick="alert(1)">事件属性</button>',
        ].join("\n")}
        validatedTimeLinks={[]}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href^="data:"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "事件属性" })).toBeNull();
    expect(container.querySelector("[onclick], [onerror]")).toBeNull();
  });

  it("falls back from a LaTeX render failure to semantic, copyable source without crashing the message", () => {
    const { container } = render(
      <V11Markdown
        onSeek={vi.fn()}
        text="前文仍保留；损坏公式 $\\frac{$；后文也保留。"
        validatedTimeLinks={[]}
      />,
    );

    expect(container.textContent).toContain("前文仍保留");
    expect(container.textContent).toContain("后文也保留");
    const fallback = container.querySelector(
      "code[data-latex-fallback][aria-label*='LaTeX']",
    );
    expect(fallback?.textContent).toBe("\\frac{");
  });

  it("one-per-block 将重复与跨格式时间统一为一个规范范围控件", () => {
    const onSeek = vi.fn();
    render(
      <V11Markdown
        onSeek={onSeek}
        text="**阶段 77s**，范围 62s–77s，*再次确认 62s*"
        timeLinkGroupPolicy="one-per-block"
        validatedTimeLinks={[
          { label: "62s", seconds: 62 },
          { label: "62s–77s", seconds: 62 },
          { label: "77s", seconds: 77 },
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: /跳转到/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "跳转到 01:02–01:17" }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(62);
  });

  it("one-per-block 兼容旧方括号时钟并忽略代码与普通链接内的时间", () => {
    const onSeek = vi.fn();
    render(
      <V11Markdown
        onSeek={onSeek}
        text="定位 [01:02]；代码 `77s`；文档 [62s](https://example.test)"
        timeLinkGroupPolicy="one-per-block"
        validatedTimeLinks={[
          { label: "01:02", seconds: 62 },
          { label: "62s", seconds: 62 },
          { label: "77s", seconds: 77 },
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: /跳转到/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "跳转到 01:02" }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(62);
    expect(screen.getByRole("link", { name: "62s" })).not.toBeNull();
  });

  it("one-per-block 忽略反斜杠转义标记，不吞掉同段合法时间", () => {
    const onSeek = vi.fn();
    const view = render(
      <V11Markdown
        onSeek={onSeek}
        text={String.raw`字面量 \[5s]，合法 [10s]`}
        timeLinkGroupPolicy="one-per-block"
        validatedTimeLinks={[
          { label: "5s", seconds: 5 },
          { label: "10s", seconds: 10 },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳转到 00:10" }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(10);
    expect(view.container.textContent).toContain("\\[5s]");
    expect(screen.queryByRole("button", { name: "跳转到 00:05" })).toBeNull();
  });

  it("one-per-block 只合并时间重叠的标记：同段内不同时间点各自保留原位", () => {
    const onSeek = vi.fn();
    const view = render(
      <V11Markdown
        onSeek={onSeek}
        text="其中引用了 [00:05:38] 的案例，还有 [00:06:45] 的补充。"
        timeLinkGroupPolicy="one-per-block"
        validatedTimeLinks={[
          { label: "00:05:38", seconds: 338 },
          { label: "00:06:45", seconds: 405 },
        ]}
      />,
    );

    // 两个不同时间点都不被吞掉，且停留在各自原文位置。
    expect(view.container.textContent).toContain("引用了 05:38 的案例");
    expect(view.container.textContent).toContain("还有 06:45 的补充");
    const links = screen.getAllByRole("button", { name: /跳转到/ });
    expect(links).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "跳转到 05:38" }));
    fireEvent.click(screen.getByRole("button", { name: "跳转到 06:45" }));
    expect(onSeek).toHaveBeenCalledWith(338);
    expect(onSeek).toHaveBeenCalledWith(405);
  });
});
