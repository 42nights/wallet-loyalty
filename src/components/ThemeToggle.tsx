"use client";
import { useState } from "react";

type Theme = "light" | "dark";
// Same values as the root layout's generateViewport (the page background).
const THEME_COLOR: Record<Theme, string> = { dark: "#0f0e0d", light: "#f6f3ee" };

// "Dark mode" row in the account menu. The cookie (project rule: no
// localStorage) lets the server render the right theme with no flash; the
// data-theme flip applies it now, without a reload.
export default function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[next]);
  }
  return (
    <button type="button" className="acct-row" aria-pressed={theme === "dark"} onClick={toggle}>
      Dark mode
      <span className="switch" aria-hidden="true" />
    </button>
  );
}
