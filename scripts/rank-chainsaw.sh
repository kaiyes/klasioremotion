#!/usr/bin/env bash
set -euo pipefail

LLAMA_SERVER="/home/kaiyes/projects/llama.cpp/build-vulkan/bin/llama-server"
LLAMA_MODEL="/home/kaiyes/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf"
LLAMA_HOST="127.0.0.1"
LLAMA_PORT="18080"

DB="source_content/chainsaw_man/subs/word-candidates-db.json"
OUT="out/shorts_chainsaw_man"

# ── start server if not running ────────────────────────────
if ! curl -s "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
  echo "[server] starting llama-server (Vulkan, 4B)..."
  nohup "$LLAMA_SERVER" \
    --model "$LLAMA_MODEL" \
    --host "$LLAMA_HOST" \
    --port "$LLAMA_PORT" \
    --device Vulkan0 \
    --n-gpu-layers 99 \
    --ctx-size 8192 \
    > /tmp/llama-server.log 2>&1 &
  for i in $(seq 1 45); do
    if curl -s "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
      echo "[server] ready"
      break
    fi
    sleep 2
  done
else
  echo "[server] already running"
fi

# ── rank ───────────────────────────────────────────────────
echo ""
echo "=== RANK: chainsaw_man ==="
mkdir -p "$OUT"
cp "$DB" "${OUT}/word-candidates-db.json"

node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji \
  --subsDir source_content/chainsaw_man/subs/japanese \
  --videosDir source_content/chainsaw_man/videos \
  --enSubsDir source_content/chainsaw_man/subs/english_embedded \
  --subOffsetsFile source_content/chainsaw_man/subs/sub-offsets.json \
  --outBase "$OUT" \
  --resume

echo ""
echo "=== DONE ==="
