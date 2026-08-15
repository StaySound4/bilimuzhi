const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_FIELD_BYTES = 1_000_000;

const encodedPathKeys = [
  [
    'nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`',
    "=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`bilibili",
  ],
  [
    'Bn"q~|albg@]Go~ACgyDvKnd+)_D}^&J?',
    "Cu~L!xs~f^&r@'vh=q]q{eeng*sEg^kp#Jbilibili",
  ],
] as const;

interface ReaderState {
  offset: number;
}

type FieldVisitor = (
  field: number,
  wireType: number,
  value: bigint | Uint8Array | undefined,
) => void;

const decoder = new TextDecoder("utf-8", { fatal: true });

function readVarint(bytes: Uint8Array, state: ReaderState): bigint {
  let result = 0n;
  let shift = 0n;
  while (state.offset < bytes.length && shift <= 63n) {
    const byte = bytes[state.offset++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
  }
  throw new Error("Invalid Bilibili subtitle protobuf varint");
}

function readBytes(bytes: Uint8Array, state: ReaderState): Uint8Array {
  const length = Number(readVarint(bytes, state));
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FIELD_BYTES) {
    throw new Error("Invalid Bilibili subtitle protobuf field length");
  }
  const end = state.offset + length;
  if (end > bytes.length) {
    throw new Error("Truncated Bilibili subtitle protobuf field");
  }
  const value = bytes.subarray(state.offset, end);
  state.offset = end;
  return value;
}

function skipFixed(
  bytes: Uint8Array,
  state: ReaderState,
  length: number,
): void {
  const end = state.offset + length;
  if (end > bytes.length) {
    throw new Error("Truncated Bilibili subtitle protobuf field");
  }
  state.offset = end;
}

function visitFields(bytes: Uint8Array, visitor: FieldVisitor): void {
  const state: ReaderState = { offset: 0 };
  while (state.offset < bytes.length) {
    const key = readVarint(bytes, state);
    const field = Number(key >> 3n);
    const wireType = Number(key & 0x07n);
    if (!Number.isSafeInteger(field) || field <= 0) {
      throw new Error("Invalid Bilibili subtitle protobuf field");
    }
    if (wireType === 0) {
      visitor(field, wireType, readVarint(bytes, state));
    } else if (wireType === 2) {
      visitor(field, wireType, readBytes(bytes, state));
    } else if (wireType === 1) {
      skipFixed(bytes, state, 8);
      visitor(field, wireType, undefined);
    } else if (wireType === 5) {
      skipFixed(bytes, state, 4);
      visitor(field, wireType, undefined);
    } else {
      throw new Error("Unsupported Bilibili subtitle protobuf wire type");
    }
  }
}

function text(value: bigint | Uint8Array | undefined): string {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Invalid Bilibili subtitle text field");
  }
  return decoder.decode(value);
}

function number(value: bigint | Uint8Array | undefined): number {
  if (typeof value !== "bigint") {
    throw new Error("Invalid Bilibili subtitle numeric field");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Unsafe Bilibili subtitle numeric field");
  }
  return result;
}

function decodeObfuscatedPath(value: string): string {
  for (const [prefix, key] of encodedPathKeys) {
    try {
      const encoded = decodeURIComponent(value);
      let decoded = "";
      for (let index = 0; index < encoded.length; index += 1) {
        decoded += String.fromCharCode(
          encoded.charCodeAt(index) ^ key.charCodeAt(index % key.length),
        );
      }
      if (decoded.startsWith(prefix)) {
        return decoded.slice(prefix.length);
      }
    } catch {
      // A different bounded key may match the current response.
    }
  }
  return "";
}

function normalizeWebViewUrl(value: string): string {
  const candidate = value.trim();
  const match =
    /^(?:https?:)?\/\/subtitle\.bilibili\.com\/([^?]+)(\?.*)?$/.exec(candidate);
  if (!match) return candidate;
  const path = decodeObfuscatedPath(match[1]);
  return path ? `https://aisubtitle.hdslb.com${path}${match[2] ?? ""}` : "";
}

function decodeTrack(bytes: Uint8Array): Record<string, unknown> {
  const track: Record<string, unknown> = {};
  visitFields(bytes, (field, wireType, value) => {
    if (wireType === 0) {
      if (field === 1) track.id = String(number(value));
      if (field === 7) track.type = number(value);
      if (field === 9) track.ai_type = number(value);
      return;
    }
    if (wireType !== 2) return;
    if (field === 2) track.id_str = text(value);
    if (field === 3) track.lan = text(value);
    if (field === 4) track.lan_doc = text(value);
    if (field === 5) track.subtitle_url = normalizeWebViewUrl(text(value));
    if (field === 8) track.lan_doc_brief = text(value);
  });
  if (track.id === undefined && typeof track.id_str === "string") {
    track.id = track.id_str;
  }
  return track;
}

function decodeVideoSubtitle(
  bytes: Uint8Array,
): readonly Record<string, unknown>[] {
  const tracks: Record<string, unknown>[] = [];
  visitFields(bytes, (field, wireType, value) => {
    if (field === 3 && wireType === 2 && value instanceof Uint8Array) {
      tracks.push(decodeTrack(value));
    }
  });
  return Object.freeze(tracks.map((track) => Object.freeze(track)));
}

export function decodeBilibiliSubtitleWebView(
  input: ArrayBuffer,
): readonly Record<string, unknown>[] {
  if (input.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Bilibili subtitle Web View response is too large");
  }
  let tracks: readonly Record<string, unknown>[] = Object.freeze([]);
  visitFields(new Uint8Array(input), (field, wireType, value) => {
    if (field === 1 && wireType === 2 && value instanceof Uint8Array) {
      tracks = decodeVideoSubtitle(value);
    }
  });
  return tracks;
}
