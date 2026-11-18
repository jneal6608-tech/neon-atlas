# Neon Atlas Studio

(The video side of the Neon Atlas repository; the website is the rest of it.)

Your own GTA 6 gameplay + your own voice → YouTube guides, explainers, theories, top-N Shorts and gameplay uploads for the
Neon Atlas channel. Faceless, mostly automated: you play, record and read the script; the studio researches, writes,
edits, mixes and checks.

- `CLAUDE.md`: the studio rules (Claude reads these every session).
- `BRIEF.md`: every decision so far, the tools to build, and the build order.
- `IMPROVEMENTS.md`: every piece of feedback and what changed so it sticks.

## Tools built so far

| Step | Tool | Run |
|---|---|---|
| 1 | `/write-script <format> <topic>` | the slash command: sources, script, score to 80+, read-aloud pass |
| 1 | `tools/script_score.py` | `python3 studio/tools/script_score.py videos/<slug>/script.md`: score /100, weak stretches by time |
| 1 | `tools/script_check.py` | `check`, `timeline`, `read` (reading copy), `stumble` (record words you tripped on) |
| 1 | `tools/ensure_deps.sh` | `bash studio/tools/ensure_deps.sh`: installs only what is missing |

Script markup: `prompts/script-template.md`. Your pace: `voice.json` (165 wpm until measured). Tests:
`python3 -m pytest studio/tools/tests` (also run on every studio pull request).

Unofficial fan project. Not affiliated with Rockstar Games or Take-Two Interactive.
