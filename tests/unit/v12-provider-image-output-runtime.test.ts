import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createAiGenerationRequest,
  createAiModelDescriptor,
  type AiProviderStreamEvent,
} from "../../src/application/ai/provider-contract";
import * as imageProcessorModule from "../../src/infrastructure/image-attachment-processor";
import { StreamingProviderAdapter } from "../../src/infrastructure/ai/streaming-provider-adapter";

type SafeImageMimeType = "image/jpeg" | "image/png" | "image/webp";

type ProviderImageOutputDescriptor =
  | {
      readonly kind: "remote";
      readonly url: string;
    }
  | {
      readonly base64: string;
      readonly kind: "inline";
      readonly mimeType: SafeImageMimeType;
    };

interface ProviderImageOutputEvent {
  readonly descriptor: ProviderImageOutputDescriptor;
  readonly type: "image-output";
}

interface DownloadedProviderImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly finalUrl: string;
}

interface ProviderImageOutputProcessorDependencies {
  readonly download: (input: {
    readonly credentials: "omit";
    readonly redirect: "error";
    readonly url: string;
  }) => Promise<DownloadedProviderImage>;
  readonly reencode: (input: {
    readonly bytes: Uint8Array;
    readonly mimeType: SafeImageMimeType;
  }) => Promise<{
    readonly blob: Blob;
    readonly height: number;
    readonly mimeType: SafeImageMimeType;
    readonly thumbnailBlob: Blob;
    readonly width: number;
  }>;
}

type ProviderImageOutputProcessor = (
  descriptor: ProviderImageOutputDescriptor,
) => Promise<{
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: SafeImageMimeType;
  readonly thumbnailBlob: Blob;
  readonly width: number;
}>;

type ProviderImageOutputProcessorFactory = (
  dependencies: ProviderImageOutputProcessorDependencies,
) => ProviderImageOutputProcessor;

const model = createAiModelDescriptor({
  capabilities: {
    contextWindowCharacters: 10_000,
    maxOutputCharacters: 1_000,
    supportedReasoningEfforts: ["none"],
    supportsAttachments: true,
    supportsReasoning: false,
    supportsStreaming: true,
    supportsWebSearch: false,
  },
  discoveredAt: 1,
  displayName: "Image output model",
  modelId: "image-output-model",
  providerId: "provider-images",
});

const request = createAiGenerationRequest({
  kind: "chat",
  messages: [{ content: "生成一张示意图", role: "user" }],
  model,
  reasoningEffort: "none",
});

const capabilities = model.capabilities;
let chatRuntimeSource = "";
let serviceWorkerSource = "";

beforeAll(async () => {
  [chatRuntimeSource, serviceWorkerSource] = await Promise.all([
    readFile(
      new URL(
        "../../src/application/chat-runtime.ts",
        import.meta.url,
      ) as unknown as string,
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/entries/service-worker.ts",
        import.meta.url,
      ) as unknown as string,
      "utf8",
    ),
  ]);
});

function adapterFor(events: readonly unknown[]) {
  return new StreamingProviderAdapter({
    fallbackCapabilities: capabilities,
    now: () => 1,
    providerId: "provider-images",
    resolveCapabilities: () => capabilities,
    transport: {
      async discoverModels() {
        return { data: [] };
      },
      async *stream() {
        for (const event of events) yield event;
      },
    },
  });
}

async function collectProviderEvents(events: readonly unknown[]) {
  const collected: unknown[] = [];
  for await (const event of adapterFor(events).stream(request)) {
    collected.push(event);
  }
  return collected;
}

function requireProcessorFactory(): ProviderImageOutputProcessorFactory {
  const factory = Reflect.get(
    imageProcessorModule,
    "createProviderImageOutputProcessor",
  ) as ProviderImageOutputProcessorFactory | undefined;
  expect(
    factory,
    "A9 requires an executable Provider image-output validation boundary",
  ).toBeTypeOf("function");
  return factory!;
}

const pngBytes = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
);
const jpegBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeProcessedImage() {
  return {
    blob: new Blob(["normalized-pixels"], { type: "image/webp" }),
    height: 480,
    mimeType: "image/webp" as const,
    thumbnailBlob: new Blob(["normalized-thumbnail"], {
      type: "image/webp",
    }),
    width: 640,
  };
}

function processorHarness(
  downloaded: DownloadedProviderImage = {
    bytes: pngBytes,
    contentType: "image/png",
    finalUrl: "https://images.example.test/generated/one.png",
  },
) {
  const download = vi.fn(async () => downloaded);
  const reencode = vi.fn(async () => safeProcessedImage());
  return {
    download,
    process: requireProcessorFactory()({ download, reencode }),
    reencode,
  };
}

async function safeFailure(
  process: ProviderImageOutputProcessor,
  descriptor: ProviderImageOutputDescriptor,
) {
  let caught: unknown;
  try {
    await process(descriptor);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    code: "IMAGE_OUTPUT_REJECTED",
    retryable: false,
  });
  return JSON.stringify(caught);
}

describe("v12 normalized Provider image-output stream (A9/A13)", () => {
  it("emits a structured HTTPS image descriptor separately from visible text", async () => {
    const remoteUrl = "https://images.example.test/generated/one.png";
    const events = await collectProviderEvents([
      { type: "started" },
      { descriptor: { kind: "remote", url: remoteUrl }, type: "image-output" },
      { delta: "可见说明", type: "delta" },
      { output: "可见说明", type: "completed" },
    ]);

    expect(events).toContainEqual({
      descriptor: { kind: "remote", url: remoteUrl },
      type: "image-output",
    } satisfies ProviderImageOutputEvent);
    expect(events).toContainEqual({ output: "可见说明", type: "completed" });
    expect(
      events
        .filter(
          (event): event is AiProviderStreamEvent =>
            typeof event === "object" && event !== null && "type" in event,
        )
        .filter(
          (event) => event.type === "delta" || event.type === "completed",
        ),
    ).not.toContainEqual(expect.objectContaining({ output: remoteUrl }));
  });

  it("emits a bounded inline image descriptor instead of appending base64 to text", async () => {
    const encoded = base64(pngBytes);
    const events = await collectProviderEvents([
      {
        descriptor: {
          base64: encoded,
          kind: "inline",
          mimeType: "image/png",
        },
        type: "image-output",
      },
      { output: "图片已生成", type: "completed" },
    ]);

    expect(events).toContainEqual({
      descriptor: {
        base64: encoded,
        kind: "inline",
        mimeType: "image/png",
      },
      type: "image-output",
    } satisfies ProviderImageOutputEvent);
    expect(
      events.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          Reflect.get(event, "type") === "completed",
      ),
    ).toEqual([{ output: "图片已生成", type: "completed" }]);
  });

  it("wires structured image events through Chat and the Service Worker safe processor/atomic commit instead of stopping at an isolated adapter", () => {
    expect(chatRuntimeSource).toContain('case "image-output"');
    expect(chatRuntimeSource).toContain("commitAssistantImageOutputs");
    expect(serviceWorkerSource).toContain("createProviderImageOutputProcessor");
    expect(serviceWorkerSource).toContain("commitAssistantImageOutputs");
    expect(`${chatRuntimeSource}\n${serviceWorkerSource}`).toContain(
      "IMAGE_OUTPUT_REJECTED",
    );
  });
});

describe("v12 Provider image-output validation and normalization (A9/A13)", () => {
  it("downloads HTTPS with credentials omitted and redirects closed, validates PNG magic, and returns only re-encoded local pixels", async () => {
    const remoteUrl = "https://images.example.test/generated/one.png";
    const harness = processorHarness();

    const processed = await harness.process({ kind: "remote", url: remoteUrl });

    expect(harness.download).toHaveBeenCalledOnce();
    expect(harness.download).toHaveBeenCalledWith({
      credentials: "omit",
      redirect: "error",
      url: remoteUrl,
    });
    expect(harness.reencode).toHaveBeenCalledWith({
      bytes: pngBytes,
      mimeType: "image/png",
    });
    expect(processed).toEqual(safeProcessedImage());
    expect(JSON.stringify(processed)).not.toContain(remoteUrl);
    expect(await processed.blob.text()).toBe("normalized-pixels");
  });

  it("decodes an allowlisted inline payload, verifies its magic, and never returns the original base64", async () => {
    const encoded = base64(jpegBytes);
    const harness = processorHarness();

    const processed = await harness.process({
      base64: encoded,
      kind: "inline",
      mimeType: "image/jpeg",
    });

    expect(harness.download).not.toHaveBeenCalled();
    expect(harness.reencode).toHaveBeenCalledWith({
      bytes: jpegBytes,
      mimeType: "image/jpeg",
    });
    expect(JSON.stringify(processed)).not.toContain(encoded);
  });

  it.each([
    ["javascript", { kind: "remote", url: "javascript:alert(1)" }],
    ["file", { kind: "remote", url: "file:///private/image.png" }],
    ["blob", { kind: "remote", url: "blob:https://example.test/raw" }],
    ["plain HTTP", { kind: "remote", url: "http://images.example.test/a.png" }],
    [
      "SVG data",
      {
        base64: base64(new TextEncoder().encode("<svg onload='alert(1)'/>")),
        kind: "inline",
        mimeType: "image/svg+xml",
      },
    ],
    [
      "HTML data",
      {
        base64: base64(new TextEncoder().encode("<html>not an image</html>")),
        kind: "inline",
        mimeType: "text/html",
      },
    ],
  ] as const)(
    "rejects a %s source before download or decode",
    async (_label, raw) => {
      const harness = processorHarness();
      const descriptor = raw as unknown as ProviderImageOutputDescriptor;

      const serialized = await safeFailure(harness.process, descriptor);

      expect(harness.download).not.toHaveBeenCalled();
      expect(harness.reencode).not.toHaveBeenCalled();
      expect(serialized).not.toContain(Reflect.get(raw, "url") ?? "<raw-url>");
      expect(serialized).not.toContain(
        Reflect.get(raw, "base64") ?? "<base64>",
      );
    },
  );

  it.each([
    [
      "HTML bytes disguised as PNG",
      {
        bytes: new TextEncoder().encode(
          "<!doctype html><script>alert(1)</script>",
        ),
        contentType: "image/png",
        finalUrl: "https://images.example.test/generated/one.png",
      },
    ],
    [
      "JPEG bytes declared as PNG",
      {
        bytes: jpegBytes,
        contentType: "image/png",
        finalUrl: "https://images.example.test/generated/one.png",
      },
    ],
    [
      "cross-origin redirect",
      {
        bytes: pngBytes,
        contentType: "image/png",
        finalUrl: "https://redirected.example.test/stolen.png",
      },
    ],
  ] as const)("rejects %s before re-encoding", async (_label, downloaded) => {
    const remoteUrl = "https://images.example.test/generated/one.png";
    const harness = processorHarness(downloaded);

    const serialized = await safeFailure(harness.process, {
      kind: "remote",
      url: remoteUrl,
    });

    expect(harness.reencode).not.toHaveBeenCalled();
    expect(serialized).not.toContain(remoteUrl);
    expect(serialized).not.toContain(downloaded.finalUrl);
  });

  it("rejects an oversized payload before decode/re-encode without echoing bytes", async () => {
    const oversized = new Uint8Array(5 * 1_024 * 1_024 + 1);
    oversized.set(pngBytes);
    const harness = processorHarness({
      bytes: oversized,
      contentType: "image/png",
      finalUrl: "https://images.example.test/generated/large.png",
    });

    const serialized = await safeFailure(harness.process, {
      kind: "remote",
      url: "https://images.example.test/generated/large.png",
    });

    expect(harness.reencode).not.toHaveBeenCalled();
    expect(serialized.length).toBeLessThan(1_024);
  });
});
