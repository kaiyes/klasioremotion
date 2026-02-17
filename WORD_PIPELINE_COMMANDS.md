# Word Pipeline Commands

Primary output roots:
- `out/shorts`

## Stable Mode (Current)

Use this mode while publishing. Do not touch rerank.

```bash
npm run -s word:board
```

- Keep ranking files frozen:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`
- Do not run full rerank in this phase.
- If needed, restore active from backup:

```bash
cp out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json
```

## Stage 1 ASR (Sidecar Only, Safe)

This does not change ranking/render files. It writes:
- `out/shorts/word-candidates-asr-stage1.json`

One word:

```bash
npm run -s asr:stage1:one -- 高い
```

Range:

```bash
npm run -s asr:stage1:range -- 70-80
```

All (resume):

```bash
npm run -s asr:stage1
```

## One Word

Pass only the word:

```bash
npm run -s wp:one:fast -- 悪い
```

## Word-By-Word Fix (No Flag Soup)

Render one word (5 clips in one short):

```bash
npm run -s word:render -- 悪い
```

Show current picks + top candidates:

```bash
npm run -s word:show -- 悪い
```

Replace one slot and re-render that word:

```bash
npm run -s word:replace -- 悪い 2=18 "EN mismatch"
```

Set exact picks and re-render that word:

```bash
npm run -s word:pick -- 悪い 9,14,18,20,1 "manual final"
```

Replacement log file:
- `out/shorts/curation-log.jsonl`

## Staged Rollout (Fast)

First 10 words:

```bash
npm run -s wp:rank:10:fast
npm run -s wp:render:10:fast
```

First 100 words:

```bash
npm run -s wp:rank:100:fast
npm run -s wp:render:100:fast
```

## Staged Rollout (Whisper)

First 10 words:

```bash
npm run -s wp:rank:10:whisper
npm run -s wp:render:10:whisper
```

## Custom Range (example `20-30`)

Fast:

```bash
npm run -s wp:rank:fast -- 20-30
npm run -s wp:render:fast -- 20-30
```

Whisper:

```bash
npm run -s wp:rank:whisper -- 20-30
npm run -s wp:render:whisper -- 20-30
```
