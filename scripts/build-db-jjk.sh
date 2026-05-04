#!/usr/bin/env bash
set -euo pipefail
echo "=== BUILD DB: jujutsu_kaisen ==="
npm run -s build-word-candidates-db -- \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/jujutsu_kaisen/subs/japanese \
  --videosDir source_content/jujutsu_kaisen/videos \
  --enSubsDir source_content/jujutsu_kaisen/subs/english_embedded \
  --subOffsetsFile source_content/jujutsu_kaisen/subs/sub-offsets.json \
  --outFile source_content/jujutsu_kaisen/subs/word-candidates-db.json \
  --maxPerWord 50 \
  --resume
echo "=== DONE ==="
