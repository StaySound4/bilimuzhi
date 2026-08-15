import type {
  AttachmentProcessingPolicy,
  ProcessedAttachmentImage,
} from "../application/attachment-repository";
import type {
  AiProviderImageMimeType,
  AiProviderImageOutputDescriptor,
} from "../application/ai/provider-contract";
import {
  IMAGE_ATTACHMENT_MAX_BYTES,
  isImageAttachmentMimeType,
} from "../domain";

const MAX_IMAGE_EDGE = 4_096;
const THUMBNAIL_EDGE = 320;
const PROVIDER_IMAGE_MAX_BYTES = 5 * 1_024 * 1_024;

export interface DownloadedProviderImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly finalUrl: string;
}

export interface ProviderImageOutputProcessorDependencies {
  readonly download: (input: {
    readonly credentials: "omit";
    readonly redirect: "error";
    readonly url: string;
  }) => Promise<DownloadedProviderImage>;
  readonly reencode: (input: {
    readonly bytes: Uint8Array;
    readonly mimeType: AiProviderImageMimeType;
  }) => Promise<ProcessedAttachmentImage>;
}

export class ProviderImageOutputError extends Error {
  readonly code = "IMAGE_OUTPUT_REJECTED";
  readonly retryable = false;

  constructor() {
    super("The Provider image output was rejected");
    this.name = "ProviderImageOutputError";
  }
}

function rejectProviderImage(): never {
  throw new ProviderImageOutputError();
}

function safeProviderImageUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return rejectProviderImage();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejectProviderImage();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    /\.svg$/i.test(url.pathname)
  ) {
    return rejectProviderImage();
  }
  return url;
}

function normalizedContentType(value: unknown): AiProviderImageMimeType {
  if (typeof value !== "string") return rejectProviderImage();
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (
    mimeType !== "image/jpeg" &&
    mimeType !== "image/png" &&
    mimeType !== "image/webp"
  ) {
    return rejectProviderImage();
  }
  return mimeType;
}

function detectedImageMimeType(bytes: Uint8Array): AiProviderImageMimeType {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return rejectProviderImage();
}

function decodeBoundedBase64(value: string): Uint8Array {
  const maxEncodedLength = Math.ceil((PROVIDER_IMAGE_MAX_BYTES * 4) / 3) + 4;
  if (
    value.length === 0 ||
    value.length > maxEncodedLength ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return rejectProviderImage();
  }
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    return rejectProviderImage();
  }
  if (decoded.length === 0 || decoded.length > PROVIDER_IMAGE_MAX_BYTES) {
    return rejectProviderImage();
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function assertSafeProcessedProviderImage(
  image: ProcessedAttachmentImage,
): ProcessedAttachmentImage {
  if (
    !(image.blob instanceof Blob) ||
    image.blob.size <= 0 ||
    image.blob.size > PROVIDER_IMAGE_MAX_BYTES ||
    image.blob.type !== image.mimeType ||
    !isImageAttachmentMimeType(image.mimeType) ||
    !(image.thumbnailBlob instanceof Blob) ||
    image.thumbnailBlob.size <= 0 ||
    !isImageAttachmentMimeType(image.thumbnailBlob.type) ||
    !Number.isSafeInteger(image.width) ||
    image.width <= 0 ||
    !Number.isSafeInteger(image.height) ||
    image.height <= 0
  ) {
    return rejectProviderImage();
  }
  return Object.freeze({
    blob: image.blob,
    height: image.height,
    mimeType: image.mimeType,
    thumbnailBlob: image.thumbnailBlob,
    width: image.width,
  });
}

/**
 * Validates an untrusted Provider descriptor, then returns only freshly
 * re-encoded local pixels. URLs and inline base64 never cross this boundary.
 */
export function createProviderImageOutputProcessor(
  dependencies: ProviderImageOutputProcessorDependencies,
): (
  descriptor: AiProviderImageOutputDescriptor,
) => Promise<ProcessedAttachmentImage> {
  return async (descriptor) => {
    let bytes: Uint8Array;
    let declaredMimeType: AiProviderImageMimeType;
    if (descriptor.kind === "remote") {
      const requestedUrl = safeProviderImageUrl(descriptor.url);
      let downloaded: DownloadedProviderImage;
      try {
        downloaded = await dependencies.download({
          credentials: "omit",
          redirect: "error",
          url: requestedUrl.toString(),
        });
      } catch {
        return rejectProviderImage();
      }
      if (
        !(downloaded.bytes instanceof Uint8Array) ||
        downloaded.bytes.length === 0 ||
        downloaded.bytes.length > PROVIDER_IMAGE_MAX_BYTES
      ) {
        return rejectProviderImage();
      }
      const finalUrl = safeProviderImageUrl(downloaded.finalUrl);
      if (finalUrl.origin !== requestedUrl.origin) {
        return rejectProviderImage();
      }
      bytes = downloaded.bytes;
      declaredMimeType = normalizedContentType(downloaded.contentType);
    } else {
      declaredMimeType = normalizedContentType(descriptor.mimeType);
      bytes = decodeBoundedBase64(descriptor.base64);
    }
    if (detectedImageMimeType(bytes) !== declaredMimeType) {
      return rejectProviderImage();
    }
    try {
      return assertSafeProcessedProviderImage(
        await dependencies.reencode({ bytes, mimeType: declaredMimeType }),
      );
    } catch {
      return rejectProviderImage();
    }
  };
}

export interface DecodedAttachmentImage {
  readonly height: number;
  readonly source: CanvasImageSource;
  readonly width: number;
  close(): void;
}

export interface ImageAttachmentProcessorDependencies {
  readonly decode?: (file: File) => Promise<DecodedAttachmentImage>;
  readonly encode?: (
    image: DecodedAttachmentImage,
    options: {
      readonly height: number;
      readonly mimeType: "image/webp";
      readonly quality: number;
      readonly width: number;
    },
  ) => Promise<Blob>;
}

function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { readonly height: number; readonly width: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

async function decodeWithBrowser(file: File): Promise<DecodedAttachmentImage> {
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error("Image processing is unavailable in this browser context");
  }
  const bitmap = await globalThis.createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    bitmap.close();
    throw new Error("The selected image has invalid dimensions");
  }
  return Object.freeze({
    close: () => bitmap.close(),
    height: bitmap.height,
    source: bitmap,
    width: bitmap.width,
  });
}

function encodeHtmlCanvas(
  image: DecodedAttachmentImage,
  options: Parameters<
    NonNullable<ImageAttachmentProcessorDependencies["encode"]>
  >[1],
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("Image encoding is unavailable in this browser context");
  }
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("Unable to create an image canvas");
  context.drawImage(image.source, 0, 0, options.width, options.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null
          ? reject(new Error("Unable to encode the selected image"))
          : resolve(blob),
      options.mimeType,
      options.quality,
    );
  });
}

async function encodeWithBrowser(
  image: DecodedAttachmentImage,
  options: Parameters<
    NonNullable<ImageAttachmentProcessorDependencies["encode"]>
  >[1],
): Promise<Blob> {
  if (typeof OffscreenCanvas === "undefined") {
    return encodeHtmlCanvas(image, options);
  }
  const canvas = new OffscreenCanvas(options.width, options.height);
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("Unable to create an image canvas");
  context.drawImage(image.source, 0, 0, options.width, options.height);
  return canvas.convertToBlob({
    quality: options.quality,
    type: options.mimeType,
  });
}

function normalizedEncodedBlob(blob: Blob): Blob {
  if (blob.size <= 0 || !isImageAttachmentMimeType(blob.type)) {
    throw new Error("The browser returned an invalid processed image");
  }
  return blob;
}

export function createImageAttachmentProcessor(
  dependencies: ImageAttachmentProcessorDependencies = {},
): (
  file: File,
  policy?: AttachmentProcessingPolicy,
) => Promise<ProcessedAttachmentImage> {
  const decode = dependencies.decode ?? decodeWithBrowser;
  const encode = dependencies.encode ?? encodeWithBrowser;
  return async (
    file,
    policy = {
      correctOrientation: true,
      maxBytes: IMAGE_ATTACHMENT_MAX_BYTES,
      stripMetadata: true,
    },
  ) => {
    if (!isImageAttachmentMimeType(file.type)) {
      throw new Error("Only PNG, JPEG, and WebP images are supported");
    }
    if (
      policy.correctOrientation !== true ||
      policy.stripMetadata !== true ||
      !Number.isSafeInteger(policy.maxBytes) ||
      policy.maxBytes <= 0 ||
      policy.maxBytes > IMAGE_ATTACHMENT_MAX_BYTES
    ) {
      throw new Error("The image processing policy is invalid");
    }

    const decoded = await decode(file);
    try {
      let dimensions = scaledSize(
        decoded.width,
        decoded.height,
        MAX_IMAGE_EDGE,
      );
      let processed: Blob | null = null;
      // Re-encoding pixels through a fresh canvas both normalizes decoded
      // orientation and drops every original metadata segment.
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const quality = Math.max(0.42, 0.88 - iteration * 0.06);
        const candidate = normalizedEncodedBlob(
          await encode(decoded, {
            ...dimensions,
            mimeType: "image/webp",
            quality,
          }),
        );
        if (candidate.size <= policy.maxBytes) {
          processed = candidate;
          break;
        }
        dimensions = {
          height: Math.max(1, Math.floor(dimensions.height * 0.82)),
          width: Math.max(1, Math.floor(dimensions.width * 0.82)),
        };
      }
      if (processed === null) {
        throw new Error("The processed image exceeds the 5 MiB limit");
      }
      const thumbnailDimensions = scaledSize(
        decoded.width,
        decoded.height,
        THUMBNAIL_EDGE,
      );
      const thumbnailBlob = normalizedEncodedBlob(
        await encode(decoded, {
          ...thumbnailDimensions,
          mimeType: "image/webp",
          quality: 0.72,
        }),
      );
      return Object.freeze({
        blob: processed,
        height: dimensions.height,
        mimeType: "image/webp" as const,
        thumbnailBlob,
        width: dimensions.width,
      });
    } finally {
      decoded.close();
    }
  };
}

export const processImageAttachment = createImageAttachmentProcessor();
