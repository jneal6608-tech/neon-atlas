"""Tests for tools/gta_shorts.py: the signal maths, the cut rules, the packaging rules, and the Claude request
(sent through the real Anthropic SDK to a local mock of the API, so no key or network is needed)."""
import json
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gta_shorts as gs  # noqa: E402


# --- signals ----------------------------------------------------------------------------------------------------

def test_robust_z_ignores_one_outlier():
    z = gs.robust_z([1, 1, 2, 1, 2, 1, 100])
    assert z[-1] > 10 and abs(z[0]) < 2


def test_audio_jump_measures_against_the_seconds_before():
    env = [-40.0] * 40 + [-10.0] + [-40.0] * 10
    jumps = gs.audio_jumps(env)
    assert jumps[40] == pytest.approx(30.0)
    assert max(jumps[:40]) == 0


def test_combine_and_find_peaks_locate_the_crashes():
    n = 200  # 100 s at 0.5 s bins
    env = [-40.0] * n
    scene = [0.02] * n
    for i in (60, 140):  # crashes at 30 s and 70 s
        env[i] = env[i + 1] = -8.0
        scene[i] = 0.9
    score = gs.combine_signals(env, scene)
    peaks = gs.find_peaks(score, 100.0, 5, min_gap=15)
    assert len(peaks) == 2
    assert abs(peaks[0] - 30.25) < 1.5 and abs(peaks[1] - 70.25) < 1.5


def test_reaction_words_add_to_the_score():
    env, scene = [-40.0] * 100, [0.0] * 100
    base = gs.combine_signals(env, scene)
    boosted = gs.combine_signals(env, scene, [{"start": 20.0, "end": 21.0, "text": "bro no way"}])
    assert boosted[41] > base[41]


def test_peaks_keep_their_distance_and_avoid_edges():
    score = [0.0] * 100
    score[0] = 9          # at the very start: skipped
    score[30] = 5
    score[32] = 4         # 1 s from the first: skipped
    score[80] = 3
    assert gs.find_peaks(score, 50.0, 5, min_gap=10) == [15.25, 40.25]


# --- cut rules ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("start,end,hook,dur", [
    (10, 12, 11, 100),     # too short
    (0, 90, 50, 100),      # too long
    (95, 105, 99, 100),    # past the end
    (-3, 4, 1, 100),       # before the start
    (20, 30, 50, 100),     # payoff outside the cut
    (30, 20, 25, 100),     # reversed
])
def test_clamp_window_always_gives_a_legal_cut(start, end, hook, dur):
    s, e, h = gs.clamp_window(start, end, hook, dur)
    assert 0 <= s <= h <= e <= dur
    assert gs.MIN_LEN - 0.01 <= e - s <= gs.MAX_LEN + 0.01


def test_long_cut_keeps_the_payoff_late():
    s, e, h = gs.clamp_window(0, 90, 50, 100)
    assert 0.6 <= (h - s) / (e - s) <= 0.8


# --- packaging rules ------------------------------------------------------------------------------------------------

def test_caption_gets_an_emoji_and_loses_quotes():
    assert gs.tidy_caption('"bro didn\'t see this coming"') == "bro didn't see this coming 💀"
    assert gs.tidy_caption("ain't no way 😭") == "ain't no way 😭"


def test_hashtags_start_with_gta6_and_shorts():
    tags = gs.tidy_hashtags(["funny", "#GTA", "#gta6", "gaming!", "x", "y", "z"])
    assert tags[:2] == ["#gta6", "#shorts"] and "#gta" in tags and len(tags) == 5


def test_description_always_says_unofficial_once():
    d = gs.tidy_description("He tried.\n\n" + gs.UNOFFICIAL)
    assert d.count("unofficial fan channel") == 1 and d.startswith("He tried.")


def test_finalize_drops_spoilers_and_overlaps_and_caps_count():
    base = {"moment": "m", "caption": "lol", "title": "t #shorts", "description": "d", "hashtags": [], "why": "w",
            "scores": {"instant_read": 9, "surprise": 9, "payoff": 9, "loop": 9, "standalone": 9}, "source": "c1"}
    raw = [dict(base, start=10, end=20, hook_time=17, spoiler=False),
           dict(base, start=11, end=21, hook_time=18, spoiler=False),     # overlaps the first
           dict(base, start=40, end=50, hook_time=46, spoiler=True),      # story spoiler
           dict(base, start=60, end=70, hook_time=66, spoiler=False),
           dict(base, start=80, end=90, hook_time=86, spoiler=False)]
    picks, notes = gs.finalize_picks(raw, 100.0, 2)
    assert [p["n"] for p in picks] == [1, 2]
    assert [p["start"] for p in picks] == [10, 60]
    assert all("#shorts" not in p["title"] for p in picks)
    assert any("spoiler" in n for n in notes) and any("overlaps" in n for n in notes)


def test_zoom_expression_is_flat_away_from_the_payoff():
    expr = gs.zoom_expr(5.0)
    assert expr.startswith("1+0.16*") and "it" in expr


def test_caption_image_fits_its_box(tmp_path):
    out = gs.caption_image("bro really thought he could make that jump in GTA 6 💀😭", tmp_path / "c.png")
    from PIL import Image
    im = Image.open(out)
    assert im.size == (gs.CAPTION_BOX[2] - gs.CAPTION_BOX[0], gs.CAPTION_BOX[3] - gs.CAPTION_BOX[1])
    assert im.getbbox() is not None


# --- the Claude request, through the real SDK to a local mock API ----------------------------------------------

REPLY = {
    "footage_notes": "Two good moments.",
    "picks": [{
        "source": "c1", "start": 8.0, "end": 19.0, "hook_time": 15.5, "moment": "The car flips into a bus.",
        "caption": "bro didn't see this coming 💀", "title": "GTA 6 physics are undefeated 😭",
        "description": "He took the corner a little fast.", "hashtags": ["#gta6", "#shorts", "#funny"],
        "why": "Readable at once, big payoff.", "spoiler": False,
        "scores": {"instant_read": 9, "surprise": 8, "payoff": 9, "loop": 7, "standalone": 9},
    }],
}


class MockAPI(BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        MockAPI.seen.append({"path": self.path, "headers": dict(self.headers), "body": body})
        text = json.dumps(REPLY)
        events = [
            ("message_start", {"type": "message_start", "message": {
                "id": "msg_1", "type": "message", "role": "assistant", "model": body["model"], "content": [],
                "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 9000, "output_tokens": 1}}}),
            ("content_block_start", {"type": "content_block_start", "index": 0,
                                     "content_block": {"type": "text", "text": ""}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                     "delta": {"type": "text_delta", "text": text}}),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                               "usage": {"output_tokens": 1500}}),
            ("message_stop", {"type": "message_stop"}),
        ]
        payload = "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events).encode()
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


@pytest.fixture()
def mock_api():
    anthropic = pytest.importorskip("anthropic")
    MockAPI.seen = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), MockAPI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield anthropic.Anthropic(api_key="test-key", base_url=f"http://127.0.0.1:{srv.server_port}", max_retries=0)
    srv.shutdown()


@pytest.fixture()
def fake_job(tmp_path, monkeypatch):
    monkeypatch.setattr(gs, "JOBS", tmp_path)
    from PIL import Image
    d = tmp_path / "job1"
    (d / "sheets").mkdir(parents=True)
    for name in ("c1", "overview-1"):
        Image.new("RGB", (64, 36), (200, 100, 0)).save(d / "sheets" / f"{name}.jpg")
    state = {"id": "job1", "video": {"duration": 60.0, "width": 1920, "height": 1080, "fps": 60},
             "settings": {"model": "claude-opus-5-5", "effort": "medium", "count": 3, "candidates": 1},
             "candidates": [{"id": "c1", "peak": 15.5, "window": [0.5, 23.5], "jump_db": 18.0, "change": 0.6,
                             "sheet": "sheets/c1.jpg", "score": 3.0}],
             "overview_sheets": ["sheets/overview-1.jpg"]}
    return state


def test_claude_request_shape_and_parsing(mock_api, fake_job):
    data, usage = gs.ask_claude(fake_job, "test-key", client=mock_api)
    req = MockAPI.seen[0]
    body = req["body"]
    assert req["path"].startswith("/v1/messages")
    assert body["model"] == "claude-opus-5-5" and body["stream"] is True
    assert body["fallbacks"] == "default" and gs.FALLBACK_BETA in req["headers"].get("anthropic-beta", "")
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in body and "temperature" not in body
    kinds = [c["type"] for c in body["messages"][0]["content"]]
    assert kinds.count("image") == 2
    assert "Shorts editor" in body["system"][0]["text"]
    assert data["picks"][0]["caption"].startswith("bro")
    assert usage["input_tokens"] == 9000 and usage["output_tokens"] == 1500
    assert usage["cost_usd"] == pytest.approx(9000 / 1e6 * 4 + 1500 / 1e6 * 20)


def test_haiku_goes_without_fallbacks(mock_api, fake_job):
    fake_job["settings"]["model"] = "claude-haiku-5-5"
    gs.ask_claude(fake_job, "test-key", client=mock_api)
    body = MockAPI.seen[0]["body"]
    assert "fallbacks" not in body and body["model"] == "claude-haiku-5-5"


# --- end to end on a generated clip -------------------------------------------------------------------------------

@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_end_to_end_offline(tmp_path, monkeypatch):
    import subprocess
    monkeypatch.setattr(gs, "JOBS", tmp_path / "jobs")
    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc2=size=640x360:rate=30,drawbox=enable='between(t,20,21)':x=0:y=0:w=iw:h=ih:color=red@0.9:t=fill",
                    "-f", "lavfi", "-i",
                    "anoisesrc=a=0.02:c=pink,volume='if(between(t,20,21.5),25,1)':eval=frame",
                    "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(clip)],
                   check=True)
    state = gs.new_job(clip, "e2e")
    gs.analyze(state, model="offline", count=3, n_candidates=4)
    assert state["status"] == "review", state.get("error")
    best = state["picks"][0]
    assert best["start"] <= 20.5 <= best["end"]
    gs.render(state, picks=[best["n"]])
    assert state["status"] == "done", state.get("error")
    qc = state["renders"][str(best["n"])]["qc"]
    assert qc["pass"], qc
