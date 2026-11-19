# Funny-moment Shorts: what the research says (2026-11-19)

Research done before building `tools/gta_shorts.py`, so Claude picks moments by what YouTube actually measures. It feeds
`prompts/gta-funny-shorts.md`. Most public writing on the Shorts algorithm comes from creator-tool vendors, not YouTube,
so each point says how solid it is.

## Confirmed by YouTube

- YouTube Studio shows a **"Viewed vs. swiped away"** figure for every Short ("how many chose to view": the share of
  times viewers watched the Short instead of swiping past it). YouTube has not said this exact number is a ranking
  input, but it is the number YouTube itself puts in front of creators for Shorts.

## Widely reported, not confirmed by YouTube

- **A test audience first, then wider.** Each Short is shown to a small audience in the feed; if they watch, it is shown
  to more people, in steps; if they swipe, distribution tapers off.
- **The first 1-2 seconds decide most swipes.** Sources agree most swipes happen in the first two seconds, and advise
  putting the best moment (or the danger just before it) first and cutting the setup down to the minimum.
- **Retention and replays.** After the hook, sources point at how much of the Short is watched and whether it loops.
  Loop and replay effects are one vendor's claim, not confirmed.
- **Benchmarks disagree.** "Viewed" ratios cited as good range from 60% to 70-90%, and the cut-offs where pushing
  supposedly stops differ (40% swipe in 3 s, or under 50% viewed). Treat them as rough guides; the real benchmark is
  our own numbers in Studio, logged with `tools/retention.py` once it exists.

## Funny gaming moments specifically

- A funny moment needs **setup, escalation, payoff and ideally a reaction**; missing setup is the most common reason a
  funny moment dies as a clip.
- **Fails are the backbone of GTA funny moments** and the easiest to understand without context; stunts that somehow
  work are funny through disbelief.
- **Lead with the action**: start just before the danger or the flashy moment, not with the walk-up.
- **Captions carry the joke for sound-off viewers**; overlay text works when it is big and short.
- Clipping tools use exclamations ("no way", "what the", laughter) in the player's audio to find peaks. Loud spikes
  in the game audio (crashes, explosions) do the same, which is what our audio signal measures.
- Nothing found on the specific slang captions ("bro didn't see this coming 💀", "ain't no way 😭") performing better or
  worse; that style is the user's choice for the channel, and the numbers will tell.

## What this means for the tool

1. Candidates come from where the game gets suddenly loud or the picture suddenly changes, plus an even overview of the
   whole video so quiet funny moments (an NPC doing something odd) are not missed.
2. Claude scores each moment on: readable in 1-2 s, surprise, a clear payoff, loopability, works on its own.
3. Cuts start 1-3 s before the setup, punch in on the payoff, and end 0.5-2 s after it, 10-30 s long (the studio's
   `funny-short` format: 10-45 s).
4. One meme caption for the whole Short, placed clear of YouTube's buttons and title overlay.
5. 3-5 Shorts per video when the footage has them, and fewer rather than weak ones.

## Sources

- [How the YouTube Shorts Algorithm Works in 2026, in YouTube's Words (OutlierKit)](https://outlierkit.com/resources/youtube-shorts-algorithm/)
- [How Does the YouTube Shorts Algorithm Work in 2026? (vidIQ)](https://vidiq.com/blog/post/youtube-shorts-algorithm/)
- [YouTube Shorts Analytics: Which Metrics Actually Matter (Subscribr)](https://subscribr.ai/youtube-strategy/youtube-shorts-analytics-metrics-viral)
- [YouTube Shorts analytics: retention, swipes, subscriber gains (ContentStudio)](https://contentstudio.io/blog/youtube-shorts-analytics-guide)
- [YouTube Shorts retention benchmarks (Bytecap)](https://www.bytecap.io/research/youtube-shorts-retention-benchmarks)
- [The YouTube Shorts Algorithm in 2026 (EasyViral)](https://easyviral.ai/api/blog-md/youtube-shorts-algorithm-2026)
- [How to Clip GTA Funny Moments for TikTok and YouTube Shorts (AutoClip)](https://autoclip.dev/blog/how-to-clip-gta-funny-moments)
- [Gaming shorts viral pattern (DOR)](https://clip.dor.gg/en/blog/gaming-shorts-viral-pattern)
- [How to make gaming Shorts on YouTube (AIR Media-Tech)](https://air.io/en/youtube-hacks/how-to-make-gaming-shorts-on-youtube)
- [Best practices for text captions and memes (Eklipse)](https://eklipse.gg/help/what-are-the-best-practices-for-using-text-captions-and-popular-memes-to-increase-viewer-engagement/)
- [GTA 5 funny moments (Eklipse)](https://blog.eklipse.gg/streaming-tips/gta-5-funny-moments.html)
