# Neon Atlas: the independent GTA VI guide

An unofficial, independent GTA VI information site built to be **fast, trustworthy and search-friendly**. Every claim is labelled *confirmed*, *reported*, *unconfirmed* or *prediction*, and every page lists its sources and its last-verified date.

> Not affiliated with Rockstar Games or Take-Two Interactive. All artwork is original.

## Quick start

```bash
npm install
npm run dev          # build + serve at http://localhost:4321
npm test             # build + static checks + browser/accessibility tests
npm run report       # today's editorial report (reports/daily-<date>.md + reports/dashboard.html)
```

Editing in the browser (local): run `npm run cms` in one terminal and `npm run dev` in another, then open http://localhost:4321/admin/.

## Technology stack (and why)

| Layer | Choice | Why |
| --- | --- | --- |
| Site generator | ~400 lines of plain Node (`src/build.mjs`), Markdown + JSON content | No framework to upgrade or break; builds in under a second; easy to read and change. |
| Content | Markdown files with front matter (`content/articles/`), JSON data (`data/`, `content/categories.json`) | Versioned in Git: every change is tracked and reversible. |
| Editorial dashboard | [Decap CMS](https://decapcms.org) at `/admin/` | Free, open source, Git-based. Edit, schedule, and change status without touching code. |
| Hosting | Cloudflare Worker `neonatlas` with static assets (free; `wrangler.jsonc`) | Global CDN, HTTPS, free plan, security headers via `_headers`. |
| Deploys | GitHub Actions (`.github/workflows/deploy.yml`, `wrangler deploy`) | Builds and checks on every save and once a day (publishes scheduled articles). |
| Search | Prebuilt JSON index + small client-side script | No server and no paid search service; works offline from the CDN. |
| AI tools | Claude via the Anthropic SDK, **command line only** | The key stays on your computer or in CI secrets, never in the website. |
| Analytics | Google Analytics 4 (optional) + Search Console CSV import | Free; GA loads only when an ID is configured. |
| Tests | Custom static checker + Playwright + axe-core | Links, metadata, sitemap, accessibility, mobile layout, console errors. |

Running cost: **$0/month** (domain name optional, about $10–15/year).

## Architecture

```
content/articles/*.md     one file per article (front matter: status, confidence, sources, FAQs, dates…)
content/pages/*.md        About, Contact, Privacy, Editorial standards, Affiliate disclosure
content/categories.json   the seven sections and their planned coverage
data/keywords.json        keyword opportunity database (labelled estimates, no invented volumes)
data/backlog.json         editorial backlog (34 opportunities with outlines and sources)
data/questions.json       reader-question inbox
data/faq.json             extra site-level FAQs
src/content.mjs           loads + validates content, defines statuses and labels
src/build.mjs             renders every page, sitemap, robots.txt, RSS, search index, _headers
src/scoring.mjs           every ranking weight, in one place
assets/                   CSS, JS, original logo/favicon/social image
admin/                    Decap CMS editorial dashboard
tools/                    editorial intelligence, keyword tool, checks, browser tests, local server
docs/                     research, SEO, testing, deployment, strategy, monetisation, playbooks
```

URLs are `/<section>/<slug>/` (e.g. `/guides/gta-6-pre-load-guide/`). Sections: guides, missions, characters, locations, vehicles, gameplay, news. Empty sections are `noindex` until they have content.

### Article statuses

`research` → `drafting` → `fact-checking` → `review` → `published` → (`needs-updating`)

Only **published** and **needs-updating** appear on the site; *needs-updating* shows readers a notice. A **future publish date** schedules an article (the daily build publishes it). Publishing without sources is blocked.

### Writing conventions

- Answer the question in the first two sentences.
- Link other articles with `[text](article:slug)`. Links to unpublished articles render as plain text, so nothing breaks.
- Label claims with callouts: `> [!CONFIRMED]`, `> [!REPORTED]`, `> [!UNCONFIRMED]`, `> [!PREDICTED]`, `> [!NOTE]`, `> [!WARNING]`.
- Every published article needs `sources`, `lastVerified` and a `confidence` label.

## Images and engagement features

- **Artwork:** `node tools/make-art.mjs` draws original Vice City-style art (no Rockstar assets): a hero, card and social-share image for every article, plus region and character cards. For a new article, run `node tools/make-art.mjs <slug>`; the build warns if one is missing.
- **Official Rockstar images:** `npm run fetch-official && npm run import-official` downloads Rockstar's own GTA VI media and puts it on every character, region, article and the home page, credited "Image: Rockstar Games". Which image goes where: `data/official-art.json`. Details: docs/OFFICIAL-IMAGES.md.
- **Trailers** show YouTube's own thumbnail and play inside the page; wherever embedding is blocked (some previews and apps) they open YouTube instead.
- **Your own screenshots (after launch):** take them on your console (PS5: Create button; Xbox: Share button), resize to about 1600 px wide, put them in `assets/uploads/` (or upload in the CMS), and add them in Markdown with alt text: `![Lucia at the Ocean Beach safehouse](/assets/uploads/lucia-safehouse.jpg)`. Your own gameplay screenshots are the standard for guide sites; never copy images from other sites.
- **Shortcodes** (on their own line in an article): `{{countdown}}`, `{{unlock}}` (unlock time by time zone), `{{storage}}` (will it fit?), `{{edition}}` (edition picker), `{{quiz}}` (character quiz), `{{regions}}`, `{{characters}}`, `{{videos}}` (all trailers), `{{video:YOUTUBE_ID|Title}}` (official videos only).
- **Built in for time on site:** reading progress bar, sticky "Popular right now" sidebar, "Up next" card, "Keep reading" grid, click-to-play trailers (YouTube loads only on click, so pages stay fast), and a sidebar ad slot ready for AdSense.

## Daily maintenance (15 minutes)

1. `npm run report` and work the top of "Tomorrow's priorities".
2. Re-verify any page the report flags; update `lastVerified` (and `updated` if anything changed, plus a line in `updateLog`).
3. Add reader questions: `node tools/editorial.mjs add-question "..." --source search`.
4. Weekly: export Search Console → Performance → Queries + Pages CSV, then `node tools/editorial.mjs gsc-import Queries.csv Pages.csv`.

More: [docs/](docs/) (deployment, SEO, testing, research, 30-day strategy, launch-week playbook, monetisation, AI editorial).
