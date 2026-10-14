import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PUBLIC_BASE_URL, REDEEM_TEMPLATES, templateKey } from "@/lib/config";
import { DEFAULT_COLORS, UUID_RE, rgbToHex } from "@/lib/admin/merchant";
import { isWalletAsset } from "@/lib/admin/png";
import { health, merchantOverview } from "@/lib/admin/stats";
import { AdminHeader, DailyCharts, HealthBadge, KpiTiles, ago, nf } from "../../ui";
import MerchantEditor from "./MerchantEditor";
import StaffList from "./StaffList";
import AssetUploader from "./AssetUploader";
import s from "../../admin.module.css";

export const runtime = "nodejs";

// Uploaded Wallet art → short-lived signed URLs (the bucket is private) for the
// thumbnails and the live card preview.
async function walletArt(merchantId: string): Promise<Record<string, string>> {
  const bucket = db.storage.from("pass-assets");
  const { data: files } = await bucket.list(`merchants/${merchantId}`);
  const names = (files ?? []).map((f) => f.name).filter(isWalletAsset);
  if (!names.length) return {};
  const { data } = await bucket.createSignedUrls(names.map((n) => `merchants/${merchantId}/${n}`), 600);
  const out: Record<string, string> = {};
  data?.forEach((d, i) => {
    if (d.signedUrl) out[names[i]] = d.signedUrl;
  });
  return out;
}

type MerchantRow = {
  id: string;
  name: string;
  slug: string | null;
  earn_rate: number;
  redeem_template: string | null;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
  assets_updated_at: string | null;
  created_at: string | null;
};

export default async function AdminMerchantPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [{ data: m }, { data: staff }, stats, art] = await Promise.all([
    db
      .from("merchants")
      .select("id, name, slug, earn_rate, redeem_template, bg_color, fg_color, label_color, assets_updated_at, created_at")
      .eq("id", id)
      .maybeSingle<MerchantRow>(),
    db
      .from("staff")
      .select("id, username, role, created_at")
      .eq("merchant_id", id)
      .order("role", { ascending: false })
      .order("created_at"),
    merchantOverview(id),
    walletArt(id),
  ]);
  if (!m) notFound();

  const template = templateKey(m.redeem_template);
  const enrollUrl = m.slug ? `${PUBLIC_BASE_URL}/enroll/${m.slug}` : null;

  return (
    <div className="dash">
      <AdminHeader />
      <Link href="/admin" className={s.back}>← All merchants</Link>
      <div className={s.head}>
        <div style={{ minWidth: 0 }}>
          <div className={s.chips}>
            <h1 className={s.title}>{m.name}</h1>
            <HealthBadge health={health(m.created_at, stats.kpis.cards, stats.last)} />
          </div>
          <div className={s.sub}>
            {enrollUrl ? <a href={enrollUrl} target="_blank" rel="noreferrer">{enrollUrl}</a> : "No enroll link (no slug)"}
            <br />
            {REDEEM_TEMPLATES[template].label} template · {nf(Number(m.earn_rate))} pts per $1 · last activity{" "}
            {ago(stats.lastActivity)} · created {m.created_at ? new Date(m.created_at).toLocaleDateString("en-GB") : "—"}
          </div>
        </div>
      </div>

      <KpiTiles k={stats.kpis} lead={{ k: "Last activity", v: ago(stats.lastActivity), sub: "txn or new card" }} />
      <DailyCharts daily={stats.daily} />

      <div className="dash-grid">
        <div className="panel col-12">
          <div className="panel-h"><span className="panel-t">Settings &amp; brand</span></div>
          <MerchantEditor
            id={m.id}
            initial={{
              name: m.name,
              earnRate: String(Number(m.earn_rate)),
              template,
              colors: {
                bg: rgbToHex(m.bg_color, rgbToHex(DEFAULT_COLORS.bgColor, "#ffffff")),
                fg: rgbToHex(m.fg_color, rgbToHex(DEFAULT_COLORS.fgColor, "#141414")),
                label: rgbToHex(m.label_color, rgbToHex(DEFAULT_COLORS.labelColor, "#787878")),
              },
            }}
            logo={art["logo@2x.png"] ?? art["logo.png"]}
            strip={art["strip@2x.png"] ?? art["strip.png"] ?? art["strip@3x.png"]}
          />
        </div>
        <div className="panel col-4">
          <div className="panel-h">
            <span className="panel-t">Staff</span>
            <span className="label" style={{ margin: 0 }}>{staff?.length ?? 0}</span>
          </div>
          <StaffList staff={staff ?? []} />
        </div>
        <div className="panel col-8">
          <div className="panel-h">
            <span className="panel-t">Wallet art</span>
            <span className="label" style={{ margin: 0 }}>
              {m.assets_updated_at ? `updated ${ago(m.assets_updated_at)}` : "default art"}
            </span>
          </div>
          <AssetUploader merchantId={m.id} art={art} />
        </div>
      </div>
    </div>
  );
}
