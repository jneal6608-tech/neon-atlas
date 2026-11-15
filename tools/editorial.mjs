#!/usr/bin/env node
// Neon Atlas editorial intelligence. Decides what to publish, update and link next, from the data you have.
//
//   node tools/editorial.mjs report [--date YYYY-MM-DD]     daily report -> reports/daily-<date>.md + reports/dashboard.html
//   node tools/editorial.mjs add-question "text" [--source search|site-search|email|comments|social|reddit] [--count N] [--url U]
//   node tools/editorial.mjs questions                       list the question inbox, grouped and scored
//   node tools/editorial.mjs assign <question-id> <backlog-id|slug>   link a question to a draft/backlog item
//   node tools/editorial.mjs gsc-import <Queries.csv> [Pages.csv]     import a Search Console Performance export
//   node tools/editorial.mjs links                           internal-link opportunities between live pages
//   node tools/editorial.mjs outline <backlog-id> [--ai]     article outline (template, or Claude with --ai)
//   node tools/editorial.mjs draft <backlog-id> [--fetch]    AI-assisted draft, saved with status "drafting" (never published)
//   node tools/editorial.mjs status <slug> <status>          move an article through the pipeline
//   node tools/editorial.mjs live "text" [--confidence confirmed] [--link article:slug|/path] [--link-text "..."]   add a timestamped live update
//   node tools/editorial.mjs prep <backlog-id>...            create launch-ready answer pages (status research) from backlog items
//
// Data that is not available is reported as unavailable. Nothing here invents search volumes.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ROOT, config, loadArticles, isLive, isScheduled, STATUSES, readJSON } from "../src/content.mjs";
import { keywordPriority, expectedCtr, SOURCE_WEIGHT, overlap, tokens } from "../src/scoring.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf("--" + name); return i > -1 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : def; };
const cfg = config();
const today = opt("date") ? new Date(opt("date") + "T12:00:00Z") : new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const writeJSON = (p, d) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(d, null, 1) + "\n");
const QFILE = "data/questions.json";
const loadQ = () => (fs.existsSync(path.join(ROOT, QFILE)) ? readJSON(QFILE) : { questions: [] });
const norm = (s) => tokens(s).sort().join(" ");

function loadGsc() {
  const p = path.join(ROOT, "data/gsc/latest.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

// ---------------- data gathering ----------------
function gather() {
  const all = loadArticles();
  const live = all.filter((a) => isLive(a, today));
  const kw = readJSON("data/keywords.json").keywords.map((k) => ({ ...k, priority: keywordPriority(k) }));
  const backlog = readJSON("data/backlog.json").items;
  const q = loadQ().questions;
  const gsc = loadGsc();
  const launch = new Date(cfg.launchDate + "T00:00:00Z");
  const sinceLaunch = daysBetween(launch, today);
  const launchWindow = sinceLaunch >= -7 && sinceLaunch <= 30;
  const staleDays = launchWindow ? cfg.stalenessDays.launchWindow : cfg.stalenessDays.normal;
  return { all, live, kw, backlog, q, gsc, launch, sinceLaunch, launchWindow, staleDays };
}

// ---------------- analyses ----------------
function staleArticles(d) {
  const out = [];
  for (const a of d.live) {
    const age = daysBetween(new Date(a.lastVerified + "T00:00:00Z"), today);
    const reasons = [];
    if (a.status === "needs-updating") reasons.push("marked needs-updating");
    if (a.reviewBy && a.reviewBy <= iso(today)) reasons.push(`review date ${a.reviewBy} reached`);
    if (age > d.staleDays) reasons.push(`facts last verified ${age} days ago (limit ${d.staleDays} in ${d.launchWindow ? "the launch window" : "normal periods"})`);
    if (a.confidence === "mixed" && d.launchWindow) reasons.push("contains reported (unconfirmed) claims: re-check for official confirmation");
    if (reasons.length) out.push({ a, reasons, score: 60 + (a.featured ? 15 : 0) + (a.status === "needs-updating" ? 20 : 0) + (reasons.length * 3) });
  }
  return out.sort((x, y) => y.score - x.score);
}

function questionClusters(d) {
  const groups = new Map();
  for (const q of d.q) {
    const key = norm(q.text) || q.text.toLowerCase();
    let g = [...groups.values()].find((g) => overlap(g.text, q.text) >= 0.75);
    if (!g) { g = { key, text: q.text, items: [], score: 0, sources: new Set() }; groups.set(key, g); }
    g.items.push(q); g.sources.add(q.source);
    g.score += (q.count || 1) * (SOURCE_WEIGHT[q.source] ?? 1);
  }
  const res = [...groups.values()].map((g) => {
    const match = d.live.map((a) => ({ a, s: Math.max(overlap(g.text, a.title), overlap(g.text, a.targetQuery), ...a.faqs.map((f) => overlap(g.text, f.q))) })).sort((x, y) => y.s - x.s)[0];
    const answered = match && match.s >= 0.6;
    const socialOnly = [...g.sources].every((s) => ["social", "reddit", "forum"].includes(s));
    const assigned = g.items.find((i) => i.assignedTo)?.assignedTo;
    return { ...g, sources: [...g.sources], match: match && match.s >= 0.34 ? match.a : null, answered, socialOnly, assigned };
  });
  return res.sort((x, y) => y.score - x.score);
}

function gscAnalysis(d) {
  if (!d.gsc) return null;
  const gaps = [], ctr = [], striking = [];
  for (const r of d.gsc.queries || []) {
    const best = d.live.map((a) => ({ a, s: Math.max(overlap(r.query, a.targetQuery), overlap(r.query, a.title)) })).sort((x, y) => y.s - x.s)[0];
    if ((!best || best.s < 0.5) && r.impressions >= 20) gaps.push({ ...r, nearest: best && best.s >= 0.25 ? best.a : null });
    if (r.position >= 8 && r.position <= 20 && r.impressions >= 50) striking.push({ ...r, page: best?.a });
  }
  for (const p of d.gsc.pages || []) {
    const exp = expectedCtr(p.position);
    if (p.impressions >= 100 && p.ctr < exp * 0.6) ctr.push({ ...p, expected: exp });
  }
  return { gaps: gaps.sort((a, b) => b.impressions - a.impressions), ctr: ctr.sort((a, b) => b.impressions - a.impressions), striking: striking.sort((a, b) => b.impressions - a.impressions), range: d.gsc.range, importedAt: d.gsc.importedAt };
}

const GENERIC = new Set(["news", "update", "updates", "guide", "price", "online"]);
export function linkOpportunities(live) {
  const out = [];
  for (const a of live) {
    const body = a.body.toLowerCase();
    for (const b of live) {
      if (a === b) continue;
      if (a.body.includes(`article:${b.slug}`) || a.body.includes(b.url)) continue;
      // key phrases that identify b
      const phrases = [b.targetQuery.replace(/^gta 6 /, ""), ...(b.slug === "gta-6-characters" ? ["jason", "lucia"] : []), ...(b.slug === "gta-6-map-leonida-regions" ? ["leonida", "vice city"] : [])].filter((p) => p && p.length > 5 && !GENERIC.has(p));
      const hit = phrases.find((p) => body.includes(p.toLowerCase()));
      if (hit) out.push({ from: a, to: b, phrase: hit });
    }
  }
  return out;
}

function backlogReady(d) {
  const launched = d.sinceLaunch >= 0;
  const kwBy = Object.fromEntries(d.kw.map((k) => [k.query, k]));
  return d.backlog
    .filter((b) => !["published"].includes(b.status))
    .map((b) => {
      const k = kwBy[b.targetQuery];
      const blocked = b.publishable !== "now" && !launched;
      return { ...b, priority: k ? k.priority : 40, blocked, why: blocked ? "needs the game (launches " + cfg.launchDate + ")" : b.publishable === "now" ? "publishable from official sources" : "game is out: verify in-game and publish" };
    })
    .sort((a, b) => (a.blocked - b.blocked) || (b.priority - a.priority));
}

// ---------------- report ----------------
function report() {
  const d = gather();
  const stale = staleArticles(d);
  const qs = questionClusters(d);
  const g = gscAnalysis(d);
  const links = linkOpportunities(d.live);
  const ready = backlogReady(d);
  const scheduled = d.all.filter((a) => isScheduled(a, today));
  const pipeline = Object.fromEntries(STATUSES.map((s) => [s, d.all.filter((a) => a.status === s).length]));

  // Tomorrow's priorities: one ranked list mixing every task type, each with its reason.
  const tasks = [];
  for (const s of stale.slice(0, 5)) tasks.push({ score: s.score, kind: "Update", what: s.a.title, why: s.reasons.join("; "), ref: s.a.file });
  for (const c of qs.filter((c) => !c.answered && !c.socialOnly).slice(0, 5)) tasks.push({ score: 50 + c.score * 4, kind: c.match ? "Expand" : "New answer", what: c.text, why: `${c.items.length} report(s), weight ${c.score} from ${c.sources.join(", ")}${c.match ? `; closest page: ${c.match.slug}` : "; no page answers it"}`, ref: c.assigned || c.match?.file || "" });
  for (const c of qs.filter((c) => !c.answered && c.socialOnly).slice(0, 3)) tasks.push({ score: 30 + c.score * 2, kind: "Watch", what: c.text, why: `social-only signal (${c.sources.join(", ")}): check search data before writing`, ref: "" });
  if (g) {
    for (const x of g.gaps.slice(0, 3)) tasks.push({ score: 55 + Math.min(30, x.impressions / 50), kind: "Content gap", what: x.query, why: `${x.impressions} impressions, ${x.clicks} clicks, no page targets it`, ref: x.nearest?.file || "" });
    for (const x of g.ctr.slice(0, 3)) tasks.push({ score: 50 + Math.min(25, x.impressions / 100), kind: "Rewrite title/description", what: x.page, why: `CTR ${(x.ctr * 100).toFixed(1)}% vs ~${(x.expected * 100).toFixed(0)}% benchmark at position ${x.position.toFixed(1)}`, ref: "" });
    for (const x of g.striking.slice(0, 3)) tasks.push({ score: 48 + Math.min(20, x.impressions / 100), kind: "Improve (positions 8–20)", what: x.query, why: `avg position ${x.position.toFixed(1)}, ${x.impressions} impressions`, ref: x.page?.file || "" });
  }
  for (const b of ready.filter((b) => !b.blocked).slice(0, 4)) tasks.push({ score: 35 + b.priority / 3, kind: "Write", what: b.title, why: `${b.why}; keyword priority ${b.priority}/100; status ${b.status}`, ref: b.id });
  if (links.length) tasks.push({ score: 40, kind: "Internal links", what: `${links.length} unlinked mentions between live pages`, why: "cheap ranking and navigation win; see Internal links section", ref: "" });
  tasks.sort((a, b) => b.score - a.score);

  const L = [];
  L.push(`# Neon Atlas daily editorial report: ${iso(today)}`, "");
  L.push(`Launch: ${cfg.launchDate} (${d.sinceLaunch < 0 ? `${-d.sinceLaunch} days to go` : d.sinceLaunch === 0 ? "launch day" : `day ${d.sinceLaunch} after launch`}). ${d.launchWindow ? `Launch window: facts older than ${d.staleDays} days are flagged.` : ""}`, "");
  L.push(`Pipeline: ${STATUSES.map((s) => `${s} ${pipeline[s]}`).join(" · ")} · live ${d.live.length} · scheduled ${scheduled.length}`, "");
  L.push("## Data used for this report", "");
  L.push(`- Content inventory: ${d.all.length} articles (read from content/articles).`);
  L.push(`- Keyword database: ${d.kw.length} opportunities. Demand levels are **estimates**, not measured volumes.`);
  L.push(`- Question inbox: ${d.q.length} entries.`);
  L.push(g ? `- Search Console: imported ${g.importedAt}${g.range ? ` (${g.range})` : ""}.` : "- Search Console: **not available**. Export Performance → Queries and Pages as CSV and run `node tools/editorial.mjs gsc-import Queries.csv Pages.csv`. No search-performance conclusions are drawn without it.");
  L.push("- Google Analytics: not read by this tool (see docs/ANALYTICS.md for the GA4 explorations to check).", "");
  L.push("## Tomorrow's priorities", "");
  if (!tasks.length) L.push("Nothing urgent. Work down the backlog below.");
  tasks.slice(0, 10).forEach((t, i) => L.push(`${i + 1}. **${t.kind}:** ${t.what}  \n   _${t.why}_${t.ref ? ` (\`${t.ref}\`)` : ""}`));
  L.push("", "## Pages to re-verify", "");
  if (!stale.length) L.push("All live pages are within their verification window.");
  for (const s of stale) L.push(`- **${s.a.title}** (\`${s.a.file}\`): ${s.reasons.join("; ")}`);
  L.push("", "## Reader questions (inbox)", "");
  if (!qs.length) L.push("Inbox empty. Add questions with `node tools/editorial.mjs add-question \"...\" --source search`.");
  for (const c of qs.slice(0, 15)) L.push(`- ${c.answered ? "✅ answered" : c.assigned ? "📝 assigned" : c.socialOnly ? "👀 social only" : "❗ unanswered"} · weight ${c.score} · "${c.text}" (${c.sources.join(", ")})${c.match ? ` → closest: ${c.match.slug}` : ""}${c.assigned ? ` → assigned: ${c.assigned}` : ""}`);
  if (g) {
    L.push("", "## Search Console findings", "", "### Queries with impressions but no page", "");
    for (const x of g.gaps.slice(0, 10)) L.push(`- "${x.query}": ${x.impressions} impr, ${x.clicks} clicks, pos ${x.position.toFixed(1)}`);
    L.push("", "### Under-performing CTR (title/description rewrite candidates)", "");
    for (const x of g.ctr.slice(0, 10)) L.push(`- ${x.page}: CTR ${(x.ctr * 100).toFixed(1)}% at pos ${x.position.toFixed(1)} (benchmark ~${(x.expected * 100).toFixed(0)}%)`);
    L.push("", "### Striking distance (positions 8–20)", "");
    for (const x of g.striking.slice(0, 10)) L.push(`- "${x.query}": pos ${x.position.toFixed(1)}, ${x.impressions} impr`);
  }
  L.push("", "## Backlog: next to write", "");
  for (const b of ready.slice(0, 12)) L.push(`- ${b.blocked ? "⏳" : "▶"} **${b.title}** (${b.id}, priority ${b.priority}): ${b.why}`);
  L.push("", "## Internal links to add", "");
  if (!links.length) L.push("No unlinked mentions found.");
  for (const l of links.slice(0, 15)) L.push(`- In **${l.from.slug}**, link "${l.phrase}" → \`[...](article:${l.to.slug})\``);
  L.push("", "## Scheduled", "");
  for (const a of scheduled) L.push(`- ${a.publishDate}: ${a.title}`);
  if (!scheduled.length) L.push("Nothing scheduled.");
  L.push("", "---", "Scores are heuristics from src/scoring.mjs. They rank work; they are not traffic forecasts.");

  fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  const mdPath = path.join(ROOT, `reports/daily-${iso(today)}.md`);
  fs.writeFileSync(mdPath, L.join("\n") + "\n");
  writeDashboard(d, { stale, qs, g, links, ready, tasks, pipeline, scheduled });
  console.log(L.join("\n"));
  console.log(`\nSaved ${path.relative(ROOT, mdPath)} and reports/dashboard.html`);
}

function writeDashboard(d, r) {
  const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const byCat = {};
  for (const a of d.live) byCat[a.category] = (byCat[a.category] || 0) + 1;
  const gscRows = d.gsc ? [...(d.gsc.pages || [])].sort((a, b) => b.clicks - a.clicks).slice(0, 15) : [];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editorial Dashboard</title>
<style>body{margin:0;background:#0b0e13;color:#e9edf2;font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:2em;color:#3ee0bf}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.kpi{background:#151b24;border:1px solid #263142;border-radius:12px;padding:14px}.kpi b{display:block;font-size:1.6rem}.kpi span{color:#a3afbd;font-size:.85rem}
table{width:100%;border-collapse:collapse;background:#151b24;border-radius:10px;overflow:hidden}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #263142;vertical-align:top}th{background:#1b2330}.muted{color:#a3afbd}.wrap{overflow-x:auto}</style></head><body><main>
<h1>Neon Atlas: editorial dashboard</h1><p class="muted">Generated ${iso(today)} from local data. ${d.gsc ? `Search Console data imported ${esc(d.gsc.importedAt)}.` : "Search Console data not imported yet, so organic performance panels are empty rather than estimated."}</p>
<div class="kpis"><div class="kpi"><b>${d.live.length}</b><span>live articles</span></div><div class="kpi"><b>${r.scheduled.length}</b><span>scheduled</span></div><div class="kpi"><b>${Object.entries(r.pipeline).filter(([s]) => !["published", "needs-updating"].includes(s)).reduce((n, [, v]) => n + v, 0)}</b><span>in pipeline</span></div><div class="kpi"><b>${r.stale.length}</b><span>need re-verifying</span></div><div class="kpi"><b>${r.qs.filter((c) => !c.answered).length}</b><span>open questions</span></div>
${d.gsc ? `<div class="kpi"><b>${d.gsc.totals.clicks}</b><span>search clicks</span></div><div class="kpi"><b>${d.gsc.totals.impressions}</b><span>impressions</span></div><div class="kpi"><b>${(d.gsc.totals.ctr * 100).toFixed(1)}%</b><span>CTR</span></div>` : ""}</div>
<h2>What to do next</h2><div class="wrap"><table><tr><th>#</th><th>Task</th><th>Item</th><th>Why</th></tr>${r.tasks.slice(0, 12).map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.kind)}</td><td>${esc(t.what)}</td><td class="muted">${esc(t.why)}</td></tr>`).join("")}</table></div>
<h2>Top pages (Search Console)</h2>${gscRows.length ? `<div class="wrap"><table><tr><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr>${gscRows.map((p) => `<tr><td>${esc(p.page)}</td><td>${p.clicks}</td><td>${p.impressions}</td><td>${(p.ctr * 100).toFixed(1)}%</td><td>${p.position.toFixed(1)}</td></tr>`).join("")}</table></div>` : `<p class="muted">No data yet. Import a Search Console export.</p>`}
<h2>Content by section</h2><div class="wrap"><table><tr><th>Section</th><th>Live pages</th></tr>${Object.entries(byCat).map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join("")}</table></div>
<h2>Articles</h2><div class="wrap"><table><tr><th>Article</th><th>Status</th><th>Confidence</th><th>Last verified</th><th>Review by</th></tr>${d.all.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.status)}${isScheduled(a, today) ? " (scheduled " + a.publishDate + ")" : ""}</td><td>${esc(a.confidence)}</td><td>${a.lastVerified || "-"}</td><td>${a.reviewBy || "-"}</td></tr>`).join("")}</table></div>
</main></body></html>`;
  fs.writeFileSync(path.join(ROOT, "reports/dashboard.html"), html);
}

// ---------------- questions ----------------
function addQuestion() {
  const text = args[1];
  if (!text) throw new Error('usage: add-question "question text" --source search');
  const source = opt("source", "search");
  if (!(source in SOURCE_WEIGHT)) throw new Error(`unknown source "${source}" (${Object.keys(SOURCE_WEIGHT).join(", ")})`);
  const data = loadQ();
  const id = "q" + String(data.questions.length + 1).padStart(4, "0");
  data.questions.push({ id, text, source, count: Number(opt("count", 1)), url: opt("url", "") || undefined, added: iso(today) });
  writeJSON(QFILE, data);
  console.log(`Added ${id}: "${text}" (${source})`);
}
function assign() {
  const [_, qid, target] = args;
  const data = loadQ();
  const q = data.questions.find((x) => x.id === qid);
  if (!q || !target) throw new Error("usage: assign <question-id> <backlog-id|slug>");
  q.assignedTo = target; writeJSON(QFILE, data);
  console.log(`Assigned ${qid} → ${target}`);
}
function listQuestions() {
  for (const c of questionClusters(gather())) console.log(`${String(c.score).padStart(3)}  ${c.answered ? "answered " : c.socialOnly ? "social   " : "OPEN     "} ${c.text}  [${c.items.map((i) => i.id).join(",")}]${c.match ? "  → " + c.match.slug : ""}`);
}

// ---------------- Search Console import ----------------
function parseCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const split = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}
const num = (v) => Number(String(v).replace(/[%,]/g, "")) || 0;
function gscImport() {
  const [_, qf, pf] = args;
  if (!qf) throw new Error("usage: gsc-import <Queries.csv> [Pages.csv]  (Search Console → Performance → Export → CSV)");
  const queries = parseCsv(qf).map((r) => ({ query: r["top queries"] ?? r.query, clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr) / 100, position: num(r.position) }));
  const pages = pf ? parseCsv(pf).map((r) => ({ page: r["top pages"] ?? r.page, clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr) / 100, position: num(r.position) })) : [];
  const totals = queries.reduce((t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }), { clicks: 0, impressions: 0 });
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  fs.mkdirSync(path.join(ROOT, "data/gsc"), { recursive: true });
  writeJSON("data/gsc/latest.json", { importedAt: iso(today), range: opt("range", ""), source: "Google Search Console export (measured)", totals, queries, pages });
  console.log(`Imported ${queries.length} queries and ${pages.length} pages (measured data). Run: node tools/editorial.mjs report`);
}

// ---------------- pipeline status ----------------
function setStatus() {
  const [_, slug, status] = args;
  if (!STATUSES.includes(status)) throw new Error(`status must be one of: ${STATUSES.join(", ")}`);
  const a = loadArticles().find((x) => x.slug === slug);
  if (!a) throw new Error(`no article "${slug}"`);
  if (status === "published" && !a.sources.length) throw new Error("refusing to publish an article with no sources");
  const file = path.join(ROOT, "content/articles", a.file);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  parsed.data.status = status;
  if (status === "published") { parsed.data.updated = iso(today); parsed.data.publishDate ||= iso(today); }
  fs.writeFileSync(file, matter.stringify(parsed.content, parsed.data));
  console.log(`${slug}: ${a.status} → ${status}`);
}

// ---------------- outlines + AI drafting ----------------
function findBacklog(id) {
  const b = readJSON("data/backlog.json").items.find((x) => x.id === id || x.slug === id);
  if (!b) throw new Error(`no backlog item "${id}"`);
  return b;
}
function templateOutline(b) {
  return [`# ${b.title}`, "", `Target query: ${b.targetQuery} (${b.intent})`, `Publishable: ${b.publishable}`, "", "## Answer first", "One or two sentences that answer the query, with the confidence label.", "", ...b.outline.map((o) => `## ${o}\n- Facts needed:\n- Source for each fact:\n`), "## Sources", ...(b.verifiedSources.length ? b.verifiedSources.map((s) => `- ${s}`) : ["- (none yet: requires in-game verification)"]), "", `Original value: ${b.originalValue}`].join("\n");
}

async function claude(system, user) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("AI features need an Anthropic API key in ANTHROPIC_API_KEY (server-side only, never in the website). See docs/AI-EDITORIAL.md.");
  }
  let Anthropic;
  try { ({ default: Anthropic } = await import("@anthropic-ai/sdk")); } catch { throw new Error("Install the SDK first: npm install @anthropic-ai/sdk"); }
  const client = new Anthropic();
  // Streaming avoids timeouts on long drafts; server-side fallback re-runs a declined request on another model.
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (msg.stop_reason === "max_tokens") console.warn("Warning: the draft hit the length limit and may be cut off.");
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

const EDITORIAL_SYSTEM = `You help the editors of Neon Atlas, an independent, unofficial GTA VI guide (not affiliated with Rockstar Games or Take-Two).
Rules you must follow:
- Use ONLY facts that appear in the SOURCE MATERIAL provided. Do not use your own memory of GTA VI or earlier GTA games as fact.
- Never invent features, missions, locations, mechanics, prices, dates or quotes. If the sources don't answer something, say so in the draft and list it under "Needs verification".
- Label claims: official Rockstar or platform sources = confirmed; other outlets = reported (say so in the text). Predictions must be marked as predictions.
- After every factual sentence, cite the source like [S1], [S2] matching the numbered sources.
- Answer the target question in the first two sentences. Use plain, direct language, short paragraphs, and H2 headings that match real questions.
- Write in Markdown with no H1 (the page title is separate). Use callouts like "> [!CONFIRMED]", "> [!REPORTED]", "> [!UNCONFIRMED]", "> [!PREDICTED]" where they help readers.
- End with a section "## Needs verification" listing every claim an editor must check before publishing, and any question the sources could not answer.`;

async function fetchSourceText(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "text/html" } });
    const t = await r.text();
    return t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20000);
  } catch (e) { return `(could not fetch: ${e.message})`; }
}

async function outline() {
  const b = findBacklog(args[1]);
  if (!opt("ai")) { console.log(templateOutline(b)); return; }
  const out = await claude(EDITORIAL_SYSTEM, `Create a detailed article outline (not a draft) for:\nTitle: ${b.title}\nTarget query: ${b.targetQuery}\nIntent: ${b.intent}\nStarting outline: ${b.outline.join(" | ")}\nOriginal value we aim for: ${b.originalValue}\nFor each section, list the facts needed and whether the available sources (${b.verifiedSources.join(", ") || "none"}) can supply them.`);
  console.log(out);
}

async function draft() {
  const b = findBacklog(args[1]);
  const slug = b.slug || b.targetQuery.replace(/[^a-z0-9]+/g, "-");
  const file = path.join(ROOT, "content/articles", slug + ".md");
  if (fs.existsSync(file) && matter(fs.readFileSync(file, "utf8")).data.status === "published") throw new Error(`${slug} is already published; edit it directly instead of overwriting.`);
  const notes = opt("notes") && fs.existsSync(opt("notes")) ? fs.readFileSync(opt("notes"), "utf8") : "";
  if (!b.verifiedSources.length && !notes) throw new Error("No verified sources for this item. Add sources to the backlog item, or pass --notes <file> with your own verified in-game notes.");
  const sources = [];
  for (const [i, u] of b.verifiedSources.entries()) sources.push(`[S${i + 1}] ${u}\n${opt("fetch") ? await fetchSourceText(u) : "(not fetched: run with --fetch to include the page text)"}`);
  if (notes) sources.push(`[S${sources.length + 1}] Editor's verified notes\n${notes}`);
  const text = await claude(EDITORIAL_SYSTEM, `Draft the article.\nTitle: ${b.title}\nTarget query: ${b.targetQuery}\nIntent: ${b.intent}\nOutline: ${b.outline.join(" | ")}\nOriginal value: ${b.originalValue}\n\nSOURCE MATERIAL:\n${sources.join("\n\n")}`);
  const fm = { title: b.title, description: `TODO: 150-160 character description answering "${b.targetQuery}".`, category: "guides", status: "drafting", confidence: "unconfirmed", targetQuery: b.targetQuery, sources: b.verifiedSources.map((u) => ({ type: /rockstargames|playstation|xbox|esrb/.test(u) ? "official" : "reported", title: u, url: u })), aiAssisted: true };
  fs.writeFileSync(file, matter.stringify(`<!-- AI-ASSISTED DRAFT (${iso(today)}). Not published. An editor must verify every [S#] claim, remove the citation markers, set category/description/confidence, and move it to fact-checking. -->\n\n${text}\n`, fm));
  console.log(`Draft saved to content/articles/${slug}.md with status "drafting". It will not appear on the site until an editor publishes it.`);
}

// ---------------- live updates + launch prep ----------------
function live() {
  const text = args[1];
  if (!text) throw new Error('usage: live "what happened" --confidence confirmed --link article:slug');
  const conf = opt("confidence", "confirmed");
  if (!["confirmed", "mixed", "unconfirmed", "predicted"].includes(conf)) throw new Error("confidence must be confirmed, mixed, unconfirmed or predicted");
  const data = readJSON("data/live.json");
  const e = { time: new Date().toISOString(), text, confidence: conf };
  if (opt("link")) e.link = opt("link");
  if (opt("link-text")) e.linkText = opt("link-text");
  data.entries.push(e);
  writeJSON("data/live.json", data);
  console.log(`Live update added at ${e.time}. Build + push (or run tools/ship.mjs) to publish it.`);
}
function prep() {
  const ids = args.slice(1);
  if (!ids.length) throw new Error("usage: prep <backlog-id> [<backlog-id>...]");
  const CAT = { "gta 6 controls": "gameplay", "gta 6 best settings": "guides", "gta 6 how to save": "gameplay", "gta 6 how to switch characters": "gameplay", "gta 6 beginner tips": "guides", "gta 6 mission list": "missions", "gta 6 stuck on loading screen": "guides", "gta 6 servers down": "news", "gta 6 how long to beat": "gameplay", "gta 6 how to make money": "gameplay", "gta 6 wanted level": "gameplay", "gta 6 cheats": "gameplay" };
  for (const id of ids) {
    const b = findBacklog(id);
    const slug = b.slug || b.targetQuery.replace(/^gta 6 /, "gta-6-").replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const file = path.join(ROOT, "content/articles", slug + ".md");
    if (fs.existsSync(file)) { console.log(`exists: ${slug}`); continue; }
    const fm = { title: b.title, description: `TODO: 150–160 characters that answer "${b.targetQuery}".`, answer: "TODO: the answer in 1–2 sentences, written the moment it's verified.", category: CAT[b.targetQuery] || "guides", status: "research", confidence: "confirmed", targetQuery: b.targetQuery, publishDate: cfg.launchDate, sources: [] };
    const body = `<!-- RESEARCH: launch-ready skeleton. Fill the answer first, verify on console, add sources, remove this comment, then: node tools/ship.mjs ${slug} --live "..." -->\n\n**TODO: answer-first opening sentence.**\n\n${b.outline.map((o) => `## ${o}\n\nTODO\n`).join("\n")}\n## Verification checklist\n\n- [ ] Verified on PS5\n- [ ] Verified on Xbox Series X|S\n- [ ] Game version noted\n- [ ] Sources added (official page, or our own gameplay notes)\n`;
    fs.writeFileSync(file, matter.stringify(body, fm));
    const data = readJSON("data/backlog.json"); const item = data.items.find((x) => x.id === b.id); item.slug = slug; item.status = "research"; writeJSON("data/backlog.json", data);
    console.log(`created content/articles/${slug}.md (research, not public)`);
  }
}

// ---------------- dispatch ----------------
const commands = { report, "add-question": addQuestion, questions: listQuestions, assign, "gsc-import": gscImport, links: () => { for (const l of linkOpportunities(loadArticles().filter((a) => isLive(a, today)))) console.log(`${l.from.slug}: "${l.phrase}" → article:${l.to.slug}`); }, outline, draft, status: setStatus, live, prep };
if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).join("\n").replace(/^\/\/ ?/gm, "")); process.exit(cmd ? 1 : 0); }
try { await commands[cmd](); } catch (e) { console.error("Error: " + e.message); process.exit(1); }
