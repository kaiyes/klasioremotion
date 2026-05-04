#!/usr/bin/env bash
set -euo pipefail
echo "=== BUILD DB: shingeki_no_kyojin ==="
npm run -s build-word-candidates-db -- \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/shingeki_no_kyojin/subs/japanese \
  --videosDir source_content/shingeki_no_kyojin/videos \
  --enSubsDir source_content/shingeki_no_kyojin/subs/english_embedded \
  --subOffsetsFile source_content/shingeki_no_kyojin/subs/sub-offsets.json \
  --outFile source_content/shingeki_no_kyojin/subs/word-candidates-db.json \
  --maxPerWord 50 \
  --resume
echo "=== DONE ==="
