# Being first: Google, AI Overviews, ChatGPT and Perplexity

Goal: when a GTA VI question becomes answerable, ours is the first good, verified answer that search engines and AI assistants can find and quote.

## How each one finds answers

| Where people ask | Where its answers come from | What we do |
| --- | --- | --- |
| **Google search + AI Overviews** | Google's own index | Search Console verified; sitemap with exact `lastmod`; **Request indexing** in URL Inspection for every important new or updated page (do this by hand, within minutes of shipping) |
| **ChatGPT search** | Mainly **Bing's index**, plus OpenAI's crawler `OAI-SearchBot` | **Bing Webmaster Tools** + **IndexNow** pings on every deploy (automatic); `OAI-SearchBot`/`ChatGPT-User` allowed in robots.txt |
| **Microsoft Copilot / Bing** | Bing's index | Same as above |
| **Perplexity** | Its own crawler + web search | `PerplexityBot` allowed |
| **Claude, Gemini and other assistants** | Their search tools and crawlers | Crawlers allowed; `/llms.txt` and `/llms-full.txt` give a clean plain-text map of every answer |

No one can guarantee placement or citation. These steps maximise how quickly we're found and how quotable we are.

## Built in

1. **Quick answer box** at the top of every page: 1–2 sentences, with the exact update time (US Eastern). Answer engines quote the clearest, freshest direct answer, so write it first, every time.
2. **Exact freshness signals:** `updatedAt` time in the page, in `Article` structured data (`dateModified`) and in the sitemap `lastmod`.
3. **robots.txt** explicitly welcomes Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, GPTBot, PerplexityBot, ClaudeBot, Google-Extended, Applebot and others.
4. **/llms.txt** (a summary of every answer, with links) and **/llms-full.txt** (full text), regenerated on every build.
5. **IndexNow:** after each deploy, changed URLs are pushed to Bing, Yandex, Seznam and others (`tools/indexnow.mjs`).
6. **Launch live page** (`/news/gta-6-launch-live/`) with `LiveBlogPosting` structured data, in the nav and on the homepage. Every newly published page appears on it automatically, newest first, exactly like the home page's Recent news; hand-written updates (`--live`) sit alongside them.
7. **Official-source watcher:** checks Rockstar's pages every 15 minutes and alerts you with what changed.
8. **Launch-ready answer pages:** 11 top launch-day questions already exist as private skeletons (switching characters, saving, loading-screen fixes, servers, settings, tips, length, missions, money, wanted level, cheats), plus controls and GTA Online. When you verify an answer, you fill one in and ship; you don't start from zero.

## One-time setup (after the site is live)

1. **Google Search Console:** verify, submit `sitemap.xml` (see DEPLOYMENT.md).
2. **Bing Webmaster Tools** (https://www.bing.com/webmasters): sign in, choose **Import from Google Search Console** (fastest) or add the site manually, then submit `sitemap.xml`. Bing feeds ChatGPT search, so don't skip this.
3. **IndexNow:** nothing to do. The key file is published automatically at `/<key>.txt` and the deploy workflow pings after each deploy. To test by hand: `npm run indexnow -- --all`.
4. **Watch alerts:** in GitHub, Watch the repository → All activity (or Custom → Issues), and turn on GitHub mobile notifications.

## The 10-minute answer (launch night)

1. **Verify** the answer on your console (note PS5 or Xbox and the game version).
2. Open the prepared page (e.g. `content/articles/gta-6-how-to-save.md`, or in the CMS). Write the **answer** field first, then the opening sentence, then fill only the sections you've verified. Delete the rest; add more later.
3. Add a **source**: your own gameplay notes count as `type: community` with a link to the page itself, or link Rockstar's page if official.
4. Ship it. The new page goes to the top of the live updates by itself; add `--live` only when you want your own wording or an update that isn't a new page:

```bash
npm run ship -- gta-6-how-to-save --live "How saving works in GTA VI: answer verified on PS5." --note "Published."
```

5. In Google Search Console, use **URL Inspection → Request indexing** for that URL.
6. Post the link where people are asking (in the format each community allows, and only where it actually answers the question).

Expand the page over the next hours and re-ship; each update refreshes `updatedAt` and pings IndexNow again.

## What not to do

- Don't publish guesses to be "first". A wrong first answer gets corrected by other sites, loses trust, and AI assistants learn to skip us.
- Don't mass-produce near-empty pages for every possible query. Google treats that as spam, and it can hurt the whole site.
- Don't copy other sites' answers or screenshots.
