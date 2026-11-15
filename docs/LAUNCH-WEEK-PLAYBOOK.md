# Launch-week operating system

GTA VI launches **Thursday, November 19, 2026**. Most of the year's search demand for "how do I…" questions arrives in the next 10 days. This playbook turns questions into verified answers quickly, without publishing guesses.

## The loop (run it 2–3 times a day in launch week)

1. **Collect** questions from:
   - Search Console → Performance → Queries (best: real search demand; data lags about 2 days).
   - The site's own search (GA4 → `search` events → `search_term`).
   - Contact-form messages and comments.
   - Social and Reddit. Log these too, but they count as **watch** signals, not search demand.

   Log each one:

   ```bash
   node tools/editorial.mjs add-question "gta 6 stuck on loading screen" --source search --count 3
   ```

2. **Spot recurring problems:** `node tools/editorial.mjs questions` groups near-duplicates and weights them by source (search 3, email/comments/site-search 2, social 1).
3. **Prioritise:** `npm run report` merges questions, stale pages, Search Console gaps and backlog items into one ranked "Tomorrow's priorities" list, with a reason for each.
4. **Assign:** `node tools/editorial.mjs assign q0012 bl025`. Each question maps to an existing article (expand it) or a backlog item (write it).
5. **Update existing guides first.** Adding an answer to a page that already ranks beats starting a new page. Add a FAQ entry and an `updateLog` line.
6. **Verify** before publishing:
   - In-game facts: reproduce it yourself on your console, and note the platform and game version.
   - Community discoveries: reproduce them, or find two independent confirmations; credit the finder.
   - Official facts: link the Rockstar page.
   - Anything you couldn't verify stays in `fact-checking`, or goes out labelled *unconfirmed* if readers need to know it's circulating.
7. **Publish fast:** short and correct beats long and late. Publish the answer and a short page, then expand it. Set `status: published` and `lastVerified`, and push (or save in the CMS). The site deploys in about 1–2 minutes.

## Daily schedule (launch week)

| When | Do |
| --- | --- |
| Morning | `npm run report`; re-verify flagged pages; import the latest Search Console CSV (from day 3 onwards). |
| Midday | Play and verify: work through the two or three "requires gameplay" backlog items at the top of the report. |
| Evening | Publish verified answers; update the launch-week hub; log new questions. |

## Launch-day order of work

1. **Nov 18 evening:** the checklist page auto-publishes. Re-verify the release-time and pre-load pages for any late Rockstar posts.
2. **Unlock:** confirm the actual unlock time in your region, then update the release-time page (reported → confirmed where possible).
3. **First 2 hours of play:** controls, saving, and character switching (the top-priority backlog items). Publish as soon as each is verified.
4. **First evening:** troubleshooting page (loading screens, crashes), only listing fixes that actually work. Link to Rockstar Support.
5. **Day 2–3:** beginner tips, mission list started, best settings, money basics.

## Guardrails

- Social-media popularity is not search demand. A viral clip doesn't justify a page unless people are also searching for it.
- Never copy another site's walkthrough or screenshots. Use your own play and your own words.
- Don't publish exploits that could get players banned or that break platform rules.
- Spoilers: story pages carry spoiler warnings in the intro; keep titles spoiler-free.

## Speed tools

See [ANSWER-ENGINES.md](ANSWER-ENGINES.md): the 10-minute answer routine (`npm run ship`), live updates (`npm run live`), the official-source watcher and IndexNow.
