"""Tests for script_check.py: word counts, timing, parsing and each check from the script reference."""

import json

import pytest

import script_check as c


def words(n: int, word: str = "word") -> str:
    return " ".join([word] * n)


def findings_for(path, dimension=None):
    sc = c.parse(path)
    found = c.run_checks(sc)
    return sc, [f for f in found if dimension is None or f.dimension == dimension]


def messages(found):
    return " | ".join(f.message for f in found)


# ------------------------------------------------------------------------------------------ words and time

@pytest.mark.parametrize("token,expected", [
    ("Leonida", 1), ("PS5", 1), ("7", 1), ("40", 1), ("79", 2), ("212", 2), ("2026", 2), ("12345", 3),
    ("$79.99", 3), ("50%", 2), ("—", 0), ("seventy-nine", 1),
])
def test_token_words(token, expected):
    assert c.token_words(token) == expected


def test_mmss():
    assert c.mmss(0) == "0:00"
    assert c.mmss(59.9) == "0:59"
    assert c.mmss(394.6) == "6:34"
    assert c.mmss(None).strip() == "-"


def test_sentence_split_keeps_prices_and_abbreviations():
    parts = c.split_sentences("It costs $79.99 in the US. Mr. Duval agrees. Really? Yes!")
    assert parts == ["It costs $79.99 in the US.", "Mr. Duval agrees.", "Really?", "Yes!"]


def test_timing_at_the_users_pace(write_script):
    # 165 words at 165 wpm is exactly one minute; a [pause] adds 0.75 s
    path = write_script(f"## Hook\n{words(165)}.\n[pause] {words(55)}.", wpm=165)
    sc = c.parse(path)
    assert sc.words == 220
    assert sc.lines[0].end == pytest.approx(60.0)
    assert sc.lines[1].start == pytest.approx(60.0)
    assert sc.duration == pytest.approx(60.0 + 0.75 + 20.0)


def test_wpm_override_and_voice_file(write_script, tmp_path, monkeypatch):
    path = write_script(f"## Hook\n{words(150)}.")
    assert c.parse(path).duration == pytest.approx(150 / 165 * 60)       # default
    assert c.parse(path, wpm=150).duration == pytest.approx(60)          # --wpm
    voice = tmp_path / "measured.json"
    voice.write_text(json.dumps({"wpm": 180, "measured": True}))
    monkeypatch.setattr(c, "VOICE_FILE", voice)
    assert c.parse(path).duration == pytest.approx(50)                   # the user's measured pace


# ------------------------------------------------------------------------------------------ parsing

def test_parse_sections_units_refs_and_notes(write_script):
    path = write_script("""
<!-- a comment
over two lines -->
## Hook
GTA 6 is out on Thursday. [S1]
## 2. The unlock time
Next, the time.
[claim] It unlocks at midnight. [S2]
> show: the store countdown
[evidence] Outlets report it. [S2, S1]
[reaction] I love that.
[claim] Second unit.
### an editor's sub-heading
[evidence] Proof. [G1]
## Ending
[recap] That's all.
""")
    sc = c.parse(path)
    assert [s.kind for s in sc.sections] == ["hook", "chapter", "ending"]
    chapter = sc.sections[1]
    assert chapter.rank == 2 and chapter.title == "2. The unlock time"
    assert chapter.notes == ["show: the store countdown"]
    assert len(sc.units) == 2
    first = sc.units[0]
    assert [ln.tag for ln in first.lines] == ["claim", "evidence", "reaction"]
    assert first.refs == ["S2", "S2", "S1"]
    assert sc.units[1].refs == ["G1"]
    # tags, refs and notes are not spoken
    assert all("[" not in ln.text and "show:" not in ln.text for ln in sc.lines)
    assert sc.lines[0].text == "GTA 6 is out on Thursday."
    # the lead-in before the first claim is narration, not part of a unit
    assert sc.lines[1].text == "Next, the time." and sc.lines[1].unit is None
    assert set(sc.sources) == {"S1", "S2", "G1"} and sc.sources["S2"].type == "reported"


def test_parse_errors(write_script, tmp_path):
    bad = tmp_path / "bad.md"
    bad.write_text("---\ntitle: x\n---\nHello.\n")
    with pytest.raises(ValueError, match="format"):
        c.parse(bad)
    with pytest.raises(ValueError, match="unknown format"):
        c.parse(write_script("Hi.", fmt="podcast"))
    with pytest.raises(ValueError, match="no voice"):
        c.parse(write_script("Hi.", fmt="gameplay"))
    with pytest.raises(ValueError, match="lore kind"):
        c.parse(write_script("Hi.", fmt="lore", kind="gossip"))


def test_unknown_tag_is_reported(write_script):
    sc = c.parse(write_script("## Hook\n[clam] A typo in a tag."))
    assert sc.lines[0].tag is None
    assert "unknown tag [clam]" in sc.parse_notes[0]


# ------------------------------------------------------------------------------------------ the checks

def unit(n: int = 1, claim="It is out on Thursday.", evidence="Rockstar's site says so. [S1]",
         reaction="I honestly love that.", title=None) -> str:
    rows = [f"## {title or f'Item {n}'}", f"[claim] {claim}"]
    if evidence:
        rows.append(f"[evidence] {evidence}")
    if reaction:
        rows.append(f"[reaction] {reaction}")
    return "\n".join(rows)


def test_length_short_long_and_ideal(write_script):
    _, f = findings_for(write_script(f"## Hook\n{words(160)}."), "length")
    assert f and f[0].severity == "error" and "short for news" in f[0].message and f[0].cost == 10
    _, f = findings_for(write_script(f"## Hook\n{words(165 * 16)}."), "length")
    assert "long for news" in f[0].message
    # 8 minutes: allowed (6-15) but under the reference's 10-15 ideal -> a small info cost
    _, f = findings_for(write_script(f"## Hook\n{words(165 * 8)}."), "length")
    assert len(f) == 1 and f[0].severity == "info" and 0 < f[0].cost <= 1.5
    _, f = findings_for(write_script(f"## Hook\n{words(165 * 12)}."), "length")
    assert f == []


def test_hook_greeting_and_cta(write_script):
    _, f = findings_for(write_script("## Hook\nHey guys, welcome back to the channel. Subscribe now.\n" + unit()),
                        "hook")
    text = messages(f)
    assert "greeting" in text and "no call to action at the start" in text


def test_hook_good_opening_passes(write_script):
    body = ("## Hook\nGTA 6 launches on Thursday, and Rockstar confirmed nine details. [S1]\n"
            "[authority] Every fact here is sourced on neonatlasguide.com.\n"
            "[promise] We'll cover the date, the box and the bonus.\n[order] Let's start with the biggest.\n"
            + unit())
    _, f = findings_for(write_script(body), "hook")
    assert f == []


def test_hook_vague_question_and_missing_parts(write_script):
    _, f = findings_for(write_script("## Hook\nhave you ever wondered about this game?\n" + unit()), "hook")
    text = messages(f)
    assert "isn't specific" in text and "is a question" in text
    assert "no authority line" in text and "no promise" in text


def test_hook_authority_claiming_experience(write_script):
    body = "## Hook\nGTA 6 is out Thursday.\n[authority] With my 15,000 hours in GTA, I know it best.\n" + unit()
    _, f = findings_for(write_script(body), "hook")
    assert "hours or years of experience" in messages(f)


def test_first_item_must_start_before_30s(write_script):
    late = write_script(f"## Hook\nGTA 6 is out Thursday. {words(120)}.\n" + unit())   # ~45 s of hook
    _, f = findings_for(late, "hook")
    first = [x for x in f if "first item starts" in x.message]
    assert first and first[0].severity == "error" and first[0].time == pytest.approx(125 / 165 * 60)  # 5 + 120 words
    # lore with a cold open may run to 1:00
    lore = write_script(f"## Hook\nGTA 6 is out Thursday. {words(120)}.\n" + unit(), fmt="lore", cold_open="true")
    _, f = findings_for(lore, "hook")
    assert not [x for x in f if "first item starts" in x.message]


def test_spoiler_warning_is_a_blocker(write_script):
    _, f = findings_for(write_script("## Hook\nLucia's story ends in a twist.\n" + unit(), spoilers="true"), "hook")
    assert any(x.blocker and "spoiler warning" in x.message for x in f)
    ok = write_script("## Hook\nSpoiler warning: this covers the ending.\n" + unit(), spoilers="true")
    assert not any("spoiler" in x.message for x in findings_for(ok, "hook")[1])


def test_units_need_evidence_and_reaction(write_script):
    body = "## Hook\nGTA 6 is out.\n" + unit(1) + "\n" + unit(2, evidence=None) + "\n" + unit(3, reaction=None)
    sc, f = findings_for(write_script(body), "units")
    text = messages(f)
    assert "unit 2" in text and "no [evidence]" in text
    assert "unit 3" in text and "no [reaction]" in text
    assert "unit 1" not in text
    assert len(f) == 2
    # costs scale with the number of units: every unit missing a reaction costs 5 of 10
    assert next(x for x in f if "reaction" in x.message).cost == pytest.approx(5 / 3)


def test_shorts_do_not_need_reactions(write_script):
    body = "## Hook\nFive facts.\n" + unit(1, reaction=None, title="5. Box")
    _, f = findings_for(write_script(body, fmt="topn-short", top=1), "units")
    assert f == []


def test_pacing_flags_long_units_and_gaps(write_script):
    body = "## Hook\nGTA 6 is out.\n" + unit(1, evidence=f"{words(150)}. [S1]") + "\n" + unit(2)
    _, f = findings_for(write_script(body), "pacing")
    assert any("unit 1" in x.message and "split it" in x.message for x in f)


def test_structure_news_order_and_item_rate(write_script):
    body = "## Hook\nGTA 6 is out.\n" + unit(1, evidence=f"{words(600)}. [S1]")
    _, f = findings_for(write_script(body), "structure")
    text = messages(f)
    assert "order isn't said out loud" in text and "a minute" in text


def test_structure_guide_needs_query_article_and_early_answer(write_script):
    _, f = findings_for(write_script("## Hook\nPre-loading is simple.\n" + unit(), fmt="guide"), "structure")
    text = messages(f)
    assert "query" in text and "article" in text and "fewer than 3 steps" in text
    path = write_script("## Hook\nThis is about consoles.\n" + unit(), fmt="guide", query="gta 6 pre load size",
                        article="no-such-article")
    _, f = findings_for(path, "structure")
    text = messages(f)
    assert "isn't in the first 30 s" in text and "not in content/articles" in text
    good = write_script("## Hook\nYou can pre-load GTA 6 now, and the size is about 212 gigabytes.\n" + unit(),
                        fmt="guide", query="gta 6 pre load size", article="gta-6-pre-load-guide")
    text = messages(findings_for(good, "structure")[1])
    assert "first 30 s" not in text and "article" not in text


def test_structure_topn_count_and_countdown(write_script):
    body = "## Hook\nThe five best cars.\n" + "\n".join(unit(n, title=f"{n}. Car {n}") for n in (1, 2, 3))
    _, f = findings_for(write_script(body, fmt="topn-short", top=5), "structure")
    text = messages(f)
    assert "top 5 has 3 ranked items" in text and "count down" in text


def test_structure_cars_method_and_gameplay_numbers(write_script):
    body = "## Hook\nThese are the fastest sports cars.\n" + unit(1, title="3. Car")
    _, f = findings_for(write_script(body, fmt="cars"), "structure")
    assert "method isn't explained" in messages(f)
    _, f = findings_for(write_script(body, fmt="cars"), "sourcing")
    assert "car numbers must be ours" in messages(f)
    tested = ("## Hook\nThese are the fastest sports cars in GTA 6.\n"
              "[method] We tested every car on the same straight, fully upgraded, and timed it.\n"
              + unit(1, evidence="It hit 120 on our test run. [G1]", title="3. Car"))
    _, f = findings_for(write_script(tested, fmt="cars"), "sourcing")
    assert "car numbers" not in messages(f)


def test_structure_lore_chapters(write_script):
    body = "## Hook\nThe Leonida Keys hide a secret.\n" + unit(1, evidence=f"{words(700)}. [S1]", title="Part 2")
    _, f = findings_for(write_script(body, fmt="lore"), "structure")
    text = messages(f)
    assert "named chapter every 1.5-3 min" in text and "split it" in text and "specific name" in text


def test_ending_parts_and_long_cta(write_script):
    long_cta = "[cta] " + words(70, "subscribe") + "."
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit() + "\n## Ending\n" + long_cta), "ending")
    text = messages(f)
    assert "no recap" in text and "no narrator's pick" in text and "no question" in text
    assert "call to action runs" in text
    good = ("## Ending\n[recap] So that's everything.\n[pick] Mine has to be the bonus.\n"
            "What's yours?\n[cta] Every source is on neonatlasguide.com.")
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit() + "\n" + good), "ending")
    assert f == []


def test_ending_missing_and_series_next(write_script):
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit()), "ending")
    assert "no `## Ending`" in f[0].message
    body = "## Hook\nGTA 6 is out.\n" + unit() + "\n## Ending\nThat's all. My favourite was this. Yours?"
    _, f = findings_for(write_script(body, series="GTA 6 Facts You Don't Know", episode=1), "ending")
    assert "names the next one" in messages(f)


def test_sourcing_missing_file_unknown_ref_and_uncited_unit(write_script):
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit(), sources=None), "sourcing")
    assert "no source/sources.md" in f[0].message
    body = "## Hook\nGTA 6 is out.\n" + unit(1, evidence="Proof. [S9]") + "\n" + unit(2, evidence="Trust me.")
    _, f = findings_for(write_script(body), "sourcing")
    text = messages(f)
    assert "[S9] is not in sources.md" in text and "unit 2" in text and "no source cited" in text


def test_sourcing_reported_fact_must_be_attributed(write_script):
    plain = write_script("## Hook\nGTA 6 is out.\n" + unit(evidence="The install is huge. [S2]"))
    assert "say who reports it" in messages(findings_for(plain, "sourcing")[1])
    said = write_script("## Hook\nGTA 6 is out.\n" + unit(evidence="TweakTown puts the install at 212 gigabytes. [S2]"))
    assert "say who reports it" not in messages(findings_for(said, "sourcing")[1])


def test_sourcing_leaked_source_is_a_blocker(write_script):
    src = "- [S1] other | someone | leaked gameplay video | https://example.com\n"
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit(), sources=src), "sourcing")
    assert any(x.blocker and "leaked" in x.message for x in f)


def test_labels_guesses_must_be_labelled(write_script):
    body = ("## Hook\nGTA 6 is out.\n"
            + unit(1, claim="The map is probably twice as big.")
            + "\n" + unit(2, claim="It's not confirmed, but the map is probably big.")
            + "\n" + unit(3, claim="GTA Online will launch in spring.", evidence="Nobody has said.")
            + "\n" + unit(4, reaction="I think it will probably be huge."))
    _, f = findings_for(write_script(body), "labels")
    text = messages(f)
    assert "probably twice as big" in text
    assert "probably big" not in text            # labelled out loud in the same sentence
    assert "future with no source" in text and "spring" in text
    assert "huge" not in text                    # reactions are opinions, not claims
    assert len(f) == 2


def test_labels_theories_need_label_and_both_sides(write_script):
    body = ("## Hook\nGTA 6 is out.\n## Tony returns\n[theory] Tony Prince returns.\n[for] The promo shows him.\n"
            "## Lucia\n[theory] My theory is that Lucia was framed.\n[for] Her file says so.\n"
            "[against] Rockstar's profile says she fought for her family.")
    _, f = findings_for(write_script(body, fmt="lore", kind="theory"), "labels")
    text = messages(f)
    assert "Tony" in text and "not called a theory" in text and "no evidence against" in text
    assert "Lucia" not in text


def test_labels_unofficial(write_script):
    _, f = findings_for(write_script("## Hook\nNeon Atlas is the official GTA 6 guide.\n" + unit()), "labels")
    assert any(x.blocker and "unofficial" in x.message for x in f)
    _, f = findings_for(write_script("## Hook\nNeon Atlas is an unofficial fan guide.\n" + unit()), "labels")
    assert not any("unofficial" in x.message for x in f)


def test_speakability(write_script):
    body = ("## Hook\nGTA 6 is out.\n"
            + unit(1, claim="It costs $79.99 (in the US); the install is 212GB on PS5/Xbox.")
            + "\n" + unit(2, claim="Six slick sports sedans skid sideways.")
            + "\n" + unit(3, claim=words(30) + ".")
            + "\n" + unit(4, claim="It costs seventy-nine ninety-nine ninety-nine."))
    _, f = findings_for(write_script(body), "speakability")
    text = messages(f)
    for expected in ("brackets", "semicolon", "glued to a unit", "slash", "tongue-twister", "30-word sentence"):
        assert expected in text, expected
    assert "ninety" not in text                  # number words are not tongue-twisters


def test_speakability_past_stumbles(write_script):
    assert c.add_stumbles(["Grassrivers", "Grassrivers ", "Port Gellhorn"]) == ["Grassrivers", "Port Gellhorn"]
    assert c.add_stumbles(["grassrivers"]) == []                        # already recorded, any case
    assert c.load_stumbles() == ["Grassrivers", "Port Gellhorn"]
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + unit(claim="The Grassrivers are wild.")),
                        "speakability")
    assert "stumbled on this before" in messages(f)


def test_voice_reactions_and_transitions(write_script):
    flat = "\n".join(unit(n, claim=f"Fact {n} is here.", reaction="It is a fact.") for n in range(1, 6))
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + flat), "voice")
    text = messages(f)
    assert "reads as information" in text and "reactions start" in text and "transition" in text
    carried = "\n".join(unit(n, claim=f"Speaking of that, fact {n}.", reaction=r) for n, r in
                        enumerate(["I love it.", "Honestly great.", "That's wild.", "What a shame.", "Cool."], 1))
    _, f = findings_for(write_script("## Hook\nGTA 6 is out.\n" + carried), "voice")
    assert f == []


# ------------------------------------------------------------------------------------------ commands

def test_reading_copy_strips_markup(write_script):
    path = write_script("## Hook\nGTA 6 is out. [S1]\n> show: logo\n" + unit())
    copy = c.reading_copy(c.parse(path))
    assert "[S1]" not in copy and "[claim]" not in copy and "show:" not in copy
    assert "  1. GTA 6 is out." in copy and "## Item 1  (0:01)" in copy
    assert "[line " in c.reading_copy(c.parse(path), show_map=True)


def test_cli(write_script, capsys):
    path = write_script("## Hook\nGTA 6 is out.\n" + unit())
    assert c.main(["check", str(path), "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["measures"]["units"] == 1 and out["findings"]
    assert c.main(["timeline", str(path)]) == 0
    assert "unit 1 (Item 1)" in capsys.readouterr().out
    assert c.main(["check", str(path.parent / "missing.md")]) == 2


def test_real_sample_script_parses():
    """The committed sample video stays valid markup (its score is tested in test_script_score.py)."""
    sample = c.STUDIO / "videos" / "gta-6-launch-everything-confirmed" / "script.md"
    sc = c.parse(sample)
    assert sc.spec["format"] == "news" and len(sc.units) >= 10
    assert not [r for ln in sc.lines for r in ln.refs if r not in sc.sources]
