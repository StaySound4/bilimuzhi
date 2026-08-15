import {
  RUNTIME_PROTOCOL_VERSION,
  isRuntimeCommand,
  isRuntimeEvent,
  type ExtensionErrorCode,
  type RelayedSeekCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type SeekWatermarkCommand,
} from "../application/runtime-contract";
import { parseVideoKey } from "../domain";
import { parseBilibiliPageIdentity } from "./bilibili-page-identity";

type PlayerCommand = Extract<
  RuntimeCommand,
  { type: "muzhi.video.seek" | "muzhi.video.time.read" }
>;

type RelayedPlayerCommand =
  | Extract<PlayerCommand, { type: "muzhi.video.time.read" }>
  | RelayedSeekCommand;

type ContentPlayerRelayMessage = RelayedPlayerCommand | SeekWatermarkCommand;
interface ChromeEventApi {
  addListener(listener: (...args: unknown[]) => void): void;
  readonly target: Record<string, unknown>;
}

interface PlayerTab {
  readonly id: number;
  readonly url?: string;
}

interface ChromePlayerRelayTabsApi {
  create?: (input: { readonly url: string }) => Promise<unknown>;
  query(queryInfo: Record<string, unknown>): Promise<unknown>;
  remove?: (tabId: number) => Promise<unknown>;
  sendMessage(
    tabId: number,
    message: ContentPlayerRelayMessage,
  ): Promise<unknown>;
  update?: (
    tabId: number,
    updateProperties: { readonly active: true },
  ) => Promise<unknown>;
}

interface ChromePlayerRelayScriptingApi {
  executeScript(injection: {
    readonly files: readonly string[];
    readonly target: { readonly tabId: number };
  }): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEventApi(value: unknown): ChromeEventApi | null {
  if (!isRecord(value)) return null;
  const addListener = Reflect.get(value, "addListener") as unknown;
  if (typeof addListener !== "function") return null;
  return Object.freeze({
    addListener: addListener as ChromeEventApi["addListener"],
    target: value,
  });
}

function isPlayerCommand(value: unknown): value is PlayerCommand {
  return (
    isRuntimeCommand(value) &&
    (value.type === "muzhi.video.seek" ||
      value.type === "muzhi.video.time.read")
  );
}

function failure(
  command: PlayerCommand,
  code: ExtensionErrorCode,
  message: string,
  retryable: boolean,
): RuntimeEvent {
  return Object.freeze({
    error: Object.freeze({ code, message, retryable }),
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    type: "muzhi.command.failed",
  });
}

function tabsFrom(value: unknown): readonly PlayerTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = Reflect.get(candidate, "id");
    const url = Reflect.get(candidate, "url");
    if (!Number.isSafeInteger(id) || Number(id) <= 0) return [];
    return [
      Object.freeze({
        id: Number(id),
        ...(typeof url === "string" ? { url } : {}),
      }),
    ];
  });
}

function matchesCommand(tab: PlayerTab, command: PlayerCommand): boolean {
  if (tab.url === undefined) return false;
  const identity = parseBilibiliPageIdentity(tab.url);
  if (identity === null) return false;
  try {
    const requested = parseVideoKey(command.payload.videoKey);
    return identity.bvid === requested.bvid && identity.page === requested.page;
  } catch {
    return false;
  }
}

function confirmsExactVideoKey(
  command: PlayerCommand,
  response: RuntimeEvent,
): boolean {
  if (response.type === "muzhi.video.seeked") {
    return response.payload.videoKey === command.payload.videoKey;
  }
  if (response.type === "muzhi.video.time.reported") {
    return response.payload.videoKey === command.payload.videoKey;
  }
  return true;
}

function canonicalSeekUrl(
  command: Extract<PlayerCommand, { type: "muzhi.video.seek" }>,
): string {
  const video = parseVideoKey(command.payload.videoKey);
  const url = new URL(`https://www.bilibili.com/video/${video.bvid}`);
  if (video.page !== 1) url.searchParams.set("p", String(video.page));
  url.searchParams.set("t", String(command.payload.seconds));
  return url.href;
}

function responseFor(command: PlayerCommand, response: unknown): RuntimeEvent {
  if (isRuntimeEvent(response) && response.requestId === command.requestId) {
    return response;
  }
  return failure(command, "INTERNAL_ERROR", "播放器响应无效，请重试。", true);
}

function tabFromCreated(value: unknown): PlayerTab | null {
  return tabsFrom([value])[0] ?? null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

const SEEK_OPEN_CONFIRMATION_TTL_MS = 60_000;
function seekOpenFingerprint(
  command: Extract<PlayerCommand, { type: "muzhi.video.seek" }>,
): string {
  return `${command.payload.videoKey}\n${String(command.payload.seconds)}`;
}

function interrupted(command: PlayerCommand): RuntimeEvent {
  return failure(
    command,
    "TASK_INTERRUPTED",
    "较新的跳转请求已取代当前请求。",
    false,
  );
}
/**
 * Relays guarded player commands to the exact BVID/page. A passive time read
 * never creates a tab. Only a user-originated seek may open the canonical
 * target page, and success is returned only after its content bridge confirms
 * the real seek.
 */
export function installChromeContentPlayerRelay(
  chromeValue: unknown,
  dependencies: { readonly allocateSeekSequence: () => Promise<number> },
): void {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  const tabs = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "tabs") as unknown)
    : null;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
    : null;
  const event = getEventApi(onMessage);
  const query = isRecord(tabs) ? (Reflect.get(tabs, "query") as unknown) : null;
  const sendMessage = isRecord(tabs)
    ? (Reflect.get(tabs, "sendMessage") as unknown)
    : null;
  const create = isRecord(tabs)
    ? (Reflect.get(tabs, "create") as unknown)
    : null;
  const remove = isRecord(tabs)
    ? (Reflect.get(tabs, "remove") as unknown)
    : null;
  const update = isRecord(tabs)
    ? (Reflect.get(tabs, "update") as unknown)
    : null;
  const scripting = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "scripting") as unknown)
    : null;
  const executeScript = isRecord(scripting)
    ? (Reflect.get(scripting, "executeScript") as unknown)
    : null;
  if (
    event === null ||
    !isRecord(tabs) ||
    typeof query !== "function" ||
    typeof sendMessage !== "function"
  ) {
    throw new Error("Chrome 播放器中继 API 不可用。");
  }
  const playerTabs: ChromePlayerRelayTabsApi = Object.freeze({
    ...(typeof create === "function"
      ? {
          create: (input: { readonly url: string }) =>
            Reflect.apply(create, tabs, [input]),
        }
      : {}),
    query: (queryInfo: Record<string, unknown>) =>
      Reflect.apply(query, tabs, [queryInfo]),
    ...(typeof remove === "function"
      ? {
          remove: (tabId: number) => Reflect.apply(remove, tabs, [tabId]),
        }
      : {}),
    sendMessage: (tabId: number, message: ContentPlayerRelayMessage) =>
      Reflect.apply(sendMessage, tabs, [tabId, message]),
    ...(typeof update === "function"
      ? {
          update: (tabId: number, properties: { readonly active: true }) =>
            Reflect.apply(update, tabs, [tabId, properties]),
        }
      : {}),
  });
  const playerScripting: ChromePlayerRelayScriptingApi | null =
    isRecord(scripting) && typeof executeScript === "function"
      ? Object.freeze({
          executeScript: (injection: {
            readonly files: readonly string[];
            readonly target: { readonly tabId: number };
          }) => Reflect.apply(executeScript, scripting, [injection]),
        })
      : null;
  const pendingSeekOpenConfirmations = new Map<
    string,
    { readonly expiresAt: number; readonly fingerprint: string }
  >();
  let latestSeekRequestId: string | null = null;
  const seekSequenceByRequestId = new Map<string, Promise<number>>();
  const supersededSeekRequestIds = new Set<string>();
  const allocateSeekSequence = dependencies.allocateSeekSequence;
  const nextSeekSequence = async (): Promise<number> => {
    const sequence = await allocateSeekSequence();
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error("跳转派发序号无效。");
    }
    return sequence;
  };
  const sendToPlayer = async (
    tabId: number,
    command: PlayerCommand,
    relayedCommand: RelayedPlayerCommand,
    waitForPlayer: boolean,
    isCurrent: () => boolean,
  ): Promise<RuntimeEvent> => {
    const attempts = waitForPlayer ? 20 : 2;
    let injected = false;
    let lastError: unknown;
    let lastResponse: RuntimeEvent | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!isCurrent()) {
        return interrupted(command);
      }
      try {
        const response = responseFor(
          command,
          await playerTabs.sendMessage(tabId, relayedCommand),
        );
        if (!isCurrent()) return interrupted(command);
        if (!confirmsExactVideoKey(command, response)) {
          return failure(
            command,
            "VIDEO_NOT_BOUND",
            "目标播放器身份校验失败，请重新同步页面后再试。",
            true,
          );
        }
        if (!waitForPlayer || response.type !== "muzhi.command.failed") {
          return response;
        }
        if (response.error.code === "VIDEO_NOT_BOUND") {
          // 稳定的不匹配不是播放器挂载延迟。立即返回，
          // 让中继尝试另一个匹配的 BVID/页面标签页或请求打开。
          return response;
        }
        if (response.error.code !== "UNSUPPORTED_CAPABILITY") {
          return response;
        }
        lastResponse = response;
      } catch (error) {
        lastError = error;
        if (!isCurrent()) return interrupted(command);
        if (!injected && playerScripting !== null) {
          try {
            await playerScripting.executeScript({
              files: ["content-script.js"],
              target: { tabId },
            });
            injected = true;
          } catch {
            // A newly-created page may still be navigating. Retry below.
          }
        }
      }
      if (attempt + 1 < attempts) {
        await wait(waitForPlayer ? 250 : 0);
        if (!isCurrent()) {
          return interrupted(command);
        }
      }
    }
    if (lastResponse !== undefined) return lastResponse;
    throw lastError;
  };

  const listener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: RuntimeEvent) => void,
  ): boolean => {
    if (!isPlayerCommand(message)) return false;
    const command = message;
    if (command.type === "muzhi.video.seek") {
      if (supersededSeekRequestIds.has(command.requestId)) {
        sendResponse(interrupted(command));
        return true;
      }
      if (
        latestSeekRequestId !== null &&
        latestSeekRequestId !== command.requestId
      ) {
        supersededSeekRequestIds.add(latestSeekRequestId);
        pendingSeekOpenConfirmations.delete(latestSeekRequestId);
      }
      if (!seekSequenceByRequestId.has(command.requestId)) {
        seekSequenceByRequestId.set(command.requestId, nextSeekSequence());
      }
      latestSeekRequestId = command.requestId;
    }
    const isCurrent = (): boolean =>
      command.type !== "muzhi.video.seek" ||
      (latestSeekRequestId === command.requestId &&
        !supersededSeekRequestIds.has(command.requestId));
    void (async () => {
      try {
        let relayedCommand: RelayedPlayerCommand;
        if (command.type === "muzhi.video.seek") {
          const sequencePromise = seekSequenceByRequestId.get(
            command.requestId,
          );
          if (sequencePromise === undefined) {
            throw new Error("跳转派发序号不可用。");
          }
          relayedCommand = Object.freeze({
            ...command,
            seekDispatch: Object.freeze({
              sequence: await sequencePromise,
            }),
          });
        } else {
          relayedCommand = command;
        }
        if (!isCurrent()) return interrupted(command);
        const now = Date.now();
        for (const [requestId, pending] of pendingSeekOpenConfirmations) {
          if (pending.expiresAt <= now) {
            pendingSeekOpenConfirmations.delete(requestId);
          }
        }
        const active = tabsFrom(
          await playerTabs.query({ active: true, lastFocusedWindow: true }),
        )[0];
        if (!isCurrent()) {
          return interrupted(command);
        }
        const queried = tabsFrom(
          await playerTabs.query({
            url: ["https://www.bilibili.com/video/*"],
          }),
        );
        if (command.type === "muzhi.video.seek") {
          const seekCommand = relayedCommand as RelayedSeekCommand;
          const watermark: SeekWatermarkCommand = Object.freeze({
            seekDispatch: seekCommand.seekDispatch,
            type: "muzhi.video.seek.watermark",
          });
          await Promise.allSettled(
            queried.map((tab) => playerTabs.sendMessage(tab.id, watermark)),
          );
        }
        if (!isCurrent()) {
          return interrupted(command);
        }
        const candidates = [
          ...(active !== undefined && matchesCommand(active, command)
            ? [active]
            : []),
          ...queried.filter(
            (tab) => matchesCommand(tab, command) && tab.id !== active?.id,
          ),
        ];
        for (const candidate of candidates) {
          const response = await sendToPlayer(
            candidate.id,
            command,
            relayedCommand,
            command.type === "muzhi.video.seek",
            isCurrent,
          );
          if (!isCurrent()) return interrupted(command);
          if (
            response.type === "muzhi.command.failed" &&
            response.error.code === "VIDEO_NOT_BOUND"
          ) {
            continue;
          }
          pendingSeekOpenConfirmations.delete(command.requestId);
          if (active?.id !== candidate.id && playerTabs.update) {
            if (!isCurrent()) return interrupted(command);
            await playerTabs.update(candidate.id, { active: true });
            if (!isCurrent()) return interrupted(command);
          }
          return response;
        }
        let target: PlayerTab | undefined;
        if (!isCurrent()) {
          return interrupted(command);
        }
        if (target === undefined && command.type === "muzhi.video.seek") {
          const fingerprint = seekOpenFingerprint(command);
          const pending = pendingSeekOpenConfirmations.get(command.requestId);
          if (
            pending === undefined ||
            pending.expiresAt <= now ||
            pending.fingerprint !== fingerprint
          ) {
            if (!isCurrent()) {
              return interrupted(command);
            }
            pendingSeekOpenConfirmations.set(
              command.requestId,
              Object.freeze({
                expiresAt: now + SEEK_OPEN_CONFIRMATION_TTL_MS,
                fingerprint,
              }),
            );
            return failure(
              command,
              "VIDEO_NOT_BOUND",
              "未找到对应视频页面；确认后可打开并跳转。",
              true,
            );
          }
          pendingSeekOpenConfirmations.delete(command.requestId);
          if (!isCurrent()) {
            return interrupted(command);
          }
          if (playerTabs.create === undefined) {
            return failure(
              command,
              "VIDEO_NOT_BOUND",
              "未找到对应视频页面，请重试。",
              true,
            );
          }
          target =
            tabFromCreated(
              await playerTabs.create({ url: canonicalSeekUrl(command) }),
            ) ?? undefined;
          if (!isCurrent()) {
            if (target !== undefined && playerTabs.remove) {
              await playerTabs.remove(target.id);
            }
            return interrupted(command);
          }
        }
        if (target !== undefined) {
          pendingSeekOpenConfirmations.delete(command.requestId);
        }
        if (target === undefined) {
          return failure(
            command,
            "VIDEO_NOT_BOUND",
            "未找到对应视频页面；点击字幕时间可打开并跳转。",
            false,
          );
        }
        return await sendToPlayer(
          target.id,
          command,
          relayedCommand,
          command.type === "muzhi.video.seek",
          isCurrent,
        );
      } catch {
        return failure(
          command,
          "UNSUPPORTED_CAPABILITY",
          "无法连接目标视频播放器，请等待页面加载后重试。",
          true,
        );
      }
    })().then(sendResponse, () =>
      sendResponse(
        failure(command, "INTERNAL_ERROR", "播放器操作失败，请重试。", true),
      ),
    );
    return true;
  };
  Reflect.apply(event.addListener, event.target, [listener]);
}
