"""Shared test helpers. Run the studio tests with: python3 -m pytest studio/tools/tests -q"""

import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(TOOLS))

SOURCES = """# Sources
- [S1] official | Rockstar Games | Grand Theft Auto VI: official site | https://www.rockstargames.com/VI | accessed 2026-11-15
- [S2] reported | TweakTown | install size | https://www.tweaktown.com/ | accessed 2026-11-15
- [G1] gameplay | our footage | clip 2026-11-20-beach.mp4 01:10-01:40
"""


@pytest.fixture
def write_script(tmp_path):
    """write_script(body, fmt="news", sources=SOURCES, **meta) -> path of a script in its own video folder."""
    counter = {"n": 0}

    def _write(body: str, fmt: str = "news", sources: str | None = SOURCES, **meta) -> Path:
        counter["n"] += 1
        folder = tmp_path / f"video{counter['n']}"
        (folder / "source").mkdir(parents=True)
        front = "\n".join([f"format: {fmt}"] + [f"{k}: {v}" for k, v in meta.items()])
        path = folder / "script.md"
        path.write_text(f"---\n{front}\n---\n{body.strip()}\n", encoding="utf-8")
        if sources is not None:
            (folder / "source" / "sources.md").write_text(sources, encoding="utf-8")
        return path

    return _write


@pytest.fixture(autouse=True)
def no_stumbles(tmp_path, monkeypatch):
    """Tests never read or write the real prompts/stumbles.txt."""
    import script_check
    monkeypatch.setattr(script_check, "STUMBLES_FILE", tmp_path / "stumbles.txt")
    monkeypatch.setattr(script_check, "VOICE_FILE", tmp_path / "voice.json")
