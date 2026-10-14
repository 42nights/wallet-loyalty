"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isSupportUsername } from "@/lib/admin/merchant";
import s from "../../admin.module.css";

type Member = { id: string; username: string; role: string; created_at: string | null };

export default function StaffList({ staff }: { staff: Member[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null);
  const [err, setErr] = useState("");

  async function reset(m: Member) {
    if (!confirm(`Reset the password for ${m.username}? Their current password stops working.`)) return;
    setBusyId(m.id);
    setErr("");
    setShown(null);
    const res = await fetch(`/api/admin/staff/${m.id}/password`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return setErr(data.error || "Could not reset");
    setShown({ username: data.username, password: data.password });
  }

  if (!staff.length) return <div className="label">No staff logins</div>;
  return (
    <div>
      {staff.map((m) => (
        <div className={s.staffRow} key={m.id}>
          <div style={{ minWidth: 0 }}>
            <div className={s.staffName}>{m.username}</div>
            {/* made by "Manage as owner"; it has no password to reset */}
            <div className={s.role}>{isSupportUsername(m.username) ? "42nights support" : m.role}</div>
          </div>
          {!isSupportUsername(m.username) && (
            <button
              type="button"
              className={`btn btn-ghost ${s.smallBtn}`}
              onClick={() => reset(m)}
              disabled={busyId !== null}
            >
              {busyId === m.id ? "…" : "Reset password"}
            </button>
          )}
        </div>
      ))}
      {shown && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="toast ok" style={{ marginTop: 0 }}>New password. Shown once, copy it now.</div>
          <dl className={s.secret}>
            <dt>User</dt>
            <dd>{shown.username}</dd>
            <dt>Password</dt>
            <dd>{shown.password}</dd>
          </dl>
        </div>
      )}
      {err && <div className="toast bad" role="alert">{err}</div>}
    </div>
  );
}
