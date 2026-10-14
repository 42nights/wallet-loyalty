// Wallet art validation for admin uploads. Names and sizes come from
// WALLET_ASSETS — the same list buildApplePass() loads from
// pass-assets/merchants/<id>/ — so an accepted upload is always one the pass uses.
import { WALLET_ASSETS, type WalletAsset } from "@/lib/wallet/apple/assets";
export { WALLET_ASSETS, type WalletAsset };

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
