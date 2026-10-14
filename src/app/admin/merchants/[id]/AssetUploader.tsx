"use client";
import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { WALLET_ASSETS, type WalletAsset } from "@/lib/admin/png";
import s from "../../admin.module.css";

const NAMES = Object.keys(WALLET_ASSETS) as WalletAsset[];

// One slot per file buildApplePass() reads. Picking a file uploads it right
// away; the server checks it's a PNG of Apple's size before storing it.
export default function AssetUploader({ merchantId, art }: { merchantId: string; art: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<WalletAsset | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(name: WalletAsset, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(name);
    setMsg(null);
    const form = new FormData();
    form.set("name", name);
    form.set("file", file);
    const res = await fetch(`/api/admin/merchants/${merchantId}/assets`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return setMsg({ ok: false, text: data.error || "Upload failed" });
    setMsg({ ok: true, text: `${name} uploaded. New cards get it now; existing cards on their next refresh.` });
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="label" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
        PNG only. Icon and strip must match the size exactly; the logo must fit inside its box. Missing files fall back to the default art. Max 2 MB each.
      </div>
      <div className={s.artGrid}>
        {NAMES.map((name) => {
          const spec = WALLET_ASSETS[name];
          return (
            <div className={s.artSlot} key={name}>
              <div className={s.artHead}>
                <b>{name}</b>
                <span className={art[name] ? s.ok : ""}>{art[name] ? "✓" : ""}</span>
              </div>
              <div className={s.hint}>{spec.max ? "max " : ""}{spec.w}×{spec.h}px</div>
              <div className={s.artThumb}>
                {art[name] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                  <img src={art[name]} alt={name} />
                ) : (
                  <span>default</span>
                )}
              </div>
              <input
                type="file"
                accept="image/png"
                aria-label={`Upload ${name}`}
                disabled={busy !== null}
                onChange={(e) => upload(name, e)}
              />
              {busy === name && <span className={s.hint}>Uploading…</span>}
            </div>
          );
        })}
      </div>
      {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
    </div>
  );
}
