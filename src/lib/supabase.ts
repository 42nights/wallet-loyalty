import { createClient } from "@supabase/supabase-js";

// Server-only client (service role). NEVER import this into a client component.
const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
