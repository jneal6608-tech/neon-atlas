# Improvements log

Every piece of feedback after a video, and what changed so it sticks. Newest first.

## 2026-11-18: the GTA script reference
- **Input:** six transcripts the user chose (MrBossFTW news, two DarkViperAU, Broughy1322, two lore/theory videos).
- **Change:** `studio/prompts/script-reference-gta.md`: measured pace (160-225 wpm; target 155-175 for the user), the
  three-part hook every one of them uses, the claim > evidence > reaction unit with one honest opinion line per unit,
  structure per series, Shorts from the same units, and a pre-recording checklist. Transcripts are not committed (public
  repository); `research/transcripts/` is git-ignored.
- **Files:** `studio/prompts/script-reference-gta.md`, `studio/research/reference-channels.md`, `studio/.gitignore`.

## 2026-11-18: an all-round GTA 6 channel in named series
- **Decision:** the user wants an all-round GTA 6 channel: DarkViperAU-style lore topics, MrBossFTW's voice-over format
  (news and "everything new"), Broughy1322-style car countdowns, and Shorts that are top 5/10, this-or-that and funny clips.
- **Change:** four long-form series and three Short formats, each with its reference channel and what we take (and never
  copy) from it; "GTA explained" rejected as a model after checking its real numbers.
- **Files:** `studio/BRIEF.md` ("What gets made"), `studio/CLAUDE.md` (Formats).

## 2026-11-18: studio started
- **Decision:** GTA 6 videos move out of the animation studio into this repository: the user's own PS5 gameplay and own
  voice, faceless, no animation. Formats: guides, explainers, theories, top-N Shorts, gameplay uploads.
- **Where:** inside the existing Neon Atlas site repository, in `studio/` (user decision), not a new repository.
- **Files:** `studio/CLAUDE.md`, `studio/BRIEF.md`, `studio/README.md`, `studio/.gitignore`, `studio/KICKOFF.md`, root `CLAUDE.md`,
  `.github/workflows/deploy.yml` (studio-only pushes no longer redeploy the site).
