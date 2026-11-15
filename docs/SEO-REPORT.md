# SEO implementation report

| Area | Implementation | Verified by |
| --- | --- | --- |
| URLs | `/<section>/<descriptive-slug>/`, lowercase, hyphenated, stable | static check (all links resolve) |
| Titles | Per-article `seoTitle` (under 60 characters plus brand) with H1 = full descriptive title | check warns over 70 characters; currently 0 warnings |
| Meta descriptions | Per page, 120–160 characters, answer-led | check warns outside 70–175 characters on indexable pages |
| Canonicals | Absolute canonical on every page from `site.config.json` → `url` | check |
| Open Graph / Twitter | og:title, description, url, image (original 1200×630), type, locale; `summary_large_image` | check |
| Structured data | `Article` (with dates, publisher, `about: VideoGame`), `BreadcrumbList` on every page, `WebSite` + `Organization` on home | JSON-LD parse check |
| Breadcrumbs | Visible on every page except home, matching the BreadcrumbList | visual + check |
| Headings | Exactly one H1 per page; no skipped levels; H2s phrased as real questions | check |
| Internal linking | `[text](article:slug)` links validated at build; related articles; section pages; FAQ hub; link-suggestion tool | check (0 broken links/anchors) |
| Sitemap | `sitemap.xml` with `lastmod`; only indexable pages; scheduled and draft content excluded | check compares the sitemap to the built pages |
| robots.txt | Allows all; disallows `/search/` and `/admin/`; declares the sitemap | check |
| Thin pages | Empty sections and search are `noindex` until they have content | check (noindex pages excluded from the sitemap) |
| RSS | `feed.xml` (30 latest) | check |
| Mobile | Responsive at 320 px and up; tested at 390 px; no horizontal scroll | browser test |
| Core Web Vitals | Static HTML, no framework JS (one ~6 KB script, deferred), CSS under 20 KB, `font-display: swap`, lazy-loaded images, ad slots reserve space only when ads are on (no layout shift) | browser test: largest page 68 KB locally |
| Images | Original artwork; `alt` required (the build warns, the check errors); `loading="lazy"` | check + browser test |
| Freshness signals | Visible "Updated" and "Facts last verified" dates; `dateModified` in JSON-LD; update history | build |
| E-E-A-T / trust | About, Editorial standards, Contact & corrections, Privacy, Affiliate disclosure; sources on every article; unofficial disclaimer site-wide | check (disclaimer on every page) |
| Security headers | `_headers`: nosniff, frame options, referrer policy, permissions policy, HSTS | file in build output |

## What we deliberately did not do

- **No FAQPage schema.** Google limits FAQ rich results to authoritative government and health sites, so it would add markup without benefit.
- **No sitelinks search box markup** (Google retired the feature).
- **No keyword stuffing, hidden text, doorway pages, or auto-generated pages per keyword.** Empty sections are noindexed instead.
- **No unverifiable review or rating schema.**

## After launch

1. Set the final domain in `site.config.json` before submitting to Search Console.
2. Submit the sitemap and request indexing for the top guides.
3. Watch Search Console → Pages for "Crawled – currently not indexed" and improve or merge those pages.
4. Use `node tools/editorial.mjs report` with imported Search Console data to find CTR and position opportunities.
