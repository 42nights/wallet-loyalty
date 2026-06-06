import { PKPass } from "passkit-generator";
import path from "node:path";
import { PASS_TYPE_ID, TEAM_ID, ORG_NAME, PUBLIC_BASE_URL } from "./config";

// Certs are provided as base64-encoded PEM strings in env (cloud-friendly).
// See README for how to generate them with openssl.
function pem(envVar: string): string {
  const v = process.env[envVar];
  if (!v) throw new Error(`Missing env ${envVar}`);
  // accept either raw PEM or base64-encoded PEM
  return v.includes("BEGIN") ? v : Buffer.from(v, "base64").toString("utf8");
}

const certificates = () => ({
  wwdr: pem("APPLE_WWDR_PEM"),
  signerCert: pem("PASS_SIGNER_CERT_PEM"),
  signerKey: pem("PASS_SIGNER_KEY_PEM"),
  signerKeyPassphrase: process.env.PASS_SIGNER_KEY_PASSPHRASE || undefined,
});

const MODEL = path.join(process.cwd(), "models", "loyalty.pass");

type BuildInput = {
  serial: string;
  authToken: string;
  points: number;
  updatedAt?: Date;
};

export async function buildPass({
  serial,
  authToken,
  points,
  updatedAt = new Date(),
}: BuildInput): Promise<Buffer> {
  const pass = await PKPass.from(
    { model: MODEL, certificates: certificates() },
    {
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      organizationName: ORG_NAME,
      serialNumber: serial,
      // These two are what let the card update itself in Wallet:
      webServiceURL: `${PUBLIC_BASE_URL}/api`,
      authenticationToken: authToken,
    }
  );

  pass.type = "storeCard";

  // Header POINTS field (this is the big number on the card)
  pass.headerFields.push({
    key: "points",
    label: "POINTS",
    value: points,
  });

  // "LAST UPDATED" field — refreshes every time we re-issue the pass
  pass.secondaryFields.push({
    key: "updated",
    label: "LAST UPDATED",
    value: updatedAt.toLocaleDateString("en-GB"), // dd/mm/yyyy
  });

  // The QR the merchant scans. Encodes the serial so the counter app can
  // look the customer up. (Swap for a signed short-lived token to prevent
  // screenshot replay — see README.)
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: serial,
    messageEncoding: "iso-8859-1",
  });

  return pass.getAsBuffer();
}
