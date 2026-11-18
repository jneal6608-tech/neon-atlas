#!/usr/bin/env python3
"""script_check.py: measure a Neon Atlas script against prompts/script-reference-gta.md.

Reads a script written in the studio markup (prompts/script-template.md), times every sentence at the user's pace
(studio/voice.json, or --wpm), and reports each problem with its timestamp and the score dimension it counts against.
script_score.py turns these findings into the score out of 100.

Usage (from the repository root or studio/):
  python3 studio/tools/script_check.py check    videos/<slug>/script.md [--wpm 165] [--json]
      every finding, worst first, with its time in the video
  python3 studio/tools/script_check.py timeline videos/<slug>/script.md [--wpm 165]
      each section and unit with its start time and length
  python3 studio/tools/script_check.py read     videos/<slug>/script.md [--out reading-copy.md] [--map]
      the reading copy for the read-aloud pass: spoken words only, numbered lines (--map adds file line numbers)
  python3 studio/tools/script_check.py stumble  "phrase" ["phrase" ...]
      record words the user tripped on in prompts/stumbles.txt; every later script is checked for them
  python3 studio/tools/script_check.py budget   <format> [--kind facts] [--wpm 165]
      the length to write to (chosen per format, not asked) and its word budget at the user's pace

Sources are read from source/sources.md next to the script (or the `sources:` path in the front matter).
Exit codes: 0 checked (findings or not), 2 the script could not be read.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import formats  # noqa: E402

STUDIO = Path(__file__).resolve().parent.parent
REPO = STUDIO.parent
VOICE_FILE = STUDIO / "voice.json"
STUMBLES_FILE = STUDIO / "prompts" / "stumbles.txt"
ARTICLES = REPO / "content" / "articles"

# Line tags. A unit starts at a STARTER tag and runs until the next one.
STARTERS = {"claim", "theory", "step"}
UNIT_TAGS = STARTERS | {"evidence", "reaction", "for", "against", "stat"}
HOOK_TAGS = {"authority", "promise", "order", "spoiler", "answer", "method"}
END_TAGS = {"recap", "pick", "question", "cta", "next", "verdict"}
ALL_TAGS = UNIT_TAGS | HOOK_TAGS | END_TAGS
OPINION_TAGS = {"reaction", "theory", "for", "against", "verdict", "pick"}

PAUSE_S = 0.75  # each [pause] in a line
TAG_RE = re.compile(r"^\[([a-z-]+)\]\s*")
REF_RE = re.compile(r"\[((?:[A-Z]\d+)(?:\s*,\s*[A-Z]\d+)*)\]")
PAUSE_RE = re.compile(r"\[pause\]", re.I)
HEADING_RE = re.compile(r"^(#{2,3})\s+(.*)$")
RANK_RE = re.compile(r"^(?:#|no\.?\s*|number\s+|fact\s+#?|step\s+)?(\d+)\s*[.:)\-]\s*", re.I)
SOURCE_RE = re.compile(r"^\s*[-*]\s*\[([A-Z]\d+)\]\s*(.*)$")
SOURCE_TYPES = {"official", "reported", "article", "gameplay", "press", "other"}

# ---------------------------------------------------------------------------------------------- data


@dataclass
class Sentence:
    text: str
    words: int
    start: float
    end: float
    lineno: int


@dataclass
class Line:
    lineno: int
    tag: str | None
    text: str          # spoken text: tags, refs, pauses and markdown removed
    raw: str
    refs: list[str]
    pauses: int
    section: "Section"
    unit: "Unit | None" = None
    start: float = 0.0
    end: float = 0.0
    sentences: list[Sentence] = field(default_factory=list)

    @property
    def words(self) -> int:
        return sum(s.words for s in self.sentences)


@dataclass
class Unit:
    index: int          # 1-based, in script order
    section: "Section"
    lines: list[Line] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.lines[0].start

    @property
    def end(self) -> float:
        return self.lines[-1].end

    @property
    def duration(self) -> float:
        return self.end - self.start

    def tagged(self, *tags: str) -> list[Line]:
        return [ln for ln in self.lines if ln.tag in tags]

    @property
    def refs(self) -> list[str]:
        return [r for ln in self.lines for r in ln.refs]

    @property
    def label(self) -> str:
        first = self.lines[0].text
        snippet = first if len(first) <= 48 else first[:45].rsplit(" ", 1)[0] + "..."
        return f"unit {self.index} ({self.section.title}): \"{snippet}\""


@dataclass
class Section:
    title: str
    kind: str           # hook | chapter | ending
    lineno: int
    rank: int | None = None
    lines: list[Line] = field(default_factory=list)
    units: list[Unit] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.lines[0].start if self.lines else 0.0

    @property
    def end(self) -> float:
        return self.lines[-1].end if self.lines else 0.0

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class Source:
    id: str
    type: str
    text: str
    lineno: int


@dataclass
class Finding:
    dimension: str
    severity: str       # error | warn | info
    message: str
    cost: float         # points off this dimension (out of 10)
    time: float | None = None
    lineno: int | None = None
    where: str | None = None
    blocker: bool = False   # breaks a studio rule: not ready whatever the score

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass
class Script:
    path: Path
    meta: dict
    spec: dict
    wpm: float
    sections: list[Section]
    lines: list[Line]
    units: list[Unit]
    sources: dict[str, Source]
    sources_path: Path | None
    parse_notes: list[str]

    @property
    def duration(self) -> float:
        return self.lines[-1].end if self.lines else 0.0

    @property
    def words(self) -> int:
        return sum(ln.words for ln in self.lines)

    @property
    def sentences(self) -> list[Sentence]:
        return [s for ln in self.lines for s in ln.sentences]

    def section(self, kind: str) -> Section | None:
        return next((s for s in self.sections if s.kind == kind), None)

    @property
    def chapters(self) -> list[Section]:
        return [s for s in self.sections if s.kind == "chapter"]


# ---------------------------------------------------------------------------------------------- words and time


def mmss(t: float | None) -> str:
    if t is None:
        return "  -  "
    t = max(0, int(t))
    return f"{t // 60}:{t % 60:02d}"


def token_words(tok: str) -> int:
    """How many spoken words a token takes. Numbers are said as more than one word ("two hundred twelve")."""
    core = tok.strip("\"'“”‘’()[]{},;:!?.").replace(",", "")
    m = re.fullmatch(r"\$?(\d+)(?:\.(\d+))?(%|[a-zA-Z]+)?", core)
    if not m:
        return 1 if re.search(r"[A-Za-z0-9]", tok) else 0
    n = int(m.group(1))
    words = 1 if n <= 20 or (n < 100 and n % 10 == 0) else 2 if n < 1000 else 2 if 1900 <= n <= 2099 else 3
    if m.group(2):
        words += 1
    if m.group(3):
        words += 1
    return words


def count_words(text: str) -> int:
    return sum(token_words(t) for t in text.split())


ABBREV = r"(?<!\bMr\.)(?<!\bMrs\.)(?<!\bDr\.)(?<!\bSt\.)(?<!\bvs\.)(?<!\bNo\.)"
SENT_SPLIT = re.compile(r"(?<=[.!?…])" + ABBREV + r"[\"”’)]*\s+(?=[\"“‘(]*[A-Z0-9$])")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in SENT_SPLIT.split(text.strip()) if p.strip()]
    return parts


def clean_spoken(raw: str) -> str:
    text = REF_RE.sub("", raw)
    text = PAUSE_RE.sub("", text)
    text = re.sub(r"\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)", "", text)
    text = re.sub(r"\s+([.,!?;:])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


# ---------------------------------------------------------------------------------------------- parsing


def parse_front_matter(text: str) -> tuple[dict, str, int]:
    """Simple `key: value` front matter between --- lines (no nesting). Returns meta, body, body's first line no."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text, 1
    meta: dict = {}
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            return meta, "\n".join(lines[i + 1:]), i + 2
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        value = re.sub(r"\s+#.*$", "", value).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        low = value.lower()
        if low in ("true", "yes"):
            meta[key.strip()] = True
        elif low in ("false", "no"):
            meta[key.strip()] = False
        elif re.fullmatch(r"-?\d+(\.\d+)?", value):
            meta[key.strip()] = float(value) if "." in value else int(value)
        else:
            meta[key.strip()] = value or None
    raise ValueError("front matter has no closing ---")


def section_kind(title: str) -> str:
    t = title.lower().strip()
    if re.match(r"^(hook|cold open|intro(duction)?|opening)\b", t):
        return "hook"
    if re.match(r"^(ending|outro|conclusion|wrap[- ]?up|verdict)\b", t):
        return "ending"
    return "chapter"


def load_voice_wpm() -> float:
    try:
        return float(json.loads(VOICE_FILE.read_text())["wpm"])
    except (OSError, ValueError, KeyError):
        return 165.0


def parse_sources(path: Path) -> dict[str, Source]:
    sources: dict[str, Source] = {}
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = SOURCE_RE.match(line)
        if not m:
            continue
        sid, rest = m.group(1), m.group(2).strip()
        stype = rest.split("|", 1)[0].strip().lower() if "|" in rest else "other"
        sources[sid] = Source(sid, stype, rest, i)
    return sources


def parse(path: str | Path, wpm: float | None = None) -> Script:
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    meta, body, first_lineno = parse_front_matter(text)
    fmt = (meta.get("format") or "").strip()
    if not fmt:
        raise ValueError("front matter needs `format:` (" + ", ".join(sorted(formats.FORMATS)) + ")")
    sp = formats.spec(fmt, meta.get("kind"))
    wpm = float(wpm or meta.get("wpm") or load_voice_wpm())
    notes: list[str] = []

    sections: list[Section] = []
    lines: list[Line] = []
    units: list[Unit] = []
    current: Section | None = None
    unit: Unit | None = None
    in_comment = False

    for offset, raw in enumerate(body.splitlines()):
        lineno = first_lineno + offset
        s = raw.strip()
        if in_comment:
            if "-->" in s:
                in_comment = False
            continue
        if s.startswith("<!--"):
            if "-->" not in s:
                in_comment = True
            continue
        if not s or s.startswith("# ") or s == "---":
            continue
        h = HEADING_RE.match(s)
        if h:
            if len(h.group(1)) == 3 and current is not None:
                continue  # ### sub-headings are notes for the editor, not chapters
            title = h.group(2).strip()
            rank_m = RANK_RE.match(title)
            current = Section(title=title, kind=section_kind(title), lineno=lineno,
                              rank=int(rank_m.group(1)) if rank_m else None)
            sections.append(current)
            unit = None
            continue
        if current is None:
            current = Section(title="Hook", kind="hook", lineno=lineno)
            sections.append(current)
        if s.startswith(">"):
            current.notes.append(s.lstrip("> ").strip())
            continue
        tag = None
        body_text = s
        m = TAG_RE.match(body_text)
        if m and m.group(1) != "pause":
            tag = m.group(1)
            body_text = body_text[m.end():]
            if tag not in ALL_TAGS:
                notes.append(f"line {lineno}: unknown tag [{tag}] (treated as narration)")
                tag = None
        refs = [r.strip() for grp in REF_RE.findall(body_text) for r in grp.split(",")]
        pauses = len(PAUSE_RE.findall(body_text))
        spoken = clean_spoken(body_text)
        if not spoken and not pauses:
            continue
        line = Line(lineno=lineno, tag=tag, text=spoken, raw=s, refs=refs, pauses=pauses, section=current)
        if current.kind == "chapter" and tag in STARTERS:
            unit = Unit(index=len(units) + 1, section=current)
            units.append(unit)
            current.units.append(unit)
        if current.kind == "chapter" and unit is not None and unit.section is current:
            unit.lines.append(line)
            line.unit = unit
        current.lines.append(line)
        lines.append(line)

    # time every sentence at the user's pace
    t = 0.0
    per_word = 60.0 / wpm
    for line in lines:
        line.start = t
        for sent in split_sentences(line.text) if line.text else []:
            w = count_words(sent)
            line.sentences.append(Sentence(sent, w, t, t + w * per_word, line.lineno))
            t += w * per_word
        t += line.pauses * PAUSE_S
        line.end = t

    sources: dict[str, Source] = {}
    sources_path = None
    candidates = [path.parent / str(meta["sources"])] if meta.get("sources") else []
    candidates += [path.parent / "source" / "sources.md", path.parent / "sources.md"]
    for cand in candidates:
        if cand.is_file():
            sources_path = cand
            sources = parse_sources(cand)
            break

    return Script(path=path, meta=meta, spec=sp, wpm=wpm, sections=sections, lines=lines, units=units,
                  sources=sources, sources_path=sources_path, parse_notes=notes)


# ---------------------------------------------------------------------------------------------- phrase lists

GREETING = re.compile(r"\b(hey|hi|hello|what'?s up),? (guys|everyone|everybody|folks|gamers)|welcome back|"
                      r"in today'?s video|today we'?re (going to|gonna)|what is going on", re.I)
CTA_WORDS = re.compile(r"\b(subscribe|like button|hit (the )?like|smash|notification|the bell|comment below|"
                       r"leave a comment|let me know in the comments|drop a comment|share this)\b", re.I)
AUTHORITY = re.compile(r"\b(sourced|every (fact|claim|number|detail)|we tested|i tested|tested (every|each|all)|"
                       r"our own (testing|tests|footage|gameplay|numbers)|measured|neonatlasguide|neon atlas guide|"
                       r"checked (against|on|every)|straight from rockstar)\b", re.I)
EXPERIENCE = re.compile(r"\b(\d[\d,]* (hours|years)|thousands of hours|years of|expert|veteran|since day one)\b",
                        re.I)
PROMISE = re.compile(r"\b(in this video|coming up|we'?ll|we will|you'?ll|by the end|stick around|later on|"
                     r"some of (these|them)|plus|and then|all the way (to|down)|including|from the .{1,40} to)\b",
                     re.I)
ORDER = re.compile(r"\b(biggest|most important|in order|story order|mission by mission|one by one|counting down|"
                   r"countdown|starting with|start with|slowest to fastest|from (the )?(first|start|top|worst|"
                   r"slowest|smallest)|map order|the order (you|we|they)|number (one|five|ten)|step by step|"
                   r"in the order)\b", re.I)
RECAP = re.compile(r"\b(so that'?s|that'?s (everything|all|every)|to recap|so there you have it|those are|"
                   r"there you have it|in short|all of (this|that)|that was)\b", re.I)
PICK = re.compile(r"\b(my favou?rite|mine (has to be|is|would be)|my (pick|top pick|choice|vote)|for me,|"
                  r"personally|i'?m most (excited|interested)|the one i|if i had to pick)\b", re.I)
NEXT = re.compile(r"\b(next (episode|video|week|part|time|one)|number \d+|#\d+|part \d+|coming next|"
                  r"the next in)\b", re.I)
TRANSITION = re.compile(r"^(speaking of|building (off|on)|and speaking|next|now|which brings|that brings|that leads|"
                        r"on top of that|another|also|meanwhile|but|so|and|remember|which means|moving on|similarly|"
                        r"on the other hand|then|finally|last(ly)?|first|second|third|after that|staying with|"
                        r"sticking with|okay|right|here'?s|this one|the (next|last|other|first|second|third)|"
                        r"if you|one more|before|while|still|even|it|that)\b", re.I)
OPINION = re.compile(r"\b(i|i'?m|i'?d|i'?ve|i'?ll|me|my|honestly|love|loved|hate|great|best|worst|disappoint\w*|"
                     r"excit\w*|weird|funny|wild|wish|hope|think|feel|glad|surpris\w*|annoy\w*|cool|nice|huge|"
                     r"big deal|matters|smart|clever|fair|unfair|shame|good|bad|brilliant|strange|odd|frankly|"
                     r"worth|risky|careful|happy|relief|ouch|nervous|cheeky|bold|bummer|amazing|impressive)\b", re.I)
GUESS = re.compile(r"\b(probably|likely|might|could be|may be|maybe|perhaps|i bet|i'?d bet|presumably|supposedly|"
                   r"apparently|surely|almost certainly|bound to|must be|will probably|expected to|"
                   r"expect (it|them|that|the))\b", re.I)
LABEL = re.compile(r"\b(theory|theories|we don'?t know|we do not know|nobody knows|no one knows|not confirmed|"
                   r"unconfirmed|hasn'?t (been )?confirmed|haven'?t (been )?confirmed|hasn'?t said|not official|"
                   r"our guess|my guess|guess|i think|i reckon|i believe|i suspect|speculation|speculating|"
                   r"who knows|no idea|it would seem|it seems|reportedly|reports?|reported|according to|"
                   r"rumou?r(s|ed)?|unclear|not (yet )?clear|can'?t (say|confirm)|until rockstar|"
                   r"rockstar (hasn'?t|has not)|fans think|some fans|if (that'?s|this is) (true|right))\b", re.I)
FUTURE_CLAIM = re.compile(r"\b(will|is going to|are going to)\s+(definitely\s+)?(launch|release|come|arrive|"
                          r"be added|be coming|get|have|include|feature|cost|return|be playable|be on)\b", re.I)
ATTRIBUTION = re.compile(r"\b(report\w*|according to|says?|said|claims?|claimed|suggests?|told|outlets?|"
                         r"coverage|sources?|cit\w+|writes?|wrote|per)\b", re.I)
OFFICIAL_US = re.compile(r"neon atlas\W+(\w+\W+){0,5}(is|are|as)\W+(the\W+)?official\b|"
                         r"\bofficial\W+neon atlas|\bwe at rockstar\b|\bwe'?re (from )?rockstar\b|"
                         r"\bour (game|studio),? (gta|grand theft)", re.I)
LEAK = re.compile(r"\bleak(s|ed|er)?\b", re.I)
THEORY_LABEL = re.compile(r"\b(theory|theories|i think|i believe|i reckon|it would seem|very likely|"
                          r"we can assume|my guess|fans think|speculat\w+|if (this|that)'?s? (is )?(true|right))\b",
                          re.I)
METHOD_WORDS = re.compile(r"\b(method|tested|test|same|straight|track|upgraded|timed|distance|lap|top speed|"
                          r"measured|stopwatch|speedometer|each car|every car|fully)\b", re.I)
SERIES_WORDS = re.compile(r"\b(series|every week|each week|next video|one video for each|part (one|1)|"
                          r"episode|weekly|coming weeks)\b", re.I)
SPOILER = re.compile(r"\bspoilers?\b", re.I)
GENERIC_CHAPTER = re.compile(r"^(part|chapter|section|segment)\s*\d*$|^\d+$", re.I)

WRITTEN_ONLY = [
    (re.compile(r"\([^)]*\)"), "brackets: nobody says brackets out loud; make it its own sentence"),
    (re.compile(r";"), "semicolon: split into two sentences"),
    (re.compile(r"(?<=\w)/(?=\w)"), "slash: say \"or\" or \"and\""),
    (re.compile(r"\b(e\.g\.|i\.e\.|etc\.|approx\.|cf\.)", re.I), "written abbreviation: say it in full"),
    (re.compile(r"\b\d+(?:\.\d+)?(GB|MB|TB|KB|km|mph|kph|km/h|fps|hz|ms)\b", re.I),
     "number glued to a unit: write the unit as a word (\"212 gigabytes\")"),
    (re.compile(r"\b\d{5,}\b"), "long number: round it or write it as words"),
    (re.compile(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b"), "date in numbers: say the month (\"November nineteenth\")"),
    (re.compile(r"https?://|www\.|\b[\w.-]+@[\w-]+\.\w+"), "URL or email: say it the way a person would"),
    (re.compile(r"[#@]\w+|\s&\s|[|<>=~^]"), "symbol: write the word"),
]
STOPWORDS = {"a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "is", "it", "as", "by", "for", "so"}
NUMBER_WORDS = {w for base in ("one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                               "fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy "
                               "eighty ninety hundred thousand million").split()
                for w in (base, base + "th")} | {"first", "second", "third", "fifth", "ninth", "twelfth"}


def _is_number_word(w: str) -> bool:
    return all(part in NUMBER_WORDS for part in w.split("-") if part)


def syllables(word: str) -> int:
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def load_stumbles() -> list[str]:
    try:
        rows = STUMBLES_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for row in rows:
        row = row.split("#", 1)[0].strip()
        if row:
            out.append(row.split("|", 1)[-1].strip() if "|" in row else row)
    return [p for p in out if p]


# ---------------------------------------------------------------------------------------------- the checks


def per_unit(sc: Script, weight: float) -> float:
    """Cost of one failing unit, so that every unit failing costs `weight` points of 10."""
    return weight / max(1, len(sc.units))


def hook_lines(sc: Script) -> list[Line]:
    hook = sc.section("hook")
    if hook and hook.lines:
        return hook.lines
    first = sc.units[0].start if sc.units else 30
    return [ln for ln in sc.lines if ln.start < min(30, first)]


def ending_lines(sc: Script) -> list[Line]:
    end = sc.section("ending")
    if end:
        return end.lines
    return []


def text_of(lines: list[Line]) -> str:
    return " ".join(ln.text for ln in lines)


def check_length(sc: Script) -> list[Finding]:
    lo, hi = sc.spec["length"]
    d = sc.duration
    out = []
    if d < lo or d > hi:
        f = (lo - d) / lo if d < lo else (d - hi) / hi
        words_lo, words_hi = round(lo / 60 * sc.wpm), round(hi / 60 * sc.wpm)
        side = "short" if d < lo else "long"
        out.append(Finding("length", "error" if f > 0.2 else "warn",
                           f"{mmss(d)} at {sc.wpm:g} wpm is {side} for {sc.spec['format']} ({mmss(lo)}-{mmss(hi)}, "
                           f"about {words_lo}-{words_hi} words; this has {sc.words})", min(10.0, f * 25)))
    elif sc.spec.get("ideal"):
        ilo, ihi = sc.spec["ideal"]
        if d < ilo or d > ihi:
            f = (ilo - d) / ilo if d < ilo else (d - ihi) / ihi
            out.append(Finding("length", "info", f"{mmss(d)} is allowed, but the reference {sc.spec['format']} "
                               f"videos run {mmss(ilo)}-{mmss(ihi)}: " + ("fine for a quick update; a full episode "
                                                                         "has more items" if d < ilo else
                                                                         "make sure every minute earns its place"),
                               min(1.5, f * 4)))
    return out


def check_hook(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    long = sc.spec["long"]
    hook = hook_lines(sc)
    if not sc.lines:
        return [Finding("hook", "error", "the script has no spoken lines", 10)]
    if not sc.section("hook"):
        out.append(Finding("hook", "warn", "no `## Hook` section: the first 30 s were treated as the hook", 1,
                           0.0, sc.lines[0].lineno))
    first = sc.sentences[0]
    if GREETING.search(first.text):
        out.append(Finding("hook", "error", f"opens with a greeting (\"{first.text}\"): start on the bold claim",
                           4, 0.0, first.lineno))
    words = first.text.split()
    specific = re.search(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|every|first|"
                         r"only|never|all)\b", first.text, re.I) or any(w[:1].isupper() for w in words[1:]) \
        or re.search(r"[\"“]", first.text)
    if not specific:
        out.append(Finding("hook", "warn", "the first sentence isn't specific: name the thing, the number or "
                           "the place", 2, 0.0, first.lineno))
    limit = 25 if long else 12
    if len(words) > limit:
        out.append(Finding("hook", "warn", f"the first sentence runs {len(words)} words: the claim should land "
                           f"{'in one breath' if long else 'in the first second'} (under {limit})", 1.5, 0.0,
                           first.lineno))
    if first.text.rstrip().endswith("?"):
        out.append(Finding("hook", "warn", "the first sentence is a question: open on a bold claim instead", 1,
                           0.0, first.lineno))
    for ln in hook:
        if CTA_WORDS.search(ln.text) or re.search(r"\bwelcome (back )?to\b", ln.text, re.I):
            out.append(Finding("hook", "error", "subscribe/like or channel intro in the hook: no call to action "
                               "at the start", 3, ln.start, ln.lineno))
    if long:
        auth = [ln for ln in hook if ln.tag == "authority" or AUTHORITY.search(ln.text)]
        if not auth:
            out.append(Finding("hook", "warn", "no authority line in the hook (ours: every fact sourced, or we "
                               "tested it ourselves)", 2, hook[0].start if hook else 0, None))
        for ln in auth:
            if EXPERIENCE.search(ln.text):
                out.append(Finding("hook", "warn", "the authority line claims hours or years of experience: keep "
                                   "it only if it is true (ours is sourcing and our own testing)", 2, ln.start,
                                   ln.lineno))
        if len(auth) > 2:
            out.append(Finding("hook", "info", "more than one authority line: one line, never more", 0.5,
                               auth[1].start, auth[1].lineno))
        if not any(ln.tag == "promise" or PROMISE.search(ln.text) for ln in hook):
            out.append(Finding("hook", "warn", "no promise of what's coming and its variety", 2,
                               hook[0].start if hook else 0))
    if sc.units:
        limit_s = sc.spec["first_unit_s"]
        if sc.spec["format"] == "lore" and sc.meta.get("cold_open"):
            limit_s = 60
        start = sc.units[0].start
        if start > limit_s:
            late = start - limit_s
            out.append(Finding("hook", "error" if late > 15 else "warn",
                               f"the first item starts at {mmss(start)}: it should start before {mmss(limit_s)}",
                               min(5.0, 1 + late / 8), start, sc.units[0].lines[0].lineno))
    elif sc.spec["parts"]:
        out.append(Finding("hook", "warn", "no items found, so the first item never starts", 2))
    if sc.meta.get("spoilers"):
        if not any(SPOILER.search(s.text) for s in sc.sentences if s.start < 15):
            out.append(Finding("hook", "error", "the script has story spoilers (front matter) but no spoiler "
                               "warning in the first 15 s", 5, 0.0, None, blocker=True))
    return out


def check_units(sc: Script) -> list[Finding]:
    parts = sc.spec["parts"]
    if not parts:
        return []
    if not sc.units:
        return [Finding("units", "error", "no units: start each item with a [claim] line (then [evidence], "
                        "[reaction])", 10)]
    out = []
    for u in sc.units:
        if "evidence" in parts and u.lines[0].tag != "theory" and not u.tagged("evidence", "stat"):
            has_refs = bool(u.refs)
            out.append(Finding("units", "warn",
                               f"{u.label}: no [evidence] line" + (" (it cites a source, but say who says it or "
                                                                   "show the proof)" if has_refs else ""),
                               per_unit(sc, 3 if has_refs else 5), u.start, u.lines[0].lineno, u.label))
        if "reaction" in parts and not u.tagged("reaction", "verdict"):
            out.append(Finding("units", "warn", f"{u.label}: no [reaction] line (one honest opinion per unit)",
                               per_unit(sc, 5), u.start, u.lines[0].lineno, u.label))
    return out


def check_pacing(sc: Script) -> list[Finding]:
    out = []
    lo, hi = sc.spec["unit_s"]
    for u in sc.units:
        d = u.duration
        if d > hi or d < lo:
            weight = 4 if d > 2 * hi else 2.5
            shown = f"{d:.1f}" if d < 10 else f"{d:.0f}"
            out.append(Finding("pacing", "warn", f"{u.label} runs {shown} s ({lo}-{hi} s for "
                               f"{sc.spec['format']}): " + ("split it or cut it down" if d > hi else
                                                            "give it its proof or fold it into the next one"),
                               per_unit(sc, weight), u.start, u.lines[0].lineno, u.label))
    if sc.spec["long"] and sc.units:
        # longest stretch with no new item (hook to first unit excluded: that is the hook's check)
        marks = [u.start for u in sc.units]
        end = sc.section("ending")
        marks.append(end.start if end and end.lines else sc.duration)
        limit = 90 if sc.spec["format"] in ("lore", "cars") else 75
        for a, b in zip(marks, marks[1:]):
            if b - a > limit and not any(u.start == a and u.duration > hi for u in sc.units):
                out.append(Finding("pacing", "warn", f"{b - a:.0f} s from {mmss(a)} with no new item (over "
                                   f"{limit} s): the viewer needs a new beat", 1.5, a))
    return out


def ranks_descending(sections: list[Section]) -> bool | None:
    ranks = [s.rank for s in sections if s.rank is not None]
    if len(ranks) < 2:
        return None
    return all(a > b for a, b in zip(ranks, ranks[1:]))


def check_structure(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    fmt, kind = sc.spec["format"], sc.spec.get("kind")
    hook = hook_lines(sc)
    hook_text = text_of(hook)
    minutes = max(sc.duration / 60, 0.1)
    if sc.spec.get("needs_order") and not any(ln.tag == "order" or ORDER.search(ln.text) for ln in hook):
        out.append(Finding("structure", "warn", "the order isn't said out loud in the hook (biggest first, story "
                           "order, discovery order, a countdown)", 2, 0.0))
    article = sc.meta.get("article")
    if article and not (ARTICLES / f"{article}.md").is_file():
        out.append(Finding("structure", "error" if fmt == "guide" else "warn",
                           f"article `{article}` is not in content/articles/", 3 if fmt == "guide" else 1))

    if fmt == "news":
        lo, hi = sc.spec["items_per_min"]
        rate = len(sc.units) / minutes
        if rate < lo:
            out.append(Finding("structure", "warn", f"{len(sc.units)} items in {mmss(sc.duration)} "
                               f"({rate:.1f} a minute): news runs about 2 a minute (20-30 in 10-15 min)", 2))
        if rate > hi:
            out.append(Finding("structure", "warn", f"{len(sc.units)} items in {mmss(sc.duration)} is rushed "
                               f"({rate:.1f} a minute)", 1.5))
    if fmt == "lore":
        lo, hi = sc.spec["chapter_s"]
        chapters = sc.chapters
        if len(chapters) < max(2, int(sc.duration // hi)):
            out.append(Finding("structure", "warn", f"{len(chapters)} chapters in {mmss(sc.duration)}: lore needs "
                               f"a named chapter every 1.5-3 min", 2.5))
        over = [c for c in chapters if c.duration > hi * 1.15]
        for c in over[:4]:
            out.append(Finding("structure", "warn", f"chapter \"{c.title}\" runs {mmss(c.duration)}: split it "
                               f"(chapters every 1.5-3 min)", 1, c.start, c.lineno, f"chapter {c.title}"))
        if kind == "facts":
            unnumbered = [c for c in chapters if c.rank is None]
            if unnumbered:
                out.append(Finding("structure", "warn", f"{len(unnumbered)} fact chapters have no number "
                                   f"(\"## 3. ...\")", 1, unnumbered[0].start, unnumbered[0].lineno))
        if kind in ("theory", "deep-dive") and not THEORY_LABEL.search(hook_text) and kind == "theory":
            out.append(Finding("structure", "warn", "a theory episode should say in the hook that it is a theory",
                               2, 0.0))
    if fmt in ("lore", "guide", "cars"):
        for c in sc.chapters:
            if GENERIC_CHAPTER.match(re.sub(RANK_RE, "", c.title).strip() or c.title):
                out.append(Finding("structure", "info", f"chapter \"{c.title}\" needs a specific name", 0.5,
                                   c.start, c.lineno))
    if fmt == "cars":
        intro = hook + (sc.chapters[0].lines if sc.chapters and re.search("method|how we test", sc.chapters[0].title,
                                                                         re.I) else [])
        hits = {m.group(0).lower() for ln in intro for m in METHOD_WORDS.finditer(ln.text)}
        if not any(ln.tag == "method" for ln in intro) and len(hits) < 3:
            out.append(Finding("structure", "error", "the test method isn't explained up front (where, how it is "
                               "timed, how cars are set up): the method is what makes the numbers trusted", 4, 0.0))
        if ranks_descending(sc.chapters) is False:
            out.append(Finding("structure", "warn", "countdown numbers don't run down to 1: the winner is the "
                               "payoff at the end", 3))
        if not SERIES_WORDS.search(hook_text):
            out.append(Finding("structure", "info", "the series isn't announced up front (\"one video for each "
                               "class\")", 1, 0.0))
    if fmt == "guide":
        query = sc.meta.get("query")
        if not query:
            out.append(Finding("structure", "error", "front matter needs `query:` (the one search this guide "
                               "answers)", 3))
        else:
            qwords = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if w not in STOPWORDS | {"gta", "6", "vi"}}
            early = " ".join(s.text for s in sc.sentences if s.start < 30).lower()
            found = {w for w in qwords if w in early}
            if not any(ln.tag == "answer" for ln in hook) and qwords and len(found) < max(1, len(qwords) // 2):
                out.append(Finding("structure", "warn", f"the answer to \"{query}\" isn't in the first 30 s", 3,
                                   0.0))
        if not article:
            out.append(Finding("structure", "warn", "front matter needs `article:` (the matching Neon Atlas "
                               "article)", 2))
        if len(sc.units) < 3:
            out.append(Finding("structure", "warn", "fewer than 3 steps: a guide shows its steps one by one", 2))
        if len(sc.chapters) < 3 and sc.duration > 240:
            out.append(Finding("structure", "info", "fewer than 3 chapters: guides get chapters", 1))
    if fmt == "topn-short":
        n = int(sc.meta.get("top") or 5)
        if len(sc.units) != n:
            out.append(Finding("structure", "error", f"top {n} has {len(sc.units)} ranked items", 4))
        if ranks_descending(sc.chapters) is False:
            out.append(Finding("structure", "warn", "ranks don't count down to number 1 (the payoff is last)", 3))
        if n >= 10 and len(sc.units) >= 10:
            first7 = max(u.duration for u in sc.units[:7])
            if min(u.duration for u in sc.units[-3:]) <= first7:
                out.append(Finding("structure", "warn", "a top 10 gives the last three the most time: rush the "
                                   "first seven", 2))
    if fmt == "this-or-that-short":
        if len(sc.units) < 2:
            out.append(Finding("structure", "error", "this-or-that needs at least two rounds", 4))
        for u in sc.units:
            if not re.search(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred)\b",
                             text_of(u.lines), re.I):
                out.append(Finding("structure", "warn", f"{u.label}: no stat (each round is one number)",
                                   per_unit(sc, 4), u.start, u.lines[0].lineno, u.label))
    return out


def check_ending(sc: Script) -> list[Finding]:
    fmt = sc.spec["format"]
    end = ending_lines(sc)
    out: list[Finding] = []
    if fmt == "this-or-that-short":
        if not any(ln.tag == "verdict" for ln in sc.lines[-4:]):
            out.append(Finding("ending", "error", "no [verdict]: this-or-that ends on a verdict", 5,
                               sc.duration))
        return out
    if not end:
        return [Finding("ending", "error", "no `## Ending` section (recap, your pick, a question, a short call "
                        "to action)", 6, sc.duration)]
    t0 = end[0].start
    txt = [ln.text for ln in end]
    if not any(ln.tag == "recap" or RECAP.search(ln.text) for ln in end):
        out.append(Finding("ending", "warn", "no recap line", 2, t0))
    if not any(ln.tag == "pick" or PICK.search(ln.text) for ln in end):
        out.append(Finding("ending", "warn", "no narrator's pick (\"mine has to be...\")", 2, t0))
    if not any(ln.tag == "question" or (s.text.endswith("?") and re.search(r"\byou(r|rs|'d|'re|'ll)?\b", s.text, re.I))
               for ln in end for s in ln.sentences):
        out.append(Finding("ending", "warn", "no question for the viewer", 2, t0))
    cta_s = 0.0
    for ln in end:
        if ln.tag == "cta":
            cta_s += ln.end - ln.start
        else:
            cta_s += sum(s.end - s.start for s in ln.sentences if CTA_WORDS.search(s.text))
    if cta_s > 20:
        out.append(Finding("ending", "warn", f"the call to action runs {cta_s:.0f} s: keep it under 20 s",
                           min(4.0, (cta_s - 20) / 5 + 1), t0))
    if (sc.meta.get("series") or sc.meta.get("episode")) and not any(ln.tag == "next" or NEXT.search(t)
                                                                     for ln, t in zip(end, txt)):
        out.append(Finding("ending", "warn", "a series episode names the next one at the end", 2, t0))
    return out


def check_sourcing(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    fmt = sc.spec["format"]
    refs = [(ln, r) for ln in sc.lines for r in ln.refs]
    needs_sources = fmt in ("news", "lore", "cars", "guide", "topn-short", "this-or-that-short")
    if sc.sources_path is None:
        if needs_sources:
            out.append(Finding("sourcing", "error", "no source/sources.md next to the script: every fact needs a "
                               "source", 8 if not refs else 5))
        return out
    if not sc.sources and needs_sources:
        out.append(Finding("sourcing", "error", f"{sc.sources_path.name} lists no sources (`- [S1] official | ...`)",
                           8))
    missing = [(ln, r) for ln, r in refs if r not in sc.sources]
    for ln, r in missing[:4]:
        out.append(Finding("sourcing", "error", f"[{r}] is not in {sc.sources_path.name}", 2, ln.start, ln.lineno))
    for s in sc.sources.values():
        if s.type not in SOURCE_TYPES:
            out.append(Finding("sourcing", "warn", f"[{s.id}] has type `{s.type}`: use one of "
                               f"{', '.join(sorted(SOURCE_TYPES))}", 0.5, None, None))
        if LEAK.search(s.text):
            out.append(Finding("sourcing", "error", f"[{s.id}] looks like leaked material: never use leaks", 5,
                               blocker=True))
        if s.type == "gameplay" and not re.search(r"\bclip\b|\.mp4|\.mov|footage/", s.text, re.I):
            out.append(Finding("sourcing", "info", f"[{s.id}] is gameplay but names no clip", 0.5))
    if needs_sources:
        for u in sc.units:
            unit_refs = u.refs
            if not unit_refs:
                out.append(Finding("sourcing", "warn", f"{u.label}: no source cited", per_unit(sc, 8), u.start,
                                   u.lines[0].lineno, u.label))
            elif fmt == "cars" and not any(sc.sources.get(r) and sc.sources[r].type == "gameplay"
                                           for r in unit_refs):
                out.append(Finding("sourcing", "warn", f"{u.label}: car numbers must be ours: cite the test clip "
                                   f"(a gameplay source)", per_unit(sc, 5), u.start, u.lines[0].lineno, u.label))
    if fmt == "news" and sc.sources and not any(s.type == "official" for s in sc.sources.values()):
        out.append(Finding("sourcing", "warn", "no official source: news comes from verified sources", 2))
    flagged = 0
    for ln in sc.lines:
        srcs = [sc.sources[r] for r in ln.refs if r in sc.sources]
        if srcs and all(s.type == "reported" for s in srcs) and not ATTRIBUTION.search(ln.text):
            publisher = [p.strip() for s in srcs for p in s.text.split("|")[1:2]]
            if not any(p and p.lower() in ln.text.lower() for p in publisher):
                flagged += 1
                if flagged <= 4:
                    out.append(Finding("sourcing", "warn", "a reported (not official) fact is said as plain fact: "
                                       "say who reports it", 1, ln.start, ln.lineno,
                                       ln.unit.label if ln.unit else ln.section.title))
    for s in sorted(set(sc.sources) - {r for _, r in refs}):
        out.append(Finding("sourcing", "info", f"[{s}] is listed but never cited", 0))
    return out


def check_labels(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    guesses = 0
    for ln in sc.lines:
        if ln.tag in OPINION_TAGS:
            continue
        prev = ""
        for s in ln.sentences:
            label = LABEL.search(s.text) or LABEL.search(prev)
            if GUESS.search(s.text) and not label:
                guesses += 1
                if guesses <= 6:
                    out.append(Finding("labels", "warn", f"a guess said as fact: \"{s.text}\" (say it's a guess, "
                                       f"or source it)", 1.5, s.start, s.lineno,
                                       ln.unit.label if ln.unit else ln.section.title))
            elif FUTURE_CLAIM.search(s.text) and not ln.refs and not label:
                guesses += 1
                if guesses <= 6:
                    out.append(Finding("labels", "warn", f"a claim about the future with no source: \"{s.text}\"",
                                       1, s.start, s.lineno, ln.unit.label if ln.unit else ln.section.title))
            prev = s.text
    for u in sc.units:
        if not u.tagged("theory"):
            continue
        if not THEORY_LABEL.search(text_of(u.lines)):
            out.append(Finding("labels", "error", f"{u.label}: a theory not called a theory out loud", 3, u.start,
                               u.lines[0].lineno, u.label))
        if not u.tagged("against"):
            out.append(Finding("labels", "error", f"{u.label}: a theory with no evidence against it", 3, u.start,
                               u.lines[0].lineno, u.label))
        if not u.tagged("for", "evidence"):
            out.append(Finding("labels", "warn", f"{u.label}: a theory with no evidence for it", 1.5, u.start,
                               u.lines[0].lineno, u.label))
    for ln in sc.lines:
        if OFFICIAL_US.search(ln.text):
            out.append(Finding("labels", "error", "presents Neon Atlas as official or as Rockstar: we are an "
                               "unofficial fan guide", 5, ln.start, ln.lineno, blocker=True))
        if LEAK.search(ln.text) and not re.search(r"\b(never|not|no|don'?t|won'?t|avoid|fake|ignore)\b", ln.text,
                                                  re.I):
            out.append(Finding("labels", "warn", "mentions a leak: we never use or promote leaked material", 2,
                               ln.start, ln.lineno))
    return out


def check_speakability(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    stumbles = load_stumbles()
    lengths = []
    for ln in sc.lines:
        where = ln.unit.label if ln.unit else ln.section.title
        for s in ln.sentences:
            n = len(s.text.split())
            lengths.append(n)
            if n > 35:
                out.append(Finding("speakability", "error", f"{n}-word sentence: split it (\"{s.text[:60]}...\")",
                                   1.5, s.start, s.lineno, where))
            elif n > 25:
                out.append(Finding("speakability", "warn", f"{n}-word sentence: split it (\"{s.text[:60]}...\")",
                                   0.7, s.start, s.lineno, where))
            words = re.findall(r"[A-Za-z']+", s.text)
            long_words = [w for w in words if syllables(w) >= 4 and not w[:1].isupper()]
            if len(long_words) >= 3:
                out.append(Finding("speakability", "warn", f"dense: {', '.join(long_words[:4])} in one sentence",
                                   0.5, s.start, s.lineno, where))
            spoken = [t.strip(".,!?;:\"'“”‘’()").lower() for t in s.text.split()]
            low = [w for w in spoken if w and w[0].isalpha() and w not in STOPWORDS and not _is_number_word(w)]
            for i in range(len(low) - 3):
                if len({w[0] for w in low[i:i + 4]}) == 1 and low[i][0] not in "aeiou":
                    out.append(Finding("speakability", "warn", "tongue-twister: \"" + " ".join(low[i:i + 4]) +
                                       "\"", 0.7, s.start, s.lineno, where))
                    break
        for rx, why in WRITTEN_ONLY:
            m = rx.search(ln.text)
            if m:
                out.append(Finding("speakability", "warn", f"\"{m.group(0).strip()}\": {why}", 0.5, ln.start,
                                   ln.lineno, where))
        for phrase in stumbles:
            if re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", ln.text, re.I):
                out.append(Finding("speakability", "warn", f"\"{phrase}\": the user stumbled on this before "
                                   f"(prompts/stumbles.txt)", 1, ln.start, ln.lineno, where))
    if lengths:
        avg = sum(lengths) / len(lengths)
        if avg > 16:
            out.append(Finding("speakability", "warn", f"sentences average {avg:.1f} words: aim for 10-16",
                               min(3.0, (avg - 16) * 0.6)))
    return out


def check_voice(sc: Script) -> list[Finding]:
    out: list[Finding] = []
    reactions = [ln for u in sc.units for ln in u.tagged("reaction")]
    for u in sc.units:
        rs = u.tagged("reaction")
        if rs and not any(OPINION.search(r.text) for r in rs):
            out.append(Finding("voice", "warn", f"{u.label}: the reaction reads as information, not an opinion",
                               per_unit(sc, 5), rs[0].start, rs[0].lineno, u.label))
    openers: dict[str, int] = {}
    for r in reactions:
        key = " ".join(r.text.lower().split()[:2])
        openers[key] = openers.get(key, 0) + 1
    for key, n in openers.items():
        if n >= 3 and n / max(1, len(reactions)) > 0.3:
            out.append(Finding("voice", "warn", f"{n} of {len(reactions)} reactions start \"{key}...\": vary them",
                               2))
    if sc.spec["long"] and len(sc.units) >= 4:
        carried = 0
        for prev, u in zip(sc.units, sc.units[1:]):
            lead = u.lines[0].text
            before = [ln for ln in u.section.lines if ln.end <= u.start and ln.unit is None]
            tail = prev.lines[-1].text if prev.lines else ""
            last_tail = split_sentences(tail)[-1] if tail else ""
            if TRANSITION.search(lead) or any(TRANSITION.search(b.text) for b in before) or \
                    re.search(r"\b(next|which brings|speaking of|that brings)\b", last_tail, re.I):
                carried += 1
        share = carried / (len(sc.units) - 1)
        if share < 0.3:
            out.append(Finding("voice", "warn", f"only {carried} of {len(sc.units) - 1} items are carried in by a "
                               f"transition (\"Speaking of...\", \"Building on that...\")", 2))
    return out


CHECKS = {
    "length": check_length,
    "hook": check_hook,
    "units": check_units,
    "pacing": check_pacing,
    "structure": check_structure,
    "ending": check_ending,
    "sourcing": check_sourcing,
    "labels": check_labels,
    "speakability": check_speakability,
    "voice": check_voice,
}

SEVERITY_ORDER = {"error": 0, "warn": 1, "info": 2}


def run_checks(sc: Script) -> list[Finding]:
    found: list[Finding] = []
    for dim in sc.spec["dims"]:
        found.extend(CHECKS[dim](sc))
    for note in sc.parse_notes:
        found.append(Finding("speakability", "info", note, 0))
    return found


def measures(sc: Script) -> dict:
    hook = hook_lines(sc)
    lens = [len(s.text.split()) for s in sc.sentences]
    return {
        "format": sc.spec["format"] + (f" ({sc.spec['kind']})" if sc.spec.get("kind") else ""),
        "wpm": sc.wpm,
        "wpm_measured": _voice_measured() and not sc.meta.get("wpm"),
        "words": sc.words,
        "duration_s": round(sc.duration, 1),
        "target_s": list(sc.spec["length"]),
        "aim_s": list(sc.spec["aim"]),
        "aim_words": [round(x / 60 * sc.wpm) for x in sc.spec["aim"]],
        "units": len(sc.units),
        "chapters": len(sc.chapters),
        "hook_s": round(hook[-1].end, 1) if hook else 0,
        "first_unit_s": round(sc.units[0].start, 1) if sc.units else None,
        "avg_sentence_words": round(sum(lens) / len(lens), 1) if lens else 0,
        "sources": len(sc.sources),
        "read_aloud": sc.meta.get("read_aloud"),
    }


def _voice_measured() -> bool:
    try:
        return bool(json.loads(VOICE_FILE.read_text()).get("measured"))
    except (OSError, ValueError):
        return False


# ---------------------------------------------------------------------------------------------- commands


def reading_copy(sc: Script, show_map: bool = False) -> str:
    title = sc.meta.get("title") or sc.path.parent.name
    out = [f"# Reading copy: {title}", "",
           f"Read it aloud once, at your normal pace. Note the number of every line you stumble on. "
           f"About {mmss(sc.duration)} at {sc.wpm:g} words a minute.", ""]
    n = 0
    for sec in sc.sections:
        if not sec.lines:
            continue
        out.append(f"## {sec.title}  ({mmss(sec.start)})")
        out.append("")
        for ln in sec.lines:
            if not ln.text:
                continue
            n += 1
            ref = f"  [line {ln.lineno}]" if show_map else ""
            out.append(f"{n:>3}. {ln.text}{ref}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def timeline(sc: Script) -> str:
    rows = [f"{'start':>6} {'len':>5}  part"]
    for sec in sc.sections:
        if not sec.lines:
            continue
        rows.append(f"{mmss(sec.start):>6} {sec.duration:4.0f}s  ## {sec.title}")
        for u in sec.units:
            rows.append(f"{mmss(u.start):>6} {u.duration:4.0f}s     {u.label}")
    rows.append(f"{mmss(sc.duration):>6}        end ({sc.words} words at {sc.wpm:g} wpm)")
    return "\n".join(rows)


def add_stumbles(phrases: list[str]) -> list[str]:
    seen = {p.lower() for p in load_stumbles()}
    added = []
    for p in (p.strip() for p in phrases):
        if p and p.lower() not in seen:
            seen.add(p.lower())
            added.append(p)
    if added:
        header = "" if STUMBLES_FILE.exists() else (
            "# Words and phrases the user stumbled on in a read-aloud pass. script_check.py flags them in every\n"
            "# script. One per line: `date | phrase`. Add with: python3 studio/tools/script_check.py stumble \"...\"\n")
        with STUMBLES_FILE.open("a", encoding="utf-8") as fh:
            fh.write(header)
            for p in added:
                fh.write(f"{date.today().isoformat()} | {p}\n")
    return added


def budget(fmt: str, kind: str | None = None, wpm: float | None = None) -> dict:
    """The length /write-script writes to for a format, and how many words that is at the user's pace."""
    sp = formats.spec(fmt, kind)
    wpm = float(wpm or load_voice_wpm())
    lo, hi = sp["aim"]
    return {"format": fmt, "kind": kind, "wpm": wpm, "aim_s": [lo, hi],
            "aim_words": [round(lo / 60 * wpm), round(hi / 60 * wpm)], "allowed_s": list(sp["length"]),
            "units": sp.get("items_per_min") and [round(lo / 60 * 2), round(hi / 60 * 2)]}


def format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "No findings."
    rows = []
    for f in sorted(findings, key=lambda f: (SEVERITY_ORDER[f.severity], f.time if f.time is not None else -1)):
        line = f" L{f.lineno}" if f.lineno else ""
        rows.append(f"{f.severity.upper():5} {mmss(f.time):>5}{line:>6}  {f.dimension:<12} -{f.cost:.1f}  "
                    f"{f.message}")
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "timeline", "read"):
        p = sub.add_parser(name)
        p.add_argument("script")
        p.add_argument("--wpm", type=float)
        if name == "check":
            p.add_argument("--json", action="store_true")
        if name == "read":
            p.add_argument("--out")
            p.add_argument("--map", action="store_true")
    p = sub.add_parser("stumble")
    p.add_argument("phrases", nargs="+")
    p = sub.add_parser("budget")
    p.add_argument("format")
    p.add_argument("--kind")
    p.add_argument("--wpm", type=float)
    args = ap.parse_args(argv)

    if args.cmd == "budget":
        try:
            b = budget(args.format, args.kind, args.wpm)
        except ValueError as e:
            print(f"script_check: {e}", file=sys.stderr)
            return 2
        items = f", about {b['units'][0]}-{b['units'][1]} items" if b["units"] else ""
        print(f"{args.format}{' (' + args.kind + ')' if args.kind else ''}: write to {mmss(b['aim_s'][0])}-"
              f"{mmss(b['aim_s'][1])}, about {b['aim_words'][0]}-{b['aim_words'][1]} words at {b['wpm']:g} wpm"
              f"{items}. Allowed {mmss(b['allowed_s'][0])}-{mmss(b['allowed_s'][1])}; never pad to reach it.")
        return 0

    if args.cmd == "stumble":
        added = add_stumbles(args.phrases)
        print(f"added {len(added)} to {STUMBLES_FILE.relative_to(REPO)}: {', '.join(added) or '(already there)'}")
        return 0
    try:
        sc = parse(args.script, args.wpm)
    except (OSError, ValueError) as e:
        print(f"script_check: {e}", file=sys.stderr)
        return 2
    if args.cmd == "timeline":
        print(timeline(sc))
    elif args.cmd == "read":
        copy = reading_copy(sc, args.map)
        if args.out:
            Path(args.out).write_text(copy, encoding="utf-8")
            print(f"wrote {args.out}")
        else:
            print(copy, end="")
    else:
        findings = run_checks(sc)
        if args.json:
            print(json.dumps({"measures": measures(sc), "findings": [f.as_dict() for f in findings]}, indent=2))
        else:
            m = measures(sc)
            print(f"{sc.path}: {m['format']}, {m['words']} words, {mmss(sc.duration)} at {sc.wpm:g} wpm, "
                  f"{m['units']} units")
            print(format_findings(findings))
    return 0


if __name__ == "__main__":
    sys.exit(main())
