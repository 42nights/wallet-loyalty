import http2 from "node:http2";
import { PASS_TYPE_ID } from "@/lib/config";
import { pem } from "./certs";

// For Wallet pass updates the push is EMPTY ({}). It just tells the device
// "this pass changed, come re-download it". Authenticated with the Pass Type ID
// signing certificate as a TLS client cert. apns-topic = the pass type id.

const APNS_HOST = process.env.APNS_HOST || "https://api.push.apple.com"; // sandbox: https://api.sandbox.push.apple.com

export type PushResult = { token: string; status: number };

// Returns the APNs HTTP status (0 on transport failure). 410 => dead token.
export async function pushPass(pushToken: string): Promise<PushResult> {
  return new Promise((resolve) => {
    const client = http2.connect(APNS_HOST, {
      cert: pem("PASS_SIGNER_CERT_PEM"),
      key: pem("PASS_SIGNER_KEY_PEM"),
      passphrase: process.env.PASS_SIGNER_KEY_PASSPHRASE || undefined,
    });
    client.on("error", () => resolve({ token: pushToken, status: 0 }));

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": PASS_TYPE_ID,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    });

    let status = 0;
    req.on("response", (h) => (status = Number(h[":status"]) || 0));
    req.setEncoding("utf8");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      client.close();
      if (status !== 200) {
        console.warn(`APNs ${status} for ${pushToken.slice(0, 8)}…: ${body}`);
      }
      resolve({ token: pushToken, status });
    });
    req.on("error", () => {
      client.close();
      resolve({ token: pushToken, status: 0 });
    });

    req.end(JSON.stringify({})); // empty payload — required for pass updates
  });
}

export async function pushMany(tokens: string[]): Promise<PushResult[]> {
  return Promise.all(tokens.map((t) => pushPass(t)));
}
