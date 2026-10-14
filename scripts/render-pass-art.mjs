// Renders the bundled default Apple Wallet art for every redeem template and
// rewrites the base64 table in src/lib/passDefaults.ts.
//   node --import tsx scripts/render-pass-art.mjs
// Each image is inline SVG screenshotted by Playwright's Chromium at its exact
// pixel size (deviceScaleFactor 1), so the art is reproducible from this file
// and needs no external image or font. Colours come from src/lib/passThemes.ts.
// Fails without writing anything if a theme misses its contrast targets.
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PASS_THEMES } from "../src/lib/passThemes.ts";
import { WALLET_ASSETS } from "../src/lib/wallet/apple/assets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The logo is a mark only (Wallet prints the shop name beside it as logoText),
// so it is drawn on a narrow canvas inside Apple's 160x50 maximum: a wider
// canvas would push the name away from the mark.
const LOGO = { w: 34, h: 50 };

// Where Wallet draws the POINTS label and the big number over a 375x144 strip
// (left-aligned, room for 4-5 digits). Contrast is measured over this box.
const UNDER_NUMBER = { x: 0, y: 0, w: 200, h: 120 };

const parse = (c) => c.match(/\d+/g).map(Number);
const mix = (a, b, t) => `rgb(${parse(a).map((v, i) => Math.round(v + (parse(b)[i] - v) * t)).join(",")})`;
const lum = ([r, g, b]) => {
  const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// One glyph per template on a 38x38 grid: `ink` draws it, `cut` is the colour
// of the details punched into it (the surface it sits on).
const GLYPHS = {
  cafe: (ink, cut) => `
    <g transform="rotate(-35 19 19)">
      <ellipse cx="19" cy="19" rx="9.6" ry="13.6" fill="${ink}"/>
      <path d="M19 6.2C14.4 12 23.6 26 19 31.8" stroke="${cut}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>`,
  restaurant: (ink, cut) => `
    <path d="M6.5 27A12.5 12.5 0 0 1 31.5 27Z" fill="${ink}"/>
    <rect x="4.5" y="28.6" width="29" height="2.8" rx="1.4" fill="${ink}"/>
    <circle cx="19" cy="11.4" r="2.5" fill="${ink}"/>
    <path d="M11.5 23.4A8.5 8.5 0 0 1 16.4 17.3" stroke="${cut}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-opacity=".55"/>`,
  retail: (ink, cut) => `
    <g transform="rotate(45 19 19)">
      <path d="M19 4.5L28.5 13.2V31A2.8 2.8 0 0 1 25.7 33.8H12.3A2.8 2.8 0 0 1 9.5 31V13.2Z" fill="${ink}"/>
      <circle cx="19" cy="13.8" r="2.7" fill="${cut}"/>
    </g>`,
};

// Strip motifs on the 375x144 grid. They are faded out over the left side by a
// mask, so the big number always sits on near-flat background colour.
const MOTIFS = {
  // Rising steam: soft wavy lines, each with its own sway and height, so some
  // trail off before the top edge.
  cafe: (t) =>
    Array.from({ length: 10 }, (_, i) => {
      const x = 186 + i * 20;
      const a = (i % 2 ? -1 : 1) * (8 + (i % 3) * 3);
      const o = (0.1 + (i % 3) * 0.035).toFixed(3);
      const y = (v) => v + ((i * 7) % 3) * 16 - 12;
      return `<path d="M${x} ${y(170)}C${x - a} ${y(136)} ${x + a} ${y(108)} ${x} ${y(80)}S${x + a} ${y(24)} ${x} ${y(-6)}" stroke="${t.fg}" stroke-opacity="${o}" stroke-width="1.3" stroke-linecap="round"/>`;
    }).join(""),
  // Art-deco sunrise from the lower right corner: rings and fine rays, like a
  // plate rim seen from above.
  restaurant: (t) => {
    const [cx, cy] = [352, 158];
    const rings = Array.from({ length: 11 }, (_, i) =>
      `<circle cx="${cx}" cy="${cy}" r="${36 + i * 18}" stroke="${t.label}" stroke-opacity="${(0.26 - i * 0.012).toFixed(3)}" stroke-width="1"/>`
    ).join("");
    const rays = Array.from({ length: 13 }, (_, i) => {
      const r = ((180 + i * 7.5) * Math.PI) / 180;
      const p = (d) => `${(cx + d * Math.cos(r)).toFixed(1)} ${(cy + d * Math.sin(r)).toFixed(1)}`;
      return `<path d="M${p(36)}L${p(260)}" stroke="${t.label}" stroke-opacity=".1" stroke-width=".8"/>`;
    }).join("");
    return `${rays}${rings}<circle cx="${cx}" cy="${cy}" r="24" fill="${t.label}" fill-opacity=".2"/>`;
  },
  // A fine ledger grid with one large price tag resting on it.
  retail: (t) => `
    <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M16 0H0V16" stroke="${t.label}" stroke-opacity=".11" stroke-width=".8" fill="none"/>
    </pattern>
    <rect width="375" height="144" fill="url(#grid)"/>
    <g transform="translate(234 42) rotate(-14 60 32)" stroke="${t.label}" stroke-width="1.5">
      <path d="M26 0H112A10 10 0 0 1 122 10V54A10 10 0 0 1 112 64H26L0 32Z" stroke-opacity=".38" fill="${t.bg}" fill-opacity=".55"/>
      <circle cx="26" cy="32" r="6" stroke-opacity=".38"/>
      <path d="M44 22H100M44 32H88M44 42H76" stroke-opacity=".2" stroke-linecap="round"/>
    </g>`,
};

const svg = (w, h, vw, vh, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" style="display:block">${body}</svg>`;

function draw(template, kind, w, h) {
  const t = PASS_THEMES[template];
  const glyph = GLYPHS[template];
  if (kind === "icon") return svg(w, h, 38, 38, `<rect width="38" height="38" fill="${t.bg}"/>${glyph(t.label, t.bg)}`);
  if (kind === "logo")
    return svg(w, h, LOGO.w, LOGO.h, `<circle cx="17" cy="25" r="15" fill="${t.label}"/>
      <g transform="translate(17 25) scale(.6) translate(-19 -19)">${glyph(t.bg, t.label)}</g>`);
  return svg(w, h, 375, 144, `
    <defs>
      <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${t.bg}"/><stop offset="1" stop-color="${mix(t.bg, t.label, 0.12)}"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" x2="1">
        <stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff"/>
      </linearGradient>
      <mask id="m"><rect width="375" height="144" fill="url(#fade)"/></mask>
    </defs>
    <rect width="375" height="144" fill="url(#base)"/>
    <g mask="url(#m)" fill="none">${MOTIFS[template](t)}</g>`);
}

// Mean relative luminance of a PNG region (PNG drawn at 1x), read in the page.
async function meanLum(page, png, box) {
  const px = await page.evaluate(async ({ src, box }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(box.x, box.y, box.w, box.h).data);
  }, { src: `data:image/png;base64,${png.toString("base64")}`, box });
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += lum([px[i], px[i + 1], px[i + 2]]);
  return sum / (px.length / 4);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const out = {};
const report = [];
for (const template of Object.keys(PASS_THEMES)) {
  out[template] = {};
  for (const [name, spec] of Object.entries(WALLET_ASSETS)) {
    const kind = name.split(/[@.]/)[0];
    const scale = Number(name.match(/@(\d)x/)?.[1] ?? 1);
    const w = kind === "logo" ? LOGO.w * scale : spec.w;
    const h = kind === "logo" ? LOGO.h * scale : spec.h;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<body style="margin:0;background:transparent">${draw(template, kind, w, h)}</body>`);
    out[template][name] = await page.screenshot({ omitBackground: kind === "logo" });
  }
  const t = PASS_THEMES[template];
  const [bg, fg, label] = [t.bg, t.fg, t.label].map((c) => lum(parse(c)));
  const strip = await meanLum(page, out[template]["strip.png"], UNDER_NUMBER);
  const row = { template, fgOnBg: ratio(fg, bg), labelOnBg: ratio(label, bg), fgOnStrip: ratio(fg, strip), labelOnStrip: ratio(label, strip) };
  report.push(row);
  if (row.fgOnBg < 7 || row.labelOnBg < 4.5 || row.fgOnStrip < 4.5 || row.labelOnStrip < 4.5) {
    await browser.close();
    throw new Error(`${template} misses a contrast target: ${JSON.stringify(row)}`);
  }
}
await browser.close();

for (const [template, files] of Object.entries(out)) {
  await mkdir(`${ROOT}models/themes/${template}`, { recursive: true });
  for (const [name, buf] of Object.entries(files)) await writeFile(`${ROOT}models/themes/${template}/${name}`, buf);
}

const table = Object.entries(out)
  .map(([template, files]) =>
    `  ${template}: {\n${Object.entries(files).map(([n, b]) => `    "${n}": "${b.toString("base64")}",`).join("\n")}\n  },`)
  .join("\n");
const file = `${ROOT}src/lib/passDefaults.ts`;
const src = await readFile(file, "utf8");
const block = /const DEFAULT_ASSETS_B64[^=]*= \{[\s\S]*?\n\};\n/;
if (!block.test(src)) throw new Error("DEFAULT_ASSETS_B64 block not found in passDefaults.ts");
await writeFile(file, src.replace(block, () =>
  `const DEFAULT_ASSETS_B64: Record<TemplateKey, Record<WalletAsset, string>> = {\n${table}\n};\n`));

console.table(report.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v.toFixed(2) : v]))));
