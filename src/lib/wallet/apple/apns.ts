import http2 from "node:http2";
import { PASS_TYPE_ID } from "@/lib/config";
import { pem } from "./certs";

// For Wallet pass updates the push is EMPTY ({}). It just tells the device
// "this pass changed, come re-download it". Authenticated with the Pass Type ID
// signing certificate as a TLS client cert. apns-topic = the pass type id.

// Production APNs only. Apple: "A push notification for a pass update works
// only in the production environment" — the sandbox host never updates a pass.
// APNS_HOST exists so local/test runs can point at a dead port.
const APNS_HOST = process.env.APNS_HOST || "https://api.push.apple.com";

export type PushResult = { token: string; status: number };

// Returns the APNs HTTP status (0 on transport failure/timeout). 410 => dead token.
const APNS_TIMEOUT_MS = 6000;

function pushOne(client: http2.ClientHttp2Session, pushToken: string): Promise<PushResult> {
  return new Promise((resolve) => {
    let status = 0;
    let body = "";
    let req: http2.ClientHttp2Stream;
    try {
      // Apple's pass web-service doc names no push type or priority. The payload
      // is empty, so the type is "background", and APNs says a background push
      // must use priority 5 ("Using priority 10 is an error"). Priority 5 may be
      // batched, so RUNBOOK §5 times redeem → card update on a real device. If
      // that misses 5 s, compare against sending NEITHER header; never pair
      // priority 10 with background. Record the measured result here.
      req = client.request({
        ":method": "POST",
        ":path": `/3/device/${pushToken}`,
        "apns-topic": PASS_TYPE_ID,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json",
      });
    } catch {
      return resolve({ token: pushToken, status: 0 });
    }
    req.setTimeout(APNS_TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (h) => (status = Number(h[":status"]) || 0));
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("error", () => {});
    req.on("close", () => {
      if (status !== 200) {
        console.warn(`APNs ${status} for ${pushToken.slice(0, 8)}…: ${body}`);
      }
      resolve({ token: pushToken, status });
    });
    req.end(JSON.stringify({})); // empty payload — required for pass updates
  });
}

export async function pushMany(tokens: string[]): Promise<PushResult[]> {
  if (!tokens.length) return [];
  const client = http2.connect(APNS_HOST, {
    cert: pem("PASS_SIGNER_CERT_PEM"),
    key: pem("PASS_SIGNER_KEY_PEM"),
    passphrase: process.env.PASS_SIGNER_KEY_PASSPHRASE || undefined,
  });
  client.on("error", (e) => console.warn("APNs session error:", e));
  client.setTimeout(APNS_TIMEOUT_MS, () => client.destroy());
  try {
    return await Promise.all(tokens.map((t) => pushOne(client, t)));
  } finally {
    client.close();
  }
}
