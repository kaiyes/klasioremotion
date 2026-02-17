# Summary Of Work

Last updated: `2026-02-17`

## Stable Lock (2026-02-17)
- Locked commit on local + remote:
  - `363e17cf30183e0f4f86cae4be186fb1a95404ac` (`main`, `origin/main`)
- Active rerank file (production):
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
- Backup rerank file (synced from active, same checksum):
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`
- Active candidate DB:
  - `out/shorts/word-candidates-db.json`

### Freeze Policy (Do Not Break)
- Keep this state while uploading current shorts batch.
- Do not run full-list rerank during production.
- If rerank experiments are needed, do them in small windows only and validate manually.
- If quality regresses, restore backup immediately:

```bash
cp out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json
```

### Verified Outputs In This Stable State
- `out/shorts/高い.mp4`
- `out/shorts/ちゃん.mp4`
- `out/shorts/出す.mp4`
- `out/shorts/家.mp4`
- `out/shorts/生きる.mp4`
- `out/shorts/見える.mp4`
- `out/shorts/頼む.mp4`
- `out/shorts/顔.mp4`

## Reranking Status (2026-02-16)
- Canonical rerank file used by pipeline/UI:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
- Backup rerank file to keep:
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`
- Candidate DB:
  - `out/shorts/word-candidates-db.json`

### What happened
- A partial rerank run from index `60` changed many picks in the active range.
- Diff vs backup:
  - `statusChanged=100`
  - `topChanged=166`
  - `top1Changed=154`
  - most transitions were `ok -> fallback` in range `60-300`.
- Render batch `60-300` still produced usable output for many words (`204/241` rendered in manifest).

### Current policy (locked)
- Do not run full-list rerank blindly.
- Rerank in small windows only (`10` words).
- Validate results in UI before scaling to next window.
- Keep exactly one active rerank file + one backup copy.

### Practical source of truth
- For render behavior and chosen picks, trust:
  - `out/shorts/render-manifest.json`
- For ranking inputs, trust:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`

## Resume IDs
- `snk-furigana-center-romaji-fix-2026-02-06`
- `snk-vertical-clean-shorts-highlight-card-logo-2026-02-06`
- `snk-aot-pipeline-handoff-2026-02-08`

## Current Snapshot
- Video files: `89`
- JP subtitle files: `89`
- EN subtitle files (embedded extract): `89`
- Canonical dataset root:
  - `source_content/shingeki_no_kyojin/videos`
  - `source_content/shingeki_no_kyojin/subs/japanese`
  - `source_content/shingeki_no_kyojin/subs/english_embedded`
- Active sync outputs:
  - `source_content/shingeki_no_kyojin/subs/sub-offsets.json`
  - `source_content/shingeki_no_kyojin/subs/sub-sync-db.json`
- Word candidate DB:
  - `source_content/shingeki_no_kyojin/subs/word-candidates-db.json`
- LLM rerank output:
  - `source_content/shingeki_no_kyojin/subs/word-candidates-llm-top.json`
- Match-form output (active full file):
  - `source_content/all_anime_top_2000.match.first2000.json`
- Active default word list across pipeline commands/scripts:
  - `source_content/all_anime_top_2000.match.first2000.json`

## What Is Implemented

### 1) Core Extractor (`scripts/extract-clips.js`)
- JP query matching from ASS/SRT.
- `match.forms` / `match.exclude` support from `--wordList` entries.
  - Query can now match conjugations/variants without creating separate objects.
  - Compact-form preference avoids selecting long phrase fragments as the primary match.
- EN alignment from sibling EN subs.
- Per-episode/per-season offset application from `sub-offsets.json`.
- Candidate scoring (`--rank`) and dedupe by normalized sentence text.
- Manual candidate control:
  - `--printTop`
  - `--pick`
  - `--replace` (`3=12`, `last=15`)
- Shuffle support:
  - `--shuffle`
  - `--shuffleSeed`
  - `--shuffleTop`
- Candidate export:
  - `--candidatesOut` writes `planned`, `pool`, `selected`.
- Subtitle text sanitizer now strips ASS/HTML styling debris from embedded EN (prevents rendering garbage like `size="78"><i><b>`).
- Romaji continuation join fix (avoids splits like `arumi n`).
- Highlight rendering guard:
  - visual highlight now prioritizes the learning target (`--matchContains` or `--query`) instead of long matched phrase text.
  - prevents accidental full-line highlight when `match.forms` includes long compounds.

### 2) Vertical Shorts (`scripts/make-vertical-shorts-clean.js`)
- Clean `1080x1920` output with:
  - top word card
  - centered 16:9 video strip
  - subtitle block below video
  - Bundai logo + QR corner block
- Family meaning memory:
  - if run with `--family ... --meaning ...`, the meaning is saved to `source_content/family-meanings.json`
  - next runs reuse saved family meaning automatically (no repeat `--meaning` needed)
  - family mode no longer falls back to root-word meaning (prevents wrong cards like `お前ら -> before`)
- Forwards candidate control flags to extractor:
  - `--printTop`, `--pick`, `--replace`
  - `--shuffle`, `--shuffleSeed`, `--shuffleTop`
- Tail append:
  - appends `source_content/card.mp4`
  - repeats controlled by `--tailRepeat` (default `3`)
- Output clean on rerun (default):
  - `out/clips`
  - `out/shorts_work`
  - `out/shorts`
  - disable with `--keepOutputs`
- Added `--help` / `-h` usage output for `vertical-shorts-clean`.
- Same `--help` / `-h` support added to `scripts/make-vertical-shorts.js`.

### 3) Embedded EN Extraction
Script: `scripts/extract-embedded-english-subs.js`
- Extracts best embedded English subtitle stream per episode.
- Writes canonical EN files to:
  - `source_content/shingeki_no_kyojin/subs/english_embedded/sXeY.srt`

### 4) Sync Tooling
- `scripts/sync-word-check.js`
- `scripts/estimate-sub-offset.js`
- `scripts/calibrate-sub-sync.js`
- `scripts/align-episode-subs.js`
- `scripts/align-all-episode-subs.js`
- `scripts/recalibrate-english-offsets.js`

Notes:
- Defaults were updated to prefer `english_embedded` over legacy `english` in sync-related scripts.
- `align-episode-subs` supports midpoint check clips via `--checkAt middle`.

### 5) Word Candidate Database
Script: `scripts/build-word-candidates-db.js`
- Runs extractor in `--dryRun` mode for each word from `source_content/all_anime_top_2000.match.first2000.json`.
- Passes `--wordList` into extractor so `match.forms` is respected during DB build.
- Stores candidates (including `jpText`, `enText`, episode/time, score) in one JSON:
  - `source_content/shingeki_no_kyojin/subs/word-candidates-db.json`
- Supports:
  - `--count` (first N words)
  - `--mode line|sentence`
  - `--maxPerWord`

Important:
- Current implementation is serial and writes final DB at end (not checkpoint-resumable mid-run yet).

### 6) Ollama Rerank Pipeline
Script: `scripts/rerank-word-candidates-ollama.js`
- Reads `word-candidates-db.json`.
- Ranks top examples per word for beginner usefulness.
- Writes output after each processed word using atomic writes (resumable).
- Supports:
  - `--resume`, `--force`
  - `--count`, `--fromIndex`
  - `--topK`, `--maxCandidates`
  - `--model`, `--host`, `--timeoutSec`, `--retries`
  - `--requireMeaningful` (default on) to reject trivial rankings
- Ollama call fallback chain:
  1. `/api/chat`
  2. `/api/generate`
  3. `ollama run` CLI fallback

### 7) Match-Form Generator
Script: `scripts/generate-word-match-forms.js`
- Builds `match.forms` using JP subtitle corpus + kuromoji tokenization.
- Captures:
  - lemma/conjugation variants (e.g. `知る` -> `知っ`, `知ら`, `知り`)
  - common literal compounds (e.g. `前` -> `お前`, `目の前`, `前に`, `名前`)
- Writes an updated words JSON; active output:
  - `source_content/all_anime_top_2000.match.first2000.json`
- Incremental generation completed from 100 -> 2000 in +100 steps and validated.

### 8) Fully-Automated Word Curation Pipeline (Current Default)
Scripts:
- `scripts/word-pipeline.js` (high-level entry point)
- `scripts/auto-curate-word-shorts.js` (orchestration)
- `scripts/rerank-word-candidates-ollama.js` (LLM ranking + gates)

What is now preferred:
- Use short `npm` aliases (`wp:*`) for word/range/all workflows.
- Keep outputs under:
  - `out/new-pipeline/fast`
  - `out/new-pipeline/whisper`
- Use `WORD_PIPELINE_COMMANDS.md` as the command source of truth.

## NPM Commands Added / Updated
- `extract-embedded-english-subs`
- `generate-word-match-forms`
- `generate-word-match-forms:aot`
- `extract-family-clips`
- `extract-family-clips:aot`
- `family-list`
- `family-list:aot`
- `build-word-candidates-db`
- `build-word-candidates-db:aot`
- `rerank-word-candidates:ollama`
- `rerank-word-candidates:ollama:aot`
- `auto-curate-word-shorts`
- `auto-curate-word-shorts:aot`
- `word-pipeline`
- `wp:one:fast`
- `wp:rank:10:fast`
- `wp:render:10:fast`
- `wp:rank:100:fast`
- `wp:render:100:fast`
- `wp:rank:10:whisper`
- `wp:render:10:whisper`
- `wp:rank:fast`
- `wp:render:fast`
- `wp:rank:whisper`
- `wp:render:whisper`
- `extract-clips:aot` (uses `english_embedded`)
- `shorts-clean:aot` (uses `english_embedded`)
- `vertical-shorts` / `vertical-shorts-clean` now support `--help`

## Command Cheat Sheet

### Extract embedded EN for all episodes
```bash
npm run -s extract-embedded-english-subs -- --overwrite
```

### Build candidate DB for first 100 words, line mode, up to 50 candidates each
```bash
npm run -s build-word-candidates-db:aot -- --count 100 --mode line --maxPerWord 50
```

### Refresh `match.forms` for full 2000 list
```bash
npm run -s generate-word-match-forms:aot
```

### List families for a root word (fast, no rendering)
```bash
npm run -s family-list:aot -- --query 前
```

### Render family-mode clips/short
```bash
npm run -s extract-family-clips:aot -- --query 前 --family お前ら --limit 5
```

### Word pipeline commands (current)
See: `WORD_PIPELINE_COMMANDS.md`

Quick starters:
```bash
npm run -s wp:one:fast -- 悪い
npm run -s wp:rank:10:fast
npm run -s wp:render:10:fast
npm run -s wp:rank:fast -- 20-30
npm run -s wp:render:fast -- 20-30
```

### Generate one clean short
```bash
npm run -s shorts-clean:aot -- --query 言う --limit 7
```

### Show all flags for main render commands
```bash
npm run -s vertical-shorts-clean -- --help
npm run -s vertical-shorts -- --help
npm run -s extract-clips -- --help
npm run -s extract-family-clips -- --help
```

### Generate with shuffle (seeded)
```bash
npm run -s shorts-clean:aot -- --query 言う --limit 7 --shuffle --shuffleSeed 42 --shuffleTop 30
```

### Manual candidate override
```bash
npm run -s shorts-clean:aot -- --query 今 --limit 7 --printTop 25
npm run -s shorts-clean:aot -- --query 今 --limit 7 --pick 1,2,12,4,5,6,7
npm run -s shorts-clean:aot -- --query 今 --limit 7 --replace 3=9 --replace last=12
```

### Midpoint one-minute sync check clip
```bash
npm run -s align-episode-subs -- --episode s4e30 --enSubsDir source_content/shingeki_no_kyojin/subs/english_embedded --checkDurationSec 60 --checkAt middle --checkOut dissfiles/sub-sync/checks/s4e30_check.mp4
```

## Known Gaps / Risks
- `build-word-candidates-db.js` is still heavy/serial for very large runs (`2000` words can take long).
- EN mapping can still bleed across neighboring cues in some cases (strict one-JP-to-one-EN mapping not yet default).
- Auto-generated `match.forms` can still contain some noisy short phrase fragments; file is intended to be editable and can be refined incrementally.
- LLM rerank quality depends on model output discipline; script now rejects weak/trivial JSON by default and falls back to heuristic when needed.

## Next Phase Plan (Agreed)
1. Strict JP->EN mapping as default in `scripts/extract-clips.js`.
- One JP cue maps to exactly one EN cue.
- No EN concatenation.
- Use overlap + midpoint distance gates.
- If no valid EN cue, output blank EN (or later fallback translation from exact JP line only).

2. Replace score-first selection with quality gates.
- Reject candidates that start/end mid-utterance using speech-boundary checks from audio.
- Reject candidates with query too close to clip edges.
- Only pass candidates meeting completeness checks.

3. Add autonomous evaluator loop with persistence.
- Post-render checks:
  - JP shown fully
  - EN corresponds to displayed JP
  - highlight coverage correct
- Save results to a clip-quality DB and automatically retry better candidates.

4. Simplify user workflow.
- Keep one default generation path/command.
- Move complexity into internal pipeline logic.
- Reduce optional flags in everyday use.

## Repo Direction
- Current pipeline is mainly subtitle/audio/ffmpeg orchestration with optional Remotion overlays.
- Recommended next step: split this pipeline into a dedicated repo (or dedicated package folder) so it does not conflict with other workflows in this repo.

## Git / Asset Notes
- `.gitignore` currently ignores:
  - `out`, `clips`, `dissfiles`
  - all video media extensions globally
  - all `source_content/*` except `source_content/logo.png`
- `source_content/card.mp4` is not whitelisted in `.gitignore` right now.

## Related Docs
- `RERANKING.md`
- `AUTO_SHORT_THREAD_HANDOFF.md`
- `README.md`
