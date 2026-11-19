"""gta_shorts.py: one GTA 6 gameplay MP4 in, 3-5 funny-moment vertical Shorts out, picked by Claude.

Drop in a gameplay recording. The tool finds where the game suddenly gets loud or the picture suddenly changes
(crashes, explosions, ragdolls, the player yelling), samples frames around those moments plus an even overview of the
whole video, and asks Claude which make the best funny Shorts. Claude returns the cut (start, payoff, end), one meme
caption ("bro didn't see this coming 💀"), a title, a description and hashtags for each. You check the picks (the
storyboard), then the tool renders each as a 1080x1920 Short: gameplay over a blurred fill, a punch-in zoom on the
payoff, the caption clear of YouTube's buttons, game audio at -14 LUFS.

Usage (from studio/):
  python3 tools/gta_shorts.py serve [--port 8765] [--host 127.0.0.1]   the drop-an-MP4 studio page (easiest)
  python3 tools/gta_shorts.py analyze <gameplay.mp4> [--model M] [--effort E] [--count 4] [--candidates 10]
                                      [--transcribe] [--job NAME]       finds and packages the picks, stops there
  python3 tools/gta_shorts.py render <job> [--picks 1,3] [--frame zoom|fit]   renders only the Shorts you choose
  python3 tools/gta_shorts.py status [<job>]                            lists jobs, or one job's picks and renders

  --model    claude-opus-5-5 (default), claude-sonnet-5-5, claude-haiku-5-5 (cheapest), claude-fable-5-2 (most capable,
             priciest), or "offline" (no API, free: picks by the loudness/motion signals, stock captions)
  --effort   low | medium (default) | high: how hard Claude thinks; higher costs more
  --count    how many Shorts you want (3-5); Claude returns fewer if the footage has fewer good moments
  --candidates  how many signal peaks Claude looks at (each is one image, about 1,000 input tokens)

The API key comes from ANTHROPIC_API_KEY or a line ANTHROPIC_API_KEY=... in studio/.env (git-ignored). Without one,
the model falls back to offline. The rubric Claude follows is prompts/gta-funny-shorts.md (edit it to change taste);
the research behind it is research/funny-shorts-algorithm.md. Only frames and numbers go to the API, never the video.

Jobs live in footage/gta-shorts/<job>/ (git-ignored: it holds your footage): source.mp4, job.json (signals, candidates,
picks, usage, renders), sheets/ (what Claude saw), storyboard/, renders/short-NN.mp4 and package.md (titles,
descriptions, hashtags to paste). Delete the job folder when the Shorts are uploaded.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

STUDIO = Path(__file__).resolve().parent.parent
JOBS = STUDIO / "footage" / "gta-shorts"
PROMPT_FILE = STUDIO / "prompts" / "gta-funny-shorts.md"

# Model: (input $/MTok, output $/MTok, server-side refusal fallback available). Prices: Anthropic list, 2026-11.
MODELS = {
    "claude-opus-5-5": (4.00, 20.00, True),
    "claude-sonnet-5-5": (2.00, 10.00, True),
    "claude-haiku-5-5": (0.10, 0.50, False),
    "claude-fable-5-2": (8.00, 40.00, True),
}
DEFAULT_MODEL = "claude-opus-5-5"
EFFORTS = ("low", "medium", "high")
FALLBACK_BETA = "server-side-fallback-2026-07-01"

MIN_LEN, TARGET_MAX, MAX_LEN = 10.0, 30.0, 45.0  # the studio's funny-short format: 10-45 s
BIN = 0.5                         # signal resolution, seconds
OUT_W, OUT_H = 1080, 1920
UNOFFICIAL = ("Neon Atlas is an unofficial fan channel, not affiliated with Rockstar Games or Take-Two. "
              "Gameplay recorded by us.")
CAPTION_EMOJI = "💀😭🤣😂😳🫠🔥"
STOCK_CAPTIONS = [
    "bro didn't see this coming 💀",
    "ain't no way 😭",
    "he was NOT ready 💀",
    "GTA 6 physics are undefeated 😭",
    "that did not go to plan 💀",
    "nah this game is wild 😭",
]
REACTION_WORDS = ("no way", "bro", "what the", "oh my god", "omg", "nah", "wait", "how", "bruh", "lmao", "haha")

# Layout of the vertical frame (pixels). YouTube's Shorts UI covers the bottom ~22% (title, channel, music) and a
# strip on the right (like, comment, share); the caption sits above the picture, inside the safe middle.
FG_Y = 600                        # top of the gameplay panel
CAPTION_BOX = (60, 250, 1020, 570)  # left, top, right, bottom


class ShortsError(Exception):
    """A plain-language reason the job cannot go on (bad file, missing tool, API problem)."""


# ---------------------------------------------------------------------------------------------------------------
# small helpers

def fmt_t(sec: float) -> str:
    sec = max(0.0, float(sec))
    m, s = divmod(sec, 60)
    return f"{int(m)}:{s:04.1f}"


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, **kw)


def need_tools():
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise ShortsError(f"{tool} is not installed. Run: bash tools/ensure_deps.sh")


def load_env_key() -> str | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    env = STUDIO / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("ANTHROPIC_API_KEY="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    return None


def slugify(text: str, n: int = 40) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:n].strip("-") or "short"


def job_dir(job: str) -> Path:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", job or ""):
        raise ShortsError(f"Not a job name: {job!r}")
    return JOBS / job


def load_job(job: str) -> dict:
    p = job_dir(job) / "job.json"
    if not p.exists():
        raise ShortsError(f"No job called {job} (looked in {p.parent})")
    return json.loads(p.read_text())


def save_job(state: dict):
    d = job_dir(state["id"])
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "job.json.tmp"
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False))
    tmp.replace(d / "job.json")


_job_lock = threading.Lock()


def update(state: dict, **fields):
    with _job_lock:
        state.update(fields)
        state["updated"] = time.time()
        save_job(state)


# ---------------------------------------------------------------------------------------------------------------
# 1. read the file

def probe(path: Path) -> dict:
    """Duration, size, fps and audio of a video, or a plain reason it can't be used."""
    if not path.exists() or path.stat().st_size == 0:
        raise ShortsError("The file is empty or missing.")
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    if r.returncode != 0:
        raise ShortsError("This file can't be read as a video (it may be corrupt or not finished copying).")
    info = json.loads(r.stdout or b"{}")
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video:
        raise ShortsError("This file has no video track.")
    try:
        duration = float(info.get("format", {}).get("duration") or video.get("duration") or 0)
    except ValueError:
        duration = 0.0
    if duration < 8:
        raise ShortsError(f"The video is only {duration:.1f} s long; a Short needs a longer clip.")
    if duration > 4 * 3600:
        raise ShortsError("The video is over 4 hours; split it into shorter recordings first.")
    num, _, den = (video.get("avg_frame_rate") or "30/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    if not 1 <= fps <= 240:
        fps = 30.0
    return {"duration": round(duration, 3), "width": int(video.get("width", 0)), "height": int(video.get("height", 0)),
            "fps": round(fps, 3), "has_audio": audio is not None, "size_mb": round(path.stat().st_size / 1e6, 1)}


# ---------------------------------------------------------------------------------------------------------------
# 2. signals: where it gets loud, where the picture jumps

def audio_envelope(path: Path, hop: float = BIN, rate: int = 8000) -> list[float]:
    """Loudness (dBFS, RMS) of the mixed-down audio every `hop` seconds."""
    r = run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"])
    if r.returncode != 0:
        return []
    raw, n = r.stdout, int(rate * hop)
    out = []
    try:
        import numpy as np
        a = np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
        frames = len(a) // n
        if frames:
            rms = np.sqrt(np.mean(a[: frames * n].reshape(frames, n) ** 2, axis=1))
            out = [float(20 * math.log10(max(v, 1e-5))) for v in rms]
    except ImportError:
        import array
        a = array.array("h")
        a.frombytes(raw[: len(raw) // 2 * 2])
        if sys.byteorder == "big":
            a.byteswap()
        for i in range(0, len(a) - n + 1, n):
            chunk = a[i:i + n]
            rms = math.sqrt(sum(x * x for x in chunk) / n) / 32768.0
            out.append(20 * math.log10(max(rms, 1e-5)))
    return out


def visual_change(path: Path, duration: float, hop: float = BIN, fps: int = 6) -> list[float]:
    """Largest frame-to-frame change (ffmpeg scene score, 0-1) in each `hop` bin."""
    r = run(["ffmpeg", "-v", "error", "-i", str(path), "-an", "-vf",
             f"fps={fps},scale=192:-2,select='gte(scene\\,0)',metadata=print:file=-", "-f", "null", "-"])
    bins = [0.0] * (int(duration / hop) + 1)
    t = None
    for line in (r.stdout or b"").decode(errors="ignore").splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.search(r"lavfi\.scene_score=([\d.]+)", line)
        if m and t is not None:
            i = min(int(t / hop), len(bins) - 1)
            bins[i] = max(bins[i], float(m.group(1)))
    return bins


def transcribe(path: Path) -> list[dict]:
    """Optional: the player's spoken reactions, with times (needs faster-whisper)."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return []
    model = WhisperModel(os.environ.get("GTA_SHORTS_WHISPER", "base"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(path), vad_filter=True)
    return [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    if not s:
        return 0.0
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def robust_z(xs: list[float]) -> list[float]:
    """(x - median) / MAD-sigma, so one huge explosion doesn't flatten everything else."""
    if not xs:
        return []
    med = _median(xs)
    mad = _median([abs(x - med) for x in xs]) * 1.4826 or 1e-6
    return [(x - med) / mad for x in xs]


def audio_jumps(env_db: list[float], window_s: float = 8.0, hop: float = BIN) -> list[float]:
    """How many dB each bin is above the typical loudness of the seconds before it (sudden = funny-moment candidate)."""
    w = max(1, int(window_s / hop))
    out = []
    for i, v in enumerate(env_db):
        prev = env_db[max(0, i - w):i] or [v]
        out.append(max(0.0, v - _median(prev)))
    return out


def combine_signals(env_db: list[float], scene: list[float], words: list[dict] | None = None,
                    hop: float = BIN) -> list[float]:
    """One excitement score per bin: sudden loudness, picture change, loudness itself, and reaction words."""
    n = max(len(env_db), len(scene))
    if n == 0:
        return []
    env = (env_db + [min(env_db or [-90.0])] * n)[:n]
    sc = (scene + [0.0] * n)[:n]
    jump_z = robust_z(audio_jumps(env, hop=hop))
    loud_z = robust_z(env)
    scene_z = robust_z(sc)
    react = [0.0] * n
    for w in words or []:
        text = w.get("text", "").lower()
        hits = sum(text.count(k) for k in REACTION_WORDS)
        if hits:
            for i in range(int(w["start"] / hop), min(n, int(w["end"] / hop) + 1)):
                react[i] = max(react[i], min(3.0, float(hits)))
    raw = [0.45 * max(0, j) + 0.15 * max(0, l) + 0.30 * max(0, s) + 0.6 * r
           for j, l, s, r in zip(jump_z, loud_z, scene_z, react)]
    k = 3  # smooth over ~1.5 s
    return [sum(raw[max(0, i - k):i + k + 1]) / len(raw[max(0, i - k):i + k + 1]) for i in range(n)]


def find_peaks(score: list[float], duration: float, count: int, min_gap: float = 15.0, hop: float = BIN,
               edge: float = 2.0) -> list[float]:
    """The times of the `count` highest peaks, at least `min_gap` s apart, away from the very start and end."""
    order = sorted(range(len(score)), key=lambda i: score[i], reverse=True)
    picked: list[float] = []
    for i in order:
        t = i * hop + hop / 2
        if t < edge or t > duration - edge or score[i] <= 0:
            continue
        if all(abs(t - p) >= min_gap for p in picked):
            picked.append(t)
        if len(picked) >= count:
            break
    return sorted(picked)


def clamp_window(start: float, end: float, hook: float, duration: float,
                 min_len: float = MIN_LEN, max_len: float = MAX_LEN) -> tuple[float, float, float]:
    """A legal cut: inside the video, min_len..max_len long, with the payoff inside it (and not in the last 0.5 s)."""
    start, end, hook = float(start), float(end), float(hook)
    if end < start:
        start, end = end, start
    hook = min(max(hook, 0.0), duration)
    if not (start <= hook <= end):
        start, end = min(start, hook - 3.0), max(end, hook + 1.5)
    if end - start > max_len:  # keep the payoff ~70% of the way in
        start = max(start, hook - max_len * 0.7)
        end = start + max_len
    if end - start < min_len:
        pad = (min_len - (end - start)) / 2
        start, end = start - pad, end + pad
    end = max(end, hook + 0.5)
    if start < 0:
        end, start = end - start, 0.0
    if end > duration:
        start, end = max(0.0, start - (end - duration)), duration
    hook = min(max(hook, start), end)
    return round(start, 2), round(end, 2), round(hook, 2)


def overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Share of the shorter window that overlaps the other."""
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    shorter = max(1e-6, min(a[1] - a[0], b[1] - b[0]))
    return inter / shorter


# ---------------------------------------------------------------------------------------------------------------
# 3. frames and contact sheets (what Claude sees)

def _font(size: int, bold: bool = True):
    from PIL import ImageFont
    names = (["Montserrat-ExtraBold.ttf", "Montserrat-Black.ttf", "Anton-Regular.ttf", "Impact.ttf", "Arial Black.ttf",
              "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"] if bold else ["DejaVuSans.ttf"])
    dirs = [STUDIO / "fonts", Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts",
            Path("/Library/Fonts"), Path("C:/Windows/Fonts")]
    custom = os.environ.get("GTA_SHORTS_FONT")
    if custom and Path(custom).exists():
        return ImageFont.truetype(custom, size)
    for name in names:
        for d in dirs:
            if d.exists():
                hit = next(iter(d.rglob(name)), None)
                if hit:
                    return ImageFont.truetype(str(hit), size)
    return ImageFont.load_default(size)


def grab_frame(src: Path, t: float, out: Path, width: int = 384) -> Path | None:
    r = run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, t):.3f}", "-i", str(src), "-frames:v", "1",
             "-vf", f"scale={width}:-2", "-q:v", "4", str(out)])
    return out if r.returncode == 0 and out.exists() else None


def grab_frames(src: Path, times: list[float], folder: Path, width: int = 384) -> dict[float, Path]:
    folder.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {t: pool.submit(grab_frame, src, t, folder / f"f{t:09.2f}.jpg", width) for t in times}
    return {t: f.result() for t, f in futs.items() if f.result()}


def contact_sheet(frames: list[tuple[float, Path | None]], out: Path, cols: int, title: str,
                  tile_w: int = 384, highlight: float | None = None) -> Path:
    from PIL import Image, ImageDraw
    rows = math.ceil(len(frames) / cols)
    tile_h = int(tile_w * 9 / 16)
    head = 44
    sheet = Image.new("RGB", (cols * tile_w, head + rows * tile_h), (12, 14, 18))
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), title, fill=(240, 240, 240), font=_font(24))
    small = _font(20)
    for i, (t, p) in enumerate(frames):
        x, y = (i % cols) * tile_w, head + (i // cols) * tile_h
        if p and p.exists():
            im = Image.open(p).convert("RGB")
            im = im.resize((tile_w, int(im.height * tile_w / im.width)))
            sheet.paste(im.crop((0, 0, tile_w, tile_h)), (x, y))
        label = fmt_t(t)
        d.rectangle([x + 4, y + 4, x + 12 + 13 * len(label), y + 30], fill=(0, 0, 0))
        d.text((x + 8, y + 6), label, fill=(255, 220, 80), font=small)
        if highlight is not None and abs(t - highlight) < 0.01:
            d.rectangle([x, y, x + tile_w - 1, y + tile_h - 1], outline=(255, 60, 60), width=4)
    sheet.save(out, quality=82)
    return out


def b64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


# ---------------------------------------------------------------------------------------------------------------
# 4. Claude picks

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "footage_notes": {"type": "string"},
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "hook_time": {"type": "number"},
                    "moment": {"type": "string"},
                    "caption": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "why": {"type": "string"},
                    "spoiler": {"type": "boolean"},
                    "scores": {
                        "type": "object",
                        "properties": {k: {"type": "integer"} for k in
                                       ("instant_read", "surprise", "payoff", "loop", "standalone")},
                        "required": ["instant_read", "surprise", "payoff", "loop", "standalone"],
                        "additionalProperties": False,
                    },
                },
                "required": ["source", "start", "end", "hook_time", "moment", "caption", "title", "description",
                             "hashtags", "why", "spoiler", "scores"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["footage_notes", "picks"],
    "additionalProperties": False,
}


def system_prompt() -> str:
    text = PROMPT_FILE.read_text()
    return text.split("\n---\n", 1)[1].strip() if "\n---\n" in text else text


def build_request_content(state: dict) -> list[dict]:
    d = job_dir(state["id"])
    meta = state["video"]
    lines = [
        f"Gameplay recording: {fmt_t(meta['duration'])} long, {meta['width']}x{meta['height']} at {meta['fps']:.0f} fps.",
        f"The user wants {state['settings']['count']} Shorts (return fewer if there aren't that many good moments).",
        "Below: candidate moments found where the game got suddenly loud or the picture suddenly changed. Each has a "
        "sheet of frames with source timestamps (the red box is the signal peak), and its numbers: 'jump' is dB above "
        "the loudness of the seconds before, 'change' is the biggest picture change (0-1).",
        "After them: an overview of the whole video, one frame every few seconds, so you can also pick a moment the "
        "signals missed (use source 'overview' and give its times).",
    ]
    content: list[dict] = [{"type": "text", "text": "\n".join(lines)}]
    for c in state["candidates"]:
        info = (f"Candidate {c['id']}: frames {fmt_t(c['window'][0])} to {fmt_t(c['window'][1])}, peak at "
                f"{fmt_t(c['peak'])} ({c['peak']:.1f} s). jump +{c['jump_db']:.0f} dB, change {c['change']:.2f}.")
        if c.get("words"):
            info += f' Player said: "{c["words"]}".'
        content.append({"type": "text", "text": info})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": b64(d / c["sheet"])}})
    for i, sheet in enumerate(state.get("overview_sheets", []), 1):
        content.append({"type": "text", "text": f"Overview sheet {i}."})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": b64(d / sheet)}})
    content.append({"type": "text", "text": "Pick the moments and package each Short. Times in seconds."})
    return content


def ask_claude(state: dict, api_key: str, client=None) -> tuple[dict, dict]:
    """Returns (parsed picks JSON, usage). Raises ShortsError with a plain reason."""
    import anthropic
    model = state["settings"]["model"]
    effort = state["settings"]["effort"]
    client = client or anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=600)
    params = dict(
        model=model,
        max_tokens=32000,
        system=[{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": build_request_content(state)}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": PICK_SCHEMA}},
    )
    try:
        if MODELS.get(model, (0, 0, False))[2]:
            # If a safety classifier declines (e.g. it misreads game violence), the API retries on another model.
            with client.beta.messages.stream(betas=[FALLBACK_BETA], fallbacks="default", **params) as stream:
                msg = stream.get_final_message()
        else:
            with client.messages.stream(**params) as stream:
                msg = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise ShortsError("Claude rejected the API key. Check ANTHROPIC_API_KEY in studio/.env.")
    except anthropic.PermissionDeniedError:
        raise ShortsError(f"This API key can't use {model}. Pick another model.")
    except anthropic.NotFoundError:
        raise ShortsError(f"The model {model} wasn't found for this key. Pick another model.")
    except anthropic.RateLimitError:
        raise ShortsError("Claude's rate limit was hit; wait a minute and analyze again.")
    except anthropic.BadRequestError as e:
        raise ShortsError(f"Claude refused the request: {e.message}")
    except anthropic.APIStatusError as e:
        raise ShortsError(f"Claude API error {e.status_code}; try again shortly.")
    except anthropic.APIConnectionError:
        raise ShortsError("Couldn't reach the Claude API (no internet?).")
    if msg.stop_reason == "refusal":
        raise ShortsError("Claude declined to analyze this footage.")
    if msg.stop_reason == "max_tokens":
        raise ShortsError("Claude's answer was cut off; try a lower effort or fewer candidates.")
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise ShortsError("Claude's answer wasn't valid JSON; analyze again.")
    u = msg.usage
    inp = (u.input_tokens or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0) \
        + (getattr(u, "cache_creation_input_tokens", 0) or 0)
    served = getattr(msg, "model", model) or model
    price_in, price_out, _ = MODELS.get(served, MODELS.get(model, (0, 0, False)))
    usage = {"model": served, "input_tokens": inp, "output_tokens": u.output_tokens or 0,
             "cost_usd": round(inp / 1e6 * price_in + (u.output_tokens or 0) / 1e6 * price_out, 4)}
    return data, usage


def tidy_caption(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "").replace("\n", " ")).strip().strip('"\u201c\u201d')
    if not any(ch in text for ch in CAPTION_EMOJI):
        text = f"{text} 💀"
    return text[:70]


def tidy_hashtags(tags: list[str]) -> list[str]:
    out = []
    for t in ["#gta6", "#shorts"] + list(tags or []):
        t = "#" + re.sub(r"[^a-zA-Z0-9_]", "", str(t).lstrip("#")).lower()
        if len(t) > 1 and t not in out:
            out.append(t)
    return out[:5]


def tidy_description(text: str) -> str:
    text = (text or "").strip()
    text = text.replace(UNOFFICIAL, "").strip()
    return (text + "\n\n" + UNOFFICIAL).strip()


def finalize_picks(raw: list[dict], duration: float, count: int, from_claude: bool = True) -> tuple[list[dict], list[str]]:
    """Clamp cuts, drop spoilers and overlaps, enforce the caption/description rules, best first."""
    notes, picks = [], []
    for p in raw:
        if p.get("spoiler"):
            notes.append(f"Skipped a story moment at {fmt_t(p.get('hook_time', 0))} (spoiler).")
            continue
        start, end, hook = clamp_window(p.get("start", 0), p.get("end", 0), p.get("hook_time", 0), duration)
        if any(overlap((start, end), (q["start"], q["end"])) > 0.5 for q in picks):
            notes.append(f"Skipped a pick at {fmt_t(hook)} that overlaps a better one.")
            continue
        scores = {k: max(1, min(10, int(v))) for k, v in (p.get("scores") or {}).items()}
        title = re.sub(r"\s*#shorts\b", "", (p.get("title") or "").strip(), flags=re.I)[:90]
        picks.append({
            "source": p.get("source", ""), "start": start, "end": end, "hook_time": hook,
            "moment": (p.get("moment") or "").strip(), "caption": tidy_caption(p.get("caption", "")),
            "title": title or tidy_caption(p.get("caption", "")), "description": tidy_description(p.get("description", "")),
            "hashtags": tidy_hashtags(p.get("hashtags", [])), "why": (p.get("why") or "").strip(),
            "scores": scores, "total": sum(scores.values()), "selected": False,  # the user ticks the ones to render
            "picked_by": "claude" if from_claude else "offline",
        })
    if from_claude:  # Claude already ordered them best first; keep that order
        pass
    else:
        picks.sort(key=lambda q: q["total"], reverse=True)
    picks = picks[:count]
    for i, p in enumerate(picks, 1):
        p["n"] = i
    return picks, notes


def offline_picks(state: dict) -> list[dict]:
    """No API: the strongest signal peaks, cut around the peak, with stock captions."""
    raw = []
    ranked = sorted(state["candidates"], key=lambda c: c["score"], reverse=True)
    top = max((c["score"] for c in ranked), default=0) or 1.0
    for i, c in enumerate(ranked):
        cap = STOCK_CAPTIONS[i % len(STOCK_CAPTIONS)]
        strength = max(1, min(10, int(round(10 * c["score"] / top))))  # relative to this video's strongest peak
        raw.append({
            "source": c["id"], "start": c["peak"] - 9, "end": c["peak"] + 4, "hook_time": c["peak"],
            "moment": f"Biggest jump in loudness or picture around {fmt_t(c['peak'])} (picked by signals, not watched).",
            "caption": cap, "title": f"{cap.rstrip(' ' + CAPTION_EMOJI).strip()} | GTA 6",
            "description": "Things got out of hand in GTA 6.", "hashtags": ["#gta", "#funny", "#gaming"],
            "why": f"Loudness jump +{c['jump_db']:.0f} dB, picture change {c['change']:.2f}.", "spoiler": False,
            "scores": {"instant_read": 5, "surprise": strength, "payoff": strength, "loop": 5, "standalone": 5},
        })
    return raw


# ---------------------------------------------------------------------------------------------------------------
# 5. analyze: file -> signals -> candidates -> sheets -> picks -> storyboard

def new_job(source: Path, name: str | None = None, move: bool = False) -> dict:
    need_tools()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    job = f"{stamp}-{slugify(name or source.stem, 30)}"
    d = job_dir(job)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / "source.mp4"
    if move:
        shutil.move(str(source), dest)
    else:
        try:
            os.link(source, dest)  # no extra disk if on the same drive
        except OSError:
            shutil.copy2(source, dest)
    state = {"id": job, "name": name or source.name, "created": time.time(), "status": "new", "step": "",
             "error": None, "notes": [], "picks": [], "renders": {}}
    save_job(state)
    return state


def analyze(state: dict, model: str = DEFAULT_MODEL, effort: str = "medium", count: int = 4,
            n_candidates: int = 10, do_transcribe: bool = False, client=None) -> dict:
    d = job_dir(state["id"])
    src = d / "source.mp4"
    count = max(1, min(5, int(count)))
    n_candidates = max(count, min(16, int(n_candidates)))
    if model != "offline" and model not in MODELS:
        raise ShortsError(f"Unknown model {model}. Choose one of: {', '.join(MODELS)}, offline")
    effort = effort if effort in EFFORTS else "medium"
    update(state, status="analyzing", step="Checking the file", error=None, notes=[], picks=[],
           settings={"model": model, "effort": effort, "count": count, "candidates": n_candidates})
    try:
        meta = probe(src)
        update(state, video=meta)
        dur = meta["duration"]

        update(state, step="Listening for crashes, explosions and shouting")
        env = audio_envelope(src) if meta["has_audio"] else []
        update(state, step="Looking for sudden changes in the picture")
        scene = visual_change(src, dur)
        words = []
        if do_transcribe:
            update(state, step="Transcribing your reactions")
            words = transcribe(src)
            if not words:
                state["notes"].append("Transcription skipped (faster-whisper isn't installed).")
        score = combine_signals(env, scene, words)
        jumps = audio_jumps(env) if env else []
        peaks = find_peaks(score, dur, n_candidates, min_gap=max(12.0, min(25.0, dur / (n_candidates * 2))))
        if not peaks:  # flat footage: spread candidates evenly
            peaks = [dur * (i + 1) / (n_candidates + 1) for i in range(n_candidates)]

        update(state, step=f"Sampling frames around {len(peaks)} candidate moments")
        cands, times = [], set()
        for i, pk in enumerate(peaks, 1):
            lo, hi = max(0.0, pk - 15.0), min(dur - 0.05, pk + 8.0)
            ts = [round(lo + (hi - lo) * k / 9, 2) for k in range(10)]
            nearest = min(ts, key=lambda t: abs(t - pk))
            ts[ts.index(nearest)] = round(pk, 2)
            b = int(pk / BIN)
            cand = {"id": f"c{i}", "peak": round(pk, 2), "window": [round(lo, 2), round(hi, 2)], "times": ts,
                    "score": round(score[min(b, len(score) - 1)], 3) if score else 0.0,
                    "jump_db": round(max(jumps[max(0, b - 2):b + 3] or [0.0]), 1),
                    "change": round(max(scene[max(0, b - 2):b + 3] or [0.0]), 3)}
            said = " ".join(w["text"] for w in words if lo <= w["start"] <= hi)
            if said:
                cand["words"] = said[:200]
            cands.append(cand)
            times.update(ts)
        step = max(4.0, dur / 40)
        overview_times = [round(min(dur - 0.05, step / 2 + k * step), 2) for k in range(int(dur / step))][:40]
        times.update(overview_times)
        frames = grab_frames(src, sorted(times), d / "frames")

        sheets = d / "sheets"
        sheets.mkdir(exist_ok=True)
        for c in cands:
            name = f"sheets/{c['id']}.jpg"
            contact_sheet([(t, frames.get(t)) for t in c["times"]], d / name, cols=5,
                          title=f"Candidate {c['id']}  peak {fmt_t(c['peak'])}", highlight=c["peak"])
            c["sheet"] = name
        ov = []
        for k in range(0, len(overview_times), 20):
            name = f"sheets/overview-{k // 20 + 1}.jpg"
            contact_sheet([(t, frames.get(t)) for t in overview_times[k:k + 20]], d / name, cols=5,
                          title=f"Overview {k // 20 + 1}", tile_w=300)
            ov.append(name)
        update(state, candidates=cands, overview_sheets=ov,
               signals={"audio_db": [round(x, 1) for x in env], "scene": [round(x, 3) for x in scene],
                        "score": [round(x, 3) for x in score], "bin_s": BIN})

        used_claude, usage = False, None
        if model != "offline":
            key = load_env_key()
            if not key:
                state["notes"].append("No ANTHROPIC_API_KEY found, so the offline scorer picked the moments.")
            else:
                update(state, step=f"Claude ({model}, {effort} effort) is watching the candidates")
                try:
                    data, usage = ask_claude(state, key, client=client)
                    raw, used_claude = data.get("picks", []), True
                    if data.get("footage_notes"):
                        state["notes"].append("Claude: " + data["footage_notes"].strip())
                except ShortsError as e:
                    state["notes"].append(f"{e} The offline scorer picked the moments instead.")
        if not used_claude:
            raw = offline_picks(state)
        picks, notes = finalize_picks(raw, dur, count, from_claude=used_claude)
        if used_claude and not picks:
            notes.append("Claude found no moment worth a Short in this video.")
        state["notes"].extend(notes)

        update(state, step="Drawing the storyboard")
        for p in picks:
            p["storyboard"] = storyboard(d, src, p)
        update(state, picks=picks, usage=usage, status="review", step="Ready for review")
        write_package(state)
    except ShortsError as e:
        update(state, status="error", error=str(e), step="")
    except Exception as e:  # noqa: BLE001 - surface anything unexpected in the page
        update(state, status="error", error=f"Unexpected problem: {e}", step="")
        raise
    return state


# ---------------------------------------------------------------------------------------------------------------
# 6. caption image and storyboard

def _is_emoji(ch: str) -> bool:
    cp = ord(ch)
    return (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF or 0x2300 <= cp <= 0x23FF
            or cp in (0xFE0F, 0x200D) or 0x1F1E6 <= cp <= 0x1F1FF)


def _emoji_font():
    from PIL import ImageFont
    for d in (Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts", STUDIO / "fonts",
              Path("/System/Library/Fonts")):
        if d.exists():
            hit = next(iter(d.rglob("NotoColorEmoji*.ttf")), None)
            if hit:
                try:
                    return ImageFont.truetype(str(hit), 109)  # the only size this bitmap font has
                except OSError:
                    pass
    return None


def _runs(text: str) -> list[tuple[str, bool]]:
    out: list[tuple[str, bool]] = []
    for ch in text:
        e = _is_emoji(ch)
        if out and out[-1][1] == e:
            out[-1] = (out[-1][0] + ch, e)
        else:
            out.append((ch, e))
    return out


def caption_image(text: str, out: Path, box_w: int = CAPTION_BOX[2] - CAPTION_BOX[0],
                  box_h: int = CAPTION_BOX[3] - CAPTION_BOX[1]) -> Path:
    """White meme text with a thick black outline and colour emoji, centred, up to 3 lines, sized to fit."""
    from PIL import Image, ImageDraw
    efont = _emoji_font()

    def measure(line: str, font, size: int) -> int:
        w = 0
        for chunk, is_e in _runs(line):
            if is_e:
                w += int(size * 1.15) * len([c for c in chunk if c not in "\ufe0f\u200d"])
            else:
                w += int(font.getlength(chunk))
        return w

    words = text.split()
    for size in range(96, 39, -4):
        font = _font(size)
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if measure(trial, font, size) <= box_w - 20 or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        line_h = int(size * 1.22)
        if len(lines) <= 3 and len(lines) * line_h <= box_h and all(measure(l, font, size) <= box_w for l in lines):
            break
    img = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    stroke = max(4, size // 11)
    y = (box_h - len(lines) * line_h) // 2
    for line in lines:
        x = (box_w - measure(line, font, size)) // 2
        for chunk, is_e in _runs(line):
            if is_e:
                for ch in chunk:
                    if ch in "\ufe0f\u200d":
                        continue
                    es = int(size * 1.05)
                    if efont:
                        tile = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
                        ImageDraw.Draw(tile).text((0, 0), ch, font=efont, embedded_color=True)
                        tile = tile.crop(tile.getbbox() or (0, 0, 1, 1)).resize((es, es))
                        img.alpha_composite(tile, (x, y + (line_h - es) // 2))
                    x += int(size * 1.15)
            else:
                d.text((x, y), chunk, font=font, fill=(255, 255, 255), stroke_width=stroke, stroke_fill=(0, 0, 0))
                x += int(font.getlength(chunk))
        y += line_h
    img.save(out)
    return out


def storyboard(d: Path, src: Path, pick: dict) -> str:
    """A phone-shaped mock of the Short at its payoff, plus four frames across the cut."""
    from PIL import Image, ImageDraw, ImageFilter
    sb = d / "storyboard"
    sb.mkdir(exist_ok=True)
    n = pick.get("n", 0)
    s, e, h = pick["start"], pick["end"], pick["hook_time"]
    times = [s + 0.3, max(s, h - 1.5), h, max(s, e - 0.4)]
    frames = grab_frames(src, times, sb / f"tmp{n}", width=960)
    hook = frames.get(h)
    phone_w, phone_h = 360, 640
    sheet = Image.new("RGB", (phone_w + 4 * 300 + 50, phone_h + 20), (12, 14, 18))
    if hook:
        im = Image.open(hook).convert("RGB")
        bg = im.resize((int(im.width * phone_h / im.height), phone_h)).filter(ImageFilter.GaussianBlur(14))
        bg = bg.crop(((bg.width - phone_w) // 2, 0, (bg.width - phone_w) // 2 + phone_w, phone_h))
        fg_w = int(phone_w * 4 / 3)
        fg = im.resize((fg_w, int(im.height * fg_w / im.width)))
        fg = fg.crop(((fg_w - phone_w) // 2, 0, (fg_w - phone_w) // 2 + phone_w, fg.height))
        bg.paste(fg, (0, int(FG_Y / OUT_H * phone_h)))
        cap = caption_image(pick["caption"], sb / f"cap{n}.png")
        cap_im = Image.open(cap)
        scale = phone_w / OUT_W
        cap_im = cap_im.resize((int(cap_im.width * scale), int(cap_im.height * scale)))
        bg.paste(cap_im, (int(CAPTION_BOX[0] * scale), int(CAPTION_BOX[1] * scale)), cap_im)
        sheet.paste(bg, (10, 10))
    dr = ImageDraw.Draw(sheet)
    small = _font(20)
    for i, t in enumerate(times):
        p = frames.get(t)
        x = phone_w + 30 + i * 300
        if p:
            im = Image.open(p).convert("RGB")
            im = im.resize((290, int(im.height * 290 / im.width)))
            sheet.paste(im, (x, 200))
        label = ["start", "setup", "payoff", "end"][i] + "  " + fmt_t(t)
        dr.text((x, 175), label, fill=(255, 220, 80), font=small)
    dr.text((phone_w + 30, 30), f"Short {n}: {fmt_t(s)} - {fmt_t(e)} ({e - s:.1f} s)", fill=(240, 240, 240),
            font=_font(26))
    dr.text((phone_w + 30, 70), pick["moment"][:110], fill=(200, 200, 200), font=_font(18, bold=False))
    name = f"storyboard/short-{n:02d}.jpg"
    sheet.save(d / name, quality=85)
    shutil.rmtree(sb / f"tmp{n}", ignore_errors=True)
    return name


# ---------------------------------------------------------------------------------------------------------------
# 7. render

def zoom_expr(hook_rel: float, amount: float = 0.16, ramp_in: float = 0.18, hold: float = 1.1,
              ramp_out: float = 0.35) -> str:
    """zoompan zoom: 1.0, easing up to 1+amount on the payoff, holding, easing back."""
    a, b, c = hook_rel - ramp_in, hook_rel + hold, hook_rel + hold + ramp_out
    up = f"clip((it-{a:.3f})/{ramp_in:.3f},0,1)"
    down = f"clip(({c:.3f}-it)/{ramp_out:.3f},0,1)"
    return f"1+{amount}*{up}*{down}" if b < c else "1"


def render_pick(state: dict, pick: dict, frame: str = "zoom") -> dict:
    d = job_dir(state["id"])
    src = d / "source.mp4"
    meta = state["video"]
    (d / "renders").mkdir(exist_ok=True)
    n = pick["n"]
    out = d / "renders" / f"short-{n:02d}-{slugify(pick['caption'], 30)}.mp4"
    cap = caption_image(pick["caption"], d / "renders" / f"caption-{n:02d}.png")
    s, e = pick["start"], pick["end"]
    length = e - s
    hook_rel = pick["hook_time"] - s
    fps = min(60.0, meta.get("fps") or 30.0)
    fg_w = 1440 if frame == "zoom" else 1080
    fg_h = int(round(fg_w * 9 / 16 / 2) * 2)
    z = zoom_expr(hook_rel)
    vf = (
        f"[0:v]fps={fps:.3f},setsar=1,split=2[a][b];"
        f"[a]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},"
        f"boxblur=40:3,eq=brightness=-0.10:saturation=1.1[bg];"
        f"[b]zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={fg_w}x{fg_h}:fps={fps:.3f},"
        f"crop={min(fg_w, OUT_W)}:{fg_h}[fg];"
        f"[bg][fg]overlay=x=(W-w)/2:y={FG_Y}[v1];"
        f"[v1][1:v]overlay=x={CAPTION_BOX[0]}:y={CAPTION_BOX[1]},format=yuv420p[v]"
    )
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{s:.3f}", "-t", f"{length:.3f}", "-i", str(src),
           "-i", str(cap)]
    if meta.get("has_audio"):
        af = f"[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.04,afade=t=out:st={max(0, length - 0.12):.3f}:d=0.12[aout]"
    else:
        cmd += ["-f", "lavfi", "-t", f"{length:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        af = "[2:a]anull[aout]"
    cmd += ["-filter_complex", vf + ";" + af, "-map", "[v]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{length:.3f}", str(out)]
    r = run(cmd)
    if r.returncode != 0 or not out.exists():
        raise ShortsError(f"Rendering Short {n} failed: {r.stderr.decode(errors='ignore')[-400:]}")
    return {"file": f"renders/{out.name}", "qc": check_render(out, length)}


def measure_loudness(path: Path) -> float | None:
    r = run(["ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-map", "0:a", "-af", "ebur128", "-f", "null", "-"])
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr.decode(errors="ignore"))
    return float(m[-1]) if m else None


def check_render(path: Path, expected: float) -> dict:
    """Quick checks on the exported file (the studio's full gate is tools/qc.py once it exists)."""
    info = probe(path) if path.stat().st_size else {}
    lufs = measure_loudness(path)
    problems = []
    if (info.get("width"), info.get("height")) != (OUT_W, OUT_H):
        problems.append(f"size is {info.get('width')}x{info.get('height')}, not {OUT_W}x{OUT_H}")
    if abs(info.get("duration", 0) - expected) > 0.5:
        problems.append(f"length {info.get('duration', 0):.1f} s, expected {expected:.1f} s")
    if lufs is None:
        problems.append("no audio measured")
    elif not -16.5 <= lufs <= -12.5:
        problems.append(f"loudness {lufs:.1f} LUFS (target -14)")
    if info.get("duration", 0) > 180:
        problems.append("over YouTube's 3-minute Shorts limit")
    return {"pass": not problems, "problems": problems, "lufs": lufs, "duration": info.get("duration"),
            "size": f"{info.get('width')}x{info.get('height')}", "mb": info.get("size_mb")}


def render(state: dict, picks: list[int] | None = None, frame: str = "zoom") -> dict:
    if picks:
        chosen = [p for p in state["picks"] if p["n"] in picks]
    else:  # CLI without --picks: the ticked ones, or all of them if none are ticked
        chosen = [p for p in state["picks"] if p.get("selected")] or list(state["picks"])
    if not chosen:
        raise ShortsError("None of those Shorts exist in this job.")
    update(state, status="rendering", error=None)
    renders = dict(state.get("renders") or {})
    try:
        for i, p in enumerate(chosen, 1):
            update(state, step=f"Rendering Short {p['n']} ({i} of {len(chosen)})")
            renders[str(p["n"])] = render_pick(state, p, frame)
            update(state, renders=renders)
        update(state, status="done", step="Shorts ready")
        write_package(state)
    except ShortsError as e:
        update(state, status="error", error=str(e), step="")
    return state


def write_package(state: dict):
    d = job_dir(state["id"])
    lines = [f"# Shorts from {state.get('name', state['id'])}", ""]
    if state.get("usage"):
        u = state["usage"]
        lines += [f"Picked by {u['model']}: {u['input_tokens']:,} input + {u['output_tokens']:,} output tokens, "
                  f"about ${u['cost_usd']:.3f}.", ""]
    for note in state.get("notes", []):
        lines.append(f"- {note}")
    for p in state.get("picks", []):
        rd = (state.get("renders") or {}).get(str(p["n"]))
        lines += ["", f"## Short {p['n']}: {p['caption']}", "",
                  f"- Source: {fmt_t(p['start'])} to {fmt_t(p['end'])} ({p['end'] - p['start']:.1f} s), "
                  f"payoff at {fmt_t(p['hook_time'])}",
                  f"- File: {rd['file'] if rd else 'not rendered yet'}",
                  f"- What happens: {p['moment']}", f"- Why: {p['why']}", "",
                  "**Title**", "", p["title"], "", "**Description**", "", p["description"], "",
                  " ".join(p["hashtags"]), ""]
    (d / "package.md").write_text("\n".join(lines))


# ---------------------------------------------------------------------------------------------------------------
# CLI

def list_jobs() -> list[dict]:
    out = []
    if JOBS.exists():
        for p in sorted(JOBS.glob("*/job.json"), reverse=True):
            try:
                j = json.loads(p.read_text())
                out.append({"id": j["id"], "name": j.get("name"), "status": j.get("status"), "step": j.get("step"),
                            "picks": len(j.get("picks", [])), "renders": len(j.get("renders") or {}),
                            "created": j.get("created")})
            except (json.JSONDecodeError, KeyError):
                continue
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("video", type=Path)
    a.add_argument("--model", default=os.environ.get("GTA_SHORTS_MODEL", DEFAULT_MODEL))
    a.add_argument("--effort", default="medium", choices=EFFORTS)
    a.add_argument("--count", type=int, default=4)
    a.add_argument("--candidates", type=int, default=10)
    a.add_argument("--transcribe", action="store_true")
    a.add_argument("--job")
    r = sub.add_parser("render")
    r.add_argument("job")
    r.add_argument("--picks", help="comma-separated Short numbers to render, e.g. 1,3 (default: the ticked ones, else all)")
    r.add_argument("--frame", default="zoom", choices=("zoom", "fit"))
    s = sub.add_parser("status")
    s.add_argument("job", nargs="?")
    v = sub.add_parser("serve")
    v.add_argument("--port", type=int, default=8765)
    v.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "analyze":
            state = new_job(args.video, args.job)
            analyze(state, args.model, args.effort, args.count, args.candidates, args.transcribe)
            print_status(state)
            if state["status"] == "review":
                print(f"\nCheck the storyboards, then: python3 tools/gta_shorts.py render {state['id']}")
        elif args.cmd == "render":
            state = load_job(args.job)
            picks = [int(x) for x in args.picks.split(",")] if args.picks else None
            render(state, picks, args.frame)
            print_status(state)
        elif args.cmd == "status":
            if args.job:
                print_status(load_job(args.job))
            else:
                for j in list_jobs():
                    print(f"{j['id']}  {j['status']:<10} picks {j['picks']}  rendered {j['renders']}")
        elif args.cmd == "serve":
            sys.path.insert(0, str(Path(__file__).parent))
            import gta_shorts_web
            gta_shorts_web.serve(args.host, args.port)
    except ShortsError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


def print_status(state: dict):
    d = job_dir(state["id"])
    print(f"Job {state['id']}: {state['status']}" + (f" ({state['error']})" if state.get("error") else ""))
    if state.get("usage"):
        u = state["usage"]
        print(f"  {u['model']}: {u['input_tokens']:,} in / {u['output_tokens']:,} out, about ${u['cost_usd']:.3f}")
    for note in state.get("notes", []):
        print(f"  note: {note}")
    for p in state.get("picks", []):
        print(f"  {p['n']}. [{fmt_t(p['start'])}-{fmt_t(p['end'])}] {p['caption']}  ({p['picked_by']}, {p['total']}/50)")
        print(f"     title: {p['title']}")
        print(f"     storyboard: {d / p['storyboard']}" if p.get("storyboard") else "")
        rd = (state.get("renders") or {}).get(str(p["n"]))
        if rd:
            q = rd["qc"]
            print(f"     render: {d / rd['file']}  {'PASS' if q['pass'] else 'CHECK: ' + '; '.join(q['problems'])}")
    if (d / "package.md").exists():
        print(f"  package: {d / 'package.md'}")


if __name__ == "__main__":
    sys.exit(main())
