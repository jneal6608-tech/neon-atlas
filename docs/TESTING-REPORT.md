# Testing report (2026-11-15)

Run everything with `npm test` (build → `tools/check.mjs` → `tools/browser-test.mjs`).

## Results

| Test | Result |
| --- | --- |
| Build | 13 live articles, 7 sections, 5 static pages; 1 scheduled (Nov 18); 2 held in the pipeline (research, fact-checking); 0 build warnings |
| Static check: 29 pages, 1,121 internal links | **Pass**: 0 broken links, 0 broken anchors, 0 metadata errors, 0 warnings |
| Metadata | Every page has a title, description, absolute canonical, Open Graph tags, viewport and `lang`; exactly one H1 |
| Structured data | All JSON-LD blocks parse |
| Sitemap | 25 URLs; every indexable page present; no noindex or draft pages; `lastmod` on all |
| robots.txt | Valid; sitemap declared |
| Unpublished content | Research/fact-checking/scheduled articles are **not** built or indexed (checked) |
| Secrets scan | No API keys or private keys in the public output |
| Browser: 27 URLs × desktop (1366 px) + phone (390 px) | **Pass**: 0 console errors, 0 failed requests, 0 broken images, no horizontal overflow |
| Accessibility: axe-core, WCAG 2.0/2.1 A + AA | **Pass**: 0 violations. Found and fixed: scrollable tables weren't keyboard-focusable |
| Navigation | Mobile menu opens and its links navigate (Escape-to-close is implemented but not covered by a test) |
| Search | "ultimate edition" returns the editions guide first; no-result state; result links return HTTP 200 |
| Contact form | Rejects empty messages and invalid emails; valid input opens the mail app (or posts to `formEndpoint` when set) |
| Table-of-contents anchors | Every entry has a target heading |
| Page weight | Largest page about 68 KB transferred locally, before compression and fonts |
| Editorial tools | Daily report, question inbox, Search Console import (tested with the clearly labelled sample CSVs in `tools/fixtures/`; the imported sample data was deleted afterwards), link finder, outline generator |

## Bugs found and fixed during testing

1. Apostrophes double-escaped in the table of contents ("What&#39;s"), and heading IDs contained "39". Fixed in the heading renderer.
2. Scrollable tables weren't reachable by keyboard (axe: *scrollable-region-focusable*). They're now focusable, labelled regions.
3. Section pages jumped from H1 to H3. Added an H2.
4. 14 titles were too long for Google's display, and 7 descriptions were outside the recommended length. All fixed.
5. The link-suggestion tool matched generic words ("news"). Generic terms are now filtered.

## Not tested here (needs the live environment)

- **Real-world Core Web Vitals and PageSpeed:** run PageSpeed Insights on the live URL after deploying. With Google Fonts loading over the network, expect a slightly larger first load.
- **Decap CMS in the browser:** loads from a CDN; test `/admin/` locally with `npm run cms` before going live.
- **Contact form posting to a backend:** only once a `formEndpoint` is configured.
- **AI drafting:** needs an `ANTHROPIC_API_KEY`. The code path is written but has not been run against the API.
- **Search Console API / GA4 data:** need the live site and accounts.
