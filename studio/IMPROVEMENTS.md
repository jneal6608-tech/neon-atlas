# Improvements log

Every piece of feedback after a video, and what changed so it sticks. Newest first.

## 2026-11-18: /write-script asks the format (or your idea), never the length
- **Feedback:** the user wants `/write-script` to ask which format they want, or whether they have their own idea, and
  not to ask the length: "just give me whatever length is good for a good video".
- **Change:** step 1 of `/write-script` is one question (news, lore or theory, guide, Short, or "Other" for their own
  idea), then up to three topic suggestions from the site's research if they gave no topic. Every format now has an
  `aim` length in `tools/formats.py` (news 10-12 min, lore 12-16, theory 15-20, deep dive 18-22, cars 8-9, guide 6-8,
  top 5 Short 45-55 s, this-or-that 40-55 s, funny Short 15-30 s), from the reference videos' sweet spots.
  `script_check.py budget <format>` gives the length and word budget at the user's pace; the score report shows it.
  Scripts are never padded to reach it: when verified material runs out, the script is shorter and says so.
- **Files:** `.claude/commands/write-script.md`, `studio/tools/formats.py`, `studio/tools/script_check.py`,
  `studio/tools/script_score.py`, `studio/tools/tests/test_script_check.py`.

## 2026-11-18: build step 1, the GTA script mode
- **Request:** build the studio's tools from scratch, one step at a time, starting with the script mode, with tests.
- **Change:**
  - A script markup the tools read (`prompts/script-template.md`): `## Hook`, named chapters, `## Ending`; lines tagged
    `[claim]`, `[evidence]`, `[reaction]` (plus hook, theory and ending tags); `[S1]` source ids matching
    `source/sources.md`; `>` editor notes that are not spoken.
  - `tools/script_check.py`: times every sentence at the user's pace (`voice.json`, 165 wpm until measured) and checks
    the script reference: length, the three-part hook and first item before 0:30, claim > evidence > reaction units,
    unit pacing, series structure (order said out loud, item rate, chapters, car test method and our own numbers,
    guide query/answer/article, top-N countdown), the ending, sources (reported facts attributed out loud, no leaks),
    unlabelled guesses and theories, "unofficial", speakability (long sentences, brackets, glued units, tongue-twisters,
    past stumbles) and voice (opinions in reactions, transitions). Also `read` (the reading copy), `timeline` and
    `stumble` (records words the user tripped on in `prompts/stumbles.txt`, checked in every later script).
  - `tools/script_score.py`: ten dimensions out of 10, total out of 100, the 80/6 bar, rule-breaking findings that fail
    whatever the score, weak stretches by timestamp; saves `script-score.json` with the script's hash for QC.
  - `tools/formats.py`: each format's rules in one place. Where `CLAUDE.md` and the script reference give different
    lengths (news 6-12 vs 10-15 min, lore 8-15 vs 12-20), the allowed range is the span of both, and falling short
    of the reference's range costs up to 1.5 points ("ideal").
  - `/write-script` (root `.claude/commands/`), `tools/ensure_deps.sh`, 59 tests (`tools/tests/`, `pytest.ini`) and a
    `Studio tests` workflow that runs them on studio pull requests.
  - First real script: `videos/gta-6-launch-everything-confirmed/` (launch-eve news, facts from the site's articles).
- **Files:** `studio/tools/`, `studio/prompts/script-template.md`, `studio/prompts/stumbles.txt`, `studio/voice.json`,
  `studio/pytest.ini`, `studio/videos/gta-6-launch-everything-confirmed/`, `.claude/commands/write-script.md`,
  `.github/workflows/studio-tests.yml`, `studio/README.md`, `studio/BRIEF.md`, `studio/.gitignore`.

## 2026-11-18: tools built fresh, separate from the animation studio
- **Decision:** the user wants the studio's infrastructure separate from the animation studio: nothing copied from it.
- **Change:** the "Bring over from animation-studio" table is replaced by "Tools: built fresh in `studio/`", which lists
  what each tool must do (requirements only); voice tools became their own build step; `KICKOFF.md` rewritten so the
  building session starts from scratch, one step at a time, with tests and a pull request per step.
- **Files:** `studio/BRIEF.md`, `studio/KICKOFF.md`, `studio/README.md`.

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
