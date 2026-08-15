import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionComponent } from "preact";

import {
  ChatWorkspace,
  type ChatWorkspaceProps,
} from "../../src/ui/chat/chat-workspace";

interface V11ChatWorkspaceProps extends Omit<ChatWorkspaceProps, "messages"> {
  readonly attachments: NonNullable<ChatWorkspaceProps["attachments"]>;
  readonly supportsImageAttachments: boolean;
  readonly messages: readonly (ChatWorkspaceProps["messages"][number] & {
    readonly attachments?: NonNullable<
      ChatWorkspaceProps["messages"][number]["attachments"]
    >;
  })[];
  readonly subtitleRows?: readonly {
    readonly endMs: number;
    readonly startMs: number;
    readonly text: string;
  }[];
}

const V11ChatWorkspace =
  ChatWorkspace as FunctionComponent<V11ChatWorkspaceProps>;

afterEach(cleanup);

const threads = [
  { id: "thread-1", title: "字幕问答" },
  { id: "thread-2", title: "第二个对话" },
] as const;

function props(
  overrides: Partial<ChatWorkspaceProps> = {},
): ChatWorkspaceProps {
  return {
    activeThreadId: "thread-1",
    messages: [],
    threads,
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
    ...overrides,
  };
}

describe("ChatWorkspace", () => {
  it("提示模型可能不支持图片，但仍按协议尝试发送并保留草稿（Provider 最终裁决）", () => {
    const value = props();
    render(
      <V11ChatWorkspace
        {...value}
        attachments={[
          {
            attachmentId: "attachment-image-1",
            currentTimeMs: 12_000,
            subtitleContextRevision: 1,
            subtitleId: "subtitle-1",
            videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
            name: "whiteboard.png",
          },
        ]}
        supportsImageAttachments={false}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "输入消息",
    }) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "解释这张图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(value.onSend).toHaveBeenCalledWith("thread-1", "解释这张图", [
      "attachment-image-1",
    ]);
    expect(input.value).toBe("");
    expect(screen.getByText("whiteboard.png")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/模型可能不支持图片/);
  });

  it("preserves the message draft until sending succeeds", async () => {
    const rejected = props({ onSend: vi.fn(() => false) });
    const view = render(<ChatWorkspace {...rejected} />);
    const input = screen.getByRole("textbox", {
      name: "输入消息",
    }) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "不要丢失的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(input.value).toBe("不要丢失的草稿");

    let finish: ((value: boolean) => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    view.rerender(<ChatWorkspace {...props({ onSend })} />);
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(screen.getByRole("button", { name: "发送中…" })).not.toBeNull();
    expect(input.value).toBe("不要丢失的草稿");
    finish?.(true);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("keeps thread selection, streaming body and reasoning separate", () => {
    const value = props({
      messages: [
        {
          content: "正在生成正文",
          id: "assistant-1",
          reasoning: "先比对字幕时间范围",
          role: "assistant",
          status: "streaming",
        },
      ],
    });
    render(<ChatWorkspace {...value} />);
    fireEvent.input(screen.getByRole("combobox", { name: "选择对话" }), {
      target: { value: "thread-2" },
    });
    expect(value.onSelectThread).toHaveBeenCalledWith("thread-2");
    const answer = screen.getByRole("article", { name: "回答" });
    const body = screen.getByRole("status");
    const reasoning = screen.getByText("推理过程").closest("details");
    expect(answer.contains(body)).toBe(true);
    expect(body.textContent).toContain("正在生成正文");
    expect(body.textContent).not.toContain("先比对字幕时间范围");
    expect(reasoning?.textContent).toContain("先比对字幕时间范围");
    expect(reasoning?.textContent).not.toContain("正在生成正文");
    expect(screen.getByText("推理过程")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
    expect(screen.getByRole("button", { name: "发送消息" })).not.toBeNull();
    expect(value.onStop).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "复制回答" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it.each([
    ["preparing", "正在准备"],
    ["requesting", "正在请求模型"],
    ["streaming", "正在生成回答"],
    ["validating", "正在校验回答"],
    ["saving", "正在保存回答"],
  ] as const)(
    "keeps the persisted %s phase visible but fail-closes stop without a current run",
    (generationStatus, label) => {
      const value = props();
      const view = render(
        <ChatWorkspace {...value} generationStatus={generationStatus} />,
      );

      const status = screen.getByRole("status");
      expect(status.textContent).toContain(label);
      expect(status.querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(status.getAttribute("data-generation-active")).toBe("true");
      expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
      expect(screen.getByRole("button", { name: "发送消息" })).not.toBeNull();
      expect(value.onStop).not.toHaveBeenCalled();
      expect(view.container.textContent).not.toContain("未在输出");
    },
  );

  it("publishes thread management and mutation confirmation metadata", () => {
    const value = props({
      messages: [
        {
          content: "原问题",
          followingTurnCount: 2,
          id: "user-1",
          role: "user",
          status: "complete",
        },
        {
          content: "回答",
          followingTurnCount: 1,
          id: "assistant-1",
          role: "assistant",
          status: "complete",
        },
        {
          content: "失败",
          id: "assistant-2",
          role: "assistant",
          status: "failed",
        },
      ],
    });
    render(<ChatWorkspace {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名对话" }));
    fireEvent.click(screen.getByRole("button", { name: "对话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出对话" }));
    fireEvent.click(screen.getByRole("button", { name: "对话操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除对话" }));
    expect(value.onCreateThread).toHaveBeenCalledOnce();
    expect(value.onRenameThread).toHaveBeenCalledWith("thread-1");
    expect(value.onExportThread).toHaveBeenCalledWith("thread-1");
    expect(value.onDeleteThread).toHaveBeenCalledWith("thread-1");
    fireEvent.click(screen.getByRole("button", { name: "重新生成回答" }));
    expect(value.onRequestMessageMutation).toHaveBeenCalledWith({
      content: undefined,
      deletedTurnCount: 1,
      kind: "regenerate",
      messageId: "assistant-1",
      requiresConfirmation: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑并重传问题" }));
    fireEvent.input(screen.getByRole("textbox", { name: "编辑消息" }), {
      target: { value: " 新问题 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "重传消息" }));
    expect(value.onRequestMessageMutation).toHaveBeenCalledWith({
      content: "新问题",
      deletedTurnCount: 2,
      kind: "edit-and-resend",
      messageId: "user-1",
      requiresConfirmation: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试回答" }));
    expect(value.onRetryMessage).toHaveBeenCalledWith("assistant-2");
  });

  it("隐藏无正文/推理/附件/失败信息的空助手占位，不渲染空气泡操作", () => {
    render(
      <ChatWorkspace
        {...props({
          messages: [
            {
              content: "",
              id: "assistant-empty",
              role: "assistant",
              status: "complete",
            },
            {
              content: "实际回答",
              id: "assistant-real",
              role: "assistant",
              status: "complete",
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByRole("article", { name: "回答" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "复制回答" })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "重新生成回答" }),
    ).toHaveLength(1);
  });

  it("用户消息同时提供复制、按原输入重来和既有编辑操作", () => {
    const value = props({
      messages: [
        {
          content: "本字幕内容讲了什么",
          followingTurnCount: 0,
          id: "user-action",
          role: "user",
          status: "complete",
        },
      ],
    });
    render(<ChatWorkspace {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "复制问题" }));
    expect(value.onCopyMessage).toHaveBeenCalledWith("user-action");
    fireEvent.click(screen.getByRole("button", { name: "按原问题重新生成" }));
    expect(value.onRequestMessageMutation).toHaveBeenCalledWith({
      content: "本字幕内容讲了什么",
      deletedTurnCount: 0,
      kind: "edit-and-resend",
      messageId: "user-action",
      requiresConfirmation: false,
    });
    expect(
      screen.getByRole("button", { name: "编辑并重传问题" }),
    ).not.toBeNull();
  });

  it("带附件的历史问题不显示会丢失附件的按原问题重新生成操作", () => {
    render(
      <ChatWorkspace
        {...props({
          messages: [
            {
              attachments: [
                {
                  attachmentId: "attached-replay-guard",
                  currentTimeMs: 1_000,
                  name: "截图.png",
                  subtitleContextRevision: 1,
                  subtitleId: "subtitle-1",
                  thumbnailUrl: "blob:attached-replay-guard",
                  videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
                },
              ],
              content: "结合图片回答",
              id: "user-with-replay-attachment",
              role: "user",
              status: "complete",
            },
          ],
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "按原问题重新生成" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "编辑并重传问题" }),
    ).not.toBeNull();
  });

  it("turns only complete, real-subtitle streaming markers into seek actions", () => {
    const onSeek = vi.fn();
    render(
      <V11ChatWorkspace
        {...props({
          messages: [
            {
              content: "有效 [00:05]，越界 [00:09]，未闭合 [00:",
              id: "assistant-streaming-time",
              role: "assistant",
              status: "streaming",
            },
          ],
          onSeek,
        })}
        attachments={[]}
        subtitleRows={[{ endMs: 7_000, startMs: 5_000, text: "真实字幕行" }]}
        supportsImageAttachments
        timeLinkScope={{
          activeVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
          subtitleVideoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "跳转到 00:05" }));
    expect(onSeek).toHaveBeenCalledWith(5);
    expect(screen.queryByRole("button", { name: "跳转到 00:09" })).toBeNull();
    expect(screen.getByText("[00:", { exact: false })).not.toBeNull();
  });

  it("renders reopened bound attachments as safe thumbnails with exact seek links", () => {
    const onSeekAttachment = vi.fn();
    render(
      <V11ChatWorkspace
        {...props({ onSeekAttachment })}
        attachments={[]}
        messages={[
          {
            attachments: [
              {
                attachmentId: "attachment-safe",
                currentTimeMs: 12_345,
                subtitleContextRevision: 1,
                subtitleId: "subtitle-1",
                videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
                name: "whiteboard.png",
                thumbnailUrl: "blob:muzhi-safe-thumbnail",
              },
              {
                attachmentId: "attachment-unsafe",
                currentTimeMs: 20_000,
                subtitleContextRevision: 1,
                subtitleId: "subtitle-1",
                videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
                name: "unsafe.png",
                thumbnailUrl: "data:text/html,<script>alert(1)</script>",
              },
            ],
            content: "请看这两张图",
            id: "user-with-images",
            role: "user",
            status: "complete",
          },
        ]}
        supportsImageAttachments
      />,
    );

    const thumbnail = screen.getByRole("img", { name: "whiteboard.png" });
    expect(thumbnail.getAttribute("src")).toBe("blob:muzhi-safe-thumbnail");
    expect(screen.queryByRole("img", { name: "unsafe.png" })).toBeNull();
    expect(document.querySelector('img[src^="data:"]')).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "跳转到图片时间 00:12" }),
    );
    expect(onSeekAttachment).toHaveBeenCalledWith({
      currentTimeMs: 12_345,
      subtitleContextRevision: 1,
      subtitleId: "subtitle-1",
      videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
    });
  });

  it("去重渲染同 messageId 的重复消息，杜绝双气泡", () => {
    render(
      <ChatWorkspace
        {...props({
          messages: [
            {
              content: "问题",
              id: "user-dup",
              role: "user",
              status: "complete",
            },
            {
              content: "回答一",
              id: "assistant-dup",
              reasoning: "第一份思考",
              role: "assistant",
              status: "complete",
            },
            {
              content: "回答一（重复）",
              id: "assistant-dup",
              reasoning: "第二份思考",
              role: "assistant",
              status: "complete",
            },
          ],
        })}
      />,
    );
    // 同一 messageId 只渲染一个气泡（保留最后一条）。
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("回答一（重复）")).not.toBeNull();
    expect(screen.queryByText("回答一")).toBeNull();
  });

  it("blocks sending while an assistant message is still streaming and explains why", () => {
    const onSend = vi.fn();
    render(
      <ChatWorkspace
        {...props({
          messages: [
            {
              content: "正在回答",
              id: "assistant-streaming",
              reasoning: "思考中",
              role: "assistant",
              status: "streaming",
            },
          ],
          onSend,
        })}
      />,
    );
    fireEvent.input(screen.getByRole("textbox", { name: "输入消息" }), {
      target: { value: "第二句话" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(
      screen.getByText("上一条回复还在生成中，请等待完成或点击停止后再发送。"),
    ).not.toBeNull();
  });

  it("失败且有部分输出的消息渲染失败投影与「不完整」标记（冻结契约）", () => {
    render(
      <ChatWorkspace
        {...props({
          messages: [
            {
              content: "写到一半的回答",
              failure: {
                action: "检查网络连接后重试",
                code: "NETWORK_ERROR",
                incomplete: true,
                placement: "chat-message",
                preservePartial: true,
                preservePreviousArtifact: false,
                retryable: true,
              },
              id: "assistant-failed-partial",
              incomplete: true,
              role: "assistant",
              status: "failed",
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText("NETWORK_ERROR：检查网络连接后重试。"),
    ).not.toBeNull();
    expect(screen.getByText("不完整：已保留确认的部分输出。")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /重试/ })).toHaveLength(1);
  });

  it("附件时间文本复用公共时钟格式（01:05 / 01:02:03）", () => {
    const onSeekAttachment = vi.fn();
    render(
      <V11ChatWorkspace
        {...props({ onSeekAttachment })}
        attachments={[]}
        messages={[
          {
            attachments: [
              {
                attachmentId: "attachment-600:05",
                currentTimeMs: 65_000,
                name: "a.png",
                subtitleContextRevision: 1,
                subtitleId: "subtitle-1",
                thumbnailUrl: "blob:safe",
                videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              },
              {
                attachmentId: "attachment-3723s",
                currentTimeMs: 3_723_000,
                name: "b.png",
                subtitleContextRevision: 1,
                subtitleId: "subtitle-1",
                thumbnailUrl: "blob:safe",
                videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              },
            ],
            content: "看图",
            id: "user-time-format",
            role: "user",
            status: "complete",
          },
        ]}
        supportsImageAttachments
      />,
    );
    expect(
      screen.getByRole("button", { name: "跳转到图片时间 01:05" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "跳转到图片时间 01:02:03" }),
    ).not.toBeNull();
  });
  it("renders the per-mode task model picker above the composer with the persisted selection", () => {
    render(
      <ChatWorkspace
        activeThreadId="t1"
        messages={[]}
        onSelectThread={() => true}
        onCreateThread={() => true}
        onRenameThread={() => true}
        onDeleteThread={() => true}
        onExportThread={() => {}}
        onSend={() => true}
        onStop={() => true}
        onCopyMessage={() => {}}
        onRetryMessage={() => true}
        onRequestMessageMutation={() => true}
        threads={[{ id: "t1", title: "线程" }]}
        taskModelProfiles={[
          {
            id: "profile-alpha",
            name: "配置1",
            models: [
              {
                enabled: true,
                id: "alpha-chat",
                label: "Alpha Chat",
                reasoningEfforts: ["low", "high"],
              },
            ],
          },
        ]}
        taskModelSelection={{
          modelId: "alpha-chat",
          profileId: "profile-alpha",
          reasoningEffort: "low",
          state: "ready",
        }}
        onTaskModelChange={vi.fn()}
      />,
    );
    // Ticket 11：模型配置在 secondary inspector 内（先展开）。
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(
      (screen.getByLabelText("对话模型提供商") as HTMLSelectElement).value,
    ).toBe("profile-alpha");
    expect(
      (screen.getByLabelText("对话模型配置") as HTMLSelectElement).value,
    ).toBe("alpha-chat");
    expect(
      (screen.getByLabelText("对话模型推理强度") as HTMLSelectElement).value,
    ).toBe("low");
  });

  it("shows a one-line context strip with model/language summary and toggles the inspector", () => {
    render(
      <ChatWorkspace
        activeThreadId="t1"
        messages={[]}
        onSelectThread={() => true}
        onCreateThread={() => true}
        onRenameThread={() => true}
        onDeleteThread={() => true}
        onExportThread={() => {}}
        onSend={() => true}
        onStop={() => true}
        onCopyMessage={() => {}}
        onRetryMessage={() => true}
        onRequestMessageMutation={() => true}
        outputLanguageLocked
        threads={[{ id: "t1", title: "线程" }]}
        taskModelProfiles={[
          {
            id: "profile-alpha",
            name: "配置1",
            models: [
              {
                enabled: true,
                id: "alpha-chat",
                label: "Alpha",
                reasoningEfforts: ["low", "high"],
              },
            ],
          },
        ]}
        taskModelSelection={{
          modelId: "alpha-chat",
          profileId: "profile-alpha",
          reasoningEffort: "low",
          state: "ready",
        }}
        onTaskModelChange={vi.fn()}
      />,
    );
    // 折叠时一行摘要：模型 + 语言锁定。
    const summary = document.querySelector(".muzhi-task-context__summary");
    expect(summary?.textContent).toContain("配置1");
    expect(summary?.textContent).toContain("Alpha");
    expect(summary?.textContent).toContain("低");
    expect(summary?.textContent).toContain("中文（简体）");
    expect(summary?.textContent).not.toContain("alpha-chat");
    expect(summary?.textContent).toContain("语言已锁定");
    expect(screen.queryByLabelText("对话模型提供商")).toBeNull();
    // Configure 展开后四项控制可达。
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(screen.getByLabelText("对话模型提供商")).not.toBeNull();
    expect(screen.getByLabelText("对话模型配置")).not.toBeNull();
    expect(screen.getByLabelText("对话模型推理强度")).not.toBeNull();
  });
});

it.each([
  ["no-video", "尚未选择视频"],
  ["no-subtitle", "尚无字幕"],
  ["ready", "暂无对话消息"],
] as const)(
  "renders the explicit %s business empty state",
  (availability, title) => {
    render(
      <ChatWorkspace
        availability={availability}
        activeThreadId="thread-1"
        messages={[]}
        threads={[{ id: "thread-1", title: "对话" }]}
        onSelectThread={vi.fn()}
        onCreateThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onExportThread={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onCopyMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        onRequestMessageMutation={vi.fn()}
      />,
    );
    expect(screen.getByText(title)).not.toBeNull();
  },
);

it("projects task model save pending and error into the collapsed inspector", () => {
  const onTaskModelChange = vi.fn();
  const base = props({
    taskModelProfiles: [
      {
        id: "profile-alpha",
        name: "配置1",
        models: [
          {
            enabled: true,
            id: "alpha-chat",
            label: "Alpha",
            reasoningEfforts: ["low"],
          },
        ],
      },
    ],
    taskModelSelection: {
      modelId: "alpha-chat",
      profileId: "profile-alpha",
      reasoningEffort: "low",
      state: "needs-reselection",
    },
    onTaskModelChange,
    taskContextPending: true,
  });
  const view = render(<ChatWorkspace {...base} />);

  expect(
    document.querySelector(".muzhi-task-context__status")?.textContent,
  ).toContain("正在保存任务模型选择");
  fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
  expect(screen.getByLabelText("对话模型提供商")).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByLabelText("对话模型配置")).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByLabelText("对话模型推理强度")).toHaveProperty(
    "disabled",
    true,
  );

  view.rerender(
    <ChatWorkspace
      {...base}
      taskContextError="任务模型保存失败"
      taskContextPending={false}
    />,
  );
  expect(
    document.querySelector(".muzhi-task-context__status")?.textContent,
  ).toContain("任务模型保存失败");
  expect(screen.getByRole("alert").textContent).toContain("任务模型保存失败");
});
