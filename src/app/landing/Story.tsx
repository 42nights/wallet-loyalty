"use client";
import { useEffect, useRef, useState } from "react";
import s from "./landing.module.css";

// Drives the landing page's phones. Text never moves; only phones (and the
// paper card they replace) do.
//
// Desktop (>= 1024px): one phone travels down the page. It is assembled from
// the screens the server already rendered in every section's own phone (so no
// screen code ships to the browser), sits in a fixed layer, and rests in each
// section's phone lane while that section is read. Between two sections it
// never crosses copy: it shrinks onto the gap between them, slides along the
// divider to the other side, and grows into the next lane. All of it is a
// function of scroll position, so stopping anywhere leaves it somewhere clear.
// Elements with data-beats are chapters; their beats are the screens it shows.
// They only start once the phone has landed in their lane, full size beside
// the copy, and a beat that has started always plays until it has landed
// (sync() below).
// The hero and closing phones are part of the page, so at either end the real
// one shows and the traveller hides, swapping where both are identical.
//
// Smaller screens: no travel (it would cover the copy). Each section's phone
// wakes and plays that section's beats on timers while it is in view, pausing
// when it leaves and resuming where it was when it returns.
//
// Reduced motion: nothing runs; every phone shows its resting screen.

// beat -> [screen, step]
const BEAT: Record<string, [string, number?]> = {
  lock: ["lock"], scan: ["scan"], join: ["join"], add: ["add"], wallet: ["wallet"], counter: ["counter"], notify: ["notify"],
  points: ["rewards", 0], stamps: ["rewards", 1], stamp: ["rewards", 2],
  dash: ["owner", 0], risk: ["owner", 1], why: ["why"], ready: ["ready"],
};
// When a beat's moment has landed, in ms after it shows (its CSS timeline in
// landing.module.css). Scrolling ahead waits for it before the next beat
// shows, so no scene is cut off mid-play; a reader who stops gets the next beat
// of the chapter READ ms after that. Smaller screens play on the same clock.
const LAND: Record<string, number> = {
  scan: 1300, join: 1750, add: 1300, wallet: 950, counter: 1950, notify: 1250,
  points: 700, stamps: 700, stamp: 950, dash: 1600, risk: 1400, ready: 2200,
};
const READ = 500;
const hold = (beat: string) => (LAND[beat] ?? 0) + READ;
// A beat that starts while the reader is already past it plays this much
// faster, so the phone catches up without cutting anything.
const CATCH_UP = 2;
// Scroll-scrubbed travel moves at scroll speed times a constant in the middle
// and eases in and out over the first and last 30%, so it travels rather than
// whips, and every phase meets the next at the same velocity.
const R = 0.3;
const ease = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < R ? (t * t) / (2 * R * (1 - R)) : t > 1 - R ? 1 - (1 - t) ** 2 / (2 * R * (1 - R)) : (t - R / 2) / (1 - R);
// Clear space kept between the phone and any copy, in px.
const M = 16;
const TEXT = "h1,h2,h3,p,li,dt,dd,summary,th,td,a,figure,table";

// Shows a beat on every stack that has its screen.
function show(stacks: HTMLElement[], beat: string) {
  const [id, step] = BEAT[beat];
  for (const stack of stacks) {
    const scr = [...stack.children].find((c) => (c as HTMLElement).dataset.scr === id) as HTMLElement | undefined;
    if (!scr) continue;
    for (const c of stack.children) if (c !== scr) delete (c as HTMLElement).dataset.on;
    scr.dataset.on = "";
    if (step === undefined) delete scr.dataset.step;
    else scr.dataset.step = String(step);
  }
}

// Plays beats in order on timers from `from`, reporting each; returns the cancel.
function play(stacks: HTMLElement[], beats: string[], from: number, seen: (i: number) => void) {
  let timer = 0;
  const run = (i: number) => {
    show(stacks, beats[i]);
    seen(i);
    if (i < beats.length - 1) timer = window.setTimeout(() => run(i + 1), hold(beats[i]));
  };
  run(from);
  return () => clearTimeout(timer);
}

const beatsIn = (el: Element) => (el as HTMLElement).dataset.beats?.split(" ") ?? [];

type Pose = [number, number, number]; // centre x, centre y (viewport px), scale
// A move from slot k to k+1. Cross-page moves shrink (d0..x0) onto the gap at
// page y `yw` at scale `sw`, slide across it (x0..x1) and grow into the next
// lane (x1..u1). `direct` moves stay on their side and go straight there.
type Flight = { d0: number; x0: number; x1: number; u1: number; yw: number; sw: number; direct?: boolean };

function travel(rig: HTMLDivElement) {
  const slotEls = [...document.querySelectorAll<HTMLElement>("main [data-slot]")];
  const sections = slotEls.map((el) => el.closest("section")!);
  const ends = [slotEls[0], slotEls[slotEls.length - 1]];
  const mirrors = ends.map((el) => el.querySelector<HTMLElement>("[data-stack]")!);

  // The traveller: the hero phone's shell holding a copy of every screen.
  const phone = ends[0].cloneNode(true) as HTMLElement;
  delete phone.dataset.slot;
  delete phone.dataset.intro;
  const stack = phone.querySelector<HTMLElement>("[data-stack]")!;
  stack.replaceChildren(...[...document.querySelectorAll("main [data-slot] [data-scr]")].map((n) => n.cloneNode(true)));
  stack.dataset.live = "";
  rig.append(phone);
  // The Why lane's paper card rides behind it. When the phone lands beside the
  // comparison it slides out from under it and falls away (landing.module.css);
  // it only shows while the phone rests there.
  const paperSrc = document.querySelector(`main [data-lane] .${s.paper}`);
  const paper = paperSrc?.cloneNode(true) as HTMLElement | undefined;
  const kw = paperSrc ? sections.indexOf(paperSrc.closest("section")!) : -1;
  if (paper) {
    paper.className = `${s.paper} ${s.rigPaper}`;
    rig.append(paper);
  }
  for (const m of mirrors) m.dataset.live = "";
  document.documentElement.dataset.travel = "";

  type Slot = { pin: boolean; cx: number; cy: number; s: number };
  let slots: Slot[] = [];
  let flights: Flight[] = [];
  let marks: { at: number; beat: string; c: number; k: number }[] = [];
  let vh = 0;
  let base = 1;
  let raf = 0;
  let cur = NaN;
  let want = NaN;
  let rest = NaN;
  let since = 0;
  let pace = 1;
  let timer = 0;
  let away: boolean | undefined;
  let lastTf = "";
  let lastX = NaN;
  let lastT = 0;
  let vel = 0;

  function measure() {
    const y = scrollY;
    vh = innerHeight;
    base = Math.min(1, (vh - 48) / 620);
    const max = document.documentElement.scrollHeight - vh;
    // Where a move happens follows the viewport; how long it takes does too,
    // up to 900px tall, so tall screens do not run one move into the next.
    const v = Math.min(vh, 900);
    slots = slotEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { pin: el.dataset.slot === "pin", cx: r.left + r.width / 2, cy: r.top + y + r.height / 2, s: r.width / 300 };
    });
    // Each section's copy, top and bottom, in page px.
    const text = sections.map((sec) => {
      let top = Infinity;
      let bot = -Infinity;
      for (const e of sec.querySelectorAll(TEXT)) {
        const r = e.getBoundingClientRect();
        if (!r.height || e.closest("[aria-hidden=true]")) continue;
        top = Math.min(top, r.top + y);
        bot = Math.max(bot, r.bottom + y);
      }
      return [top, bot];
    });
    flights = slots.slice(1).map((b, i) => {
      const a = slots[i];
      const T = text[i][1];
      const B = text[i + 1][0];
      const rule = sections[i + 1].getBoundingClientRect().top + y;
      if (!b.pin) {
        // Into the closing phone: drop beside the questions, then slide in
        // under them, growing, and land with the phone mid-screen.
        const x1 = Math.min(b.cy - vh / 2, max - 2);
        const x0 = x1 - 0.4 * v;
        return { d0: x0 - 0.25 * v, x0, x1, u1: x1, yw: b.cy, sw: a.s * base };
      }
      if (Math.abs(b.cx - a.cx) < 200) {
        // Same side (Why -> FAQ): shrink into the margin as the heading
        // arrives. The questions stop short of the lane (page.module.css), so
        // it can hold beside the comparison until then.
        return { d0: B - 0.4 * vh - 0.4 * v, x0: 0, x1: 0, u1: B - 0.4 * vh, yw: 0, sw: 0, direct: true };
      }
      // Across the page, along the divider between the two sections, sized to
      // fit the gap between their copy. It starts as the divider rises into
      // view and has landed by the time the new heading reaches the upper
      // third. The slide is long enough that the phone never moves sideways
      // faster than about 2.3x the scroll. Leaving the hero, which scrolls
      // with the page, it dives from the first pixel of scroll.
      const sw = Math.min(0.42, (B - T - 2 * M) / 620);
      const yw = Math.min(Math.max(rule, T + M + 310 * sw), B - M - 310 * sw);
      const x0 = Math.max(yw - 0.72 * vh, 0.2 * v);
      const x1 = x0 + Math.max(0.5 * v, 0.62 * Math.abs(b.cx - a.cx));
      return { d0: a.pin ? Math.max(0, x0 - 0.18 * v) : 0, x0, x1, u1: x1 + 0.22 * v, yw, sw };
    });
    // A nav link scrolls a section's top to its scroll margin. Land by then,
    // or the jump stops a few px short of landing and the lane never starts.
    flights.forEach((f, i) => {
      const sec = sections[i + 1];
      if (!sec.id) return;
      const by = Math.max(0, f.u1 - (sec.getBoundingClientRect().top + y - parseFloat(getComputedStyle(sec).scrollMarginTop) - 1));
      for (const key of ["d0", "x0", "x1", "u1"] as const) if (f[key]) f[key] = Math.max(0, f[key] - by);
    });
    // Chapters start when their element reaches 55% of the viewport, and never
    // before the phone has landed in their lane: in flight it keeps the last
    // screen it had. A chapter's beats share the scroll until the next chapter
    // or until the phone leaves.
    const focus = 0.55 * vh;
    const chapters = [...document.querySelectorAll<HTMLElement>("main [data-beats]")].map((el) => {
      const k = sections.indexOf(el.closest("section")!);
      const top = el.getBoundingClientRect().top + y - focus;
      return { k, start: Math.min(Math.max(top, flights[k - 1]?.u1 ?? -Infinity), max), beats: beatsIn(el) };
    });
    marks = chapters.flatMap((c, i) => {
      const next = chapters[i + 1];
      const end = Math.min(next?.k === c.k ? next.start : Infinity, flights[c.k]?.d0 ?? Infinity);
      return c.beats.map((b, j) => ({ at: c.start + (j && (j * (end - c.start)) / c.beats.length), beat: b, c: i, k: c.k }));
    });
    lastX = NaN;
    // the bottom of the screen, in the pinned phone's px
    paper?.style.setProperty("--floor", `${(vh / 2 + 310 * base) / base + 40}px`);
  }

  // Brings the shown mark (`cur`, "lock" before the first) to the one scrolled
  // to (`want`). In flight the phone keeps the screen it has, so nothing
  // starts while it is small. Landing in the next lane starts at that lane's
  // first beat. A chapter is a story (scan, sign up, add, into Wallet), so its
  // beats play in order, each until it has landed, and a lane's chapters play
  // in order too: a reader who is ahead sees them faster, never skipped. A
  // reader who stops sees the rest of the chapter play on its own; one who
  // scrolls back gets the beat they scrolled back to.
  function sync() {
    clearTimeout(timer);
    if (rest < 0 && !Number.isNaN(cur)) return;
    const lane = (i: number) => (i < 0 ? 0 : marks[i].k);
    const ch = (i: number) => (i < 0 ? -1 : marks[i]?.c);
    const entry = (i: number) => marks.findIndex((m) => m.k === lane(i));
    if (Number.isNaN(cur) ? rest >= 0 : lane(want) > lane(cur)) cue(entry(want));
    else if (Number.isNaN(cur) || lane(want) < lane(cur) || ch(want) < ch(cur)) cue(want);
    const more = ch(cur + 1) === ch(cur);
    if (cur < 0 || rest !== lane(cur) || (want <= cur && !more)) return;
    const beat = marks[cur].beat;
    const wait = since + (want > cur ? (LAND[beat] ?? 0) / pace : hold(beat)) - performance.now();
    if (wait > 0) timer = window.setTimeout(sync, wait);
    else {
      cue(cur + 1);
      sync();
    }
  }
  function cue(i: number) {
    cur = i;
    since = performance.now();
    pace = want > i ? CATCH_UP : 1;
    show([stack, ...mirrors], i < 0 ? "lock" : marks[i].beat);
    if (pace > 1) for (const st of [stack, ...mirrors]) for (const a of st.querySelector("[data-on]")?.getAnimations({ subtree: true }) ?? []) a.playbackRate = pace;
    paper?.toggleAttribute("data-go", marks[i]?.beat === "why");
  }

  const at = (i: number, y: number): Pose => {
    const sl = slots[i];
    return sl.pin ? [sl.cx, vh / 2, sl.s * base] : [sl.cx, sl.cy - y, sl.s];
  };
  const mix = (p: Pose, q: Pose, e: number): Pose => [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e, p[2] + (q[2] - p[2]) * e];
  const prog = (y: number, a: number, b: number) => ease((y - a) / (b - a));

  // Where the phone is at scroll y, and the slot it rests in (-1 in flight).
  function pose(y: number): [Pose, number] {
    const k = flights.findIndex((f) => y < f.u1);
    if (k < 0) return [at(slots.length - 1, y), slots.length - 1];
    const f = flights[k];
    if (y <= f.d0) return [at(k, y), k];
    if (f.direct) return [mix(at(k, y), at(k + 1, y), prog(y, f.d0, f.u1)), -1];
    const a = slots[k];
    const b = slots[k + 1];
    const gap = (x: number, sc: number): Pose => [x, f.yw - y, sc];
    if (y < f.x0) return [mix(at(k, y), gap(a.cx, f.sw), prog(y, f.d0, f.x0)), -1];
    if (y < f.x1) {
      const e = prog(y, f.x0, f.x1);
      return [gap(a.cx + (b.cx - a.cx) * e, b.pin ? f.sw : f.sw + (b.s - f.sw) * e), -1];
    }
    return [mix(gap(b.cx, f.sw), at(k + 1, y), prog(y, f.x1, f.u1)), -1];
  }

  function frame(now = performance.now()) {
    raf = 0;
    const y = scrollY;
    const [p, restAt] = pose(y);
    const isAway = restAt < 0 || slots[restAt].pin;
    if (isAway !== away) {
      away = isAway;
      rig.style.visibility = away ? "visible" : "hidden";
      for (const el of ends) el.style.visibility = away ? "hidden" : "";
    }
    // Banks into a slide by how fast it is actually moving sideways, so it
    // rights itself as soon as scrolling stops.
    const dt = Math.min(50, now - lastT) || 16;
    const vx = Number.isNaN(lastX) ? 0 : (p[0] - lastX) / dt;
    lastX = p[0];
    lastT = now;
    vel += (vx - vel) * (1 - Math.exp(-dt / 90));
    if (Math.abs(vel) < 0.003) vel = 0;
    else raf = requestAnimationFrame(frame);
    const rot = Math.max(-6, Math.min(6, vel * 3));
    const tf = `translate3d(${(p[0] - 150).toFixed(1)}px,${(p[1] - 310).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${p[2].toFixed(4)})`;
    if (tf !== lastTf) rig.style.transform = lastTf = tf;

    let i = -1;
    while (i + 1 < marks.length && marks[i + 1].at <= y) i++;
    if (i !== want || restAt !== rest) {
      want = i;
      rest = restAt;
      if (paper) paper.style.visibility = rest === kw ? "" : "hidden";
      sync();
    }
  }

  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const onResize = () => {
    measure();
    onScroll();
  };
  measure();
  frame();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(document.querySelector("main")!);
  document.fonts?.ready.then(() => rig.firstChild === phone && onResize());

  return () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
    ro.disconnect();
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    rig.replaceChildren();
    rig.removeAttribute("style");
    delete document.documentElement.dataset.travel;
    for (const el of ends) el.style.visibility = "";
    for (const m of mirrors) {
      delete m.dataset.live;
      for (const c of m.children) delete (c as HTMLElement).dataset.on;
    }
  };
}

// The hero's add-to-Wallet animation is CSS and starts at first paint. Below
// 861px the CSS delays it 1.44s as a no-JS fallback; here anything still in
// that delay is paused, and the rest of the delay is skipped once the phone is
// on screen. Nothing that has started is paused or rewound.
function heroWhenSeen() {
  const art = document.querySelector<HTMLElement>("[data-hero-art]");
  if (!art || !matchMedia("(max-width: 860px)").matches) return () => {};
  const hero = art.getAnimations({ subtree: true }).filter((a) => a.timeline === document.timeline);
  const delay = (a: Animation) => Number(a.effect?.getTiming().delay ?? 0);
  const waiting = hero.filter((a) => Number(a.currentTime) < delay(a));
  if (!waiting.length) return () => {};
  const start = Math.min(...hero.map(delay));
  for (const a of waiting) a.pause();
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.intersectionRatio < 0.15) return;
      for (const a of waiting) {
        a.currentTime = Math.max(Number(a.currentTime), start);
        a.play();
      }
      io.disconnect();
    },
    { threshold: [0, 0.15] },
  );
  io.observe(art);
  return () => io.disconnect();
}

function inline() {
  const stops = new Map<Element, () => void>();
  const at = new Map<Element, number>();
  const lanes = [...document.querySelectorAll<HTMLElement>("main [data-lane]")];
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const lane = e.target as HTMLElement;
        stops.get(lane)?.();
        stops.delete(lane);
        if (!e.isIntersecting) continue;
        const section = lane.closest("section")!;
        // Stacked, the owners' own sample dashboard sits right above this
        // phone, so it opens on the at-risk beat instead of repeating it.
        const beats = [section, ...section.querySelectorAll("[data-beats]")].flatMap(beatsIn).filter((b) => b !== "dash");
        lane.dataset.play = "";
        stops.set(lane, play([lane.querySelector<HTMLElement>("[data-stack]")!], beats, at.get(lane) ?? 0, (i) => at.set(lane, i)));
      }
    },
    { threshold: 0.5 },
  );
  // Screens stay dark until their phone is seen, then wake on the first beat.
  for (const lane of lanes) {
    lane.querySelector<HTMLElement>("[data-stack]")!.dataset.live = "";
    io.observe(lane);
  }
  const unhero = heroWhenSeen();
  return () => {
    io.disconnect();
    for (const f of stops.values()) f();
    unhero();
    for (const lane of lanes) {
      delete lane.dataset.play;
      const st = lane.querySelector<HTMLElement>("[data-stack]")!;
      delete st.dataset.live;
      for (const c of st.children) {
        delete (c as HTMLElement).dataset.on;
        delete (c as HTMLElement).dataset.step;
      }
    }
  };
}

export default function Story() {
  const rig = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"travel" | "inline" | null>(null);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: no-preference)");
    const wide = matchMedia("(min-width: 1024px)");
    const pick = () => setMode(motion.matches ? (wide.matches ? "travel" : "inline") : null);
    pick();
    motion.addEventListener("change", pick);
    wide.addEventListener("change", pick);
    return () => {
      motion.removeEventListener("change", pick);
      wide.removeEventListener("change", pick);
    };
  }, []);
  useEffect(() => {
    if (mode === "travel") return travel(rig.current!);
    if (mode === "inline") return inline();
  }, [mode]);
  return <div ref={rig} className={s.rig} aria-hidden="true" />;
}
