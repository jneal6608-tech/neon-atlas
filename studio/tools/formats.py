"""formats.py: the studio's video formats and what a script for each must hit.

Shared by script_check.py and script_score.py, and later by the edit and QC tools. Not run directly.

The numbers come from studio/CLAUDE.md (the Formats table) and prompts/script-reference-gta.md. Where the two give
different lengths (news: 6-12 min in CLAUDE.md, 10-15 in the reference; lore: 8-15 and 12-20), the allowed range is
the span of both, so a script inside either one is not penalised. Change a number here and every tool follows.

Keys per format:
  length       (min_s, max_s) allowed spoken length in seconds
  ideal        (min_s, max_s) what the reference videos run (script reference); inside `length` but outside this
               costs a little, so a short news video passes but is told it is short of the format
  aim          (min_s, max_s) the length /write-script writes to without asking: the sweet spot of the reference
               videos (DarkViperAU's 12-20 min lore band, MrBossFTW's ~12 min news median, Broughy1322's 7-10 min
               car tests, top 5 Shorts under 60 s). Never padded to reach it: if the verified material runs out,
               the script is shorter (still inside `length`) and says so.
  unit_s       (min_s, max_s) for one claim > evidence > reaction unit
  parts        unit parts every unit needs (tags in the script: [claim] [evidence] [reaction])
  dims         the score dimensions that apply (the rest are "n/a" and the total is rescaled to 100)
  long         long-form (hook rules: authority line, promise, first item before 0:30)
  first_unit_s the latest time the first real item may start
"""

from __future__ import annotations

DIMENSIONS = (
    "length",        # fits the format at the user's pace
    "hook",          # bold specific first line, authority, promise, first item early, no greeting
    "units",         # every unit has claim, evidence, reaction
    "pacing",        # unit lengths, no long stretch without a new item
    "structure",     # the series structure (order said out loud, item count, chapters, method, countdown...)
    "ending",        # recap, the narrator's pick, a question, call to action under 20 s, next episode
    "sourcing",      # every unit cites a source that exists in source/sources.md; reported sources said out loud
    "labels",        # guesses and theories labelled out loud; unofficial; no leaks
    "speakability",  # short sentences, sayable words, no symbols, no tongue-twisters, past stumbles
    "voice",         # reactions are real opinions, varied; transitions carry the viewer
)

LONG_DIMS = DIMENSIONS
SHORT_DIMS = tuple(d for d in DIMENSIONS if d not in ("voice", "ending"))

MIN = 60

FORMATS: dict[str, dict] = {
    "news": dict(length=(6 * MIN, 15 * MIN), ideal=(10 * MIN, 15 * MIN), aim=(10 * MIN, 12 * MIN), unit_s=(15, 45), parts=("claim", "evidence", "reaction"),
                 dims=LONG_DIMS, long=True, first_unit_s=30, items_per_min=(1.3, 3.0), needs_order=True),
    "lore": dict(length=(8 * MIN, 20 * MIN), ideal=(12 * MIN, 20 * MIN), aim=(12 * MIN, 16 * MIN), unit_s=(20, 75), parts=("claim", "evidence", "reaction"),
                 dims=LONG_DIMS, long=True, first_unit_s=30, chapter_s=(60, 180), needs_order=True),
    "cars": dict(length=(6 * MIN, 12 * MIN), ideal=(7 * MIN, 10 * MIN), aim=(8 * MIN, 9 * MIN), unit_s=(20, 60), parts=("claim", "evidence", "reaction"),
                 dims=LONG_DIMS, long=True, first_unit_s=45, needs_order=True),
    "guide": dict(length=(6 * MIN, 12 * MIN), aim=(6 * MIN, 8 * MIN), unit_s=(15, 60), parts=("claim", "evidence", "reaction"),
                  dims=LONG_DIMS, long=True, first_unit_s=30, needs_order=False),
    "topn-short": dict(length=(30, 60), aim=(45, 55), unit_s=(4, 15), parts=("claim", "evidence"),
                       dims=SHORT_DIMS, long=False, first_unit_s=5, needs_order=False),
    "this-or-that-short": dict(length=(30, 60), aim=(40, 55), unit_s=(5, 20), parts=("claim", "evidence"),
                               dims=SHORT_DIMS + ("ending",), long=False, first_unit_s=6, needs_order=False),
    "funny-short": dict(length=(10, 45), aim=(15, 30), unit_s=(0, 45), parts=(),
                        dims=("length", "hook", "labels", "speakability"), long=False, first_unit_s=3,
                        needs_order=False),
}

# Lore has four shapes (script reference, "Structure by series"); `kind:` in the script's front matter picks one.
LORE_KINDS: dict[str, dict] = {
    "investigation": dict(length=(8 * MIN, 20 * MIN), ideal=(12 * MIN, 20 * MIN), aim=(12 * MIN, 16 * MIN)),
    "facts": dict(length=(8 * MIN, 20 * MIN), ideal=(12 * MIN, 20 * MIN), aim=(12 * MIN, 15 * MIN), unit_s=(20, 60)),
    "deep-dive": dict(length=(15 * MIN, 30 * MIN), ideal=(15 * MIN, 30 * MIN), aim=(18 * MIN, 22 * MIN)),
    "theory": dict(length=(15 * MIN, 30 * MIN), ideal=(15 * MIN, 30 * MIN), aim=(15 * MIN, 20 * MIN)),
}

# Formats with no script at all (gameplay uploads are trimmed, not narrated).
UNSCRIPTED = {"gameplay": "gameplay uploads have no voice and no script: nothing to check"}


def spec(fmt: str, kind: str | None = None) -> dict:
    """The rules for one format (and lore kind), as a new dict."""
    if fmt in UNSCRIPTED:
        raise ValueError(UNSCRIPTED[fmt])
    if fmt not in FORMATS:
        raise ValueError(f"unknown format {fmt!r}: use one of {', '.join(sorted(FORMATS))}")
    out = dict(FORMATS[fmt])
    out["format"] = fmt
    if fmt == "lore" and kind:
        if kind not in LORE_KINDS:
            raise ValueError(f"unknown lore kind {kind!r}: use one of {', '.join(sorted(LORE_KINDS))}")
        out.update(LORE_KINDS[kind])
    out["kind"] = kind
    return out
