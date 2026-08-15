import { readFile } from "node:fs/promises";

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright/test";

type LoopbackServer = {
  address(): null | string | { readonly port: number };
  close(callback: (error?: Error) => void): void;
  listen(
    options: {
      readonly exclusive: boolean;
      readonly host: string;
      readonly port: number;
    },
    callback: () => void,
  ): void;
  once(event: "error", listener: (error: Error) => void): void;
};

declare const process: {
  cwd(): string;
  getBuiltinModule(name: "node:net"): {
    createServer(): LoopbackServer;
  };
};
declare const chrome: {
  readonly runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  readonly storage: {
    readonly local: {
      get(keys: null): Promise<Record<string, unknown>>;
    };
  };
};

const SPEECH_VIDEO = Object.freeze({
  bvid: "BV1Q541167Qg",
  cid: 30_000_000_123,
  sessionId: "session-speech-e2e",
  title: "E2E 语音视频",
  videoKey: "bvid:BV1Q541167Qg:cid:30000000123:p:1",
});

const GROQ_FIXTURE_TOKEN = "fixture-groq-token";
const GROQ_OFFSCREEN_PATH = "offscreen.html";
const GROQ_TRANSCRIPTION_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIPTION_RESPONSE = JSON.stringify({
  language: "zh",
  segments: [
    { end: 1, start: 0, text: "E2E 语音字幕第一句" },
    { end: 2, start: 1, text: "E2E 语音字幕第二句" },
  ],
  text: "E2E 语音字幕第一句 E2E 语音字幕第二句",
});

const BILIBILI_API_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-headers": "accept, content-type",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-origin": "https://www.bilibili.com",
  vary: "Origin",
};

const BILIBILI_CDN_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
};

type GroqOffscreenInterceptionState = {
  readonly attachedProvisionalTargets: number;
  readonly identityVerifiedTargets: number;
  readonly interceptionFailures: number;
  readonly invalidAuthorizationRequests: number;
  readonly requestPausedEvents: number;
  readonly transcriptionRequests: number;
};

type GroqOffscreenInterception = {
  readonly dispose: () => Promise<void>;
  readonly readState: () => Promise<GroqOffscreenInterceptionState>;
  readonly transcriptionStarted: Promise<void>;
};

const CDP_COMMAND_TIMEOUT_MS = 5_000;
const CDP_DISPOSAL_TIMEOUT_MS = 10_000;

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(message)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const server = process.getBuiltinModule("node:net").createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ exclusive: true, host: "127.0.0.1", port: 0 }, resolve);
    });
    const address = server.address();
    if (
      typeof address !== "object" ||
      address === null ||
      !Number.isSafeInteger(address.port) ||
      address.port <= 0
    ) {
      throw new Error("Chromium debugging port reservation failed");
    }
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readBrowserWebSocketUrl(port: number): Promise<string> {
  return await withTimeout(
    (async () => {
      for (;;) {
        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/json/version`,
            { signal: AbortSignal.timeout(1_000) },
          );
          if (response.ok) {
            const payload = readRecord((await response.json()) as unknown);
            const value = payload?.webSocketDebuggerUrl;
            if (typeof value === "string") {
              const url = new URL(value);
              if (
                url.protocol === "ws:" &&
                (url.hostname === "127.0.0.1" ||
                  url.hostname === "localhost") &&
                Number(url.port) === port
              ) {
                return value;
              }
            }
          }
        } catch {
          // Chromium may not have opened the reserved debugging port yet.
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      }
    })(),
    CDP_DISPOSAL_TIMEOUT_MS,
    "Chromium browser debugging endpoint timed out",
  );
}

async function installGroqOffscreenInterception(
  extensionId: string,
  remoteDebuggingPort: number,
): Promise<GroqOffscreenInterception> {
  const offscreenUrl = `chrome-extension://${extensionId}/${GROQ_OFFSCREEN_PATH}`;
  const responseBytes = new TextEncoder().encode(GROQ_TRANSCRIPTION_RESPONSE);
  const responseBody = globalThis.btoa(String.fromCharCode(...responseBytes));
  const webSocketUrl = await readBrowserWebSocketUrl(remoteDebuggingPort);
  const socket = new WebSocket(webSocketUrl);
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Browser CDP WebSocket failed to open")),
        { once: true },
      );
    }),
    CDP_COMMAND_TIMEOUT_MS,
    "Browser CDP WebSocket open timed out",
  );

  type PendingCommand = {
    reject(): void;
    resolve(value: unknown): void;
  };
  type AttachedTarget = {
    identityVerified: boolean;
    matchingRequestPaused: boolean;
    readonly resolveVerification: (verified: boolean) => void;
    readonly sessionId: string;
    readonly targetId: string;
    type: string;
    url: string;
    readonly verification: Promise<boolean>;
    verificationSettled: boolean;
    readonly verificationTimer: ReturnType<typeof setTimeout>;
  };
  const state = {
    attachedProvisionalTargets: 0,
    identityVerifiedTargets: 0,
    interceptionFailures: 0,
    invalidAuthorizationRequests: 0,
    requestPausedEvents: 0,
    transcriptionRequests: 0,
  };
  const pendingCommands = new Map<number, PendingCommand>();
  const attachedTargets = new Map<string, AttachedTarget>();
  const discoveredTargets = new Map<
    string,
    { readonly type: string; readonly url: string }
  >();
  const targetSessions = new Map<string, string>();
  const requestTasks = new Set<Promise<void>>();
  let disposing = false;
  let nextCommandId = 1;
  let transcriptionStartSettled = false;
  let resolveTranscriptionStarted: (() => void) | null = null;
  let rejectTranscriptionStarted: ((reason: Error) => void) | null = null;
  const transcriptionStarted = new Promise<void>((resolve, reject) => {
    resolveTranscriptionStarted = resolve;
    rejectTranscriptionStarted = reject;
  });
  void transcriptionStarted.catch(() => undefined);
  const startTimer = globalThis.setTimeout(() => {
    if (transcriptionStartSettled) return;
    transcriptionStartSettled = true;
    rejectTranscriptionStarted?.(
      new Error(
        `No intercepted Groq request was observed; lifecycle counters: provisional=${state.attachedProvisionalTargets}, verified=${state.identityVerifiedTargets}, paused=${state.requestPausedEvents}, failures=${state.interceptionFailures}`,
      ),
    );
  }, 12_000);
  const failTranscriptionStart = (reason: Error): void => {
    if (transcriptionStartSettled) return;
    transcriptionStartSettled = true;
    globalThis.clearTimeout(startTimer);
    rejectTranscriptionStarted?.(reason);
  };
  const markTranscriptionStarted = (): void => {
    if (transcriptionStartSettled) return;
    transcriptionStartSettled = true;
    globalThis.clearTimeout(startTimer);
    resolveTranscriptionStarted?.();
  };

  const send = async (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> => {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error("Browser CDP WebSocket is not open");
    }
    const id = nextCommandId;
    nextCommandId += 1;
    return await new Promise<unknown>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        pendingCommands.delete(id);
        reject(new Error("Browser CDP command timed out"));
      }, CDP_COMMAND_TIMEOUT_MS);
      pendingCommands.set(id, {
        reject: () => {
          globalThis.clearTimeout(timer);
          reject(new Error("Browser CDP command failed"));
        },
        resolve: (value) => {
          globalThis.clearTimeout(timer);
          resolve(value);
        },
      });
      try {
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId === undefined ? {} : { sessionId }),
          }),
        );
      } catch {
        const pending = pendingCommands.get(id);
        pendingCommands.delete(id);
        pending?.reject();
      }
    });
  };

  const closeTarget = async (targetId: string): Promise<void> => {
    try {
      await send("Target.closeTarget", { targetId });
    } catch {
      // Closing the browser context remains the final fail-closed boundary.
    }
  };

  const trackTask = (task: Promise<void>): void => {
    const tracked = task
      .catch(() => {
        state.interceptionFailures += 1;
      })
      .finally(() => requestTasks.delete(tracked));
    requestTasks.add(tracked);
  };

  const settleVerification = (
    target: AttachedTarget,
    verified: boolean,
  ): void => {
    if (target.verificationSettled) return;
    target.verificationSettled = true;
    globalThis.clearTimeout(target.verificationTimer);
    target.resolveVerification(verified);
  };

  const rejectTargetIdentity = async (
    target: AttachedTarget,
  ): Promise<void> => {
    settleVerification(target, false);
    if (target.matchingRequestPaused) {
      await closeTarget(target.targetId);
    } else {
      try {
        await send("Fetch.disable", {}, target.sessionId);
        await send("Target.detachFromTarget", { sessionId: target.sessionId });
      } catch {
        await closeTarget(target.targetId);
      }
    }
    attachedTargets.delete(target.sessionId);
    targetSessions.delete(target.targetId);
  };

  const applyTargetIdentity = async (
    target: AttachedTarget,
    info: { readonly type: string; readonly url: string },
  ): Promise<void> => {
    target.type = info.type;
    target.url = info.url;
    if (info.type === "background_page" && info.url === offscreenUrl) {
      if (!target.identityVerified) {
        target.identityVerified = true;
        state.identityVerifiedTargets += 1;
      }
      settleVerification(target, true);
      return;
    }
    if (info.type === "other" && info.url === "") return;
    await rejectTargetIdentity(target);
  };

  const handleAttachedTarget = async (
    sessionId: string,
    targetId: string,
    type: string,
    url: string,
  ): Promise<void> => {
    const latest = discoveredTargets.get(targetId) ?? { type, url };
    const provisional = latest.type === "other" && latest.url === "";
    const directlyVerified =
      latest.type === "background_page" && latest.url === offscreenUrl;
    if (!provisional && !directlyVerified) {
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
      await send("Target.detachFromTarget", { sessionId });
      return;
    }

    let resolveVerification: (verified: boolean) => void = () => undefined;
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve;
    });
    const target = {
      identityVerified: false,
      matchingRequestPaused: false,
      resolveVerification,
      sessionId,
      targetId,
      type: latest.type,
      url: latest.url,
      verification,
      verificationSettled: false,
      verificationTimer: globalThis.setTimeout(() => {
        const current = attachedTargets.get(sessionId);
        if (current === undefined || current.verificationSettled) return;
        trackTask(rejectTargetIdentity(current));
      }, CDP_COMMAND_TIMEOUT_MS),
    } satisfies AttachedTarget;
    attachedTargets.set(sessionId, target);
    targetSessions.set(targetId, sessionId);
    if (provisional) state.attachedProvisionalTargets += 1;
    if (disposing) {
      await closeTarget(targetId);
      return;
    }
    try {
      await send(
        "Fetch.enable",
        {
          patterns: [
            {
              requestStage: "Request",
              urlPattern: GROQ_TRANSCRIPTION_ENDPOINT,
            },
          ],
        },
        sessionId,
      );
      if (directlyVerified) {
        await applyTargetIdentity(target, latest);
      } else {
        const current = discoveredTargets.get(targetId);
        if (current !== undefined) await applyTargetIdentity(target, current);
      }
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    } catch {
      failTranscriptionStart(
        new Error("Offscreen target interception configuration failed"),
      );
      await closeTarget(targetId);
      throw new Error("Offscreen target interception configuration failed");
    }
  };

  const handleRequestPaused = async (
    sessionId: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    state.requestPausedEvents += 1;
    const requestId = params.requestId;
    const request = readRecord(params.request);
    const url = request?.url;
    if (typeof requestId !== "string" || typeof url !== "string") {
      const target = attachedTargets.get(sessionId);
      if (target) await closeTarget(target.targetId);
      failTranscriptionStart(new Error("Paused Groq request was malformed"));
      throw new Error("Paused Groq request was malformed");
    }
    if (url !== GROQ_TRANSCRIPTION_ENDPOINT) {
      await send("Fetch.continueRequest", { requestId }, sessionId);
      return;
    }

    const target = attachedTargets.get(sessionId);
    if (target === undefined) {
      failTranscriptionStart(
        new Error("Paused Groq request has no attached target identity"),
      );
      throw new Error("Paused Groq request has no attached target identity");
    }
    target.matchingRequestPaused = true;
    state.transcriptionRequests += 1;
    const identityVerified =
      target.identityVerified ||
      (await withTimeout(
        target.verification,
        CDP_COMMAND_TIMEOUT_MS,
        "Offscreen target identity verification timed out",
      ));
    if (!identityVerified || !target.identityVerified) {
      await closeTarget(target.targetId);
      failTranscriptionStart(
        new Error("Offscreen target identity was not verified"),
      );
      throw new Error("Offscreen target identity was not verified");
    }
    const headers = readRecord(request?.headers);
    const validAuthorization =
      headers !== null &&
      Object.entries(headers).some(
        ([name, value]) =>
          name.toLowerCase() === "authorization" &&
          value === `Bearer ${GROQ_FIXTURE_TOKEN}`,
      );
    if (!validAuthorization) {
      state.invalidAuthorizationRequests += 1;
      await closeTarget(target.targetId);
      failTranscriptionStart(
        new Error("Fixture Authorization header mismatch"),
      );
      throw new Error("Fixture Authorization header mismatch");
    }
    markTranscriptionStarted();
    await new Promise((resolve) =>
      globalThis.setTimeout(
        resolve,
        state.transcriptionRequests === 1 ? 5_000 : 50,
      ),
    );
    try {
      await send(
        "Fetch.fulfillRequest",
        {
          body: responseBody,
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "content-type", value: "application/json" },
          ],
        },
        sessionId,
      );
    } catch {
      await closeTarget(target.targetId);
      throw new Error("Groq fixture fulfillment failed");
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (typeof event.data !== "string") {
      state.interceptionFailures += 1;
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(event.data) as unknown;
    } catch {
      state.interceptionFailures += 1;
      return;
    }
    const record = readRecord(message);
    if (record === null) return;
    if (typeof record.id === "number") {
      const pending = pendingCommands.get(record.id);
      if (pending === undefined) return;
      pendingCommands.delete(record.id);
      if (readRecord(record.error)) pending.reject();
      else pending.resolve(record.result);
      return;
    }
    const params = readRecord(record.params);
    if (
      record.method === "Target.targetCreated" ||
      record.method === "Target.targetInfoChanged"
    ) {
      const targetInfo = readRecord(params?.targetInfo);
      const targetId = targetInfo?.targetId;
      const type = targetInfo?.type;
      const url = targetInfo?.url;
      if (
        typeof targetId !== "string" ||
        typeof type !== "string" ||
        typeof url !== "string"
      ) {
        state.interceptionFailures += 1;
        return;
      }
      if (type !== "other" && type !== "background_page") return;
      const info = { type, url };
      discoveredTargets.set(targetId, info);
      const sessionId = targetSessions.get(targetId);
      const target =
        sessionId === undefined ? undefined : attachedTargets.get(sessionId);
      if (target !== undefined) trackTask(applyTargetIdentity(target, info));
      return;
    }
    if (record.method === "Target.attachedToTarget") {
      const targetInfo = readRecord(params?.targetInfo);
      const sessionId = params?.sessionId;
      const targetId = targetInfo?.targetId;
      const type = targetInfo?.type;
      const url = targetInfo?.url;
      if (
        typeof sessionId !== "string" ||
        typeof targetId !== "string" ||
        typeof type !== "string" ||
        typeof url !== "string"
      ) {
        state.interceptionFailures += 1;
        return;
      }
      trackTask(handleAttachedTarget(sessionId, targetId, type, url));
      return;
    }
    if (
      record.method === "Target.detachedFromTarget" &&
      typeof params?.sessionId === "string"
    ) {
      const target = attachedTargets.get(params.sessionId);
      if (target !== undefined) {
        settleVerification(target, false);
        attachedTargets.delete(params.sessionId);
        targetSessions.delete(target.targetId);
      }
      return;
    }
    if (
      record.method === "Fetch.requestPaused" &&
      typeof record.sessionId === "string" &&
      params !== null
    ) {
      trackTask(handleRequestPaused(record.sessionId, params));
    }
  };
  const onSocketError = (): void => {
    state.interceptionFailures += 1;
    failTranscriptionStart(new Error("Browser CDP WebSocket failed"));
    for (const pending of pendingCommands.values()) pending.reject();
    pendingCommands.clear();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onSocketError);

  try {
    await send("Target.setDiscoverTargets", {
      discover: true,
      filter: [{}],
    });
    await send("Target.setAutoAttach", {
      autoAttach: true,
      filter: [
        { type: "other" },
        { type: "background_page" },
        { exclude: true },
      ],
      flatten: true,
      waitForDebuggerOnStart: true,
    });
  } catch (reason: unknown) {
    await send("Target.setDiscoverTargets", { discover: false }).catch(
      () => undefined,
    );
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onSocketError);
    socket.close();
    throw reason;
  }

  const readState = async (): Promise<GroqOffscreenInterceptionState> => ({
    attachedProvisionalTargets: state.attachedProvisionalTargets,
    identityVerifiedTargets: state.identityVerifiedTargets,
    interceptionFailures: state.interceptionFailures,
    invalidAuthorizationRequests: state.invalidAuthorizationRequests,
    requestPausedEvents: state.requestPausedEvents,
    transcriptionRequests: state.transcriptionRequests,
  });

  let disposePromise: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      disposing = true;
      globalThis.clearTimeout(startTimer);
      await Promise.race([
        Promise.all([...requestTasks]),
        new Promise<void>((resolve) =>
          globalThis.setTimeout(resolve, CDP_DISPOSAL_TIMEOUT_MS),
        ),
      ]);
      for (const target of attachedTargets.values()) {
        settleVerification(target, false);
        await closeTarget(target.targetId);
      }
      try {
        await send("Target.setDiscoverTargets", { discover: false });
        await send("Target.setAutoAttach", {
          autoAttach: false,
          flatten: true,
          waitForDebuggerOnStart: false,
        });
      } finally {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onSocketError);
        for (const pending of pendingCommands.values()) pending.reject();
        pendingCommands.clear();
        attachedTargets.clear();
        discoveredTargets.clear();
        targetSessions.clear();
        const closed = new Promise<void>((resolve) =>
          socket.addEventListener("close", () => resolve(), { once: true }),
        );
        socket.close(1000);
        await withTimeout(
          closed,
          CDP_COMMAND_TIMEOUT_MS,
          "Browser CDP WebSocket close timed out",
        );
      }
    })();
    return disposePromise;
  };

  return Object.freeze({ dispose, readState, transcriptionStarted });
}

async function seedBilibiliLogin(context: BrowserContext): Promise<void> {
  const runtimeOnlyValue = globalThis.crypto.randomUUID().replaceAll("-", "");
  await context.addCookies([
    {
      domain: ".bilibili.com",
      expires: Math.floor(Date.now() / 1_000) + 3_600,
      httpOnly: true,
      name: "SESSDATA",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: runtimeOnlyValue,
    },
  ]);
}

async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
  remoteDebuggingPort: number;
}> {
  const extensionDirectory = `${process.cwd().replaceAll("\\", "/")}/dist/extension`;
  const remoteDebuggingPort = await reserveLoopbackPort();
  const context = await chromium.launchPersistentContext("", {
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      `--remote-debugging-port=${remoteDebuggingPort}`,
    ],
    channel: "chromium",
    headless: true,
  });
  await seedBilibiliLogin(context);
  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent("serviceworker");
  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
    remoteDebuggingPort,
  };
}

async function openSidePanel(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

async function expectSpeechVideoBinding(
  page: Page,
  options: { readonly hasSubtitle: boolean },
): Promise<void> {
  const boundVideo = page.getByRole("region", { name: "已绑定视频" });
  await expect(boundVideo).toBeVisible();
  await expect(
    boundVideo.getByRole("heading", {
      exact: true,
      level: 2,
      name: SPEECH_VIDEO.title,
    }),
  ).toBeVisible();
  await expect(
    boundVideo.getByText(SPEECH_VIDEO.bvid, { exact: true }),
  ).toBeVisible();
  await expect(boundVideo.getByText("P 1", { exact: true })).toBeVisible();
  await expect(
    boundVideo.getByText("页面已切换、关闭或未连接", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "BV 号或完整 URL" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "同步当前页面" })).toHaveCount(
    0,
  );
  await expect(
    boundVideo.getByRole("button", { name: "重新获取" }),
  ).toHaveCount(options.hasSubtitle ? 1 : 0);
}

async function readSessionRuleCount(context: BrowserContext): Promise<number> {
  const serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker)
    throw new Error("Extension Service Worker is unavailable");
  return await serviceWorker.evaluate(async () => {
    const chromeValue: unknown = Reflect.get(globalThis, "chrome");
    const dnr =
      typeof chromeValue === "object" && chromeValue !== null
        ? Reflect.get(chromeValue, "declarativeNetRequest")
        : null;
    const getSessionRules =
      typeof dnr === "object" && dnr !== null
        ? Reflect.get(dnr, "getSessionRules")
        : null;
    if (typeof getSessionRules !== "function") {
      throw new Error("Chrome DNR API is unavailable");
    }
    const rules = await Reflect.apply(getSessionRules, dnr, []);
    return Array.isArray(rules) ? rules.length : -1;
  });
}

async function terminateServiceWorkerAndWaitForHeartbeatRecovery(
  context: BrowserContext,
  controllerPage: Page,
  extensionId: string,
): Promise<void> {
  const session: CDPSession = await context.newCDPSession(controllerPage);
  const serviceWorkerUrl = `chrome-extension://${extensionId}/service-worker.js`;
  const readTargetId = async (): Promise<string | null> => {
    const result = (await session.send("Target.getTargets")) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    return (
      result.targetInfos.find(
        (target) =>
          target.type === "service_worker" && target.url === serviceWorkerUrl,
      )?.targetId ?? null
    );
  };
  const previousTargetId = await readTargetId();
  if (previousTargetId === null) {
    throw new Error("The extension Service Worker target is unavailable");
  }
  await session.send("Target.closeTarget", { targetId: previousTargetId });
  await expect
    .poll(readTargetId, {
      intervals: [250, 500, 1_000],
      timeout: 30_000,
    })
    .not.toBe(previousTargetId);
  await expect
    .poll(readTargetId, {
      intervals: [250, 500, 1_000],
      timeout: 30_000,
    })
    .not.toBeNull();
  await session.detach();
}

async function waitForTranscriptionRequest(
  page: Page,
  transcriptionStarted: Promise<void>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      transcriptionStarted,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void page
            .evaluate(async () => {
              const values = await chrome.storage.local.get(null);
              return Object.entries(values)
                .filter(([key]) =>
                  key.startsWith("muzhi.speech.acquisition.v1:"),
                )
                .map(([, value]) => {
                  const record = value as {
                    errorCode?: unknown;
                    progress?: unknown;
                    status?: unknown;
                  };
                  return {
                    errorCode: record.errorCode ?? null,
                    progress: record.progress ?? null,
                    status: record.status ?? null,
                  };
                });
            })
            .then(
              (records) =>
                reject(
                  new Error(
                    `Groq transcription did not start; safe task state: ${JSON.stringify(records)}`,
                  ),
                ),
              reject,
            );
        }, 15_000);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForSpeechCompletion(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if (
          (await page
            .getByText("已更新当前语音字幕，共 2 行。", { exact: true })
            .count()) > 0
        ) {
          return "completed";
        }
        if (
          (await page
            .getByText("E2E 语音字幕第一句", { exact: true })
            .count()) > 0 &&
          (await page
            .getByText("E2E 语音字幕第二句", { exact: true })
            .count()) > 0
        ) {
          return "completed";
        }
        return await page.evaluate(async () => {
          const visibleText = document.body.innerText.slice(0, 2_000);
          const values = await chrome.storage.local.get(null);
          const tasks = Object.entries(values)
            .filter(([key]) => key.startsWith("muzhi.speech.acquisition.v1:"))
            .map(([, value]) => {
              const record = value as {
                errorCode?: unknown;
                progress?: unknown;
                status?: unknown;
              };
              return {
                errorCode: record.errorCode ?? null,
                progress: record.progress ?? null,
                status: record.status ?? null,
              };
            });
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("muzhi");
            request.addEventListener("success", () => resolve(request.result), {
              once: true,
            });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          });
          const transaction = database.transaction(
            ["sessions", "subtitleBranches", "subtitleSnapshots"],
            "readonly",
          );
          const readAll = (store: string) =>
            new Promise<unknown[]>((resolve, reject) => {
              const request = transaction.objectStore(store).getAll();
              request.addEventListener(
                "success",
                () => resolve(request.result),
                { once: true },
              );
              request.addEventListener("error", () => reject(request.error), {
                once: true,
              });
            });
          const [sessions, branches, snapshots] = await Promise.all([
            readAll("sessions"),
            readAll("subtitleBranches"),
            readAll("subtitleSnapshots"),
          ]);
          database.close();
          return JSON.stringify({
            branchCount: branches.length,
            sessionActiveBranchId:
              (sessions[0] as { activeBranchId?: unknown } | undefined)
                ?.activeBranchId ?? null,
            snapshotCount: snapshots.length,
            tasks,
            visibleText,
          });
        });
      },
      { timeout: 30_000 },
    )
    .toBe("completed");
}

async function seedSpeechWorkspace(page: Page): Promise<void> {
  await page.evaluate(
    async ({ groqToken, video }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("muzhi");
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      const transaction = database.transaction(
        ["sessions", "videos", "workspaceSessionPlacements"],
        "readwrite",
      );
      transaction.objectStore("videos").add({
        bvid: video.bvid,
        canonicalUrl: `https://www.bilibili.com/video/${video.bvid}`,
        cid: video.cid,
        durationSec: 2,
        page: 1,
        title: video.title,
        videoKey: video.videoKey,
      });
      transaction.objectStore("sessions").add({
        activeBranchId: null,
        createdAt: 1_000,
        customTitle: false,
        lastActivityAt: 2_000,
        selectionRevision: 0,
        sessionId: video.sessionId,
        title: video.title,
        updatedAt: 2_000,
        videoKey: video.videoKey,
      });
      transaction.objectStore("workspaceSessionPlacements").add({
        order: 2_000,
        pinned: false,
        sessionId: video.sessionId,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener("abort", () => reject(transaction.error), {
          once: true,
        });
        transaction.addEventListener("error", () => reject(transaction.error), {
          once: true,
        });
      });
      database.close();

      const chromeValue: unknown = Reflect.get(globalThis, "chrome");
      if (typeof chromeValue !== "object" || chromeValue === null) {
        throw new Error("Chrome extension API is unavailable");
      }
      const storage: unknown = Reflect.get(chromeValue, "storage");
      const local: unknown =
        typeof storage === "object" && storage !== null
          ? Reflect.get(storage, "local")
          : null;
      const set: unknown =
        typeof local === "object" && local !== null
          ? Reflect.get(local, "set")
          : null;
      const get: unknown =
        typeof local === "object" && local !== null
          ? Reflect.get(local, "get")
          : null;
      if (typeof get !== "function" || typeof set !== "function") {
        throw new Error("Chrome local storage API is unavailable");
      }
      const storedValues = (await Reflect.apply(get, local, [
        "muzhi.settings.v12",
      ])) as Record<string, unknown>;
      const v12Settings = storedValues["muzhi.settings.v12"];
      if (
        typeof v12Settings !== "object" ||
        v12Settings === null ||
        Reflect.get(v12Settings, "version") !== 12
      ) {
        throw new Error("V12 settings projection is unavailable");
      }
      await Reflect.apply(set, local, [
        {
          "muzhi.settings.secret.v12": {
            groqApiKey: groqToken,
            providerApiKeys: {},
            removedProviderKeyIds: [],
            version: 12,
          },
          "muzhi.settings.v12": {
            ...v12Settings,
            speech: { groqApiKeyConfigured: true },
          },
          "muzhi.settings.v1": {
            appearance: { theme: "system" },
            provider: {
              baseUrl: "https://api.openai.com/v1",
              protocol: "openai",
              providerId: "openai",
              selectedModel: null,
            },
            retention: {
              applyMode: "future-only",
              policy: { durationDays: 7, kind: "duration" },
            },
            version: 1,
          },
          "muzhi.workspace.v1": {
            activeSessionId: video.sessionId,
            sessions: [
              {
                activeMode: "timeline",
                scrollTopByMode: {
                  chat: 0,
                  segments: 0,
                  summary: 0,
                  timeline: 0,
                },
                sessionId: video.sessionId,
              },
            ],
            version: 1,
          },
        },
      ]);
    },
    { groqToken: GROQ_FIXTURE_TOKEN, video: SPEECH_VIDEO },
  );
}

async function readSpeechResult(page: Page): Promise<{
  branchCount: number;
  detectedLanguage: string | null;
  rows: Array<{ endMs: number; startMs: number; text: string }>;
  source: string | null;
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("muzhi");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const transaction = database.transaction(
      ["sessions", "subtitleBranches", "subtitleSnapshots"],
      "readonly",
    );
    const readAll = <T>(request: IDBRequest<T[]>): Promise<T[]> =>
      new Promise((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
    const [sessions, branches, snapshots] = await Promise.all([
      readAll<Record<string, unknown>>(
        transaction.objectStore("sessions").getAll(),
      ),
      readAll<Record<string, unknown>>(
        transaction.objectStore("subtitleBranches").getAll(),
      ),
      readAll<Record<string, unknown>>(
        transaction.objectStore("subtitleSnapshots").getAll(),
      ),
    ]);
    database.close();

    const session = sessions.find(
      (item) => item.sessionId === "session-speech-e2e",
    );
    const activeBranch = branches.find(
      (item) => item.branchId === session?.activeBranchId,
    );
    const activeSnapshot = snapshots.find(
      (item) => item.subtitleId === activeBranch?.activeSubtitleId,
    );
    return {
      branchCount: branches.length,
      detectedLanguage:
        typeof activeBranch?.detectedLanguage === "string"
          ? activeBranch.detectedLanguage
          : null,
      rows: Array.isArray(activeSnapshot?.rows)
        ? (activeSnapshot.rows as Array<{
            endMs: number;
            startMs: number;
            text: string;
          }>)
        : [],
      source:
        typeof activeBranch?.source === "string" ? activeBranch.source : null,
    };
  });
}

test("transcribes intercepted complete audio through the real extension runtime", async () => {
  test.setTimeout(120_000);
  const audio = await readFile(
    `${process.cwd()}/tests/fixtures/audio/speech-sample.mp3`,
  );
  const mediaUrl = "https://fixture.bilivideo.com/audio/speech-sample.mp3";
  const { context, extensionId, remoteDebuggingPort } = await launchExtension();
  let groqInterception: GroqOffscreenInterception | null = null;
  let mediaRequests = 0;
  const sessionRuleCountsDuringPageRequests: number[] = [];
  try {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    await context.route(
      new RegExp(
        `^https://www\\.bilibili\\.com/video/${SPEECH_VIDEO.bvid}/?(?:\\?.*)?$`,
      ),
      async (route) =>
        route.fulfill({
          body: "<!doctype html><html><body><main>fixture video</main></body></html>",
          contentType: "text/html",
          status: 200,
        }),
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/,
      async (route) => {
        expect(new URL(route.request().url()).searchParams.get("bvid")).toBe(
          SPEECH_VIDEO.bvid,
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              aid: 88_000_123,
              bvid: SPEECH_VIDEO.bvid,
              pages: [
                {
                  cid: SPEECH_VIDEO.cid,
                  duration: 2,
                  page: 1,
                },
              ],
              title: SPEECH_VIDEO.title,
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/v2\?/,
      async (route) => {
        sessionRuleCountsDuringPageRequests.push(
          await readSessionRuleCount(context),
        );
        await route.fulfill({
          body: JSON.stringify({ code: 0, data: {} }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(
      /^https:\/\/api\.bilibili\.com\/x\/player\/playurl\?/,
      async (route) => {
        sessionRuleCountsDuringPageRequests.push(
          await readSessionRuleCount(context),
        );
        await route.fulfill({
          body: JSON.stringify({
            code: 0,
            data: {
              dash: {
                audio: [{ bandwidth: 32_000, baseUrl: mediaUrl }],
                duration: 2,
              },
              timelength: 2_000,
            },
          }),
          contentType: "application/json",
          headers: BILIBILI_API_CORS_HEADERS,
          status: 200,
        });
      },
    );
    await context.route(mediaUrl, async (route) => {
      mediaRequests += 1;
      await route.fulfill({
        body: audio,
        headers: {
          ...BILIBILI_CDN_CORS_HEADERS,
          "content-length": String(audio.byteLength),
          "content-type": "audio/mpeg",
        },
        status: 200,
      });
    });
    await context.route(
      "https://api.groq.com/openai/v1/models",
      async (route) =>
        route.fulfill({
          body: JSON.stringify({ data: [{ id: "whisper-large-v3" }] }),
          contentType: "application/json",
          status: 200,
        }),
    );
    let page = await openSidePanel(context, extensionId);
    await seedSpeechWorkspace(page);
    await page.reload();

    await expectSpeechVideoBinding(page, { hasSubtitle: false });
    const acquisitionSelection = page.getByRole("region", {
      name: "选择字幕来源",
    });
    await expect(acquisitionSelection).toBeVisible();
    await expect(
      acquisitionSelection.getByRole("button", {
        name: "获取视频自带字幕",
      }),
    ).toBeVisible();
    const start = page.getByRole("button", { name: "开始语音转字幕" });
    await expect(start).toBeEnabled();
    groqInterception = await installGroqOffscreenInterception(
      extensionId,
      remoteDebuggingPort,
    );
    const bilibiliPage = await context.newPage();
    await bilibiliPage.goto(
      `https://www.bilibili.com/video/${SPEECH_VIDEO.bvid}?p=1`,
    );
    await bilibiliPage.bringToFront();
    const started = await page.evaluate(async (videoKey) => {
      return await chrome.runtime.sendMessage({
        payload: {
          requestedLanguageMode: "mixed",
          routingMode: "balanced",
          videoKey,
        },
        protocolVersion: 1,
        requestId: "speech-e2e-start",
        type: "muzhi.speech.start",
      });
    }, SPEECH_VIDEO.videoKey);
    expect(started).toMatchObject({ type: "muzhi.speech.started" });

    await waitForTranscriptionRequest(
      page,
      groqInterception.transcriptionStarted,
    );
    await page.close();
    await terminateServiceWorkerAndWaitForHeartbeatRecovery(
      context,
      bilibiliPage,
      extensionId,
    );
    page = await openSidePanel(context, extensionId);

    await waitForSpeechCompletion(page);
    await expect(page.getByText("E2E 语音字幕第一句")).toBeAttached();
    await expect(page.getByText("E2E 语音字幕第二句")).toBeAttached();
    expect(mediaRequests).toBe(2);
    const interceptionState = await groqInterception.readState();
    expect(interceptionState.attachedProvisionalTargets).toBeGreaterThan(0);
    expect(interceptionState.identityVerifiedTargets).toBeGreaterThan(0);
    expect(interceptionState.requestPausedEvents).toBe(2);
    expect(interceptionState.transcriptionRequests).toBe(2);
    expect(interceptionState.invalidAuthorizationRequests).toBe(0);
    expect(interceptionState.interceptionFailures).toBe(0);
    expect(sessionRuleCountsDuringPageRequests.length).toBeGreaterThan(0);
    expect(
      sessionRuleCountsDuringPageRequests.every((count) => count === 0),
    ).toBe(true);
    await expect.poll(() => readSessionRuleCount(context)).toBe(0);

    const persisted = await readSpeechResult(page);
    expect(persisted).toEqual({
      branchCount: 1,
      detectedLanguage: "zh",
      rows: [
        { endMs: 1_000, startMs: 0, text: "E2E 语音字幕第一句" },
        { endMs: 2_000, startMs: 1_000, text: "E2E 语音字幕第二句" },
      ],
      source: "groq-whisper",
    });

    await page.reload();
    await expectSpeechVideoBinding(page, { hasSubtitle: true });
    await expect(page.getByText("E2E 语音字幕第一句")).toBeAttached();
  } finally {
    try {
      await groqInterception?.dispose();
    } finally {
      await context.close();
    }
  }
});
