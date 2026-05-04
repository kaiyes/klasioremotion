#!/usr/bin/env bash
set -euo pipefail

OUT="out/shorts_shingeki_no_kyojin"
mkdir -p "$OUT"

cp source_content/shingeki_no_kyojin/subs/word-candidates-db.json "${OUT}/word-candidates-db.json"

echo "=== RANK: shingeki_no_kyojin ==="
node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/shingeki_no_kyojin/subs/japanese \
  --videosDir source_content/shingeki_no_kyojin/videos \
  --enSubsDir source_content/shingeki_no_kyojin/subs/english_embedded \
  --subOffsetsFile source_content/shingeki_no_kyojin/subs/sub-offsets.json \
  --outBase "$OUT" \
  --resume
echo "=== DONE ==="
