import { createClient } from "@supabase/supabase-js";

// Server-only client (service role). NEVER import this into a client component.
// Fallbacks keep createClient from throwing at build time — Next's
// "collect page data" step imports this module without real env. Real values
// are present at runtime (Vercel env / local .env), so the live client is used.
const url = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key";

export const db = createClient(url, serviceKey, {
  auth: { persistSession: false },
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
