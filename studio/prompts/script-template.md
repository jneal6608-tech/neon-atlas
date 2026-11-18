# Script template and markup

Every script lives at `videos/<slug>/script.md` (Shorts: `shorts/<slug>/script.md`), with its sources in
`videos/<slug>/source/sources.md`. `tools/script_check.py` and `tools/script_score.py` read this markup; the reading
copy for the read-aloud pass (`script_check.py read`) strips all of it, so the user only sees the words they say.
How the script should sound is in `script-reference-gta.md`; this file is only the format.

## The markup

- **Front matter** (between `---` lines, `key: value`):
  - `format:` one of `news`, `lore`, `cars`, `guide`, `topn-short`, `this-or-that-short`, `funny-short` (required).
  - `kind:` lore only: `investigation`, `facts`, `deep-dive` or `theory`.
  - `title:` the working title. `article:` the matching Neon Atlas article slug (required for guides).
  - `query:` guides only: the one search the video answers. `top:` top-N Shorts: 5 (default) or 10.
  - `series:` / `episode:` for a numbered series (the ending must then name the next one).
  - `spoilers: true` when there are story spoilers (the hook must warn in the first 15 s).
  - `cold_open: true` lore about a theme only: lets the first item start up to 1:00.
  - `read_aloud:` the date of the user's read-aloud pass (set it after the stumbles are rewritten).
  - `wpm:` only to override `studio/voice.json` for this one script.
- **Sections** are `## ` headings. `## Hook` comes first and `## Ending` last; every other `## ` heading is a chapter
  (its name becomes the YouTube chapter name, so make it specific). Number countdown and fact chapters:
  `## 5. Vapid Dominator`. `### ` headings and `# ` titles are ignored.
- **Lines** are spoken narration. One line per beat, short sentences. A line can start with a **tag**:
  - units: `[claim]` starts a unit (also `[theory]` for a theory, `[step]` for a guide step), then `[evidence]`
    (the named source or the in-game proof), then `[reaction]` (one honest opinion, for the user to say in their own
    words). Theories also need `[for]` and `[against]`. A Short's round can use `[stat]` as its evidence.
  - hook: `[authority]`, `[promise]`, `[order]`, `[spoiler]`, `[answer]` (guides), `[method]` (cars).
  - ending: `[recap]`, `[pick]`, `[question]`, `[cta]`, `[next]`, `[verdict]`.
  Untagged lines are narration too (transitions, lead-ins). The checker also recognises most hook and ending lines
  from their words, but tags make the intent explicit.
- **Sources**: `[S1]`, `[S1, G2]` anywhere in a line, matching ids in `source/sources.md`. Not spoken.
- **Pauses**: `[pause]` adds 0.75 s. **Notes** for the editor (what to show) are lines starting with `>`: not spoken,
  not timed. **Comments** `<!-- ... -->` are ignored.

## `source/sources.md`

One source per line, `- [ID] type | publisher | title | url or clip | accessed date`. Types: `official` (Rockstar),
`reported` (outlets: the script must say who reports it), `article` (a Neon Atlas article), `gameplay` (our own
footage: name the clip), `press`, `other`. Use `S` ids for documents and `G` ids for our gameplay.

```
- [S1] official | Rockstar Games | Grand Theft Auto VI: official site | https://www.rockstargames.com/VI | accessed 2026-11-15
- [S2] reported | TweakTown | GTA 6 pre-load times, 212GB install size | https://www.tweaktown.com/... | accessed 2026-11-15
- [G1] gameplay | our footage | clip 2026-11-20-beach-drive.mp4 01:10-01:40
```

## Skeleton

```markdown
---
format: news
title: "GTA 6 Just Got A NEW Update - <item>, <item>, <item> & MORE!"
article: gta-6-launch-week-everything-confirmed
spoilers: false
read_aloud:
---

## Hook
<A bold, specific, true claim.> [S1]
[authority] Every fact in this video is sourced on neonatlasguide.com.
[promise] <What's coming, and its variety.>
[order] We'll start with the biggest.

## <Specific chapter name>
[claim] <What we're about to show.>
[evidence] <Who says it, or the in-game proof.> [S1]
[reaction] <One honest opinion.>
> show: <the shot>

## Ending
[recap] <One line.>
[pick] <The narrator's favourite, and why.>
[question] <The viewer's favourite?>
[cta] <Under 20 seconds.>
```
