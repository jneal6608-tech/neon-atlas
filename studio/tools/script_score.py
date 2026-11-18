#!/usr/bin/env python3
"""script_score.py: score a Neon Atlas script out of 100 and say whether it can go to recording.

Runs every check in script_check.py, scores ten dimensions out of 10 (length, hook, units, pacing, structure,
ending, sourcing, labels, speakability, voice), and lists the weak stretches by timestamp. Each dimension starts at
10 and loses each finding's cost; the total is the dimensions' sum rescaled to 100 (a dimension that does not apply
to the format, such as "voice" for a top-5 Short, is left out of the total).

The bar (studio/CLAUDE.md rule 5): 80+ with no dimension under 6, and no rule-breaking finding (missing spoiler
warning, presenting Neon Atlas as official, leaked material). Then the read-aloud pass (`read_aloud:` date in the
front matter) before recording.

Usage:
  python3 studio/tools/script_score.py videos/<slug>/script.md [--wpm 165] [--json] [--no-save] [--all]
      --json     machine-readable result
      --no-save  don't write script-score.json next to the script (it is written by default, with the script's
                 hash, so QC can tell whether the score is for the current text)
      --all      list every finding, not just the weak stretches
Exit codes: 0 ready (score bar met), 1 not ready, 2 the script could not be read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import formats  # noqa: E402
import script_check as sc_mod  # noqa: E402
from script_check import Finding, Script, mmss  # noqa: E402

PASS_TOTAL = 80
PASS_DIMENSION = 6.0
WEAK_COST = 1.0       # a stretch is weak when its findings cost at least this much, or it has an error


def score_findings(dims: tuple[str, ...], findings: list[Finding]) -> dict[str, float]:
    scores = {}
    for d in dims:
        lost = sum(f.cost for f in findings if f.dimension == d)
        scores[d] = round(max(0.0, 10.0 - lost), 1)
    return scores


def total_of(scores: dict[str, float]) -> int:
    if not scores:
        return 0
    return round(sum(scores.values()) / (10 * len(scores)) * 100)


def weak_stretches(sc: Script, findings: list[Finding], limit: int = 10) -> list[dict]:
    """Group timed findings by the unit or section they fall in; return the weak ones in time order."""
    spans: dict[tuple, dict] = {}
    for f in findings:
        if f.time is None or f.cost <= 0:
            continue
        unit = next((u for u in sc.units if u.start <= f.time < u.end or (f.time == u.start)), None)
        if unit is not None:
            key = ("unit", unit.index)
            span = (unit.start, unit.end, unit.label)
        else:
            # the last section that has started by then (a finding on a boundary belongs to the section it opens)
            started = [s for s in sc.sections if s.lines and s.start <= f.time]
            sec = started[-1] if started else (sc.sections[0] if sc.sections else None)
            key = ("section", sec.title if sec else "?")
            span = (sec.start, sec.end, sec.title if sec else "?") if sec else (f.time, f.time, "?")
        entry = spans.setdefault(key, {"start": span[0], "end": span[1], "where": span[2], "cost": 0.0,
                                       "errors": 0, "issues": []})
        entry["cost"] += f.cost
        entry["errors"] += f.severity == "error"
        entry["issues"].append(f"{f.dimension}: {f.message}")
    weak = [e for e in spans.values() if e["cost"] >= WEAK_COST or e["errors"]]
    weak = sorted(weak, key=lambda e: -e["cost"])[:limit]
    for e in weak:
        e["cost"] = round(e["cost"], 1)
    return sorted(weak, key=lambda e: e["start"])


def script_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def score(path: str | Path, wpm: float | None = None) -> dict:
    sc = sc_mod.parse(path, wpm)
    findings = sc_mod.run_checks(sc)
    dims = score_findings(sc.spec["dims"], findings)
    total = total_of(dims)
    blockers = [f.message for f in findings if f.blocker]
    low = [d for d, v in dims.items() if v < PASS_DIMENSION]
    meets_bar = total >= PASS_TOTAL and not low and not blockers
    read_aloud = sc.meta.get("read_aloud")
    if not meets_bar:
        reasons = []
        if total < PASS_TOTAL:
            reasons.append(f"score {total} is under {PASS_TOTAL}")
        if low:
            reasons.append("under 6: " + ", ".join(f"{d} {dims[d]:g}" for d in low))
        if blockers:
            reasons.append("breaks a studio rule: " + "; ".join(blockers))
        verdict = "NOT READY: " + "; ".join(reasons)
    elif read_aloud:
        verdict = f"READY TO RECORD (read-aloud pass done {read_aloud})"
    else:
        verdict = "READY FOR THE READ-ALOUD PASS (then record)"
    return {
        "script": str(sc.path),
        "scored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": script_hash(sc.path),
        "total": total,
        "dimensions": dims,
        "not_applicable": [d for d in formats.DIMENSIONS if d not in dims],
        "meets_bar": meets_bar,
        "ready_to_record": meets_bar and bool(read_aloud),
        "verdict": verdict,
        "measures": sc_mod.measures(sc),
        "weak_stretches": weak_stretches(sc, findings),
        "findings": [f.as_dict() for f in findings],
    }


def bar(v: float) -> str:
    n = int(round(v))
    return "#" * n + "." * (10 - n)


def report(res: dict, show_all: bool = False) -> str:
    m = res["measures"]
    lo, hi = m["target_s"]
    pace = f"{m['wpm']:g} wpm" + ("" if m["wpm_measured"] else " (default until your pace is measured)")
    rows = [
        f"Script: {res['script']}",
        f"Format: {m['format']}   {m['words']} words   {mmss(m['duration_s'])} at {pace}   "
        f"(target {mmss(lo)}-{mmss(hi)})",
        f"Units: {m['units']}   chapters: {m['chapters']}   first item at {mmss(m['first_unit_s'])}   "
        f"avg sentence {m['avg_sentence_words']} words   sources: {m['sources']}",
        "",
        f"SCORE {res['total']}/100",
    ]
    for d, v in res["dimensions"].items():
        flag = "  <- under 6" if v < PASS_DIMENSION else ""
        rows.append(f"  {d:<13} {v:>4g}/10  {bar(v)}{flag}")
    for d in res["not_applicable"]:
        rows.append(f"  {d:<13}  n/a")
    rows += ["", res["verdict"], ""]
    if res["weak_stretches"]:
        rows.append("Weak stretches:")
        for w in res["weak_stretches"]:
            rows.append(f"  {mmss(w['start'])}-{mmss(w['end'])}  {w['where']}  (-{w['cost']:g})")
            for issue in w["issues"]:
                rows.append(f"      - {issue}")
    else:
        rows.append("Weak stretches: none")
    untimed = [f for f in res["findings"] if f["time"] is None and f["cost"] > 0]
    if untimed:
        rows += ["", "Whole-script findings:"]
        for f in untimed:
            rows.append(f"  - {f['dimension']}: {f['message']} (-{f['cost']:.1f})")
    if show_all:
        rows += ["", "All findings:", sc_mod.format_findings([Finding(**f) for f in res["findings"]])]
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("script")
    ap.add_argument("--wpm", type=float)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-save", action="store_true")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args(argv)
    try:
        res = score(args.script, args.wpm)
    except (OSError, ValueError) as e:
        print(f"script_score: {e}", file=sys.stderr)
        return 2
    if not args.no_save:
        out = Path(args.script).parent / "script-score.json"
        out.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(res, indent=2) if args.json else report(res, args.all))
    return 0 if res["meets_bar"] else 1


if __name__ == "__main__":
    sys.exit(main())
