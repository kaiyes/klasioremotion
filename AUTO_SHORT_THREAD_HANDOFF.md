# Auto-Short Thread Handoff (Feb 8, 2026)

## Goal
Automate vertical talking-head short edits in Remotion:
- detect key moments from subtitles/transcript
- cut to animated cards
- return to talking head with top keyword overlays
- add stylized captions that stay inside YouTube-safe zones
- keep this process repeatable for future videos

## User Preferences Locked In
- All motion accents should stay toward the **top** area.
- Subtitle area should avoid bottom/right YouTube UI obstruction zones.
- Top overlays should be short keyword phrases, not full sentences.
- Top keywords like `Open Claw` and `AI Automation` should use more aggressive styling.
- Cutaway card screens should exist, but should not stay too long.
- Subtitle style should be one-line and now use word-level highlighting when possible.

## What Was Implemented In This Thread

### 1) Auto-short planning + rendering pipeline
- Auto planning script was used/extended: `scripts/generate-auto-short-plan.js`
- Composition renders from generated plan: `src/auto-short/generated-plan.ts`
- Main renderer: `src/auto-short/AutoShortVideo.tsx`
- Composition entry: `src/Root.tsx` (`AutoShort`)

### 2) Heuristic segmenting + semantic overlays
- Non-listicle handling improved so generic `Key idea 1/2/3` is avoided.
- Overlay phrases extracted as short semantic keywords.
- `openclaw` normalization mapped to `Open Claw`.

### 3) Visual direction updates
- Cutaways keep a full-screen animated card treatment.
- Optional background card support with subtle jiggle motion.
- Top-word overlays upgraded to larger animated gradient/stroked type.
- Money icon bursts moved into top-safe area.

### 4) Caption evolution
- Captions moved upward into safe zone.
- Switched to one-line subtitle pages (Netflix-like rhythm).
- Then upgraded to true **Whisper word-timestamp highlighting**:
  - planner extracts word timings from Whisper JSON
  - renderer highlights currently spoken word using exact timing
  - fallback cue-based one-line captions still exists if `wordCaptions` is missing

## Whisper Word-Timestamp Support

### Planner changes
- `runWhisper()` now requests word timestamps:
  - `--word_timestamps True`
- Added JSON discovery + parsing:
  - `findWhisperJson()`
  - `parseWhisperWordCaptions()`
- Output now includes `wordCaptions` in generated plan.

### Type changes
- Added `AutoShortCaptionWord` and `wordCaptions?: AutoShortCaptionWord[]`:
  - `src/auto-short/types.ts`

### Renderer changes
- Added `WordTimedCaptionBar` in:
  - `src/auto-short/AutoShortVideo.tsx`
- Added one-line page builder for word captions:
  - `buildOneLineWordPages()`
- Composition selects word-timed mode when available.

## Current Commands To Run

### Generate plan (with Whisper transcription + word timestamps)
```bash
node scripts/generate-auto-short-plan.js --input "src/make bank.mp4"
```

### Reuse existing whisper outputs
```bash
node scripts/generate-auto-short-plan.js --input "src/make bank.mp4" --skipWhisper
```

### Render final short
```bash
npx remotion render AutoShort out/auto-short/auto-short.mp4
```

## Current Output Locations
- Final render:
  - `out/auto-short/auto-short.mp4`
- Working artifacts:
  - `out/auto-short/make-bank/`
- Generated plan:
  - `src/auto-short/generated-plan.ts`

## Git Hygiene Added In This Thread
- Updated `.gitignore` to block video files from commits:
  - `*.mp4`, `*.mov`, `*.webm`, `*.mkv`, `*.avi`, `*.m4v`
- `source_content/card.mp4` was removed from Git tracking index (`git rm --cached`) so MP4s are not committed going forward.

## Important Notes For Next Session
- If word highlighting stops working, verify Whisper JSON has `segments[].words`.
- If needed, re-run planning without `--skipWhisper` to regenerate word timestamps.
- Keep all auto-generated media in `out/` and avoid committing binary video assets.
- If visuals feel too strong/weak, tune these first:
  - top overlay font size + stroke/glow in `TopBanner`
  - one-line caption max chars / font sizing in `WordTimedCaptionBar`
  - cutaway timing constants in `normalizeCutaways()`

## References Used During This Thread
- Remotion captions docs:
  - https://www.remotion.dev/docs/captions/displaying-captions/
  - https://www.remotion.dev/docs/captions/parse-srt
- YouTube safe-zone references:
  - https://support.google.com/google-ads/answer/13547298?hl=en
  - https://support.google.com/google-ads/answer/13704860?hl=en
- CapCut caption/font references:
  - https://www.capcut.com/resource/best-caption-fonts
  - https://www.capcut.com/resource/add-captions
- Skill lookup references:
  - https://skills.sh/remotion-dev/skills/remotion
  - https://skills.sh/remotion-dev/skills/remotion-best-practices
