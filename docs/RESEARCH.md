# Research: opportunity, competition, keywords (2026-11-15)

## Method and its limits

- **Primary sources checked directly** (fetched November 15, 2026): Rockstar's official GTA VI site (`/VI`), the "Only in Leonida" character and region page, the Editions page, and the Rockstar Store product page including its FAQ text.
- **Could not be read directly:** Rockstar Newswire article bodies (JavaScript-rendered) and the Rockstar Support editions article (timed out). Facts that only appear there are labelled *reported* on the site.
- **Search landscape:** web searches run today for release date and time, pre-load and size, editions and bonuses, characters, and search interest.
- **Not available:** Google Trends, Search Console (the site is new) and any keyword-volume tool. So the keyword database contains **no search volumes**. Demand and competition are labelled levels, each with its basis.

## What is officially confirmed (as of 2026-11-15)

Release November 19, 2026 · PS5 and Xbox Series X|S only · pre-load open since November 10 · Standard ($79.99 US, digital or code-in-box) and Ultimate (digital) · physical box = download code, no disc · PlayStation codes region-locked · Vintage Vice City Pack for orders before November 20 · free GTA+ month for PS/Microsoft Store pre-orders, with redemption deadlines · minimum age 17 (US store) · eight official character entries · six official regions with descriptions.

**Reported only:** 212 GB size; midnight-local unlock; $99.99 Ultimate price.
**Unconfirmed:** PC version, GTA Online for GTA VI, day-one patch, map size.

## Search interest signals (measured by others, not by us)

- Benzinga, citing Google Trends: searches for "GTA"/"GTA VI" recently reached their highest point since the June 2026 pre-order period (relative interest, not volume).
- Google's 2025 Year in Search: coverage places "Grand Theft Auto 6" 7th in one games list and 9th in another, behind ARC Raiders and Battlefield 6.
- Interest is event-driven: coverage notes it cools in quiet periods and spikes with each Rockstar update. Launch week will be the biggest spike of the cycle.

## Historical launch patterns (estimates from GTA V and RDR2)

From how searches behaved around GTA V (2013) and Red Dead Redemption 2 (2018):

1. **Before launch:** release date and time, pre-load and size, editions, price, platforms (especially PC).
2. **Launch day and week:** unlock time, troubleshooting (stuck loading, crashes, servers), controls, saving, character switching, beginner tips.
3. **First month:** mission lists and walkthroughs, money, cheats (a huge evergreen GTA query), collectibles, vehicles and locations, story length, ending explained.
4. **Long term:** secrets and easter eggs, updates and DLC, online content, a PC version if announced.

These are informed estimates, labelled as such in the database.

## Competition (observed in search results)

- **Release date/time, pre-load, editions:** crowded. About 10 dedicated pages each from large outlets (Forbes, Engadget, TweakTown, Insider Gaming) and many fan sites. Common weaknesses: unlock times stated as fact while sources disagree; a confusing mix of Rockstar's and retailers' claims; outdated pre-delay dates still on some pages; few sources listed.
- **Fan wikis** (gta.wiki, gtabase, wikily.gg and others) cover characters broadly but mix in leaked or speculative names.
- **Underserved, found today:** the official GTA+ redemption steps and deadlines (only in a store FAQ); the PlayStation code region-lock table; which purchase types qualify for which bonus; "Which Xbox runs GTA 6".

## Strategy conclusion

We can't out-publish big outlets on volume or out-rank them on breaking news. Where we can win:

1. **Trust as the product:** confirmed/reported labels, source lists and last-verified dates on every page. No competitor does this consistently.
2. **Practical, specific answers** that larger sites skip: deadlines, region locks, eligibility tables, troubleshooting.
3. **Launch-week speed** on troubleshooting and first-hours questions, published only after verification.
4. **Long-tail mechanics guides** in the first month, where big outlets write one broad guide and leave specific questions unanswered.

## Files

- `data/keywords.json` / `data/keywords.csv`: 74 opportunities, priority-scored (`node tools/keywords.mjs`).
- `data/backlog.json`: 34 article opportunities with outlines, sources, value and publishability.
