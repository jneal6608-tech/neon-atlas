# Fan theories and community votes

`/theories/` lists the GTA VI fan theories people are debating right now. The top three that aren't debunked also
appear on the homepage. Each theory shows what fans point to, the case against it (from Rockstar's official
information), where fans are discussing it, and a shared "Believe it / Doubt it" vote.

## The data: `data/theories.json`

One entry per theory, shown in file order:

| Field | Meaning |
| --- | --- |
| `id` | Stable, lowercase-hyphen slug. **Never rename it**: votes are stored by id. |
| `title`, `summary` | The theory in a headline and one or two sentences. |
| `status` | `open`, `likely`, `long-shot`, `confirmed` or `debunked`. Voting closes on `confirmed`/`debunked` and the final tally is shown. |
| `trend` | `rising` (shows "Trending"), `steady`, or `cooling` (shows "Cooling off"). |
| `for` / `against` | Bullet points. `for` = what fans cite. `against` = official Rockstar facts or strong counter-points. |
| `sources` | At least one article or thread showing fans discussing it (`title`, `url`, `publisher`). |
| `image`, `imageAlt` | An official image name from the list below, and a plain description of what's in it. Pick one that fits the theory; describe only what you can see (don't name a character unless it's clearly them). |
| `related` | Article slugs. The theory is shown inside those articles; articles with no match show the hottest theory. |
| `spoiler` | `true` after launch for anything that reveals story events. |
| `added`, `updated` | Dates (`YYYY-MM-DD`). Bump `updated` whenever the entry changes, and the top-level `updated` too. |

`npm run check` validates the file (ids, statuses, sources, dates).

## Where theories appear

- `/theories/`: every theory, with its picture, evidence, vote and sources.
- Homepage: the five hottest non-debunked theories, mixed in between sections as you scroll (after "Start here", the
  trailers, the map, the cast and "Browse the guide").
- Articles: one theory "break" partway through each article (before its third section): the one whose `related`
  list includes that article, otherwise the hottest.

## Images you can use

Official Rockstar images already on the site (credited "Image: Rockstar Games" automatically):

- Scenes: `gta-6-age-rating-parents-guide`, `gta-6-beginner-tips`, `gta-6-best-settings`, `gta-6-character-quiz`, `gta-6-characters`, `gta-6-cheats`, `gta-6-controls-ps5-xbox`, `gta-6-editions-standard-vs-ultimate`, `gta-6-free-month-gta-plus-redeem`, `gta-6-how-long-to-beat`, `gta-6-how-to-make-money`, `gta-6-how-to-save`, `gta-6-how-to-switch-characters`, `gta-6-launch-night-checklist`, `gta-6-launch-week-everything-confirmed`, `gta-6-map-leonida-regions`, `gta-6-mission-list`, `gta-6-online-what-we-know`, `gta-6-physical-copy-no-disc`, `gta-6-pre-load-guide`, `gta-6-pre-order-bonus-vintage-vice-city-pack`, `gta-6-release-date-time`, `gta-6-servers-down`, `gta-6-story-what-we-know`, `gta-6-stuck-on-loading-screen`, `gta-6-trailers`, `gta-6-vehicles-named-so-far`, `gta-6-wanted-level`, `home-hero`, `is-gta-6-on-pc`, `video-launch-trailer`
- Regions: `region-ambrosia`, `region-grassrivers`, `region-leonida-keys`, `region-mount-kalaga`, `region-port-gellhorn`, `region-vice-city`
- Characters (portrait crops; scenes usually look better): `char-boobie-ike`, `char-brian-heder`, `char-cal-hampton`, `char-dre-quan-priest`, `char-jason-duval`, `char-lucia-caminos`, `char-raul-bautista`, `char-real-dimez`

## Nightly research (Claude scheduled task)

A Claude scheduled task ("Neon Atlas: nightly news check + fan theories") runs every night. It:

1. runs the official-source watcher (`tools/watch-official.mjs`) and drafts any needed news updates;
2. researches what GTA VI fans are discussing (Reddit, YouTube, X and gaming news coverage of them), and picks a
   fitting image and related articles for any new theory;
3. updates `data/theories.json`: adds new theories, re-orders by what's hot, sets `trend`, and moves theories to
   `confirmed`/`debunked` when Rockstar or the game settles them;
4. runs the build and checks, then opens a pull request explaining every change. Nothing goes live until you merge it.

Rules it follows: only real, findable fan discussions (never invented); no leaks or datamined material; the case
against uses official sources; story theories get `spoiler: true` after launch; at most ~12 live theories (drop
the stalest `cooling` ones, never debunked ones from the last week).

## Votes

- The site calls `/api/votes` and `/api/vote`, handled by `src/worker.mjs` on the Cloudflare Worker. Votes are stored in
  a SQLite Durable Object (`VoteCounter`), which is on Cloudflare's free plan and is created automatically on deploy by
  the `migrations` entry in `wrangler.jsonc`. There's nothing to set up in the dashboard.
- Anonymous: a random id in a first-party cookie lets someone change or remove their vote; a salted, daily hash of the
  IP address caps new votes at 25 per connection per theory per day. No other data is stored.
- Percentages appear from 10 votes. Below that the card shows "No votes yet" or "N votes so far".
- Locally, `npm run serve` runs the same vote code in memory (`tools/serve.mjs`), so the browser tests cover voting.
  `npx wrangler dev` runs the real Worker and Durable Object.
- Removing a theory from the file hides it; its votes stay stored, and come back if the id returns.
