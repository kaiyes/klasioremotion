#!/usr/bin/env bash
set -euo pipefail
echo "=== RENDER: boku_no_hero ==="
node scripts/word-pipeline.js render --all --fast --short \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/boku_no_hero/subs/japanese \
  --videosDir source_content/boku_no_hero/videos \
  --enSubsDir source_content/boku_no_hero/subs/english_embedded \
  --outBase out/shorts_boku_no_hero \
  --resume --allowFallbackRender --verbose --printEvery 1 --noQr --noEndCard
echo "=== DONE ==="
