"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { REDEMPTIONS } from "@/lib/config";

type Customer = { serial: string; name: string | null; points: number };

export default function ScanPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; msg: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const [manual, setManual] = useState("");
  const [bill, setBill] = useState("");
  const [earnRate, setEarnRate] = useState(1);
  const [role, setRole] = useState<string>("cashier");
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<any>(null);
  const scanningRef = useRef(false);

  // load this merchant's earn rate (for the bill → points preview)
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/merchant/me");
      if (res.status === 401) return router.push("/login");
      if (res.ok) {
        const me = await res.json();
        if (typeof me.earnRate === "number") setEarnRate(me.earnRate);
        if (me.role) setRole(me.role);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!customer || busy) return; // busy guard: no double-tap
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // one key per tap → a retry of THIS request can't double-apply
          "Idempotency-Key": crypto.randomUUID(),
        },
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
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCustomer(null);
    setToast(null);
    setBill("");
  }

  // ---- scan view ----
  if (!customer) {
    return (
      <div className="wrap">
        <div className="brand"><span className="dot" /> 42nights <small>scan</small></div>
        {role === "owner" && (
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <Link className="btn btn-ghost" href="/dashboard">Dashboard</Link>
            <Link className="btn btn-ghost" href="/staff">Staff</Link>
          </div>
        )}
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
            <button key={a.id} className="redeem-btn" disabled={busy}
              onClick={() => apply({ actionId: a.id }, `${a.label} redeemed`)}>
              <div className="rl">{a.label}</div>
              <div className="rp">{a.points} pts</div>
            </button>
          ))}
        </div>

        <div className="label" style={{ marginTop: 6 }}>Earn — enter the bill amount</div>
        <div className="row">
          <input value={bill} onChange={(e) => setBill(e.target.value)}
            inputMode="decimal" placeholder="bill amount" />
          <button className="btn btn-ghost" style={{ width: "auto", padding: "0 16px" }} disabled={busy}
            onClick={() => {
              const amt = parseFloat(bill);
              if (amt > 0) apply({ amount: amt }, `+${Math.round(earnRate * amt)} pts`);
            }}>
            Add
          </button>
        </div>
        {parseFloat(bill) > 0 && (
          <div className="label">
            = {Math.round(earnRate * parseFloat(bill))} pts ({earnRate}× rate)
          </div>
        )}

        <button className="btn btn-primary" onClick={reset}>Scan next customer</button>
      </div>
    </div>
  );
}
