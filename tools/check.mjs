#!/usr/bin/env node
// Static quality gate for dist/. Run after a build: node tools/check.mjs
// Checks every page for: title, meta description, canonical, Open Graph, exactly one h1, heading order,
// valid JSON-LD, image alt text, broken internal links/anchors; plus sitemap, robots.txt, feed, search index,
// unpublished content leaking, and secrets in the output. Exits non-zero on any error.
import fs from "node:fs";
import path from "node:path";
import { ROOT, config, loadArticles, isLive } from "../src/content.mjs";

const DIST = path.join(ROOT, "dist");
const cfg = config();
const errors = [], warns = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warns.push(`${f}: ${m}`);

const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== "admin") walk(p); } else files.push(p); } })(DIST);
const html = files.filter((f) => f.endsWith(".html"));
const urlOf = (f) => "/" + path.relative(DIST, f).replace(/index\.html$/, "").replace(/\\/g, "/");
const pages = new Map(html.map((f) => [urlOf(f), fs.readFileSync(f, "utf8")]));
const ids = new Map([...pages].map(([u, h]) => [u, new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));

let links = 0;
for (const [u, h] of pages) {
  const f = u || "/";
  const title = h.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) err(f, "missing <title>"); else if (title.length > 70 && u !== "/") warn(f, `title is ${title.length} chars (Google shows ~60)`);
  const desc = h.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const noindex = /name="robots" content="noindex/.test(h);
  if (!desc) err(f, "missing meta description"); else if (!noindex && (desc.length < 70 || desc.length > 175)) warn(f, `meta description is ${desc.length} chars (aim 120–160)`);
  if (!/<link rel="canonical" href="https?:\/\/[^"]+"/.test(h)) err(f, "missing absolute canonical");
  for (const p of ["og:title", "og:description", "og:url", "og:image", "og:type"]) if (!h.includes(`property="${p}"`)) err(f, `missing ${p}`);
  const h1 = (h.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) err(f, `${h1} <h1> elements (need exactly 1)`);
  let last = 1;
  for (const m of h.replace(/<footer[\s\S]*<\/footer>/, "").matchAll(/<h([1-6])[\s>]/g)) { const lv = +m[1]; if (lv > last + 1) warn(f, `heading jumps from h${last} to h${lv}`); last = lv; }
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { err(f, "invalid JSON-LD"); } }
  for (const m of h.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) err(f, "image without alt attribute");
  if (!h.includes("not affiliated with")) err(f, "missing unofficial / not-affiliated disclaimer");
  if (!/<html lang="/.test(h)) err(f, "missing <html lang>");
  if (!h.includes('name="viewport"')) err(f, "missing viewport meta");
  for (const m of h.matchAll(/\shref="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    links++;
    const [p, hash] = href.split("#");
    const target = p === "" ? u : p;
    if (target.startsWith("/assets/") || target.endsWith(".xml") || target.endsWith(".json") || target.endsWith(".svg")) {
      if (!fs.existsSync(path.join(DIST, target))) err(f, `broken asset link ${href}`);
      continue;
    }
    if (!target.startsWith("/")) { err(f, `relative link in production build: ${href}`); continue; }
    if (!pages.has(target)) { err(f, `broken link ${href}`); continue; }
    if (hash && !ids.get(target).has(hash)) err(f, `broken anchor ${href}`);
  }
}

// sitemap: every indexable page and nothing else
const sm = fs.readFileSync(path.join(DIST, "sitemap.xml"), "utf8");
const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(cfg.url.replace(/\/$/, ""), ""));
for (const s of smUrls) { if (!pages.has(s)) err("sitemap.xml", `lists missing page ${s}`); else if (/name="robots" content="noindex/.test(pages.get(s))) err("sitemap.xml", `lists noindex page ${s}`); }
for (const [u, h] of pages) if (!/noindex/.test(h) && !u.endsWith(".html") && !smUrls.includes(u)) err("sitemap.xml", `indexable page missing: ${u}`);
if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm)) err("sitemap.xml", "no lastmod dates");

const robots = fs.readFileSync(path.join(DIST, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${cfg.url.replace(/\/$/, "")}/sitemap.xml`)) err("robots.txt", "missing sitemap line");
if (/Disallow: \/\s*$/m.test(robots)) err("robots.txt", "blocks the whole site");

// unpublished content must not leak
const now = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();
for (const a of loadArticles()) {
  const built = pages.has(a.url);
  if (isLive(a, now) && !built) err(a.file, "live article was not built");
  if (!isLive(a, now) && built) err(a.file, `not-live article (${a.status}) was published`);
}
const idx = JSON.parse(fs.readFileSync(path.join(DIST, "search-index.json"), "utf8"));
for (const e of idx) if (!pages.has(e.u)) err("search-index.json", `points to missing page ${e.u}`);
if (!/<rss/.test(fs.readFileSync(path.join(DIST, "feed.xml"), "utf8"))) err("feed.xml", "not an RSS feed");

// secrets in the public output
for (const f of files) {
  if (!/\.(html|js|json|css|xml|txt)$/.test(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  if (/sk-ant-[a-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|ghp_[0-9A-Za-z]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(t)) err(path.relative(DIST, f), "looks like a secret/API key in public output");
}

console.log(`Checked ${pages.size} pages, ${links} internal links, ${smUrls.length} sitemap URLs, ${idx.length} search entries.`);
if (warns.length) { console.log(`\n${warns.length} warning(s):`); for (const w of warns) console.log("  ! " + w); }
if (errors.length) { console.log(`\n${errors.length} error(s):`); for (const e of errors) console.log("  ✗ " + e); process.exit(1); }
console.log("\nAll static checks passed.");
