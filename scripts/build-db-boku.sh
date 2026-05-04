#!/usr/bin/env bash
set -euo pipefail
echo "=== BUILD DB: boku_no_hero ==="
npm run -s build-word-candidates-db -- \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/boku_no_hero/subs/japanese \
  --videosDir source_content/boku_no_hero/videos \
  --enSubsDir source_content/boku_no_hero/subs/english_embedded \
  --outFile source_content/boku_no_hero/subs/word-candidates-db.json \
  --maxPerWord 50 \
  --no-resume
echo "=== DONE ==="
