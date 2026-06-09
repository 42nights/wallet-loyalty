"use client";
import { useState } from "react";

// Light/dark toggle. Persists via a cookie (project rule: no localStorage) so the
// server layout can read it and render the right theme with no flash. Flips the
// <html data-theme> attribute immediately — no reload needed.
export default function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [theme, setTheme] = useState<"light" | "dark">(initial);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle light or dark theme" title="Toggle theme">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
