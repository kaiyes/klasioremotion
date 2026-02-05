#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Extracts sentence-sized clips around a query term using subtitle timestamps.
 *
 * Supports: .srt, .ass
 *
 * Example (scan subs, print matches + planned clips):
 *   node scripts/extract-clips.js --query "思うんだ" --subsDir shingeki_no_kyojin --limit 2 --dryRun
 *
 * Example (also extract clips):
 *   node scripts/extract-clips.js --query "思うんだ" --subsDir shingeki_no_kyojin --videosDir /path/to/videos --limit 2
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const DEFAULT_VIDEO_EXTS = [".mkv", ".mp4", ".webm", ".mov"];

function parseArgs(argv) {
  const args = {
    query: null,
    subsDir: null,
    subFile: null,
    videosDir: null,
    video: null,
    limit: 5,
    dryRun: false,
    outDir: "out/clips",
    // Default behavior: take exactly the subtitle line timing.
    // No padding, no minimum duration.
    prePadMs: 0,
    postPadMs: 0,
    minClipMs: 0,
    // If a subtitle line is long, either shrink around the match or skip it.
    // Typical anime subtitle lines are ~1-2s.
    maxClipMs: 2000,
    longPolicy: "skip", // "skip" | "shrink"
    mode: "line", // "line" | "sentence"
    concat: false,
    concatOut: null,
    flatOut: false,
    concatOnly: false,
    writeManifest: false,
    subOffsetMs: 0,
    enSubsDir: null,
    rank: false,
    printTop: 0,
    sentenceGapMs: 800,
    maxSentenceItems: 8,
    videoExts: DEFAULT_VIDEO_EXTS,
    verbose: false,
  };

  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const [key, maybeValue] = a.slice(2).split("=");
    const value = maybeValue ?? argv[i + 1];

    const takeNext = () => {
      if (maybeValue != null) return;
      i++;
    };

    switch (key) {
      case "query":
        args.query = value;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = value;
        takeNext();
        break;
      case "sub":
      case "subFile":
        args.subFile = value;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = value;
        takeNext();
        break;
      case "video":
        args.video = value;
        takeNext();
        break;
      case "limit":
        args.limit = Number(value);
        takeNext();
        break;
      case "outDir":
        args.outDir = value;
        takeNext();
        break;
      case "prePadMs":
        args.prePadMs = Number(value);
        takeNext();
        break;
      case "postPadMs":
        args.postPadMs = Number(value);
        takeNext();
        break;
      case "sentenceGapMs":
        args.sentenceGapMs = Number(value);
        takeNext();
        break;
      case "maxSentenceItems":
        args.maxSentenceItems = Number(value);
        takeNext();
        break;
      case "minClipMs":
        args.minClipMs = Number(value);
        takeNext();
        break;
      case "maxClipMs":
        args.maxClipMs = Number(value);
        takeNext();
        break;
      case "longPolicy":
        args.longPolicy = String(value);
        takeNext();
        break;
      case "mode":
        args.mode = String(value);
        takeNext();
        break;
      case "concat":
        args.concat = true;
        break;
      case "concatOut":
        args.concatOut = value;
        takeNext();
        break;
      case "flat":
      case "flatOut":
        args.flatOut = true;
        break;
      case "concatOnly":
        args.concatOnly = true;
        break;
      case "manifest":
        args.writeManifest = true;
        break;
      case "noManifest":
        args.writeManifest = false;
        break;
      case "subOffsetMs":
        args.subOffsetMs = Number(value);
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = value;
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "printTop":
        args.printTop = Number(value);
        takeNext();
        break;
      case "videoExts":
        args.videoExts = String(value)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        console.error(`Unknown arg: --${key}`);
        printHelpAndExit(1);
    }
  }

  if (rest.length > 0) {
    console.error(`Unexpected positional args: ${rest.join(" ")}`);
    printHelpAndExit(1);
  }

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/extract-clips.js --query "<text>" (--subFile <file> | --subsDir <dir>) [--video <file> | --videosDir <dir>]

Options:
  --query               Query substring to search for (required)
  --subFile             Subtitle file (.srt or .ass)
  --subsDir             Directory to scan for subtitle files
  --video               Video file to use (single-video mode)
  --videosDir           Directory where videos live (auto-match by basename)
  --videoExts           Comma-separated list of video extensions to try (default: ${DEFAULT_VIDEO_EXTS.join(",")})
  --mode                "line" (default) uses the single subtitle line that contains the query. "sentence" merges nearby lines.
  --limit               Number of clips to extract (default: 5)
  --outDir              Output directory (default: out/clips)
  --prePadMs            Padding before the matched word (line mode) or before the sentence (sentence mode) (default: 0)
  --postPadMs           Padding after the matched word (line mode) or after the sentence (sentence mode) (default: 0)
  --minClipMs           Ensure each clip is at least this long by expanding padding (default: 0)
  --maxClipMs           If the candidate clip is longer than this, apply --longPolicy (default: 2000)
  --longPolicy          "skip" (default) ignores long lines; "shrink" trims around the match.
  --concat              After extraction, stitch clips into a single video (default: off)
  --concatOut           Output file for stitched video (default: <outDir>/<query>/stitched.mp4)
  --flatOut             Do not create per-query folders; write outputs into --outDir
  --concatOnly          After stitching, delete the individual clip files
  --manifest            Write a manifest JSON (default: off)
  --subOffsetMs         Shift all subtitle timestamps by this amount (ms). Use negative to shift earlier. (default: 0)
  --enSubsDir           English subtitle directory (for scoring)
  --rank                Rank candidates and pick the best scores instead of first matches
  --printTop            Print the top N ranked candidates with scores (default: 0)
  --sentenceGapMs       Max gap between subtitle items to still be the same sentence (default: 800)
  --maxSentenceItems    Max subtitle items to merge into a "sentence" (default: 8)
  --dryRun              Print planned clips / ffmpeg commands, do not run
  --verbose             More logging
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  // 00:00:41,057
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

function timeAssToMs(ts) {
  // 0:08:36.08 (centiseconds) OR 0:08:36.123 (ms)
  const m = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) throw new Error(`Bad ASS timestamp: ${ts}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const frac = m[4];
  const base = ((hh * 60 + mm) * 60 + ss) * 1000;
  if (frac.length === 1) return base + Number(frac) * 100;
  if (frac.length === 2) return base + Number(frac) * 10;
  return base + Number(frac);
}

function parseSrtFile(filePath) {
  const raw = stripBom(fs.readFileSync(filePath, "utf8"));
  const blocks = raw
    .split(/\r?\n\r?\n+/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/g);
    if (lines.length < 2) continue;
    // Some SRTs omit the numeric index. Be permissive.
    const timeLineIdx = lines[0].includes("-->") ? 0 : 1;
    const timeLine = lines[timeLineIdx];
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!m) continue;
    const startMs = timeSrtToMs(m[1]);
    const endMs = timeSrtToMs(m[2]);
    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join("\n").trim();
    if (!text) continue;
    items.push({ startMs, endMs, text });
  }
  return items;
}

function cleanAssText(t) {
  // Basic cleanup: \N line breaks, strip {...} override tags.
  return t.replace(/\\N/g, "\n").replace(/\{[^}]*\}/g, "").trim();
}

function parseAssFile(filePath) {
  const raw = stripBom(fs.readFileSync(filePath, "utf8"));
  const lines = raw.split(/\r?\n/g);
  const items = [];
  for (const line of lines) {
    if (!line.startsWith("Dialogue:")) continue;
    const rest = line.slice("Dialogue:".length).trim();
    const parts = rest.split(",");
    if (parts.length < 10) continue;
    const start = parts[1].trim();
    const end = parts[2].trim();
    const text = cleanAssText(parts.slice(9).join(","));
    if (!text) continue;
    const startMs = timeAssToMs(start);
    const endMs = timeAssToMs(end);
    items.push({ startMs, endMs, text });
  }
  return items;
}

function parseSubsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".srt") return parseSrtFile(filePath);
  if (ext === ".ass") return parseAssFile(filePath);
  return [];
}

function applyOffset(items, offsetMs) {
  if (!offsetMs) return items;
  return items.map((it) => ({
    ...it,
    startMs: Math.max(0, it.startMs + offsetMs),
    endMs: Math.max(0, it.endMs + offsetMs),
  }));
}

function buildSubtitleIndex(subsDir) {
  if (!subsDir) return new Map();
  const index = new Map();
  const entries = fs.readdirSync(subsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== ".srt" && ext !== ".ass") continue;
    const info = extractEpisodeKeyFromName(e.name);
    if (!info) continue;
    const p = path.join(subsDir, e.name);
    if (!index.has(info.key)) index.set(info.key, p);
  }
  return index;
}

function getEnglishItemsForSubFile(subFile, enIndex, enCache) {
  if (!enIndex || enIndex.size === 0) return null;
  const info = extractEpisodeKeyFromName(subFile);
  if (!info) return null;

  let enFile = null;
  if (enIndex.has(info.key)) enFile = enIndex.get(info.key);
  if (!enFile && info.episode != null) {
    const epKey = `E${String(info.episode).padStart(2, "0")}`;
    if (enIndex.has(epKey)) enFile = enIndex.get(epKey);
  }
  if (!enFile) return null;

  if (enCache.has(enFile)) return enCache.get(enFile);
  const items = parseSrtFile(enFile);
  enCache.set(enFile, items);
  return items;
}

function normalizeTextForScoring(t) {
  if (!t) return "";
  return t
    .replace(/^[\s　]*[（(][^）)]*[）)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate({
  jpText,
  enText,
  durationMs,
  matchCenterDistMs,
}) {
  let score = 0;
  const jpClean = normalizeTextForScoring(jpText);
  const jpLen = Array.from(jpClean.replace(/\s+/g, "")).length;

  const ideal = 2500;
  const durationScore = Math.max(0, 1 - Math.abs(durationMs - ideal) / 2500);
  score += durationScore * 30;

  if (durationMs > 0) {
    const centerScore = Math.max(0, 1 - matchCenterDistMs / (durationMs / 2));
    score += centerScore * 20;
  }

  const lenScore = Math.max(0, 1 - Math.abs(jpLen - 10) / 12);
  score += lenScore * 15;

  const hasSpeaker = /^[\s　]*[（(][^）)]*[）)]/.test(jpText);
  if (hasSpeaker) score -= 4;
  if (jpText.includes("\n")) score -= 3;
  if (/[➡→]/.test(jpText)) score -= 5;
  if (/…|\.{3}|―|—/.test(jpText)) score -= 4;

  if (enText && enText.trim().length > 0) score += 8;

  return Math.round(score * 10) / 10;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

function findEnglishForTime(enItems, startMs, endMs) {
  if (!enItems || enItems.length === 0) return "";
  const overlaps = [];
  for (const it of enItems) {
    const ov = overlapMs(startMs, endMs, it.startMs, it.endMs);
    if (ov > 0) overlaps.push({ item: it, ov });
  }
  if (overlaps.length > 0) {
    overlaps.sort((a, b) => b.ov - a.ov);
    const texts = overlaps.map((o) => o.item.text.replace(/\s+/g, " ").trim());
    return Array.from(new Set(texts)).join(" ");
  }

  const mid = (startMs + endMs) / 2;
  let best = null;
  let bestDist = Infinity;
  for (const it of enItems) {
    const midIt = (it.startMs + it.endMs) / 2;
    const dist = Math.abs(midIt - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = it;
    }
  }
  if (best && bestDist <= 700) {
    return best.text.replace(/\s+/g, " ").trim();
  }
  return "";
}

function isSentenceTerminal(text) {
  const t = text.trim();
  // Common Japanese sentence enders + ASCII fallbacks
  return /[。！？!?]$/.test(t);
}

function sentenceWindow(items, idx, opts) {
  const { sentenceGapMs, maxSentenceItems } = opts;
  let start = idx;
  let end = idx;

  // Expand backward until we reach a prior sentence end or a large gap.
  while (start > 0 && idx - start < maxSentenceItems) {
    const prev = items[start - 1];
    const cur = items[start];
    const gap = cur.startMs - prev.endMs;
    if (gap > sentenceGapMs) break;
    if (isSentenceTerminal(prev.text)) break;
    start--;
  }

  // Expand forward until we hit punctuation at the end of a block or a large gap.
  while (end < items.length - 1 && end - idx < maxSentenceItems) {
    const cur = items[end];
    if (isSentenceTerminal(cur.text)) break;
    const next = items[end + 1];
    const gap = next.startMs - cur.endMs;
    if (gap > sentenceGapMs) break;
    end++;
  }

  return { start, end };
}

function findSubstringIndex(haystack, needle) {
  if (!haystack || !needle) return -1;
  const h = Array.from(haystack);
  const n = Array.from(needle);
  if (n.length === 0 || h.length === 0 || n.length > h.length) return -1;
  for (let i = 0; i <= h.length - n.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function estimateMatchTimeInLine({ text, query, startMs, endMs }) {
  const duration = Math.max(1, endMs - startMs);
  const textArr = Array.from(text ?? "");
  const queryArr = Array.from(query ?? "");
  const idx = findSubstringIndex(textArr, queryArr);
  if (idx < 0 || textArr.length === 0) {
    return { matchStartMs: startMs, matchEndMs: endMs };
  }
  const ratioStart = idx / textArr.length;
  const ratioEnd = (idx + queryArr.length) / textArr.length;
  const matchStartMs = startMs + ratioStart * duration;
  const matchEndMs = startMs + ratioEnd * duration;
  return { matchStartMs, matchEndMs };
}

function msToFfmpegTime(ms) {
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped / 1000;
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${hh}:${mm}:${ss}`;
}

function safeFilename(s) {
  // Allow unicode (Japanese) but strip path separators and control chars.
  const raw = String(s ?? "").trim();
  let name = raw
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);

  if (name) return name;
  const hash = crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 10);
  return `q_${hash}`;
}

function listSubtitleFiles(subsDir) {
  const out = [];
  const entries = fs.readdirSync(subsDir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(subsDir, e.name);
    if (e.isDirectory()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== ".srt" && ext !== ".ass") continue;
    out.push(p);
  }
  out.sort();
  return out;
}

function extractEpisodeKeyFromName(name) {
  const base = path.basename(name, path.extname(name));

  // Common patterns:
  // - "s1e13" / "S01E13"
  // - "Shingeki no Kyojin S01E13 ..."
  // - "03. Episode Title" (episode only, season implied)
  const m1 = base.match(/s(\d{1,2})e(\d{1,3})/i);
  if (m1) {
    return {
      season: Number(m1[1]),
      episode: Number(m1[2]),
      key: `S${String(Number(m1[1])).padStart(2, "0")}E${String(Number(m1[2])).padStart(2, "0")}`,
    };
  }

  const m2 = base.match(/S(\d{2})E(\d{2})/);
  if (m2) {
    return {
      season: Number(m2[1]),
      episode: Number(m2[2]),
      key: `S${m2[1]}E${m2[2]}`,
    };
  }

  const m3 = base.match(/^\s*(\d{1,3})\s*\./);
  if (m3) {
    const ep = Number(m3[1]);
    return { season: null, episode: ep, key: `E${String(ep).padStart(2, "0")}` };
  }

  return null;
}

function buildVideoIndex(videosDir, exts) {
  const index = new Map();
  const entries = fs.readdirSync(videosDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!exts.includes(ext)) continue;
    const info = extractEpisodeKeyFromName(e.name);
    if (!info) continue;
    // Prefer first match; deterministic order helps.
    const p = path.join(videosDir, e.name);
    if (info.key.startsWith("S") && info.key.includes("E")) {
      if (!index.has(info.key)) index.set(info.key, p);
      continue;
    }
    // Episode-only keys.
    if (!index.has(info.key)) index.set(info.key, p);
  }
  return index;
}

function findVideoForSubs(subFile, videosDir, exts, videoIndex) {
  if (!videosDir) return null;

  const base = path.basename(subFile, path.extname(subFile));
  for (const ext of exts) {
    const candidate = path.join(videosDir, base + ext);
    if (fs.existsSync(candidate)) return candidate;
  }

  const info = extractEpisodeKeyFromName(subFile);
  if (!info) return null;

  if (info.key.startsWith("S") && videoIndex?.has(info.key)) {
    return videoIndex.get(info.key);
  }

  // If subs only have E## but videos have S##E##, fall back.
  if (info.season == null) {
    const ep2 = `E${String(info.episode).padStart(2, "0")}`;
    if (videoIndex?.has(ep2)) return videoIndex.get(ep2);
    for (const [k, v] of videoIndex?.entries?.() ?? []) {
      if (k.endsWith(`E${String(info.episode).padStart(2, "0")}`)) return v;
    }
  }

  return null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function runFfmpegExtract({ input, startMs, endMs, output, verbose }) {
  const start = msToFfmpegTime(startMs);
  const durationMs = Math.max(0, endMs - startMs);
  const duration = (durationMs / 1000).toFixed(3);

  // Re-encode for accuracy and consistent outputs.
  const args = [
    "-y",
    "-ss",
    start,
    "-i",
    input,
    "-t",
    duration,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ];

  if (verbose) console.log(["ffmpeg", ...args].join(" "));
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed for ${output}`);
  }
}

function runFfmpegConcat({ inputs, output, verbose, listName }) {
  // Build concat list file
  ensureDir(path.dirname(output));
  const listFile = path.join(
    path.dirname(output),
    listName ?? ".concat-list.txt",
  );
  const absInputs = inputs.map((p) => path.resolve(p));
  const content = absInputs
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  fs.writeFileSync(listFile, content + "\n");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ];

  if (verbose) console.log(["ffmpeg", ...args].join(" "));
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg concat failed for ${output}`);
  }
}

function ensureMinDuration({ startMs, endMs, minClipMs }) {
  const dur = endMs - startMs;
  if (dur >= minClipMs) return { startMs, endMs };
  const extra = minClipMs - dur;
  let newStart = startMs - Math.floor(extra / 2);
  let newEnd = endMs + Math.ceil(extra / 2);
  if (newStart < 0) {
    newEnd += -newStart;
    newStart = 0;
  }
  return { startMs: newStart, endMs: newEnd };
}

function applyMaxDuration({
  startMs,
  endMs,
  maxClipMs,
  policy,
  matchStartMs,
  matchEndMs,
}) {
  const dur = endMs - startMs;
  if (!maxClipMs || maxClipMs <= 0) return { startMs, endMs, skipped: false };
  if (dur <= maxClipMs) return { startMs, endMs, skipped: false };

  if (policy === "skip") {
    return { startMs, endMs, skipped: true };
  }

  if (policy !== "shrink") {
    throw new Error(`Unknown --longPolicy: ${policy} (expected "skip" or "shrink")`);
  }

  const mid = (matchStartMs + matchEndMs) / 2;
  let newStart = Math.round(mid - maxClipMs / 2);
  let newEnd = newStart + maxClipMs;

  // Clamp into original window.
  if (newStart < startMs) {
    newStart = startMs;
    newEnd = newStart + maxClipMs;
  }
  if (newEnd > endMs) {
    newEnd = endMs;
    newStart = newEnd - maxClipMs;
  }
  if (newStart < startMs) newStart = startMs;
  if (newEnd > endMs) newEnd = endMs;

  return { startMs: newStart, endMs: newEnd, skipped: false };
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.query) {
    console.error("--query is required");
    printHelpAndExit(1);
  }
  if (!args.subFile && !args.subsDir) {
    console.error("Provide --subFile or --subsDir");
    printHelpAndExit(1);
  }
  if (args.subFile && args.subsDir) {
    console.error("Use either --subFile or --subsDir (not both)");
    printHelpAndExit(1);
  }
  if (args.video && args.videosDir) {
    console.error("Use either --video or --videosDir (not both)");
    printHelpAndExit(1);
  }
  if (args.mode !== "line" && args.mode !== "sentence") {
    console.error('--mode must be "line" or "sentence"');
    printHelpAndExit(1);
  }
  if (args.concatOnly) {
    args.concat = true;
  }

  const subFiles = args.subFile
    ? [args.subFile]
    : listSubtitleFiles(args.subsDir);

  const videoIndex = args.videosDir ? buildVideoIndex(args.videosDir, args.videoExts) : null;
  const enIndex = args.enSubsDir ? buildSubtitleIndex(args.enSubsDir) : null;
  const enCache = new Map();

  const planned = [];
  const dedupe = new Set();

  for (const subFile of subFiles) {
    const items = applyOffset(parseSubsFile(subFile), args.subOffsetMs);
    if (items.length === 0) continue;
    const enItems = getEnglishItemsForSubFile(subFile, enIndex, enCache);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.text.includes(args.query)) continue;

      const win =
        args.mode === "sentence"
          ? sentenceWindow(items, i, args)
          : { start: i, end: i };
      const startItem = items[win.start];
      const endItem = items[win.end];

      const estimated = estimateMatchTimeInLine({
        text: it.text,
        query: args.query,
        startMs: it.startMs,
        endMs: it.endMs,
      });

      const sentenceText =
        args.mode === "sentence"
          ? items
              .slice(win.start, win.end + 1)
              .map((x) => x.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
          : it.text.replace(/\s+/g, " ").trim();

      let clipStartMs =
        args.mode === "line"
          ? Math.max(0, estimated.matchStartMs - args.prePadMs)
          : Math.max(0, startItem.startMs - args.prePadMs);
      let clipEndMs =
        args.mode === "line"
          ? estimated.matchEndMs + args.postPadMs
          : endItem.endMs + args.postPadMs;

      // Enforce the "not longer than 1-2 seconds" preference:
      // If the subtitle line is longer, either skip it or shrink around the match.
      const maxed = applyMaxDuration({
        startMs: clipStartMs,
        endMs: clipEndMs,
        maxClipMs: args.maxClipMs,
        policy: args.longPolicy,
        matchStartMs: estimated.matchStartMs,
        matchEndMs: estimated.matchEndMs,
      });
      if (maxed.skipped) continue;
      clipStartMs = maxed.startMs;
      clipEndMs = maxed.endMs;

      const ensured = ensureMinDuration({
        startMs: clipStartMs,
        endMs: clipEndMs,
        minClipMs: args.minClipMs,
      });
      clipStartMs = ensured.startMs;
      clipEndMs = ensured.endMs;

      const key = `${subFile}::${clipStartMs}::${clipEndMs}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      const videoFile =
        args.video ?? findVideoForSubs(subFile, args.videosDir, args.videoExts, videoIndex);

      const enText = enItems
        ? findEnglishForTime(enItems, clipStartMs, clipEndMs)
        : "";
      const matchCenterDistMs = Math.abs(
        (estimated.matchStartMs + estimated.matchEndMs) / 2 -
          (clipStartMs + clipEndMs) / 2,
      );
      const score = scoreCandidate({
        jpText: sentenceText,
        enText,
        durationMs: clipEndMs - clipStartMs,
        matchCenterDistMs,
      });
      planned.push({
        subFile,
        videoFile,
        clipStartMs,
        clipEndMs,
        matchStartMs: estimated.matchStartMs,
        matchEndMs: estimated.matchEndMs,
        sentenceText,
        enText,
        score,
      });
    }
  }

  if (planned.length === 0) {
    console.error(`No matches found for query: ${args.query}`);
    process.exit(2);
  }

  let selected = planned;
  if (args.rank) {
    selected = [...planned].sort((a, b) => b.score - a.score);
  }
  selected = selected.slice(0, args.limit);

  if (args.printTop > 0 && args.rank) {
    console.log("");
    console.log(`Top ${Math.min(args.printTop, selected.length)} candidates:`);
    selected.slice(0, args.printTop).forEach((c, idx) => {
      console.log(
        `${idx + 1}. score=${c.score} ${path.basename(c.subFile)} ${msToFfmpegTime(c.clipStartMs)}-${msToFfmpegTime(c.clipEndMs)}`,
      );
      console.log(`   JP: ${c.sentenceText}`);
      if (c.enText) console.log(`   EN: ${c.enText}`);
    });
  }

  const querySlug = safeFilename(args.query);
  const outputDir = args.flatOut ? args.outDir : path.join(args.outDir, querySlug);
  ensureDir(outputDir);

  const manifest = selected.map((p, idx) => {
    const base = path.basename(p.subFile, path.extname(p.subFile));
    const outName = args.flatOut
      ? `${querySlug}_${String(idx + 1).padStart(2, "0")}_${safeFilename(base)}_${msToFfmpegTime(p.clipStartMs).replace(/[:.]/g, "-")}.mp4`
      : `${String(idx + 1).padStart(2, "0")}_${safeFilename(base)}_${msToFfmpegTime(p.clipStartMs).replace(/[:.]/g, "-")}.mp4`;
    return {
      id: `${querySlug}_${idx + 1}`,
      ...p,
      output: path.join(outputDir, outName),
    };
  });

  const manifestPath = path.join(
    outputDir,
    args.flatOut ? `manifest.${querySlug}.json` : "manifest.json",
  );
  if (args.writeManifest) {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ query: args.query, clips: manifest }, null, 2),
    );
  }

  console.log(`Found ${manifest.length} clip(s) for query "${args.query}".`);
  if (args.writeManifest) {
    console.log(`Manifest: ${manifestPath}`);
  }

  for (const c of manifest) {
    console.log("");
    console.log(`- sub:    ${c.subFile}`);
    console.log(`  video:  ${c.videoFile ?? "(missing: provide --video or --videosDir)"}`);
    console.log(`  range:  ${msToFfmpegTime(c.clipStartMs)} -> ${msToFfmpegTime(c.clipEndMs)}`);
    console.log(`  match:  ${msToFfmpegTime(c.matchStartMs)} -> ${msToFfmpegTime(c.matchEndMs)}`);
    console.log(`  text:   ${c.sentenceText}`);
    console.log(`  out:    ${c.output}`);
  }

  const missingVideo = manifest.some((m) => !m.videoFile);
  if (missingVideo) {
    console.log("");
    console.log("Some clips have no video mapped. Re-run with either:");
    console.log("- --video /path/to/episode.mp4 (single-video mode), OR");
    console.log("- --videosDir /path/to/videos (auto-matches by subtitle basename).");
    process.exit(args.dryRun ? 0 : 3);
  }

  if (args.dryRun) {
    console.log("");
    console.log("Dry run: not running ffmpeg.");
    process.exit(0);
  }

  for (const c of manifest) {
    runFfmpegExtract({
      input: c.videoFile,
      startMs: c.clipStartMs,
      endMs: c.clipEndMs,
      output: c.output,
      verbose: args.verbose,
    });
  }

  if (args.concat) {
    const stitched =
      args.concatOut ??
      (args.flatOut
        ? path.join(outputDir, `${querySlug}.mp4`)
        : path.join(outputDir, "stitched.mp4"));
    runFfmpegConcat({
      inputs: manifest.map((m) => m.output),
      output: stitched,
      listName: args.flatOut ? `.concat-${querySlug}.txt` : undefined,
      verbose: args.verbose,
    });
    console.log("");
    console.log(`Stitched video: ${stitched}`);

    if (args.concatOnly) {
      for (const m of manifest) {
        try {
          fs.unlinkSync(m.output);
        } catch (err) {
          if (args.verbose) console.warn(`Failed to delete ${m.output}: ${err}`);
        }
      }
    }
  }

  console.log("");
  console.log(`Done. Wrote ${manifest.length} clip(s) into: ${outputDir}`);
}

main();
