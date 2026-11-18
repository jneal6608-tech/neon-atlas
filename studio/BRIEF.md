# Neon Atlas Studio: the brief

Decisions made with the user on 2026-11-18, in the animation-studio session that set this repository up. Read this at the
start of every session; update it when a decision changes (with the date).

## The channel

- **Renamed Neon Atlas (user decision, 2026-11-18):** the existing channel is rebranded now, before the first GTA
  upload, rather than after a few weeks. Profile picture, banner and description: `channel/` (regenerate with
  `node studio/channel/make_channel_art.mjs`). First GTA uploads: gameplay, on the site and the channel; the first
  narrated video waits until the Sunday after launch while the site takes launch week.
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
- calibrated against the reference videos the user chose (`prompts/script-reference-gta.md`, 2026-11-18);
- scored 80+ on the scorecard, every fact sourced (Neon Atlas articles, official Rockstar material, our own gameplay, fresh
  research).

## Tools: built fresh in `studio/`, separate from the animation studio (user decision, 2026-11-18)

Nothing is copied from `jneal6608-tech/animation-studio`, and it is not attached to studio sessions. The tools below are
written new for footage editing. What each must do (the requirements, not code to copy):

| Tool | Does |
|---|---|
| `tools/vo_prep.py` | cleans the user's recording only: keeps the original untouched; trims silence at the very start and end; removes rumble under ~60 Hz; levels to -16 LUFS with one gain change (a transparent limiter only on peaks past -1.5 dBTP). Never changes pacing, pitch or delivery. |
| `tools/align.py` | word-level timestamps for the voiceover (a local speech-to-text model, e.g. Whisper or Parakeet), matched to the script text, so every cut and overlay is placed with `cue("word")`. |
| `tools/script_check.py`, `tools/script_score.py` (+ tests) | measure a script against `prompts/script-reference-gta.md`: length at the user's pace, the hook checks, units with claim/evidence/reaction, series structure, unlabelled guesses, sources; a score out of 100 with weak stretches by timestamp. 80+ with no dimension under 6 goes to recording. |
| `tools/footage.py` | download the clips a video needs (Google Drive), cut them into scenes, sample frames, tag them, write `footage/index.json`, delete raw clips after export. |
| `tools/edit.py` (+ renderer) | the edit: clips matched to sentences, the overlays from `STYLE.md` on word cues, a low-res storyboard preview first, then the full 1080p60 render. |
| `tools/music.py`, `tools/mix.py`, `tools/export.py` | a music bed (the user's track or a generated one) ducked under the voice, master at -14 LUFS, true peak under -1 dBTP, H.264 + AAC export. |
| `tools/qc.py` | the gate before "finished": file, resolution, sync, loudness, no black or frozen stretches, captions inside safe areas (Shorts: clear of the YouTube buttons), only our own footage, script score present. |
| `tools/package.py` | 5+ titles (series formulas in `research/reference-channels.md`) and 3+ thumbnail concepts compared before one is chosen; description with the unofficial notice, sources and the Neon Atlas link; chapters. |
| `tools/retention.py` | log real YouTube numbers (retention at 0:30 and 1:00, average view, CTR; Shorts: viewed vs swiped) into a fresh `analytics/RETENTION.md`. |
| `tools/ensure_deps.sh` | installs only what is missing (ffmpeg, the speech model, Python packages). |

Each tool has its usage in its docstring and a test where it computes something (scores, timing, loudness, QC).

## Build order

1. **GTA script mode** (`/write-script`, `script_check`, `script_score`): formats, the GTA script reference, read-aloud
   pass, scoring. Needs no footage, so it comes first and makes the first recording session count. **Built 2026-11-18.**
2. **Voice tools** (`/voiceover`, `vo_prep`, `align`): the user's recording cleaned and timed word by word.
3. **The YouTube edit look** (`STYLE.md`, written with the user and confirmed before it locks): punch-in zooms, arrows and
   circles, map pins on Leonida, captions with highlighted keywords, counters, pop-ups, whooshes and dings, chapter cards.
4. **Footage library**: download, scene-cut, tag, index; "what to record" shot lists when a script needs footage we lack.
5. **Edit pipeline** (`/make-video`): clip matching per sentence, overlays on word cues, storyboard, render, music, mix,
   export, QC, package.
6. **Shorts** (`/make-shorts`): top-N, this-or-that and funny clips from the same pieces: vertical crop of gameplay, rank, name, stat, safe areas.
7. **Gameplay upload helper**: trim, chapters, title, description, thumbnail, the link and embed for the matching Neon Atlas
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
