# AI editorial intelligence

The system recommends what to publish, update and link next. AI drafting is optional and never publishes articles by itself. The one automatic exception is the live feed (below).

## Self-updating live feed (every 15 minutes)

`.github/workflows/watch.yml` runs every 15 minutes: `tools/watch-official.mjs` compares Rockstar's official GTA VI pages with the last snapshot, and when one changes, `tools/auto-update.mjs` sends only the added/removed official text to Claude (`claude-opus-5-5`, JSON output, server-side refusal fallback). If it is real news, Claude writes up to two short live-feed entries that state only what Rockstar's page now says, labelled *confirmed*, with the source page linked. The workflow then rebuilds, checks, commits and deploys, and pings IndexNow.

- Needs the repository secret `ANTHROPIC_API_KEY`. Without it (or if the API call fails), nothing is published and a GitHub issue is opened instead.
- Cosmetic changes (menus, cookie text, reordering) are skipped; entries with links/HTML, over 300 characters, or duplicates are rejected in code.
- Claude is only called when a page actually changed, so the cost is a few cents per change, not per check.
- Test without publishing: `node tools/watch-official.mjs && node tools/auto-update.mjs --dry-run`.
- Turn it off: Actions → "Watch official sources and self-update" → ⋯ → Disable workflow.

## What runs without any API key

| Command | What it does | Data it uses |
| --- | --- | --- |
| `npm run report` | Daily report + `reports/dashboard.html`: ranked priorities, pages to re-verify, question inbox, Search Console findings, backlog, internal links, schedule | content files, keyword DB, backlog, questions, imported Search Console CSV |
| `node tools/editorial.mjs questions` | Groups and scores reader questions; flags social-only signals | `data/questions.json` |
| `node tools/editorial.mjs gsc-import Q.csv P.csv` | Imports **measured** Search Console data | your export |
| `node tools/editorial.mjs links` | Unlinked mentions of other live articles | live articles |
| `node tools/editorial.mjs outline bl020` | Structured outline template from a backlog item | backlog |
| `node tools/editorial.mjs status <slug> <status>` | Moves an article through the pipeline (refuses to publish without sources) | article file |
| `node tools/keywords.mjs [csv\|gaps]` | Ranked keyword opportunities / CSV export / uncovered gaps | keyword DB |

How it decides (all weights in `src/scoring.mjs`):

- **Outdated information:** `lastVerified` older than 3 days in the launch window (7 days before launch to 30 after) or 45 days otherwise; `reviewBy` reached; `needs-updating`; or "reported" claims during launch.
- **Emerging questions:** clustered by wording; weighted by source (search 3 > email/comments/site-search 2 > social 1); matched against existing articles and FAQs.
- **Content gaps:** Search Console queries with 20+ impressions and no page targeting them.
- **Underperforming pages:** CTR below 60% of a position-based benchmark (a rough guide; replace it with your own averages after 4 weeks of data).
- **Striking distance:** queries at average position 8–20 with 50+ impressions.
- **Backlog:** items unblocked by launch, ranked by keyword priority.

## What needs an API key

`outline --ai` and `draft` call Claude (`claude-opus-5-5`, streaming, server-side refusal fallback enabled).

```bash
npm install @anthropic-ai/sdk          # optional dependency
export ANTHROPIC_API_KEY=...           # your computer or CI secrets only, never the website
node tools/editorial.mjs draft bl016 --fetch            # include the text of the item's verified sources
node tools/editorial.mjs draft bl020 --notes my-notes.md  # your own verified in-game notes as the source
```

Safeguards built in:

- The model may only use facts from the supplied source text or your notes, must cite each claim `[S1]`, and must list everything an editor needs to verify.
- Drafts are saved with `status: drafting` and an AI-assisted notice. They don't appear on the site.
- `draft` refuses to run without sources or notes, and refuses to overwrite a published article.
- Publishing still needs a human: fact-check, remove the citation markers, set the confidence label, then `status → published`.

## Live integrations not built (and what they'd need)

| Integration | Needs |
| --- | --- |
| Search Console API (automatic daily import) | Google Cloud project + service account added to the property; key stored as a CI secret |
| GA4 Data API (engagement in the report) | Same service account with Viewer access to the GA4 property |
| Google Trends | No official public API; check trends manually and log them as `--source search` with a note |

Without these, the tools say "not available". They never estimate missing numbers.
