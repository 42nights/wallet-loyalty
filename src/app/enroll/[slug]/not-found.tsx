import s from "./EnrollForm.module.css";

// An unknown or retired /enroll/<slug> — a typo, or a QR from a shop that has
// moved on. page.tsx calls notFound(), so the response is still a 404; this
// replaces the bare framework page with a next step (F14).
export default function EnrollNotFound() {
  return (
    <div className="wrap">
      <div className="card stack">
        <div className={s.title}>This sign-up link isn&apos;t active</div>
        <p className={s.lead}>Ask the shop for their current QR code.</p>
      </div>
    </div>
  );
}
