import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PUBLIC_BASE_URL, REDEEM_TEMPLATES, loyaltyMode, stampGoal, stampReward, templateKey, timezoneOf } from "@/lib/config";
import { UUID_RE, rgbToHex, themeHex } from "@/lib/admin/merchant";
import { isWalletAsset } from "@/lib/admin/png";
import { health, merchantOverview } from "@/lib/admin/stats";
import { AdminHeader, DailyCharts, HealthBadge, KpiTiles, ago, day, nf } from "../../ui";
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
  loyalty_mode?: string | null; // stamp card columns: absent on an un-migrated database
  stamp_goal?: number | null;
  stamp_reward?: string | null;
  timezone?: string | null; // later column: select("*") below tolerates its absence
};

export default async function AdminMerchantPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [{ data: m }, { data: staff }, stats, art, { count: txns }] = await Promise.all([
    // "*" so the later columns (stamp card, timezone) come along when the database has them
    db.from("merchants").select("*").eq("id", id).maybeSingle<MerchantRow>(),
    db
      .from("staff")
      .select("id, username, role, created_at")
      .eq("merchant_id", id)
      .order("role", { ascending: false })
      .order("created_at"),
    merchantOverview(id),
    walletArt(id),
    // from the first transaction on, points vs stamps and the goal are fixed
    db.from("transactions").select("id", { count: "exact", head: true }).eq("merchant_id", id),
  ]);
  if (!m) notFound();

  const template = templateKey(m.redeem_template);
  const loyalty = { mode: loyaltyMode(m.loyalty_mode), goal: String(stampGoal(m.stamp_goal)), reward: stampReward(m.stamp_reward) };
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
            {loyalty.mode === "stamps"
              ? `Stamp card · ${loyalty.goal} stamps for ${loyalty.reward} · ${REDEEM_TEMPLATES[template].label} style`
              : `${REDEEM_TEMPLATES[template].label} template · ${nf(Number(m.earn_rate))} pts per $1`}{" "}
            · last activity{" "}
            {ago(stats.lastActivity)} · created {m.created_at ? day(m.created_at) : "—"}
          </div>
        </div>
        {enrollUrl && (
          <Link
            href={`/settings/poster?merchant=${m.id}`}
            className="btn btn-ghost"
            style={{ width: "auto", padding: "12px 18px", fontSize: 15, textDecoration: "none" }}
          >
            Print sign-up poster
          </Link>
        )}
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
              timezone: timezoneOf(m.timezone),
              template,
              colors: {
                bg: rgbToHex(m.bg_color, themeHex(template).bg),
                fg: rgbToHex(m.fg_color, themeHex(template).fg),
                label: rgbToHex(m.label_color, themeHex(template).label),
              },
              loyalty,
            }}
            txns={txns ?? 0}
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
