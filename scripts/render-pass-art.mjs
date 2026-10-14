// Renders the bundled default Apple Wallet art for every redeem template and
// rewrites the base64 table in src/lib/passDefaults.ts.
//   node --import tsx scripts/render-pass-art.mjs
// Each image is inline SVG screenshotted by Playwright's Chromium at its exact
// pixel size (deviceScaleFactor 1, sRGB forced), so the art is reproducible
// from this file and needs no external image or font. Colours come from
// src/lib/passThemes.ts. Every PNG is then re-deflated with node:zlib at the
// maximum level: the art ships inside every pass and every Wallet update.
// Fails without writing anything if a theme misses any check below.
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { PASS_THEMES } from "../src/lib/passThemes.ts";
import { pngChunk } from "../src/lib/wallet/apple/stampStrip.ts";
import { WALLET_ASSETS } from "../src/lib/wallet/apple/assets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The logo is a mark only (Wallet prints the shop name beside it as logoText),
// so it is drawn on a narrow canvas inside Apple's 160x50 maximum: a wider
// canvas would push the name away from the mark.
const LOGO = { w: 34, h: 50 };

// Where Wallet draws the POINTS label and the big number over a 375x144 strip
// (left-aligned, room for 4-5 digits). Contrast is checked against the worst
// single pixel in this box, at every scale.
const UNDER_NUMBER = { x: 0, y: 0, w: 200, h: 120 };

// One template's nine images together, in bytes.
const ART_BUDGET = 60 * 1024;

const parse = (c) => c.match(/\d+/g).map(Number);
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

// Strip motifs on the 375x144 grid, drawn over the flat theme background with
// flat strokes and fills (small PNGs). draw() fades every motif out over the
// left side, so the number sits on plain background, and at the top and
// bottom edges, so the strip has no seam against the rest of the card.
// Each motif is one upright line-art object in the right third, standing on a
// ground line near y=117, inside x 212-359 (16pt in from the right edge, like
// Wallet's field inset) and y 20-124.
const MOTIFS = {
  // A cup on its saucer in the label colour, with three wisps of steam in the
  // cream text colour: one lazy S each, a hairline over a soft halo, fading in
  // above the rim and out by the top, so they read as steam and not flame. The
  // label colour stays the card's only accent.
  cafe: (t) => {
    const wisp = (x, top, a) => {
      const h = (77 - top) / 2;
      return `<path d="M${x} 77C${x - a} ${77 - h / 3} ${x - a} ${77 - (2 * h) / 3} ${x} ${77 - h}S${x + a} ${top + h / 3} ${x} ${top}"/>`;
    };
    const steam = [wisp(292, 32, 5), wisp(304, 20, 6), wisp(316, 26, 5)].join("");
    return `
      <linearGradient id="steam" gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="0" y2="20">
        <stop offset="0" stop-color="${t.fg}" stop-opacity="0"/>
        <stop offset=".3" stop-color="${t.fg}" stop-opacity=".45"/>
        <stop offset="1" stop-color="${t.fg}" stop-opacity="0"/>
      </linearGradient>
      <g stroke="url(#steam)" stroke-linecap="round">
        <g stroke-width="3.6" opacity=".22">${steam}</g>
        <g stroke-width="1.3">${steam}</g>
      </g>
      <g stroke="${t.label}" stroke-opacity=".62" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="304" cy="84" rx="26" ry="4.2" fill="${t.label}" fill-opacity=".16"/>
        <path d="M278 84C278 103 288 114.5 304 114.5S330 103 330 84"/>
        <path d="M329.4 91C343 89 344 104 325.5 105.5"/>
        <path d="M264 113C282 118 326 118 344 113"/>
      </g>`;
  },
  // Art-deco fan: half rings on a baseline, alternating heavy and hairline,
  // around a small solid sun. The baseline stops short of the card edge on a
  // small diamond at each end.
  restaurant: (t) => {
    const [cx, cy, half] = [286, 116, 70];
    const arc = (r) => `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    const rings = [24, 38, 52, 66].map((r, i) =>
      `<path d="${arc(r)}" stroke="${t.label}" stroke-opacity="${i % 2 ? ".3" : ".48"}" stroke-width="${i % 2 ? ".8" : "1.6"}"/>`
    ).join("");
    const diamond = (x) => `<path d="M${x - 2.2} ${cy}L${x} ${cy - 2.2}L${x + 2.2} ${cy}L${x} ${cy + 2.2}Z"/>`;
    return `${rings}<path d="${arc(10)}Z" fill="${t.label}" fill-opacity=".36"/>` +
      `<path d="M${cx - half + 4} ${cy}H${cx + half - 4}" stroke="${t.label}" stroke-opacity=".4" stroke-width=".8"/>` +
      `<g fill="${t.label}" fill-opacity=".55">${diamond(cx - half)}${diamond(cx + half)}</g>`;
  },
  // A till receipt: torn zigzag ends, printed rows and a dashed rule above the
  // total, so the dotted line belongs to it. No barcode: the card's real QR sits
  // just below, and two codes on one card is noise. The tag appears only in the
  // icon and logo.
  retail: (t) => {
    const [x0, x1, y0, y1, tooth] = [272, 332, 26, 114, 7.5];
    const zig = (y, dir) => Array.from({ length: 8 }, (_, i) => {
      const x = dir > 0 ? x0 + (i + 1) * tooth : x1 - (i + 1) * tooth;
      return `L${x - (dir * tooth) / 2} ${y - dir * 3.5}L${x} ${y}`;
    }).join("");
    const bar = (x, y, w, h = 1.6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
    const rows = [[58, 22, 8], [65, 17, 8], [72, 25, 6]]
      .map(([y, w, p]) => bar(x0 + 8, y, w) + bar(x1 - 8 - p, y, p)).join("");
    const dashes = Array.from({ length: 11 }, (_, i) => bar(x0 + 8 + i * 4.2, 81, 2.2, 1.1)).join("");
    return `
      <path d="M${x0} ${y0}${zig(y0, 1)}V${y1}${zig(y1, -1)}Z" fill="${t.label}" fill-opacity=".06"
        stroke="${t.label}" stroke-opacity=".5" stroke-width="1.2" stroke-linejoin="round"/>
      <g fill="${t.label}" fill-opacity=".5">
        ${bar(292, 36, 20, 3)}${bar(296, 43, 12, 1.4)}${rows}${dashes}
        ${bar(x0 + 8, 88, 18, 2.6)}${bar(x1 - 20, 88, 12, 2.6)}
      </g>`;
  },
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
  // The masks leave the left 44% and the top and bottom 5pt as pure background.
  return svg(w, h, 375, 144, `
    <defs>
      <linearGradient id="fadeX" x1="0" x2="1">
        <stop offset=".44" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#fff"/>
      </linearGradient>
      <linearGradient id="fadeY" x1="0" x2="0" y1="0" y2="1">
        <stop offset=".035" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/>
        <stop offset=".86" stop-color="#fff"/><stop offset=".965" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <mask id="mx"><rect width="375" height="144" fill="url(#fadeX)"/></mask>
      <mask id="my"><rect width="375" height="144" fill="url(#fadeY)"/></mask>
    </defs>
    <rect width="375" height="144" fill="${t.bg}"/>
    <g mask="url(#mx)"><g mask="url(#my)" fill="none">${MOTIFS[template](t)}</g></g>`);
}

// Same pixels, smaller file. The IDAT chunks together hold one zlib stream, so
// inflate it and deflate it again at level 9; every other chunk is kept.
function recompress(png) {
  const parts = [png.subarray(0, 8)];
  const idat = [];
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    const data = png.subarray(i + 8, i + 8 + len);
    if (type === "IDAT") {
      if (!idat.length) parts.push("IDAT");
      idat.push(data);
    } else parts.push(pngChunk(type, data));
    i += 12 + len;
  }
  const z = deflateSync(inflateSync(Buffer.concat(idat)), { level: 9, memLevel: 9 });
  const out = Buffer.concat(parts.map((p) => (p === "IDAT" ? pngChunk("IDAT", z) : p)));
  return out.length < png.length ? out : png;
}

// RGB of every pixel in a PNG region, decoded by the browser.
async function pixels(page, png, box) {
  return page.evaluate(async ({ src, box }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(box.x, box.y, box.w, box.h).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, { src: `data:image/png;base64,${png.toString("base64")}`, box });
}

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const fail = async (msg) => {
  await browser.close();
  throw new Error(msg);
};
const out = {};
const report = [];
for (const template of Object.keys(PASS_THEMES)) {
  out[template] = {};
  const t = PASS_THEMES[template];
  const [bg, fg, label] = [t.bg, t.fg, t.label].map((c) => lum(parse(c)));
  const row = {
    template, fgOnBg: ratio(fg, bg), labelOnBg: ratio(label, bg),
    fgOnStripWorst: Infinity, labelOnStripWorst: Infinity, rawBytes: 0, bytes: 0,
  };
  for (const [name, spec] of Object.entries(WALLET_ASSETS)) {
    const kind = name.split(/[@.]/)[0];
    const scale = Number(name.match(/@(\d)x/)?.[1] ?? 1);
    const w = kind === "logo" ? LOGO.w * scale : spec.w;
    const h = kind === "logo" ? LOGO.h * scale : spec.h;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<body style="margin:0;background:transparent">${draw(template, kind, w, h)}</body>`);
    const raw = await page.screenshot({ omitBackground: kind === "logo" });
    const png = recompress(raw);
    out[template][name] = png;
    row.rawBytes += raw.length;
    row.bytes += png.length;
    if (kind !== "strip") continue;
    // Seamless: the first and last pixel rows are exactly the card background.
    for (const y of [0, h - 1]) {
      const edge = await pixels(page, png, { x: 0, y, w, h: 1 });
      if (edge.some((p) => p.join() !== parse(t.bg).join()))
        await fail(`${template} ${name} row ${y} is not exactly ${t.bg}, so the strip would show a seam`);
    }
    const box = await pixels(page, png, {
      x: UNDER_NUMBER.x * scale, y: UNDER_NUMBER.y * scale, w: UNDER_NUMBER.w * scale, h: UNDER_NUMBER.h * scale,
    });
    for (const p of box) {
      const l = lum(p);
      row.fgOnStripWorst = Math.min(row.fgOnStripWorst, ratio(fg, l));
      row.labelOnStripWorst = Math.min(row.labelOnStripWorst, ratio(label, l));
    }
  }
  report.push(row);
  if (row.fgOnBg < 7 || row.labelOnBg < 4.5 || row.fgOnStripWorst < 4.5 || row.labelOnStripWorst < 4.5)
    await fail(`${template} misses a contrast target: ${JSON.stringify(row)}`);
  if (row.bytes > ART_BUDGET) await fail(`${template} art is ${row.bytes} bytes, over the ${ART_BUDGET}-byte budget`);
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

console.table(report.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) =>
  [k, typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v]))));
