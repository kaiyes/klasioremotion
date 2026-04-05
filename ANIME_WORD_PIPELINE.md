# Anime Word Pipeline

Current scope: Node.js + ffmpeg anime vocab short generation.

This file is the at-a-glance source of truth for the current non-Remotion workflow.

Deep experiment log:
- [`docs/PIPELINE_ADVENTURE_LOG_2026-03.md`](/home/kaiyes/projects/klasioremotion/docs/PIPELINE_ADVENTURE_LOG_2026-03.md)

## What This Repo Is Doing

The active production workflow mines Japanese anime subtitles for words from a curated 2000-word list, finds good example lines, ranks them, and renders vertical learning shorts.

Current production dataset:
- Anime: `source_content/shingeki_no_kyojin`
- JP subtitles: `source_content/shingeki_no_kyojin/subs/japanese`
- EN subtitles: `source_content/shingeki_no_kyojin/subs/english_embedded`
- Videos: `source_content/shingeki_no_kyojin/videos`
- Word list: `source_content/all_anime_top_2000.match.first2000.json`
- Output root: `out/shorts`

## Main Pipeline

The active wrapper is:
- [`scripts/word-pipeline.js`](/home/kaiyes/projects/klasioremotion/scripts/word-pipeline.js)

It runs in three stages:
1. Build or reuse candidate examples for each word.
2. Rank the best candidates.
3. Render one short per word.

Common command shapes:

```bash
npm run -s wp:one:fast -- 悪い
npm run -s wp:rank:10:fast
npm run -s wp:render:10:fast
```

## Data Flow

### 1) Word list and match forms

The 2000-word JSON is not just a list. Each entry may contain:
- `word`
- `reading`
- `romaji`
- `meaning`
- `match.forms`
- `match.exclude`

File:
- [`source_content/all_anime_top_2000.match.first2000.json`](/home/kaiyes/projects/klasioremotion/source_content/all_anime_top_2000.match.first2000.json)

`match.forms` is used so a word can match conjugations, readings, and common compounds.

Generator:
- [`scripts/generate-word-match-forms.js`](/home/kaiyes/projects/klasioremotion/scripts/generate-word-match-forms.js)

What it does:
- scans JP subtitle corpus
- tokenizes with `kuromoji`
- collects lemma-derived forms
- adds common literal compounds
- writes updated `match.forms` back to the words JSON

Important note about the web app family dropdown:
- The “many inflections/families” shown in the curation UI are not a separate hidden dataset.
- They come from `word + match.forms` in the main word list JSON.
- That means the current family list already exists and can be used now.
- The missing piece is not family discovery, it is family ranking and promotion quality.

### 2) Subtitle matching and clip extraction

Core extractor:
- [`scripts/extract-clips.js`](/home/kaiyes/projects/klasioremotion/scripts/extract-clips.js)

What it does:
- loads one query word
- builds a matcher from canonical word + `match.forms`
- ignores phrases in `match.exclude`
- scans JP subtitle lines
- estimates where inside the line the target match occurs
- aligns the matching EN subtitle line
- applies per-episode subtitle offsets
- scores each candidate line
- dedupes by normalized sentence text

Matching behavior is intentionally conservative:
- prefers exact/base matches
- prefers compact matches over long phrase matches
- prefers boundary-safe matches
- penalizes likely shared-kanji false positives

This is the step that finds the exact Japanese word usage from the 2000-word list.

### 3) Candidate DB build

Builder:
- [`scripts/build-word-candidates-db.js`](/home/kaiyes/projects/klasioremotion/scripts/build-word-candidates-db.js)

What it does:
- runs `extract-clips.js` in dry-run mode for each word
- stores all found candidates in one JSON DB

Main DB file:
- `out/shorts/word-candidates-db.json`

Each word record typically contains:
- word metadata
- candidate count
- candidate list
- selected list
- missing/error flags

### 4) Ranking

Reranker:
- [`scripts/rerank-word-candidates-ollama.js`](/home/kaiyes/projects/klasioremotion/scripts/rerank-word-candidates-ollama.js)

What it does:
- reads the candidate DB
- pre-gates weak candidates
- optionally verifies subtitle/audio agreement with Whisper ASR
- sends shortlist candidates to the configured local LLM backend
- writes top picks per word

Main rerank file:
- `out/shorts/word-candidates-llm-top.full.json`

Important note:
- Current rerank defaults target the local `llama.cpp` server on `127.0.0.1:18080` with model alias `qwen35-4b-q4km`.
- Treat the actual output file in `out/shorts` as the current ranking truth.

### 5) Final short rendering

Renderer:
- [`scripts/make-vertical-shorts-clean.js`](/home/kaiyes/projects/klasioremotion/scripts/make-vertical-shorts-clean.js)

This is ffmpeg-based, not Remotion-based.

What it builds:
- `1080x1920` vertical short
- top word card
- reading
- romaji
- meaning
- centered anime video area
- JP subtitle styling with target highlight
- furigana
- romaji line
- EN line
- Bundai logo / QR block
- optional appended end card

Final outputs:
- `out/shorts/<word>.mp4`

## Manual Curation Layer

Even with ranking, manual correction still matters.

CLI helper:
- [`scripts/word-curate.js`](/home/kaiyes/projects/klasioremotion/scripts/word-curate.js)

UI:
- [`tools/word-curation-ui/README.md`](/home/kaiyes/projects/klasioremotion/tools/word-curation-ui/README.md)

Useful commands:

```bash
npm run -s word:show -- 悪い
npm run -s word:replace -- 悪い 2=18 "EN mismatch"
npm run -s word:pick -- 悪い 9,14,18,20,1 "manual final"
npm run -s word:board
```

The UI reads:
- `out/shorts/render-manifest.json`
- `out/shorts/word-candidates-db.json`
- `out/shorts/word-candidates-llm-top.full.json`

## Subtitle Sync Support

Supporting scripts exist because subtitle timing quality directly affects extraction quality:
- `scripts/extract-embedded-english-subs.js`
- `scripts/estimate-sub-offset.js`
- `scripts/calibrate-sub-sync.js`
- `scripts/align-episode-subs.js`
- `scripts/align-all-episode-subs.js`
- `scripts/recalibrate-english-offsets.js`

Current sync files:
- `source_content/shingeki_no_kyojin/subs/sub-offsets.json`
- `source_content/shingeki_no_kyojin/subs/sub-sync-db.json`

How sync is meant to be used:
- JP/EN subtitle sync is done once per anime, then persisted in JSON.
- The intended per-anime artifacts are:
  - `<anime>/subs/sub-offsets.json`
  - `<anime>/subs/sub-sync-db.json`
- For new anime, reuse the same scripts with explicit `--videosDir`, `--jpSubsDir`, `--enSubsDir`, `--offsetsFile`, and `--dbFile`.

## Runtime And Vision Notes

Current local `llama.cpp` situation:
- The system binary at `/usr/local/bin/llama-cli` is not the one to trust for GPU use here.
- The working Vulkan build is under:
  - `/home/kaiyes/.openclaw/vendor/llama.cpp-shallow/build-vulkan/bin/llama-cli`
  - `/home/kaiyes/.openclaw/vendor/llama.cpp-shallow/build-vulkan/bin/llama-server`
- This Vulkan build sees the local AMD GPU as:
  - `Vulkan0: AMD Radeon RX 590 Series`

OpenClaw runtime:
- OpenClaw is configured to use a local `llama.cpp` HTTP server at `http://127.0.0.1:18080/v1`.
- The currently running server process uses:
  - `llama-server`
  - `--device Vulkan0`
  - `--n-gpu-layers 99`
- Current OpenClaw default text model is:
  - `Qwen3.5 9B Q4_K_M (llama.cpp)`

Important distinction:
- `--avEval` is clip QA:
  - Whisper audio agreement
  - optional vision/OCR agreement
- Subtitle sync is separate:
  - `calibrate-sub-sync.js`
  - `align-episode-subs.js`
  - `align-all-episode-subs.js`

## Multimodal Model Notes

For `llama.cpp` vision/OCR, you need both:
- the main `GGUF` model file
- the matching `mmproj` file

Local cache state checked in this workspace:
- present:
  - `~/.cache/llama.cpp/unsloth_Qwen3.5-2B-GGUF_Qwen3.5-2B-Q4_K_M.gguf`
  - `~/.cache/llama.cpp/unsloth_Qwen3.5-2B-GGUF_mmproj-F16.gguf`
  - `~/.cache/llama.cpp/unsloth_Qwen3.5-4B-GGUF_Qwen3.5-4B-Q4_K_M.gguf`
  - `~/.cache/llama.cpp/unsloth_Qwen3.5-9B-GGUF_Qwen3.5-9B-Q4_K_M.gguf`
- missing locally:
  - `Qwen3.5 4B mmproj`
  - `Qwen3.5 9B mmproj`

Known Hugging Face `mmproj` locations:
- Qwen3.5 4B:
  - `mmproj-F16.gguf`
  - https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/blob/main/mmproj-F16.gguf
- Qwen3.5 9B:
  - `mmproj-F16.gguf`
  - https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/blob/main/mmproj-F16.gguf

Observed smoke-test result:
- The local 2B `GGUF + mmproj` pair is valid.
- `llama.cpp` loads it as `text, vision`.
- The main failure encountered was runtime/config:
  - wrong binary (`/usr/local/bin/llama-cli`) had no GPU
  - one OCR test also failed from too-small context size

Current recommendation:
- Use the Vulkan-built `llama.cpp` binaries from `.openclaw/vendor/.../build-vulkan/bin`.
- Switch text rerank to `llama.cpp`.
- For OCR/vision, use a proper multimodal pair:
  - safest next target: `Qwen3.5 4B GGUF + mmproj`
  - `9B` is possible too, but only after pulling its matching `mmproj`.

Current repo AV defaults:
- `npm run word:board:av`
- `npm run shorts:av:one`

These now target local `llama.cpp` vision with:
- `Qwen3.5 4B Q4_K_M`
- matching `mmproj`
- Vulkan device `Vulkan0`

## What To Trust Right Now

Best current operational docs:
- [`WORD_PIPELINE_COMMANDS.md`](/home/kaiyes/projects/klasioremotion/WORD_PIPELINE_COMMANDS.md)
- [`RERANKING.md`](/home/kaiyes/projects/klasioremotion/RERANKING.md)
- [`docs/README.md`](/home/kaiyes/projects/klasioremotion/docs/README.md)

Best current code truth:
- [`scripts/word-pipeline.js`](/home/kaiyes/projects/klasioremotion/scripts/word-pipeline.js)
- [`scripts/extract-clips.js`](/home/kaiyes/projects/klasioremotion/scripts/extract-clips.js)
- [`scripts/rerank-word-candidates-ollama.js`](/home/kaiyes/projects/klasioremotion/scripts/rerank-word-candidates-ollama.js)
- [`scripts/make-vertical-shorts-clean.js`](/home/kaiyes/projects/klasioremotion/scripts/make-vertical-shorts-clean.js)

## Recommendation On Old Markdown Files

Do not delete the older markdown files yet.

Better policy:
- keep historical runbooks in `docs/archive`
- treat this file as the current overview
- keep only active operational docs at repo root

Good candidates to keep as working docs:
- `ANIME_WORD_PIPELINE.md`
- `WORD_PIPELINE_COMMANDS.md`
- `RERANKING.md`

Good candidates to archive later if they stop being useful:
- `docs/archive/AUTO_SHORT_THREAD_HANDOFF.md`
- older summary/handoff notes that describe superseded states
