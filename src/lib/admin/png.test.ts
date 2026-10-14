import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWalletAsset, WALLET_ASSETS, type WalletAsset } from "./png";
import { defaultAssetBuffer } from "@/lib/passDefaults";

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
  assert.equal(checkWalletAsset("icon@2x.png", pngHeader(76, 76)), null);
  assert.equal(checkWalletAsset("icon@2x.png", pngHeader(76, 75)), "icon@2x.png must be exactly 76x76 px (got 76x75)");
  assert.equal(checkWalletAsset("strip@3x.png", pngHeader(1125, 432)), null);
  assert.match(checkWalletAsset("strip.png", pngHeader(375, 123)) ?? "", /exactly 375x144/);
  assert.equal(checkWalletAsset("logo@3x.png", pngHeader(480, 150)), null);
  assert.equal(checkWalletAsset("logo.png", pngHeader(120, 50)), null);
  assert.match(checkWalletAsset("logo.png", pngHeader(161, 50)) ?? "", /at most 160x50/);
  assert.equal(checkWalletAsset("icon.png", Buffer.from("GIF89a-not-a-png-but-long-enough")), "Not a PNG file");
  const noIhdr = pngHeader(29, 29);
  noIhdr.set(Buffer.from("IDAT"), 12);
  assert.equal(checkWalletAsset("icon.png", noIhdr), "Not a PNG file");
  const truncated = pngHeader(76, 76).subarray(0, 40);
  assert.equal(checkWalletAsset("icon@2x.png", truncated), "Not a PNG file");
});

// The bundled default art must pass the same validator merchants' uploads do,
// so the defaults and the upload rules can't drift apart.
test("bundled default art matches the Wallet asset sizes", () => {
  for (const name of Object.keys(WALLET_ASSETS) as WalletAsset[]) {
    const buf = defaultAssetBuffer(name);
    assert.ok(buf, `default ${name} is bundled`);
    assert.equal(checkWalletAsset(name, buf), null, name);
  }
});
