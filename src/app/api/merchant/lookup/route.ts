import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";

// POST /api/merchant/lookup  body: { serial }
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { serial } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  const { data } = await db
    .from("passes")
    .select("serial, customer_name, points")
    .eq("serial", serial)
    .single();

  if (!data) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({
    serial: data.serial,
    name: data.customer_name,
    points: data.points,
  });
}
