#!/usr/bin/env node
// Downloads the official GTA VI images Rockstar publishes on its own pages (its "Download and share" media),
// so tools/import-official.mjs can turn them into credited character, region and article images.
//   node tools/fetch-official.mjs [folder]      default folder: .official-cache/ (git-ignored, ~300 MB of 4K originals)
// Then: npm run import-official   (or: node tools/import-official.mjs .official-cache --force to redo every crop)
// Only rockstargames.com is contacted. Already-downloaded files are skipped, so re-running only fetches new images,
// e.g. after the watcher reports a new screenshot drop.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/content.mjs";

const PAGES = ["VI", "VI/only-in-leonida", "VI/editions", "VI/media"].map((p) => `https://www.rockstargames.com/${p}`);
// UI pieces, logos, phone/portrait crops and localised duplicates are not useful as article images.
const SKIP = /(^|\/)(shard|overlay|logo|mobile|wm-|poster_logo|Hero_FG|Hero_BG|background|desktop|vi\.|t\.|t2\.)|_(phone|portrait|square|tablet)\b|_(fr_fr|ja_jp|ko_kr|zh_hans|zh_tw)/i;
const out = path.resolve(process.argv[2] || path.join(ROOT, ".official-cache"));
fs.mkdirSync(out, { recursive: true });

const urls = new Set();
for (const p of PAGES) {
  try {
    const r = await fetch(p, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    for (const m of (await r.text()).matchAll(/\/VI\/_next\/static\/media\/[^"'\s\\)]+\.(?:jpe?g|png|webp)/g)) if (!SKIP.test(m[0])) urls.add(m[0]);
  } catch (e) { console.warn(`Could not read ${p}: ${e.message}`); }
}
let got = 0, had = 0, failed = 0;
const list = [...urls];
for (let i = 0; i < list.length; i += 8) {
  await Promise.all(list.slice(i, i + 8).map(async (u) => {
    const file = path.join(out, path.basename(u));
    if (fs.existsSync(file)) { had++; return; }
    try {
      const r = await fetch("https://www.rockstargames.com" + u, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      got++;
    } catch (e) { failed++; console.warn(`  ${path.basename(u)}: ${e.message}`); }
  }));
}
console.log(`Official images: ${got} new, ${had} already here, ${failed} failed → ${path.relative(process.cwd(), out) || out}`);
console.log("Next: npm run import-official");
