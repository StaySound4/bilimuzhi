export interface BilibiliWbiKeys {
  readonly imgKey: string;
  readonly subKey: string;
}

export type BilibiliWbiParameter = string | number | boolean;

interface BilibiliWbiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

interface BilibiliWbiUrlSignerDependencies {
  /**
   * Restricts which page identity may act as the referer for a signed call.
   * The subtitle chain keeps the default exact-video-page rule; batch listing
   * opts into space/search pages explicitly instead of widening it globally.
   */
  readonly allowReferer?: (url: URL) => boolean;
  /** Adds the per-request DNR discriminator before `w_rid` is calculated. */
  readonly createRequestNonce?: () => string;
  readonly fetch: (
    url: string,
    init: {
      readonly credentials: "include";
      readonly headers: Readonly<Record<string, string>>;
      readonly method: "GET";
    },
  ) => Promise<BilibiliWbiResponse>;
  readonly now?: () => number;
}

export interface BilibiliWbiUrlSigner {
  sign(
    pathname: string,
    parameters: Readonly<Record<string, BilibiliWbiParameter>>,
    referer: string,
  ): Promise<string>;
}

const MIXIN_KEY_ORDER = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]);

const MD5_SHIFT = Object.freeze([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
]);

const MD5_CONSTANT = Object.freeze(
  Array.from(
    { length: 64 },
    (_, index) =>
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
  ),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidWbiResponse(): Error {
  return new Error("The Bilibili WBI response is invalid");
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function md5(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const lengthView = new DataView(padded.buffer);
  const bitLength = BigInt(input.length) * 8n;
  lengthView.setUint32(
    paddedLength - 8,
    Number(bitLength & 0xffff_ffffn),
    true,
  );
  lengthView.setUint32(paddedLength - 4, Number(bitLength >> 32n), true);

  let stateA = 0x67452301;
  let stateB = 0xefcdab89;
  let stateC = 0x98badcfe;
  let stateD = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const block = new DataView(padded.buffer, offset, 64);
    const words = Array.from({ length: 16 }, (_, index) =>
      block.getUint32(index * 4, true),
    );
    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;

    for (let index = 0; index < 64; index += 1) {
      let mixed: number;
      let wordIndex: number;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const sum = (a + mixed + MD5_CONSTANT[index] + words[wordIndex]) >>> 0;
      b = (b + rotateLeft(sum, MD5_SHIFT[index])) >>> 0;
      a = previousD;
    }

    stateA = (stateA + a) >>> 0;
    stateB = (stateB + b) >>> 0;
    stateC = (stateC + c) >>> 0;
    stateD = (stateD + d) >>> 0;
  }

  return [stateA, stateB, stateC, stateD]
    .flatMap((word) => [0, 8, 16, 24].map((shift) => (word >>> shift) & 0xff))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extractKey(value: unknown): string {
  if (typeof value !== "string") throw invalidWbiResponse();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidWbiResponse();
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.hostname.endsWith(".hdslb.com")
  ) {
    throw invalidWbiResponse();
  }
  const match = /\/bfs\/wbi\/([0-9a-f]{32})\.[A-Za-z0-9]+$/.exec(url.pathname);
  if (!match) throw invalidWbiResponse();
  return match[1];
}

export function extractBilibiliWbiKeys(value: unknown): BilibiliWbiKeys {
  if (
    !isRecord(value) ||
    value.code !== 0 ||
    !isRecord(value.data) ||
    !isRecord(value.data.wbi_img)
  ) {
    throw invalidWbiResponse();
  }
  return Object.freeze({
    imgKey: extractKey(value.data.wbi_img.img_url),
    subKey: extractKey(value.data.wbi_img.sub_url),
  });
}

export function signBilibiliWbiParameters(
  parameters: Readonly<Record<string, BilibiliWbiParameter>>,
  keys: BilibiliWbiKeys,
  timestampSeconds: number,
): string {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error("The Bilibili WBI timestamp is invalid");
  }
  const sourceKey = keys.imgKey + keys.subKey;
  if (!/^[0-9a-f]{64}$/.test(sourceKey)) throw invalidWbiResponse();
  const mixinKey = MIXIN_KEY_ORDER.map((index) => sourceKey[index])
    .join("")
    .slice(0, 32);
  const entries = Object.entries({ ...parameters, wts: timestampSeconds })
    .map(([key, value]) => {
      if (!/^[A-Za-z0-9_]{1,64}$/.test(key)) {
        throw new Error("The Bilibili WBI parameter is invalid");
      }
      const normalized = String(value).replace(/[!'()*]/g, "");
      return [key, normalized] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
  const query = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

export function createBilibiliWbiUrlSigner(
  dependencies: BilibiliWbiUrlSignerDependencies,
): BilibiliWbiUrlSigner {
  const now = dependencies.now ?? Date.now;
  const cacheTtlMs = 10 * 60 * 1_000;
  let cached: { readonly at: number; readonly keys: BilibiliWbiKeys } | null =
    null;
  let pending: Promise<BilibiliWbiKeys> | null = null;

  const loadKeys = async (referer: string): Promise<BilibiliWbiKeys> => {
    const currentTime = now();
    if (cached !== null && currentTime - cached.at < cacheTtlMs) {
      return cached.keys;
    }
    if (pending !== null) return pending;
    pending = (async () => {
      let response: BilibiliWbiResponse;
      try {
        response = await dependencies.fetch(
          "https://api.bilibili.com/x/web-interface/nav",
          {
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*",
              Referer: referer,
            },
            method: "GET",
          },
        );
      } catch {
        throw new Error("Unable to load the Bilibili WBI keys");
      }
      if (!response.ok || !Number.isInteger(response.status)) {
        throw new Error("Unable to load the Bilibili WBI keys");
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw invalidWbiResponse();
      }
      const keys = extractBilibiliWbiKeys(value);
      cached = Object.freeze({ at: now(), keys });
      return keys;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };

  const signer: BilibiliWbiUrlSigner = {
    async sign(
      pathname: string,
      parameters: Readonly<Record<string, BilibiliWbiParameter>>,
      referer: string,
    ) {
      if (!/^\/x\/[A-Za-z0-9/_-]{1,128}$/.test(pathname)) {
        throw new Error("The Bilibili WBI endpoint is invalid");
      }
      let refererUrl: URL;
      try {
        refererUrl = new URL(referer);
      } catch {
        throw new Error("The Bilibili WBI referer is invalid");
      }
      const allowReferer =
        dependencies.allowReferer ??
        ((candidate: URL) =>
          candidate.hostname === "www.bilibili.com" &&
          candidate.pathname.startsWith("/video/"));
      if (refererUrl.protocol !== "https:" || !allowReferer(refererUrl)) {
        throw new Error("The Bilibili WBI referer is invalid");
      }
      const keys = await loadKeys(refererUrl.toString());
      const timestampSeconds = Math.floor(now() / 1_000);
      let signedParameters = parameters;
      if (dependencies.createRequestNonce !== undefined) {
        if (Object.hasOwn(parameters, "_muzhi_request_nonce")) {
          throw new Error("The Bilibili WBI request nonce is invalid");
        }
        const nonce = dependencies.createRequestNonce();
        if (!/^[0-9A-Za-z-]{16,128}$/.test(nonce)) {
          throw new Error("The Bilibili WBI request nonce is invalid");
        }
        signedParameters = Object.freeze({
          ...parameters,
          _muzhi_request_nonce: nonce,
        });
      }
      return `https://api.bilibili.com${pathname}?${signBilibiliWbiParameters(
        signedParameters,
        keys,
        timestampSeconds,
      )}`;
    },
  };
  return Object.freeze(signer);
}
