#!/usr/bin/env bash
set -euo pipefail
echo "=== RENDER: chainsaw_man ==="
node scripts/word-pipeline.js render --all --fast --short \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/chainsaw_man/subs/japanese \
  --videosDir source_content/chainsaw_man/videos \
  --enSubsDir source_content/chainsaw_man/subs/english_embedded \
  --subOffsetsFile source_content/chainsaw_man/subs/sub-offsets.json \
  --outBase out/shorts_chainsaw_man \
  --resume --allowFallbackRender --verbose --printEvery 1 --noQr --noEndCard
echo "=== DONE ==="
