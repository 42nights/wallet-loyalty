"use client";
import { useEffect } from "react";

// Fades each [data-reveal] element up the first time it scrolls into view.
// The server HTML is fully visible: only elements still below the fold when
// this runs get hidden, so nothing flashes, and the page reads the same
// without JS or with reduced motion. Elements that enter together (a row of
// cards) get a short stagger, capped so a long list never drags.
//
// The hero's add-to-Wallet animation is pure CSS and starts at first paint.
// On narrow screens the CSS delays it by 1.44s as a no-JS fallback. Here,
// anything still inside its delay is paused, which is invisible because it
// already shows its first frame. Once the top of the phone is on screen, the
// rest of the delay is skipped. Nothing that has started is ever paused or
// rewound, so a late script leaves a playing or finished hero alone.
export default function Reveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const art = document.querySelector<HTMLElement>("[data-hero-art]");
    const hero = art ? art.getAnimations({ subtree: true }).filter((a) => a.timeline === document.timeline) : [];
    const delay = (a: Animation) => Number(a.effect?.getTiming().delay ?? 0);
    const first = Math.min(...hero.map(delay));
    // Only phones get the long CSS wait (the no-JS fallback), so only they need holding.
    const waiting = matchMedia("(max-width: 860px)").matches ? hero.filter((a) => Number(a.currentTime) < delay(a)) : [];
    for (const a of waiting) a.pause();
    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (el === art) {
            if (e.intersectionRatio < 0.15) continue;
            for (const a of waiting) {
              a.currentTime = Math.max(Number(a.currentTime), first);
              a.play();
            }
          } else {
            if (!e.isIntersecting) continue;
            el.style.transitionDelay = `${Math.min(i++, 5) * 60}ms`;
            el.dataset.reveal = "in";
          }
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: [0, 0.15] },
    );
    if (art && waiting.length) io.observe(art);
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (el.getBoundingClientRect().top < innerHeight) continue;
      el.dataset.reveal = "out";
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return null;
}
