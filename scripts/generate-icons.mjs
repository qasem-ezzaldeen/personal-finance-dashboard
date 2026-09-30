// Renders the AuraFinance mark to PNG app icons (no dependencies). Run: node scripts/generate-icons.mjs
// Colors mirror src/styles/colors.css (brand, brand-strong, swatch-butter, canvas).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CANVAS = hex("#fbf8f4"), TILE = hex("#cdeeee"), TRI = hex("#197478"), INNER = hex("#f5cf5f");

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function inRoundedRect(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// `inset` shrinks the logo (maskable icons need a safe zone); `rounded` false fills the square.
function render(size, { inset = 0, rounded = true } = {}) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    data[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = ((x + (sx + 0.5) / S) / size) * 48, v = ((y + (sy + 0.5) / S) / size) * 48;
        const k = 48 / (48 - 2 * inset), lu = (u - inset) * k, lv = (v - inset) * k; // logo space
        let c = null;
        if (rounded ? inRoundedRect(u, v, 48, 14) : true) c = rounded ? TILE : CANVAS;
        if (!rounded && lu >= 0 && lu <= 48 && lv >= 0 && lv <= 48 && inRoundedRect(lu, lv, 48, 14)) c = TILE;
        if (c && inTriangle(lu, lv, [24, 12], [37, 35], [11, 35])) c = TRI;
        if (c && inTriangle(lu, lv, [24, 22], [30.5, 33], [17.5, 33])) c = INNER;
        if (c) acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + 255];
      }
      const n = S * S, o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3] / n;
      data[o] = a ? Math.round(acc[0] / (acc[3] / 255)) : 0;
      data[o + 1] = a ? Math.round(acc[1] / (acc[3] / 255)) : 0;
      data[o + 2] = a ? Math.round(acc[2] / (acc[3] / 255)) : 0;
      data[o + 3] = Math.round(a);
    }
  }
  return png(size, data);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/pwa-192.png", render(192));
writeFileSync("public/pwa-512.png", render(512));
writeFileSync("public/pwa-maskable-512.png", render(512, { inset: 8, rounded: false }));
writeFileSync("public/apple-touch-icon.png", render(180, { inset: 4, rounded: false }));
console.log("Icons written to public/");
