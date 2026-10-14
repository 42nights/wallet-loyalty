"use client";
import { useState } from "react";

export default function ResendCard({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: "Your loyalty card", url: link }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(link).then(() => setCopied(true), () => {});
  }

  return (
    <div className="card stack">
      <div className="label">Lost card? Send it to the customer&apos;s iPhone</div>
      <button className="btn btn-ghost" onClick={share}>
        Share card link
      </button>
      {copied && <div className="toast ok">Link copied</div>}
      <div className="label" style={{ fontSize: 11 }}>
        AirDrop or text it to the customer. It opens in Safari on iPhone and expires in 1 hour.
      </div>
    </div>
  );
}
