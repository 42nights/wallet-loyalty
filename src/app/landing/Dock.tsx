"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import s from "../page.module.css";

// Phones: once the hero's buttons have scrolled away, the demo button docks to
// the bottom of the screen, until the closing buttons come into view. Hidden
// from 700px (page.module.css).
export default function Dock() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const [hero, closing] = document.querySelectorAll("main [data-ctas]");
    if (!hero || !closing) return;
    const seen = new Map<Element, IntersectionObserverEntry>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e);
      const h = seen.get(hero);
      setOn(!!h && !h.isIntersecting && h.boundingClientRect.top < 0 && !seen.get(closing)?.isIntersecting);
    });
    io.observe(hero);
    io.observe(closing);
    return () => io.disconnect();
  }, []);
  return (
    <div className={s.dock} data-on={on ? "" : undefined}>
      <Link href="/demo" className="btn btn-primary">
        See the live demo
      </Link>
    </div>
  );
}
