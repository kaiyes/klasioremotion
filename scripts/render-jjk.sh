#!/usr/bin/env bash
set -euo pipefail
echo "=== RENDER: jujutsu_kaisen ==="
node scripts/word-pipeline.js render --all --fast --short \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/jujutsu_kaisen/subs/japanese \
  --videosDir source_content/jujutsu_kaisen/videos \
  --enSubsDir source_content/jujutsu_kaisen/subs/english_embedded \
  --subOffsetsFile source_content/jujutsu_kaisen/subs/sub-offsets.json \
  --outBase out/shorts_jujutsu_kaisen \
  --resume --allowFallbackRender --verbose --printEvery 1 --noQr --noEndCard
echo "=== DONE ==="
