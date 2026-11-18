---
description: Write a Neon Atlas video script (news, lore, cars, guide or a Short), score it to 80+, then run the read-aloud pass
argument-hint: <format> <topic, backlog id or article slug>
---

Write a script for the Neon Atlas studio: $ARGUMENTS

Work from `studio/`. Before writing, read `studio/CLAUDE.md`, `studio/BRIEF.md`, `studio/prompts/script-reference-gta.md`
(how it should sound) and `studio/prompts/script-template.md` (the markup the tools read). Work on a branch, never `main`.

## 1. Format and topic
- Format is one of `news`, `lore` (with `kind:` investigation, facts, deep-dive or theory), `cars`, `guide`,
  `topn-short`, `this-or-that-short`, `funny-short`. Gameplay uploads have no script. If the format or topic is missing
  or unclear, ask the user (one question), suggesting topics from the site's research: `data/keywords.json`,
  `data/backlog.json`, `data/questions.json` (guides), `data/theories.json` and `docs/THEORIES.md` (theories).
- Pick the matching Neon Atlas article in `content/articles/` (required for guides; use it for facts in every format).
- Slug: lowercase-hyphenated. Long-form goes in `studio/videos/<slug>/`, Shorts in `studio/shorts/<slug>/`.

## 2. Sources first
- Write `source/sources.md` before the script (format in the template). Facts come only from: Neon Atlas articles and
  the sources they cite, official Rockstar pages, our own gameplay (`studio/footage/index.json` once it exists: name
  the clip), and fresh research with a link.
- Mark each source `official`, `reported`, `article` or `gameplay`. Reported facts are said as reported in the script
  ("TweakTown reports..."). Never use leaked or pre-release material, or another creator's video, as a source.
- Story spoilers: set `spoilers: true` and warn in the first seconds; never put a spoiler in the title.

## 3. Write it
- Follow the script reference for the series: the three-part hook (bold specific claim, one true authority line, a
  promise), the first item before 0:30, the order said out loud, units of claim > evidence > reaction, transitions,
  the series ending (recap, the narrator's pick, a question, call to action under 20 s, the next episode for a series).
- Length: at the user's pace in `studio/voice.json` (165 wpm until it is measured). The checker gives the word budget.
- Written for speaking: short sentences, words a person says, numbers and units as words, no brackets or slashes.
- Every unit gets one `[reaction]` line: an honest opinion for the user to say in their own words. Mark in a comment
  at the top that reactions are suggestions. Never invent experience ("my 1,000 hours") or test numbers we don't have.
- Unknowns and theories are labelled out loud ("we don't know yet", "this is a theory"), theories with `[for]` and
  `[against]`. Never present Neon Atlas as Rockstar, Take-Two or official.
- Add `> show:` notes for what the picture should be. If a shot needs footage we don't have, say exactly what to
  record ("30 s driving a sports car along the beach at sunset"); never fill it with someone else's footage.

## 4. Score it to the bar
```bash
python3 studio/tools/script_score.py studio/videos/<slug>/script.md
```
- The bar: 80+ with no dimension under 6 and no rule-breaking finding. Fix the weak stretches it lists (by timestamp)
  and rescore until it passes. Fix the writing, not the score: never add a tag to a line that doesn't do that job,
  stuff keywords, or pad words. If a check is wrong about a line, say so to the user and fix the tool (with a test and
  an `IMPROVEMENTS.md` entry), don't work around it.
- `script_check.py timeline <script>` shows where each unit starts; `script_check.py check <script>` lists findings.

## 5. The read-aloud pass (before the script is final)
```bash
python3 studio/tools/script_check.py read studio/videos/<slug>/script.md --out studio/videos/<slug>/reading-copy.md
```
- Send the user the reading copy (SendUserFile) and ask them to read it aloud once at their normal pace and tell you the
  numbers of the lines they stumbled on (and any word that tripped them).
- Rewrite every line they stumbled on (use `read --map` to find the file line). Record the words or phrases that
  tripped them so every later script is checked for them:
  `python3 studio/tools/script_check.py stumble "phrase" ["phrase" ...]`
- Set `read_aloud: <today's date>` in the front matter and rescore. It is ready to record only when the score says
  `READY TO RECORD`. If the user says "go ahead anyway" below the bar, note that in the front matter as a comment.

## 6. Report and commit
- Tell the user plainly: the score and each dimension, what is still weak, the length at their pace, what footage the
  script needs that we don't have, and whether the read-aloud pass is done. Never report a score you didn't run.
- Commit `script.md`, `source/sources.md`, `reading-copy.md` and `script-score.json` on the branch and push.
  Changes the user asked for that should stick go in `studio/IMPROVEMENTS.md` (dated: feedback, change, files).
