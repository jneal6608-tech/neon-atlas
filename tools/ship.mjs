#!/usr/bin/env node
// From "verified" to "live and pinged" in one command. Use it the moment an answer is confirmed.
//   node tools/ship.mjs <slug> [--note "what changed"] [--live "text for the live feed"] [--confidence confirmed|mixed|unconfirmed] [--no-push]
// Steps: validate → stamp published/updatedAt/lastVerified + update log → (optional) live-feed entry → picture
// check → build + checks → git commit + push (CI deploys, then pings IndexNow).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";
import { ROOT, loadArticles } from "../src/content.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf("--" + n); return i > -1 ? args[i + 1] : undefined; };
const slug = args[0];
const sh = (c) => execSync(c, { cwd: ROOT, stdio: "inherit" });
const a = loadArticles().find((x) => x.slug === slug);
if (!a) { console.error(`No article "${slug}". Create it first (node tools/editorial.mjs prep <backlog-id>).`); process.exit(1); }
const file = path.join(ROOT, "content/articles", a.file);
const doc = matter(fs.readFileSync(file, "utf8"));
const problems = [];
if (!doc.data.answer || /TODO/.test(doc.data.answer)) problems.push("needs a real `answer` (1–2 sentence quick answer)");
if (!(doc.data.sources || []).length) problems.push("needs at least one source");
if (/TODO|<!-- RESEARCH|<!-- FACT-CHECKING/.test(doc.content)) problems.push("body still contains TODO / research notes");
if (/\[S\d+\]/.test(doc.content)) problems.push("body still contains AI citation markers like [S1]");
if (/^description: .*TODO/m.test(fs.readFileSync(file, "utf8"))) problems.push("description is still a TODO");
if (problems.length) { console.error(`Not shipping ${slug}:\n - ${problems.join("\n - ")}`); process.exit(1); }
const now = new Date();
const day = now.toISOString().slice(0, 10);
if (!["published", "needs-updating"].includes(doc.data.status)) doc.data.publishedAt = now.toISOString(); // exact first-publish time (Recent news)
doc.data.status = "published";
doc.data.updatedAt = now.toISOString();
doc.data.updated = day;
doc.data.lastVerified = day;
doc.data.publishDate ||= day;
if (new Date(doc.data.publishDate) > now) doc.data.publishDate = day; // shipping now means live now
if (opt("confidence")) doc.data.confidence = opt("confidence");
const note = opt("note") || (a.status === "published" || a.status === "needs-updating" ? "Updated and re-verified." : "Published.");
doc.data.updateLog = [...(doc.data.updateLog || []), { date: day, note }];
fs.writeFileSync(file, matter.stringify(doc.content, doc.data));
console.log(`✓ ${slug}: published, stamped ${now.toISOString()}`);
if (opt("live")) sh(`node tools/editorial.mjs live ${JSON.stringify(opt("live"))} --confidence ${opt("confidence") || doc.data.confidence || "confirmed"} --link article:${slug}`);
// Pictures: real GTA VI images only (official Rockstar media or our own screenshots in assets/ours/art). Never generated art.
if (!["official/art", "ours/art"].some((d) => fs.existsSync(path.join(ROOT, `assets/${d}/${slug}.jpg`)))) console.warn(`! ${slug} has no picture yet: add our own screenshot as assets/ours/art/${slug}.jpg (+ -card, -share), or an official image. Never generated art.`);
sh("node src/build.mjs");
sh("node tools/check.mjs");
if (args.includes("--no-push")) { console.log("Built and checked. Not pushed (--no-push)."); process.exit(0); }
try {
  sh(`git add -A content data assets/ours && git commit -q -m ${JSON.stringify(`Ship ${slug}: ${note}`)}`);
  sh("git push -q");
  console.log("✓ Pushed. The deploy workflow goes live in ~2 minutes and pings IndexNow.\n  For Google: Search Console → URL Inspection → paste the URL → Request indexing.");
} catch { console.error("! git commit/push failed. The site is built in dist/; push manually."); process.exit(1); }
