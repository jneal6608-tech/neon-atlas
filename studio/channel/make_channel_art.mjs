// make_channel_art.mjs: the Neon Atlas YouTube channel's profile picture and banner, from the site's own icon.
// Usage (from the repository root): node studio/channel/make_channel_art.mjs
//   -> studio/channel/profile-800.png   (800x800; the site icon from assets/favicon.svg, full-bleed so YouTube's
//                                         circle crop shows no corners)
//   -> studio/channel/banner-2560x1440.png (YouTube banner; text and logo inside the 1546x423 safe area that every
//                                         device shows; the rest is background that TVs and wide screens add)
// Needs Playwright's Chromium (preinstalled in cloud sessions) and fonts.googleapis.com for Anton and Inter.
import { chromium } from "../../tools/pw.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const icon = fs.readFileSync(path.join(ROOT, "assets/favicon.svg"), "utf8");
// same mark on a square background, scaled to 86% so YouTube's circle crop keeps every grid line
const square = icon.replace('rx="112"', 'rx="0"')
  .replace(/<circle cx="256" cy="240" r="150" fill="#ff4f9a"/, '<g transform="translate(256 256) scale(.86) translate(-256 -256)"><circle cx="256" cy="240" r="150" fill="#ff4f9a"')
  .replace(/<\/svg>\s*$/, "</g></svg>");
const C = { bg: "#12061f", deep: "#2a0f45", pink: "#ff4f9a", orange: "#ff8a3d", gold: "#ffc94d", aqua: "#3df2e0",
            text: "#fbf2ff", muted: "#cdb8dd" };
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600;800&display=swap">';

const profile = `<!doctype html><html><head><style>html,body{margin:0;background:${C.bg}}svg{display:block;width:800px;height:800px}</style></head><body>${square}</body></html>`;

// Banner: sky, horizon glow and a perspective grid across the full width; logo and words in the safe area.
const W = 2560, H = 1440, SAFE = { x: (W - 1546) / 2, y: (H - 423) / 2, w: 1546, h: 423 };
const horizon = SAFE.y + SAFE.h + 4;   // just under the safe area: text on clear sky, grid below
let grid = "";
for (let i = -24; i <= 24; i++) {            // lines running to the vanishing point
  grid += `<line x1="${W / 2}" y1="${horizon}" x2="${W / 2 + i * 260}" y2="${H}" />`;
}
for (let k = 1; k <= 12; k++) {              // horizontal lines, closer together near the horizon
  const y = horizon + (H - horizon) * Math.pow(k / 12, 2.2);
  grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" />`;
}
let stars = "";
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 140; i++) {
  stars += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * (horizon - 40)).toFixed(0)}" r="${(rnd() * 2.2 + 0.6).toFixed(1)}" opacity="${(rnd() * 0.6 + 0.2).toFixed(2)}"/>`;
}
const banner = `<!doctype html><html><head>${FONTS}<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${C.bg}}
.bg{position:absolute;inset:0}
.safe{position:absolute;left:${SAFE.x}px;top:${SAFE.y}px;width:${SAFE.w}px;height:${SAFE.h}px;display:flex;align-items:center;justify-content:center;gap:64px;padding:0 40px;box-sizing:border-box}
.logo{width:300px;height:300px;flex:none;filter:drop-shadow(0 0 40px rgba(255,79,154,.55))}
.logo svg{width:100%;height:100%}
h1{font:400 196px/0.9 Anton,Impact,sans-serif;letter-spacing:6px;margin:0;color:${C.text};text-shadow:0 0 30px rgba(255,79,154,.7),0 0 80px rgba(255,138,61,.35)}
h1 span{background:linear-gradient(180deg,${C.gold},${C.orange} 55%,${C.pink});-webkit-background-clip:text;background-clip:text;color:transparent}
.tag{font:800 52px/1.1 Inter,sans-serif;color:${C.text};margin:18px 0 0;letter-spacing:.5px}
.series{font:600 36px/1.2 Inter,sans-serif;color:${C.aqua};margin:14px 0 0;letter-spacing:1px}
.small{font:600 26px/1.2 Inter,sans-serif;color:${C.muted};margin:16px 0 0;letter-spacing:1px}
</style></head><body>
<svg class="bg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
 <defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset=".55" stop-color="${C.deep}"/><stop offset="1" stop-color="#4a1550"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy="1" r=".6"><stop offset="0" stop-color="${C.pink}" stop-opacity=".55"/><stop offset=".5" stop-color="${C.orange}" stop-opacity=".12"/><stop offset="1" stop-color="${C.pink}" stop-opacity="0"/></radialGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c0830"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
 </defs>
 <rect width="${W}" height="${horizon}" fill="url(#sky)"/>
 <g fill="${C.text}">${stars}</g>
 <rect x="0" y="${horizon - 520}" width="${W}" height="520" fill="url(#glow)"/>
 <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#floor)"/>
 <g stroke="${C.aqua}" stroke-width="3" opacity=".55">${grid}</g>
 <line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="${C.aqua}" stroke-width="5" opacity=".9"/>
</svg>
<div class="safe">
 <div class="logo">${icon}</div>
 <div>
  <h1>NEON <span>ATLAS</span></h1>
  <p class="tag">The independent GTA 6 guide</p>
  <p class="series">NEWS &#183; LORE &#183; CAR TESTS &#183; GUIDES &#183; SHORTS</p>
  <p class="small">UNOFFICIAL FAN CHANNEL &#183; NEONATLASGUIDE.COM</p>
 </div>
</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.setContent(profile);
await page.screenshot({ path: path.join(HERE, "profile-800.png") });
await page.setContent(`<html><body style="margin:0;background:#fff"><div style="width:800px;height:800px;border-radius:50%;overflow:hidden">${square.replace("<svg ", '<svg width="800" height="800" ')}</div></body></html>`);
await page.screenshot({ path: path.join(HERE, "preview-profile-circle.png") });
await page.setViewportSize({ width: W, height: H });
await page.setContent(banner, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const fontsOk = await page.evaluate(() => document.fonts.check('196px Anton') && document.fonts.check('800 52px Inter'));
await page.screenshot({ path: path.join(HERE, "banner-2560x1440.png") });
// previews of what each device shows: desktop (2560x423 band) and phone (the 1546x423 safe area)
await page.screenshot({ path: path.join(HERE, "preview-desktop.png"), clip: { x: 0, y: SAFE.y, width: W, height: 423 } });
await page.screenshot({ path: path.join(HERE, "preview-phone.png"), clip: { x: SAFE.x, y: SAFE.y, width: 1546, height: 423 } });
await browser.close();
if (!fontsOk) { console.error("fonts did not load: the banner fell back to Impact/sans-serif"); process.exit(1); }
console.log("wrote studio/channel/profile-800.png, banner-2560x1440.png and two previews");
