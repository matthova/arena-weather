// Renders the PWA icons (public/icons/*.png) without native image tooling: a tiny PNG encoder
// drawing the same motif as public/icons/icon.svg (blue rounded square, sun, cloud, rain).
// Run: node scripts/make-icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "public", "icons");
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const BLUE = hex("#1d6fe0");
const SUN = hex("#ffd966");
const WHITE = [255, 255, 255];
const RAIN = hex("#9cc5ff");

// Everything is drawn in the 512x512 coordinate system of icon.svg and scaled per output.
function render(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = 512 / size;
  const pad = maskable ? 0.1 : 0; // maskable: motif inside the safe zone, background fills everything
  const scale = 1 - 2 * pad;
  const inside = (x, y) => {
    // rounded square r=96 (ignored for maskable: full bleed)
    if (maskable) return true;
    const r = 96;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const cloud = (x, y) =>
    circle(x, y, 200, 300, 60) ||
    circle(x, y, 272, 258, 76) ||
    circle(x, y, 352, 300, 56) ||
    (x >= 160 && x <= 392 && y >= 300 && y <= 352);
  const drop = (x, y, x0) => {
    // tilted stroke from (x0, 392) to (x0-24, 448), width 18
    const dx = -24;
    const dy = 56;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - 392) * dy) / (dx * dx + dy * dy)));
    const px = x0 + dx * t;
    const py = 392 + dy * t;
    return (x - px) ** 2 + (y - py) ** 2 <= 81;
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 2x2 supersampling for soft edges
      let acc = [0, 0, 0, 0];
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const X = (px + ox) * s;
        const Y = (py + oy) * s;
        const x = (X - 256) / scale + 256;
        const y = (Y - 256) / scale + 256;
        let c = null;
        if (inside(X, Y)) c = BLUE;
        if (c) {
          if (circle(x, y, 200, 200, 88)) c = SUN;
          if (cloud(x, y)) c = WHITE;
          if (drop(x, y, 232) || drop(x, y, 296) || drop(x, y, 360)) c = RAIN;
        }
        if (c) acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + 255];
      }
      const i = (py * size + px) * 4;
      const a = acc[3] / 4;
      const cov = acc[3] / 255 || 1;
      buf[i] = Math.round(acc[0] / cov);
      buf[i + 1] = Math.round(acc[1] / cov);
      buf[i + 2] = Math.round(acc[2] / cov);
      buf[i + 3] = Math.round(a);
    }
  }
  return png(size, size, buf);
}

writeFileSync(path.join(out, "icon-192.png"), render(192));
writeFileSync(path.join(out, "icon-512.png"), render(512));
writeFileSync(path.join(out, "maskable-512.png"), render(512, { maskable: true }));
writeFileSync(path.join(out, "apple-touch-icon.png"), render(180));
writeFileSync(path.join(out, "badge-72.png"), render(72));
console.log("icons written to", out);
