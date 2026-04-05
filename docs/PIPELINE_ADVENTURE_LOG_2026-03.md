# Pipeline Adventure Log (March 2026)

This is a deep operational log of what was tried, what worked, what failed, and what was changed while upgrading the anime family/inflection short pipeline.

Use this file as a continuity handoff before starting new threads.

## Scope

- Repo: `klasioremotion`
- Pipeline focus: Node.js + ffmpeg anime word/family shorts
- Main corpus:
  - Active production anime clips: `source_content/shingeki_no_kyojin`
  - Large subtitle mining corpus: `~/projects/kitsunekko-mirror/subtitles/anime_tv`

## Why This Work Started

Primary pain points:

- Word gets cut off in clip window.
- Word appears in subtitle but is not actually spoken in audio.
- Wrong family capture (example: `光` pulling `光線`).
- Too much manual cleanup after ranking.
- Command surface got too fragmented.

Goal:

- Improve candidate quality first.
- Make family-based generation usable (`見る -> 見ろ / 見よう / 見える / みたい` style).
- Cache heavy audio checks so rendering is fast.

## Architecture Clarification (Critical)

This repo now carries one active production path:

- Anime shorts system (Node + ffmpeg)

This log is about that pipeline.

## Major Decisions

### 1) Keep the production path focused on Node + ffmpeg

Reason:

- Reduce maintenance surface.
- Keep engineering attention on the shipping pipeline.

### 2) Candidate quality beats model size

Decision:

- Prioritize extraction/gating fixes over bigger reranker model.
- Move from 9B rerank default to 4B for throughput/stability.

### 3) Family isolation is required

Decision:

- Do not mix family forms in one short.
- Render separate shorts per promoted family target.

Example:

- `光` short should not silently become `光線` short.

### 4) Audio-first QA for production

Decision:

- Keep vision/OCR for selective QA/debug.
- Use audio-only AV as primary production gate.

Reason:

- Vision path is much slower.
- Main correctness issue was "spoken/not spoken", not frame OCR.

### 5) Per-anime isolation for reusable sync/cache

Decision:

- Keep sync files and cache files per anime.

Artifacts:

- `sub-offsets.json`
- `sub-sync-db.json`
- family cache dir per anime when needed

## What Was Fixed

### A) Word matcher hard failures

Issue:

- Kanji targets were matching bare kana readings (`魔 -> ま`, `天 -> てん`).

Fix:

- Disabled bare reading matches for kanji targets by default.
- Kept explicit opt-in behavior via matcher settings.

Impact:

- Removed obvious false positives for single-kanji entries.

### B) Family target handling

Issue:

- Family runner initially mixed noisy targets and stopped on single-target failures.

Fixes:

- Added stricter family promotion filters:
  - cross-kanji ban
  - bare-kana ban for kanji lemmas
- Added target lanes:
  - `base`
  - `inflection`
  - `related`
  - `derived`
  - `expression`
- Changed behavior to skip failed targets instead of aborting whole word.

Impact:

- Family runs became robust enough for overnight batches.

### C) Cache-driven family flow

Issue:

- Re-running AV checks every render is too slow.

Fixes:

- Added family cache modes:
  - `--cacheOnly`
  - `--useCache`
- Added all-word cache runner:
  - `scripts/cache-family-audio-all.py`
- Added shard execution pattern (range-based parallel workers).

Impact:

- Large volumes became resumable and practical.

### D) Whisper backend mismatch

Issue:

- AV path treated `whisper` like Python Whisper while runtime was `whisper.cpp`.

Fixes:

- Rewired AV ASR path for `whisper.cpp` invocation.
- Switched defaults to local user build (`~/projects/whisper.cpp`).

Impact:

- AV became stable and predictable on this machine.

### E) One-target cached rerender UX

Issue:

- User needed one family target override (meaning/reading/romaji) without re-running AV.

Fix:

- Added `scripts/render-family-cache-one.js`
- Added npm alias: `family:render:one`

Impact:

- Single-target fast rerender now easy.

### F) YouTube metadata for family outputs

Issue:

- Metadata generator only resolved exact top-2000 words.
- Family targets in `out/uploadToYoutube` were skipped or had missing meaning.

Fixes:

- Updated `out/uploadToYoutube/generate-youtube-metadata.js` lookup order:
  1. top-2000 words
  2. `source_content/family-meanings.json`
  3. JMdict simplified
  4. family cache base-target index fallback

Impact:

- Family videos resolve meaning/metadata much more reliably.

## What Did Not Work (or Was Too Costly)

### 1) Live vision checks for all renders

- Too slow for normal production.
- Better used for selective QA.

### 2) Single-worker all-2000 cache run

- Progressed, but too slow.
- Sharding into non-overlapping ranges is necessary.

### 3) Long ad-hoc command chains

- Frequent shell breakage from wrapped lines.
- Led to false "it failed" and misapplied flags.

Resolution:

- Introduce wrapper scripts and short aliases.

## Throughput Lessons

On this machine profile:

- 2 parallel shard workers are reasonable.
- 4 workers tends to overload CPU and reduce usability.
- Audio cache pass is CPU-heavy even with Vulkan support available.

## Corpus and Linguistics Layer

### What is currently used

- Lemma/form mining: `fugashi + unidic-lite` scripts in `scripts/build-lemma-forms.py` and `scripts/build-expression-candidates.py`.
- Family promotion uses mined stats + dictionary signals.

### Current stance

- Do not rerun heavy corpus pass immediately unless needed.
- Improve promotion/glossing on top of existing data first.

## Dictionary Strategy (Current)

For conjugation/inflection meanings:

- Treat 2000-word list as curriculum anchor only.
- Prefer richer dictionary source when available.
- `JMdict_english_with_examples` is now treated as primary for the conjugation-meaning generator.
- Top-2000 list is fallback, not primary authority.

## Operational Commands (Shortlist)

### Family audio cache (all words)

- AOT:
  - `npm run -s family:audio:all -- --start 1 --count 500 --top 6`
- OPM:
  - `npm run -s family:audio:all:opm -- --start 1 --count 500 --top 6`

### Family render from cache

- One full family:
  - `npm run -s family:shorts -- --word 見る --top 8 --clips 5 --useCache --outputDir out/shorts --outDir out/shorts_work`
- One target only (override meaning/reading/romaji):
  - `npm run -s family:render:one -- --base 思う --target 思っ --reading おもった --romaji omotta --meaning thought`

### YouTube metadata

- `cd out/uploadToYoutube && node generate-youtube-metadata.js --outFile youtube-metadata.json`

## Known Gaps Still Open

1. Conjugation gloss quality is improved but not perfect.
- Needs dedicated rule+context pass for tense/aspect nuance.

2. Expression promotion is still conservative.
- Better expression ranking/curation can be added next.

3. Command surface is improved but still dense.
- Future pass should unify around 3 to 4 canonical entrypoints.

## Recommended Next Iteration

1. Build a "conjugation-gloss lock" file per target.
- Prevent drift and keep card text deterministic.

2. Add expression-focused family renderer.
- `--expressionOnly` mode with strict no-mix policy.

3. Add quick health command.
- One command to report:
  - active runs
  - done markers
  - cache counts
  - failed target count

4. Add metadata QA checker.
- Validate title/description fields before upload.
