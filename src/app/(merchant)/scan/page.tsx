"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REDEMPTIONS, EARN_PRESETS } from "@/lib/config";

type Customer = { serial: string; name: string | null; points: number };

export default function ScanPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; msg: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const [manual, setManual] = useState("");
  const [custom, setCustom] = useState("");
  const scannerRef = useRef<any>(null);
  const scanningRef = useRef(false);

  // start camera scanner when no customer is loaded
  useEffect(() => {
    if (customer) return;
    let cancelled = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      const el = document.getElementById("reader");
      if (!el) return;
      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;
      scanningRef.current = true;
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decoded: string) => lookup(decoded),
          () => {}
        );
      } catch {
        /* no camera (e.g. desktop dev) — use manual entry below */
      }
    })();
    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  async function stopScanner() {
    if (scannerRef.current && scanningRef.current) {
      scanningRef.current = false;
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
  }

  async function lookup(serial: string) {
    await stopScanner();
    const res = await fetch("/api/merchant/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial }),
    });
    if (res.status === 401) return router.push("/login");
    if (!res.ok) {
      setToast({ kind: "bad", msg: "Card not found" });
      setCustomer(null);
      return;
    }
    setCustomer(await res.json());
    setToast(null);
  }

  async function apply(body: object, okMsg: string) {
    if (!customer) return;
    const res = await fetch("/api/merchant/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial: customer.serial, ...body }),
    });
    if (res.status === 401) return router.push("/login");
    const data = await res.json();
    if (!res.ok) {
      setToast({ kind: "bad", msg: data.error || "Failed" });
      return;
    }
    setCustomer({ ...customer, points: data.newBalance });
    setFlash(true);
    setTimeout(() => setFlash(false), 400);
    setToast({ kind: "ok", msg: okMsg });
  }

  function reset() {
    setCustomer(null);
    setToast(null);
    setCustom("");
  }

  // ---- scan view ----
  if (!customer) {
    return (
      <div className="wrap">
        <div className="brand"><span className="dot" /> 42nights <small>scan</small></div>
        <div className="card stack">
          <div className="label">Scan the customer's Wallet QR</div>
          <div id="reader" />
          {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
          <div className="label" style={{ marginTop: 8 }}>or enter serial manually</div>
          <div className="row">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="serial…" />
            <button className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }}
              onClick={() => manual && lookup(manual.trim())}>Go</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- customer / actions view ----
  return (
    <div className="wrap">
      <div className="brand"><span className="dot" /> 42nights <small>terminal</small></div>
      <div className="card stack">
        <div>
          <div className="label">{customer.name || "Customer"}</div>
          <div className={`balance ${flash ? "flash" : ""}`}>{customer.points}</div>
          <div className="label" style={{ marginTop: 4 }}>points</div>
        </div>

        {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

        <div className="label" style={{ marginTop: 6 }}>Redeem</div>
        <div className="grid2">
          {REDEMPTIONS.map((a) => (
            <button key={a.id} className="redeem-btn"
              onClick={() => apply({ actionId: a.id }, `${a.label} redeemed`)}>
              <div className="rl">{a.label}</div>
              <div className="rp">{a.points} pts</div>
            </button>
          ))}
        </div>

        <div className="label" style={{ marginTop: 6 }}>Earn</div>
        <div className="grid2">
          {EARN_PRESETS.map((a) => (
            <button key={a.id} className="redeem-btn earn"
              onClick={() => apply({ actionId: a.id }, `+${a.points} pts`)}>
              <div className="rl">{a.label}</div>
              <div className="rp">+{a.points} pts</div>
            </button>
          ))}
          <div className="row">
            <input value={custom} onChange={(e) => setCustom(e.target.value)}
              inputMode="numeric" placeholder="custom +" />
            <button className="btn btn-ghost" style={{ width: "auto", padding: "0 16px" }}
              onClick={() => custom && apply({ customPoints: Math.abs(parseInt(custom, 10)) }, `+${Math.abs(parseInt(custom, 10))} pts`)}>
              Add
            </button>
          </div>
        </div>

        <button className="btn btn-primary" onClick={reset}>Scan next customer</button>
      </div>
    </div>
  );
}
