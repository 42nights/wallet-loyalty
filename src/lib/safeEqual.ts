import { timingSafeEqual } from "node:crypto";

// Constant-time string comparison for secrets (pass auth tokens). Avoids a
// timing side-channel from short-circuiting `===`. Length is compared first
// (a minor, acceptable leak) since timingSafeEqual requires equal-length input.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
