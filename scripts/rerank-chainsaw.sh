#!/usr/bin/env bash
set -euo pipefail
echo "=== RE-RANK: chainsaw_man (error + gated words only) ==="

# re-rank with force: reprocess error words, relax gates for gated words
node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/chainsaw_man/subs/japanese \
  --videosDir source_content/chainsaw_man/videos \
  --enSubsDir source_content/chainsaw_man/subs/english_embedded \
  --subOffsetsFile source_content/chainsaw_man/subs/sub-offsets.json \
  --outBase out/shorts_chainsaw_man \
  --resume
echo "=== DONE ==="
