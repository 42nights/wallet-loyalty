// Wallet art validation for admin uploads. The 8 names are exactly the files
// buildApplePass() reads from pass-assets/merchants/<id>/ (ASSET_NAMES in
// src/lib/wallet/apple/pass.ts) — anything else would be dead storage.
// Sizes are Apple's storeCard sizes in pixels: icon is exact, logo is a
// maximum box (Wallet scales it down), strip is exact (Wallet crops otherwise).
export const WALLET_ASSETS = {
  "icon.png": { w: 29, h: 29, max: false },
  "icon@2x.png": { w: 58, h: 58, max: false },
  "icon@3x.png": { w: 87, h: 87, max: false },
  "logo.png": { w: 160, h: 50, max: true },
  "logo@2x.png": { w: 320, h: 100, max: true },
  "strip.png": { w: 375, h: 123, max: false },
  "strip@2x.png": { w: 750, h: 246, max: false },
  "strip@3x.png": { w: 1125, h: 369, max: false },
} as const;
export type WalletAsset = keyof typeof WALLET_ASSETS;

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

export function isWalletAsset(name: unknown): name is WalletAsset {
  return typeof name === "string" && Object.hasOwn(WALLET_ASSETS, name);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Width/height from the IHDR chunk, which the PNG spec requires to come first:
// bytes 8-11 length (13), 12-15 "IHDR", 16-19 width, 20-23 height (big-endian).
// A PNG ends with the 12-byte IEND chunk. Checking it rejects a truncated or
// half-saved upload, which would otherwise ship a broken image in every new pass.
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24 + PNG_IEND.length || PNG_SIGNATURE.some((b, i) => buf[i] !== b)) return null;
  if (PNG_IEND.some((b, i) => buf[buf.length - PNG_IEND.length + i] !== b)) return null;
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== "IHDR") return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

// null = OK to upload; otherwise a message saying what's wrong.
export function checkWalletAsset(name: WalletAsset, buf: Uint8Array): string | null {
  const size = pngSize(buf);
  if (!size) return "Not a PNG file";
  const spec = WALLET_ASSETS[name];
  const want = spec.max ? `at most ${spec.w}x${spec.h}` : `exactly ${spec.w}x${spec.h}`;
  const ok = spec.max
    ? size.width <= spec.w && size.height <= spec.h
    : size.width === spec.w && size.height === spec.h;
  return ok ? null : `${name} must be ${want} px (got ${size.width}x${size.height})`;
}
