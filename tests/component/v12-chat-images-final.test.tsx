import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatWorkspace,
  type ChatWorkspaceProps,
} from "../../src/ui/chat/chat-workspace";

afterEach(cleanup);

type ImageCapability = "supported" | "unknown" | "unsupported";
interface V12ChatProps extends ChatWorkspaceProps {
  readonly imageCapability?: ImageCapability;
}
const V12ChatWorkspace = ChatWorkspace as FunctionComponent<V12ChatProps>;

function props(overrides: Partial<V12ChatProps> = {}): V12ChatProps {
  return {
    activeThreadId: "thread-v12",
    attachments: [],
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
    threads: [{ id: "thread-v12", title: "图像对话" }],
    ...overrides,
  };
}

describe("v12 chat image final contract", () => {
  it("makes unknown image capability optimistic and explicitly observable instead of fail-closing before a provider attempt", () => {
    render(<V12ChatWorkspace {...props({ imageCapability: "unknown" })} />);

    expect(
      screen.getByText("图片能力未知：将按当前协议尝试发送。"),
    ).not.toBeNull();
  });

  it("shows queued images as thumbnail plus compact time and icon removal, not raw filenames as the primary UI", () => {
    render(
      <V12ChatWorkspace
        {...props({
          attachments: [
            {
              attachmentId: "image-1",
              currentTimeMs: 65_000,
              subtitleContextRevision: 1,
              subtitleId: "subtitle-1",
              videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              name: "private-original-name.png",
            },
            {
              attachmentId: "image-2",
              currentTimeMs: 125_000,
              subtitleContextRevision: 1,
              subtitleId: "subtitle-1",
              videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
              name: "another-name.webp",
            },
          ],
          onRemoveAttachment: vi.fn(),
        })}
      />,
    );

    const queued = screen.getByRole("list", { name: "待发送图片" });
    expect(queued.textContent).toContain("01:05");
    expect(queued.textContent).toContain("02:05");
    expect(queued.textContent).not.toContain("private-original-name.png");
    expect(screen.getByRole("button", { name: "移除图片 1" }).textContent).toBe(
      "",
    );
  });

  it("keeps a failed image-send draft and rejects remote provider image URLs rather than rendering a network-loaded output", () => {
    const onSend = vi.fn(() => false);
    render(
      <V12ChatWorkspace
        {...props({
          attachments: [
            {
              attachmentId: "remote",
              currentTimeMs: 0,
              name: "remote-output",
              subtitleContextRevision: 1,
              subtitleId: "subtitle-1",
              videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
            },
          ],
          imageCapability: "unknown",
          messages: [
            {
              attachments: [
                {
                  attachmentId: "remote-output",
                  currentTimeMs: 0,
                  subtitleContextRevision: 1,
                  subtitleId: "subtitle-1",
                  videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
                  name: "remote-output",
                  thumbnailUrl: "https://tracker.example/output.png",
                },
              ],
              content: "模型输出图片",
              id: "assistant-1",
              role: "assistant",
              status: "complete",
            },
          ],
          onSend,
        })}
      />,
    );

    fireEvent.input(screen.getByRole("textbox", { name: "输入消息" }), {
      target: { value: "保留这段草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement)
        .value,
    ).toBe("保留这段草稿");
    expect(screen.getByText("图片因安全校验未显示。")).not.toBeNull();
    expect(document.querySelector("img[src^='https://']")).toBeNull();
  });
});
