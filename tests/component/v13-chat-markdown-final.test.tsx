import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import type { ComponentProps, FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatWorkspace } from "../../src/ui/chat/chat-workspace";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";
import { Markdown } from "../../src/ui/markdown";

afterEach(cleanup);

type ChatProps = ComponentProps<typeof ChatWorkspace> & {
  onCopyReasoning?: (messageId: string) => void;
};

interface V13InsightWorkspaceProps extends InsightWorkspaceProps {
  readonly onCopyContent?: () => void;
  readonly onCopyReasoning?: () => void;
  readonly reasoning?: string;
}

const V13InsightWorkspace =
  InsightWorkspace as FunctionComponent<V13InsightWorkspaceProps>;

function chatProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    activeThreadId: "thread-1",
    messages: [],
    onCopyMessage: vi.fn(),
    onCreateThread: vi.fn(),
    onDeleteThread: vi.fn(),
    onExportThread: vi.fn(),
    onRenameThread: vi.fn(),
    onRequestMessageMutation: vi.fn(),
    onRetryMessage: vi.fn(),
    onSelectThread: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    threads: [{ id: "thread-1", title: "代数复习" }],
    ...overrides,
  };
}

function insightProps(
  overrides: Partial<V13InsightWorkspaceProps> = {},
): V13InsightWorkspaceProps {
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

function expectIconButton(name: string | RegExp): HTMLElement {
  const button = screen.getByRole("button", { name });
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.querySelector("title")).not.toBeNull();
  return button;
}

describe("v13 A1/A2/A3 chat public interaction contract", () => {
  it("A1 keeps user then assistant in chronological top-to-bottom order and exposes titled icon actions", () => {
    const { container } = render(
      <ChatWorkspace
        {...chatProps({
          messages: [
            {
              id: "question-1",
              role: "user",
              content: "先问：什么是导数？",
              status: "complete",
            },
            {
              id: "answer-1",
              role: "assistant",
              content: "再答：瞬时变化率。",
              status: "complete",
            },
          ],
        })}
      />,
    );

    const articles = Array.from(container.querySelectorAll("article"));
    expect(articles).toHaveLength(2);
    expect(articles[0].textContent).toContain("先问：什么是导数？");
    expect(articles[1].textContent).toContain("再答：瞬时变化率。");

    expectIconButton(/新建对话/);
    expectIconButton(/重命名/);
    fireEvent.click(screen.getByRole("button", { name: "对话操作" }));
    expect(screen.getByRole("menuitem", { name: /导出对话/ })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: /删除对话/ })).not.toBeNull();
    expectIconButton(/编辑.*重传|编辑消息/);
    expectIconButton(/复制.*回答|复制消息/);
    expectIconButton("重新生成回答");
  });

  it("A1 reports generation without adding an independent empty assistant bubble", () => {
    const { container } = render(
      <ChatWorkspace
        {...chatProps({
          messages: [
            {
              id: "question-1",
              role: "user",
              content: "请继续",
              status: "complete",
            },
          ],
          generationStatus: "requesting",
        })}
      />,
    );

    const articles = Array.from(container.querySelectorAll("article"));
    expect(articles).toHaveLength(1);
    expect(articles[0].textContent).toContain("请继续");
    expect(articles[0].textContent ?? "").not.toMatch(
      /正在生成|正在思考|生成中/,
    );
    expect(container.querySelector("article:empty")).toBeNull();
  });

  it("A2 sends on Enter, preserves Shift+Enter newline, and never submits during IME composition", async () => {
    const onSend = vi.fn(async () => undefined);
    render(<ChatWorkspace {...chatProps({ onSend })} />);
    const textbox = screen.getByRole("textbox", {
      name: "输入消息",
    }) as HTMLTextAreaElement;
    fireEvent.input(textbox, { target: { value: "你好" } });

    fireEvent.keyDown(textbox, { key: "Enter", code: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.input(textbox, { target: { value: "你好\n世界" } });
    expect(textbox.value).toBe("你好\n世界");

    fireEvent.compositionStart(textbox);
    fireEvent.keyDown(textbox, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    fireEvent.compositionEnd(textbox);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("thread-1", "你好\n世界");
  });

  it("A2 replaces the send arrow in the same composer slot with one stop square", () => {
    const activeOwner = {
      conversationId: "thread-1",
      messageId: "assistant-generation-v13",
      runId: "run-generation-v13",
      sessionId: "session-generation-v13",
      status: "streaming",
      stoppable: true,
    } as const;
    const onStop = vi.fn();
    const props = chatProps({ onStop });
    const { rerender } = render(<ChatWorkspace {...props} />);
    const textbox = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.input(textbox, { target: { value: "继续" } });
    const composer = textbox.closest("form");
    expect(composer).not.toBeNull();
    const send = within(composer as HTMLElement).getByRole("button", {
      name: /发送/,
    });
    expect(send.querySelector("svg")).not.toBeNull();

    rerender(
      <ChatWorkspace
        {...props}
        activeGenerationRun={activeOwner}
        generationStatus="streaming"
        messages={[
          {
            content: "已确认的部分回答",
            id: activeOwner.messageId,
            role: "assistant",
            status: "streaming",
          },
        ]}
      />,
    );
    const sameComposer = screen
      .getByRole("textbox", { name: "输入消息" })
      .closest("form") as HTMLElement;
    const stops = screen.getAllByRole("button", { name: /停止生成/ });
    expect(stops).toHaveLength(1);
    expect(sameComposer.contains(stops[0])).toBe(true);
    expect(
      stops[0].querySelector("svg rect, svg path, svg polygon"),
    ).not.toBeNull();
    expect(
      within(sameComposer).queryByRole("button", { name: /发送/ }),
    ).toBeNull();
    fireEvent.click(stops[0]);
    expect(onStop).toHaveBeenCalledExactlyOnceWith(activeOwner);
  });

  it("A2 coalesces key repeat and consecutive clicks while the first send is pending", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onSend = vi.fn(() => pending);
    render(<ChatWorkspace {...chatProps({ onSend })} />);
    const textbox = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.input(textbox, { target: { value: "只发送一次" } });
    const button = screen.getByRole("button", { name: /发送/ });
    const composer = textbox.closest("form");
    expect(composer).not.toBeNull();

    fireEvent.submit(composer as HTMLFormElement);
    fireEvent.keyDown(textbox, { key: "Enter", code: "Enter", repeat: true });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);

    finish();
    await pending;
  });

  it("A3 renders only explicit non-empty Provider reasoning, folded and copied independently from the final answer", () => {
    const onCopyReasoning = vi.fn();
    const onCopyMessage = vi.fn();
    render(
      <ChatWorkspace
        {...chatProps({
          onCopyReasoning,
          onCopyMessage,
          messages: [
            {
              id: "with-reasoning",
              role: "assistant",
              reasoning: "先计算 $x^2$，再核对。",
              content: "最终答案是 4。",
              status: "complete",
            },
            {
              id: "empty-reasoning",
              role: "assistant",
              reasoning: "   \n ",
              content: "没有思考内容。",
              status: "complete",
            },
          ],
        })}
      />,
    );

    const details = Array.from(document.querySelectorAll("details"));
    expect(details).toHaveLength(1);
    expect(details[0].hasAttribute("open")).toBe(false);
    expect(
      within(details[0] as HTMLElement).getByText(/思考过程|推理过程/),
    ).not.toBeNull();
    expect(details[0].querySelector('[role="math"]')).not.toBeNull();

    // 对话回答只保留复制正文按钮；不再提供独立的思考过程复制按钮。
    expect(
      screen.queryByRole("button", { name: /复制思考|复制推理/ }),
    ).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", { name: /复制回答|复制消息/ })[0],
    );
    expect(onCopyMessage).toHaveBeenCalledWith("with-reasoning");
    expect(screen.getAllByText(/思考过程|推理过程/)).toHaveLength(1);
  });

  it("A3 gives the summary workspace the same explicit reasoning, folding, and separate copy boundary", () => {
    const onCopyReasoning = vi.fn();
    const onCopyContent = vi.fn();
    const base = insightProps({
      content: "总结结论",
      reasoning: "Provider 明确返回的思考",
      generationStatus: "streaming",
      phase: "running",
      onCopyReasoning,
      onCopyContent,
    });
    const { rerender } = render(<V13InsightWorkspace {...base} />);

    const reasoning = screen.getByRole("group", { name: /思考过程|推理过程/ });
    // 生成期间思维链默认展开，实时可见（完成后折叠）。
    expect(reasoning.hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /复制思考|复制推理/ }));
    fireEvent.click(screen.getByRole("button", { name: /复制总结|复制内容/ }));
    expect(onCopyReasoning).toHaveBeenCalledTimes(1);
    expect(onCopyContent).toHaveBeenCalledTimes(1);

    rerender(
      <V13InsightWorkspace
        {...base}
        generationStatus="cancelled"
        incomplete
        phase="ready"
      />,
    );
    expect(screen.getByText("Provider 明确返回的思考")).not.toBeNull();
    rerender(
      <V13InsightWorkspace
        {...base}
        generationStatus={undefined}
        phase="ready"
      />,
    );
    expect(screen.getByText("Provider 明确返回的思考")).not.toBeNull();
    // 完成后折叠，保留折叠边界。
    expect(
      screen
        .getByRole("group", { name: /思考过程|推理过程/ })
        .hasAttribute("open"),
    ).toBe(false);
  });
});

describe("v13 A4 shared Markdown/KaTeX contract", () => {
  it("renders dollar, parenthesized, bracketed, and multiline display delimiters with KaTeX", () => {
    const source = String.raw`行内 $a+b$ 与 \(c+d\)。

$$
e=f
$$

\[
\text{截图公式}\quad x\neq 0\Rightarrow y=1
\]`;
    const { container } = render(<Markdown text={source} />);
    const math = container.querySelectorAll('[role="math"]');
    expect(math).toHaveLength(4);
    expect(container.querySelectorAll(".katex")).toHaveLength(4);
    expect(container.textContent).toContain("截图公式");
  });

  it("does not interpret code, currency, or an unclosed streaming fragment as math", () => {
    const source = [
      "行内代码 `$not_math$`。",
      "",
      "```txt",
      "$$ fenced_not_math $$",
      "```",
      "价格是 $12.50，另一个价格是 US$8.00。",
      "流式片段尚未闭合：$x + y",
      String.raw`括号也未闭合：\(z + 1`,
    ].join("\n");
    const { container } = render(<Markdown text={source} />);
    expect(container.querySelectorAll('[role="math"]')).toHaveLength(0);
    expect(container.textContent).toContain("$not_math$");
    expect(container.textContent).toContain("$12.50");
    expect(container.textContent).toContain("$x + y");
  });

  it("keeps malformed formulas readable when the local KaTeX renderer declines them", () => {
    const source = String.raw`坏公式仍需保留：$\frac{1}{$`;
    const { container } = render(<Markdown text={source} />);
    expect(container.textContent).toContain(String.raw`\frac{1}{`);
    expect(container.textContent).not.toBe("");
  });
});
