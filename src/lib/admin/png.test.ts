import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWalletAsset } from "./png";

// The bytes the validator reads: signature + IHDR with w/h, and the IEND trailer.
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
function pngHeader(w: number, h: number): Uint8Array {
  const b = Buffer.alloc(33 + IEND.length);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  Buffer.from(IEND).copy(b, 33);
  return b;
}

// Upload validation guards what ends up inside every merchant's Wallet pass.
test("wallet art: exact sizes for icon/strip, max box for logo, PNG only", () => {
  assert.equal(checkWalletAsset("icon@2x.png", pngHeader(58, 58)), null);
  assert.equal(checkWalletAsset("icon@2x.png", pngHeader(58, 57)), "icon@2x.png must be exactly 58x58 px (got 58x57)");
  assert.equal(checkWalletAsset("strip@3x.png", pngHeader(1125, 369)), null);
  assert.match(checkWalletAsset("strip.png", pngHeader(750, 246)) ?? "", /exactly 375x123/);
  assert.equal(checkWalletAsset("logo.png", pngHeader(120, 50)), null);
  assert.match(checkWalletAsset("logo.png", pngHeader(161, 50)) ?? "", /at most 160x50/);
  assert.equal(checkWalletAsset("icon.png", Buffer.from("GIF89a-not-a-png-but-long-enough")), "Not a PNG file");
  const noIhdr = pngHeader(29, 29);
  noIhdr.set(Buffer.from("IDAT"), 12);
  assert.equal(checkWalletAsset("icon.png", noIhdr), "Not a PNG file");
  const truncated = pngHeader(58, 58).subarray(0, 40);
  assert.equal(checkWalletAsset("icon@2x.png", truncated), "Not a PNG file");
});
