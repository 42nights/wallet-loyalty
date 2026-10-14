"use client";
import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { WALLET_ASSETS, type WalletAsset } from "@/lib/admin/png";
import s from "../../admin.module.css";

const NAMES = Object.keys(WALLET_ASSETS) as WalletAsset[];

type TileMsg = { ok: boolean; text: string };

// One slot per file buildApplePass() reads. Picking a file uploads it right
// away; the server checks it's a PNG of Apple's size before storing it. Each
// tile reports on itself: the picked file's name, then "uploaded" or the
// server's reason for refusing it.
export default function AssetUploader({ merchantId, art }: { merchantId: string; art: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<WalletAsset | null>(null);
  const [msgs, setMsgs] = useState<Partial<Record<WalletAsset, TileMsg>>>({});
  const say = (name: WalletAsset, msg: TileMsg) => setMsgs((m) => ({ ...m, [name]: msg }));

  async function upload(name: WalletAsset, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(name);
    say(name, { ok: true, text: `Uploading ${file.name}…` });
    const form = new FormData();
    form.set("name", name);
    form.set("file", file);
    const res = await fetch(`/api/admin/merchants/${merchantId}/assets`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return say(name, { ok: false, text: `${file.name}: ${data.error || "upload failed"}` });
    say(name, { ok: true, text: `${file.name} uploaded` });
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="label" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
        PNG only. Icon and strip must match the size exactly; the logo must fit inside its box. Missing files fall
        back to the default art. Max 2 MB each. New cards get new art right away; cards already in Wallets on
        their next refresh.
      </div>
      <div className={s.artGrid}>
        {NAMES.map((name) => {
          const spec = WALLET_ASSETS[name];
          const msg = msgs[name];
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
              {/* The native input is visually hidden inside a styled label, so
                  the label is the button and the input keeps focus + a11y. */}
              <label className={`btn btn-ghost ${s.upload}`}>
                {busy === name ? "Uploading…" : "Upload"}
                <input
                  type="file"
                  accept="image/png"
                  aria-label={`Upload ${name}`}
                  disabled={busy !== null}
                  onChange={(e) => upload(name, e)}
                />
              </label>
              {msg && (
                <span className={`${s.hint} ${msg.ok ? "" : s.bad}`} role={msg.ok ? "status" : "alert"}>
                  {msg.text}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
