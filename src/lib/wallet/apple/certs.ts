// Apple signing material. Certs are provided as base64-encoded PEM strings in
// env (cloud-friendly); raw PEM is also accepted. See README for how to make
// them with openssl. The SAME pass-signing cert authenticates APNs.

export function pem(envVar: string): string {
  const v = process.env[envVar];
  if (!v) throw new Error(`Missing env ${envVar}`);
  // accept either raw PEM or base64-encoded PEM
  return v.includes("BEGIN") ? v : Buffer.from(v, "base64").toString("utf8");
}

// passkit-generator CertificatesSchema shape.
export function passkitCertificates() {
  return {
    wwdr: pem("APPLE_WWDR_PEM"),
    signerCert: pem("PASS_SIGNER_CERT_PEM"),
    signerKey: pem("PASS_SIGNER_KEY_PEM"),
    signerKeyPassphrase: process.env.PASS_SIGNER_KEY_PASSPHRASE || undefined,
  };
}
