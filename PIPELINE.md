# Klasioremotion — Full Pipeline Doc

This is the single source of truth for the anime word shorts pipeline.  
All other `.md` files are superseded by this doc.

---

## Overview

Node.js + ffmpeg pipeline that mines Japanese anime subtitles for words from a curated vocabulary list, finds good example lines, ranks them with a local LLM, and renders `1080x1920` vertical learning shorts.

### Core Scripts

| Script | Role |
|--------|------|
| `scripts/word-pipeline.js` | High-level entry: build → rank → render |
| `scripts/extract-clips.js` | Subtitle scanning, candidate extraction, clip cutting |
| `scripts/build-word-candidates-db.js` | Batch candidate DB builder |
| `scripts/rerank-word-candidates-ollama.js` | LLM reranker (supports ollama + llamacpp) |
| `scripts/make-vertical-shorts-clean.js` | ffmpeg-based short renderer |
| `scripts/word-curate.js` | Manual curation CLI |
| `scripts/auto-curate-word-shorts.js` | Orchestration: build → rank → render |

---

## Current Production Datasets

**Word list:** `source_content/top2000_vocab.json` (1667 words)  
Layout: `{ "kanji", "reading", "romaji", "meaning", "frequency" }`

**Anime:**

| Anime | Eps | DB | Ranking | Output |
|-------|-----|-----|---------|--------|
| chainsaw_man | 12 | `source_content/chainsaw_man/subs/word-candidates-db.json` | `out/shorts_chainsaw_man/word-candidates-llm-top.full.json` | `out/shorts_chainsaw_man/` |
| jujutsu_kaisen | 59 | `source_content/jujutsu_kaisen/subs/word-candidates-db.json` | `out/shorts_jujutsu_kaisen/word-candidates-llm-top.full.json` | `out/shorts_jujutsu_kaisen/` |
| shingeki_no_kyojin | 88 | `source_content/shingeki_no_kyojin/subs/word-candidates-db.json` | `out/shorts_shingeki_no_kyojin/word-candidates-llm-top.full.json` | `out/shorts_shingeki_no_kyojin/` |

### Known Anime Issues

**Boku no Hero Academia — [Sokudo] BD release: clean**
- Dual audio (eng + jpn opus), no hardsubs. AV1 video (re-encoded by pipeline).
- JP subs from kitsunekko-mirror (retimed from Netflix). 13 episodes (s1) ready.

---

## Per-Anime File Layout

```
source_content/<anime>/
  videos/              # .mkv episodes
  subs/
    japanese/          # JP subtitles (.srt or .ass)
    english_embedded/  # EN subtitles (extracted from video)
    sub-offsets.json   # Per-episode timing offsets
    sub-sync-db.json   # Synced timing database
    word-candidates-db.json  # Candidate DB (build step output)
```

Sub sync is done once per anime via:
- `scripts/calibrate-sub-sync.js`
- `scripts/align-episode-subs.js`

---

## LLM Runtime

**Working binary:** `/home/kaiyes/projects/llama.cpp/build-vulkan/bin/llama-server` (Vulkan build)  
**Model:** Qwen3.5 4B Q4_K_M (`~/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf`)  
**GPU:** Vulkan0 (AMD Radeon RX 590 Series)

### Start server
```bash
./scripts/runLlamaCLI.sh
```
Or manually:
```bash
nohup /home/kaiyes/projects/llama.cpp/build-vulkan/bin/llama-server \
  --model ~/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 18080 \
  --device Vulkan0 --n-gpu-layers 99 --ctx-size 8192 \
  > /tmp/llama-server.log 2>&1 &
```

### Vision/OCR (for AV evaluation)
Requires GGUF + matching mmproj pair. Cached locally:
- 2B: `unsloth_Qwen3.5-2B-GGUF_Qwen3.5-2B-Q4_K_M.gguf` + `mmproj-F16.gguf`
- 4B: `unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf` + `mmproj-F16.gguf`

---

## Pipeline Commands

### Build DB (one anime)
```bash
# Chainsaw (12 eps, fast)
npm run -s build-word-candidates-db -- \
  --wordsFile source_content/top2000_vocab.json \
  --queryField kanji --maxPerWord 50 --no-resume \
  --subsDir source_content/<anime>/subs/japanese \
  --videosDir source_content/<anime>/videos \
  --enSubsDir source_content/<anime>/subs/english_embedded \
  --subOffsetsFile source_content/<anime>/subs/sub-offsets.json \
  --outFile source_content/<anime>/subs/word-candidates-db.json
```

### Rank (needs llama server running)
```bash
mkdir -p out/shorts_<anime>
cp source_content/<anime>/subs/word-candidates-db.json out/shorts_<anime>/word-candidates-db.json

node scripts/word-pipeline.js rank --all --fast --allowWeak \
  --wordsFile source_content/top2000_vocab.json --queryField kanji \
  --subsDir source_content/<anime>/subs/japanese \
  --videosDir source_content/<anime>/videos \
  --enSubsDir source_content/<anime>/subs/english_embedded \
  --subOffsetsFile source_content/<anime>/subs/sub-offsets.json \
  --outBase out/shorts_<anime> --resume
```

### Render
```bash
node scripts/word-pipeline.js render --all --fast --short \
  --wordsFile source_content/top2000_vocab.json --queryField kanji \
  --subsDir source_content/<anime>/subs/japanese \
  --videosDir source_content/<anime>/videos \
  --enSubsDir source_content/<anime>/subs/english_embedded \
  --subOffsetsFile source_content/<anime>/subs/sub-offsets.json \
  --outBase out/shorts_<anime> --resume --allowFallbackRender --noQr --noEndCard
```

### Convenience scripts
```
./scripts/build-db-jjk.sh        # Build JJK DB
./scripts/build-db-shingeki.sh   # Build Shingeki DB
./scripts/rank-chainsaw.sh       # Rank Chainsaw
./scripts/rank-jjk.sh            # Rank JJK
./scripts/rank-shingeki.sh       # Rank Shingeki
./scripts/render-chainsaw.sh     # Render Chainsaw
./scripts/render-jjk.sh          # Render JJK
./scripts/runLlamaCLI.sh         # Start llama-server
./scripts/pipeline-all.sh        # Full pipeline: all 3 anime
./scripts/rerank-chainsaw.sh     # Re-rank Chainsaw (fix broken words)
```

### npm aliases (for old-style centralized pipeline)
```bash
npm run -s wp:one:fast -- 悪い      # One word: build + rank + render
npm run -s wp:rank:10:fast           # Rank first 10 words
npm run -s wp:render:10:fast         # Render first 10 words
npm run -s wp:rank:fast -- 20-30     # Rank range
npm run -s wp:render:fast -- 20-30   # Render range
npm run -s word:show -- 悪い         # Show picks for word
npm run -s word:replace -- 悪い 2=18 "reason"  # Replace clip slot
npm run -s word:pick -- 悪い 9,14,18,20,1      # Set exact picks
npm run -s word:board                 # Start curation UI (port 8790)
```

---

## Data Flow

### Step 1 — Build Candidate DB
`build-word-candidates-db.js` calls `extract-clips.js` in dry-run mode for each word. Extract-clips scans JP subtitle lines for the word, aligns EN subtitles, scores candidates, dedupes by sentence text. Stores all candidates in per-anime DB JSON.

### Step 2 — LLM Reranking
`rerank-word-candidates-ollama.js` (called by `word-pipeline.js rank`) applies gates (sense lock, fragment rejection, breath length), sends top-N shortlist to the LLM, and writes top picks per word to the rerank JSON.

### Step 3 — Render
`word-pipeline.js render` reads rerank picks, writes per-word candidate JSONs from DB, calls `make-vertical-shorts-clean.js` which:
1. Extracts video clips via `extract-clips.js --candidatesIn` (no subtitle re-scan)
2. Composes `1080x1920` vertical layout with word card, video, JP/EN subtitles

The render has a `db_fallback_topk` path: words that couldn't be ranked by LLM but have DB candidates get rendered with heuristic picks. This produces more output at lower quality.

### Data Contracts

**DB file** (`word-candidates-db.json`):
```json
{ "meta": {...}, "words": [{ "word": "お前", "candidates": [{ "episode", "clipStartMs", "clipEndMs", "jpText", "enText", "score" }], "candidateCount", "missing" }] }
```

**Rerank file** (`word-candidates-llm-top.full.json`):
```json
{ "meta": {...}, "words": [{ "word": "お前", "status": "ok|fallback|skip|error", "confidence", "top": [{ "rank", "candidateIndex", "llmScore", "jpText", "enText" }] }] }
```

**Status semantics:**
- `ok` — usable top picks, rendered by default
- `fallback` — LLM output weak, heuristic fallback used. Only rendered with `--allowFallbackRender`
- `skip` — no usable candidate survived gates
- `error` — exception/transport/parser failure

---

## Reranking Rules

### Gate definitions
1. **Sense lock** — prefers candidates where target word is present in intended sense
2. **Fragment rejection** — rejects clipped/incomplete utterances
3. **Breath length** — rejects JP lines shorter than `minBreathChars` (default 6)

### Safe operating policy
- Never run full rerank blindly
- Rerank in 10-word windows, validate in UI
- Keep one active file + one backup
- Validated promotion thresholds: 8/10 renderable, 7/10 acceptable without manual swaps

### Inspect rerank distribution
```bash
node -e 'const j=JSON.parse(require("fs").readFileSync("<rerank-file>","utf8"));let o=0,f=0,s=0,e=0;for(const w of j.words||[]){if(w.status==="ok")o++;else if(w.status==="fallback")f++;else if(w.status==="skip")s++;else e++;}console.log({words:j.words.length,ok:o,fallback:f,skip:s,error:e})'
```

### Rollback
```bash
cp out/saveFile/word-candidates-llm-top.full.backup.json out/shorts_<anime>/word-candidates-llm-top.full.json
```

---

## Manual Curation

```bash
npm run -s word:board      # Start UI at localhost:8790
npm run -s word:show -- 悪い         # Show picks
npm run -s word:replace -- 悪い 2=18 "reason"
npm run -s word:pick -- 悪い 9,14,18,20,1
```

Tags in UI: `Wrong Sense`, `Fragment`, `Trailing` — useful for spotting bad picks.

---

## Subtitle Sync Support

Scripts for timing alignment (run once per anime):
- `scripts/extract-embedded-english-subs.js`
- `scripts/estimate-sub-offset.js`
- `scripts/calibrate-sub-sync.js`
- `scripts/align-episode-subs.js`
- `scripts/align-all-episode-subs.js`

Outputs per anime: `sub-offsets.json`, `sub-sync-db.json`

---

## Corpus Mining Layer (Python)

Separate mining pass using the large kitsunekko subtitle mirror. Uses `fugashi + unidic-lite` for morphological analysis.

Scripts (in `.venv-corpus`):
- `scripts/build-lemma-forms.py` — lemma/form frequency mining
- `scripts/build-expression-candidates.py` — recurring expression discovery
- `scripts/promote-learning-targets.py` — promotion to teachable targets

Commands:
```bash
npm run corpus:lemma
npm run corpus:expressions
npm run corpus:promote
```

Outputs: `out/corpus/lemma_forms.*`, `out/corpus/expression_candidates.*`, `out/corpus/promoted_targets.json`

---

## Family Pipeline (Python)

Legacy family-mode rendering. Groups inflection/related forms per base word.

```bash
npm run -s family:audio:all -- --start 1 --count 500 --top 6
npm run -s family:render:all -- --start 1 --count 300 --top 8
npm run -s family:render:all:instagram -- --start 231 --count 69 --top 8
npm run -s family:render:one -- --base 思う --target 思っ --reading おもった
```

---

## Future Improvements

### Corpus/Linguistics Strategy (from usefulAnswer.md)
- Replace kuromoji with fugashi + UniDic for better morphology
- Use Sudachi.rs for normalization/splitting
- JMdict with examples as seed for expressions
- Local LLMs only for classification/promotion, not first-pass mining

### Candidate Quality
- Min context units beyond simple char count
- Lexical-sense hints from family metadata
- Stricter EN-JP pair consistency

### Rerank
- Persist UI rejection tags to rerank pre-filter
- LLM tie-break only (heuristic ordering preserved)
- Stronger run isolation (temp file → compare → promote)

---

## History

### 2026-05 — Multi-anime rebuild
Rebuilt DBs for Chainsaw Man, JJK, Shingeki from `top2000_vocab.json` (1667 words, `kanji` field). Switched to per-anime output dirs. Removed `match.forms` dependency. Fixed meaning lookup to support `kanji` field. Fixed DB size bloat (removed pretty-print in writeJson). Added `--maxPerWord 50` to control DB size.

### 2026-03 — Family pipeline, corpus mining
Added Python-based corpus mining pass (fugashi + unidic-lite). Family rendering with cache-first audio QA. Switched AV defaults to whisper.cpp + llamacpp 4B vision.

### 2026-02 — Pipeline stabilization
Established rerank freeze policy. Locked active/backup rerank files. Added word-pipeline.js as high-level wrapper. Introduced `wp:*` npm aliases. Fixed kanji matcher (disabled bare reading matches for kanji targets). Built match-form generator using kuromoji.

### Historical outputs
- `docs/PIPELINE_ADVENTURE_LOG_2026-03.md` — deep experiment log (archived)
- `docs/SUMMARY.md` — implementation log + handoff notes (archived)
