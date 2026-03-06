# Klasio Remotion

This repo currently operates as a Node.js + ffmpeg anime vocab short pipeline.

Remotion is still kept in the repo for the talking-head auto-short system, but it is not the main production path right now.

## Start Here

Current at-a-glance overview:
- [`ANIME_WORD_PIPELINE.md`](/home/kaiyes/projects/klasioremotion/ANIME_WORD_PIPELINE.md)

Docs index:
- [`docs/README.md`](/home/kaiyes/projects/klasioremotion/docs/README.md)

Operational command reference:
- [`WORD_PIPELINE_COMMANDS.md`](/home/kaiyes/projects/klasioremotion/WORD_PIPELINE_COMMANDS.md)

Rerank rules and recovery:
- [`RERANKING.md`](/home/kaiyes/projects/klasioremotion/RERANKING.md)

## Current Production Flow

Active dataset:
- `source_content/shingeki_no_kyojin/videos`
- `source_content/shingeki_no_kyojin/subs/japanese`
- `source_content/shingeki_no_kyojin/subs/english_embedded`
- `source_content/all_anime_top_2000.match.first2000.json`

Primary pipeline wrapper:
- `scripts/word-pipeline.js`

Typical commands:

```bash
npm run -s wp:one:fast -- 悪い
npm run -s wp:rank:10:fast
npm run -s wp:render:10:fast
npm run -s word:board
```

What the pipeline does:
1. Match words from the 2000-word list against JP subtitles.
2. Build per-word candidate clips with EN subtitle alignment.
3. Rank the best candidates with heuristics + Ollama.
4. Render `1080x1920` learning shorts with ffmpeg.

## Main Scripts

- `scripts/generate-word-match-forms.js`
- `scripts/extract-clips.js`
- `scripts/build-word-candidates-db.js`
- `scripts/rerank-word-candidates-ollama.js`
- `scripts/word-pipeline.js`
- `scripts/make-vertical-shorts-clean.js`
- `scripts/word-curate.js`

## Remotion Status

Remotion is intentionally still present for the separate auto-short workflow.

Relevant files:
- `src/Root.tsx`
- `src/auto-short/*`
- `scripts/generate-auto-short-plan.js`

That path is secondary for now. The anime word pipeline above is the current focus.
