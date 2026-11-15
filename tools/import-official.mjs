#!/usr/bin/env node
// Imports official GTA VI images you downloaded from Rockstar's own media pages, so character and region
// galleries (and quiz results) show real pictures, credited "Image: Rockstar Games".
//   node tools/import-official.mjs <folder-with-downloaded-images> [--force]
// It looks for files named like Rockstar's (e.g. Jason_Duval_01.jpg, Lucia_Caminos_12.jpg, Vice_City_03.jpg),
// picks the lowest-numbered one per character/region, crops and resizes it (characters 600x750, regions 960x540),
// and writes assets/official/<characters|regions>/<slug>.jpg. Rebuild afterwards (npm run build).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./pw.mjs";
import { ROOT } from "../src/content.mjs";

// Per-image crop focus (object-position) where the subject isn't centred in Rockstar's 16:9 shot.
const FOCUS = { "jason-duval": "88% 30%", "cal-hampton": "82% 25%", "dre-quan-priest": "62% 25%" };
const SETS = {
  characters: { size: [600, 750], focus: "50% 25%", items: { "jason-duval": /jason[_ -]?duval/i, "lucia-caminos": /lucia[_ -]?caminos/i, "cal-hampton": /cal[_ -]?hampton/i, "boobie-ike": /boobie[_ -]?ike/i, "dre-quan-priest": /dre'?quan[_ -]?priest/i, "real-dimez": /real[_ -]?dimez/i, "raul-bautista": /raul[_ -]?bautista/i, "brian-heder": /brian[_ -]?heder/i } },
  regions: { size: [960, 540], focus: "50% 50%", items: { "vice-city": /^vice[_ -]?city[_ -]?\d/i, "leonida-keys": /leonida[_ -]?keys/i, "grassrivers": /grassrivers/i, "port-gellhorn": /port[_ -]?gellhorn/i, "ambrosia": /ambrosia/i, "mount-kalaga": /(mount[_ -]?)?kalaga/i } },
};
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error("usage: node tools/import-official.mjs <folder>"); process.exit(1); }
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(jpe?g|png|webp)$/i.test(f)) files.push(p); } })(path.resolve(dir));
const num = (f) => +(path.basename(f).match(/_(\d+)/)?.[1] ?? 999);
const browser = await chromium.launch();
const page = await browser.newPage();
const found = [], missing = [];
for (const [kind, set] of Object.entries(SETS)) {
  fs.mkdirSync(path.join(ROOT, "assets/official", kind), { recursive: true });
  for (const [slug, re] of Object.entries(set.items)) {
    const out = path.join(ROOT, "assets/official", kind, `${slug}.jpg`);
    const match = files.filter((f) => re.test(path.basename(f)) && !/video|clip|logo/i.test(path.basename(f))).sort((a, b) => num(a) - num(b))[0];
    if (!match) { missing.push(`${kind}/${slug}`); continue; }
    if (fs.existsSync(out) && !process.argv.includes("--force")) { found.push(`${kind}/${slug} (kept existing; --force to replace)`); continue; }
    const [w, h] = set.size;
    await page.setViewportSize({ width: w, height: h });
    const data = fs.readFileSync(match).toString("base64");
    const mime = /png$/i.test(match) ? "image/png" : /webp$/i.test(match) ? "image/webp" : "image/jpeg";
    await page.setContent(`<body style="margin:0;background:#000"><img id="i" src="data:${mime};base64,${data}" style="width:${w}px;height:${h}px;object-fit:cover;object-position:${FOCUS[slug] || set.focus};display:block"></body>`);
    await page.waitForFunction(() => document.getElementById("i").complete);
    await page.screenshot({ path: out, type: "jpeg", quality: 82 });
    found.push(`${kind}/${slug} ← ${path.basename(match)}`);
  }
}
await browser.close();
console.log(`Imported/kept ${found.length}:\n  ${found.join("\n  ")}`);
if (missing.length) console.log(`\nNot found (these keep the original artwork): ${missing.join(", ")}\nTip: on rockstargames.com/VI/only-in-leonida, right-click a character or region image → Save image, keep Rockstar's file name, and re-run.`);
console.log("\nNext: npm run build (or npm test).");
