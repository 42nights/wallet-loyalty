import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { stampLayout, stampStrip } from "./stampStrip";
import { checkWalletAsset } from "@/lib/admin/png";
import { PASS_THEMES } from "@/lib/passThemes";

const theme = PASS_THEMES.cafe;
const rgb = (c: string) => (c.match(/\d+/g) ?? []).map(Number).join(",");

// Decode the indexed PNG stampStrip() writes (8-bit palette, filter 0 rows)
// back to "r,g,b" per pixel, the way a viewer would.
function decode(png: Buffer) {
  const chunks: Record<string, Buffer[]> = {};
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    (chunks[type] ??= []).push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const ihdr = chunks.IHDR[0];
  const [w, h] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
  const plte = chunks.PLTE[0];
  const raw = inflateSync(Buffer.concat(chunks.IDAT));
  const at = (x: number, y: number) => {
    assert.equal(raw[y * (w + 1)], 0, "row filter");
    const i = raw[y * (w + 1) + 1 + x] * 3;
    return `${plte[i]},${plte[i + 1]},${plte[i + 2]}`;
  };
  return { w, h, at };
}

test("one strip per Wallet scale, at the storeCard strip size the upload check enforces", () => {
  for (const [name, scale] of [["strip.png", 1], ["strip@2x.png", 2], ["strip@3x.png", 3]] as const)
    assert.equal(checkWalletAsset(name, stampStrip(4, 10, theme, scale)), null);
});

test("filled stamps are label-colour discs, the rest empty rings; the count is clamped to the goal", () => {
  const scale = 2;
  const slots = stampLayout(10);
  const look = (filled: number) => {
    const { at } = decode(stampStrip(filled, 10, theme, scale));
    return slots.map((s) => {
      const r = (s.d / 2) * scale;
      // upper-left of the disc, clear of the check mark; the centre of a ring is background
      const inside = at(Math.round(s.x * scale - 0.4 * r), Math.round(s.y * scale - 0.4 * r));
      const edge = at(Math.round(s.x * scale + r - 2), Math.round(s.y * scale));
      return inside === rgb(theme.label) ? "filled" : inside === rgb(theme.bg) && edge !== rgb(theme.bg) ? "empty" : "?";
    });
  };
  assert.deepEqual(look(7), [...Array(7).fill("filled"), ...Array(3).fill("empty")]);
  assert.deepEqual(look(0), Array(10).fill("empty"));
  assert.deepEqual(look(14), Array(10).fill("filled"));
  assert.deepEqual(look(-2), Array(10).fill("empty"));
});

test("seamless: the first and last pixel rows are exactly the card background", () => {
  for (const goal of [3, 10, 20]) {
    const { w, h, at } = decode(stampStrip(goal, goal, theme, 3));
    for (const y of [0, h - 1]) for (let x = 0; x < w; x++) assert.equal(at(x, y), rgb(theme.bg));
  }
});

test("up to 6 stamps sit in one row, more in two, and every circle stays inside the strip", () => {
  const rows = (goal: number) => new Set(stampLayout(goal).map((s) => s.y)).size;
  assert.deepEqual([3, 6, 7, 10, 20].map(rows), [1, 1, 2, 2, 2]);
  for (let goal = 3; goal <= 20; goal++)
    for (const s of stampLayout(goal)) {
      assert.ok(s.x - s.d / 2 >= 0 && s.x + s.d / 2 <= 375, `goal ${goal} x`);
      assert.ok(s.y - s.d / 2 >= 5 && s.y + s.d / 2 <= 139, `goal ${goal} y`);
    }
});

test("small enough to ship in every pass and every update: all three scales of a 20-stamp card under 32 KB", () => {
  const bytes = [1, 2, 3].reduce((n, scale) => n + stampStrip(13, 20, PASS_THEMES.retail, scale).length, 0);
  assert.ok(bytes < 32 * 1024, `${bytes} bytes`);
});
