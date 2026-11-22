"""Tests for script_score.py: dimension arithmetic, the 80/6 bar, blockers, weak stretches and the saved result."""

import json
import shutil

import pytest

import script_score as s
from conftest import FIXTURES
from script_check import Finding


def test_dimension_scores_start_at_10_and_floor_at_0():
    found = [Finding("hook", "warn", "a", 2.5), Finding("hook", "warn", "b", 1.0),
             Finding("units", "error", "c", 14), Finding("voice", "info", "d", 0)]
    dims = s.score_findings(("hook", "units", "voice", "length"), found)
    assert dims == {"hook": 6.5, "units": 0.0, "voice": 10.0, "length": 10.0}
    assert s.total_of(dims) == round(26.5 / 40 * 100)


def test_total_rescales_when_dimensions_do_not_apply():
    assert s.total_of({"length": 10, "hook": 5}) == 75
    assert s.total_of({}) == 0


def test_good_news_fixture_meets_the_bar():
    res = s.score(FIXTURES / "good_news" / "script.md")
    assert res["total"] >= 80 and min(res["dimensions"].values()) >= 6
    assert res["meets_bar"] and not res["ready_to_record"]          # read-aloud pass not done yet
    assert res["verdict"].startswith("READY FOR THE READ-ALOUD PASS")
    assert res["not_applicable"] == []


def test_weak_news_fixture_fails_with_timed_weak_stretches():
    res = s.score(FIXTURES / "weak_news" / "script.md")
    assert res["total"] < 60 and not res["meets_bar"]
    assert res["verdict"].startswith("NOT READY")
    for dim in ("length", "hook", "ending", "speakability"):
        assert res["dimensions"][dim] < 6, dim
    weak = res["weak_stretches"]
    assert [w["start"] for w in weak] == sorted(w["start"] for w in weak)
    hook = weak[0]
    assert hook["where"] == "Hook" and hook["start"] == 0 and any("greeting" in i for i in hook["issues"])
    ending = next(w for w in weak if w["where"] == "Ending")
    assert any("call to action runs" in i for i in ending["issues"])
    online = next(w for w in weak if "(Online)" in w["where"])
    assert any("guess said as fact" in i for i in online["issues"])
    assert any("[S99] is not in" in i for i in online["issues"])


def test_short_fixture_uses_short_dimensions():
    res = s.score(FIXTURES / "topn" / "script.md")
    assert set(res["not_applicable"]) == {"voice", "ending"}
    assert res["meets_bar"]


def test_read_aloud_date_makes_it_ready_to_record(tmp_path):
    folder = tmp_path / "good"
    shutil.copytree(FIXTURES / "good_news", folder)
    script = folder / "script.md"
    script.write_text(script.read_text().replace("read_aloud:\n", "read_aloud: 2026-11-18\n"))
    res = s.score(script)
    assert res["ready_to_record"] and res["verdict"] == "READY TO RECORD (read-aloud pass done 2026-11-18)"


def test_a_blocker_fails_whatever_the_score(tmp_path):
    folder = tmp_path / "good"
    shutil.copytree(FIXTURES / "good_news", folder)
    script = folder / "script.md"
    script.write_text(script.read_text().replace("spoilers: false", "spoilers: true"))
    res = s.score(script)
    assert res["total"] >= 80                       # still a high number...
    assert not res["meets_bar"] and "breaks a studio rule" in res["verdict"]   # ...but not ready


def test_cli_saves_result_with_hash_and_exit_codes(tmp_path, capsys):
    folder = tmp_path / "good"
    shutil.copytree(FIXTURES / "good_news", folder)
    script = folder / "script.md"
    assert s.main([str(script)]) == 0
    saved = json.loads((folder / "script-score.json").read_text())
    assert saved["sha256"] == s.script_hash(script) and saved["total"] >= 80
    assert "SCORE" in capsys.readouterr().out
    weak = tmp_path / "weak"
    shutil.copytree(FIXTURES / "weak_news", weak)
    assert s.main([str(weak / "script.md"), "--no-save", "--json"]) == 1
    assert not (weak / "script-score.json").exists()
    assert json.loads(capsys.readouterr().out)["meets_bar"] is False
    assert s.main([str(tmp_path / "nope.md")]) == 2


@pytest.mark.parametrize("wpm,in_ideal", [(165, False), (100, True)])
def test_pace_changes_the_length_score(wpm, in_ideal):
    # ~1,085 words: about 6.6 min at 165 wpm (allowed, short of the 10-15 min ideal); about 10.9 min at 100 wpm
    res = s.score(FIXTURES / "good_news" / "script.md", wpm=wpm)
    assert res["dimensions"]["length"] == pytest.approx(10.0) if in_ideal else 8 <= res["dimensions"]["length"] < 10


def test_pace_too_fast_is_too_short():
    res = s.score(FIXTURES / "good_news" / "script.md", wpm=400)
    assert res["dimensions"]["length"] < 6 and not res["meets_bar"]
