import { describe, expect, it, vi } from "vitest";

import {
  createChromeRemoteMarkdownImageRuntimeClient,
  installChromeRemoteMarkdownImageRuntimeListener,
  type RemoteMarkdownImageProcessor,
} from "../../src/infrastructure/chrome-remote-markdown-image-runtime";

type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function safeProcessedImage() {
  return {
    blob: new Blob([pngBytes], { type: "image/png" }),
    height: 1,
    mimeType: "image/png" as const,
    thumbnailBlob: new Blob([pngBytes], { type: "image/png" }),
    width: 1,
  };
}

function runtimeHarness(processImage: RemoteMarkdownImageProcessor) {
  let listener: RuntimeMessageListener | undefined;
  const responses: unknown[] = [];
  const chromeValue = {
    runtime: {
      onMessage: {
        addListener: vi.fn((value: RuntimeMessageListener) => {
          listener = value;
        }),
      },
      sendMessage: vi.fn(
        (message: unknown) =>
          new Promise<unknown>((resolve, reject) => {
            if (listener === undefined) {
              reject(new Error("runtime listener is not installed"));
              return;
            }
            const accepted = listener(message, {}, (response) => {
              responses.push(response);
              resolve(response);
            });
            if (!accepted) {
              reject(new Error("runtime listener rejected the command"));
            }
          }),
      ),
    },
  };
  installChromeRemoteMarkdownImageRuntimeListener(chromeValue, processImage);
  return { chromeValue, responses };
}

function forbiddenEnvelopeParts(value: unknown): string[] {
  const violations: string[] = [];
  const visited = new Set<object>();

  function inspect(current: unknown, path: string): void {
    if (current instanceof Blob) {
      violations.push(`${path}:Blob`);
      return;
    }
    if (current instanceof ArrayBuffer || ArrayBuffer.isView(current)) {
      violations.push(`${path}:raw-bytes`);
      return;
    }
    if (typeof current === "string") {
      if (/^(?:https?:|blob:|data:)/i.test(current)) {
        violations.push(`${path}:url`);
      }
      return;
    }
    if (typeof current !== "object" || current === null) return;
    if (visited.has(current)) return;
    visited.add(current);
    if (
      Array.isArray(current) &&
      current.length > 0 &&
      current.every(
        (part) =>
          typeof part === "number" &&
          Number.isInteger(part) &&
          part >= 0 &&
          part <= 255,
      )
    ) {
      violations.push(`${path}:raw-byte-array`);
      return;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (/^(?:url|base64|bytes?|raw|error)$/i.test(key)) {
        violations.push(`${path}.${key}:forbidden-field`);
      }
      inspect(nested, `${path}.${key}`);
    }
  }

  inspect(value, "$response");
  return violations;
}

describe("v12 remote Markdown image SW to SidePanel response envelope (A9/A13)", () => {
  it("keeps the successful runtime response opaque while the real client still returns a local Blob URL", async () => {
    const remoteUrl =
      "https://images.example.test/private/generated.png?token=do-not-cross";
    const processImage = vi.fn(async () => safeProcessedImage());
    const { chromeValue, responses } = runtimeHarness(processImage);
    const createdBlobs: Blob[] = [];
    const revokeObjectUrl = vi.fn();
    const client = createChromeRemoteMarkdownImageRuntimeClient(chromeValue, {
      createObjectUrl: (blob) => {
        createdBlobs.push(blob);
        return "blob:muzhi-local-runtime-image";
      },
      createRequestId: () => "remote-image-success",
      revokeObjectUrl,
    });

    const result = await client.load({ alt: "远程图片", url: remoteUrl });

    expect(processImage).toHaveBeenCalledOnce();
    expect(result).toEqual({ objectUrl: "blob:muzhi-local-runtime-image" });
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0]).toBeInstanceOf(Blob);
    expect(createdBlobs[0]?.type).toBe("image/png");
    client.dispose();
    client.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith(
      "blob:muzhi-local-runtime-image",
    );
    expect(responses).toHaveLength(1);
    expect(forbiddenEnvelopeParts(responses[0])).toEqual([]);
    expect(JSON.stringify(responses[0])).not.toContain(remoteUrl);
    expect(JSON.stringify(responses[0])).not.toContain(
      btoa(String.fromCharCode(...pngBytes)),
    );
  });

  it("uses only a minimal stable failure signal without an error payload or the processor error", async () => {
    const remoteUrl =
      "https://images.example.test/private/rejected.png?token=do-not-cross";
    const rawProcessorError =
      "provider response contained private pixels and secret-token-987";
    const processImage = vi.fn(async () => {
      throw new Error(rawProcessorError);
    });
    const { chromeValue, responses } = runtimeHarness(processImage);
    const createObjectUrl = vi.fn(() => "blob:must-not-be-created");
    const client = createChromeRemoteMarkdownImageRuntimeClient(chromeValue, {
      createObjectUrl,
      createRequestId: () => "remote-image-failure",
      revokeObjectUrl: vi.fn(),
    });

    await expect(
      client.load({ alt: "被拒绝的远程图片", url: remoteUrl }),
    ).rejects.toMatchObject({
      message: "远程图片加载失败，请重试。",
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      protocolVersion: 1,
      requestId: "remote-image-failure",
      type: "muzhi.remote-markdown-image.failed",
    });
    expect(forbiddenEnvelopeParts(responses[0])).toEqual([]);
    expect(JSON.stringify(responses[0])).not.toContain(remoteUrl);
    expect(JSON.stringify(responses[0])).not.toContain(rawProcessorError);
  });
});
