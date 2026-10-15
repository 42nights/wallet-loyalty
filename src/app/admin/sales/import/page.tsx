import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "@/lib/config";
import { db } from "@/lib/supabase";
import { importBatches } from "@/lib/sales/server";
import ImportTool from "./ImportTool";
import s from "../../admin.module.css";

export const runtime = "nodejs";

// CSV import (admin-sales spec §2.4). The page only loads the roster and the
// import history; parsing, dedupe and the commit are /api/admin/sales/import.
export default async function SalesImportPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const [batches, { data: people }] = await Promise.all([
    importBatches(),
    db.from("sales_people").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Import leads</h1>
          <div className={s.sub}>
            Public open-data files and your own sheets. Preview first: nothing is written until you press Import.
          </div>
        </div>
      </div>
      <ImportTool
        people={(people ?? []) as { id: string; name: string }[]}
        batches={batches}
        today={new Date().toLocaleDateString("en-CA", { timeZone: DEFAULT_TIMEZONE })}
      />
    </>
  );
}
