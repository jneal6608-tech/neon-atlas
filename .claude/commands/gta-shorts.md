---
description: Turn a GTA 6 gameplay MP4 into 3-5 funny-moment Shorts (Claude picks the moments, writes the meme caption, title and description); stops at the storyboard
argument-hint: [path to gameplay.mp4 or a Drive file name] [model] (optional)
---

Make funny-moment Shorts from GTA 6 gameplay: $ARGUMENTS

Work from `studio/`, on a branch. Read `studio/CLAUDE.md` and `studio/BRIEF.md` first. The tool is
`tools/gta_shorts.py` (its docstring has every option); the rubric Claude follows is `prompts/gta-funny-shorts.md`.

1. **Get the footage.** A local path: use it. A Google Drive name: download only that file into `footage/raw/`.
   Only the user's own PS5 gameplay (studio rule 1). Run `bash tools/ensure_deps.sh` if anything is missing.
2. **Analyze.** `python3 tools/gta_shorts.py analyze <file> --model <model> --effort medium --count 4`. The model is
   the user's choice (default `claude-opus-5-5`; `claude-haiku-5-5` is the cheapest; `offline` needs no key). It needs
   `ANTHROPIC_API_KEY` in `studio/.env`; without it the offline scorer runs and the job notes say so.
3. **Stop at the storyboard (rule 6).** Show the user each pick's storyboard image
   (`footage/gta-shorts/<job>/storyboard/short-NN.jpg`), caption, title, cut times and why. Apply any edits they ask
   for (the page does this, or edit `job.json` picks and re-run the storyboard). Render nothing until they say approved.
4. **Render** only the Shorts the user chose: `python3 tools/gta_shorts.py render <job> --picks 1,3`. Report each render's checks
   exactly as printed (PASS, or the problems). The studio's full `tools/qc.py` gate doesn't exist yet: say so.
5. **Hand over** `renders/*.mp4` and `package.md` (titles, descriptions, hashtags). After upload, delete the job folder
   and any raw clip (rule 10).

The user can do all of this without Claude Code: `python3 tools/gta_shorts.py serve`, then open http://localhost:8765.
Any taste change the user asks for goes into `prompts/gta-funny-shorts.md` or the tool, with an `IMPROVEMENTS.md` entry
(rule 8).
