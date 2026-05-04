#!/usr/bin/env bash
set -euo pipefail
echo "=== RENDER: shingeki_no_kyojin ==="
node scripts/word-pipeline.js render --all --fast --short \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/shingeki_no_kyojin/subs/japanese \
  --videosDir source_content/shingeki_no_kyojin/videos \
  --enSubsDir source_content/shingeki_no_kyojin/subs/english_embedded \
  --subOffsetsFile source_content/shingeki_no_kyojin/subs/sub-offsets.json \
  --outBase out/shorts_shingeki_no_kyojin \
  --resume --allowFallbackRender --verbose --printEvery 1 --noQr --noEndCard
echo "=== DONE ==="
