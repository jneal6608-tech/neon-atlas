#!/usr/bin/env node
// Tells Bing (which powers ChatGPT search's web results), Yandex, Seznam and other IndexNow engines
// that pages changed, so they re-crawl in minutes instead of days. Google does not use IndexNow:
// for Google, use Search Console → URL Inspection → Request indexing on your most important updates.
//   node tools/indexnow.mjs            submit pages whose sitemap lastmod is within the last 36 hours
//   node tools/indexnow.mjs --all      submit every URL in the sitemap
//   node tools/indexnow.mjs <url>...   submit specific URLs
// The key is public by design (it's served at /<key>.txt), so it can live in site.config.json.
import fs from "node:fs";
import path from "node:path";
import { ROOT, config } from "../src/content.mjs";

const cfg = config();
if (!cfg.indexNowKey) { console.error("Set indexNowKey in site.config.json"); process.exit(1); }
const site = new URL(cfg.url);
if (/pages\.dev$/.test(site.hostname) && !process.env.INDEXNOW_FORCE) console.warn("Note: submitting a *.pages.dev address. Set your real domain in site.config.json first if you have one.");
const sm = fs.readFileSync(path.join(ROOT, "dist/sitemap.xml"), "utf8");
const entries = [...sm.matchAll(/<loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ url: m[1], mod: m[2] ? new Date(m[2].length === 10 ? m[2] + "T23:59:59Z" : m[2]) : null }));
const args = process.argv.slice(2);
let urls = args.filter((a) => a.startsWith("http"));
if (!urls.length) urls = args.includes("--all") ? entries.map((e) => e.url) : entries.filter((e) => e.mod && Date.now() - e.mod < 36 * 3600e3).map((e) => e.url);
if (!urls.length) { console.log("No recently changed URLs to submit."); process.exit(0); }
const body = { host: site.hostname, key: cfg.indexNowKey, keyLocation: `${site.origin}/${cfg.indexNowKey}.txt`, urlList: urls.slice(0, 10000) };
const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
console.log(`IndexNow: submitted ${urls.length} URL(s) → HTTP ${r.status} ${r.status === 200 || r.status === 202 ? "(accepted)" : await r.text()}`);
if (r.status >= 400 && r.status !== 422) process.exit(1);
