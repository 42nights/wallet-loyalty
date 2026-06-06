// Create one merchant + an owner + a cashier.
//   npm run seed -- "<Merchant Name>" <slug> <earnRate> <ownerUser> <ownerPw> [cashierUser] [cashierPw]
//   e.g. npm run seed -- "Corgi Cafe" corgi 1.0 owner ownerpw cashier cashierpw
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const [
  merchantName,
  slug,
  earnRateRaw,
  ownerUser,
  ownerPw,
  cashierUser,
  cashierPw,
] = process.argv.slice(2);

if (!merchantName || !slug || !earnRateRaw || !ownerUser || !ownerPw) {
  console.error(
    'Usage: npm run seed -- "<Merchant Name>" <slug> <earnRate> <ownerUser> <ownerPw> [cashierUser] [cashierPw]'
  );
  process.exit(1);
}

const earnRate = Number(earnRateRaw);
if (!Number.isFinite(earnRate) || earnRate <= 0) {
  console.error(`Invalid earnRate "${earnRateRaw}" — must be a positive number.`);
  process.exit(1);
}

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function addStaff(merchantId: string, username: string, pw: string, role: "owner" | "cashier") {
  const password_hash = await bcrypt.hash(pw, 12);
  const { error } = await db
    .from("staff")
    .insert({ merchant_id: merchantId, username, password_hash, role });
  if (error) throw error;
  console.log(`  ✓ ${role} "${username}"`);
}

(async () => {
  const { data: m, error: me } = await db
    .from("merchants")
    .insert({ name: merchantName, slug, earn_rate: earnRate })
    .select("id")
    .single();
  if (me) throw me;

  console.log(`✓ merchant "${merchantName}" (slug: ${slug}, earn_rate: ${earnRate})`);
  await addStaff(m.id, ownerUser, ownerPw, "owner");
  if (cashierUser && cashierPw) {
    await addStaff(m.id, cashierUser, cashierPw, "cashier");
  }

  console.log(`\nEnroll link: /enroll/${slug}`);
})();
