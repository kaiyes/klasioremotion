#!/usr/bin/env bash
set -euo pipefail

WORDS_FILE="source_content/top2000_vocab.json"
LLAMA_SERVER="/home/kaiyes/.openclaw/vendor/llama.cpp-shallow/build-vulkan/bin/llama-server"
LLAMA_MODEL="/home/kaiyes/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf"
LLAMA_HOST="127.0.0.1"
LLAMA_PORT="18080"
LLAMA_DEVICE="Vulkan0"

ANIMES=("chainsaw_man" "jujutsu_kaisen" "shingeki_no_kyojin")

# ── cleanup old DBs built from previous word list ─────────────
for ANIME in jujutsu_kaisen shingeki_no_kyojin; do
  DB="source_content/${ANIME}/subs/word-candidates-db.json"
  if [ -f "$DB" ]; then
    OLD=$(node -e "const j=JSON.parse(require('fs').readFileSync('$DB','utf8')); console.log(j.meta?.wordsFile||'')")
    if echo "$OLD" | grep -q "all_anime_top_2000.match"; then
      echo "[cleanup] removing old DB for ${ANIME} (built from old word list)"
      rm -f "$DB"
    fi
  fi
done

# ── helpers ──────────────────────────────────────────────────

ensure_llama_server() {
  if curl -s "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
    echo "[server] already running on ${LLAMA_HOST}:${LLAMA_PORT}"
    return 0
  fi
  echo "[server] starting llama-server..."
  nohup "$LLAMA_SERVER" \
    --model "$LLAMA_MODEL" \
    --host "$LLAMA_HOST" \
    --port "$LLAMA_PORT" \
    --device "$LLAMA_DEVICE" \
    --n-gpu-layers 99 \
    --ctx-size 8192 \
    > /tmp/llama-server.log 2>&1 &
  sleep 5
  for i in $(seq 1 30); do
    if curl -s "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
      echo "[server] ready"
      return 0
    fi
    sleep 2
  done
  echo "[server] FAILED to start"
  return 1
}

# ── main loop ────────────────────────────────────────────────

for ANIME in "${ANIMES[@]}"; do
  SUBS_DIR="source_content/${ANIME}/subs/japanese"
  EN_SUBS_DIR="source_content/${ANIME}/subs/english_embedded"
  VIDEOS_DIR="source_content/${ANIME}/videos"
  OFFSETS_FILE="source_content/${ANIME}/subs/sub-offsets.json"
  DB_FILE="source_content/${ANIME}/subs/word-candidates-db.json"
  OUT_BASE="out/shorts_${ANIME}"

  echo ""
  echo "============================================================"
  echo "  PIPELINE: ${ANIME}"
  echo "============================================================"

  # ── 1. BUILD ──────────────────────────────────────────────
  echo ""
  echo "--- BUILD: ${ANIME} ---"
  mkdir -p "$OUT_BASE"
  npm run -s build-word-candidates-db -- \
    --wordsFile "$WORDS_FILE" \
    --queryField kanji \
    --subsDir "$SUBS_DIR" \
    --videosDir "$VIDEOS_DIR" \
    --enSubsDir "$EN_SUBS_DIR" \
    --subOffsetsFile "$OFFSETS_FILE" \
    --outFile "$DB_FILE" \
    --resume

  echo "[build] done"

  # ── 2. RANK ──────────────────────────────────────────────
  echo ""
  echo "--- RANK: ${ANIME} ---"
  ensure_llama_server

  cp "$DB_FILE" "${OUT_BASE}/word-candidates-db.json"

  node scripts/word-pipeline.js rank --all --fast --allowWeak \
    --wordsFile "$WORDS_FILE" \
    --queryField kanji \
    --subsDir "$SUBS_DIR" \
    --videosDir "$VIDEOS_DIR" \
    --enSubsDir "$EN_SUBS_DIR" \
    --subOffsetsFile "$OFFSETS_FILE" \
    --outBase "$OUT_BASE" \
    --resume

  echo "[rank] done"

  # ── 3. RENDER ────────────────────────────────────────────
  echo ""
  echo "--- RENDER: ${ANIME} ---"
  node scripts/word-pipeline.js render --all --fast --short \
    --wordsFile "$WORDS_FILE" \
    --queryField kanji \
    --subsDir "$SUBS_DIR" \
    --videosDir "$VIDEOS_DIR" \
    --enSubsDir "$EN_SUBS_DIR" \
    --subOffsetsFile "$OFFSETS_FILE" \
    --outBase "$OUT_BASE" \
    --resume --allowFallbackRender

  echo "[render] done"

  echo ""
  echo "============================================================"
  echo "  DONE: ${ANIME}  →  ${OUT_BASE}/*.mp4"
  echo "============================================================"
done

echo ""
echo "ALL DONE. Outputs per anime:"
for ANIME in "${ANIMES[@]}"; do
  COUNT=$(ls "out/shorts_${ANIME}/"*.mp4 2>/dev/null | wc -l)
  echo "  out/shorts_${ANIME}/  →  ${COUNT} mp4s"
done
