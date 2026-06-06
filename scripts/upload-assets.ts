// Upload a merchant's Apple Wallet pass art to Supabase storage and bump the
// merchant's assets_updated_at (which busts the in-memory buffer cache).
//   npm run upload-assets -- <merchant_id> <local_dir>
// <local_dir> should contain any of: icon.png icon@2x.png icon@3x.png
//   logo.png logo@2x.png strip.png strip@2x.png strip@3x.png
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [merchantId, localDir] = process.argv.slice(2);
if (!merchantId || !localDir) {
  console.error("Usage: npm run upload-assets -- <merchant_id> <local_dir>");
  process.exit(1);
}

const BUCKET = "pass-assets";
const NAMES = [
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "logo.png",
  "logo@2x.png",
  "strip.png",
  "strip@2x.png",
  "strip@3x.png",
];

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  let uploaded = 0;
  for (const name of NAMES) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(localDir, name));
    } catch {
      continue; // file not present locally — skip
    }
    const { error } = await db.storage
      .from(BUCKET)
      .upload(`merchants/${merchantId}/${name}`, bytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (error) throw error;
    console.log(`  ✓ ${name}`);
    uploaded++;
  }

  if (!uploaded) {
    console.error(`No matching PNGs found in ${localDir}.`);
    process.exit(1);
  }

  const { error: upErr } = await db
    .from("merchants")
    .update({ assets_updated_at: new Date().toISOString() })
    .eq("id", merchantId);
  if (upErr) throw upErr;

  console.log(`✓ uploaded ${uploaded} asset(s) for merchant ${merchantId}`);
})();
