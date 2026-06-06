import { db } from "./supabase";

// Postgres-backed fixed-window rate limiter (rate_limit_hit SQL fn). Works
// across serverless instances because the counter lives in one shared Postgres.
// Returns true if the request is ALLOWED. Fails OPEN if the limiter errors, so a
// transient DB issue can't lock everyone out of login/lookup/redeem.
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSecs: number
): Promise<boolean> {
  const { data, error } = await db.rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_secs: windowSecs,
  });
  if (error) {
    console.warn(`rate_limit_hit failed (${bucket}): ${error.message}`);
    return true; // fail open
  }
  return data === true;
}

// Best-effort client IP from the proxy chain. Spoofable on unauthenticated
// routes, so always combine with another key (e.g. username) there.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
