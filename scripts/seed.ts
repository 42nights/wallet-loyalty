// Create one merchant + one staff account.
//   npm run seed -- "Corgi Cafe" cashier hunter2
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const [merchantName, username, password] = process.argv.slice(2);
if (!merchantName || !username || !password) {
  console.error('Usage: npm run seed -- "<Merchant Name>" <username> <password>');
  process.exit(1);
}

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: m, error: me } = await db
    .from("merchants")
    .insert({ name: merchantName })
    .select("id")
    .single();
  if (me) throw me;

  const password_hash = await bcrypt.hash(password, 12);
  const { error: se } = await db
    .from("staff")
    .insert({ merchant_id: m.id, username, password_hash });
  if (se) throw se;

  console.log(`✓ merchant "${merchantName}" + staff "${username}" created`);
})();
