# Analytics: what to track and where to find it

| Question | Where | Metric |
| --- | --- | --- |
| What content attracts visitors? | Search Console → Pages; GA4 → Reports → Engagement → Pages and screens | clicks, impressions; views, engaged sessions |
| What are people searching? | Search Console → Queries; GA4 → Events → `search` (`search_term`) | queries; on-site search terms |
| Which pages underperform? | `npm run report` (after `gsc-import`) | CTR vs position benchmark; positions 8–20 |
| What should be updated? | `npm run report` → "Pages to re-verify" | lastVerified, reviewBy, needs-updating |
| What should be published next? | `npm run report` → "Tomorrow's priorities" | merged ranking |
| Organic visitors | GA4 → Acquisition → Traffic acquisition, filter *Organic Search* | sessions, users |
| Search impressions, clicks, CTR, position | Search Console → Performance | |
| Article engagement | GA4 → Events → `article_read` (reader reached the final quarter); average engagement time | |
| Returning visitors | GA4 → Retention | returning users |
| Traffic by category | GA4 → Pages and screens, filter page path `/guides/`, `/characters/`… | |
| Conversions | GA4 key events: `article_read`, `contact_submit`, `source_click` | |

## Events the site sends (when a GA4 ID is set)

- `page_view` (automatic)
- `search`: `search_term`, `results`
- `article_read`: `slug`, `category`
- `source_click`: `url` (readers checking our sources)
- `contact_submit`: `topic`

## Weekly routine

1. Export Search Console (last 7 days) → `node tools/editorial.mjs gsc-import Queries.csv Pages.csv --range "<dates>"`.
2. `npm run report`, then open `reports/dashboard.html`.
3. Note the 3 biggest movers in `data/questions.json` (as `search-console` questions) so they feed the next report.
