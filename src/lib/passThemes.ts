import type { TemplateKey } from "./config";

// Default Wallet card colours per redeem template, used whenever a merchant has
// not picked their own. Apple wants "rgb(r,g,b)". The bundled default art in
// passDefaults.ts is drawn for exactly these colours by
// scripts/render-pass-art.mjs, which also checks the contrast (foreground ≥ 7:1
// and label ≥ 4.5:1 on the background, points and label ≥ 4.5:1 over the worst
// strip pixel under the number) — re-run it after changing a colour here. No
// image data in this file: the admin wizard and /demo import it in the browser.
export type PassTheme = { bg: string; fg: string; label: string };

export const PASS_THEMES: Record<TemplateKey, PassTheme> = {
  // Espresso + steamed-milk cream, terracotta labels: kept clear of the
  // restaurant's gold so a café and a restaurant card differ in a Wallet stack.
  cafe: { bg: "rgb(42,29,23)", fg: "rgb(246,238,225)", label: "rgb(224,122,95)" },
  // Oxblood + ivory, warm gold labels.
  restaurant: { bg: "rgb(74,21,28)", fg: "rgb(251,240,222)", label: "rgb(222,181,112)" },
  // Ink navy + paper white, mint labels.
  retail: { bg: "rgb(16,26,45)", fg: "rgb(239,244,248)", label: "rgb(125,214,182)" },
};
