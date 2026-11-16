#!/usr/bin/env node
// Today's pages to request in Google Search Console (URL Inspection → Request indexing; Google allows ~10 a day).
//   npm run index-today            (builds first, so the list reflects the latest content)
// First pass (the first few days from START): every page once, most important first, 10 a day.
// After that: only pages that changed in the last day, most important first. Requesting speeds up crawling of new
// and changed pages; it doesn't change rankings, and re-requesting an unchanged page does nothing, so on quiet
// days the list is short (or empty) on purpose.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/content.mjs";

const LIMIT = 10;
const START = new Date("2026-11-16T00:00:00Z"); // the day the site was added to Search Console
const SKIP = /^\/(about|contact|privacy|affiliate-disclosure|editorial-standards)\/$/; // Google finds these via the sitemap
// Most important first: the pages people search for most during launch week.
const PRIORITY = ["/", "/news/gta-6-launch-live/", "/guides/gta-6-release-date-time/", "/guides/gta-6-pre-load-guide/", "/theories/", "/news/gta-6-launch-week-everything-confirmed/", "/guides/gta-6-physical-copy-no-disc/", "/guides/gta-6-editions-standard-vs-ultimate/", "/characters/gta-6-characters/", "/locations/gta-6-map-leonida-regions/"];

const sm = fs.readFileSync(path.join(ROOT, "dist/sitemap.xml"), "utf8");
const now = process.env.TODAY ? new Date(process.env.TODAY + "T12:00:00Z") : new Date();
const pathOf = (u) => new URL(u).pathname;
const rank = (u) => { const p = pathOf(u); const i = PRIORITY.indexOf(p); return i > -1 ? i : p.split("/").length > 3 ? 100 : 200; }; // then articles, then section pages
const pages = [...sm.matchAll(/<loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)]
  .map((m) => ({ url: m[1], mod: m[2] ? new Date(m[2].length === 10 ? m[2] + "T23:59:59Z" : m[2]) : null }))
  .filter((p) => !SKIP.test(pathOf(p.url)))
  .sort((a, b) => rank(a.url) - rank(b.url));

const dayN = Math.floor((now - START) / 864e5);
const passDays = Math.ceil(pages.length / LIMIT);
const changedSince = (ms) => pages.filter((p) => p.mod && now - p.mod < ms);
let today, note;
if (dayN >= 0 && dayN < passDays) {
  const slice = pages.slice(dayN * LIMIT, dayN * LIMIT + LIMIT);
  const redo = changedSince(864e5).filter((p) => pages.indexOf(p) < dayN * LIMIT); // already requested, changed since
  today = [...redo.map((p) => ({ ...p, why: "changed since you requested it" })), ...slice.map((p) => ({ ...p, why: "" }))].slice(0, LIMIT);
  note = `First pass, day ${dayN + 1} of ${passDays}: getting every page in front of Google once.`;
} else {
  today = changedSince(864e5).slice(0, LIMIT).map((p) => ({ ...p, why: "changed in the last day" }));
  note = today.length ? "Only pages that changed in the last day: requesting unchanged pages doesn't help." : "Nothing changed in the last day, so there's nothing to request today. Google already has every page.";
}

console.log(`Google indexing requests for ${now.toISOString().slice(0, 10)}: ${today.length} page${today.length === 1 ? "" : "s"}`);
console.log(note + "\n");
if (today.length) {
  console.log("Search Console → paste each URL into the search bar at the top → Request indexing:\n");
  today.forEach((p, i) => console.log(`${i + 1}. ${p.url}${p.why ? `   (${p.why})` : ""}`));
}
console.log("\nBing updates automatically (IndexNow), so there's nothing to do there.");
