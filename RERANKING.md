# Reranking Runbook And Incident Log

Last updated: `2026-02-17`
Timezone reference used in this doc: `UTC+06:00`

## Purpose
This file is the single source of truth for reranking behavior in the word shorts pipeline.

It exists so future agents can quickly answer:
- which file is currently active for ranking
- what changed and why quality regressed or improved
- how to run reranking safely without damaging current output quality
- how to recover immediately if a rerank run goes bad

## Production Freeze (2026-02-17)
- Keep current production behavior stable while publishing:
  - deterministic clip-fit + readability gates
  - manual slot curation from UI when needed
- Do not run full-list rerank during active publishing windows.
- Keep only two ranking truth files:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json` (active)
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json` (backup)
- Backup was re-synced from active on `2026-02-17` and verified by checksum.
- If any ranking experiment degrades quality, restore backup immediately.

## Current State Snapshot (as of 2026-02-17)

### Active files
- Active rerank file:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
- Backup rerank file:
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`
- Candidate DB:
  - `out/shorts/word-candidates-db.json`
- Last render manifest:
  - `out/shorts/render-manifest.json`

### Active rerank file stats
- `words=2000`
- `ok=11`
- `fallback=0`
- `skip=537`
- `error=1452`
- `meta.model=qwen2.5:3b`
- `meta.updatedAt=2026-02-17T14:49:05.857Z`

### Backup rerank file stats
- `words=2000`
- `ok=11`
- `fallback=0`
- `skip=537`
- `error=1452`
- `meta.updatedAt=2026-02-17T14:49:05.857Z`

### Diff summary (active vs backup)
- `statusChanged=0`
- `topChanged=0`
- `top1Changed=0`

Interpretation:
- Active and backup are intentionally identical in the freeze state.
- Rerank output is retained as metadata, while production quality relies primarily on deterministic gates + manual curation.

## How Ranking Is Consumed By Rendering

### Relevant scripts
- Reranker:
  - `scripts/rerank-word-candidates-ollama.js`
- High-level pipeline:
  - `scripts/word-pipeline.js`
- Renderer used for shorts:
  - `scripts/make-vertical-shorts-clean.js`

### Selection rules in `word-pipeline.js` render path
- It loads rerank file from:
  1. `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
  2. fallback `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json` only if primary is missing
- For each word, picks are built from `rec.top` using `candidateIndex`
- `topK` default is `5`
- By default, render requires `status=ok`
- `status=fallback` only renders when `--allowFallbackRender` is passed

### Clip constraints used in fast render path
Current fast render command path applies strict extraction constraints:
- `--prePadMs 0`
- `--postPadMs 0`
- `--maxClipMs 2000`
- `--longPolicy skip`

This can produce very short clips if candidate quality is poor.

## Incident Timeline (Rerank Fork)

### 2026-02-15 to 2026-02-16
- A long-running rerank from index `60` was started in a detached session.
- Command chain used:
  - `npm run -s rank:new-fast -- --fromIndex 60 --count 0 --resume --force --allowFallback --printEvery 1`
  - internally called `scripts/rerank-word-candidates-ollama.js` with `qwen2.5:3b`
- Run was interrupted and did not complete successfully in the overnight chain (`rc=1` observed in rerank log segment).
- Partial progress still wrote to the active rerank JSON (atomic per-word writes).
- Resulting partial rewrite changed top picks and statuses for many words in the active region.

### Render outcomes despite rerank instability
- Render range `60-300` produced a high number of usable outputs.
- `out/shorts/render-manifest.json` reported:
  - `targetWords=241`
  - `attempted=241`
  - `rendered=204`
  - `skipped=23`
  - `failed=14`
- User feedback: majority of generated shorts in this run were acceptable.

## Why Quality Can Look Inconsistent

### Root causes seen so far
- Rerank model can overvalue short but semantically weak lines.
- Sense ambiguity remains hard for polysemous/shared-kanji families.
- Strict clip constraints can force clipped utterances when candidates are already borderline.
- `fallback` inflation reduces auto-render coverage if `allowFallbackRender=false`.
- Rerank summaries in JSON can be misleading if `summary` object was inherited from partial/single-word run history while `words[]` contains full data.

### Important note on metadata
The backup file currently has:
- `summary.totalTargetWords=1`
but
- `words.length=2000`

This means downstream agents must trust `words[]` and per-word status over summary counters for historical files.

## Safe Operating Policy (Locked)

### Hard rules
- Do not run full 2000 rerank blindly.
- Run rerank in windows of `10` words.
- Validate each window in UI before continuing.
- Keep one active file and one backup file only.
- Never overwrite backup during experiments.

### Recovery-first workflow
1. Save current active before any test run.
2. Run small window rerank.
3. Compare active vs backup diff for that window.
4. If quality drops, restore backup immediately.

## Canonical Commands

### Inspect current rerank distribution quickly
```bash
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json","utf8"));const a=j.words||[];let ok=0,fb=0,sk=0,er=0;for(const w of a){const s=String(w.status||"");if(s==="ok")ok++;else if(s==="fallback")fb++;else if(s==="skip")sk++;else if(s==="error")er++;}console.log({words:a.length,ok,fb,sk,er,updatedAt:j?.meta?.updatedAt,model:j?.meta?.model});'
```

### Run rerank in a 10-word window
```bash
npm run -s rank:new-fast -- --fromIndex 60 --count 10 --resume --force --allowFallback --printEvery 1
```

### Restore backup to active immediately
```bash
cp out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json
```

### Render range using active rerank
```bash
npm run -s wp:render:fast -- 60-300
```

## Validation Checklist After Each 10-Word Rerank

Use this checklist for each tested window:
- Top pick uses correct sense and intended lemma/form.
- JP line is complete enough for learning context.
- EN line aligns to the same utterance and is not trailing-leading soup.
- Clip duration is not effectively unusable (too short for comprehension).
- No sudden jump in `ok -> fallback` transitions in tested range.
- At least 70-80 percent of rendered words are usable without manual surgery.

If any two checks fail for multiple words in the window, rollback.

## What Not To Do
- Do not delete rerank files during long runs.
- Do not run two rerank writers against the same active file at the same time.
- Do not trust only `summary` counters in historical rerank files.
- Do not run whisper/asr-enhanced rerank across all 2000 until smoke tests pass repeatedly.

## Suggested Next Improvements (When Resuming Rerank Engineering)

### 1) Deterministic pre-gates before LLM scoring
- lemma/sense lock must be strict
- fragment rejection must be strict
- breath check should reject ultra-short context lines

### 2) LLM tie-break only
- Keep heuristic candidate ordering.
- Send only top-N shortlist to LLM.
- Preserve deterministic fallback if LLM output is weak.

### 3) Stronger run isolation
- Write test rerank output to temp file first.
- Compare against active.
- Promote only if quality threshold passes.

### 4) Better telemetry
- Log per-word gate reasons.
- Log old top1 vs new top1 for reranked window.
- Log status transition counts by window.

## Machine Notes For Future Agents

When user asks "is rerank good now?", do this before answering:
1. Compare active vs backup status and top1 deltas.
2. Read last render manifest summary and recent output examples.
3. Report concrete counts, not opinions.
4. Recommend next action as either:
   - continue 10-word rerank
   - rollback and render
   - freeze rerank and do manual curation only

When user asks "who generated these videos?", check:
- `pgrep -fl 'word-pipeline.js render|wp:render:fast'`
- `ps -o pid,ppid,user,lstart,etime,command -p <pid>`
- `out/shorts/work/*.log` and `out/shorts/render-manifest.json`

## Minimal Ground Truth Files

Only these two should be treated as ranking truth:
- active:
  - `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`
- backup:
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`

Everything else is supporting telemetry.

## Data Contracts

### DB file contract
File: `out/shorts/word-candidates-db.json`

Expected top-level shape:
- `meta`
- `words[]`

Each `words[]` item typically includes:
- `word`
- `reading`
- `meaning`
- `candidates[]`
- `candidateCount`
- `missing` or `error` flags depending on extractor outcome

Each candidate should include:
- `episode`
- `clipStartMs`
- `clipEndMs`
- `clipStart`
- `clipEnd`
- `jpText`
- `enText`
- `score` (heuristic extractor score before LLM rerank)

### Rerank file contract
File: `out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json`

Expected top-level keys:
- `meta`
- `summary`
- `words[]`

Expected per-word keys:
- `word`
- `processedAt`
- `model`
- `sourceCandidateCount`
- `gateStats`
- `status`
- `reason`
- `confidence`
- `top[]`
- `error`

Expected `top[]` pick shape:
- `rank`
- `candidateIndex`
- `llmScore`
- `llmReason`
- `episode`
- `clipStartMs`
- `clipEndMs`
- `clipStart`
- `clipEnd`
- `jpText`
- `enText`
- `heuristicScore`
- `asrAgreement`
- `asrText`
- `asrStatus`

## Status Semantics

Per-word `status` meanings:
- `ok`
  - ranking produced usable top picks and passed strict meaningful checks
- `fallback`
  - LLM output was weak/invalid or strict checks failed and fallback path was used
- `skip`
  - no usable candidate survived gates
- `error`
  - exception/transport/parser failure for this word

Render implications:
- default render path consumes `ok` only
- fallback words are excluded unless `--allowFallbackRender`

## Gate Definitions

The rerank script has three major gate layers before final pick output:

### 1) Sense lock gate
Flags:
- `--gateSenseLock` (default on)
- `--no-gateSenseLock`

Intent:
- reduce shared-kanji false positives
- prefer candidates where the queried surface/form is actually present as intended

Failure symptom when weak:
- words like `悪い` and `悪` can bleed into related but unintended sense usage

### 2) Fragment rejection gate
Flags:
- `--gateFragmentReject` (default on)
- `--no-gateFragmentReject`

Intent:
- reject fragmentary subtitle snippets and ellipsis-heavy pieces likely to produce bad learning context

Failure symptom when weak:
- candidates with incomplete utterances and contextless fragments get ranked high

### 3) Breath length gate
Flag:
- `--minBreathChars` (default `6`)

Intent:
- reject ultra-short JP lines that are technically valid but pedagogically weak

Failure symptom when weak:
- clipped one-phrase outputs that look "correct" to model but poor for learners

## LLM vs Heuristic Interaction

Current design in script:
1. Apply gates to candidate pool.
2. Heuristic pre-rank candidates.
3. Send only top `llmTopN` shortlist to LLM.
4. Normalize LLM JSON.
5. Enforce meaningfulness checks (`requireMeaningful` unless `allowWeak`).
6. Fallback to heuristic when allowed.
7. Save per word with atomic write.

Important:
- If `--allowFallback` is used aggressively, output can become "looks stable but mediocre".
- If `--failClosed` is strict, coverage can drop (more skip/error) but quality floor is safer.

## Known Real Failure Example

Word: `言う`

Observed problematic top pick chain included:
- JP:
  - `俺も お前の言う`
- EN:
  - `Then I'm also, as you said, a piece of trash caught up in the flow of the world, right?`

Issue:
- JP cue is short and clipped.
- EN appears to include trailing sentence continuation beyond JP cue.
- This is a classic "alignment pass, pedagogy fail" case.

Action implication:
- Even when status is `ok`, top picks still need spot checks in new rerank windows.

## Command Surface Reference

### Reranker script defaults
Script: `scripts/rerank-word-candidates-ollama.js`

Core defaults:
- `model=llama3.2:3b` at script level
- `topK=5`
- `maxCandidates=50`
- `llmTopN=15`
- `fromIndex=1`
- `count=0` (all)
- `requireMeaningful=true`
- `allowFallback=false`
- `gateSenseLock=true`
- `gateFragmentReject=true`
- `minBreathChars=6`
- `asrVerify=false`

### Wrapper defaults
Script: `scripts/rank-new-fast-safe.js`

Wrapper default execution:
- `model=qwen2.5:3b`
- `topK=5`
- `maxCandidates=50`
- `llmTopN=15`
- `fromIndex=60`
- `count=10`
- `resume`
- `failClosed`
- `printEvery=1`

Wrapper behavior on success:
- validates output JSON shape
- copies active output to:
  - `out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json`

Operational caution:
- This means running wrapper can overwrite backup automatically.
- If a stable backup must be preserved, copy it manually before testing.

## Recommended Backup Protocol

Before any rerank experiment:
1. Create immutable timestamped snapshot.
2. Run 10-word rerank.
3. Compare with previous snapshot.
4. Promote or rollback.

Example:
```bash
cp out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json out/saveFile/rerank-snapshot-$(date +%Y%m%d-%H%M%S).json
```

## Windowed Rerank Playbook

### Step A: choose test window
- Use a small batch, usually `10` words.
- Prefer a window containing known tricky words to stress-test quality.

### Step B: run rerank
```bash
npm run -s rank:new-fast -- --fromIndex 60 --count 10 --resume --force --allowFallback --printEvery 1
```

### Step C: compare against previous baseline
Use a quick diff script:
```bash
node - <<'NODE'
const fs=require('fs');
const cur=JSON.parse(fs.readFileSync('out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json','utf8'));
const bak=JSON.parse(fs.readFileSync('out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json','utf8'));
const cm=new Map((cur.words||[]).map(w=>[String(w.word||''),w]));
const bm=new Map((bak.words||[]).map(w=>[String(w.word||''),w]));
let statusChanged=0,top1Changed=0;
for(const [w,c] of cm){
  const b=bm.get(w); if(!b) continue;
  if(String(c.status||'')!==String(b.status||'')) statusChanged++;
  const c1=(c.top||[])[0]?.candidateIndex??null;
  const b1=(b.top||[])[0]?.candidateIndex??null;
  if(c1!==b1) top1Changed++;
}
console.log({statusChanged,top1Changed});
NODE
```

### Step D: decide
- If quality drops in UI and `ok -> fallback` transitions jump, rollback.
- If quality improves and remains stable, move to next 10-word window.

## Acceptance Criteria For Promotion

Use these promotion thresholds for each 10-word window:
- `top1Changed` is expected, but semantic quality must improve in manual spot check.
- `ok -> fallback` should not dominate the window.
- At least `8/10` words should remain directly renderable or better.
- At least `7/10` rendered shorts should be accepted without manual clip swaps.

If thresholds are not met, do not promote.

## Rollback Procedures

### Soft rollback
Restore active from known-good backup:
```bash
cp out/saveFile/word-candidates-llm-top.qwen2.5-3b.full.backup.json out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json
```

### Hard rollback with timestamped backup
```bash
cp out/saveFile/rerank-snapshot-YYYYMMDD-HHMMSS.json out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json
```

### Verify rollback applied
```bash
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("out/shorts/word-candidates-llm-top.qwen2.5-3b.full.json","utf8"));console.log(j.meta?.updatedAt,j.meta?.model,(j.words||[]).length);'
```

## Render Diagnostics

### Confirm who is rendering
```bash
pgrep -fl 'word-pipeline.js render|wp:render:fast'
```

### Confirm render command and runtime
```bash
ps -o pid,ppid,user,lstart,etime,command -p <PID>
```

### Confirm last rendered outputs
```bash
ls -lt out/shorts/*.mp4 | head -n 20
```

### Confirm run summary
```bash
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("out/shorts/render-manifest.json","utf8"));console.log(j.summary,j.meta?.scope);'
```

## UI Curation Labels And Their Meaning

In curation UI, clips can be marked with tags:
- `Wrong Sense`
- `Fragment`
- `Trailing`

Intended use:
- `Wrong Sense`
  - candidate contains target string but meaning/use is not intended teaching sense
- `Fragment`
  - clipped utterance or insufficient context for learning
- `Trailing`
  - EN/JP line pairing has continuation or neighboring line contamination

These tags should become training signals for future rerank gates.

## Future Work Backlog For Rerank Quality

Priority 0:
- persist UI rejection tags into machine-readable log tied to word + candidate index
- include tag history in rerank prompt or pre-filter

Priority 1:
- strengthen EN-JP pair consistency gate using cue boundary checks
- add candidate-level penalty for obvious trailing EN overflow

Priority 2:
- add a deterministic "min context units" metric beyond simple char count
- add lexical-sense hints from `match.forms` family metadata

Priority 3:
- integrate optional second-pass evaluator model only on top-5 picks, not full pool
- avoid expensive full-pass multimodal reranking until deterministic gates are stable

## Agent Handoff Template

When handing rerank state to another agent, include exactly:
1. Active rerank file path and `meta.updatedAt`.
2. Backup file path and `meta.updatedAt`.
3. Last command run (full command line).
4. Current diff summary vs backup.
5. Last render manifest summary.
6. Explicit recommendation: continue windowed rerank or rollback.

## Final Principle

Do not optimize for "LLM involvement".
Optimize for:
- stable renderable coverage
- correct sense selection
- complete learner-friendly sentences
- low manual replacement rate
