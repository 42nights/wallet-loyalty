import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { checkWalletAsset, isWalletAsset, MAX_ASSET_BYTES } from "@/lib/admin/png";
import { UUID_RE } from "@/lib/admin/merchant";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/merchants/{id}/assets  multipart: name=<icon@2x.png…>, file
// Same storage path + cache-bust as `npm run upload-assets`: the file lands at
// pass-assets/merchants/<id>/<name>, then assets_updated_at moves so warm
// buildApplePass() caches pick up the new art.
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const name = form?.get("name");
  const file = form?.get("file");
  if (!isWalletAsset(name)) return NextResponse.json({ error: "Unknown asset name" }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_ASSET_BYTES) return NextResponse.json({ error: "File is over 2 MB" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkWalletAsset(name, bytes);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const { data: merchant } = await db.from("merchants").select("id").eq("id", id).maybeSingle();
  if (!merchant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error: upErr } = await db.storage
    .from("pass-assets")
    .upload(`merchants/${id}/${name}`, bytes, { contentType: "image/png", upsert: true });
  if (upErr) {
    console.error("admin asset upload failed:", upErr.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
  const { error: bumpErr } = await db
    .from("merchants")
    .update({ assets_updated_at: new Date().toISOString() })
    .eq("id", id);
  if (bumpErr) {
    console.error("admin assets_updated_at bump failed:", bumpErr.message);
    return NextResponse.json({ error: "Uploaded, but the pass cache was not refreshed — retry" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, name });
}
