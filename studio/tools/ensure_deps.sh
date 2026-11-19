#!/usr/bin/env bash
# ensure_deps.sh: install only what the studio tools need and is missing. Safe to run any time.
#
# Usage:
#   bash studio/tools/ensure_deps.sh           check, and install whatever is missing
#   bash studio/tools/ensure_deps.sh --check   only report; install nothing (exit 1 if something is missing)
#
# What each build step needs (steps from studio/BRIEF.md "Build order"):
#   1. script tools (script_check, script_score): Python 3.10+ standard library only; pytest for the tests.
#   2. voice tools: ffmpeg, and the speech model (added in step 2).
#   GTA Shorts (tools/gta_shorts.py): ffmpeg, Pillow, anthropic, numpy; a colour emoji font (fonts-noto-color-emoji).
# Python packages go to the current Python; nothing is installed system-wide unless pip does so by default.
set -u

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
PY="${PYTHON:-python3}"
missing=0
installed=0

say() { printf '%s\n' "$*"; }

# --- Python itself -----------------------------------------------------------------------------------------
if ! command -v "$PY" >/dev/null 2>&1; then
  say "MISSING  python3 (3.10 or newer): install it from python.org or your package manager"
  exit 1
fi
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  say "MISSING  Python 3.10+ (found $("$PY" -V 2>&1))"
  exit 1
fi
say "ok       $("$PY" -V 2>&1)"

# --- Python packages: "import name|pip name" ---------------------------------------------------------------
PY_PACKAGES=(
  "pytest|pytest"
  "PIL|Pillow"            # GTA Shorts: contact sheets, captions, storyboards
  "anthropic|anthropic"   # GTA Shorts: Claude picks the moments (optional without an API key)
  "numpy|numpy"           # GTA Shorts: fast loudness envelope (falls back to pure Python)
)
# Optional, not installed by default (large): faster-whisper, for "Transcribe my mic" in GTA Shorts.

pip_install() {
  # Some system Pythons refuse pip installs (PEP 668); fall back to a user install, then to the override.
  "$PY" -m pip install --quiet "$@" 2>/dev/null \
    || "$PY" -m pip install --quiet --user "$@" 2>/dev/null \
    || "$PY" -m pip install --quiet --break-system-packages "$@"
}

for entry in "${PY_PACKAGES[@]}"; do
  mod="${entry%%|*}"
  pkg="${entry#*|}"
  if "$PY" -c "import $mod" 2>/dev/null; then
    say "ok       $pkg ($("$PY" -c "import $mod; print(getattr($mod, '__version__', ''))" 2>/dev/null))"
  elif [ "$CHECK_ONLY" = 1 ]; then
    say "MISSING  $pkg"
    missing=1
  else
    say "install  $pkg"
    if pip_install "$pkg"; then installed=$((installed + 1)); else say "FAILED   $pkg"; missing=1; fi
  fi
done

# --- Command-line tools (step 2 onwards) -------------------------------------------------------------------
# ffmpeg is listed now so the report shows it; nothing in step 1 needs it.
if command -v ffmpeg >/dev/null 2>&1; then
  say "ok       ffmpeg ($(ffmpeg -version 2>/dev/null | head -n1 | awk '{print $3}')) (needed from step 2)"
else
  say "later    ffmpeg is not installed (needed from step 2, the voice tools)"
fi

if [ "$missing" = 1 ]; then
  say "Some dependencies are missing."
  exit 1
fi
if [ "$installed" = 0 ]; then say "Nothing to install."; else say "Installed $installed package(s)."; fi
