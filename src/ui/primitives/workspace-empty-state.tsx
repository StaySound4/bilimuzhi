import type { ComponentChildren } from "preact";

export interface WorkspaceEmptyStateProps {
  readonly action?: ComponentChildren;
  readonly description: string;
  readonly meta?: string;
  readonly title: string;
  readonly variant: "no-content" | "no-match" | "no-subtitle" | "no-video";
}

export function WorkspaceEmptyState({
  action,
  description,
  meta,
  title,
  variant,
}: WorkspaceEmptyStateProps) {
  return (
    <div class="muzhi-workspace-empty" data-empty-variant={variant}>
      <strong>{title}</strong>
      <p>{description}</p>
      {meta ? <small>{meta}</small> : null}
      {action}
    </div>
  );
}
