import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { createAiModelDescriptor } from "../../src/application/ai/provider-contract";
import type { AiProviderErrorCode } from "../../src/application/ai/provider-error";
import {
  createChatMessage,
  createGenerationRun,
  type GenerationRun,
} from "../../src/domain";
import { createChromeChatRuntimeClient } from "../../src/infrastructure/chrome-chat-runtime";
import { createChromeSettingsStore } from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";

type ImageCapability = "supported" | "unknown" | "unsupported";

interface ImageCapabilityProjection {
  readonly modelId: string;
  readonly profileId: string;
  readonly state: ImageCapability;
}

type ImageCapabilityEvidence =
  | { readonly outcome: "success" }
  | {
      readonly classification?: "image-input" | "multimodal-content";
      readonly code: AiProviderErrorCode;
      readonly outcome: "failure";
    };

interface ProviderProfileProjection {
  readonly id: string;
}

interface V12ImageCapabilityStore {
  addManualProfileModel(profileId: string, modelId: string): Promise<unknown>;
  createProviderProfile(input: {
    readonly baseUrl: string;
    readonly protocol: "openai-compatible";
  }): Promise<ProviderProfileProjection>;
  discoverProfileModels(profileId: string): Promise<unknown>;
  loadImageCapability(input: {
    readonly modelId: string;
    readonly profileId: string;
  }): Promise<ImageCapabilityProjection>;
  recordImageCapabilityEvidence(input: {
    readonly evidence: ImageCapabilityEvidence;
    readonly modelId: string;
    readonly profileId: string;
  }): Promise<ImageCapabilityProjection>;
  resetImageCapability(input: {
    readonly modelId: string;
    readonly profileId: string;
    readonly reason: "manual-retry" | "reprobe";
  }): Promise<ImageCapabilityProjection>;
  updateProviderProfile(
    profileId: string,
    input: { readonly baseUrl: string },
  ): Promise<unknown>;
}

interface HostPermissions {
  remove(input: { readonly origins: readonly string[] }): Promise<boolean>;
  request(input: { readonly origins: readonly string[] }): Promise<boolean>;
}

function createStorage(seed: Record<string, unknown> = {}) {
  const values = structuredClone(seed);
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { storage, values };
}

function createSubject(
  options: {
    readonly fetch?: typeof fetch;
    readonly permissions?: HostPermissions;
    readonly storage?: ChromeWorkspaceStorageArea;
  } = {},
) {
  const local = options.storage ? null : createStorage();
  const storage = options.storage ?? local!.storage;
  const factory = createChromeSettingsStore as unknown as (
    storage: ChromeWorkspaceStorageArea,
    dependencies?: {
      readonly fetch?: typeof fetch;
      readonly permissions?: HostPermissions;
    },
  ) => V12ImageCapabilityStore;
  return {
    storage,
    store: factory(storage, {
      fetch: options.fetch,
      permissions: options.permissions,
    }),
    values: local?.values,
  };
}

function requireMethod<K extends keyof V12ImageCapabilityStore>(
  store: V12ImageCapabilityStore,
  name: K,
): V12ImageCapabilityStore[K] {
  expect(
    store[name],
    `A9 requires executable profile+model image capability behavior (${String(name)})`,
  ).toBeTypeOf("function");
  return store[name];
}

async function configuredModel(
  options: {
    readonly fetch?: typeof fetch;
    readonly storage?: ChromeWorkspaceStorageArea;
  } = {},
) {
  const permissions: HostPermissions = {
    remove: vi.fn(async () => true),
    request: vi.fn(async () => true),
  };
  const subject = createSubject({ ...options, permissions });
  const profile = await requireMethod(
    subject.store,
    "createProviderProfile",
  ).call(subject.store, {
    baseUrl: "https://images.example.test/v1",
    protocol: "openai-compatible",
  });
  await requireMethod(subject.store, "addManualProfileModel").call(
    subject.store,
    profile.id,
    "vision-candidate",
  );
  return { ...subject, modelId: "vision-candidate", permissions, profile };
}

function keyOf(input: {
  readonly modelId: string;
  readonly profileId: string;
}) {
  return { modelId: input.modelId, profileId: input.profileId };
}

type ChromeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

type ImageCapabilityEvidenceSink = (input: {
  readonly evidence: ImageCapabilityEvidence;
  readonly modelId: string;
  readonly profileId: string;
}) => Promise<unknown> | unknown;

interface ImageAwareChatClientOptions {
  readonly recordImageCapabilityEvidence: ImageCapabilityEvidenceSink;
}

const imageCandidateModel = createAiModelDescriptor({
  capabilities: {
    contextWindowCharacters: 100_000,
    maxOutputCharacters: 10_000,
    supportedReasoningEfforts: ["none"],
    // A catalog false must not prevent an unknown model's real image attempt.
    supportsAttachments: false,
    supportsReasoning: false,
    supportsStreaming: true,
    supportsWebSearch: false,
  },
  discoveredAt: 1,
  displayName: "Unknown image model",
  modelId: "vision-candidate",
  providerId: "profile-images",
});

const imageChatScope = Object.freeze({
  branchId: "branch-images",
  contextRevision: 1,
  expectedOwnerRevision: 0,
  sessionId: "session-images",
  subtitleId: "subtitle-images",
});

function imageRun(
  runId: string,
  status: GenerationRun["status"] = "running",
  errorCode: string | null = null,
) {
  return createGenerationRun({
    branchId: imageChatScope.branchId,
    browserSessionId: "browser-images",
    completionSequence: status === "completed" ? 0 : null,
    contextRevision: imageChatScope.contextRevision,
    createdAt: 1,
    errorCode,
    expectedOwnerRevision: imageChatScope.expectedOwnerRevision,
    kind: "chat",
    partialOutput: status === "completed" ? "done" : "",
    runId,
    sessionId: imageChatScope.sessionId,
    status,
    stopReason: null,
    subtitleId: imageChatScope.subtitleId,
    targetId: "thread-images",
    taskId: `task-${runId}`,
    updatedAt: 2,
  });
}

function imageMessage(
  runId: string,
  role: "assistant" | "user",
  status: "complete" | "failed" | "streaming",
) {
  return createChatMessage({
    chatThreadId: "thread-images",
    content: role === "assistant" ? "" : "看图回答",
    createdAt: 1,
    generationRunId: role === "assistant" ? runId : null,
    messageId: `${role}-${runId}`,
    order: role === "assistant" ? 1 : 0,
    role,
    status,
    updatedAt: 2,
  });
}

function imageChatBus() {
  const listeners: ChromeListener[] = [];
  let sendCount = 0;
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener: ChromeListener) {
          listeners.push(listener);
        },
        removeListener(listener: ChromeListener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
      async sendMessage(command: unknown): Promise<unknown> {
        sendCount += 1;
        const runId = `run-image-${sendCount}`;
        const requestId = (command as { readonly requestId: string }).requestId;
        return {
          payload: {
            data: {
              assistant: imageMessage(runId, "assistant", "streaming"),
              run: imageRun(runId),
              user: imageMessage(runId, "user", "complete"),
            },
            ok: true,
          },
          protocolVersion: 1,
          requestId,
          type: "muzhi.chat.response",
        };
      },
    },
  };
  return {
    chrome,
    emit(run: GenerationRun) {
      const message = {
        payload: {
          message: imageMessage(
            run.runId,
            "assistant",
            run.status === "completed" ? "complete" : "failed",
          ),
          run,
          threadId: "thread-images",
        },
        protocolVersion: 1,
        type: "muzhi.chat.assistant.updated",
      };
      for (const listener of [...listeners]) listener(message, {}, () => {});
    },
  };
}

function imageAwareChatClient(
  chrome: unknown,
  recordImageCapabilityEvidence: ImageCapabilityEvidenceSink,
) {
  const factory = createChromeChatRuntimeClient as unknown as (
    chromeValue: unknown,
    createRequestId: () => string,
    options: ImageAwareChatClientOptions,
  ) => ReturnType<typeof createChromeChatRuntimeClient>;
  return factory(chrome, () => `request-${crypto.randomUUID()}`, {
    recordImageCapabilityEvidence,
  });
}

async function sendImageAttempt(
  client: ReturnType<typeof createChromeChatRuntimeClient>,
) {
  return client.send({
    attachmentIds: ["attachment-image"],
    content: "看图回答",
    generation: { model: imageCandidateModel, reasoningEffort: "none" },
    scope: imageChatScope,
    threadId: "thread-images",
  });
}

let sidepanelSource = "";

beforeAll(async () => {
  sidepanelSource = await readFile(
    new URL(
      "../../src/entries/sidepanel.tsx",
      import.meta.url,
    ) as unknown as string,
    "utf8",
  );
});

describe("v12 profile+model image capability runtime (A9)", () => {
  it("starts every profile+model pair as unknown and persists a real success as supported", async () => {
    const subject = await configuredModel();
    const key = keyOf({
      modelId: subject.modelId,
      profileId: subject.profile.id,
    });

    await expect(
      requireMethod(subject.store, "loadImageCapability").call(
        subject.store,
        key,
      ),
    ).resolves.toEqual({ ...key, state: "unknown" });

    await expect(
      requireMethod(subject.store, "recordImageCapabilityEvidence").call(
        subject.store,
        { ...key, evidence: { outcome: "success" } },
      ),
    ).resolves.toEqual({ ...key, state: "supported" });

    const reopened = createSubject({ storage: subject.storage }).store;
    await expect(
      requireMethod(reopened, "loadImageCapability").call(reopened, key),
    ).resolves.toEqual({ ...key, state: "supported" });
  });

  it.each(["image-input", "multimodal-content"] as const)(
    "caches unsupported only for a normalized explicit %s rejection",
    async (classification) => {
      const subject = await configuredModel();
      const key = keyOf({
        modelId: subject.modelId,
        profileId: subject.profile.id,
      });

      await expect(
        requireMethod(subject.store, "recordImageCapabilityEvidence").call(
          subject.store,
          {
            ...key,
            evidence: {
              classification,
              code: "UNSUPPORTED_CAPABILITY",
              outcome: "failure",
            },
          },
        ),
      ).resolves.toEqual({ ...key, state: "unsupported" });
    },
  );

  it.each([
    "NETWORK_ERROR",
    "RATE_LIMITED",
    "AUTHENTICATION_REQUIRED",
    "CONTENT_SAFETY_BLOCKED",
    "INTERNAL_ERROR",
  ] as const)(
    "does not mislabel %s as unsupported and does not erase prior supported evidence",
    async (code) => {
      const subject = await configuredModel();
      const key = keyOf({
        modelId: subject.modelId,
        profileId: subject.profile.id,
      });
      const record = requireMethod(
        subject.store,
        "recordImageCapabilityEvidence",
      ).bind(subject.store);

      await expect(
        record({ ...key, evidence: { code, outcome: "failure" } }),
      ).resolves.toEqual({ ...key, state: "unknown" });

      await record({ ...key, evidence: { outcome: "success" } });
      await expect(
        record({ ...key, evidence: { code, outcome: "failure" } }),
      ).resolves.toEqual({ ...key, state: "supported" });
    },
  );

  it("returns to unknown after configuration/model changes, re-probe, and manual retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "vision-candidate" }] })),
      ),
    );
    const subject = await configuredModel({ fetch });
    const key = keyOf({
      modelId: subject.modelId,
      profileId: subject.profile.id,
    });
    const record = requireMethod(
      subject.store,
      "recordImageCapabilityEvidence",
    ).bind(subject.store);
    const load = requireMethod(subject.store, "loadImageCapability").bind(
      subject.store,
    );

    await record({ ...key, evidence: { outcome: "success" } });
    await requireMethod(subject.store, "updateProviderProfile").call(
      subject.store,
      subject.profile.id,
      { baseUrl: "https://images-v2.example.test/v1" },
    );
    await expect(load(key)).resolves.toEqual({ ...key, state: "unknown" });

    await record({ ...key, evidence: { outcome: "success" } });
    await requireMethod(subject.store, "discoverProfileModels").call(
      subject.store,
      subject.profile.id,
    );
    await expect(load(key)).resolves.toEqual({ ...key, state: "unknown" });

    await record({
      ...key,
      evidence: {
        classification: "image-input",
        code: "UNSUPPORTED_CAPABILITY",
        outcome: "failure",
      },
    });
    await requireMethod(subject.store, "resetImageCapability").call(
      subject.store,
      { ...key, reason: "manual-retry" },
    );
    await expect(load(key)).resolves.toEqual({ ...key, state: "unknown" });

    await requireMethod(subject.store, "addManualProfileModel").call(
      subject.store,
      subject.profile.id,
      "another-model",
    );
    await expect(
      load({ modelId: "another-model", profileId: subject.profile.id }),
    ).resolves.toMatchObject({ state: "unknown" });
  });

  it("projects only profile, model, and normalized state without a key or raw Provider text", async () => {
    const subject = await configuredModel();
    const key = keyOf({
      modelId: subject.modelId,
      profileId: subject.profile.id,
    });
    const projection = await requireMethod(
      subject.store,
      "recordImageCapabilityEvidence",
    ).call(subject.store, { ...key, evidence: { outcome: "success" } });

    expect(Object.keys(projection).sort()).toEqual([
      "modelId",
      "profileId",
      "state",
    ]);
    expect(JSON.stringify(projection)).not.toContain("apiKey");
    expect(JSON.stringify(projection)).not.toContain("Bearer");
    expect(JSON.stringify(projection)).not.toContain("raw provider response");
  });

  it("wires the safe runtime projection into the real SidePanel chat composition instead of catalog fail-close", () => {
    // Wiring oracle: sidepanel.tsx is a self-bootstrapping extension entry with
    // no injectable composition root. Executable state/evidence behavior is
    // covered above; this narrow oracle only proves the production entry reads
    // that projection and passes it to ChatWorkspace.
    expect(sidepanelSource).toContain("settingsStore.loadImageCapability(");
    expect(sidepanelSource).toMatch(
      /createChromeChatRuntimeClient\([\s\S]{0,500}recordImageCapabilityEvidence/,
    );
    expect(sidepanelSource).toMatch(
      /imageCapability:\s*[A-Za-z_$][\w$]*\.state/,
    );
    expect(sidepanelSource).not.toContain("selectedModelSupportsAttachments");
    expect(sidepanelSource).not.toContain("supportsImageAttachments:");
  });
});

describe("v12 attached chat evidence closure (A9)", () => {
  it("records supported only after the real attached chat run completes successfully", async () => {
    const bus = imageChatBus();
    const recordEvidence = vi.fn<ImageCapabilityEvidenceSink>();
    const client = imageAwareChatClient(bus.chrome, recordEvidence);

    const attached = await sendImageAttempt(client);
    expect(recordEvidence).not.toHaveBeenCalled();

    bus.emit(imageRun(attached.run.runId, "completed"));
    await vi.waitFor(() =>
      expect(recordEvidence).toHaveBeenCalledWith({
        evidence: { outcome: "success" },
        modelId: "vision-candidate",
        profileId: "profile-images",
      }),
    );
  });

  it("records unsupported only for an attached run's normalized unsupported-capability failure", async () => {
    const bus = imageChatBus();
    const recordEvidence = vi.fn<ImageCapabilityEvidenceSink>();
    const client = imageAwareChatClient(bus.chrome, recordEvidence);
    const attached = await sendImageAttempt(client);

    bus.emit(imageRun(attached.run.runId, "failed", "UNSUPPORTED_CAPABILITY"));
    await vi.waitFor(() =>
      expect(recordEvidence).toHaveBeenCalledWith({
        evidence: {
          classification: "image-input",
          code: "UNSUPPORTED_CAPABILITY",
          outcome: "failure",
        },
        modelId: "vision-candidate",
        profileId: "profile-images",
      }),
    );
  });

  it("does not write unsupported evidence for network, rate-limit, auth, safety, or ordinary attached-chat failures", async () => {
    const bus = imageChatBus();
    const recordEvidence = vi.fn<ImageCapabilityEvidenceSink>();
    const client = imageAwareChatClient(bus.chrome, recordEvidence);

    const successful = await sendImageAttempt(client);
    bus.emit(imageRun(successful.run.runId, "completed"));
    await vi.waitFor(() => expect(recordEvidence).toHaveBeenCalledOnce());
    recordEvidence.mockClear();

    for (const code of [
      "NETWORK_ERROR",
      "RATE_LIMITED",
      "AUTHENTICATION_REQUIRED",
      "CONTENT_SAFETY_BLOCKED",
      "INTERNAL_ERROR",
    ] as const) {
      const attached = await sendImageAttempt(client);
      bus.emit(imageRun(attached.run.runId, "failed", code));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordEvidence).not.toHaveBeenCalled();
  });
});
