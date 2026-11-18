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

## What gets made

1. **Guides and explainers (the core).** Searchable, so a small channel can rank; each one matches a Neon Atlas article, so
   the site and the channel feed each other. Examples: "10 things to do first in GTA 6", "how to make money fast in GTA 6",
   "every hidden location in Vice City", "10 things GTA 6 never tells you".
2. **Theories (every couple of weeks).** Fun and shareable but recommendation-driven, harder for a small channel. Always
   labelled as theories.
3. **Top-N Shorts from gameplay.** "Top 5 fastest cars", "top 10 hidden spots". Top 5 holds better in under 60 s; for a
   top 10 the first items go fast and the last three get the time. Rank number, item name, one quick stat.
4. **Regular gameplay uploads** with a light edit (trim, chapters, thumbnail, description linking the matching Neon Atlas
   article). They are also embedded on the Neon Atlas site.
5. **No full mission walkthroughs.** Hours of recording, big outlets own the searches, spoilers. A short "how to beat <hard
   mission>" is a guide and is fine.

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

- Which 2-3 GTA YouTube channels' style do they like (for the script reference and the edit look)? The user is researching
  this (2026-11-18). We learn their structure, pacing and editing rhythm; we never copy their scripts, footage, branding,
  thumbnails or channel identity.
- Shorts: text and music only, or the studio's synthetic voice?
- The GTA 6 release date: as of mid-2026 it was 19 November 2026. Confirm it held; launch-week searches are the biggest
  opportunity.
