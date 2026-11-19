# Neon Atlas

This repository has two parts:

1. **The website** (everything outside `studio/`): Neon Atlas, an unofficial, independent GTA VI guide at
   neonatlasguide.com. How it works, its content rules and its commands are in `README.md` and `docs/`. Run `npm test`
   before any site change is called done.
2. **The video studio** (`studio/`): the user's own GTA 6 gameplay and voice turned into YouTube guides, explainers,
   theories, top-N Shorts and gameplay uploads. Its rules are in `studio/CLAUDE.md` and its decisions in
   `studio/BRIEF.md`: read both before any studio work.

## Always

- **Pushing to `main` deploys the live website** (`.github/workflows/deploy.yml`). Work on a branch; changes reach `main`
  by pull request, and Claude merges only after asking the user and getting a yes for that pull request.
- Neon Atlas is unofficial: never present it as Rockstar Games or Take-Two, on the site or in a video.
- Raw gameplay footage never goes in git.
- **No generated or AI art, ever.** Every picture on the site (article heroes, cards, share images, theory images,
  inline images) is a real GTA VI picture: an official Rockstar image or our own gameplay screenshot
  (`assets/ours/art/` or `assets/uploads/`). Screenshots are cropped to the game screen only (no room, no people, no
  reflections) and saved fresh so photo metadata is removed. This applies to new articles and to any existing page.
- **Spoilers are hidden until clicked.** Every story spoiler on the site goes in a `> [!SPOILER]` box (a "View spoiler"
  button reveals it). Never put a spoiler in a title, description, quick answer, heading, picture or thumbnail; a FAQ
  whose answer is a spoiler ends its question with "(spoilers)". This applies to new articles and to any existing page.
- **Use the user's own game pictures first.** When the user has sent screenshots for a topic, use one as that article's
  cover (`assets/ours/art/<slug>.jpg`, `-card`, `-share`), which the build prefers over official Rockstar art, so covers
  vary and show real gameplay. Every new post gets `publishedAt` (exact time) so Recent news lists it first.
