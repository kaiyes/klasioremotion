#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export PYTHONUNBUFFERED=1

mkdir -p out/corpus/logs

echo "[corpus] start $(date -Is)"
.venv-corpus/bin/python scripts/build-lemma-forms.py "$@"
echo "[corpus] lemma done $(date -Is)"
.venv-corpus/bin/python scripts/build-expression-candidates.py "$@"
echo "[corpus] expressions done $(date -Is)"
.venv-corpus/bin/python scripts/promote-learning-targets.py
echo "[corpus] promote done $(date -Is)"
