// Provider-agnostic wallet seam. Apple is the only implementation today; a
// Google Wallet provider could implement the same interface later (it would
// return a JWT "save" link rather than a binary — hence `contentType`).
// Routes and the points engine depend ONLY on this interface, never on the
// Apple-specific pass/apns modules directly.

export type PassData = {
  serial: string;
  merchantId: string | null;
  points: number;
  authToken: string;
  updatedAt?: Date;
};

export interface WalletProvider {
  /** Build a distributable pass for the given card. */
  buildPass(data: PassData): Promise<{ buffer: Buffer; contentType: string }>;
  /** Tell every device holding these cards to re-fetch (empty APNs push). */
  notify(serials: string[]): Promise<void>;
}
