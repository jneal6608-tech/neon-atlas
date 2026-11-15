#!/usr/bin/env node
// Original artwork generator: Vice City-style sunset scenes drawn from code (no Rockstar assets).
// Every article gets a unique hero (1600x900), card (800x450) and share image (1200x630, with title);
// regions and characters get illustrated cards. Output: assets/art/*.jpg
//   node tools/make-art.mjs            (all)        node tools/make-art.mjs <slug>   (one article)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./pw.mjs";
import { ROOT, loadArticles, config } from "../src/content.mjs";

const OUT = path.join(ROOT, "assets/art");
fs.mkdirSync(OUT, { recursive: true });
const cfg = config();

// ---------- seeded randomness so each slug always draws the same picture ----------
function rng(seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SKIES = {
  sunset: ["#12061f", "#3a0d4f", "#8e1d6b", "#ff3d7f", "#ff8a3d", "#ffd36b"],
  dusk: ["#0a0820", "#1d1450", "#4b1d78", "#b4287a", "#ff6a5c", "#ffb35c"],
  night: ["#05040f", "#0d0a2a", "#22124d", "#4a1a6e", "#8a2b7a", "#d6457a"],
  golden: ["#1c0a24", "#5a1846", "#c43a5a", "#ff7a3d", "#ffb347", "#ffe08a"],
};
const SIL = "#12051c"; // silhouette ink

function sky(w, h, horizon, pal, id) {
  const stops = pal.map((c, i) => `<stop offset="${(i / (pal.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
  return `<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect width="${w}" height="${horizon}" fill="url(#sky${id})"/>`;
}
function sun(cx, cy, r, id) {
  // synthwave sun: gradient disc with horizontal cut-outs in the lower half
  let cuts = "";
  for (let i = 0; i < 7; i++) { const y = cy + r * 0.08 + i * r * 0.14; const hgt = 3 + i * 2.6; cuts += `<rect x="${cx - r}" y="${y}" width="${2 * r}" height="${hgt}" fill="black"/>`; }
  return `<defs><linearGradient id="sun${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe98a"/><stop offset=".55" stop-color="#ff9a3d"/><stop offset="1" stop-color="#ff3d7f"/></linearGradient>
<mask id="sm${id}"><rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="white"/>${cuts}</mask>
<radialGradient id="glow${id}"><stop offset="0" stop-color="#ff8a5c" stop-opacity=".55"/><stop offset="1" stop-color="#ff3d7f" stop-opacity="0"/></radialGradient></defs>
<circle cx="${cx}" cy="${cy}" r="${r * 2.2}" fill="url(#glow${id})"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sun${id})" mask="url(#sm${id})"/>`;
}
function stars(w, h, n, R) { let s = ""; for (let i = 0; i < n; i++) s += `<circle cx="${R() * w}" cy="${R() * h}" r="${R() * 1.6 + 0.3}" fill="#fff" opacity="${R() * 0.7 + 0.2}"/>`; return s; }
function palm(x, base, h, lean, R, color = SIL) {
  const tx = x + lean, ty = base - h;
  const trunk = `<path d="M${x - 7} ${base} Q ${x + lean * 0.3} ${base - h * 0.55} ${tx - 3} ${ty} L ${tx + 3} ${ty} Q ${x + lean * 0.3 + 10} ${base - h * 0.55} ${x + 7} ${base} Z" fill="${color}"/>`;
  let fronds = "";
  const n = 7 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const a = (-170 + (i / (n - 1)) * 160 + (R() - 0.5) * 18) * Math.PI / 180;
    const len = h * (0.36 + R() * 0.14);
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.55 + len * 0.35;
    const mx = tx + Math.cos(a) * len * 0.5, my = ty + Math.sin(a) * len * 0.5 - len * 0.12;
    const nx = -Math.sin(a) * len * 0.09, ny = Math.cos(a) * len * 0.09;
    fronds += `<path d="M${tx} ${ty} Q ${mx + nx} ${my + ny} ${ex} ${ey} Q ${mx - nx} ${my - ny} ${tx} ${ty} Z" fill="${color}"/>`;
  }
  return trunk + fronds;
}
function skyline(w, base, R, density = 1, maxH = 260, color = SIL, windows = true) {
  let s = "", x = -20;
  while (x < w + 20) {
    const bw = 40 + R() * 90, bh = (60 + R() * maxH) * (0.6 + density * 0.4);
    const deco = R() < 0.3;
    s += `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" fill="${color}"/>`;
    if (deco) s += `<rect x="${x + bw * 0.2}" y="${base - bh - 22}" width="${bw * 0.6}" height="22" fill="${color}"/><rect x="${x + bw * 0.4}" y="${base - bh - 44}" width="${bw * 0.2}" height="22" fill="${color}"/>`;
    if (windows) for (let wy = base - bh + 14; wy < base - 10; wy += 16) for (let wx = x + 7; wx < x + bw - 9; wx += 13) if (R() < 0.22) s += `<rect x="${wx}" y="${wy}" width="5" height="7" fill="${R() < 0.5 ? "#ffc94d" : "#ff6fa8"}" opacity="${0.35 + R() * 0.5}"/>`;
    x += bw + R() * 8;
  }
  return s;
}
function water(w, top, h, id) {
  let lines = "";
  for (let i = 0; i < 26; i++) { const y = top + 6 + i * (h / 26); lines += `<rect x="${(i * 97) % 300 - 150}" y="${y}" width="${w + 300}" height="${1 + i * 0.12}" fill="#ff8ab8" opacity="${0.06 + (26 - i) * 0.004}"/>`; }
  return `<defs><linearGradient id="wat${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a1a5e"/><stop offset="1" stop-color="#0d0618"/></linearGradient></defs><rect y="${top}" width="${w}" height="${h}" fill="url(#wat${id})"/>${lines}`;
}
function grid(w, top, h, color = "#ff3d9a") {
  let s = `<rect y="${top}" width="${w}" height="${h}" fill="#0d0518"/>`;
  for (let i = 0; i < 14; i++) { const y = top + Math.pow(i / 13, 2) * h; s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${color}" stroke-opacity="${0.15 + i * 0.03}" stroke-width="${1 + i * 0.15}"/>`; }
  for (let i = -16; i <= 16; i++) s += `<line x1="${w / 2 + i * 26}" y1="${top}" x2="${w / 2 + i * 190}" y2="${top + h}" stroke="${color}" stroke-opacity=".35" stroke-width="1.4"/>`;
  return s;
}
function mountains(w, base, R, layers = 3) {
  let s = ""; const cols = ["#3b1453", "#24103a", SIL];
  for (let l = 0; l < layers; l++) {
    let d = `M0 ${base}`; let x = 0;
    while (x <= w) { const y = base - (90 + R() * 200) * (1 - l * 0.2); d += ` L${x} ${y}`; x += 70 + R() * 120; }
    d += ` L${w} ${base} Z`; s += `<path d="${d}" fill="${cols[l]}"/>`;
    if (l === layers - 1) for (let i = 0; i < 40; i++) { const px = R() * w, ph = 20 + R() * 40; s += `<path d="M${px} ${base - ph} l${ph * 0.25} ${ph} h${-ph * 0.5} Z" fill="${SIL}"/>`; }
  }
  return s;
}
function car(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${SIL}" style="filter:drop-shadow(0 0 6px #ff3d9a)"><path stroke="#ff5fae" stroke-width="1.5" d="M0 40 Q 6 22 40 20 L 95 6 Q 130 0 165 8 L 215 22 Q 248 26 252 40 L 252 48 L 0 48 Z"/><circle cx="52" cy="48" r="17"/><circle cx="200" cy="48" r="17"/><circle cx="52" cy="48" r="7" fill="#ff3d7f"/><circle cx="200" cy="48" r="7" fill="#ff3d7f"/><rect x="236" y="30" width="14" height="5" fill="#ffd36b"/></g>`;
}
function figure(x, base, h, female = false) {
  const w = h * 0.26;
  const hair = female ? `<path d="M${x - w * 0.36} ${base - h * 0.86} Q ${x} ${base - h * 1.04} ${x + w * 0.36} ${base - h * 0.86} L ${x + w * 0.42} ${base - h * 0.7} L ${x - w * 0.42} ${base - h * 0.7} Z"/>` : "";
  return `<g fill="${SIL}"><circle cx="${x}" cy="${base - h * 0.88}" r="${w * 0.34}"/>${hair}<path d="M${x - w * 0.5} ${base - h * 0.74} Q ${x} ${base - h * 0.8} ${x + w * 0.5} ${base - h * 0.74} L ${x + w * 0.56} ${base - h * 0.4} L ${x + w * 0.3} ${base - h * 0.4} L ${x + w * 0.26} ${base} L ${x + w * 0.04} ${base} L ${x} ${base - h * 0.36} L ${x - w * 0.04} ${base} L ${x - w * 0.26} ${base} L ${x - w * 0.3} ${base - h * 0.4} L ${x - w * 0.56} ${base - h * 0.4} Z"/></g>`;
}

// ---------- scenes ----------
const SCENES = {
  city(w, h, R, id) { const hz = h * 0.7; return sky(w, hz, hz, SKIES.sunset, id) + stars(w, hz * 0.4, 60, R) + sun(w * (0.35 + R() * 0.3), hz - h * 0.12, h * 0.2, id) + skyline(w, hz, R, 1, h * 0.32) + water(w, hz, h - hz, id) + palm(w * 0.06, h, h * 0.62, 40, R) + palm(w * 0.13, h, h * 0.48, -30, R) + palm(w * 0.92, h, h * 0.58, -50, R); },
  keys(w, h, R, id) { const hz = h * 0.62; let bridge = `<rect x="0" y="${hz + 30}" width="${w}" height="8" fill="${SIL}"/>`; for (let x = 20; x < w; x += 70) bridge += `<rect x="${x}" y="${hz + 30}" width="8" height="34" fill="${SIL}"/>`; return sky(w, hz, hz, SKIES.golden, id) + sun(w * 0.7, hz - h * 0.08, h * 0.17, id) + water(w, hz, h - hz, id) + `<ellipse cx="${w * 0.2}" cy="${hz + 4}" rx="${w * 0.18}" ry="16" fill="${SIL}"/><ellipse cx="${w * 0.88}" cy="${hz + 6}" rx="${w * 0.14}" ry="12" fill="${SIL}"/>` + palm(w * 0.16, hz + 6, h * 0.22, 14, R) + palm(w * 0.22, hz + 6, h * 0.17, -12, R) + palm(w * 0.86, hz + 8, h * 0.2, -10, R) + bridge + `<g transform="translate(${w * 0.42} ${h * 0.22})" fill="${SIL}"><rect x="0" y="10" width="120" height="14" rx="7"/><rect x="40" y="0" width="70" height="5"/><rect x="-6" y="4" width="20" height="10"/><rect x="25" y="26" width="70" height="4"/></g>`; },
  swamp(w, h, R, id) { const hz = h * 0.58; let trees = ""; for (let i = 0; i < 9; i++) { const x = R() * w, th = h * (0.18 + R() * 0.2); trees += `<path d="M${x} ${hz + 10} q -20 -10 -30 ${10} M${x} ${hz + 10} q 20 -8 34 12" stroke="${SIL}" stroke-width="5" fill="none"/><rect x="${x - 4}" y="${hz - th}" width="8" height="${th + 10}" fill="${SIL}"/><ellipse cx="${x}" cy="${hz - th}" rx="${50 + R() * 40}" ry="${22 + R() * 12}" fill="${SIL}"/><ellipse cx="${x - 40}" cy="${hz - th + 18}" rx="${36 + R() * 20}" ry="${16 + R() * 8}" fill="${SIL}"/><ellipse cx="${x + 38}" cy="${hz - th + 14}" rx="${34 + R() * 22}" ry="${15 + R() * 8}" fill="${SIL}"/><path d="M${x} ${hz - th + 20} q -30 30 -60 ${th * 0.4} M${x} ${hz - th + 20} q 26 34 52 ${th * 0.35}" stroke="${SIL}" stroke-width="4" fill="none"/>`; } return sky(w, hz, hz, SKIES.dusk, id) + sun(w * 0.5, hz - h * 0.05, h * 0.15, id) + water(w, hz, h - hz, id) + trees + `<g fill="${SIL}"><ellipse cx="${w * 0.62}" cy="${h * 0.8}" rx="130" ry="14"/><circle cx="${w * 0.62 + 110}" cy="${h * 0.79}" r="9"/><circle cx="${w * 0.62 + 132}" cy="${h * 0.79}" r="9"/></g><circle cx="${w * 0.62 + 112}" cy="${h * 0.787}" r="3" fill="#ffd36b"/><circle cx="${w * 0.62 + 134}" cy="${h * 0.787}" r="3" fill="#ffd36b"/>`; },
  motel(w, h, R, id) { const hz = h * 0.72; return sky(w, hz, hz, SKIES.night, id) + stars(w, hz * 0.6, 120, R) + sun(w * 0.8, hz - h * 0.02, h * 0.12, id) + grid(w, hz, h - hz, "#a43dff") + `<rect x="${w * 0.12}" y="${hz - h * 0.16}" width="${w * 0.5}" height="${h * 0.16}" fill="${SIL}"/>` + Array.from({ length: 10 }, (_, i) => `<rect x="${w * 0.14 + i * w * 0.047}" y="${hz - h * 0.11}" width="${w * 0.025}" height="${h * 0.05}" fill="${R() < 0.6 ? "#ffc94d" : "#2b1438"}" opacity=".85"/>`).join("") + `<rect x="${w * 0.66}" y="${hz - h * 0.46}" width="10" height="${h * 0.46}" fill="${SIL}"/><rect x="${w * 0.6}" y="${hz - h * 0.52}" width="${w * 0.16}" height="${h * 0.11}" rx="10" fill="#14061f" stroke="#ff3d9a" stroke-width="5"/><text x="${w * 0.68}" y="${hz - h * 0.445}" font-family="Anton, Impact, sans-serif" font-size="${h * 0.06}" fill="#ff5fae" text-anchor="middle" style="filter:drop-shadow(0 0 8px #ff3d9a)">MOTEL</text><text x="${w * 0.68}" y="${hz - h * 0.33}" font-family="Anton, Impact, sans-serif" font-size="${h * 0.035}" fill="#3df2e0" text-anchor="middle" style="filter:drop-shadow(0 0 6px #3df2e0)">VACANCY</text>` + palm(w * 0.06, h, h * 0.55, 30, R) + palm(w * 0.95, h, h * 0.5, -30, R); },
  industry(w, h, R, id) { const hz = h * 0.7; let s = ""; for (let i = 0; i < 5; i++) { const x = w * (0.1 + i * 0.09), sh = h * (0.3 + R() * 0.2); s += `<rect x="${x}" y="${hz - sh}" width="26" height="${sh}" fill="${SIL}"/>`; for (let k = 0; k < 6; k++) s += `<circle cx="${x + 13 + k * 22 + R() * 10}" cy="${hz - sh - 20 - k * 22}" r="${18 + k * 9}" fill="#b45a8a" opacity="${0.22 - k * 0.03}"/>`; } return sky(w, hz, hz, SKIES.golden, id) + sun(w * 0.75, hz - h * 0.1, h * 0.17, id) + s + `<rect x="${w * 0.08}" y="${hz - h * 0.12}" width="${w * 0.5}" height="${h * 0.12}" fill="${SIL}"/><ellipse cx="${w * 0.66}" cy="${hz - h * 0.07}" rx="${w * 0.06}" ry="${h * 0.09}" fill="${SIL}"/><ellipse cx="${w * 0.8}" cy="${hz - h * 0.05}" rx="${w * 0.05}" ry="${h * 0.07}" fill="${SIL}"/>` + grid(w, hz, h - hz, "#ff7a3d"); },
  mountains(w, h, R, id) { const hz = h * 0.75; return sky(w, hz, hz, SKIES.dusk, id) + stars(w, hz * 0.5, 80, R) + sun(w * 0.3, hz - h * 0.25, h * 0.14, id) + mountains(w, hz + 30, R) + `<rect y="${hz + 30}" width="${w}" height="${h - hz}" fill="${SIL}"/>` + `<path d="M0 ${h} L${w * 0.45} ${hz + 30} L${w * 0.55} ${hz + 30} L${w} ${h} Z" fill="#26103a"/>`; },
  download(w, h, R, id) { const hz = h * 0.72; const bx = w * 0.18, bw = w * 0.64, by = h * 0.28; return sky(w, hz, hz, SKIES.night, id) + stars(w, hz * 0.7, 90, R) + sun(w * 0.5, hz - h * 0.04, h * 0.2, id) + skyline(w, hz, R, 0.8, h * 0.2) + grid(w, hz, h - hz) + `<rect x="${bx}" y="${by}" width="${bw}" height="${h * 0.07}" rx="${h * 0.035}" fill="#14061f" stroke="#3df2e0" stroke-width="4" style="filter:drop-shadow(0 0 12px #3df2e0)"/><rect x="${bx + 8}" y="${by + 8}" width="${(bw - 16) * (0.55 + R() * 0.4)}" height="${h * 0.07 - 16}" rx="${h * 0.03}" fill="#3df2e0"/>`; },
  cars(w, h, R, id) { const hz = h * 0.6; return sky(w, hz, hz, SKIES.sunset, id) + sun(w * 0.5, hz - h * 0.08, h * 0.2, id) + skyline(w, hz, R, 0.6, h * 0.12, "#2a0c3c", false) + grid(w, hz, h - hz) + car(w * 0.5 - 126 * (w / 1600) * 2.1, h * 0.9 - 65 * (w / 1600) * 2.1, (w / 1600) * 2.1) + palm(w * 0.04, h, h * 0.6, 30, R) + palm(w * 0.96, h, h * 0.6, -30, R); },
  people(w, h, R, id) { const hz = h * 0.72; return sky(w, hz, hz, SKIES.sunset, id) + stars(w, hz * 0.3, 40, R) + sun(w * 0.5, hz - h * 0.1, h * 0.22, id) + water(w, hz, h - hz, id) + `<rect y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="${SIL}"/>` + figure(w * 0.46, h * 0.87, h * 0.42) + figure(w * 0.54, h * 0.87, h * 0.39, true) + palm(w * 0.1, h, h * 0.6, 40, R) + palm(w * 0.9, h, h * 0.6, -40, R); },
  news(w, h, R, id) { const hz = h * 0.66; return sky(w, hz, hz, SKIES.night, id) + stars(w, hz, 140, R) + sun(w * 0.62, hz - h * 0.05, h * 0.16, id) + skyline(w, hz, R, 1.1, h * 0.3) + grid(w, hz, h - hz, "#3df2e0") + `<rect x="${w * 0.22}" y="${hz - h * 0.55}" width="8" height="${h * 0.55}" fill="${SIL}"/><circle cx="${w * 0.22 + 4}" cy="${hz - h * 0.56}" r="8" fill="#ff3d7f" style="filter:drop-shadow(0 0 10px #ff3d7f)"/>`; },
};
const SCENE_FOR = {
  "gta-6-release-date-time": "news", "gta-6-pre-load-guide": "download", "gta-6-editions-standard-vs-ultimate": "cars",
  "gta-6-pre-order-bonus-vintage-vice-city-pack": "city", "gta-6-free-month-gta-plus-redeem": "motel", "gta-6-physical-copy-no-disc": "download",
  "is-gta-6-on-pc": "news", "gta-6-age-rating-parents-guide": "industry", "gta-6-characters": "people", "gta-6-story-what-we-know": "people",
  "gta-6-map-leonida-regions": "keys", "gta-6-vehicles-named-so-far": "cars", "gta-6-launch-week-everything-confirmed": "city",
  "gta-6-launch-night-checklist": "motel", "gta-6-trailers": "city", "gta-6-character-quiz": "people",
};
const CAT_SCENE = { guides: "city", characters: "people", locations: "keys", vehicles: "cars", gameplay: "industry", missions: "swamp", news: "news" };

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const page = (w, h, inner) => `<html><head><link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600;800&display=swap" rel="stylesheet"><style>body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#12061f}</style></head><body>${inner}</body></html>`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function shareOverlay(w, h, title, kicker) {
  return `<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(18,6,31,.92) 0%,rgba(18,6,31,.7) 55%,rgba(18,6,31,0) 100%)"></div>
<div style="position:absolute;left:64px;top:56px;font:400 30px Anton,Impact,sans-serif;letter-spacing:.06em;background:linear-gradient(90deg,#ff4f9a,#ffb347);-webkit-background-clip:text;color:transparent">NEON ATLAS</div>
<div style="position:absolute;left:64px;top:118px;font:800 20px Inter,sans-serif;letter-spacing:.12em;color:#3df2e0;text-transform:uppercase">${esc(kicker)}</div>
<div style="position:absolute;left:64px;top:160px;width:${w * 0.62}px;font:400 ${title.length > 60 ? 58 : 68}px/1.04 Anton,Impact,sans-serif;color:#fff;text-transform:uppercase;text-shadow:0 4px 24px rgba(0,0,0,.6)">${esc(title)}</div>
<div style="position:absolute;left:64px;bottom:48px;font:600 20px Inter,sans-serif;color:#f2d9ff;opacity:.85">Unofficial GTA VI guide · sourced &amp; verified</div>`;
}

async function render(browser, file, w, h, inner, quality = 82) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(page(w, h, inner), { waitUntil: "networkidle" }).catch(() => {});
  await p.screenshot({ path: path.join(OUT, file), type: "jpeg", quality });
  await p.close();
}

const browser = await chromium.launch();
const only = process.argv[2];
const arts = [];
for (const a of loadArticles()) {
  if (only && a.slug !== only) continue;
  const scene = SCENE_FOR[a.slug] || CAT_SCENE[a.category] || "city";
  const draw = (w, h) => svg(w, h, SCENES[scene](w, h, rng(a.slug), a.slug.replace(/[^a-z0-9]/g, "")));
  await render(browser, `${a.slug}.jpg`, 1600, 900, draw(1600, 900));
  await render(browser, `${a.slug}-card.jpg`, 800, 450, draw(800, 450), 78);
  await render(browser, `${a.slug}-share.jpg`, 1200, 630, `<div style="position:relative;width:1200px;height:630px">${draw(1200, 630)}${shareOverlay(1200, 630, a.title.replace(/[:?].*$/, (m) => (m.startsWith("?") ? "?" : "")), a.category)}</div>`);
  arts.push(a.slug);
}
if (!only) {
  // Regions (scene + name). Each matches the official description of that region.
  const regions = [["vice-city", "Vice City", "city"], ["leonida-keys", "Leonida Keys", "keys"], ["grassrivers", "Grassrivers", "swamp"], ["port-gellhorn", "Port Gellhorn", "motel"], ["ambrosia", "Ambrosia", "industry"], ["mount-kalaga", "Mount Kalaga", "mountains"]];
  for (const [slug, name, scene] of regions) {
    const body = svg(960, 540, SCENES[scene](960, 540, rng(slug), slug.replace(/-/g, "")));
    await render(browser, `region-${slug}.jpg`, 960, 540, `<div style="position:relative;width:960px;height:540px">${body}<div style="position:absolute;left:0;right:0;bottom:0;height:160px;background:linear-gradient(transparent,rgba(18,6,31,.9))"></div><div style="position:absolute;left:36px;bottom:28px;font:400 64px Anton,Impact,sans-serif;color:#fff;text-transform:uppercase;letter-spacing:.02em;text-shadow:0 0 18px rgba(255,61,127,.6)">${name}</div></div>`, 80);
  }
  // Character cards: original poster-style cards (name + role), no likenesses.
  const chars = [["jason-duval", "Jason Duval", "Ex-Army · The Keys", ["#ff3d7f", "#ff8a3d"]], ["lucia-caminos", "Lucia Caminos", "Fresh out · With a plan", ["#ff4fd8", "#7a3dff"]], ["cal-hampton", "Cal Hampton", "Paranoid homebody", ["#3df2e0", "#3d6bff"]], ["boobie-ike", "Boobie Ike", "Vice City legend", ["#ffc94d", "#ff3d7f"]], ["dre-quan-priest", "Dre'Quan Priest", "Only Raw Records", ["#a43dff", "#ff3d9a"]], ["real-dimez", "Real Dimez", "Bae-Luxe & Roxy", ["#ff3d9a", "#ffc94d"]], ["raul-bautista", "Raul Bautista", "Bank robber", ["#ff8a3d", "#c41e3a"]], ["brian-heder", "Brian Heder", "Keys smuggler", ["#3df2e0", "#2bd46b"]]];
  for (const [slug, name, role, [c1, c2]] of chars) {
    const ini = name.split(" ").map((p) => p[0]).join("").replace("'", "");
    const R = rng(slug);
    const body = svg(600, 750, sky(600, 750, 750, SKIES[["sunset", "dusk", "night", "golden"][Math.floor(R() * 4)]], slug.replace(/[^a-z]/g, "")) + sun(300, 330, 150, slug.replace(/[^a-z]/g, "") + "s") + palm(60, 750, 420, 50, R) + palm(560, 750, 380, -50, R));
    await render(browser, `char-${slug}.jpg`, 600, 750, `<div style="position:relative;width:600px;height:750px">${body}<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(18,6,31,0) 35%,rgba(18,6,31,.95) 80%)"></div>
<div style="position:absolute;left:0;right:0;top:170px;text-align:center;font:400 220px/1 Anton,Impact,sans-serif;background:linear-gradient(180deg,${c1},${c2});-webkit-background-clip:text;color:transparent;opacity:.95;filter:drop-shadow(0 6px 20px rgba(0,0,0,.5))">${ini}</div>
<div style="position:absolute;left:36px;right:36px;bottom:92px;font:400 62px/1 Anton,Impact,sans-serif;color:#fff;text-transform:uppercase">${esc(name)}</div>
<div style="position:absolute;left:36px;bottom:46px;font:800 20px Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${c1}">${esc(role)}</div></div>`, 80);
  }
  // Home hero + default share image
  const hero = svg(2000, 900, SCENES.city(2000, 900, rng("home-hero"), "home"));
  await render(browser, "home-hero.jpg", 2000, 900, hero, 80);
  await render(browser, "../og-default.png".replace(".png", ".jpg"), 1200, 630, `<div style="position:relative;width:1200px;height:630px">${svg(1200, 630, SCENES.city(1200, 630, rng("og"), "og"))}${shareOverlay(1200, 630, "The independent GTA VI guide", "Launch week " + cfg.launchDate.slice(0, 4))}</div>`);
}
await browser.close();
console.log(`Rendered art for ${arts.length} articles${only ? "" : ", 6 regions, 8 characters, home hero and default share image"} → assets/art/`);
