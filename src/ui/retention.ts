export type RetentionChoice = "365" | "30" | "7" | "custom" | "forever";

export interface RetentionChange {
  readonly retention: RetentionChoice;
  readonly customDays: string;
  readonly applyTo: "existing" | "future";
}
