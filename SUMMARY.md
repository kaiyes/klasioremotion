# Summary Of Work

## Resume IDs
- `snk-furigana-center-romaji-fix-2026-02-06`
- `snk-vertical-clean-shorts-highlight-card-logo-2026-02-06`
- `snk-aot-pipeline-handoff-2026-02-08`

## Big Picture Plan
1. Build a stable word-in-context clip extractor from JP subtitles.
2. Keep JP + furigana + romaji + EN readable and centered.
3. Produce clean vertical shorts (1080x1920) with:
   - word card above video
   - subtitle block below video
   - Bundai logo + QR branding in corner
4. Append end card video (`source_content/card.mp4`) to final shorts.
5. Normalize episode file naming across videos/subs so matching is reliable.
6. Add subtitle sync calibration (Whisper + offset estimation) for hard episodes.

## Current Data Layout
- Videos: `source_content/shingeki_no_kyojin/videos`
- JP subs: `source_content/shingeki_no_kyojin/subs/japanese`
- EN subs: `source_content/shingeki_no_kyojin/subs/english`
- Brand logo: `source_content/logo.png`
- End card video: `source_content/card.mp4`
- Sync artifacts: `dissfiles/`

Current state target: all 3 episode sets (video/JP/EN) use `sXeY` naming and match by episode.

## What Was Implemented

### 1) Extraction + Matching Core
File: `scripts/extract-clips.js`
- Added EN subtitle auto-detect when `--subsDir` has sibling `english`.
- Added robust EN mapping fallback:
  - exact `SxxEyy`
  - global cumulative mapping across seasons (`E01..E89`)
  - local `Eyy` fallback
- Added sentence dedupe so repeated sentence text is not selected twice.
- Added manual candidate control:
  - `--printTop`
  - `--pick`
  - `--replace` (`3=12`, `last=15`)
- Added duplicate protection in replace flow (rejects duplicate sentence output).
- Improved JP token centering/furigana placement logic.
- Improved romaji token joining (`ん`, small kana, etc.) to avoid broken splits like `arumi n`.
- Supports concat cleanup (`--concatOnly`) and manifest output.
- Supports brand/end-card path (`logo.png`, `card.mp4`, fallback `card.png`).

### 2) Vertical Shorts Pipeline (clean layout)
File: `scripts/make-vertical-shorts-clean.js`
- Builds 1080x1920 shorts with:
  - black background
  - centered 16:9 video strip
  - pale green top card (`Anime word of the day`, reading, kanji, meaning)
  - subtitle overlay block just below video (EN + furigana + JP + romaji)
  - top-right Bundai brand block with logo + QR
- Pulls clip metadata from extractor manifest.
- Highlights target word in JP/furigana/romaji/EN lines.
- Forwards selector controls to extractor (`--printTop`, `--pick`, `--replace`).
- Appends `source_content/card.mp4` tail and supports repeat count via `--tailRepeat` (default `3`).
- Cleans rerun outputs by default:
  - `out/clips`
  - `out/shorts_work`
  - `out/shorts`
  - disable with `--keepOutputs`.

Why two folders:
- `out/shorts_work`: intermediate stitched and overlay assets
- `out/shorts`: final rendered shorts

### 3) Batch/Automation Commands
File: `package.json`
- Added/updated scripts for direct AOT workflow:
  - `extract-clips:aot`
  - `batch-extract:aot`
  - `shorts-clean:aot`
  - `shorts-render:aot`
  - `shorts-all:aot`
- Added rename/sync tooling commands:
  - `rename-videos-from-subs`
  - `rename-english-subs`
  - `flatten-videos`
  - `link-subs`
  - `normalize-episode-names`
  - `estimate-sub-offset`
  - `calibrate-sub-sync`
  - `sync-word-check`
  - `align-episode-subs`
  - `align-all-episode-subs`

### 4) File Naming / Migration Helpers
- `scripts/normalize-episode-names.js`:
  - normalizes files to `sXeY.ext` in-place
- `scripts/flatten-videos-by-episode.js`:
  - flattens season folders into one folder with `S01ep01.ext`
- `scripts/rename-videos-from-subs.js`:
  - maps videos to subtitle episode structure
- `scripts/link-subs-to-videos.js`:
  - link/copy subtitles next to flattened video naming
- `scripts/rename-english-subs.js`:
  - maps global EN numbering (`01..89`) to `sXeY.srt`

### 5) Sync Calibration Tooling
- `scripts/estimate-sub-offset.js`:
  - scores constant offsets by matching ASR segments vs subtitle lines
- `scripts/calibrate-sub-sync.js`:
  - runs ffmpeg + whisper + estimator over sample windows
  - retries on low/no alignment
  - writes `source_content/shingeki_no_kyojin/subs/sub-offsets.json` with `--apply`
  - blocks low-confidence save unless `--allowLowConfidence`
- `scripts/sync-word-check.js`:
  - quick clip-based visual check for a known early word across multiple offsets
  - output under `dissfiles/sync-check/...`
- `scripts/align-episode-subs.js`:
  - aligns one episode by using embedded subtitle stream in video as timing reference
  - estimates JP and EN offsets separately
  - writes machine-readable result JSON (`--resultJson`)
  - can skip check render for speed (`--noCheck`)
- `scripts/align-all-episode-subs.js`:
  - runs `align-episode-subs` across all episodes that exist in video + JP + EN
  - persists durable DB:
    - `source_content/shingeki_no_kyojin/subs/sub-sync-db.json`
  - updates runtime offsets file:
    - `source_content/shingeki_no_kyojin/subs/sub-offsets.json`
  - supports incremental reruns (skip already-synced episodes unless `--force`)

## What Went Right
- Furigana alignment and JP centering were fixed using token-centered layout.
- Romaji split artifacts (`arumi n`) were fixed by continuation-token joining.
- EN matching became reliable after season-cumulative mapping and EN renaming.
- Duplicate sentence clips were blocked by dedupe + replace validation.
- Final card append is stable using `card.mp4` and repeat control.
- Large generated outputs are ignored in git; only selected source assets are tracked.

## What Went Wrong (and How It Was Corrected)
- EN lines mismatched JP lines:
  - cause: EN files used different numbering scheme
  - fix: global episode mapping + EN renaming tool.
- Duplicate clips in same short:
  - cause: repeated subtitle sentence candidates
  - fix: sentence-key dedupe + duplicate guard in replacement.
- Missing/incorrect end card:
  - cause: earlier image/video tail path behavior mismatch
  - fix: explicit `card.mp4` append at end of clean shorts.
- “Only top 25 words” confusion:
  - practical blocker was incomplete EN coverage at the time; once EN set was complete, full runs worked.
- Subtitle sync still drifts on some episodes:
  - constant-offset model is not perfect; calibration per episode is required in problematic cases.

## Current Command Cheat Sheet

### Generate one clean short
```bash
npm run shorts-clean:aot -- --query 言う --limit 7
```

### Inspect and manually choose better candidates
```bash
npm run shorts-clean:aot -- --query 今 --limit 7 --printTop 25
npm run shorts-clean:aot -- --query 今 --limit 7 --pick 1,2,12,4,5,6,7
npm run shorts-clean:aot -- --query 今 --limit 7 --replace 3=9 --replace last=12
```

### Keep old outputs instead of auto-clean
```bash
npm run shorts-clean:aot -- --query 言う --limit 7 --keepOutputs
```

### Change end-card repeat count
```bash
npm run shorts-clean:aot -- --query 言う --limit 7 --tailRepeat 3
```

### Rename EN subtitles to `sXeY.srt`
```bash
npm run rename-english-subs -- --apply
```

### Normalize season/episode names in place
```bash
npm run normalize-episode-names -- --apply
```

### Quick sync visual test on one episode/word
```bash
npm run sync-word-check -- --episode s4e30 --query "何だろう" --offsets 0,4500,4800
```

### Calibrate and save subtitle offset
```bash
npm run calibrate-sub-sync -- --episode s4e30 --sampleSec 60 --maxAttempts 4 --apply
```

If calibration says low confidence, either increase sample/retries or force-save:
```bash
npm run calibrate-sub-sync -- --episode s4e30 --sampleSec 90 --maxAttempts 6 --apply --allowLowConfidence
```

### Align one episode with embedded subtitle reference (JP + EN)
```bash
npm run align-episode-subs -- --episode s4e30 --sampleSec 1200 --write --checkOut dissfiles/s4e30_aligned_check.mp4
```

### Align all episodes once and persist DB + offsets JSON
```bash
npm run align-all-episode-subs -- --sampleSec 1200 --checkEvery 0
```

## Git / Large File Safety
File: `.gitignore`
- Ignored:
  - `out`
  - `out/**/*.mp4|mov|webm|mkv`
  - `clips`
  - `dissfiles`
  - `source_content/*`
- Allowed (explicitly tracked):
  - `source_content/logo.png`
  - `source_content/card.mp4`

## Practical Notes For Next Thread
- Default short run now expects full dataset at:
  - `source_content/shingeki_no_kyojin/videos`
  - `source_content/shingeki_no_kyojin/subs/japanese`
  - `source_content/shingeki_no_kyojin/subs/english`
- If EN line is missing in output, verify matching `sXeY` file exists in EN folder.
- If one clip is bad, use `--replace` instead of rerolling everything.
- If sync is off on an episode, calibrate once and save offset JSON, then rerun.
- Reruns clean output folders by default; add `--keepOutputs` only when needed.

## Latest Sync DB Snapshot
- Ran batch align across full set (`89` episodes) and saved:
  - `source_content/shingeki_no_kyojin/subs/sub-offsets.json`
  - `source_content/shingeki_no_kyojin/subs/sub-sync-db.json`
- Current DB status:
  - `ok`: `82`
  - `needs_review`: `7`
  - `error`: `0`
- Current review list:
  - `s3e11`, `s3e12`, `s3e13`, `s3e15`, `s3e22`, `s4e29`, `s4e30`

## Open Improvements (Not Done Yet)
- Small local UI for:
  - candidate preview/selection
  - “replace clip #N” interactions
  - one-click rerender
- Optional smarter sync model (piecewise offsets or anchor words) for episodes where constant offset is insufficient.
