# Neon Atlas Studio: the brief

Decisions made with the user on 2026-11-18, in the animation-studio session that set this repository up. Read this at the
start of every session; update it when a decision changes (with the date).

## The channel

- **Same YouTube channel** as the survival/what-if animations: it is already approved for monetization and had about 60
  subscribers and 300 views, so switching niche costs little. The survival videos stay up. If GTA clearly wins after a few
  weeks, the channel may be renamed Neon Atlas (a rename does not affect monetization).
- **Faceless.** No face, no camera, no "hey guys". The user's voice is the narrator: "the Neon Atlas guide", an anonymous
  voice that knows Leonida inside out, like a documentary narrator.
- **No animation for GTA.** The animation studio (`jneal6608-tech/animation-studio`) stays as it is for survival videos.

## What gets made: an all-round GTA 6 channel in named series (2026-11-18)

The user chose an all-round GTA 6 channel. It stays all-round by running a few repeatable series, so viewers (and YouTube)
know what each upload is. Reference channels, checked on YouTube 2026-11-18 (subscribers / typical recent views):

| Series | Modelled on | What we take from it | We never copy |
|---|---|---|---|
| **News and "everything new"** | MrBossFTW (3.19M; 90K-200K, daily) | his format: voice over footage, no camera; fast turnaround; long, specific titles ("GTA 6 Just Got A NEW Update - ...") | his scripts, thumbnails, catchphrases |
| **Lore and deep dives** (theories included) | DarkViperAU (2.35M; lore video 390K this week) | his topics and angles: a clear question ("Could Chef know Michael before Trevor?"), a stance, evidence argued for and against | his persona, jokes, opinions as ours |
| **Cars** | Broughy1322 (294K; 12K-30K) | tested countdowns ("Fastest Supercars - Best Cars Countdown"): every car tested the same way, real numbers we measured, so the list is trustworthy | his data: we test our own cars |
| **Guides** | (search-led; GTA Series Videos for clarity) | answers one search, steps on screen, chapters; each matches a Neon Atlas article | |

Shorts (vertical, from our gameplay):
- **Top 5 / top 10**: rank, name, one quick stat. Top 5 holds better under 60 s; a top 10 rushes the first items and gives
  the last three the time.
- **This or that**: two cars, weapons, places or outfits head to head, a verdict at the end.
- **Funny clips**: moments the user saves on the PS5 right after they happen (Create > save recent gameplay); the studio adds
  the cut, zooms, captions and sound effects. The user flags them; the studio does not hunt hours of footage for them.

Also:
- **Regular gameplay uploads** with a light edit (trim, chapters, thumbnail, description linking the matching Neon Atlas
  article), embedded on the site.
- **No full mission walkthroughs.** A short "how to beat <hard mission>" is a guide and is fine.

Notes:
- News scripts start from the site's own official-source watcher and live feed (`tools/watch-official.mjs`, the launch
  live blog), so a news video and its site update come from the same verified facts.
- Car tests need a fixed method (the same straight, fully upgraded, timed over a known distance from our footage) written
  down before the first car video, so every number is comparable.
- Rejected as a model: "GTA explained" (@GTAexplainedByBill). Its description matched the plan, but it had 3 subscribers,
  0-30 views per video, sex-clickbait titles, an off-topic re-upload and "gameplay" posted before the game was out.

## Why the user's own voice and own footage

- Ad rates are the same either way; the gain is safety and retention. YouTube's monetization rules on reused and
  mass-produced ("inauthentic") content hit gameplay + synthetic voice + little added hardest. A real voice and the user's
  own footage are the clearest signs of an original video, and real reactions hold viewers longer.
- Re-using another creator's gameplay risks Content ID claims and copyright strikes (three strikes deletes a channel).
- Rockstar has generally allowed monetized gameplay videos of its games; check its current video policy before relying on
  that. Take-Two removes leaked footage aggressively: never use any.

## Footage workflow (to test with the first recordings)

PS5 capture (1080p60) → the user gets the clips off the console (USB drive, or the PS App) → a Google Drive folder (the
Drive connector is available in sessions) → the studio downloads only the clips a video needs into `footage/raw/`, indexes
them (scene cuts, frames, tags such as car chase, beach, police, menu, map, Lucia, Jason) into `footage/index.json` (kept in
git), and deletes raw clips after export. Cloud session disk is limited; raw footage never goes in git.

## The script bar

The user reads the scripts, so they must be good:
- written for speaking (short sentences, natural words, no tongue-twisters), with a read-aloud pass where every stumble is
  rewritten;
- calibrated against GTA guide/theory channels the user likes (`prompts/script-reference.md`, rebuilt for GTA: ask the user
  for 2-3 channels);
- scored 80+ on the scorecard, every fact sourced (Neon Atlas articles, official Rockstar material, our own gameplay, fresh
  research).

## Bring over from animation-studio (copy, then adapt)

Add `jneal6608-tech/animation-studio` to the session (read access is enough) and copy these into `studio/`, then strip
the animation and survival assumptions:

| From animation-studio | Keep | Change |
|---|---|---|
| `tools/vo_prep.py` | all: trim, rumble filter, -16 LUFS level | nothing |
| `tools/align.py` | Parakeet word timestamps, script-to-speech matching | align to edit segments instead of animated shots |
| `tools/script_check.py`, `tools/script_score.py` (+ tests) | scorecard, interest map, loop ledger, sourcing check | GTA formats (guide, explainer, theory, topn-short); drop the "survival numbers" rule; wpm from the user's measured pace, not the synthetic narrator |
| `tools/music.py`, `tools/mix.py`, `tools/export.py` | music bed, ducking under the voice, -14 LUFS master | nothing (no `vo_style` step: the user's voice is cleaned only) |
| `tools/qc.py` | file, timing, sound, captions, safe area, package checks | drop the palette, animated-shot and builder "direction" checks; add footage checks (no other creator's clips, no watermark, overlays on cues) |
| `tools/package.py` (+ test) | titles and thumbnail concepts compared before choosing | GTA title angles; description template with the unofficial notice and the Neon Atlas link |
| `tools/retention.py` (+ test) | retention/CTR log, drop-off reports, experiments | a fresh `analytics/RETENTION.md`: lessons from survival videos do not carry over |
| `.claude/commands/voiceover.md`, `retention.md` | the flow | `/voiceover` without voice styling |
| `tools/ensure_deps.sh` | ffmpeg, Parakeet, MusicGen | drop HyperFrames-only and Kokoro/Piper parts unless the edit renderer or a Shorts voice needs them |

Do not bring over: `library/` (animation pieces, palettes, rigs), `STYLE.md`, `build.py`, `narrate.py`, `vo_style.py`,
`voice_*`, `catalog.py`, `palette_sheet.py`, the survival scripts, videos and analytics.

## Build order

1. **GTA script mode** (`/write-script`): formats, GTA script reference, read-aloud pass, scoring. Needs no footage, so it
   comes first and makes the first recording session count.
2. **The YouTube edit look** (`STYLE.md`, written with the user and confirmed before it locks): punch-in zooms, arrows and
   circles, map pins on Leonida, captions with highlighted keywords, counters, pop-ups, whooshes and dings, chapter cards.
3. **Footage library**: download, scene-cut, tag, index; "what to record" shot lists when a script needs footage we lack.
4. **Edit pipeline** (`/make-video`): clip matching per sentence, overlays on word cues, storyboard, render, mix, QC.
5. **Top-N Shorts template** (`/make-shorts`): vertical crop of gameplay, rank, name, stat, safe areas.
6. **Gameplay upload helper**: trim, chapters, title, description, thumbnail, the link and embed for the matching Neon Atlas
   article.

## The site and the studio share this repository (2026-11-18)

- The user chose to put the studio inside the existing `jneal6608-tech/neon-atlas` repository, in `studio/`, rather than a
  new repository. The website is untouched by it: the site builds only from `content/`, `data/`, `assets/` and `src/`,
  and the deploy workflow skips pushes that change only `studio/`.
- Topic sources already in the site: `data/keywords.json` (keyword opportunities), `data/backlog.json` (34 outlined
  articles), `data/questions.json` (reader questions), `data/theories.json` (researched nightly), `content/articles/`.
- Embedding our videos: the site's `{{video ID}}` shortcode (`src/build.mjs`) labels every video "Official Rockstar Games
  video", so our own uploads need their own shortcode (for example `{{ourvideo ID "label"}}`, credited to Neon Atlas)
  before the first one is embedded. That is a site change: run `npm test` from the root.

## Open questions for the user

- Reference channels: chosen 2026-11-18 (see "What gets made"). Next: study 2-3 top videos of each (structure, hook,
  pacing, how often the picture changes) for the GTA script reference and the edit look. We learn their structure, pacing
  and editing rhythm; we never copy their scripts, footage, branding, thumbnails or channel identity.
- Shorts: text and music only, or the studio's synthetic voice?
- Release: GTA 6 launches 19 November 2026 (reference channels counted down to it on 2026-11-17). Launch-week searches are
  the biggest opportunity.
