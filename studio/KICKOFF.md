# First message for a session that builds the studio's tools

Paste this as the first message of a new Claude Code session on `jneal6608-tech/neon-atlas`:

---

We're building the Neon Atlas video studio's tools in `studio/`, from scratch. Read `CLAUDE.md`, `studio/CLAUDE.md`,
`studio/BRIEF.md` and `studio/prompts/script-reference-gta.md` first.

The tools are built fresh, separate from my animation studio: don't attach or copy from `jneal6608-tech/animation-studio`.
What each tool must do is in `studio/BRIEF.md` under "Tools"; how scripts should sound is in the script reference.

Work through the build order in `studio/BRIEF.md`, one step at a time, starting with step 1 (the GTA script mode:
`/write-script`, `tools/script_check.py`, `tools/script_score.py` and their tests). For each step:
1. build it in `studio/tools/` (slash commands in the root `.claude/commands/`), with usage in each tool's docstring;
2. add tests for anything that computes (scores, timing, loudness, QC) and run them;
3. run `bash studio/tools/ensure_deps.sh` once there is something to install;
4. show me what it does on a real example (for step 1: score a sample script);
5. log the change in `studio/IMPROVEMENTS.md`, commit, and push.

Work on a branch, never `main` (pushing to `main` deploys the website). When a step is done, open a pull request and ask me
before merging. Stop at the end of each step and tell me plainly what works, what was tested and what's left.
If a step needs something only I can give (footage, a recording, a music track, an API key), ask instead of faking it.

---
