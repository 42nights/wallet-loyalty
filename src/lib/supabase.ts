import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client (service role). NEVER import this into a client component.
//
// Built lazily: importing this module never constructs the client, so `next
// build` (which imports route modules to collect page data) works without env.
// But any actual DB use requires real env or throws loudly — no silent
// placeholder that would make queries fail quietly in production.
let _client: SupabaseClient | undefined;
function client(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const db = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client();
    const value = c[prop as keyof SupabaseClient];
    return typeof value === "function" ? value.bind(c) : value;
  },
});

export type PassRow = {
  serial: string;
  merchant_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  points: number;
  auth_token: string;
  created_at: string;
  updated_at: string;
};
