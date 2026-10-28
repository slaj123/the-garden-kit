// Draws the home-screen icon (a sprout in a terracotta pot on leaf green)
// as PNGs with no dependencies: shapes are signed-distance tests,
// 4x4 supersampled, written with Node's built-in zlib.
// Run: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x2b, 0x5c, 0x35];
const LEAF = [0x9c, 0xd0, 0x8f];
const STEM = [0xf3, 0xea, 0xd9];
const POT = [0xa9, 0x66, 0x2f];
const RIM = [0xc9, 0x8a, 0x4c];

// Coordinates in a 0..1 square.
function ellipse(x, y, cx, cy, rx, ry, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dy = y - cy;
  const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
  return u * u + v * v <= 1;
}
function rect(x, y, x0, y0, x1, y1) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
function trapezoid(x, y, top, bot, yTop, yBot, cx) {
  if (y < yTop || y > yBot) return false;
  const t = (y - yTop) / (yBot - yTop);
  const half = (top + (bot - top) * t) / 2;
  return Math.abs(x - cx) <= half;
}

function colorAt(x, y, maskable) {
  // Maskable icons get cropped to a circle by Android; keep art in the middle 70%.
  const k = maskable ? 0.78 : 1;
  x = 0.5 + (x - 0.5) / k;
  y = 0.5 + (y - 0.5) / k;
  if (rect(x, y, 0.27, 0.6, 0.73, 0.66)) return RIM;
  if (trapezoid(x, y, 0.42, 0.32, 0.66, 0.84, 0.5)) return POT;
  if (ellipse(x, y, 0.36, 0.38, 0.15, 0.075, -0.55)) return LEAF;
  if (ellipse(x, y, 0.63, 0.31, 0.16, 0.08, 0.6)) return LEAF;
  if (rect(x, y, 0.485, 0.24, 0.515, 0.6)) return STEM;
  return BG;
}

function png(size, maskable) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

writeFileSync("public/apple-touch-icon.png", png(180, false));
writeFileSync("public/icon-192.png", png(192, false));
writeFileSync("public/icon-512.png", png(512, false));
writeFileSync("public/icon-maskable-512.png", png(512, true));
console.log("icons written");
