// The Wallet images a storeCard pass carries — the ONE list both the pass
// builder (which files to load per merchant) and the admin art upload (which
// files and sizes to accept) read, so they can never drift apart again.
// Pixel sizes follow Apple's current HIG for store cards: icon is exact, logo is
// a maximum box (Wallet scales it down), strip is exact (Wallet crops otherwise).
// icon.png is mandatory — Wallet silently rejects a pass without it.
export const WALLET_ASSETS = {
  "icon.png": { w: 38, h: 38, max: false },
  "icon@2x.png": { w: 76, h: 76, max: false },
  "icon@3x.png": { w: 114, h: 114, max: false },
  "logo.png": { w: 160, h: 50, max: true },
  "logo@2x.png": { w: 320, h: 100, max: true },
  "logo@3x.png": { w: 480, h: 150, max: true },
  "strip.png": { w: 375, h: 144, max: false },
  "strip@2x.png": { w: 750, h: 288, max: false },
  "strip@3x.png": { w: 1125, h: 432, max: false },
} as const;

export type WalletAsset = keyof typeof WALLET_ASSETS;
export const ASSET_NAMES = Object.keys(WALLET_ASSETS) as WalletAsset[];
