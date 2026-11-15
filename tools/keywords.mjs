#!/usr/bin/env node
// Keyword database: ranked view and CSV export.
//   node tools/keywords.mjs            ranked table (priority 0–100, see src/scoring.mjs)
//   node tools/keywords.mjs csv        writes data/keywords.csv (for Sheets/Excel)
//   node tools/keywords.mjs gaps       opportunities with no article yet
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON, loadArticles } from "../src/content.mjs";
import { keywordPriority } from "../src/scoring.mjs";

const db = readJSON("data/keywords.json");
const slugs = new Set(loadArticles().map((a) => a.slug));
const rows = db.keywords.map((k) => ({ ...k, priority: keywordPriority(k) })).sort((a, b) => b.priority - a.priority);
const mode = process.argv[2];

if (mode === "csv") {
  const cols = ["id", "query", "stage", "intent", "demand_level", "demand_basis", "competition_level", "competition_basis", "likelihood_1to5", "verifiable", "opportunity_1to5", "priority_0to100", "format", "covered_by", "notes"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...rows.map((k) => [k.id, k.query, k.stage, k.intent, k.demand.level, k.demand.basis, k.competition.level, k.competition.basis, k.likelihood, k.verifiable, k.opportunity, k.priority, k.format, k.coveredBy, k.notes].map(q).join(","))];
  fs.writeFileSync(path.join(ROOT, "data/keywords.csv"), lines.join("\n") + "\n");
  console.log(`Wrote data/keywords.csv (${rows.length} rows). Demand/competition are labelled estimates or observations, not volumes.`);
} else {
  const list = mode === "gaps" ? rows.filter((k) => !k.coveredBy || !slugs.has(k.coveredBy)) : rows;
  console.log("prio  stage        verify        query");
  for (const k of list) console.log(`${String(k.priority).padStart(4)}  ${k.stage.padEnd(12)} ${k.verifiable.padEnd(13)} ${k.query}${k.coveredBy ? `  → ${k.coveredBy}` : ""}`);
  console.log(`\n${list.length} rows. Scores rank opportunities; they are not traffic forecasts.`);
}
