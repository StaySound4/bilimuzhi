import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown, type MarkdownProps } from "../../src/ui/markdown";

interface RemoteMarkdownImageRequest {
  readonly alt: string;
  readonly url: string;
}

interface RemoteMarkdownImageResult {
  /** A local object URL created only from a validated, persisted local Blob. */
  readonly objectUrl: `blob:${string}`;
}

interface RemoteMarkdownProps extends MarkdownProps {
  readonly onLoadRemoteImage: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
}

const RemoteMarkdown = Markdown as FunctionComponent<RemoteMarkdownProps>;

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("v12 remote Markdown image consent and local rendering (A9/A13)", () => {
  it("renders an accessible click-to-load placeholder without creating an img, link, or request", () => {
    const remoteUrl = "https://images.example.test/generated/one.png";
    const onLoadRemoteImage = vi.fn<RemoteMarkdownProps["onLoadRemoteImage"]>();
    const { container } = render(
      <RemoteMarkdown
        onLoadRemoteImage={onLoadRemoteImage}
        text={`生成结果：![远程示例](${remoteUrl})`}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(`a[href="${remoteUrl}"]`)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "点击加载图片：远程示例" })
        .hasAttribute("hidden"),
    ).toBe(false);
    expect(onLoadRemoteImage).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain(remoteUrl);
  });

  it("invokes the authorized loader at most once while pending and displays only its local Blob URL", async () => {
    const remoteUrl = "https://images.example.test/generated/one.png";
    const loading = deferred<RemoteMarkdownImageResult>();
    const onLoadRemoteImage = vi.fn(async () => loading.promise);
    const { container } = render(
      <RemoteMarkdown
        onLoadRemoteImage={onLoadRemoteImage}
        text={`![生成图](${remoteUrl})`}
      />,
    );
    const button = screen.getByRole("button", {
      name: "点击加载图片：生成图",
    });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onLoadRemoteImage).toHaveBeenCalledOnce();
    expect(onLoadRemoteImage).toHaveBeenCalledWith({
      alt: "生成图",
      url: remoteUrl,
    });
    expect(
      (
        screen.getByRole("button", {
          name: "正在加载图片：生成图",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    loading.resolve({ objectUrl: "blob:https://extension.test/local-image" });
    const image = await screen.findByRole("img", { name: "生成图" });
    expect(image.getAttribute("src")).toBe(
      "blob:https://extension.test/local-image",
    );
    expect(container.querySelector(`a[href="${remoteUrl}"]`)).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);
  });

  it("keeps a retryable local placeholder after permission denial without exposing the remote URL", async () => {
    const remoteUrl =
      "https://private-provider.example.test/generated.png?token=do-not-display";
    const onLoadRemoteImage = vi
      .fn<RemoteMarkdownProps["onLoadRemoteImage"]>()
      .mockRejectedValueOnce({ code: "PERMISSION_DENIED", retryable: true })
      .mockResolvedValueOnce({
        objectUrl: "blob:https://extension.test/retried-image",
      });
    const { container } = render(
      <RemoteMarkdown
        onLoadRemoteImage={onLoadRemoteImage}
        text={`![需授权图片](${remoteUrl})`}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "点击加载图片：需授权图片" }),
    );

    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "重试加载图片：需授权图片",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "图片加载失败，可重试。",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(container.textContent).not.toContain("do-not-display");

    fireEvent.click(
      screen.getByRole("button", { name: "重试加载图片：需授权图片" }),
    );
    expect(onLoadRemoteImage).toHaveBeenCalledTimes(2);
    expect(
      (await screen.findByRole("img", { name: "需授权图片" })).getAttribute(
        "src",
      ),
    ).toBe("blob:https://extension.test/retried-image");
  });

  it("keeps a retryable placeholder after download/validation failure without rendering a remote img", async () => {
    const remoteUrl = "https://images.example.test/disguised-html.png";
    const onLoadRemoteImage = vi
      .fn<RemoteMarkdownProps["onLoadRemoteImage"]>()
      .mockRejectedValue({
        code: "IMAGE_OUTPUT_REJECTED",
        rawResponse: "<!doctype html><script>alert(1)</script>",
        retryable: true,
        url: remoteUrl,
      });
    const { container } = render(
      <RemoteMarkdown
        onLoadRemoteImage={onLoadRemoteImage}
        text={`![伪装图片](${remoteUrl})`}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "点击加载图片：伪装图片" }),
    );

    await screen.findByRole("button", { name: "重试加载图片：伪装图片" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(container.textContent).not.toMatch(/doctype|script|alert/);
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["arbitrary data", "data:image/png;base64,UE5H"],
    ["SVG data", "data:image/svg+xml,<svg onload='alert(1)'/>"],
    ["file", "file:///private/image.png"],
    ["blob", "blob:https://provider.example.test/untrusted"],
    ["explicit SVG", "https://images.example.test/vector.svg"],
  ])(
    "does not offer a loader or create an img for a %s Markdown source",
    (_label, source) => {
      const onLoadRemoteImage =
        vi.fn<RemoteMarkdownProps["onLoadRemoteImage"]>();
      const { container } = render(
        <RemoteMarkdown
          onLoadRemoteImage={onLoadRemoteImage}
          text={`危险：![不可加载](${source})`}
        />,
      );

      expect(container.querySelector("img")).toBeNull();
      expect(screen.queryByRole("button", { name: /加载图片/ })).toBeNull();
      expect(onLoadRemoteImage).not.toHaveBeenCalled();
      expect(container.querySelector("[onerror], [onclick]")).toBeNull();
    },
  );
});
