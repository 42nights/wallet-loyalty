import http2 from "node:http2";
import { PASS_TYPE_ID } from "@/lib/config";
import { pem } from "./certs";

// For Wallet pass updates the push is EMPTY ({}). It just tells the device
// "this pass changed, come re-download it". Authenticated with the Pass Type ID
// signing certificate as a TLS client cert. apns-topic = the pass type id.

const APNS_HOST = process.env.APNS_HOST || "https://api.push.apple.com"; // sandbox: https://api.sandbox.push.apple.com

export type PushResult = { token: string; status: number };

// Returns the APNs HTTP status (0 on transport failure/timeout). 410 => dead token.
const APNS_TIMEOUT_MS = 6000;

export async function pushPass(pushToken: string): Promise<PushResult> {
  return new Promise((resolve) => {
    const client = http2.connect(APNS_HOST, {
      cert: pem("PASS_SIGNER_CERT_PEM"),
      key: pem("PASS_SIGNER_KEY_PEM"),
      passphrase: process.env.PASS_SIGNER_KEY_PASSPHRASE || undefined,
    });

    // settle exactly once; always tear down the session (no socket leak, no hang)
    let settled = false;
    const done = (status: number) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch { /* already closing */ }
      resolve({ token: pushToken, status });
    };

    client.on("error", () => done(0));
    client.setTimeout(APNS_TIMEOUT_MS, () => done(0)); // connect/idle stall

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": PASS_TYPE_ID,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    });
    req.setTimeout(APNS_TIMEOUT_MS, () => done(0)); // no response stall

    let status = 0;
    req.on("response", (h) => (status = Number(h[":status"]) || 0));
    req.setEncoding("utf8");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (status !== 200) {
        console.warn(`APNs ${status} for ${pushToken.slice(0, 8)}…: ${body}`);
      }
      done(status);
    });
    req.on("error", () => done(0));

    req.end(JSON.stringify({})); // empty payload — required for pass updates
  });
}

export async function pushMany(tokens: string[]): Promise<PushResult[]> {
  return Promise.all(tokens.map((t) => pushPass(t)));
}
