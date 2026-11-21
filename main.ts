// SOLMARA — a travel poster for a place that does not exist.
//
// Renders a 1024x1024 travel poster procedurally (no assets, no network,
// fully deterministic) and writes it to /output/entry.png
// (or $OUTPUT_DIR/entry.png for local testing).
//
// Scene: golden hour over a turquoise lagoon. One landmark — a great
// natural stone arch rising out of the water — a low sun, a lone sailboat,
// a dark headland with palms. The invented place name SOLMARA is set in
// large cream type across the sky, as the judge's brief requires.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const W = 1024;
const H = 1024;
const HORIZON = 560;

type RGB = [number, number, number];

// ---------- deterministic PRNG ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

// Cheap deterministic value noise from integer coordinates (blocky grain).
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
}

// ---------- framebuffer ----------
const buf = new Uint8ClampedArray(W * H * 3);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Gradient lookup over [r,g,b] stops.
function gradient(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

function setPx(x: number, y: number, c: RGB, a = 1): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  if (a >= 1) {
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
  } else {
    buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
  }
}

// Soft filled ellipse (radial falloff) for glow / clouds.
function softEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: RGB,
  alpha: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1) {
        const a = alpha * (1 - d) * (1 - d);
        setPx(x, y, c, a);
      }
    }
  }
}

// Thick line segment (round caps) — used for palms, birds, boat mast.
function thickLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  c: RGB,
  a = 1,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const r = w / 2;
  const x0 = Math.floor(Math.min(x1, x2) - r);
  const x1b = Math.ceil(Math.max(x1, x2) + r);
  const y0 = Math.floor(Math.min(y1, y2) - r);
  const y1b = Math.ceil(Math.max(y1, y2) + r);
  for (let y = y0; y <= y1b; y++) {
    for (let x = x0; x <= x1b; x++) {
      let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
      t = clamp(t, 0, 1);
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < r) {
        const aa = smoothstep(r, r - 1, d);
        setPx(x, y, c, a * aa);
      }
    }
  }
}

// ---------- sky ----------
const SKY: Array<[number, RGB]> = [
  [0, [36, 27, 77]], // deep indigo
  [0.35, [91, 42, 104]], // violet
  [0.6, [182, 74, 110]], // rose
  [0.82, [239, 131, 84]], // orange
  [1, [249, 196, 107]], // gold at the horizon
];
for (let y = 0; y < HORIZON; y++) {
  const c = gradient(SKY, y / HORIZON);
  // faint grain so the gradient does not band
  const g = (hash2(0, y) - 0.5) * 3;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buf[i] = clamp(c[0] + g, 0, 255);
    buf[i + 1] = clamp(c[1] + g, 0, 255);
    buf[i + 2] = clamp(c[2] + g, 0, 255);
  }
}

// ---------- sun + glow ----------
const SUN_X = 300;
const SUN_Y = 468;
const SUN_R = 62;
softEllipse(SUN_X, SUN_Y, 260, 260, [255, 190, 110], 0.35);
softEllipse(SUN_X, SUN_Y, 150, 150, [255, 220, 140], 0.45);
for (let y = SUN_Y - SUN_R; y <= SUN_Y + SUN_R; y++) {
  for (let x = SUN_X - SUN_R; x <= SUN_X + SUN_R; x++) {
    const d = Math.hypot(x - SUN_X, y - SUN_Y);
    if (d < SUN_R) {
      const edge = smoothstep(SUN_R, SUN_R - 3, d);
      const core: RGB = [255, 241, 196];
      const rim: RGB = [255, 205, 120];
      const c = mix(core, rim, d / SUN_R);
      setPx(x, y, c, 0.35 + 0.65 * edge);
    }
  }
}

// ---------- clouds (soft, below the name band) ----------
softEllipse(140, 300, 150, 20, [255, 217, 192], 0.22);
softEllipse(210, 322, 110, 15, [255, 200, 175], 0.18);
softEllipse(880, 306, 160, 22, [255, 214, 185], 0.22);
softEllipse(790, 332, 100, 14, [255, 196, 170], 0.16);
softEllipse(620, 348, 130, 16, [255, 208, 180], 0.16);

// ---------- distant headland on the left horizon ----------
for (let x = 0; x < 520; x++) {
  const ridge =
    HORIZON - (16 + 13 * Math.sin(x * 0.008 + 1.3) + 7 * Math.sin(x * 0.021 + 0.5));
  for (let y = Math.floor(ridge); y < HORIZON; y++) {
    const haze = 0.25 + 0.75 * ((y - ridge) / Math.max(1, HORIZON - ridge));
    setPx(x, y, mix([61, 35, 80], [120, 70, 96], 1 - haze), 0.85);
  }
}

// ---------- sea ----------
const SEA: Array<[number, RGB]> = [
  [0, [27, 122, 114]], // sunlit teal at the horizon
  [0.35, [17, 96, 106]],
  [0.7, [12, 69, 86]],
  [1, [8, 46, 64]], // deep water
];
for (let y = HORIZON; y < H; y++) {
  const t = (y - HORIZON) / (H - HORIZON);
  const c = gradient(SEA, t);
  for (let x = 0; x < W; x++) {
    const g = (hash2(x >> 2, y >> 2) - 0.5) * 5;
    const i = (y * W + x) * 3;
    buf[i] = clamp(c[0] + g, 0, 255);
    buf[i + 1] = clamp(c[1] + g, 0, 255);
    buf[i + 2] = clamp(c[2] + g, 0, 255);
  }
}

// Sun reflection: a soft golden column under the sun, with sparse glints.
for (let y = HORIZON + 2; y < H; y++) {
  const spread = 40 + (y - HORIZON) * 0.14;
  for (let x = Math.floor(SUN_X - spread); x <= SUN_X + spread; x++) {
    const fall = Math.exp(-(((x - SUN_X) / spread) ** 2) * 1.8);
    const shimmer = 0.75 + 0.25 * Math.sin(y * 0.35 + Math.sin(x * 0.05) * 2);
    const a =
      0.3 * fall * shimmer * (1 - ((y - HORIZON) / (H - HORIZON)) * 0.6);
    if (a > 0.02) setPx(x, y, [255, 205, 130], a);
  }
}
// bright glints: short horizontal dashes inside the column
for (let k = 0; k < 30; k++) {
  const gy = HORIZON + 8 + rand() * (H - HORIZON - 20);
  const spread = 40 + (gy - HORIZON) * 0.14;
  const gx = SUN_X + (rand() * 2 - 1) * spread * 0.7;
  const gl = 18 + rand() * 46;
  for (let s = 0; s < gl; s++) {
    setPx(gx + s, gy, [255, 226, 160], 0.5);
    setPx(gx + s, gy + 1, [255, 226, 160], 0.3);
  }
}

// Wave streaks: thin lighter lines with a slight wobble.
for (let k = 0; k < 46; k++) {
  const wy = HORIZON + 12 + rand() * (H - HORIZON - 30);
  const wx = rand() * W;
  const wl = 40 + rand() * 160;
  const wob = rand() * 6;
  for (let s = 0; s < wl; s++) {
    const x = wx + s;
    const y = wy + Math.sin(s * 0.05 + wob) * 1.2;
    setPx(x, y, [140, 210, 205], 0.10 + rand() * 0.08);
  }
}

// ---------- the great stone arch (the landmark) ----------
const ARCH_CX = 640;
const ARCH_CY = 720;
const ARCH_RX = 150;
const ARCH_RY = 380;
const ARCH_RX_IN = 95;
const ARCH_RY_IN = 330;
const ARCH_BASE = 782;
// dark water shadow under the arch
softEllipse(ARCH_CX, ARCH_BASE + 6, 185, 20, [6, 38, 54], 0.4);
for (let y = ARCH_CY - ARCH_RY; y <= ARCH_BASE; y++) {
  for (let x = ARCH_CX - ARCH_RX; x <= ARCH_CX + ARCH_RX; x++) {
    const out = ((x - ARCH_CX) / ARCH_RX) ** 2 + ((y - ARCH_CY) / ARCH_RY) ** 2;
    const inn =
      ((x - ARCH_CX) / ARCH_RX_IN) ** 2 + ((y - ARCH_CY) / ARCH_RY_IN) ** 2;
    if (out <= 1 && inn >= 1) {
      // warm rock: lit on the left (sun side), shadowed on the right
      const xT = (x - (ARCH_CX - ARCH_RX)) / (2 * ARCH_RX);
      const yT = (y - (ARCH_CY - ARCH_RY)) / (2 * ARCH_RY);
      const lit: RGB = [233, 165, 88];
      const mid: RGB = [185, 107, 78];
      const shad: RGB = [110, 67, 88];
      let c = mix(lit, mid, clamp(xT * 1.1, 0, 1));
      c = mix(c, shad, clamp((xT - 0.55) * 1.4, 0, 1) * 0.85);
      c = mix(c, [244, 190, 120], (1 - yT) * 0.18); // warm top light
      const g = (hash2(x >> 2, y >> 2) - 0.5) * 12;
      setPx(x, y, [clamp(c[0] + g, 0, 255), clamp(c[1] + g, 0, 255), clamp(c[2] + g, 0, 255)]);
    }
  }
}
// thin warm rim light on the arch's left edge
for (let a = Math.PI * 0.55; a <= Math.PI * 1.45; a += 0.004) {
  const x = ARCH_CX + Math.cos(a) * (ARCH_RX - 4);
  const y = ARCH_CY + Math.sin(a) * (ARCH_RY - 4);
  if (y <= ARCH_BASE) setPx(x, y, [255, 217, 160], 0.55);
}

// ---------- sailboat (small, right of the arch) ----------
const BOAT_X = 838;
const BOAT_Y = 800;
thickLine(BOAT_X, BOAT_Y - 42, BOAT_X, BOAT_Y, 3, [40, 26, 48]);
for (let i = 0; i < 22; i++) {
  // white sail: triangle from mast to the right
  const t = i / 22;
  const sx = BOAT_X + 2 + t * 30;
  const sy = BOAT_Y - 40 + t * 36;
  for (let yy = Math.floor(sy); yy <= BOAT_Y - 4; yy++) {
    setPx(sx, yy, [255, 246, 226], 0.95);
  }
}
for (let i = 0; i < 34; i++) {
  const x = BOAT_X - 16 + i;
  const y = BOAT_Y + Math.sin(i * 0.22) * 1.5;
  setPx(x, y, [38, 24, 46]);
  setPx(x, y + 1, [38, 24, 46]);
  setPx(x, y + 2, [38, 24, 46]);
  setPx(x, y + 3, [38, 24, 46]);
}
// boat reflection
for (let i = 0; i < 26; i++) {
  const x = BOAT_X - 12 + i;
  setPx(x, BOAT_Y + 8 + (i % 3), [255, 240, 220], 0.25);
}

// ---------- foreground headland + palms (bottom left) ----------
// smooth dune-like silhouette: top edge curves gently down to the right
const HEAD: RGB = [36, 19, 57];
for (let x = 0; x <= 340; x++) {
  const topY = 895 + 55 * (x / 340) ** 2;
  for (let y = Math.floor(topY); y < H; y++) {
    setPx(x, y, HEAD, y < topY + 2 ? 0.75 : 1);
  }
}
function palm(bx: number, by: number, hgt: number, lean: number): void {
  const topX = bx + lean;
  const topY = by - hgt;
  // trunk: a gentle curve, drawn as small discs
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const x = lerp(bx, topX, t) + Math.sin(t * 2.2) * 8;
    const y = lerp(by, topY, t);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 9) setPx(x + dx, y + dy, [26, 14, 46]);
      }
    }
  }
  // fronds: drooping arcs from the crown
  const fronds: Array<[number, number]> = [
    [-52, -6],
    [-40, -26],
    [-16, -38],
    [14, -36],
    [40, -22],
    [54, -2],
  ];
  for (const [fx, fy] of fronds) {
    const mx = topX + fx * 0.55;
    const my = topY + fy * 0.55 + 10;
    const ex = topX + fx;
    const ey = topY + fy + 26;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const x = (1 - t) * (1 - t) * topX + 2 * (1 - t) * t * mx + t * t * ex;
      const y = (1 - t) * (1 - t) * topY + 2 * (1 - t) * t * my + t * t * ey;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy <= 9) setPx(x + dx, y + dy, [26, 14, 46]);
        }
      }
    }
  }
}
palm(110, 902, 150, 34);
palm(230, 922, 112, 26);

// ---------- birds ----------
const BIRD: RGB = [44, 24, 64];
const birds: Array<[number, number, number]> = [
  [680, 268, 11],
  [742, 300, 9],
  [600, 318, 8],
  [842, 258, 10],
  [180, 344, 9],
];
for (const [bx, by, s] of birds) {
  thickLine(bx - s, by, bx, by + s * 0.45, 2.4, BIRD, 0.85);
  thickLine(bx, by + s * 0.45, bx + s, by, 2.4, BIRD, 0.85);
}

// ---------- frame ----------
const CREAM: RGB = [255, 243, 214];
const INSET = 26;
for (let x = INSET; x <= W - INSET; x++) {
  for (let w = 0; w < 5; w++) {
    setPx(x, INSET + w, CREAM, 0.95);
    setPx(x, H - INSET - w, CREAM, 0.95);
  }
}
for (let y = INSET; y <= H - INSET; y++) {
  for (let w = 0; w < 5; w++) {
    setPx(INSET + w, y, CREAM, 0.95);
    setPx(W - INSET - w, y, CREAM, 0.95);
  }
}

// ---------- the name: SOLMARA in stroke type ----------
// Glyphs as polylines on a 5-wide x 7-tall grid (y down).
type Seg = [number, number, number, number];
const GLYPHS: Record<string, Seg[]> = {
  S: [
    [4, 1.2, 3, 0],
    [3, 0, 1, 0],
    [1, 0, 0, 1],
    [0, 1, 0, 2.3],
    [0, 2.3, 1, 3.2],
    [1, 3.2, 3, 3.2],
    [3, 3.2, 4, 4.2],
    [4, 4.2, 4, 5.2],
    [4, 5.2, 3, 6],
    [3, 6, 1, 6],
    [1, 6, 0, 5],
  ],
  O: [
    [1, 0, 3, 0],
    [3, 0, 4, 1.5],
    [4, 1.5, 4, 4.5],
    [4, 4.5, 3, 6],
    [3, 6, 1, 6],
    [1, 6, 0, 4.5],
    [0, 4.5, 0, 1.5],
    [0, 1.5, 1, 0],
  ],
  L: [
    [0, 0, 0, 6],
    [0, 6, 4, 6],
  ],
  M: [
    [0, 6, 0, 0],
    [0, 0, 2, 2.5],
    [2, 2.5, 4, 0],
    [4, 0, 4, 6],
  ],
  A: [
    [0, 6, 2, 0],
    [2, 0, 4, 6],
    [1, 4, 3, 4],
  ],
  R: [
    [0, 6, 0, 0],
    [0, 0, 3, 0],
    [3, 0, 4, 1],
    [4, 1, 3, 2],
    [3, 2, 0, 2],
    [2.5, 2, 4, 6],
  ],
};

function drawGlyph(
  ch: string,
  ox: number,
  oy: number,
  scale: number,
  stroke: number,
  c: RGB,
  a: number,
): void {
  const segs = GLYPHS[ch];
  if (!segs) return;
  const half = stroke / 2;
  const x0 = Math.floor(ox - half - 1);
  const x1 = Math.ceil(ox + 5 * scale + half + 1);
  const y0 = Math.floor(oy - half - 1);
  const y1 = Math.ceil(oy + 6 * scale + half + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let d = Infinity;
      for (const [sx1, sy1, sx2, sy2] of segs) {
        const ax = ox + sx1 * scale;
        const ay = oy + sy1 * scale;
        const bx = ox + sx2 * scale;
        const by = oy + sy2 * scale;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2;
        t = clamp(t, 0, 1);
        const dd = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        if (dd < d) d = dd;
      }
      if (d < half + 1) {
        const aa = a * clamp((half + 0.75 - d) / 1.5, 0, 1);
        if (aa > 0.01) setPx(x, y, c, aa);
      }
    }
  }
}

const NAME = "SOLMARA";
const SCALE = 17; // px per grid unit -> letters 102px tall
const STROKE = 19;
const ADVANCE = 6.3 * SCALE;
const nameW = NAME.length * ADVANCE - 1.3 * SCALE;
const nameX = (W - nameW) / 2;
const nameY = 108;
// soft shadow, then cream letters
for (let i = 0; i < NAME.length; i++) {
  drawGlyph(NAME[i], nameX + i * ADVANCE + 5, nameY + 6, SCALE, STROKE, [46, 24, 66], 0.5);
}
for (let i = 0; i < NAME.length; i++) {
  drawGlyph(NAME[i], nameX + i * ADVANCE, nameY, SCALE, STROKE, CREAM, 1);
}
// small rule + diamond under the name
const ruleY = Math.round(nameY + 6 * SCALE + 24);
for (let x = 312; x <= 712; x++) {
  for (let w = -1; w <= 1; w++) setPx(x, ruleY + w, CREAM, 0.85);
}
for (let d = -7; d <= 7; d++) {
  for (let e = -7; e <= 7; e++) {
    if (Math.abs(d) + Math.abs(e) <= 7) setPx(512 + d, ruleY + e, CREAM, 0.95);
  }
}

// ---------- PNG encode (8-bit RGB, filter 0) ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(raw, { level: 9 })),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const outDir = process.env.OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/entry.png`;
writeFileSync(outPath, png);
const sha = createHash("sha256").update(png).digest("hex");
console.log(`wrote ${outPath} ${png.length} bytes sha256 ${sha}`);
if (png.length > 1048576) {
  console.error("ERROR: entry.png exceeds the 1 MiB cap");
  process.exit(1);
}
