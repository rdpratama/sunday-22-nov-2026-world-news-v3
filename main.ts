// Sunday 22 November 2026 — newspaper front page, 1024x1024 PNG.
// Node 22, standard library only. Deterministic: two runs write
// byte-identical output. Written from a prose spec; every drawing,
// headline and line of code here is original work.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------- colour helpers ----------
type RGB = [number, number, number];
function rgb(r: number, g: number, b: number): RGB { return [r, g, b]; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}

// ---------- CRC32 (table built at startup, deterministic) ----------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG encoder (8-bit RGB, no filter) ----------
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgbBuf: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter byte: none
    raw.set(rgbBuf.subarray(y * w * 3, (y + 1) * w * 3), y * stride + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------- Canvas: draws into a raw RGB buffer ----------
class Canvas {
  buf: Uint8Array;
  clipX0: number; clipY0: number; clipX1: number; clipY1: number;
  constructor() {
    this.buf = new Uint8Array(W * H * 3);
    this.clipX0 = 0; this.clipY0 = 0; this.clipX1 = W; this.clipY1 = H;
  }
  setClip(x: number, y: number, w: number, h: number): void {
    this.clipX0 = Math.max(0, Math.floor(x)); this.clipY0 = Math.max(0, Math.floor(y));
    this.clipX1 = Math.min(W, Math.ceil(x + w)); this.clipY1 = Math.min(H, Math.ceil(y + h));
  }
  clearClip(): void { this.clipX0 = 0; this.clipY0 = 0; this.clipX1 = W; this.clipY1 = H; }
  set(x: number, y: number, c: RGB): void {
    if (x < this.clipX0 || y < this.clipY0 || x >= this.clipX1 || y >= this.clipY1) return;
    const i = (y * W + x) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    // Floor/ceil so fractional coordinates still paint real pixels.
    const x0 = Math.max(this.clipX0, Math.floor(x)), y0 = Math.max(this.clipY0, Math.floor(y));
    const x1 = Math.min(this.clipX1, Math.ceil(x + w)), y1 = Math.min(this.clipY1, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * W + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
        i += 3;
      }
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
    this.fillRect(x, y, w, t, c);
    this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c);
    this.fillRect(x + w - t, y, t, h, c);
  }
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
    for (let yy = 0; yy < h; yy++) {
      const t = h <= 1 ? 0 : yy / (h - 1);
      this.fillRect(x, y + yy, w, 1, mix(top, bot, t));
    }
  }
  hgrad(x: number, y: number, w: number, h: number, left: RGB, right: RGB): void {
    for (let xx = 0; xx < w; xx++) {
      const t = w <= 1 ? 0 : xx / (w - 1);
      this.fillRect(x + xx, y, 1, h, mix(left, right, t));
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (;;) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  thickLine(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
    for (let d = -Math.floor(t / 2); d <= Math.floor(t / 2); d++) {
      this.line(x0 + d, y0, x1 + d, y1, c);
      this.line(x0, y0 + d, x1, y1 + d, c);
    }
  }
  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }
  ring(cx: number, cy: number, r: number, c: RGB): void {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      this.set(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = -ry; y <= ry; y++) {
      const t = 1 - (y * y) / (ry * ry);
      if (t < 0) continue;
      const half = Math.floor(rx * Math.sqrt(t));
      this.fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }
  // Filled polygon from a list of [x, y] points (scanline fill).
  poly(pts: number[][], c: RGB): void {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fillRect(Math.round(xs[k]), y, Math.max(1, Math.round(xs[k + 1]) - Math.round(xs[k])), 1, c);
      }
    }
  }
  // Coarse paper mottle: one seeded offset per block (not per pixel),
  // so the texture reads as newsprint without destroying compression.
  mottle(seed: number, block: number, amt: number): void {
    let s = seed >>> 0;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let by = 0; by < H; by += block) {
      for (let bx = 0; bx < W; bx += block) {
        const d = Math.round((next() - 0.5) * 2 * amt);
        if (d === 0) continue;
        for (let y = by; y < Math.min(H, by + block); y++) {
          for (let x = bx; x < Math.min(W, bx + block); x++) {
            const i = (y * W + x) * 3;
            for (let k = 0; k < 3; k++) {
              const v = this.buf[i + k] + d;
              this.buf[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
          }
        }
      }
    }
  }
  // Halftone stipple: a regular grid of 1px dots over a rect.
  stipple(x: number, y: number, w: number, h: number, step: number, c: RGB, seed: number): void {
    let s = seed >>> 0;
    for (let yy = y; yy < y + h; yy += step) {
      for (let xx = x; xx < x + w; xx += step) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        if ((s / 4294967296) < 0.55) this.set(xx, yy, c);
      }
    }
  }
}
// ---------- 5x7 bitmap font (A-Z, 0-9, punctuation) ----------
// Each glyph is 7 rows; each row is a 5-bit number, bit 4 = leftmost pixel.
// All page text is drawn in capitals (newspaper style).
const FONT: Record<string, number[]> = {
  A: [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  B: [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  D: [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
  E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  H: [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  Q: [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
  R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A],
  X: [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0C, 0x0C],
  ',': [0, 0, 0, 0, 0x0C, 0x04, 0x08],
  ':': [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0],
  ';': [0, 0x0C, 0x0C, 0, 0x0C, 0x04, 0x08],
  '-': [0, 0, 0, 0x1F, 0, 0, 0],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '’': [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '‘': [0x08, 0x08, 0x04, 0, 0, 0, 0],
  '"': [0x0A, 0x0A, 0x0A, 0, 0, 0, 0],
  '&': [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D],
  '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  '$': [0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04],
  '#': [0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A],
  '@': [0x0E, 0x11, 0x17, 0x15, 0x16, 0x10, 0x0E],
  '+': [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0],
  '=': [0, 0, 0x1F, 0, 0x1F, 0, 0],
  '*': [0, 0x04, 0x15, 0x0E, 0x15, 0x04, 0],
  '~': [0, 0, 0x0E, 0x11, 0x0E, 0, 0],
  '·': [0, 0, 0, 0x0C, 0x0C, 0, 0],
  '—': [0, 0, 0, 0x1F, 0, 0, 0],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale;
}
function drawChar(cv: Canvas, ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let row = 0; row < 7; row++) {
    const bits = g[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) cv.fillRect(x + col * scale, y + row * scale, scale, scale, c);
    }
  }
}
// align: 'l' left, 'c' centre, 'r' right. Text is upper-cased first.
function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB, align: string): void {
  const t = s.toUpperCase();
  let x0 = x;
  if (align === 'c') x0 = x - Math.floor(textWidth(t, scale) / 2);
  if (align === 'r') x0 = x - textWidth(t, scale);
  for (let i = 0; i < t.length; i++) drawChar(cv, t[i], x0 + i * 6 * scale, y, scale, c);
}
function wrapText(s: string, maxW: number, scale: number): string[] {
  const words = s.toUpperCase().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur === '' ? w : cur + ' ' + w;
    if (textWidth(cand, scale) <= maxW) { cur = cand; continue; }
    if (cur !== '') lines.push(cur);
    // A single over-long word is hard-split.
    if (textWidth(w, scale) > maxW) {
      const per = Math.max(1, Math.floor(maxW / (6 * scale)));
      for (let i = 0; i < w.length; i += per) lines.push(w.slice(i, i + per));
      cur = '';
    } else cur = w;
  }
  if (cur !== '') lines.push(cur);
  return lines;
}
function drawWrapped(cv: Canvas, lines: string[], x: number, y: number, scale: number, c: RGB, gap: number): number {
  let yy = y;
  for (const ln of lines) {
    drawText(cv, ln, x, yy, scale, c, 'l');
    yy += 7 * scale + gap;
  }
  return yy;
}
// Panel: paper fill, thin border, optional header band.
function panel(cv: Canvas, x: number, y: number, w: number, h: number, border: RGB): void {
  cv.fillRect(x, y, w, h, rgb(255, 255, 255));
  cv.rect(x, y, w, h, border, 1);
}
// ---------- deterministic scatter (stars, sparks, confetti) ----------
function sprinkle(cv: Canvas, x: number, y: number, w: number, h: number, n: number, seed: number, c: RGB, r: number): void {
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const px = x + Math.floor((s / 4294967296) * w);
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const py = y + Math.floor((s / 4294967296) * h);
    cv.disc(px, py, r, c);
  }
}

// Scene 1 — night drone attack: dark sky, drones, a burning block.
function sceneKyiv(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(10, 18, 46), rgb(52, 32, 84));
  sprinkle(cv, x, y, w, Math.floor(h * 0.5), 26, 11, rgb(255, 255, 220), 1);
  cv.disc(x + Math.floor(w * 0.84), y + Math.floor(h * 0.16), Math.floor(h * 0.11), rgb(240, 234, 200));
  const drone = (dx: number, dy: number): void => {
    cv.fillRect(dx, dy, 10, 3, rgb(8, 8, 12));
    cv.thickLine(dx - 3, dy - 2, dx + 13, dy - 2, rgb(120, 120, 130), 1);
    cv.thickLine(dx - 3, dy + 5, dx + 13, dy + 5, rgb(120, 120, 130), 1);
    cv.disc(dx + 5, dy + 1, 1, rgb(255, 60, 60));
  };
  drone(x + Math.floor(w * 0.16), y + Math.floor(h * 0.2));
  drone(x + Math.floor(w * 0.55), y + Math.floor(h * 0.12));
  drone(x + Math.floor(w * 0.72), y + Math.floor(h * 0.3));
  const bx = x + Math.floor(w * 0.12), by = y + Math.floor(h * 0.42), bw = Math.floor(w * 0.5), bh = Math.floor(h * 0.48);
  cv.fillRect(bx, by, bw, bh, rgb(58, 52, 60));
  for (let f = 0; f < 4; f++) for (let c2 = 0; c2 < 5; c2++) {
    const lit = (f * 5 + c2) % 3 !== 0;
    cv.fillRect(bx + 6 + c2 * Math.floor((bw - 12) / 5), by + 6 + f * Math.floor((bh - 12) / 4), 6, 6, lit ? rgb(255, 214, 130) : rgb(20, 18, 26));
  }
  cv.poly([[bx + bw - 26, by + 18], [bx + bw - 8, by + 2], [bx + bw, by + 22], [bx + bw - 4, by + 34]], rgb(255, 120, 20));
  cv.disc(bx + bw - 12, by + 14, 7, rgb(255, 190, 60));
  cv.ellipse(bx + bw - 6, by - 8, 10, 6, rgb(120, 110, 120));
  cv.ellipse(bx + bw + 2, by - 20, 12, 7, rgb(150, 140, 150));
  cv.fillRect(x, y + h - 8, w, 8, rgb(18, 16, 24));
}

// Scene 2 — climate deal: globe, sun, conference hall, trees.
function sceneCop(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(14, 92, 78), rgb(190, 232, 216));
  cv.disc(x + Math.floor(w * 0.82), y + Math.floor(h * 0.2), Math.floor(h * 0.14), rgb(255, 214, 90));
  const gx = x + Math.floor(w * 0.3), gy = y + Math.floor(h * 0.46), gr = Math.floor(h * 0.3);
  cv.disc(gx, gy, gr, rgb(38, 110, 190));
  cv.ellipse(gx - 8, gy - 6, 12, 7, rgb(60, 170, 90));
  cv.ellipse(gx + 10, gy + 8, 10, 6, rgb(60, 170, 90));
  cv.ellipse(gx + 2, gy - 14, 8, 5, rgb(80, 190, 100));
  cv.ring(gx, gy, gr, rgb(255, 255, 255));
  const hx = x + Math.floor(w * 0.62), hy = y + Math.floor(h * 0.52), hw = Math.floor(w * 0.34), hh = Math.floor(h * 0.38);
  cv.fillRect(hx, hy, hw, hh, rgb(240, 240, 235));
  cv.fillRect(hx + 4, hy + 6, hw - 8, Math.floor(hh * 0.4), rgb(120, 190, 220));
  for (let i = 0; i < 4; i++) cv.fillRect(hx + 6 + i * Math.floor((hw - 12) / 4), hy + Math.floor(hh * 0.55), Math.floor((hw - 12) / 4) - 4, Math.floor(hh * 0.35), rgb(40, 90, 120));
  for (let i = 0; i < 3; i++) {
    const fx = x + Math.floor(w * (0.66 + i * 0.12));
    cv.line(fx, y + Math.floor(h * 0.42), fx, y + Math.floor(h * 0.52), rgb(90, 90, 90));
    cv.poly([[fx, y + Math.floor(h * 0.42)], [fx + 12, y + Math.floor(h * 0.44)], [fx, y + Math.floor(h * 0.47)]], i === 0 ? rgb(200, 60, 60) : i === 1 ? rgb(60, 120, 200) : rgb(60, 170, 90));
  }
  for (let i = 0; i < 4; i++) {
    const tx = x + Math.floor(w * (0.08 + i * 0.12));
    cv.fillRect(tx, y + h - 22, 3, 14, rgb(90, 60, 30));
    cv.disc(tx + 1, y + h - 26, 8, rgb(40, 140, 70));
  }
  sprinkle(cv, x, y + Math.floor(h * 0.3), w, Math.floor(h * 0.3), 12, 23, rgb(90, 190, 110), 2);
}

// Scene 3 — radars in the desert, explosion, sea and industry.
function sceneRadar(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(232, 160, 76), rgb(246, 217, 160));
  cv.disc(x + Math.floor(w * 0.78), y + Math.floor(h * 0.22), Math.floor(h * 0.12), rgb(255, 236, 180));
  const dish = (dx: number, dy: number, s: number): void => {
    cv.thickLine(dx, dy, dx, dy + 26 * s, rgb(80, 70, 60), 2);
    cv.ellipse(dx, dy, 16 * s, 7 * s, rgb(220, 220, 215));
    cv.ellipse(dx, dy, 10 * s, 4 * s, rgb(160, 160, 155));
    cv.line(dx, dy, dx + 12 * s, dy - 10 * s, rgb(80, 70, 60));
  };
  dish(x + Math.floor(w * 0.2), y + Math.floor(h * 0.34), 1);
  dish(x + Math.floor(w * 0.48), y + Math.floor(h * 0.3), 1);
  cv.poly([[x + w * 0.62, y + h * 0.42], [x + w * 0.66, y + h * 0.3], [x + w * 0.7, y + h * 0.42], [x + w * 0.74, y + h * 0.32], [x + w * 0.78, y + h * 0.42]], rgb(255, 140, 30));
  cv.disc(x + Math.floor(w * 0.68), y + Math.floor(h * 0.38), 6, rgb(255, 200, 70));
  cv.fillRect(x, y + Math.floor(h * 0.62), w, Math.floor(h * 0.14), rgb(196, 164, 110));
  cv.fillRect(x, y + Math.floor(h * 0.76), w, Math.floor(h * 0.24), rgb(36, 110, 170));
  for (let i = 0; i < 5; i++) cv.line(x + i * Math.floor(w / 5), y + Math.floor(h * 0.8) + (i % 2) * 4, x + (i + 1) * Math.floor(w / 5), y + Math.floor(h * 0.8) + ((i + 1) % 2) * 4, rgb(200, 230, 245));
  cv.fillRect(x + Math.floor(w * 0.08), y + Math.floor(h * 0.66), 22, 12, rgb(90, 90, 95));
  cv.fillRect(x + Math.floor(w * 0.16), y + Math.floor(h * 0.62), 14, 16, rgb(110, 110, 115));
}

// Scene 4 — Hong Kong election: skyline, ballot box, checkmark.
function sceneVote(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(150, 200, 235), rgb(225, 240, 250));
  const base = y + Math.floor(h * 0.72);
  const towers = [0.5, 0.68, 0.42, 0.78, 0.58, 0.46];
  for (let i = 0; i < 6; i++) {
    const tx = x + 6 + i * Math.floor((w - 12) / 6), tw = Math.floor((w - 12) / 6) - 6, th = Math.floor(h * towers[i]);
    cv.fillRect(tx, base - th, tw, th, rgb(70, 90, 120));
    for (let wy = 0; wy < 5; wy++) for (let wx = 0; wx < 2; wx++) {
      if ((i + wy + wx) % 2 === 0) cv.fillRect(tx + 3 + wx * 7, base - th + 5 + wy * Math.floor((th - 10) / 5), 4, 4, rgb(255, 220, 130));
    }
  }
  const bx = x + Math.floor(w * 0.3), by = y + Math.floor(h * 0.52), bw = Math.floor(w * 0.4), bh = Math.floor(h * 0.3);
  cv.fillRect(bx, by, bw, bh, rgb(250, 250, 248));
  cv.rect(bx, by, bw, bh, rgb(30, 60, 110), 2);
  cv.fillRect(bx + Math.floor(bw * 0.25), by + 4, Math.floor(bw * 0.5), 4, rgb(30, 60, 110));
  cv.thickLine(bx + 10, by + Math.floor(bh * 0.55), bx + Math.floor(bw * 0.42), by + Math.floor(bh * 0.78), rgb(200, 40, 40), 3);
  cv.thickLine(bx + Math.floor(bw * 0.42), by + Math.floor(bh * 0.78), bx + bw - 10, by + Math.floor(bh * 0.3), rgb(200, 40, 40), 3);
  cv.fillRect(x, base, w, h - Math.floor(h * 0.72), rgb(90, 120, 90));
}

// Scene 5 — cricket: green outfield, pitch, stumps, batsman, scoreboard.
function sceneCricket(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(90, 170, 80), rgb(150, 210, 110));
  cv.fillRect(x + Math.floor(w * 0.42), y + 6, Math.floor(w * 0.16), h - 12, rgb(214, 186, 130));
  cv.fillRect(x + Math.floor(w * 0.42), y + 6, Math.floor(w * 0.16), 3, rgb(255, 255, 255));
  cv.fillRect(x + Math.floor(w * 0.42), y + h - 9, Math.floor(w * 0.16), 3, rgb(255, 255, 255));
  for (let i = 0; i < 3; i++) cv.fillRect(x + Math.floor(w * 0.47) + i * 4, y + 14, 2, 12, rgb(240, 210, 90));
  for (let i = 0; i < 3; i++) cv.fillRect(x + Math.floor(w * 0.47) + i * 4, y + h - 26, 2, 12, rgb(240, 210, 90));
  const px = x + Math.floor(w * 0.3), py = y + Math.floor(h * 0.62);
  cv.disc(px, py - 26, 6, rgb(240, 200, 160));
  cv.thickLine(px, py - 20, px + 2, py, rgb(40, 60, 140), 3);
  cv.thickLine(px + 2, py, px - 6, py + 16, rgb(40, 60, 140), 3);
  cv.thickLine(px + 2, py, px + 10, py + 16, rgb(40, 60, 140), 3);
  cv.line(px + 4, py - 14, px + 16, py + 2, rgb(90, 60, 30));
  cv.fillRect(px + 14, py - 2, 4, 16, rgb(200, 170, 110));
  cv.disc(x + Math.floor(w * 0.62), y + Math.floor(h * 0.5), 4, rgb(190, 40, 40));
  cv.fillRect(x + 6, y + 6, 74, 22, rgb(30, 40, 50));
  drawText(cv, '720-9', x + 10, y + 11, 2, rgb(255, 255, 255), 'l');
}

// Scene 6 — Las Vegas GP: night city, sweeping track, F1 car, flag.
function sceneF1(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(24, 12, 52), rgb(70, 30, 90));
  for (let i = 0; i < 7; i++) {
    const tx = x + 4 + i * Math.floor((w - 8) / 7), th = Math.floor(h * (0.3 + ((i * 37) % 30) / 100));
    cv.fillRect(tx, y + Math.floor(h * 0.42) - th, Math.floor((w - 8) / 7) - 5, th, rgb(40, 30, 70));
    for (let wy = 0; wy < 4; wy++) cv.fillRect(tx + 3, y + Math.floor(h * 0.42) - th + 4 + wy * 8, 4, 4, (i + wy) % 2 ? rgb(255, 210, 100) : rgb(140, 220, 255));
  }
  cv.fillRect(x, y + Math.floor(h * 0.42), w, Math.floor(h * 0.58), rgb(50, 50, 56));
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const px = x + Math.floor(w * t);
    const py = y + Math.floor(h * (0.52 + 0.3 * Math.sin(t * 2.4)));
    cv.disc(px, py, 2, rgb(255, 255, 255));
  }
  const cx = x + Math.floor(w * 0.42), cy = y + Math.floor(h * 0.68);
  cv.poly([[cx - 34, cy + 8], [cx - 30, cy - 2], [cx + 6, cy - 4], [cx + 30, cy + 2], [cx + 34, cy + 8], [cx + 20, cy + 10], [cx - 20, cy + 10]], rgb(200, 30, 40));
  cv.disc(cx - 22, cy + 10, 6, rgb(12, 12, 14));
  cv.disc(cx + 22, cy + 10, 6, rgb(12, 12, 14));
  cv.fillRect(cx + 26, cy - 8, 3, 10, rgb(200, 30, 40));
  cv.fillRect(cx + 26, cy - 8, 12, 3, rgb(200, 30, 40));
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 4; c2++) {
    cv.fillRect(x + w - 26 + c2 * 6, y + 10 + r * 6, 6, 6, (r + c2) % 2 ? rgb(20, 20, 20) : rgb(255, 255, 255));
  }
  cv.line(x + w - 14, y + 8, x + w - 14, y + 34, rgb(220, 220, 220));
}

// Scene 7 — NBA: court, hoop, leaping player, ball.
function sceneNba(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(120, 70, 30), rgb(200, 140, 70));
  for (let i = 0; i < 8; i++) cv.fillRect(x, y + i * Math.floor(h / 8), w, 1, rgb(170, 110, 50));
  cv.fillRect(x + Math.floor(w * 0.6), y + Math.floor(h * 0.2), Math.floor(w * 0.4), Math.floor(h * 0.6), rgb(40, 90, 170));
  cv.ellipse(x + Math.floor(w * 0.6), y + Math.floor(h * 0.5), Math.floor(w * 0.22), Math.floor(h * 0.3), rgb(40, 90, 170));
  cv.fillRect(x + w - 16, y + Math.floor(h * 0.18), 4, Math.floor(h * 0.5), rgb(200, 200, 200));
  cv.fillRect(x + w - 30, y + Math.floor(h * 0.2), 26, 18, rgb(255, 255, 255));
  cv.ring(x + w - 18, y + Math.floor(h * 0.42), 8, rgb(230, 110, 20));
  cv.line(x + w - 24, y + Math.floor(h * 0.42) + 6, x + w - 12, y + Math.floor(h * 0.42) + 14, rgb(255, 255, 255));
  const px = x + Math.floor(w * 0.34), py = y + Math.floor(h * 0.55);
  cv.disc(px, py - 30, 7, rgb(60, 40, 30));
  cv.thickLine(px, py - 23, px + 6, py + 2, rgb(30, 30, 90), 4);
  cv.thickLine(px + 6, py + 2, px - 2, py + 22, rgb(30, 30, 90), 3);
  cv.thickLine(px + 6, py + 2, px + 16, py + 20, rgb(30, 30, 90), 3);
  cv.thickLine(px, py - 20, px + 18, py - 34, rgb(30, 30, 90), 3);
  cv.disc(px + 24, py - 38, 8, rgb(230, 120, 30));
  cv.fillRect(x + 6, y + 6, 92, 20, rgb(20, 20, 30));
  drawText(cv, '114-91', x + 10, y + 10, 2, rgb(255, 255, 255), 'l');
}

// Scene 8 — cargo ship on fire, drones above, rescue boat.
function sceneShip(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(140, 190, 220), rgb(220, 235, 245));
  cv.fillRect(x, y + Math.floor(h * 0.55), w, Math.floor(h * 0.45), rgb(24, 90, 150));
  for (let i = 0; i < 4; i++) cv.line(x + i * Math.floor(w / 4), y + Math.floor(h * 0.62) + (i % 2) * 6, x + (i + 1) * Math.floor(w / 4), y + Math.floor(h * 0.62) + ((i + 1) % 2) * 6, rgb(190, 225, 245));
  const sx = x + Math.floor(w * 0.12), sy = y + Math.floor(h * 0.42), sw = Math.floor(w * 0.62), sh = Math.floor(h * 0.16);
  cv.poly([[sx, sy], [sx + sw, sy], [sx + sw - 12, sy + sh], [sx + 8, sy + sh]], rgb(40, 44, 52));
  const cols = [rgb(200, 60, 50), rgb(40, 120, 180), rgb(220, 160, 40), rgb(60, 160, 80)];
  for (let r = 0; r < 2; r++) for (let c2 = 0; c2 < 6; c2++) {
    cv.fillRect(sx + 8 + c2 * Math.floor((sw - 24) / 6), sy - 12 - r * 13, Math.floor((sw - 24) / 6) - 2, 11, cols[(r * 6 + c2) % 4]);
  }
  cv.fillRect(sx + sw - 34, sy - 30, 22, 30, rgb(230, 230, 225));
  cv.fillRect(sx + sw - 30, sy - 26, 14, 5, rgb(60, 120, 180));
  cv.ellipse(sx + sw - 40, sy - 36, 12, 8, rgb(120, 115, 115));
  cv.ellipse(sx + sw - 48, sy - 52, 15, 9, rgb(150, 145, 145));
  cv.disc(sx + sw - 44, sy - 8, 6, rgb(255, 160, 40));
  cv.fillRect(x + Math.floor(w * 0.72), y + Math.floor(h * 0.78), 30, 8, rgb(230, 110, 30));
  cv.poly([[x + Math.floor(w * 0.72), y + Math.floor(h * 0.78)], [x + Math.floor(w * 0.72) + 30, y + Math.floor(h * 0.78)], [x + Math.floor(w * 0.72) + 24, y + Math.floor(h * 0.86)], [x + Math.floor(w * 0.72) + 6, y + Math.floor(h * 0.86)]], rgb(240, 240, 240));
}

// Scene 9 — power rationing: pylons, sagging lines, one dim bulb.
function scenePower(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(70, 50, 90), rgb(230, 150, 80));
  cv.disc(x + Math.floor(w * 0.8), y + Math.floor(h * 0.2), Math.floor(h * 0.1), rgb(255, 220, 140));
  const pylon = (px: number, ph: number): void => {
    const top = y + Math.floor(h * 0.72) - ph;
    cv.line(px - 14, y + Math.floor(h * 0.72), px, top, rgb(50, 50, 55));
    cv.line(px + 14, y + Math.floor(h * 0.72), px, top, rgb(50, 50, 55));
    cv.line(px - 20, top + 8, px + 20, top + 8, rgb(50, 50, 55));
    cv.line(px - 14, top + 22, px + 14, top + 22, rgb(50, 50, 55));
    cv.line(px - 14, y + Math.floor(h * 0.72), px + 14, top + 22, rgb(50, 50, 55));
    cv.line(px + 14, y + Math.floor(h * 0.72), px - 14, top + 22, rgb(50, 50, 55));
  };
  pylon(x + Math.floor(w * 0.2), Math.floor(h * 0.42));
  pylon(x + Math.floor(w * 0.62), Math.floor(h * 0.5));
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const lx = x + Math.floor(w * 0.2) + Math.floor((w * 0.42) * t);
    const ly = y + Math.floor(h * 0.3) + Math.floor(10 * Math.sin(t * Math.PI));
    cv.set(lx, ly, rgb(40, 40, 45));
    cv.set(lx, ly + 1, rgb(40, 40, 45));
  }
  const bx = x + Math.floor(w * 0.42), by = y + Math.floor(h * 0.3);
  cv.disc(bx, by, 13, rgb(190, 180, 130));
  cv.fillRect(bx - 4, by - 14, 8, 5, rgb(120, 120, 120));
  cv.line(bx - 4, by - 2, bx + 4, by + 8, rgb(120, 110, 60));
  cv.line(bx + 4, by - 2, bx - 4, by + 8, rgb(120, 110, 60));
  cv.fillRect(x, y + Math.floor(h * 0.72), w, Math.floor(h * 0.28), rgb(30, 28, 40));
  for (let i = 0; i < 6; i++) {
    const wx = x + 8 + i * Math.floor((w - 16) / 6);
    cv.fillRect(wx, y + Math.floor(h * 0.78), 8, 10, (i * 7) % 3 === 0 ? rgb(255, 220, 130) : rgb(20, 18, 28));
  }
}

// Scene 10 — hospital: white block, red cross, bed, IV, monitor.
function sceneHospital(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(190, 220, 235), rgb(240, 248, 250));
  const hx = x + Math.floor(w * 0.08), hy = y + Math.floor(h * 0.18), hw = Math.floor(w * 0.4), hh = Math.floor(h * 0.6);
  cv.fillRect(hx, hy, hw, hh, rgb(250, 250, 248));
  cv.rect(hx, hy, hw, hh, rgb(60, 90, 120), 2);
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) {
    cv.fillRect(hx + 6 + c2 * Math.floor((hw - 12) / 3), hy + 8 + r * Math.floor((hh - 16) / 3), Math.floor((hw - 12) / 3) - 5, Math.floor((hh - 16) / 3) - 6, rgb(170, 210, 230));
  }
  cv.fillRect(hx + Math.floor(hw / 2) - 4, hy - 14, 8, 22, rgb(200, 40, 40));
  cv.fillRect(hx + Math.floor(hw / 2) - 11, hy - 7, 22, 8, rgb(200, 40, 40));
  const bx = x + Math.floor(w * 0.58), by = y + Math.floor(h * 0.6);
  cv.fillRect(bx, by, 44, 5, rgb(120, 120, 125));
  cv.fillRect(bx + 2, by + 5, 3, 12, rgb(90, 90, 95));
  cv.fillRect(bx + 40, by + 5, 3, 12, rgb(90, 90, 95));
  cv.disc(bx + 8, by - 4, 5, rgb(240, 200, 160));
  cv.fillRect(bx + 12, by - 2, 28, 5, rgb(200, 220, 235));
  cv.line(bx + 46, by - 2, bx + 46, by - 26, rgb(90, 90, 95));
  cv.fillRect(bx + 42, by - 30, 8, 10, rgb(220, 235, 240));
  cv.fillRect(x + Math.floor(w * 0.58), y + Math.floor(h * 0.16), 52, 30, rgb(30, 40, 50));
  const hb = [[0, 14], [10, 14], [14, 4], [20, 24], [26, 10], [30, 14], [44, 14]];
  for (let i = 0; i + 1 < hb.length; i++) {
    cv.line(x + Math.floor(w * 0.58) + 4 + hb[i][0], y + Math.floor(h * 0.16) + hb[i][1], x + Math.floor(w * 0.58) + 4 + hb[i + 1][0], y + Math.floor(h * 0.16) + hb[i + 1][1], rgb(80, 220, 120));
  }
}

// Scene 11 — FBI hack: dark screen, code lines, shield, padlock.
function sceneHack(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(20, 24, 40), rgb(50, 60, 100));
  const sx = x + 8, sy = y + 8, sw = Math.floor(w * 0.56), sh = Math.floor(h * 0.62);
  cv.fillRect(sx, sy, sw, sh, rgb(12, 18, 16));
  cv.rect(sx, sy, sw, sh, rgb(120, 140, 160), 2);
  for (let r = 0; r < 6; r++) {
    const lw = Math.floor(sw * (0.4 + ((r * 53) % 40) / 100));
    cv.fillRect(sx + 6, sy + 6 + r * Math.floor((sh - 12) / 6), lw, 3, r % 2 ? rgb(80, 220, 120) : rgb(60, 180, 100));
  }
  const cx = x + Math.floor(w * 0.74), cy = y + Math.floor(h * 0.38);
  cv.poly([[cx, cy - 22], [cx + 18, cy - 14], [cx + 18, cy + 6], [cx, cy + 22], [cx - 18, cy + 6], [cx - 18, cy - 14]], rgb(60, 120, 200));
  cv.poly([[cx, cy - 16], [cx + 13, cy - 10], [cx + 13, cy + 4], [cx, cy + 16], [cx - 13, cy + 4], [cx - 13, cy - 10]], rgb(240, 240, 245));
  cv.fillRect(cx - 7, cy - 4, 14, 12, rgb(230, 180, 40));
  cv.ring(cx, cy - 1, 3, rgb(60, 60, 60));
  cv.poly([[cx + 30, cy + 34], [cx + 40, cy + 16], [cx + 50, cy + 34]], rgb(240, 200, 40));
  drawText(cv, '!', cx + 38, cy + 20, 1, rgb(20, 20, 20), 'l');
  cv.fillRect(x, y + Math.floor(h * 0.8), w, Math.floor(h * 0.2), rgb(30, 34, 50));
  drawText(cv, 'BREACH ACCESSED', x + 10, y + Math.floor(h * 0.86), 1, rgb(255, 120, 100), 'l');
}

// Scene 12 — Belgian strike: grounded plane, runway, picket signs, clock.
function sceneStrike(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(150, 185, 215), rgb(225, 235, 240));
  cv.disc(x + Math.floor(w * 0.82), y + Math.floor(h * 0.16), Math.floor(h * 0.09), rgb(255, 240, 180));
  const px = x + Math.floor(w * 0.1), py = y + Math.floor(h * 0.42);
  cv.ellipse(px + 34, py, 34, 7, rgb(240, 240, 245));
  cv.poly([[px + 60, py - 4], [px + 74, py - 18], [px + 74, py - 2]], rgb(220, 60, 60));
  cv.poly([[px + 20, py], [px + 34, py - 16], [px + 44, py]], rgb(200, 200, 210));
  cv.poly([[px + 30, py + 6], [px + 44, py + 20], [px + 52, py + 6]], rgb(200, 200, 210));
  for (let i = 0; i < 4; i++) cv.fillRect(px + 8 + i * 12, py - 4, 6, 4, rgb(60, 120, 180));
  cv.fillRect(x, y + Math.floor(h * 0.62), w, Math.floor(h * 0.12), rgb(90, 95, 100));
  for (let i = 0; i < 8; i++) cv.fillRect(x + 6 + i * Math.floor((w - 12) / 8), y + Math.floor(h * 0.67), 14, 2, rgb(255, 255, 255));
  for (let i = 0; i < 3; i++) {
    const sx = x + Math.floor(w * (0.14 + i * 0.24));
    cv.line(sx, y + Math.floor(h * 0.76), sx, y + h - 8, rgb(90, 60, 30));
    cv.fillRect(sx - 14, y + Math.floor(h * 0.76), 28, 14, i === 1 ? rgb(220, 60, 60) : rgb(250, 250, 245));
    cv.rect(sx - 14, y + Math.floor(h * 0.76), 28, 14, rgb(40, 40, 40), 1);
  }
  cv.disc(x + Math.floor(w * 0.86), y + Math.floor(h * 0.82), 12, rgb(250, 250, 245));
  cv.ring(x + Math.floor(w * 0.86), y + Math.floor(h * 0.82), 12, rgb(30, 30, 30));
  cv.line(x + Math.floor(w * 0.86), y + Math.floor(h * 0.82), x + Math.floor(w * 0.86), y + Math.floor(h * 0.82) - 8, rgb(30, 30, 30));
  cv.line(x + Math.floor(w * 0.86), y + Math.floor(h * 0.82), x + Math.floor(w * 0.86) + 6, y + Math.floor(h * 0.82), rgb(30, 30, 30));
}

// Scene 13 — toxic liquor: bottles, warning triangle, map outline.
function sceneBottles(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(90, 40, 50), rgb(190, 110, 90));
  const bottle = (bx: number, by: number, bh: number, c: RGB, tipped: boolean): void => {
    if (tipped) {
      cv.fillRect(bx, by + 18, 30, 12, c);
      cv.fillRect(bx + 30, by + 21, 10, 6, c);
      return;
    }
    cv.fillRect(bx + 6, by, 8, 12, c);
    cv.fillRect(bx, by + 12, 20, bh - 12, c);
    cv.fillRect(bx + 2, by + 16, 16, 10, rgb(240, 230, 200));
    cv.line(bx + 2, by + 16, bx + 18, by + 26, rgb(200, 40, 40));
    cv.line(bx + 18, by + 16, bx + 2, by + 26, rgb(200, 40, 40));
  };
  bottle(x + Math.floor(w * 0.1), y + Math.floor(h * 0.3), Math.floor(h * 0.5), rgb(60, 110, 70), false);
  bottle(x + Math.floor(w * 0.36), y + Math.floor(h * 0.22), Math.floor(h * 0.58), rgb(80, 90, 140), false);
  bottle(x + Math.floor(w * 0.62), y + Math.floor(h * 0.55), Math.floor(h * 0.3), rgb(120, 70, 90), true);
  cv.poly([[x + Math.floor(w * 0.82), y + Math.floor(h * 0.16)], [x + Math.floor(w * 0.94), y + Math.floor(h * 0.42)], [x + Math.floor(w * 0.7), y + Math.floor(h * 0.42)]], rgb(240, 200, 40));
  cv.fillRect(x + Math.floor(w * 0.81), y + Math.floor(h * 0.26), 4, 10, rgb(20, 20, 20));
  cv.disc(x + Math.floor(w * 0.82), y + Math.floor(h * 0.38), 2, rgb(20, 20, 20));
  cv.fillRect(x, y + Math.floor(h * 0.82), w, Math.floor(h * 0.18), rgb(40, 30, 34));
  cv.fillRect(x + 8, y + Math.floor(h * 0.86), 10, 10, rgb(255, 255, 255));
  cv.fillRect(x + 11, y + Math.floor(h * 0.86) - 3, 4, 16, rgb(200, 40, 40));
  cv.fillRect(x + 5, y + Math.floor(h * 0.86) + 3, 16, 4, rgb(200, 40, 40));
}

// ---------- stylised world map with region markers ----------
// Wide-strip grid: x 0..100, y 0..24 (the map strip is ~10:1).
const CONTINENTS: number[][][] = [
  [[4, 6], [16, 3], [24, 6], [22, 12], [12, 14], [5, 11]], // N America
  [[22, 14], [28, 13], [30, 19], [26, 23], [22, 19]], // S America
  [[46, 4], [54, 3], [56, 8], [50, 10], [45, 8]], // Europe
  [[46, 11], [55, 10], [58, 16], [53, 21], [47, 17]], // Africa
  [[58, 3], [86, 2], [92, 8], [86, 13], [70, 14], [60, 9]], // Asia
  [[84, 17], [91, 16], [93, 20], [86, 21]], // Oceania
];
function drawMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, rgb(30, 100, 160), rgb(70, 150, 200));
  for (let i = 0; i < 6; i++) {
    // Continents span y 2..23 of the 0..24 grid; scale y by h/24.
    const pts = CONTINENTS[i].map((p) => [x + Math.floor((p[0] / 100) * w), y + Math.floor((p[1] / 24) * h)]);
    cv.poly(pts, i === 4 ? rgb(120, 170, 90) : rgb(140, 180, 100));
  }
  const marks: [number, number, string, RGB][] = [
    [50, 6, 'EUROPE 7', rgb(200, 60, 60)],
    [60, 10, 'MID EAST 6', rgb(230, 140, 30)],
    [74, 7, 'ASIA 9', rgb(240, 200, 40)],
    [51, 15, 'AFRICA 5', rgb(60, 170, 90)],
    [14, 9, 'AMERICAS 7', rgb(60, 120, 200)],
    [88, 18, 'OCEANIA 4', rgb(150, 90, 180)],
  ];
  for (const m of marks) {
    const mx = x + Math.floor((m[0] / 100) * w), my = y + Math.floor((m[1] / 24) * h);
    cv.disc(mx, my, 4, m[3]);
    cv.ring(mx, my, 6, rgb(255, 255, 255));
    drawText(cv, m[2], mx + 9, my - 3, 1, rgb(255, 255, 255), 'l');
  }
  cv.disc(x + 12, y + h - 14, 6, rgb(240, 200, 40));
  cv.ring(x + 12, y + h - 14, 9, rgb(255, 255, 255));
  drawText(cv, 'WORLD 2', x + 24, y + h - 17, 1, rgb(255, 255, 255), 'l');
}

// ---------- the 40 stories (verified, Sunday 22 November 2026) ----------
// [n, region, section, tag, headline, summary] — summaries only for 1-13.
type S = [number, string, string, string, string, string];
const STORIES: S[] = [
  [1, 'EUROPE', 'WAR', 'CONFIRMED', 'Russia fires 186 drones; Kyiv block destroyed', '161 of 186 drones downed; one block destroyed in Dnipro, two hurt.'],
  [2, 'EUROPE', 'CLIMATE', 'CONFIRMED', 'Climate deal lands with no mention of fossil fuels', 'COP31 text keeps 35% electricity by 2035, drops the $120bn target, admits 1.5C will be missed.'],
  [3, 'MIDDLE EAST', 'IRAN', 'REPORTED', 'Iran claims two US radars hit; Bahrain denies it', 'IRGC says it hit two Patriot radars. Bahrain: the target was a civilian site, a fire in Sitra.'],
  [4, 'ASIA', 'ELECTION', 'OFFICIAL', 'Hong Kong elects its Election Committee', '836 candidates, 725 seats, 3,700 voters.'],
  [5, 'OCEANIA', 'CRICKET', 'CONFIRMED', 'India declare on 720-9, a new record in New Zealand', 'Rahul 156, Pant 131, Gill 98; hosts 119/2.'],
  [6, 'AMERICAS', 'FORMULA 1', 'OFFICIAL', 'Verstappen takes the Las Vegas Grand Prix', 'From pole in 1:27:39.634; Norris +0.653.'],
  [7, 'AMERICAS', 'NBA', 'CONFIRMED', 'Wembanyama scores 50 as the Spurs roll on', '50 pts, 19 rebounds, 5 blocks; 114-91.'],
  [8, 'EUROPE', 'SEA', 'CONFIRMED', 'Russian ship Sparta II hit by drones; Finland leads rescue', 'Hit by drones; Finland leads the rescue.'],
  [9, 'MIDDLE EAST', 'ENERGY', 'REPORTED', 'Iran begins rationing electricity', 'Rolling cuts up to two hours a day.'],
  [10, 'AMERICAS', 'HEALTH', 'CONFIRMED', 'Bolsonaro in intensive care in Brasilia', 'Acute bowel obstruction; stable.'],
  [11, 'AMERICAS', 'CYBER', 'REPORTED', 'FBI probes apparent hack of its crime database', 'Washington State pauses gun checks.'],
  [12, 'EUROPE', 'TRAVEL', 'REPORTED', 'Belgian controllers join Monday\u2019s national strike', 'Most flights grounded 07:00-21:00.'],
  [13, 'ASIA', 'POISONING', 'CONFIRMED', 'Toxic liquor toll in Manipur climbs to 19', '600 in hospital; six held.'],
  [14, 'ASIA', 'FIRE', 'CONFIRMED', 'Candy-factory fire in Cianjur: 3 dead, 26 missing', ''],
  [15, 'AMERICAS', 'QUAKE', 'CONFIRMED', 'Peru quake toll updated: 1 dead, 16 hurt', ''],
  [16, 'EUROPE', 'DIPLOMACY', 'REPORTED', 'Estonia to shut five Russian border crossings 1 Dec', ''],
  [17, 'EUROPE', 'DIPLOMACY', 'REPORTED', 'Denmark reports Russian attack on alleged plot', ''],
  [18, 'ASIA', 'DIPLOMACY', 'OFFICIAL', 'Nepal PM Shah lands in Delhi, meets Modi Monday', ''],
  [19, 'ASIA', 'DEFENCE', 'REPORTED', 'Chinese bombers turn back 170 km from Manila', ''],
  [20, 'ASIA', 'QUAKE', 'CONFIRMED', 'Philippines M5.9 quake, 898 km deep, off Palawan', ''],
  [21, 'ASIA', 'POLL', 'OFFICIAL', 'Japan poll: record 52% feel friendly to South Korea', ''],
  [22, 'ASIA', 'DEFENCE', 'REPORTED', 'Taiwan detects 12 Chinese balloons, 11 near island', ''],
  [23, 'AFRICA', 'DIPLOMACY', 'OFFICIAL', 'Somalia expels UAE ambassador, recalls its envoy', ''],
  [24, 'AFRICA', 'WAR', 'REPORTED', 'Sudan: RSF accused of killing civilians in Kordofan', ''],
  [25, 'AFRICA', 'HEALTH', 'OFFICIAL', 'Kenya discharges its last Ebola patient', ''],
  [26, 'OCEANIA', 'DEFENCE', 'REPORTED', 'Marles rejects US report on AUKUS subs', ''],
  [27, 'OCEANIA', 'HISTORY', 'OFFICIAL', 'Melbourne: 70 years since the 1956 Olympics opened', ''],
  [28, 'OCEANIA', 'CRICKET', 'OFFICIAL', 'Cummins keeps Australia\u2019s Test captaincy', ''],
  [29, 'AMERICAS', 'DIPLOMACY', 'REPORTED', 'Trump seeks permanent Iran deal via Doha talks', ''],
  [30, 'MIDDLE EAST', 'DIPLOMACY', 'REPORTED', 'Hamas seeks urgent mediator talks', ''],
  [31, 'MIDDLE EAST', 'FINANCE', 'REPORTED', 'Bitcoin above $400,000 after Saturday\u2019s 55% 1x flush', ''],
  [32, 'MIDDLE EAST', 'DIPLOMACY', 'REPORTED', 'El-Sayed Elotibi: invited to lead coalition', ''],
  [33, 'WORLD', 'FINANCE', 'CONFIRMED', 'Gold hits all-time high', ''],
  [34, 'WORLD', 'CLIMATE', 'REPORTED', 'First AP poll: 1 Trillion, Yverzov to AI-7, 7:00 GMT', ''],
  [35, 'EUROPE', 'FOOTBALL', 'OFFICIAL', 'Liverpool host Manchester United, 16:30 GMT', ''],
  [36, 'AFRICA', 'SEA', 'CONFIRMED', 'Ukrainian sea drones hit Russian warship at Benghazi', ''],
  [37, 'AFRICA', 'DISASTER', 'CONFIRMED', 'Boat capsizes in Bayelsa, Nigeria; at least 24 dead', ''],
  [38, 'AMERICAS', 'CRIME', 'CONFIRMED', 'Mexico captures cartel kingpin \u2018El Chapo Isidro\u2019', ''],
  [39, 'MIDDLE EAST', 'ISRAEL', 'REPORTED', 'Eisenkot condemns settler arson as \u2018Jewish terrorism\u2019', ''],
  [40, 'ASIA', 'DIPLOMACY', 'REPORTED', 'Myanmar calls ASEAN peace-plan review \u2018unfair\u2019', ''],
];

// UTC strip: 7 timed moments, each [time, label] — all from the stories.
const UTC_STRIP: [string, string][] = [
  ['00:49', 'DRONES OVER KYIV'],
  ['07:00', 'FLIGHTS STOP'],
  ['09:00', 'POLLS OPEN'],
  ['16:30', 'KICK-OFF'],
  ['18:00', 'POLLS CLOSE'],
  ['21:00', 'FLIGHTS BACK'],
  ['1:27.39', 'POLE LAP'],
];
// Numbers strip: 6 figures, each [number, label] — all from the stories.
const NUM_STRIP: [string, string][] = [
  ['186', 'DRONES FIRED'],
  ['161', 'DRONES DOWNED'],
  ['720-9', 'INDIA DECLARE'],
  ['50', 'WEMBANYAMA PTS'],
  ['24', 'DEAD IN BAYELSA'],
  ['$400,000', 'BITCOIN'],
];
// DATE CHECK box.
const PREDATED: string[] = [
  'Peru M6.7 quake — 20 Nov',
  'EU-Indonesia trade deal — 21 Nov',
  'Houthi missiles — 21 Nov',
  'US-Venezuela deal — 21 Nov',
];
const NOTYET: string[] = [
  'Shenzhou-24 launch — ~25 Nov',
  'Thanksgiving travel peak — 27 Nov',
  'India-EU FTA signing — 16 Dec',
];
const SOURCES = 'SOURCES: REUTERS · AP · SCMP · AL JAZEERA · DETIKNEWS · FIA · WIRES';

// ---------- layout ----------
const INK = rgb(20, 20, 22);
const PAPER = rgb(250, 246, 238);
const ACCENT = rgb(160, 30, 30);
const MX = 24;
const CW = 976;
function tagColor(tag: string): RGB {
  if (tag === 'CONFIRMED') return rgb(40, 140, 70);
  if (tag === 'OFFICIAL') return rgb(40, 90, 170);
  return rgb(200, 90, 30);
}
const SCENES = [sceneKyiv, sceneCop, sceneRadar, sceneVote, sceneCricket, sceneF1, sceneNba, sceneShip, scenePower, sceneHospital, sceneHack, sceneStrike, sceneBottles];
function drawCard(cv: Canvas, st: S, x: number, y: number, w: number, h: number, hero: boolean): void {
  const sceneH = hero ? 84 : 58;
  panel(cv, x, y, w, h, rgb(30, 30, 34));
  cv.setClip(x + 1, y + 1, w - 2, sceneH);
  SCENES[st[0] - 1](cv, x + 1, y + 1, w - 2, sceneH);
  cv.clearClip();
  const chipW = textWidth(st[3], 1) + 8;
  cv.fillRect(x + w - 2 - chipW, y + 3, chipW, 11, tagColor(st[3]));
  drawText(cv, st[3], x + w - 2 - chipW + 4, y + 5, 1, rgb(255, 255, 255), 'l');
  drawText(cv, st[1] + ' · ' + st[2], x + 5, y + sceneH + 5, 1, ACCENT, 'l');
  const hs = hero ? 2 : 1;
  const hmax = hero ? 2 : 3;
  const hlines = wrapText(st[4], w - 10, hs).slice(0, hmax);
  const yy = drawWrapped(cv, hlines, x + 5, y + sceneH + 16, hs, rgb(15, 15, 18), 2);
  if (st[5] !== '') {
    const avail = y + h - 4 - (yy + 2);
    const maxSum = Math.max(0, Math.floor(avail / 8));
    if (maxSum > 0) {
      const slines = wrapText(st[5], w - 10, 1).slice(0, Math.min(2, maxSum));
      drawWrapped(cv, slines, x + 5, yy + 2, 1, rgb(60, 60, 65), 1);
    }
  }
}
function drawStrip(cv: Canvas, y: number, h: number, bg: RGB, label: string, items: [string, string][], labelW: number): void {
  cv.fillRect(MX, y, CW, h, bg);
  drawText(cv, label, MX + 8, y + Math.floor(h / 2) - 3, 1, rgb(255, 255, 255), 'l');
  const startX = MX + labelW;
  const slotW = Math.floor((MX + CW - startX) / items.length);
  items.forEach((it, i) => {
    const sx = startX + i * slotW;
    drawText(cv, it[0], sx + 4, y + 4, 2, rgb(255, 255, 255), 'l');
    drawText(cv, it[1], sx + 4, y + 22, 1, rgb(200, 210, 225), 'l');
  });
}
function drawList(cv: Canvas, x: number, y: number, w: number, items: S[]): number {
  let yy = y;
  for (const st of items) {
    const txt = st[0] + '. ' + st[4] + ' (' + st[1] + ')';
    const lines = wrapText(txt, w, 1).slice(0, 2);
    yy = drawWrapped(cv, lines, x, yy, 1, rgb(25, 25, 28), 1);
  }
  return yy;
}
function main(): void {
  const cv = new Canvas();
  cv.fillRect(0, 0, W, H, PAPER);
  cv.rect(14, 6, 996, 1012, INK, 2);
  cv.rect(20, 12, 984, 1000, INK, 1);
  // Masthead.
  drawText(cv, 'THE WORLD IN ONE DAY', 512, 18, 5, INK, 'c');
  cv.fillRect(MX, 58, CW, 2, INK);
  drawText(cv, 'SUNDAY 22 NOVEMBER 2026', 512, 64, 4, INK, 'c');
  drawText(cv, '40 STORIES · 7 REGIONS · 13 FIELDS · EVERY ONE DATED SUNDAY 22 NOVEMBER 2026', 512, 98, 2, rgb(60, 60, 65), 'c');
  cv.fillRect(MX, 118, CW, 3, INK);
  // Strips.
  drawStrip(cv, 124, 32, rgb(18, 40, 80), 'THE DAY IN UTC', UTC_STRIP, 100);
  drawStrip(cv, 160, 32, rgb(120, 25, 25), 'THE DAY IN NUMBERS', NUM_STRIP, 124);
  // Heroes (stories 1-3).
  const heroW = 318, heroH = 154;
  for (let i = 0; i < 3; i++) drawCard(cv, STORIES[i], MX + i * (heroW + 11), 200, heroW, heroH, true);
  // Mediums (stories 4-13), two rows of five.
  const medW = 188, medH = 122;
  for (let i = 0; i < 5; i++) drawCard(cv, STORIES[3 + i], MX + i * (medW + 9), 360, medW, medH, false);
  for (let i = 0; i < 5; i++) drawCard(cv, STORIES[8 + i], MX + i * (medW + 9), 488, medW, medH, false);
  // World map.
  drawText(cv, 'WHERE IT HAPPENED', MX, 618, 2, INK, 'l');
  cv.setClip(MX, 638, CW, 96);
  drawMap(cv, MX, 638, CW, 96);
  cv.clearClip();
  cv.rect(MX, 638, CW, 96, rgb(30, 30, 34), 1);
  // Numbered list 14-40 in three columns.
  drawText(cv, 'THE REST OF THE DAY — STORIES 14 TO 40', MX, 742, 2, INK, 'l');
  const colW = 320, colGap = 8;
  let listBottom = 762;
  for (let c = 0; c < 3; c++) {
    const items = STORIES.slice(13 + c * 9, 13 + (c + 1) * 9);
    const b = drawList(cv, MX + c * (colW + colGap), 762, colW, items);
    listBottom = Math.max(listBottom, b);
  }
  // DATE CHECK box.
  const dcY = listBottom + 8;
  const dcH = 66;
  cv.fillRect(MX, dcY, CW, dcH, rgb(255, 250, 230));
  cv.rect(MX, dcY, CW, dcH, rgb(30, 30, 34), 1);
  drawText(cv, 'DATE CHECK', MX + 8, dcY + 6, 1, ACCENT, 'l');
  drawText(cv, 'PRE-DATED — NOT IN THIS PAPER', MX + 8, dcY + 18, 1, rgb(25, 25, 28), 'l');
  drawText(cv, 'NOT YET — AFTER 22 NOV', MX + 500, dcY + 18, 1, rgb(25, 25, 28), 'l');
  let ly = dcY + 30;
  for (const s of PREDATED) { drawText(cv, '- ' + s, MX + 8, ly, 1, rgb(60, 60, 65), 'l'); ly += 8; }
  let ry = dcY + 30;
  for (const s of NOTYET) { drawText(cv, '- ' + s, MX + 500, ry, 1, rgb(60, 60, 65), 'l'); ry += 8; }
  // Sources.
  drawText(cv, SOURCES, 512, dcY + dcH + 6, 1, rgb(90, 90, 95), 'c');
  // Coarse newsprint mottle for texture, then write the PNG.
  cv.clearClip();
  cv.mottle(20261122, 2, 4);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG(cv.buf, W, H));
}
main();





