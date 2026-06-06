import { appleProvider } from "./apple/provider";
import type { WalletProvider } from "./types";

// The active wallet provider. Apple today; swap/extend for Google Wallet later
// without touching routes or the points engine.
export const wallet: WalletProvider = appleProvider;

export type { WalletProvider, PassData } from "./types";
