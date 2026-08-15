#!/usr/bin/env node
/**
 * PNG 基础工具：SHA-256、PNG 头尺寸解析、纯色 PNG 生成（fixture 用）、CSS 颜色解析与相对亮度。
 *
 * 仅依赖 Node 内置模块；供 check-visual-evidence 入口与单元测试复用。
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

/** 计算 buffer 的 SHA-256（小写 hex）。 */
export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** 是否为合法 PNG 签名。 */
export function isPng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(PNG_SIGNATURE)
  );
}

/**
 * 从 PNG 头部 IHDR 解析像素尺寸。
 * 布局：签名(8) + 长度(4) + "IHDR"(4) + width(4) + height(4)。
 * @throws 非 PNG 或缺少 IHDR 时抛出 Error。
 */
export function parsePngSize(buffer) {
  if (!isPng(buffer)) {
    throw new Error("不是合法 PNG 文件（签名缺失或文件过短）");
  }
  if (buffer.length < 24) {
    throw new Error("PNG 文件过短，无法读取 IHDR");
  }
  const type = buffer.toString("ascii", 12, 16);
  if (type !== "IHDR") {
    throw new Error("PNG 缺少 IHDR 块");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

// —— 纯色 PNG 生成（测试夹具用，不参与产品路径） ——

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...chunks) {
  let c = 0xffffffff;
  for (const chunk of chunks) {
    for (const byte of chunk) {
      c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeBuf, data), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 生成一张纯色 RGB PNG（8bit、无隔行、单 IDAT）。
 * @param {number} width 像素宽（>0）
 * @param {number} height 像素高（>0）
 * @param {[number,number,number]} [rgb] 像素颜色
 */
export function createPngBuffer(width, height, [r, g, b] = [0xcc, 0xcc, 0xcc]) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`无效 PNG 尺寸：${width}x${height}`);
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    throw new Error("PNG 尺寸超出支持范围");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    raw.set(row, y * (1 + width * 3));
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 解析 CSS 颜色为 [r,g,b]；支持 #rgb / #rrggbb / rgb(r,g,b)。
 * 解析失败返回 null。
 */
export function parseCssColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  const s = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    return [
      parseInt(m[1].slice(0, 2), 16),
      parseInt(m[1].slice(2, 4), 16),
      parseInt(m[1].slice(4, 6), 16),
    ];
  }
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const h = m[1];
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

/** 相对亮度（WCAG 定义，0..1）。 */
export function relativeLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
