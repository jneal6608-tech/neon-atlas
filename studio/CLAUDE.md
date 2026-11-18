# Neon Atlas Studio rules

This folder (`studio/` in the Neon Atlas repository) turns the user's own GTA 6 gameplay and their own voice into YouTube
videos for the channel: guides, explainers and theories (long-form), top-N Shorts, and lightly edited gameplay uploads.
Neon Atlas is an unofficial, independent GTA 6 guide; its website (neonatlasguide.com) is the rest of this repository
(see `../README.md`). `BRIEF.md` holds the decisions behind everything here: read it at the start of every session.

Work from `studio/`; every path below is relative to it. Slash commands for the studio go in the repository's root
`.claude/commands/`.

The channel is faceless. The user's voice narrates the long-form videos. There is no animation in this studio: the picture
is the user's gameplay with edited graphics on top (the "YouTube edit" look in `STYLE.md`, once it is written).

## Always

1. **Footage is the user's own.** Only gameplay the user recorded on their own PS5 (in `footage/`) or official Rockstar
   trailers and screenshots used with real commentary on top. Never another creator's video, never leaked or pre-release
   footage, never a straight re-upload of a trailer. If a video needs a shot the library does not have, say exactly what to
   record ("30 s driving a sports car along the beach at sunset") instead of filling the gap with someone else's footage.
2. **Unofficial, and says so.** Never present Neon Atlas as Rockstar, Take-Two or official: no copied Rockstar logos as
   our branding, and every description says it is an unofficial fan guide. Rockstar assets are credited.
3. **Facts are sourced; theories are labelled.** Every claim in a guide or explainer has a source in the video's
   `source/sources.md` (our own gameplay counts: note the clip). Theories say out loud that they are theories, and give the
   evidence for and against. Story spoilers get a warning in the first seconds and never in a title or thumbnail.
4. **The user's voice is the master clock.** `/voiceover <file>` cleans the recording only (`tools/vo_prep.py`: trim, rumble,
   loudness). No pitch or speed changes to the user's voice, ever. Then `tools/align.py` times every word, and every cut,
   zoom, caption and graphic is placed with `cue("word")`, never with typed seconds, so a re-record re-syncs everything.
   Shorts may use text and music only, or a synthetic studio voice if the user asks; never clone or imitate a real person.
5. **Scripts are written for the user to speak.** Short sentences, words a person actually says, nothing that trips the
   tongue. Every script gets a read-aloud pass before it is final: the user reads it once, and every line they stumble on is
   rewritten. A script goes to recording at 80+ on `tools/script_score.py` with no dimension under 6 (or the user says go
   ahead anyway).
6. **Stop at the storyboard.** Nothing renders at full quality until the user says "approved".
7. **Nothing is ready until it is checked.** A video or Short is called finished only after `tools/qc.py <folder> final`
   passes; say plainly which warnings remain. Never report a score, a check or a retention number that was not actually run
   or logged.
8. **Every change the user asks for is permanent.** Fix the tool, rule, style or command that caused it (not just this one
   video), then add a dated entry to `IMPROVEMENTS.md`: feedback, change, files. Before changing `STYLE.md` (the look),
   confirm with the user.
9. **Changes reach `main`.** At the start of a session run `git fetch origin` and bring in studio commits from other branches
   that are not in `main`. When a video is finished its studio changes go to `main` by pull request. Claude may merge its
   own pull request only after asking the user and getting a yes for that pull request ("Merge #N now? It contains ...");
   never one with conflicts or failing checks, never someone else's.
10. **Raw footage never goes in git** (it is git-ignored). Cloud sessions have limited disk: download only the clips a video
    needs, delete them after export, and record at 1080p60 unless the user says otherwise.

## Formats

| Format | Length | Voice | Notes |
|---|---|---|---|
| `guide` | 6-12 min | user | answers one search ("how to make money fast in GTA 6"); steps shown on screen; chapters |
| `explainer` | 6-12 min | user | "10 things GTA 6 never tells you", systems, map, characters |
| `theory` | 8-15 min | user | labelled theory, evidence for and against, honest verdict |
| `topn-short` | 30-60 s | text + music (or studio voice) | vertical 1080x1920, top 5 by default; top 10 gives the last three most time |
| `gameplay` | any | none | trimmed, chapters, thumbnail, description linking the matching Neon Atlas article |

## The pipeline (to be built: see BRIEF.md "Build order")

script (research, write, score, read-aloud) → user records voice → `/voiceover` → `align` → clip matching from the footage
index → overlays (zooms, arrows, map pins, captions, SFX) on cues → storyboard (stop) → render → music, mix, export → QC →
package (titles, thumbnails, description, chapters) → link on the matching Neon Atlas article (`../content/articles/`).

## The site is next door

- Pushing to `main` deploys the live website (`../.github/workflows/deploy.yml`; pushes that change only `studio/` are
  skipped). Studio work goes on a branch and reaches `main` by pull request.
- Topics come from the site's own research first: `../data/keywords.json`, `../data/backlog.json`, `../data/questions.json`
  (guides), `../data/theories.json` and `../docs/THEORIES.md` (theories), `../content/articles/` (facts and sources).
- Adding a video to an article is a site change: follow `../README.md` and run `npm test` from the repository root.

## Environment notes (cloud sessions)

- Parakeet (word timestamps) and MusicGen download from huggingface.co (and us.aws.cdn.hf.co); those hosts must be
  allowed in the environment. Set `HF_HUB_DISABLE_XET=1`.
- Node needs `NODE_USE_ENV_PROXY=1` to download through the proxy.
- `videos/*/work`, `cache`, `renders` are regenerable and git-ignored; scripts, plans, sources and the source voiceover are kept.
