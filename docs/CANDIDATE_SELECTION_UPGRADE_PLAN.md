# Candidate Selection Upgrade Plan

## Goal

Improve anime word short quality by fixing the first failure mode:
- the target word is cut off
- the target word is not clearly audible in the clip
- the candidate pool contains weak examples, so reranking cannot recover quality

## Root Cause

The main failure is upstream of reranking.

The current system still allows very short subtitle-span clips into the candidate DB. Once those micro-clips enter the pool, reranking is choosing among already-bad options.

## Phase 1: Fix Candidate Construction

Files:
- `scripts/build-word-candidates-db.js`
- `scripts/extract-clips.js`

Changes:
- build DB candidates with real speech context instead of zero-pad word fragments
- prefer ranked and deduped pool output over raw scan order
- penalize or reject clips that are too short or cut at the head or tail
- move matcher behavior from loose substring hits to token-aware modes:
  - `exact`
  - `lemma`
  - `family`

## Phase 2: Strengthen Deterministic Gates

Files:
- `scripts/extract-clips.js`
- `scripts/asr-stage1-transcribe.js`
- `scripts/eval-clip-av.js`

Changes:
- use subtitle/audio agreement as a signal
- add a simple “target is actually present in audio” gate for top candidates
- demote subtitle-only false positives

## Phase 3: Refresh Rerank

Files:
- `scripts/rerank-word-candidates-ollama.js`
- `scripts/auto-curate-word-shorts.js`
- `scripts/word-pipeline.js`

Changes:
- switch to the next rerank backend cleanly
- use the LLM as a tie-break over already-good candidates
- keep rerank in small windows and validate in UI

## Validation

Regression examples:
- `out/testEval/249_未来.mp4`
- problem cases in `out/shorts/rerender/`

Execution order:
1. rebuild and rerender `未来`
2. inspect the first clip specifically
3. rerender the backlog set
4. use the UI only for remaining edge cases
