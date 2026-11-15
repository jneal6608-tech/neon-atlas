#!/usr/bin/env node
// Watches Rockstar's official GTA VI pages and reports what changed, so a new announcement reaches the site first.
//   node tools/watch-official.mjs          check now; prints added/removed lines; updates data/watch-state.json
// In CI (.github/workflows/watch.yml) it runs every 15 minutes. Changes are written to reports/watch-changes.json,
// which tools/auto-update.mjs turns into live-feed entries (only what Rockstar's own pages now say).
// The snapshot file is only rewritten when a page's text actually changes, so quiet checks make no commits.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/content.mjs";

const TARGETS = [
  { id: "vi", name: "GTA VI official site", url: "https://www.rockstargames.com/VI" },
  { id: "editions", name: "GTA VI editions page", url: "https://www.rockstargames.com/VI/editions" },
  { id: "leonida", name: "Only in Leonida (characters & places)", url: "https://www.rockstargames.com/VI/only-in-leonida" },
  { id: "store", name: "Rockstar Store GTA VI page + FAQ", url: "https://store.rockstargames.com/game/buy-gta-vi", mode: "json-values" },
  { id: "newswire", name: "Rockstar Newswire", url: "https://www.rockstargames.com/newswire" },
  { id: "support", name: "Rockstar Support: GTA VI platforms & editions", url: "https://support.rockstargames.com/articles/4QfG4FmZCf5W1gS8jy4UVT/grand-theft-auto-vi-platform-editions-and-versions" },
];
const STATE = path.join(ROOT, "data/watch-state.json");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const decode = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\u0026/g, "&");

function extract(html, mode) {
  let lines = [];
  if (mode === "json-values") lines = [...html.matchAll(/"value":"((?:[^"\\]|\\.){20,})"/g)].map((m) => m[1]);
  const vis = html.replace(/<(script|style|svg|noscript)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, "\n");
  lines = lines.concat(vis.split("\n"));
  // headline-like strings embedded in page data (newswire titles, dates)
  lines = lines.concat([...html.matchAll(/"(?:title|headline|name)":"([^"]{12,160})"/g)].map((m) => m[1]).filter((t) => /VI|GTA|Grand Theft|Leonida|Vice City/i.test(t)));
  return [...new Set(lines.map((l) => decode(l).replace(/\s+/g, " ").trim()).filter((l) => l.length > 3 && l.length < 600 && !/^[\d\s.,:%-]+$/.test(l)))].sort();
}

const changes = [];
const failures = [];
for (const t of TARGETS) {
  try {
    const r = await fetch(t.url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lines = extract(await r.text(), t.mode);
    if (lines.length < 5) throw new Error("page returned almost no text");
    const prev = state[t.id];
    if (prev) {
      const old = new Set(prev.lines), now = new Set(lines);
      const added = lines.filter((l) => !old.has(l)), removed = prev.lines.filter((l) => !now.has(l));
      if (added.length || removed.length) changes.push({ ...t, added, removed });
    }
    if (!prev || changes.some((c) => c.id === t.id)) state[t.id] = { lines, checked: new Date().toISOString(), url: t.url };
  } catch (e) { failures.push(`${t.name}: ${e.message}`); }
}
fs.writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n");
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports/watch-changes.json"), JSON.stringify({ checked: new Date().toISOString(), changes: changes.map(({ id, name, url, added, removed }) => ({ id, name, url, added, removed })), failures }, null, 1) + "\n");

let md = "";
for (const c of changes) {
  md += `### ${c.name}\n${c.url}\n\n`;
  if (c.added.length) md += `**New text (${c.added.length}):**\n${c.added.slice(0, 25).map((l) => `- ${l}`).join("\n")}\n\n`;
  if (c.removed.length) md += `**Removed text (${c.removed.length}):**\n${c.removed.slice(0, 15).map((l) => `- ~~${l}~~`).join("\n")}\n\n`;
}
if (changes.length) {
  md = `Rockstar changed ${changes.length} official page(s). Verify, then update the affected guides and the live feed (\`node tools/ship.mjs <slug> --live "..."\`).\n\n${md}`;
  fs.writeFileSync(path.join(ROOT, "reports/watch-latest.md"), md);
  console.log(md);
} else console.log(`No changes on ${TARGETS.length - failures.length} page(s) checked.${Object.keys(state).length && !changes.length ? "" : ""}`);
if (failures.length) console.log(`Could not check: ${failures.join("; ")}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changes.length ? "true" : "false"}\n`);
