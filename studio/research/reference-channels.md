# Reference channels: what their numbers say (2026-11-18)

Measured from each channel's uploads list on 2026-11-18 (`uploads-<channel>-2026-11-18.txt`: views | seconds | id |
title; MrBossFTW's latest 60 uploads, DarkViperAU's latest 360, Broughy1322's latest 90). Views are YouTube's rounded
counts at that moment, so newer videos are under-counted. This is the title, length and topic half of the study. The
script half (hooks, structure, pacing) needs transcripts: YouTube blocks transcript downloads from cloud sessions, so the
user pastes them into the chat (YouTube: the video's "...more" > "Show transcript"). They are not committed (this repository
is public; `research/transcripts/` is git-ignored). The script half is `../prompts/script-reference-gta.md` (2026-11-18).

## MrBossFTW: the news format we copy

- Every upload is long-form: median **12.1 min** (6-26). 8-12 min and 12-20 min do about the same (80K vs 84K median),
  so **10-15 min** is the target for a news video.
- **The title formula** (39 of 60 titles): `<hype opener> For GTA 6 - <item>, <item>, <item> & MORE!`, median 96
  characters, every title has an ALL-CAPS word, no questions.
  - Openers that recur: "This Is HUGE For GTA 6 -", "This GTA 6 Update Is AWESOME -", "GTA 6 Just Got A NEW Update -",
    "NEW GTA 6 Gameplay Details Revealed -", "Rockstar Just Released NEW ...".
  - The items are the actual news, most concrete first ("How Romance Works, Random Events, Stealing Supercars & MORE!").
- Top: "NEW GTA 6 Gameplay Details Revealed - How Romance Works, Random Events, Stealing Supercars & MORE!" (229K, 15.7 min).
- Bottom: vague curiosity titles ("99.9% Of GTA 6 Fans Completely Missed This...", 29K; "Rockstar Games Did This OVER 10
  Years Ago For GTA 6...", 26K). **Lesson: name the news in the title; a mystery with no concrete item does worst.**

## DarkViperAU: the lore and deep-dive topics we learn from

- Median 116K views. By length: 3-8 min 31K, 8-12 min 155K, **12-20 min 227K (the sweet spot)**, 20-40 min 86K, 40 min+
  157K (his speedruns and challenges, carried by his personality; not our format).
- What wins without his persona: **looking behind the game** ("I Looked Behind GTA V's Cutscenes... It Gets Weird", 1.3M)
  and **numbered fact series** ("GTA 5 Facts and Glitches You Don't Know #100", 797K: a series a hundred episodes long).
  Also "Can you <challenge>?" questions (87 question titles of 351).
- Bottom: weekly-update and ramble videos (9K-12K). **Lesson: his audience comes for discoveries, not updates; leave
  weekly-update news to the news series.**
- For us: a numbered **"GTA 6 Facts You Don't Know #1, #2..."** series and **"I looked behind ..."** investigations, 12-20 min.

## Broughy1322: the car format

- Median 21K views; his live and race content is most of the list. What breaks out is **testing**:
  "GTA 6 Car Handling & Physics Analysis" (152K, 31.5 min) and **"I Tested Every Car In GTA 4!" (129K, 8.1 min)**, then
  "Fastest <DLC> Cars (Day One) - GTA 5 Best Cars Tier List" (48K, 6.9 min).
- Titles are short and plain: median 48 characters, `<What> - GTA 5 <Series name>` ("Fastest Supercars - GTA 5 Best
  Cars Countdown").
- For us: **"I Tested Every Car In GTA 6"** (by class, as the cars become known), **"Fastest <class> - GTA 6 Best Cars
  Countdown"**, and a day-one physics/handling explainer. 7-10 min unless it is a full analysis.

## What this means for the scripts (confirmed by transcripts: see `../prompts/script-reference-gta.md`)

1. News: 10-15 min, title by the MrBossFTW formula, the most concrete item first, never a bare mystery.
2. Lore: 12-20 min, a discovery or a question, numbered when it is a series.
3. Cars: 7-10 min countdowns or "I tested", plain titles with the series name; numbers we measured.
4. Each series keeps its title pattern, so the channel reads as series, not random uploads.
