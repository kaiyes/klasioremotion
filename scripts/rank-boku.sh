#!/usr/bin/env bash
set -euo pipefail
OUT="out/shorts_boku_no_hero"
mkdir -p "$OUT"
cp source_content/boku_no_hero/subs/word-candidates-db.json "${OUT}/word-candidates-db.json"
echo "=== RANK: boku_no_hero ==="
node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/boku_no_hero/subs/japanese \
  --videosDir source_content/boku_no_hero/videos \
  --enSubsDir source_content/boku_no_hero/subs/english_embedded \
  --outBase "$OUT" \
  --resume
echo "=== DONE ==="
