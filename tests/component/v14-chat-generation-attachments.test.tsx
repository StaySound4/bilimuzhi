import { readFile } from "node:fs/promises";

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
  canApplyGenerationRuntimeEvent,
  reconcileGenerationRunAfterBackgroundStart,
  type GenerationRuntimeEvent,
} from "../../src/application/generation-runtime-contract";
import { createGenerationRun } from "../../src/domain";
import {
  ChatWorkspace,
  type ChatActionResult,
  type ChatWorkspaceProps,
} from "../../src/ui/chat/chat-workspace";

afterEach(cleanup);

interface StoppableChatGenerationOwner {
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly status: "preparing" | "requesting" | "streaming";
  readonly stoppable: true;
}

interface V14ChatWorkspaceProps extends Omit<ChatWorkspaceProps, "onStop"> {
  readonly activeGenerationRun?: StoppableChatGenerationOwner | null;
  readonly onStop: (owner: StoppableChatGenerationOwner) => ChatActionResult;
}

const V14ChatWorkspace =
  ChatWorkspace as FunctionComponent<V14ChatWorkspaceProps>;

const threads = [{ id: "conversation-v14", title: "v14 验收对话" }] as const;

function props(
  overrides: Partial<V14ChatWorkspaceProps> = {},
): V14ChatWorkspaceProps {
  return {
    activeGenerationRun: null,
    activeThreadId: "conversation-v14",
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
    threads,
    ...overrides,
  };
}

describe("v14 A1 draft attachments and finished message bubbles", () => {
  it("renders the real safe thumbnail immediately in the pending queue", () => {
    render(
      <V14ChatWorkspace
        {...props({
          attachments: [
            {
              attachmentId: "draft-image-v14",
              currentTimeMs: 16_000,
              subtitleContextRevision: 1,
              subtitleId: "subtitle-1",
              videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              name: "private-source-name.png",
              thumbnailUrl: "blob:muzhi-v14-draft-thumbnail",
            },
          ],
        })}
      />,
    );

    const thumbnail = screen.getByRole("img", { name: "待发送图片 1" });
    expect(thumbnail.getAttribute("src")).toBe(
      "blob:muzhi-v14-draft-thumbnail",
    );
    expect(
      document.querySelector(".muzhi-chat__attachment-preview"),
    ).toBeNull();
  });

  it("projects a staged thumbnail Blob through the real SidePanel draft composition", async () => {
    const source = await readFile("src/entries/sidepanel.tsx", "utf8");
    const start = source.indexOf(
      "const staged = await attachmentRepository.stageImages",
    );
    const end = source.indexOf("onClearAttachments:", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const productionProjection = source.slice(start, end);

    expect(productionProjection).toMatch(
      /URL\.createObjectURL\(\s*attachment\.thumbnailBlob\s*,?\s*\)/u,
    );
    expect(productionProjection).toMatch(/thumbnailUrl/u);
  });

  it("uses one compact clock for the same pending and sent attachment time", () => {
    const { container } = render(
      <V14ChatWorkspace
        {...props({
          attachments: [
            {
              attachmentId: "pending-at-1137s",
              currentTimeMs: 1_137_000,
              subtitleContextRevision: 1,
              subtitleId: "subtitle-1",
              videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              name: "pending.png",
              thumbnailUrl: "blob:muzhi-v14-pending",
            },
          ],
          messages: [
            {
              attachments: [
                {
                  attachmentId: "sent-at-1137s",
                  currentTimeMs: 1_137_000,
                  subtitleContextRevision: 1,
                  subtitleId: "subtitle-1",
                  videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
                  name: "已发送图片",
                  thumbnailUrl: "blob:muzhi-v14-sent",
                },
              ],
              content: "同一业务时间",
              id: "message-with-image-v14",
              role: "user",
              status: "complete",
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByText("18:57")).toHaveLength(2);
    expect(container.textContent).not.toContain("1137s");
  });

  it("removes visible role titles while retaining accurate accessible message semantics", () => {
    const { container } = render(
      <V14ChatWorkspace
        {...props({
          messages: [
            {
              content: "用户正文",
              id: "user-message-v14",
              role: "user",
              status: "complete",
            },
            {
              content: "助手正文",
              id: "assistant-message-v14",
              role: "assistant",
              status: "complete",
            },
          ],
        })}
      />,
    );

    const question = screen.getByRole("article", { name: "问题" });
    const answer = screen.getByRole("article", { name: "回答" });
    expect(within(question).getByText("用户正文")).not.toBeNull();
    expect(within(answer).getByText("助手正文")).not.toBeNull();
    expect(container.querySelector(".muzhi-chat__message-label")).toBeNull();
    expect(within(question).queryByText("你", { exact: true })).toBeNull();
    expect(within(answer).queryByText("Bilimuzhi", { exact: true })).toBeNull();
  });

  it("does not retain the legacy blue start border on the user bubble", async () => {
    const stylesheet = await readFile("src/ui/chat/chat-workspace.css", "utf8");
    const userRule =
      stylesheet.match(/\.muzhi-chat__message--user\s*\{[^}]*\}/u)?.[0] ?? "";

    expect(userRule).not.toBe("");
    expect(userRule).not.toMatch(
      /border-(?:inline-start|left)\s*:\s*[^;]*(?:accent|blue|#[0-9a-f]{3,8})/iu,
    );
  });
});

describe("v14 A2 current GenerationRun is the only stop authority", () => {
  const activeOwner: StoppableChatGenerationOwner = Object.freeze({
    conversationId: "conversation-v14",
    messageId: "assistant-generation-v14",
    runId: "run-v14",
    sessionId: "session-v14",
    status: "streaming",
    stoppable: true,
  });

  it("passes the exact current run, session, conversation, and message owner when stopping", () => {
    const onStop = vi.fn();
    render(
      <V14ChatWorkspace
        {...props({
          activeGenerationRun: activeOwner,
          generationStatus: "streaming",
          messages: [
            {
              content: "已确认的部分正文",
              id: activeOwner.messageId,
              role: "assistant",
              status: "streaming",
            },
          ],
          onStop,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onStop).toHaveBeenCalledExactlyOnceWith(activeOwner);
  });

  it("fails closed on an orphan persisted streaming message and restores the send arrow", () => {
    const onStop = vi.fn();
    render(
      <V14ChatWorkspace
        {...props({
          activeGenerationRun: null,
          messages: [
            {
              content: "侧栏恢复前已确认的正文",
              id: "orphan-streaming-message",
              role: "assistant",
              status: "streaming",
            },
          ],
          onStop,
        })}
      />,
    );

    fireEvent.input(screen.getByRole("textbox", { name: "输入消息" }), {
      target: { value: "恢复后仍可继续发送" },
    });
    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
    expect(screen.getByRole("button", { name: "发送消息" })).not.toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("returns to the send action after the owned run completes", () => {
    const base = props({
      activeGenerationRun: activeOwner,
      generationStatus: "streaming",
      messages: [
        {
          content: "生成中",
          id: activeOwner.messageId,
          role: "assistant",
          status: "streaming",
        },
      ],
    });
    const view = render(<V14ChatWorkspace {...base} />);
    expect(screen.getByRole("button", { name: "停止生成" })).not.toBeNull();

    view.rerender(
      <V14ChatWorkspace
        {...props({
          activeGenerationRun: null,
          messages: [
            {
              content: "生成完成",
              id: activeOwner.messageId,
              role: "assistant",
              status: "complete",
            },
          ],
        })}
      />,
    );
    fireEvent.input(screen.getByRole("textbox", { name: "输入消息" }), {
      target: { value: "下一条" },
    });

    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
    expect(screen.getByRole("button", { name: "发送消息" })).not.toBeNull();
  });

  it("reconciles a lost executor as interrupted and rejects wrong-owner or late chunks", () => {
    const active = createGenerationRun({
      branchId: "branch-v14",
      browserSessionId: "browser-before-reload",
      completionSequence: null,
      contextRevision: 7,
      createdAt: 1,
      errorCode: null,
      expectedOwnerRevision: 3,
      kind: "chat",
      partialOutput: "已确认正文",
      runId: "run-v14-runtime",
      sessionId: "session-v14",
      status: "streaming",
      stopReason: null,
      subtitleId: "subtitle-v14",
      targetId: "conversation-v14",
      taskId: "task-v14",
      updatedAt: 2,
    });
    const currentChunk: GenerationRuntimeEvent = {
      branchId: active.branchId,
      contextRevision: active.contextRevision,
      expectedOwnerRevision: active.expectedOwnerRevision,
      kind: active.kind,
      payload: { delta: " current" },
      protocolVersion: 1,
      requestId: "request-current-v14",
      sessionId: active.sessionId,
      subtitleId: active.subtitleId,
      targetId: active.targetId,
      taskId: active.taskId,
      type: "muzhi.generation.delta",
    };
    const wrongOwnerChunk: GenerationRuntimeEvent = {
      ...currentChunk,
      requestId: "request-wrong-owner-v14",
      sessionId: "session-other-v14",
    };
    const reconciled = reconcileGenerationRunAfterBackgroundStart(active, {
      browserSessionId: "browser-after-reload",
      hasLiveExecutor: false,
      now: 3,
    });

    expect(canApplyGenerationRuntimeEvent(active, currentChunk)).toBe(true);
    expect(canApplyGenerationRuntimeEvent(active, wrongOwnerChunk)).toBe(false);
    expect(reconciled).toMatchObject({
      partialOutput: "已确认正文",
      status: "interrupted",
    });
    expect(canApplyGenerationRuntimeEvent(reconciled, currentChunk)).toBe(
      false,
    );
  });
});

describe("v14 A7 compact generated time links", () => {
  it("renders every compact marker as an accessible seek control and uses a range start", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <V14ChatWorkspace
        {...props({
          messages: [
            {
              content: "[16s] [3m48s] [01:02:03] [05:38–06:45] [7m46s]",
              id: "compact-markers-v14",
              role: "assistant",
              status: "complete",
            },
          ],
          onSeek,
          subtitleRows: [
            {
              endMs: 3_800_000,
              startMs: 0,
              text: "覆盖这些标记的当前字幕",
            },
          ],
          timeLinkScope: {
            activeVideoKey: "bvid:BV1V14:cid:14:p:1",
            subtitleVideoKey: "bvid:BV1V14:cid:14:p:1",
          },
        })}
      />,
    );

    const controls = container.querySelectorAll(
      ".muzhi-markdown__time-link[aria-label^='跳转到']",
    );
    expect(controls).toHaveLength(5);
    expect(screen.getByLabelText("跳转到 00:16")).not.toBeNull();
    expect(screen.getByLabelText("跳转到 03:48")).not.toBeNull();
    expect(screen.getByLabelText("跳转到 01:02:03")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("跳转到 05:38–06:45"));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(338);
  });
});
