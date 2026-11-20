#!/usr/bin/env bash
# Reproducible competition fixture: pallets/flask @ 3.1.3 (commit 22d92470) + an editable install in a venv.
# Usage: eval/setup-flask.sh   (idempotent). Python >= 3.9 required by Flask 3.1.x.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/work"
mkdir -p "$work"
if [ ! -d "$work/flask/.git" ]; then git clone --quiet https://github.com/pallets/flask.git "$work/flask"; fi
git -C "$work/flask" checkout --quiet 3.1.3
head="$(git -C "$work/flask" rev-parse --short=8 HEAD)"
if [ "$head" != "22d92470" ]; then echo "unexpected commit $head (wanted 22d92470)" >&2; exit 1; fi
git -C "$work/flask" status --porcelain | grep -q . && { echo "fixture tree is dirty" >&2; exit 1; } || true
PY="${PYTHON:-python3.11}"
command -v "$PY" >/dev/null || PY=python3
if [ ! -x "$work/venv/bin/python" ]; then "$PY" -m venv "$work/venv"; fi
"$work/venv/bin/python" -m pip install --quiet --upgrade pip
"$work/venv/bin/python" -m pip install --quiet -e "$work/flask" "pytest<9"
echo "fixture ready: flask 3.1.3 @ $head, venv: $work/venv"
"$work/venv/bin/python" -m pytest "$work/flask/tests/test_cli.py" -q -p no:cacheprovider 2>&1 | tail -2
