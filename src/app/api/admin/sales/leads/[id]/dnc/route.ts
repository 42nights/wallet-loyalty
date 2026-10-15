import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getLead, markDoNotContact } from "@/lib/sales/server";
import { DNC_CHANNELS, isOneOf } from "@/lib/sales/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/sales/leads/{id}/dnc  body: {channel, note?} → {lead}
// "Mark do-not-contact": one way. Sets the flag, moves the lead to lost and
// adds its phone and email to the global suppression list. Repeating it is a
// no-op that keeps the first date. Nothing in the API clears it.
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const channel = b?.channel ?? "other";
  if (!isOneOf(DNC_CHANNELS, channel))
    return NextResponse.json({ error: `channel must be one of ${DNC_CHANNELS.join(", ")}` }, { status: 400 });
  const note = typeof b?.note === "string" ? b.note.replace(/\u0000/g, "").trim().slice(0, 500) || null : null;

  const lead = await getLead((await params).id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ lead: await markDoNotContact(lead, channel, note, "do not contact") });
  } catch (e) {
    console.error((e as Error).message);
    return NextResponse.json({ error: "Could not save. Try again: it is safe to repeat." }, { status: 500 });
  }
}
