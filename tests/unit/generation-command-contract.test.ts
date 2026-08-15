import { describe, expect, it } from "vitest";

import {
  createAiGenerationRequest,
  createAiModelDescriptor,
} from "../../src/application/ai/provider-contract";
import {
  createGenerationStartCommand,
  createGenerationStopCommand,
  isGenerationRuntimeCommand,
} from "../../src/application/generation-command-contract";
import { GENERATION_RUNTIME_PROTOCOL_VERSION } from "../../src/application/generation-runtime-contract";

const context = {
  branchId: "branch-a",
  contextRevision: 1,
  expectedOwnerRevision: 0,
  kind: "chat" as const,
  protocolVersion: GENERATION_RUNTIME_PROTOCOL_VERSION,
  requestId: "request-a",
  sessionId: "session-a",
  subtitleId: "subtitle-a",
  targetId: "thread-a",
  taskId: "task-a",
};

function request() {
  return createAiGenerationRequest({
    kind: "chat",
    messages: [{ content: "hello", role: "user" }],
    model: createAiModelDescriptor({
      capabilities: {
        contextWindowCharacters: 1_000,
        maxOutputCharacters: 100,
        supportedReasoningEfforts: ["none"],
        supportsAttachments: false,
        supportsReasoning: false,
        supportsStreaming: true,
        supportsWebSearch: false,
      },
      discoveredAt: 1,
      displayName: "Model",
      modelId: "model-a",
      providerId: "provider-a",
    }),
    reasoningEffort: "auto",
  });
}

describe("generation runtime command contract", () => {
  it("accepts exact start and stop command envelopes", () => {
    expect(
      isGenerationRuntimeCommand(
        createGenerationStartCommand({ context, request: request() }),
      ),
    ).toBe(true);
    expect(
      isGenerationRuntimeCommand(createGenerationStopCommand(context)),
    ).toBe(true);
  });

  it("rejects extra fields, provider credentials, and another owner kind", () => {
    const command = createGenerationStartCommand({
      context,
      request: request(),
    });
    expect(
      isGenerationRuntimeCommand({ ...command, apiKey: "do-not-send" }),
    ).toBe(false);
    expect(
      isGenerationRuntimeCommand({
        ...command,
        payload: { ...command.payload, apiKey: "do-not-send" },
      }),
    ).toBe(false);
    expect(
      isGenerationRuntimeCommand({
        ...command,
        payload: {
          request: { ...command.payload.request, kind: "summary" },
        },
      }),
    ).toBe(false);
  });
});
