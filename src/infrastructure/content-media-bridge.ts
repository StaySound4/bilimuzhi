type SafeMediaPageMessage = Readonly<Record<string, string | number>>;

interface ContentMediaRuntime {
  sendMessage(message: SafeMediaPageMessage): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeMediaPageMessage(
  value: unknown,
): SafeMediaPageMessage | null {
  if (
    !isRecord(value) ||
    value.__muzhiMedia !== true ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9._-]{1,96}$/.test(value.requestId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  if (value.type === "muzhi.media.started") {
    if (
      typeof value.byteLength !== "number" ||
      !Number.isSafeInteger(value.byteLength) ||
      value.byteLength <= 0 ||
      value.byteLength > 1_000_000_000 ||
      typeof value.mimeType !== "string" ||
      !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]{1,96}$/.test(value.mimeType)
    ) {
      return null;
    }
    return Object.freeze({
      byteLength: value.byteLength,
      mimeType: value.mimeType,
      requestId: value.requestId,
      type: value.type,
    });
  }
  if (value.type === "muzhi.media.chunk") {
    if (
      typeof value.index !== "number" ||
      !Number.isSafeInteger(value.index) ||
      value.index < 0 ||
      typeof value.data !== "string" ||
      value.data.length === 0 ||
      value.data.length > 1_400_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)
    ) {
      return null;
    }
    return Object.freeze({
      data: value.data,
      index: value.index,
      requestId: value.requestId,
      type: value.type,
    });
  }
  if (value.type === "muzhi.media.completed") {
    if (
      typeof value.byteLength !== "number" ||
      !Number.isSafeInteger(value.byteLength) ||
      value.byteLength <= 0 ||
      value.byteLength > 1_000_000_000
    ) {
      return null;
    }
    return Object.freeze({
      byteLength: value.byteLength,
      requestId: value.requestId,
      type: value.type,
    });
  }
  if (value.type === "muzhi.media.failed") {
    return Object.freeze({
      requestId: value.requestId,
      type: value.type,
    });
  }
  return null;
}

export function installContentMediaBridge(
  runtime: ContentMediaRuntime,
  targetWindow: Window,
): void {
  targetWindow.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      event.source !== targetWindow ||
      event.origin !== targetWindow.location.origin
    ) {
      return;
    }
    const message = sanitizeMediaPageMessage(event.data);
    if (message === null) return;
    void runtime.sendMessage(message).catch(() => undefined);
  });
}
