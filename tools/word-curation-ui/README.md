# Word Curation UI

No file upload flow. It auto-loads from:
- `out/shorts/render-manifest.json`
- `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
- `out/shorts/word-candidates-db.json`
- `out/shorts/curation-log.jsonl` (if present)

## Run

From repo root:

```bash
npm run -s word:board
```

Open:
- http://localhost:8790

## Workflow

1. Select one or many words from left list.
2. `Render Selected` to generate shorts for selected words.
3. Open a word.
4. Assign candidate clips into slots `S1..S5`.
5. Add reason.
6. `Apply Picks + Stitch` (or `Apply Single Replace`).

## Notes

- This UI runs local commands through API jobs:
  - `word:render`
  - `word:pick`
  - `word:replace`
- Job output appears in `Job Console`.
- It serves local `out/*` mp4 files for preview.
