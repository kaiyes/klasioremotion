#!/usr/bin/env bash
set -euo pipefail

OUT="out/shorts_jujutsu_kaisen"
mkdir -p "$OUT"

cp source_content/jujutsu_kaisen/subs/word-candidates-db.json "${OUT}/word-candidates-db.json"

echo "=== RANK: jujutsu_kaisen ==="
node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/jujutsu_kaisen/subs/japanese \
  --videosDir source_content/jujutsu_kaisen/videos \
  --enSubsDir source_content/jujutsu_kaisen/subs/english_embedded \
  --subOffsetsFile source_content/jujutsu_kaisen/subs/sub-offsets.json \
  --outBase "$OUT" \
  --resume
echo "=== DONE ==="
