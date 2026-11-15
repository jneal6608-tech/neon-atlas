#!/usr/bin/env node
// Self-updating live feed. Runs right after tools/watch-official.mjs (every 15 minutes in .github/workflows/watch.yml).
//   node tools/auto-update.mjs            turn reports/watch-changes.json into live-feed entries in data/live.json
//   node tools/auto-update.mjs --dry-run  show what would be published, change nothing
// Claude reads only the text Rockstar added to or removed from its own official pages and decides whether it is real
// news for GTA VI players. Entries state only what those official pages now say (so they are labelled "confirmed"),
// name the page, and link the most relevant guide. Cosmetic changes (cookie banners, menus, reordering) are skipped.
// Needs ANTHROPIC_API_KEY (a GitHub Actions secret; never in the website). Without it, nothing is published.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadArticles, isLive, readJSON } from "../src/content.mjs";

const DRY = process.argv.includes("--dry-run");
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const report = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/watch-changes.json"), "utf8"));
if (!report.changes.length) { console.log("No official-page changes: nothing to publish."); out("published", "false"); process.exit(0); }
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log("Official pages changed, but ANTHROPIC_API_KEY is not set, so nothing was published automatically.");
  out("published", "false"); out("needs_review", "true"); process.exit(0);
}

const now = new Date();
const live = loadArticles().filter((a) => isLive(a, now));
const slugs = new Set(live.map((a) => a.slug));
const feedFile = path.join(ROOT, "data/live.json");
const feed = readJSON("data/live.json");
const recent = feed.entries.slice().sort((x, y) => String(y.time).localeCompare(String(x.time))).slice(0, 8);

const SYSTEM = `You maintain the live-updates feed of Neon Atlas, an independent, unofficial GTA VI guide (not affiliated with Rockstar Games).
You are given the lines of text that were ADDED to or REMOVED from Rockstar's own official GTA VI web pages since the last check 15 minutes ago.
Decide whether the change is real news for GTA VI players (new or changed dates, times, prices, editions, platforms, pre-load or download details, patches, server status, new trailers or screenshots, new characters or places, new Newswire posts about GTA VI, support answers). Ignore cosmetic or navigation changes: cookie and legal text, menus, footer links, button labels, reordering, other games, store promos unrelated to GTA VI, and anything already covered by the recent entries listed.
Rules for each entry you write:
- State ONLY what the added/removed official text says. Never use your own knowledge of GTA VI, never guess or speculate, never add numbers or details that are not in the text.
- Attribute it to the page, e.g. "Rockstar's GTA VI editions page now lists ..." or "New on Rockstar Newswire: ...".
- One or two plain sentences, at most 260 characters. Markdown **bold** is allowed for the key fact. No links, no emoji, no hype.
- link_slug: the slug of the most relevant guide from the list provided, or "" if none fits.
- link_text: a short call to action ending in " →", e.g. "Editions explained →", or "" when link_slug is "".
Write at most 2 entries. If nothing qualifies, set publish to false and return an empty entries array.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["publish", "reason", "entries"],
  properties: {
    publish: { type: "boolean" },
    reason: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "source_page", "link_slug", "link_text"],
        properties: { text: { type: "string" }, source_page: { type: "string", enum: report.changes.map((c) => c.name) }, link_slug: { type: "string" }, link_text: { type: "string" } },
      },
    },
  },
};

const clip = (arr, n) => arr.slice(0, n).map((l) => `  + ${l.slice(0, 400)}`).join("\n");
const user = `CHANGES (checked ${report.checked}):
${report.changes.map((c) => `## ${c.name} (${c.url})\nADDED:\n${clip(c.added, 40) || "  (none)"}\nREMOVED:\n${clip(c.removed, 25).replace(/\+/g, "-") || "  (none)"}`).join("\n\n")}

RECENT LIVE ENTRIES (do not repeat these):
${recent.map((e) => `- ${e.time}: ${e.text}`).join("\n")}

GUIDES YOU CAN LINK (slug: title):
${live.map((a) => `- ${a.slug}: ${a.title}`).join("\n")}`;

let Anthropic;
try { ({ default: Anthropic } = await import("@anthropic-ai/sdk")); } catch { console.error("Install the SDK first: npm install @anthropic-ai/sdk"); process.exit(1); }
const client = new Anthropic();
let msg;
try {
  msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError) console.error("ANTHROPIC_API_KEY was rejected.");
  else if (e instanceof Anthropic.RateLimitError) console.error("Rate limited; the next 15-minute run will retry.");
  else if (e instanceof Anthropic.APIError) console.error(`Claude API error ${e.status}: ${e.message}`);
  else console.error(`Could not reach the Claude API: ${e.message}`);
  out("published", "false"); out("needs_review", "true"); process.exit(0);
}
if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
  console.log(`No entry written (stop reason: ${msg.stop_reason}).`); out("published", "false"); out("needs_review", "true"); process.exit(0);
}
const decision = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
console.log(`Claude: ${decision.publish ? "publish" : "skip"}. ${decision.reason}`);

// Guard rails on top of the prompt: length, no links or HTML, a real guide slug, no duplicates, at most 2 per run.
const known = new Set(feed.entries.map((e) => e.text.trim().toLowerCase()));
const entries = (decision.publish ? decision.entries : []).slice(0, 2).filter((e) => {
  const t = e.text.trim();
  const ok = t.length >= 20 && t.length <= 300 && !/<|https?:|\]\(/.test(t) && !known.has(t.toLowerCase());
  if (!ok) console.log(`Rejected entry: ${t}`);
  return ok;
});
if (!entries.length) { out("published", "false"); process.exit(0); }

const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
for (const e of entries) {
  const src = report.changes.find((c) => c.name === e.source_page) || report.changes[0];
  const entry = { time: stamp, text: e.text.trim(), confidence: "confirmed", auto: true, source: src.name, sourceUrl: src.url };
  if (slugs.has(e.link_slug)) { entry.link = `article:${e.link_slug}`; if (e.link_text) entry.linkText = e.link_text; }
  console.log(`${DRY ? "Would publish" : "Published"}: ${entry.text}`);
  feed.entries.push(entry);
}
if (!DRY) fs.writeFileSync(feedFile, JSON.stringify(feed, null, 1) + "\n");
out("published", DRY ? "false" : "true");
out("summary", entries.map((e) => e.text.trim()).join(" | ").replace(/\n/g, " ").slice(0, 200));
