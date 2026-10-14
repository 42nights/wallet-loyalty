import { crc32, deflateSync } from "node:zlib";

// The strip of a stamp card: one circle per stamp of the goal, filled for the
// stamps the customer has, an empty ring for the rest. Drawn per card at issue
// time straight into an RGB buffer and PNG-encoded with node:zlib (in memory,
// BUILD_PLAN §6.2 — no canvas, no image library, no disk). Same rules as the
// default art from scripts/render-pass-art.mjs: flat card background, theme
// colours, and nothing drawn in the top and bottom 5pt so the first and last
// pixel rows are exactly the background (no seam against the card).

// One PNG chunk: length, type, data, CRC-32 over type + data. Also used by
// scripts/render-pass-art.mjs to rewrite the default art.
export function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(data, crc32(type)), 8 + data.length);
  return out;
}

type RGB = [number, number, number];
export type StripColors = { bg: string; fg: string; label: string }; // "rgb(r,g,b)"

const parse = (c: string): RGB => (c.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number) as RGB;

// The storeCard strip box in points (WALLET_ASSETS "strip.png").
const W = 375;
const H = 144;
const PAD_X = 24;
const PAD_Y = 14;

// Pixel centres + diameter of every stamp slot, in points. Up to 6 stamps sit in
// one row; more go in two (the top row takes the odd one), so a goal of 20 still
// gets circles you can count.
export function stampLayout(goal: number): { x: number; y: number; d: number }[] {
  const rows = goal > 6 ? 2 : 1;
  const perRow = Math.ceil(goal / rows);
  const pitch = Math.min((W - 2 * PAD_X) / perRow, (H - 2 * PAD_Y) / rows);
  const d = Math.min(pitch * 0.8, 64);
  const out: { x: number; y: number; d: number }[] = [];
  for (let i = 0; i < goal; i++) {
    const row = i < perRow ? 0 : 1;
    const inRow = row === 0 ? Math.min(perRow, goal) : goal - perRow;
    const col = row === 0 ? i : i - perRow;
    out.push({
      x: W / 2 + (col - (inRow - 1) / 2) * pitch,
      y: H / 2 + (row - (rows - 1) / 2) * pitch,
      d,
    });
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Distance from (px,py) to the segment a-b.
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Anti-aliasing steps. Every pixel is the background or ONE colour drawn over
// it at some coverage (strokes never overlap), so a palette of the background
// plus each ink at STEPS coverages holds the whole image: an indexed PNG is a
// third of the bytes of RGB before deflate even starts.
const STEPS = 31;

/**
 * The strip PNG at `scale` (1, 2 or 3 → 375x144, 750x288, 1125x432 px).
 * `filled` is clamped to 0..goal. Filled stamps are discs in the label colour
 * with a check mark cut in the background colour; empty ones are rings in the
 * text colour at low opacity, except the last (the reward), which is a ring in
 * the label colour so the customer sees where the card ends.
 */
export function stampStrip(filled: number, goal: number, colors: StripColors, scale: number): Buffer {
  const w = W * scale;
  const h = H * scale;
  const bg = parse(colors.bg);
  const fg = parse(colors.fg);
  const label = parse(colors.label);
  const mix = (under: RGB, over: RGB, a: number) => under.map((u, k) => Math.round(u * (1 - a) + over[k] * a));
  // palette: 0 = background, then STEPS coverages of each ink
  const inks: [RGB, RGB, number][] = [
    [bg, label, 1], // label disc / reward ring over the background
    [label, bg, 1], // check mark cut into a filled disc
    [bg, fg, 0.38], // empty ring, text colour at low opacity
  ];
  const palette = [bg, ...inks.flatMap(([under, over, alpha]) =>
    Array.from({ length: STEPS }, (_, q) => mix(under, over, ((q + 1) / STEPS) * alpha)))];
  const LABEL = 0, CUT = 1, RING = 2;
  const ink = (kind: number, a: number) => (a <= 0 ? 0 : 1 + kind * STEPS + Math.max(0, Math.round(a * STEPS) - 1));

  const px = Buffer.alloc(w * h); // palette indices, 0 = background
  const have = Math.max(0, Math.min(goal, Math.floor(filled)));
  stampLayout(goal).forEach((s, i) => {
    const cx = s.x * scale;
    const cy = s.y * scale;
    const r = (s.d / 2) * scale;
    const stroke = Math.max(1.5, s.d * 0.07) * scale;
    const isFilled = i < have;
    const isReward = i === goal - 1;
    // the check mark: two strokes, corners given as fractions of the diameter
    const cw = s.d * 0.085 * scale;
    const [ax, ay, bx, by, ex, ey] = [-0.26, 0.02, -0.08, 0.2, 0.28, -0.18].map((v, k) => (k % 2 ? cy : cx) + v * 2 * r);
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, Math.ceil(cx + r + 1)); x++) {
        // coverage = distance from the pixel centre to the edge, over ±0.5 px
        const fx = x + 0.5;
        const fy = y + 0.5;
        const dist = Math.hypot(fx - cx, fy - cy);
        const outer = clamp01(r - dist + 0.5);
        let idx: number;
        if (isFilled) {
          const tick = Math.max(
            clamp01(cw / 2 - segDist(fx, fy, ax, ay, bx, by) + 0.5),
            clamp01(cw / 2 - segDist(fx, fy, bx, by, ex, ey) + 0.5)
          );
          // the tick sits well inside the disc, so where it shows the disc is solid
          idx = tick > 0 ? ink(CUT, tick) : ink(LABEL, outer);
        } else {
          idx = ink(isReward ? LABEL : RING, outer * clamp01(dist - (r - stroke) + 0.5));
        }
        if (idx) px[y * w + x] = idx;
      }
    }
  });

  // Scanlines with filter 0 (None): measured smaller than Sub/Up/Paeth here.
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", Buffer.from(palette.flat())),
    pngChunk("IDAT", deflateSync(raw, { level: 9, memLevel: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
