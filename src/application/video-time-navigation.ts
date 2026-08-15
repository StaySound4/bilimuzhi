import type { VideoKey } from "../domain";

export interface VideoTimeNavigationOwner {
  readonly revision: number;
  readonly sessionId: string;
  readonly subtitleId: string;
  readonly videoKey: VideoKey;
}

export type VideoTimeNavigationResult =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly kind: "seeked";
      readonly seconds: number;
      readonly videoKey: VideoKey;
    }
  | { readonly kind: "stale" };

export interface VideoTimeNavigationPort {
  navigate(
    videoKey: VideoKey,
    seconds: number,
    canContinue?: () => boolean,
  ): Promise<"cancelled" | "seeked">;
  readTime(videoKey: VideoKey): Promise<number>;
}

export interface VideoTimeNavigationRequest {
  readonly owner: VideoTimeNavigationOwner;
  readonly seconds: number;
}

export interface VideoTimeNavigator {
  navigate(
    input: VideoTimeNavigationRequest,
  ): Promise<VideoTimeNavigationResult>;
  readCurrentTime(owner: VideoTimeNavigationOwner): Promise<number | null>;
}

function ownersEqual(
  left: VideoTimeNavigationOwner | null,
  right: VideoTimeNavigationOwner,
): boolean {
  return (
    left !== null &&
    left.revision === right.revision &&
    left.sessionId === right.sessionId &&
    left.subtitleId === right.subtitleId &&
    left.videoKey === right.videoKey
  );
}

/** 所有用户可见的视频时间跳转和定位读取统一经过此 owner 守卫入口。 */
export function createVideoTimeNavigator(dependencies: {
  readonly player: VideoTimeNavigationPort;
  readonly readCurrentOwner: () => VideoTimeNavigationOwner | null;
}): VideoTimeNavigator {
  let navigationSequence = 0;
  let readSequence = 0;
  const stillOwnsNavigation = (
    owner: VideoTimeNavigationOwner,
    requestSequence: number,
  ): boolean =>
    requestSequence === navigationSequence &&
    ownersEqual(dependencies.readCurrentOwner(), owner);
  const stillOwnsRead = (
    owner: VideoTimeNavigationOwner,
    requestSequence: number,
  ): boolean =>
    requestSequence === readSequence &&
    ownersEqual(dependencies.readCurrentOwner(), owner);

  return Object.freeze({
    async navigate(
      input: VideoTimeNavigationRequest,
    ): Promise<VideoTimeNavigationResult> {
      if (
        !Number.isFinite(input.seconds) ||
        input.seconds < 0 ||
        input.owner.videoKey.length === 0
      ) {
        return Object.freeze({
          kind: "failed",
          message: "无法完成视频跳转，请重试。",
          retryable: false,
        });
      }
      if (!ownersEqual(dependencies.readCurrentOwner(), input.owner)) {
        return Object.freeze({ kind: "stale" });
      }
      const requestSequence = (navigationSequence += 1);
      try {
        const result = await dependencies.player.navigate(
          input.owner.videoKey,
          input.seconds,
          () => stillOwnsNavigation(input.owner, requestSequence),
        );
        if (!stillOwnsNavigation(input.owner, requestSequence)) {
          return Object.freeze({ kind: "stale" });
        }
        if (result === "cancelled") {
          return Object.freeze({ kind: "cancelled" });
        }
        return Object.freeze({
          kind: "seeked",
          seconds: input.seconds,
          videoKey: input.owner.videoKey,
        });
      } catch {
        if (!stillOwnsNavigation(input.owner, requestSequence)) {
          return Object.freeze({ kind: "stale" });
        }
        return Object.freeze({
          kind: "failed",
          message: "无法完成视频跳转，请重试。",
          retryable: true,
        });
      }
    },
    async readCurrentTime(
      owner: VideoTimeNavigationOwner,
    ): Promise<number | null> {
      if (!ownersEqual(dependencies.readCurrentOwner(), owner)) return null;
      const requestSequence = (readSequence += 1);
      try {
        const time = await dependencies.player.readTime(owner.videoKey);
        return stillOwnsRead(owner, requestSequence) ? time : null;
      } catch (error) {
        if (!stillOwnsRead(owner, requestSequence)) return null;
        throw error;
      }
    },
  });
}
