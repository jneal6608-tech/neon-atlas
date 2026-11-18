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
