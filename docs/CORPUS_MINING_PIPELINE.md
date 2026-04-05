# Corpus Mining Pipeline

This is the new large-corpus mining layer for inflections, related lemmas, and recurring expressions.

## Source Corpus

- Primary source: `~/projects/kitsunekko-mirror/subtitles/anime_tv`
- This is the large mirror corpus, not the smaller direct Kitsunekko scrape.

## Runtime

- Local venv: `.venv-corpus`
- Core analyzer: `fugashi + unidic-lite`

## Scripts

- `scripts/build-lemma-forms.py`
  - Resumable lemma/form mining pass
  - Tracks:
    - lemma counts
    - surface-form counts
    - reading
    - conjugation type/form
    - per-anime spread
  - Outputs:
    - `out/corpus/lemma_forms.sqlite`
    - `out/corpus/lemma_forms.json`

- `scripts/build-expression-candidates.py`
  - Resumable recurring-expression mining pass
  - Mines short token chunks ending in real predicate forms
  - Tracks:
    - surface string
    - lemma sequence
    - reading sequence
    - POS sequence
    - count
    - per-anime spread
    - sample line
  - Outputs:
    - `out/corpus/expression_candidates.sqlite`
    - `out/corpus/expression_candidates.json`

- `scripts/promote-learning-targets.py`
  - Promotion pass for actual teaching targets
  - Inputs:
    - lemma DB
    - expression DB
    - current `source_content/all_anime_top_2000.match.first2000.json`
    - `jmdict-simplified-flat-full.json`
  - Produces three target types:
    - `base` / `inflection`
    - `relatedLemma`
    - `expression`
  - Output:
    - `out/corpus/promoted_targets.json`

- `scripts/run-corpus-mining.sh`
  - Runs the three passes sequentially

## Package Commands

- `npm run corpus:lemma`
- `npm run corpus:expressions`
- `npm run corpus:promote`

## Current Background Run

- Log file:
  - `out/corpus/logs/run-corpus-mining.log`

## Notes

- This is separate from `word-pipeline.js rank`, which only ranks current short candidates for the active anime set.
- This pass is for:
  - real surface-form frequency
  - related lemma discovery
  - recurring expressions
  - promotion into teachable targets
