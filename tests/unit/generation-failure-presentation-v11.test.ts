import { describe, expect, it } from "vitest";

import * as generationRuntimeContract from "../../src/application/generation-runtime-contract";

const REQUIRED_GENERATION_FAILURES = [
  "USER_CANCELLED",
  "NETWORK_ERROR",
  "AUTHENTICATION_REQUIRED",
  "RATE_LIMITED",
  "PROVIDER_EARLY_END",
  "TIMEOUT",
  "CONTEXT_TOO_LONG",
  "OUTPUT_LIMIT_REACHED",
  "CONTENT_SAFETY_BLOCKED",
  "STRUCTURED_OUTPUT_INVALID",
  "PERSISTENCE_FAILED",
  "BACKGROUND_RECOVERY_FAILED",
] as const;

type GenerationFailureCode = (typeof REQUIRED_GENERATION_FAILURES)[number];
type GenerationTargetKind = "chat" | "segments" | "summary";

interface FailurePresentation {
  readonly action: string;
  readonly code: GenerationFailureCode;
  readonly incomplete: boolean;
  readonly placement: "artifact" | "chat-message";
  readonly preservePartial: boolean;
  readonly preservePreviousArtifact: boolean;
  readonly retryable: boolean;
}

type DescribeGenerationFailure = (input: {
  readonly code: GenerationFailureCode;
  readonly hasPartialOutput: boolean;
  readonly hasPreviousArtifact: boolean;
  readonly kind: GenerationTargetKind;
}) => FailurePresentation;

function resolveFailurePresentation(): DescribeGenerationFailure {
  const candidate = Reflect.get(
    generationRuntimeContract,
    "describeGenerationFailure",
  ) as unknown;
  if (typeof candidate === "function") {
    return candidate as DescribeGenerationFailure;
  }
  return () => null as unknown as FailurePresentation;
}

describe("GenerationRun V11 failure presentation", () => {
  it.each(REQUIRED_GENERATION_FAILURES)(
    "keeps %s distinct and gives the user a located action and retry decision",
    (code) => {
      const presentation = resolveFailurePresentation()({
        code,
        hasPartialOutput: false,
        hasPreviousArtifact: false,
        kind: "chat",
      });

      expect(presentation).toEqual(
        expect.objectContaining({
          action: expect.any(String),
          code,
          placement: "chat-message",
          retryable: expect.any(Boolean),
        }),
      );
      expect(presentation.action.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(["chat", "summary"] as const)(
    "marks interrupted partial %s output as an incomplete draft",
    (kind) => {
      const presentation = resolveFailurePresentation()({
        code: "PROVIDER_EARLY_END",
        hasPartialOutput: true,
        hasPreviousArtifact: false,
        kind,
      });

      expect(presentation).toMatchObject({
        incomplete: true,
        placement: kind === "chat" ? "chat-message" : "artifact",
        preservePartial: true,
        preservePreviousArtifact: false,
      });
    },
  );

  it("keeps the last successful segment artifact when a partial replacement fails", () => {
    const presentation = resolveFailurePresentation()({
      code: "STRUCTURED_OUTPUT_INVALID",
      hasPartialOutput: true,
      hasPreviousArtifact: true,
      kind: "segments",
    });

    expect(presentation).toMatchObject({
      incomplete: false,
      placement: "artifact",
      preservePartial: false,
      preservePreviousArtifact: true,
    });
  });
});
