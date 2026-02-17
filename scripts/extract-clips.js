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
let kuromoji;
let wanakana;
let resvg;
let QRCode;
const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_EN_SUBS_DIR_EMBEDDED = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_DIR_LEGACY = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_DIR_EMBEDDED)
  ? DEFAULT_EN_SUBS_DIR_EMBEDDED
  : DEFAULT_EN_SUBS_DIR_LEGACY;
const DEFAULT_SUB_OFFSETS_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "sub-offsets.json",
);
const DEFAULT_WORD_LIST_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.first2000.json",
);

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
    subOffsetsFile: fs.existsSync(DEFAULT_SUB_OFFSETS_FILE) ? DEFAULT_SUB_OFFSETS_FILE : null,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : null,
    enLinePolicy: "best",
    rank: false,
    shuffle: false,
    shuffleSeed: null,
    shuffleTop: 0,
    candidatesIn: null,
    candidatesOut: null,
    printTop: 0,
    pick: null,
    replace: [],
    matchContains: null,
    decorate: false,
    wordList: fs.existsSync(DEFAULT_WORD_LIST_FILE) ? DEFAULT_WORD_LIST_FILE : null,
    meaning: null,
    highlightColor: "&H00D6FF&",
    sentenceGapMs: 800,
    maxSentenceItems: 8,
    clipFit: true,
    autoReplaceBad: true,
    maxJpChars: 34,
    maxEnChars: 84,
    maxJpLines: 2,
    maxEnLines: 2,
    maxJpCps: 16,
    maxEnCps: 20,
    enPolishModel: String(process.env.EN_POLISH_MODEL || "").trim(),
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
      case "clipFit":
        args.clipFit = true;
        break;
      case "noClipFit":
        args.clipFit = false;
        break;
      case "autoReplaceBad":
        args.autoReplaceBad = true;
        break;
      case "noAutoReplaceBad":
        args.autoReplaceBad = false;
        break;
      case "maxJpChars":
        args.maxJpChars = Number(value);
        takeNext();
        break;
      case "maxEnChars":
        args.maxEnChars = Number(value);
        takeNext();
        break;
      case "maxJpLines":
        args.maxJpLines = Number(value);
        takeNext();
        break;
      case "maxEnLines":
        args.maxEnLines = Number(value);
        takeNext();
        break;
      case "maxJpCps":
        args.maxJpCps = Number(value);
        takeNext();
        break;
      case "maxEnCps":
        args.maxEnCps = Number(value);
        takeNext();
        break;
      case "enPolishModel":
        args.enPolishModel = String(value || "").trim();
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
      case "subOffsetsFile":
        args.subOffsetsFile = value;
        takeNext();
        break;
      case "noSubOffsetsFile":
        args.subOffsetsFile = null;
        break;
      case "enSubsDir":
        args.enSubsDir = value;
        takeNext();
        break;
      case "enLinePolicy":
        args.enLinePolicy = String(value || "").trim().toLowerCase();
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "shuffle":
        args.shuffle = true;
        break;
      case "shuffleSeed":
        args.shuffleSeed = Number(value);
        takeNext();
        break;
      case "shuffleTop":
        args.shuffleTop = Number(value);
        takeNext();
        break;
      case "candidatesIn":
        args.candidatesIn = value;
        takeNext();
        break;
      case "candidatesOut":
        args.candidatesOut = value;
        takeNext();
        break;
      case "printTop":
        args.printTop = Number(value);
        takeNext();
        break;
      case "pick":
        args.pick = String(value);
        takeNext();
        break;
      case "replace":
        args.replace.push(String(value));
        takeNext();
        break;
      case "matchContains":
        args.matchContains = String(value ?? "").trim() || null;
        takeNext();
        break;
      case "decorate":
        args.decorate = true;
        break;
      case "wordList":
        args.wordList = value;
        takeNext();
        break;
      case "meaning":
        args.meaning = value;
        takeNext();
        break;
      case "highlightColor":
        args.highlightColor = value;
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
  --videosDir           Directory where videos live (recursive scan, auto-match by basename)
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
  --subOffsetsFile      JSON map of per-episode/per-season offsets (default: ${DEFAULT_SUB_OFFSETS_FILE} if present)
  --noSubOffsetsFile    Disable reading offsets file
  --enSubsDir           English subtitle directory (default: ${DEFAULT_EN_SUBS_DIR} if present)
  --enLinePolicy        EN cue selection policy: "best" (default), "nearest", or "merge"
  --rank                Rank candidates and pick the best scores instead of first matches
  --shuffle             Shuffle candidate selection order (after ranking/dedup)
  --shuffleSeed         Deterministic seed for --shuffle
  --shuffleTop          Only shuffle the first N candidates (0 = all)
  --candidatesIn        Read candidate pool JSON (array or {pool:[...]}) instead of subtitle scan
  --candidatesOut       Write candidates JSON (planned/pool/selected) to this file
  --printTop            Print the top N ranked candidates with scores (default: 0)
  --pick                Comma list of ranked candidate indices to use (1-based), e.g. "1,2,7,10"
  --replace             Replace selected slot with ranked candidate index, e.g. "3=11" or "last=14" (repeatable)
  --matchContains       Keep only matches where matched form contains this text (family filter)
  --decorate            Burn JP+EN subs with furigana/romaji and highlight the query
  --wordList            JSON list with fields {word, reading, romaji, meaning} for header/meaning lookup
  --meaning             Override meaning text in header and EN highlight
  --highlightColor      ASS color for highlight (BGR hex, e.g. &H00D6FF&)
  --sentenceGapMs       Max gap between subtitle items to still be the same sentence (default: 800)
  --maxSentenceItems    Max subtitle items to merge into a "sentence" (default: 8)
  --clipFit             Trim JP/EN to clip-fit clauses around the matched word (default: on)
  --noClipFit           Disable clip-fit trimming stage
  --autoReplaceBad      Auto-replace bad picks using next good ranked candidates (default: on)
  --noAutoReplaceBad    Disable auto replacement
  --maxJpChars          Readability gate: max JP chars after fit (default: 34)
  --maxEnChars          Readability gate: max EN chars after fit (default: 84)
  --maxJpLines          Readability gate: max JP lines after wrap (default: 2)
  --maxEnLines          Readability gate: max EN lines after wrap (default: 2)
  --maxJpCps            Readability gate: max JP chars/sec (default: 16)
  --maxEnCps            Readability gate: max EN chars/sec (default: 20)
  --enPolishModel       Optional Ollama model to shorten EN as fallback
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

function looksLikeAssVectorDrawing(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return false;
  // ASS drawing commands are numeric paths like: "m 60 0 b 45 21 ..."
  return /^[mnlbspc0-9.\-\s]+$/.test(s);
}

function cleanSubtitleText(t) {
  const normalized = String(t ?? "")
    .replace(/\\N/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>\n]*>/g, "")
    // Guard against malformed tag debris such as: face="..." size="78">
    .replace(/(?:^|\s)(?:[a-z][a-z0-9_-]*\s*=\s*"[^"]*"\s*)+>/gi, " ")
    .replace(/[<>]/g, " ");

  const lines = normalized
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !looksLikeAssVectorDrawing(x));

  return lines.join(" ").trim();
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
    const text = cleanSubtitleText(textLines.join("\n"));
    if (!text) continue;
    items.push({ startMs, endMs, text });
  }
  return items;
}

function cleanAssText(t) {
  return cleanSubtitleText(t);
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

function normalizeEpisodeToken(key) {
  if (!key) return null;
  const m = String(key).match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function normalizeSeasonToken(key) {
  if (!key) return null;
  const m = String(key).match(/s\s*0*(\d{1,2})/i);
  if (!m) return null;
  return `s${Number(m[1])}`;
}

function normalizeSubOffsets(raw) {
  const out = {
    defaultMs: 0,
    jpDefaultMs: null,
    enDefaultMs: null,
    byEpisode: new Map(),
    bySeason: new Map(),
    jpByEpisode: new Map(),
    jpBySeason: new Map(),
    enByEpisode: new Map(),
    enBySeason: new Map(),
  };
  if (!raw || typeof raw !== "object") return out;

  const pushEpisode = (bucket, k, v) => {
    const key = normalizeEpisodeToken(k);
    if (!key) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    bucket.set(key, n);
  };
  const pushSeason = (bucket, k, v) => {
    const key = normalizeSeasonToken(k);
    if (!key) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    bucket.set(key, n);
  };

  if (Number.isFinite(Number(raw.default))) out.defaultMs = Number(raw.default);
  if (Number.isFinite(Number(raw.defaultMs))) out.defaultMs = Number(raw.defaultMs);
  if (Number.isFinite(Number(raw.jpDefaultMs))) out.jpDefaultMs = Number(raw.jpDefaultMs);
  if (Number.isFinite(Number(raw.enDefaultMs))) out.enDefaultMs = Number(raw.enDefaultMs);

  const episodeBuckets = [
    [out.byEpisode, raw.byEpisode],
    [out.byEpisode, raw.episodes],
    [out.jpByEpisode, raw.jpByEpisode],
    [out.jpByEpisode, raw.jpEpisodes],
    [out.enByEpisode, raw.enByEpisode],
    [out.enByEpisode, raw.enEpisodes],
  ];
  for (const bucket of episodeBuckets) {
    const [dest, src] = bucket;
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) pushEpisode(dest, k, v);
  }

  const seasonBuckets = [
    [out.bySeason, raw.bySeason],
    [out.bySeason, raw.seasons],
    [out.jpBySeason, raw.jpBySeason],
    [out.jpBySeason, raw.jpSeasons],
    [out.enBySeason, raw.enBySeason],
    [out.enBySeason, raw.enSeasons],
  ];
  for (const bucket of seasonBuckets) {
    const [dest, src] = bucket;
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) pushSeason(dest, k, v);
  }

  // Also support flat maps: { "s4e30": 120, "s4": 80 }.
  for (const [k, v] of Object.entries(raw)) {
    if (
      [
        "default",
        "defaultMs",
        "jpDefaultMs",
        "enDefaultMs",
        "byEpisode",
        "episodes",
        "jpByEpisode",
        "jpEpisodes",
        "enByEpisode",
        "enEpisodes",
        "bySeason",
        "seasons",
        "jpBySeason",
        "jpSeasons",
        "enBySeason",
        "enSeasons",
        "updatedAt",
      ].includes(k)
    ) {
      continue;
    }
    if (normalizeEpisodeToken(k)) pushEpisode(out.byEpisode, k, v);
    else if (normalizeSeasonToken(k)) pushSeason(out.bySeason, k, v);
  }

  return out;
}

function loadSubOffsets(filePath, verbose) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    if (verbose) console.log(`Sub offsets file not found, ignoring: ${filePath}`);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return normalizeSubOffsets(raw);
}

function getTrackOffsetFromMaps({
  subOffsets,
  episodeToken,
  seasonToken,
  track,
}) {
  const trackEpisodeMap = track === "en" ? subOffsets.enByEpisode : subOffsets.jpByEpisode;
  const trackSeasonMap = track === "en" ? subOffsets.enBySeason : subOffsets.jpBySeason;
  const trackDefault = track === "en" ? subOffsets.enDefaultMs : subOffsets.jpDefaultMs;

  if (trackEpisodeMap.has(episodeToken)) return trackEpisodeMap.get(episodeToken);
  if (subOffsets.byEpisode.has(episodeToken)) return subOffsets.byEpisode.get(episodeToken);
  if (trackSeasonMap.has(seasonToken)) return trackSeasonMap.get(seasonToken);
  if (subOffsets.bySeason.has(seasonToken)) return subOffsets.bySeason.get(seasonToken);
  if (Number.isFinite(trackDefault)) return trackDefault;
  return subOffsets.defaultMs || 0;
}

function getSubOffsetForFile(subFile, subOffsets, track = "jp") {
  if (!subOffsets) return 0;
  const info = extractEpisodeKeyFromName(subFile);
  if (!info || !Number.isFinite(info.season) || !Number.isFinite(info.episode)) {
    const trackDefault = track === "en" ? subOffsets.enDefaultMs : subOffsets.jpDefaultMs;
    if (Number.isFinite(trackDefault)) return trackDefault;
    return subOffsets.defaultMs || 0;
  }
  const episodeToken = `s${info.season}e${info.episode}`;
  const seasonToken = `s${info.season}`;
  return getTrackOffsetFromMaps({
    subOffsets,
    episodeToken,
    seasonToken,
    track,
  });
}

function buildSeasonOffsets(subFiles) {
  const seasonMax = new Map();
  for (const file of subFiles) {
    const info = extractEpisodeKeyFromName(file);
    if (!info || !Number.isFinite(info.season) || !Number.isFinite(info.episode)) continue;
    const prev = seasonMax.get(info.season) || 0;
    if (info.episode > prev) seasonMax.set(info.season, info.episode);
  }
  const seasons = [...seasonMax.keys()].sort((a, b) => a - b);
  const offsets = new Map();
  let acc = 0;
  for (const s of seasons) {
    offsets.set(s, acc);
    acc += seasonMax.get(s) || 0;
  }
  return offsets;
}

function getGlobalEpisodeNumber(info, seasonOffsets) {
  if (!info || !seasonOffsets) return null;
  if (!Number.isFinite(info.season) || !Number.isFinite(info.episode)) return null;
  if (!seasonOffsets.has(info.season)) return null;
  return seasonOffsets.get(info.season) + info.episode;
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

function getEnglishItemsForSubFile(subFile, enIndex, enCache, seasonOffsets, enOffsetMs) {
  if (!enIndex || enIndex.size === 0) return null;
  const info = extractEpisodeKeyFromName(subFile);
  if (!info) return null;

  let enFile = null;
  // Prefer exact SxxEyy match if present.
  if (enIndex.has(info.key)) enFile = enIndex.get(info.key);

  // If EN files are globally numbered E01..E89, map JP sXeY to cumulative episode number.
  if (!enFile) {
    const globalEpisode = getGlobalEpisodeNumber(info, seasonOffsets);
    if (Number.isFinite(globalEpisode)) {
      const globalKey = `E${String(globalEpisode).padStart(2, "0")}`;
      if (enIndex.has(globalKey)) enFile = enIndex.get(globalKey);
    }
  }

  // Last fallback: local episode number only (useful for single-season sets).
  if (!enFile && info.episode != null) {
    const localKey = `E${String(info.episode).padStart(2, "0")}`;
    if (enIndex.has(localKey)) enFile = enIndex.get(localKey);
  }
  if (!enFile) return null;

  const cacheKey = `${enFile}::${Number(enOffsetMs || 0)}`;
  if (enCache.has(cacheKey)) return enCache.get(cacheKey);
  const items = applyOffset(parseSubsFile(enFile), enOffsetMs);
  enCache.set(cacheKey, items);
  return items;
}

function normalizeTextForScoring(t) {
  if (!t) return "";
  return t
    .replace(/^[\s　]*[（(][^）)]*[）)]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSentenceKey(text) {
  // Collapse cosmetic differences so repeated subtitle lines are treated as duplicates.
  return normalizeTextForScoring(text)
    .replace(/[\s　]+/g, "")
    .replace(/[。！？!?…〜~ー―—・、,，.]/g, "")
    .toLowerCase();
}

function uniqueBySentence(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = normalizeSentenceKey(item.sentenceText);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

function seedFromValue(value) {
  if (Number.isFinite(Number(value))) {
    return Number(value) >>> 0;
  }
  const str = String(value ?? "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray(items, seed) {
  const out = [...items];
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toCandidateRecord(item) {
  return {
    candidateIndex: Number.isInteger(Number(item.candidateIndex))
      ? Number(item.candidateIndex)
      : null,
    subFile: item.subFile,
    videoFile: item.videoFile ?? null,
    clipStartMs: item.clipStartMs,
    clipEndMs: item.clipEndMs,
    matchText: item.matchText || "",
    matchStartMs: item.matchStartMs,
    matchEndMs: item.matchEndMs,
    sentenceText: item.sentenceText,
    enText: item.enText,
    score: item.score,
    gateReasons: Array.isArray(item.gateReasons) ? [...item.gateReasons] : [],
    gateMeta: item.gateMeta || null,
    replacedFrom: Number.isInteger(Number(item.replacedFrom))
      ? Number(item.replacedFrom)
      : null,
  };
}

function writeJsonFile(filePath, value) {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2));
}

function normalizeExternalCandidate(raw, idx) {
  const subFile = String(raw?.subFile || "").trim();
  const videoFile = String(raw?.videoFile || "").trim();
  const clipStartMs = Number(raw?.clipStartMs);
  const clipEndMs = Number(raw?.clipEndMs);
  const matchStartMsRaw = Number(raw?.matchStartMs);
  const matchEndMsRaw = Number(raw?.matchEndMs);
  const sentenceText = String(raw?.sentenceText || raw?.jpText || "").trim();
  const enText = String(raw?.enText || "").trim();

  if (!subFile || !videoFile || !Number.isFinite(clipStartMs) || !Number.isFinite(clipEndMs)) {
    throw new Error(`Bad external candidate #${idx}: missing sub/video/time fields.`);
  }
  if (clipEndMs <= clipStartMs) {
    throw new Error(`Bad external candidate #${idx}: clipEndMs <= clipStartMs.`);
  }
  if (!sentenceText) {
    throw new Error(`Bad external candidate #${idx}: sentence text is empty.`);
  }

  const matchStartMs = Number.isFinite(matchStartMsRaw) ? matchStartMsRaw : clipStartMs;
  const matchEndMs = Number.isFinite(matchEndMsRaw) ? matchEndMsRaw : clipEndMs;

  return {
    subFile,
    videoFile,
    clipStartMs,
    clipEndMs,
    matchText: String(raw?.matchText || "").trim(),
    matchStartMs,
    matchEndMs,
    sentenceText,
    enText,
    score: Number.isFinite(Number(raw?.score)) ? Number(raw.score) : 0,
  };
}

function loadCandidatesIn(filePath) {
  const abs = path.resolve(String(filePath || ""));
  if (!abs || !fs.existsSync(abs)) {
    throw new Error(`--candidatesIn not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.pool) ? parsed.pool : [];
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error(`--candidatesIn has no candidates: ${filePath}`);
  }
  return rawList.map((raw, idx) => normalizeExternalCandidate(raw, idx + 1));
}

function parseIndexToken(raw, label) {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${label} index "${raw}". Use a 1-based positive integer.`);
  }
  return n;
}

function parsePickList(pickSpec) {
  const tokens = String(pickSpec || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`--pick is empty. Example: --pick "1,2,5,7"`);
  }
  return tokens.map((t) => parseIndexToken(t, "pick"));
}

function applyReplaceRules(selected, pool, replaceSpecs) {
  if (!replaceSpecs || replaceSpecs.length === 0) return selected;
  const out = [...selected];
  for (const spec of replaceSpecs) {
    const [lhsRaw, rhsRaw] = String(spec).split("=");
    const lhs = String(lhsRaw || "").trim().toLowerCase();
    const rhs = String(rhsRaw || "").trim();
    if (!lhs || !rhs) {
      throw new Error(`Bad --replace "${spec}". Use "3=11" or "last=14".`);
    }
    const srcPos = parseIndexToken(rhs, "replace source");
    const src = pool[srcPos - 1];
    if (!src) {
      throw new Error(`--replace "${spec}" points to missing source #${srcPos}.`);
    }

    let targetIdx = -1;
    if (lhs === "last") {
      if (out.length === 0) throw new Error(`Cannot use --replace "${spec}" with empty selection.`);
      targetIdx = out.length - 1;
    } else {
      const targetPos = parseIndexToken(lhs, "replace target");
      targetIdx = targetPos - 1;
      if (targetIdx >= out.length) {
        throw new Error(
          `--replace "${spec}" target #${targetPos} is out of range (selected=${out.length}).`,
        );
      }
    }
    out[targetIdx] = src;
  }

  const seen = new Set();
  for (const item of out) {
    const key = normalizeSentenceKey(item.sentenceText);
    if (!key) continue;
    if (seen.has(key)) {
      throw new Error(
        `--replace created duplicate sentence "${item.sentenceText}". Choose a different source index.`,
      );
    }
    seen.add(key);
  }
  return out;
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

  const enClean = normalizeEnglishText(enText);
  if (enClean.length > 0) score += 8;
  else score -= 6;

  if (enClean.length > 0 && durationMs > 0) {
    const cps = enClean.length / (durationMs / 1000);
    // Extremely high chars/sec usually means neighboring EN cues leaked into this clip.
    if (cps > 24) score -= 8;
    else if (cps > 20) score -= 4;
  }

  if (/^\s*[-–—]/.test(enClean)) score -= 2;
  if (/^\s*\[[^\]]+\]/.test(enClean)) score -= 2;

  return Math.round(score * 10) / 10;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

function normalizeEnglishText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeJapaneseText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function splitClausesWithSpans(text, kind = "jp") {
  const src = String(text || "").trim();
  if (!src) return [];
  const isDelimiter =
    kind === "en"
      ? (ch) => /[.!?;:,，、]/.test(ch)
      : (ch) => /[。！？!?…、，,;；:：]/.test(ch);
  const out = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (!isDelimiter(src[i])) continue;
    const end = i + 1;
    const piece = src.slice(start, end).trim();
    if (piece) out.push({ text: piece, start, end });
    start = end;
  }
  if (start < src.length) {
    const piece = src.slice(start).trim();
    if (piece) out.push({ text: piece, start, end: src.length });
  }
  if (out.length === 0) out.push({ text: src, start: 0, end: src.length });
  return out;
}

function pickClauseNearAnchor(clauses, anchorIdx, minChars = 6) {
  if (!Array.isArray(clauses) || clauses.length === 0) return "";
  let idx = clauses.findIndex((c) => anchorIdx >= c.start && anchorIdx < c.end);
  if (idx < 0) {
    idx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < clauses.length; i++) {
      const mid = (clauses[i].start + clauses[i].end) / 2;
      const d = Math.abs(mid - anchorIdx);
      if (d < bestDist) {
        bestDist = d;
        idx = i;
      }
    }
  }
  let left = idx;
  let right = idx;
  let merged = clauses[idx].text.trim();
  const countChars = (s) => Array.from(String(s || "").replace(/\s+/g, "")).length;
  while (countChars(merged) < minChars && (left > 0 || right < clauses.length - 1)) {
    const canLeft = left > 0;
    const canRight = right < clauses.length - 1;
    if (canLeft && !canRight) {
      left--;
    } else if (!canLeft && canRight) {
      right++;
    } else {
      const leftLen = countChars(clauses[left - 1].text);
      const rightLen = countChars(clauses[right + 1].text);
      if (rightLen >= leftLen) right++;
      else left--;
    }
    merged = clauses
      .slice(left, right + 1)
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return merged;
}

function trimClauseEdges(text, kind = "jp") {
  let s = String(text || "").trim();
  if (!s) return s;
  if (kind === "en") {
    s = s.replace(/^[,;:.\-–—\s]+/, "");
    s = s.replace(/[,;:\-–—\s]+$/, "");
    return s.trim();
  }
  s = s.replace(/^[、。！？!?…・\s]+/, "");
  s = s.replace(/[、。！？!?…・\s]+$/, "");
  return s.trim();
}

function wrapTextByUnits(text, maxUnits, kind = "jp") {
  const src = String(text || "").trim();
  if (!src) return [];
  const lines = [];
  if (kind === "en") {
    const words = src.split(/\s+/).filter(Boolean);
    let line = "";
    let units = 0;
    for (const w of words) {
      const add = line ? ` ${w}` : w;
      const addUnits = measureUnits(add);
      if (line && units + addUnits > maxUnits) {
        lines.push(line);
        line = w;
        units = measureUnits(w);
      } else {
        line += add;
        units += addUnits;
      }
    }
    if (line) lines.push(line.trim());
    return lines;
  }
  let line = "";
  let units = 0;
  for (const ch of Array.from(src)) {
    const u = charUnits(ch);
    if (line && units + u > maxUnits) {
      lines.push(line);
      line = ch;
      units = u;
    } else {
      line += ch;
      units += u;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textCps(charCount, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return charCount / (durationMs / 1000);
}

function detectFragment(text, kind = "jp") {
  const s = String(text || "").trim();
  if (!s) return false;
  if (kind === "en") {
    return (
      /^[,;:.\-–—]/.test(s) ||
      /^\s*(as well as|as|while|which|that)\b/i.test(s) ||
      /\b(and|but|or|so|then|because)\s*$/i.test(s) ||
      /^\s*(and|but|or|so|then|because)\b/i.test(s)
    );
  }
  return /^[、。！？!?…・]/.test(s) || /[、・]$/.test(s);
}

function detectTrailing(text, kind = "jp") {
  const s = String(text || "").trim();
  if (!s) return false;
  if (kind === "en") {
    return (
      /[,;:\-–—]$/.test(s) ||
      /\b(and|but|or|so|then)\s*$/i.test(s) ||
      /\b(is|are|was|were|be|been|being|to|of|that|which|who|when|where|if|because|as|than)\s*$/i.test(s)
    );
  }
  return /[、・]$/.test(s) || /(けど|から|ので)$/.test(s);
}

function extractKanji(text) {
  return Array.from(String(text || ""))
    .filter((ch) => isKanjiChar(ch))
    .join("");
}

function hasSenseMatchByLemma(tokenizer, jpText, query, matcher) {
  if (!tokenizer) return true;
  const source = normalizeJapaneseText(jpText);
  if (!source) return false;
  const queryText = String(query || "").trim();
  const forms = new Set([queryText, ...(matcher?.forms || [])].map((x) => String(x || "").trim()));
  forms.delete("");
  const queryKanji = extractKanji(queryText);
  const tokens = tokenizer.tokenize(source);
  for (const t of tokens) {
    const surf = String(t?.surface_form || "").trim();
    const base = String(t?.basic_form && t.basic_form !== "*" ? t.basic_form : surf).trim();
    const cand = [surf, base];
    for (const v of cand) {
      if (!v) continue;
      if (forms.has(v)) {
        if (!queryKanji) return true;
        const vKanji = extractKanji(v);
        if (vKanji && (vKanji.includes(queryKanji) || queryKanji.includes(vKanji))) return true;
      }
    }
  }
  return false;
}

function tokenizeWithSpans(tokenizer, text) {
  const src = String(text || "");
  if (!tokenizer || !src) return [];
  const tokens = tokenizer.tokenize(src);
  let cursor = 0;
  return tokens.map((t) => {
    const surface = String(t?.surface_form || "");
    const start = cursor;
    const end = start + surface.length;
    cursor = end;
    return {
      ...t,
      surface,
      start,
      end,
    };
  });
}

function isJpConnectorToken(tok) {
  const surf = String(tok?.surface || tok?.surface_form || "").trim();
  if (!surf) return false;
  const p = String(tok?.pos || "").trim();
  const p1 = String(tok?.pos_detail_1 || "").trim();
  const connectorForms = new Set([
    "が",
    "けど",
    "けれど",
    "けれども",
    "から",
    "ので",
    "のに",
    "かつ",
    "そして",
    "しかし",
    "だが",
    "また",
  ]);
  if (!connectorForms.has(surf)) return false;
  if (!p) return true;
  return (
    p === "助詞" ||
    p === "接続詞" ||
    p1.includes("接続") ||
    p1.includes("並立") ||
    p1.includes("終助詞")
  );
}

function trimJapaneseAroundMatchWindow(rawJp, anchorStart, anchorEnd, tokenizer) {
  const src = normalizeJapaneseText(rawJp);
  if (!src || !tokenizer) return "";
  const spans = tokenizeWithSpans(tokenizer, src);
  if (spans.length === 0) return "";

  let first = spans.findIndex((t) => t.end > anchorStart && t.start < anchorEnd);
  if (first < 0) {
    first = 0;
    let bestDist = Infinity;
    for (let i = 0; i < spans.length; i++) {
      const mid = (spans[i].start + spans[i].end) / 2;
      const d = Math.abs(mid - (anchorStart + anchorEnd) / 2);
      if (d < bestDist) {
        bestDist = d;
        first = i;
      }
    }
  }
  let last = first;
  for (let i = first; i < spans.length; i++) {
    if (spans[i].start < anchorEnd) last = i;
    else break;
  }

  let segStart = 0;
  let segEnd = src.length;

  for (const t of spans) {
    if (!isJpConnectorToken(t)) continue;
    if (t.end <= anchorStart && t.end > segStart) {
      segStart = t.end;
    } else if (t.start >= anchorEnd && t.start < segEnd) {
      segEnd = t.start;
      break;
    }
  }

  for (let i = anchorStart - 1; i >= segStart; i--) {
    if (/[。！？!?…、，,;；:：]/.test(src[i])) {
      segStart = i + 1;
      break;
    }
  }
  for (let i = anchorEnd; i < segEnd; i++) {
    if (/[。！？!?…、，,;；:：]/.test(src[i])) {
      segEnd = i;
      break;
    }
  }

  if (segEnd <= segStart) return "";
  let segment = trimClauseEdges(src.slice(segStart, segEnd), "jp");
  if (Array.from(segment).length > 20) {
    // Soft fallback: keep more local context around the match if still too long.
    const focusLeftIdx = Math.max(0, first - 4);
    const focusRightIdx = Math.min(spans.length - 1, last + 5);
    const focusStart = Math.max(segStart, spans[focusLeftIdx].start);
    const focusEnd = Math.min(segEnd, spans[focusRightIdx].end);
    const focused = trimClauseEdges(src.slice(focusStart, focusEnd), "jp");
    if (Array.from(focused).length >= 6) {
      segment = focused;
    }
  }
  return segment;
}

function clipFitCandidateText(item, args, fitCtx) {
  const rawJp = normalizeJapaneseText(item.sentenceText || "");
  const rawEn = normalizeEnglishText(item.enText || "");
  if (!rawJp) {
    return {
      jpText: String(item.sentenceText || ""),
      enText: rawEn,
      fitMeta: { applied: false },
    };
  }

  const matchTerm = String(item.matchText || "").trim();
  const anchors = Array.from(
    new Set(
      [matchTerm, args.query, ...(fitCtx?.matcher?.forms || [])]
        .map((x) => normalizeJapaneseText(String(x || "")))
        .filter(Boolean),
    ),
  );
  let anchorIdx = -1;
  let anchorLen = 0;
  for (const a of anchors) {
    const idx = rawJp.indexOf(a);
    if (idx >= 0) {
      anchorIdx = idx;
      anchorLen = a.length;
      break;
    }
  }
  if (anchorIdx < 0) {
    anchorIdx = Math.floor(rawJp.length / 2);
    anchorLen = 1;
  }
  const ratio = Math.max(0, Math.min(1, (anchorIdx + anchorLen / 2) / Math.max(1, rawJp.length)));

  const jpClauses = splitClausesWithSpans(rawJp, "jp");
  const enClauses = splitClausesWithSpans(rawEn, "en");

  const windowJp = trimJapaneseAroundMatchWindow(
    rawJp,
    anchorIdx,
    anchorIdx + Math.max(1, anchorLen),
    fitCtx?.tokenizer || null,
  );
  let jpText = windowJp || pickClauseNearAnchor(jpClauses, anchorIdx, 6);
  if (!jpText) jpText = rawJp;
  jpText = trimClauseEdges(jpText, "jp");

  let enText = rawEn;
  if (enClauses.length > 0) {
    const enAnchor = Math.round(ratio * Math.max(0, rawEn.length - 1));
    enText = pickClauseNearAnchor(enClauses, enAnchor, 10) || rawEn;
    enText = trimClauseEdges(enText, "en");
  }

  return {
    jpText: jpText || rawJp,
    enText: enText || "",
    fitMeta: {
      applied: true,
      jpRatio: ratio,
      jpClauses: jpClauses.length,
      enClauses: enClauses.length,
    },
  };
}

function evaluateCandidateQuality(item, args, gateCtx) {
  const reasons = [];
  const durationMs = Math.max(1, Number(item.clipEndMs) - Number(item.clipStartMs));
  const jpText = normalizeJapaneseText(item.sentenceText || "");
  const enText = normalizeEnglishText(item.enText || "");
  const jpChars = Array.from(jpText).length;
  const enChars = Array.from(enText.replace(/\s+/g, "")).length;
  const queryChars = Array.from(normalizeJapaneseText(args.query || "")).length;
  const jpCps = textCps(jpChars, durationMs);
  const enCps = textCps(enChars, durationMs);
  const jpLines = wrapTextByUnits(jpText, 18, "jp");
  const enLines = wrapTextByUnits(enText, 34, "en");

  if (!hasSenseMatchByLemma(gateCtx?.tokenizer || null, jpText, args.query, gateCtx?.matcher)) {
    reasons.push("wrong_sense");
  }
  if (enChars === 0) reasons.push("missing_en");
  if (jpChars < 8 || (queryChars > 0 && jpChars <= queryChars + 1)) reasons.push("fragment");
  if (enChars > 0 && enChars < 8) reasons.push("fragment");
  if (detectFragment(jpText, "jp") || detectFragment(enText, "en")) reasons.push("fragment");
  if (detectTrailing(jpText, "jp") || detectTrailing(enText, "en")) reasons.push("trailing");

  const overflow =
    jpChars > args.maxJpChars ||
    enChars > args.maxEnChars ||
    jpLines.length > args.maxJpLines ||
    enLines.length > args.maxEnLines ||
    jpCps > args.maxJpCps ||
    enCps > args.maxEnCps;
  if (overflow) reasons.push("overflow");

  return {
    ok: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    meta: {
      durationMs,
      jpChars,
      enChars,
      jpCps: Number(jpCps.toFixed(2)),
      enCps: Number(enCps.toFixed(2)),
      jpLines: jpLines.length,
      enLines: enLines.length,
    },
  };
}

function polishEnglishWithOllama({ model, enText, jpText, query }) {
  const m = String(model || "").trim();
  const src = normalizeEnglishText(enText);
  if (!m || !src) return "";
  const prompt = [
    "Rewrite this English subtitle into ONE short natural clause.",
    "Rules:",
    "- Keep the original meaning.",
    "- No trailing continuation fragments.",
    "- Max 70 characters.",
    "- Return only the rewritten line, no quotes or explanations.",
    `Japanese: ${jpText}`,
    `Target word: ${query}`,
    `English: ${src}`,
  ].join("\n");
  const res = spawnSync("ollama", ["run", m, prompt], {
    encoding: "utf8",
    timeout: 25000,
    maxBuffer: 1024 * 1024 * 8,
  });
  if (res.status !== 0) return "";
  const out = String(res.stdout || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)[0];
  if (!out) return "";
  return normalizeEnglishText(out).replace(/^["'`]|["'`]$/g, "");
}

function fitAndGateCandidate(item, args, gateCtx) {
  let cand = { ...item };
  const fit = args.clipFit ? clipFitCandidateText(cand, args, gateCtx) : null;
  if (fit) {
    cand.sentenceText = fit.jpText;
    cand.enText = fit.enText;
    cand.fitMeta = fit.fitMeta;
  }
  let quality = evaluateCandidateQuality(cand, args, gateCtx);

  if (
    args.enPolishModel &&
    cand.enText &&
    quality.reasons.some((r) => r === "overflow" || r === "fragment" || r === "trailing")
  ) {
    const polished = polishEnglishWithOllama({
      model: args.enPolishModel,
      enText: cand.enText,
      jpText: cand.sentenceText,
      query: args.query,
    });
    if (polished) {
      const withPolish = { ...cand, enText: polished, enTextPolished: true };
      const q2 = evaluateCandidateQuality(withPolish, args, gateCtx);
      if (
        q2.reasons.length < quality.reasons.length ||
        (q2.ok && !quality.ok)
      ) {
        cand = withPolish;
        quality = q2;
      }
    }
  }

  cand.gateReasons = quality.reasons;
  cand.gateMeta = quality.meta;
  return { candidate: cand, quality };
}

function applyQualityGatesAndAutoReplace(selected, pool, args, gateCtx) {
  if (!Array.isArray(selected) || selected.length === 0) {
    return { selected: [], audit: [] };
  }
  const out = selected.map((x) => ({ ...x }));
  const used = new Set(out.map((x) => Number(x.candidateIndex)).filter((n) => Number.isInteger(n)));
  const audit = [];

  for (let i = 0; i < out.length; i++) {
    const slot = i + 1;
    const current = out[i];
    const currentEval = fitAndGateCandidate(current, args, gateCtx);
    out[i] = currentEval.candidate;
    const fromIdx = Number(current.candidateIndex) || null;
    if (currentEval.quality.ok || !args.autoReplaceBad) {
      audit.push({
        slot,
        kept: true,
        from: fromIdx,
        to: Number(out[i].candidateIndex) || fromIdx,
        reasons: currentEval.quality.reasons,
      });
      continue;
    }

    let replacement = null;
    for (const cand of pool) {
      const idx = Number(cand.candidateIndex);
      if (!Number.isInteger(idx) || used.has(idx)) continue;
      const ev = fitAndGateCandidate(cand, args, gateCtx);
      if (!ev.quality.ok) continue;
      replacement = ev;
      break;
    }

    if (replacement) {
      const toIdx = Number(replacement.candidate.candidateIndex) || null;
      if (fromIdx && used.has(fromIdx)) used.delete(fromIdx);
      if (toIdx) used.add(toIdx);
      replacement.candidate.replacedFrom = fromIdx;
      out[i] = replacement.candidate;
      audit.push({
        slot,
        kept: false,
        from: fromIdx,
        to: toIdx,
        reasons: currentEval.quality.reasons,
      });
    } else {
      audit.push({
        slot,
        kept: true,
        from: fromIdx,
        to: Number(out[i].candidateIndex) || fromIdx,
        reasons: currentEval.quality.reasons,
      });
    }
  }

  return { selected: out, audit };
}

function findEnglishForTime(enItems, startMs, endMs, opts = {}) {
  if (!enItems || enItems.length === 0) return "";
  const policy = String(opts.policy || "best").toLowerCase();
  const focusStartMs =
    Number.isFinite(Number(opts.focusStartMs)) ? Number(opts.focusStartMs) : startMs;
  const focusEndMs =
    Number.isFinite(Number(opts.focusEndMs)) ? Number(opts.focusEndMs) : endMs;
  const focusMidMs = (focusStartMs + focusEndMs) / 2;

  // "merge" keeps legacy behavior: all overlapping EN cues joined.
  if (policy === "merge") {
    const overlaps = [];
    for (const it of enItems) {
      const ov = overlapMs(startMs, endMs, it.startMs, it.endMs);
      if (ov > 0) overlaps.push({ item: it, ov });
    }
    if (overlaps.length > 0) {
      overlaps.sort((a, b) => b.ov - a.ov);
      const texts = overlaps.map((o) => normalizeEnglishText(o.item.text));
      return Array.from(new Set(texts)).join(" ");
    }
  }

  // Default path ("best"): choose one EN cue only, using overlap + focus proximity.
  const overlaps = [];
  for (const it of enItems) {
    const ov = overlapMs(startMs, endMs, it.startMs, it.endMs);
    if (ov <= 0) continue;
    const overlapRatio = ov / Math.max(1, it.endMs - it.startMs);
    const itMid = (it.startMs + it.endMs) / 2;
    const dist = Math.abs(itMid - focusMidMs);
    overlaps.push({
      item: it,
      score: overlapRatio * 100 - dist / 80,
    });
  }
  if (overlaps.length > 0) {
    overlaps.sort((a, b) => b.score - a.score);
    return normalizeEnglishText(overlaps[0].item.text);
  }

  const mid = policy === "nearest" ? focusMidMs : (startMs + endMs) / 2;
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
    return normalizeEnglishText(best.text);
  }
  return "";
}

function assEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}");
}

function highlightAss(text, match, colorTag, resetTag) {
  if (!match) return assEscape(text);
  const idx = text.indexOf(match);
  if (idx < 0) return assEscape(text);
  const prefix = text.slice(0, idx);
  const mid = text.slice(idx, idx + match.length);
  const suffix = text.slice(idx + match.length);
  return `${assEscape(prefix)}${colorTag}${assEscape(mid)}${resetTag}${assEscape(suffix)}`;
}

function highlightAssCaseInsensitive(text, match, colorTag, resetTag) {
  if (!match) return assEscape(text);
  const lowerText = text.toLowerCase();
  const lowerMatch = match.toLowerCase();
  const idx = lowerText.indexOf(lowerMatch);
  if (idx < 0) return assEscape(text);
  const prefix = text.slice(0, idx);
  const mid = text.slice(idx, idx + match.length);
  const suffix = text.slice(idx + match.length);
  return `${assEscape(prefix)}${colorTag}${assEscape(mid)}${resetTag}${assEscape(suffix)}`;
}

function buildTokenizer(dicPath) {
  if (!kuromoji) kuromoji = require("kuromoji");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function tokenizeReading(tokenizer, text) {
  const tokens = tokenizer.tokenize(text);
  const parts = tokens.map((t) => t.reading || t.surface_form || "");
  return parts;
}

function toHiragana(text) {
  if (!wanakana) wanakana = require("wanakana");
  return wanakana.toHiragana(text);
}

function toRomaji(text) {
  if (!wanakana) wanakana = require("wanakana");
  return wanakana.toRomaji(text);
}

function isKanaContinuationSurface(surface) {
  return /^[んンっッゃゅょャュョぁぃぅぇぉァィゥェォー]$/.test(surface);
}

function joinRomajiTokens(tokens, romajiTokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const surface = tokens[i]?.surface_form || "";
    const piece = String(romajiTokens[i] || "").trim();
    if (!piece) continue;
    if (out.length === 0) {
      out.push(piece);
      continue;
    }
    if (isKanaContinuationSurface(surface)) {
      out[out.length - 1] += piece;
      continue;
    }
    out.push(piece);
  }
  return out.join(" ");
}

function compactTextNoSpaces(text) {
  return String(text || "").replace(/\s+/g, "");
}

function buildTokenSpansBySurface(tokens) {
  let cursor = 0;
  return tokens.map((t) => {
    const surface = String(t?.surface_form || "");
    const start = cursor;
    const end = start + surface.length;
    cursor = end;
    return { start, end };
  });
}

function collectTextRanges(text, terms) {
  const source = compactTextNoSpaces(text);
  const ranges = [];
  for (const raw of terms || []) {
    const needle = compactTextNoSpaces(raw);
    if (!needle) continue;
    let from = 0;
    while (from < source.length) {
      const idx = source.indexOf(needle, from);
      if (idx < 0) break;
      ranges.push({ start: idx, end: idx + needle.length });
      from = idx + Math.max(1, needle.length);
    }
  }
  return ranges;
}

function tokenSpanHitsAnyRange(span, ranges) {
  if (!span || !Array.isArray(ranges) || ranges.length === 0) return false;
  return ranges.some((r) => span.start < r.end && span.end > r.start);
}

function normalizeMeaning(meaning) {
  if (!meaning) return "";
  const first = meaning.split(/[;,.]/)[0];
  return first.trim();
}

function normalizeMatchArray(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildQueryMatcher(query, wordEntry) {
  const canonical = String(query ?? "").trim();
  const fromWordList = wordEntry?.match || {};
  const forms = normalizeMatchArray([canonical, ...(fromWordList.forms || [])]);
  const exclude = normalizeMatchArray(fromWordList.exclude || []);
  return {
    query: canonical,
    forms,
    exclude,
  };
}

function findMatchInText(text, matcher) {
  const source = String(text || "");
  if (!source) return null;

  for (const blocked of matcher.exclude) {
    if (blocked && source.includes(blocked)) return null;
  }

  const matched = [];
  for (const form of matcher.forms) {
    if (!form) continue;
    const idx = source.indexOf(form);
    if (idx < 0) continue;
    matched.push({ matchText: form, index: idx, length: Array.from(form).length });
  }
  if (matched.length === 0) return null;

  const queryLen = Math.max(1, Array.from(matcher.query || "").length);
  const compactLimit = Math.max(4, queryLen + 4);
  const compact = matched.filter((x) => x.length <= compactLimit);
  const pool = compact.length > 0 ? compact : matched;
  pool.sort((a, b) => b.length - a.length || a.index - b.index);
  return { matchText: pool[0].matchText, index: pool[0].index };
}

function msToAssTime(ms) {
  const total = Math.max(0, ms);
  const cs = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildAss({
  durationMs,
  headerText,
  subsText,
  highlightColor,
}) {
  const end = msToAssTime(durationMs + 100);
  const header = assEscape(headerText);
  const subs = subsText;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Header,Hiragino Sans,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,8,40,40,30,1
Style: Subs,Hiragino Sans,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Header,,0,0,0,,${header}
Dialogue: 0,0:00:00.00,${end},Subs,,0,0,0,,${subs}
`;
}

function renderSvgToPng({ svg, output }) {
  if (!resvg) {
    resvg = require("@resvg/resvg-js");
  }
  const instance = new resvg.Resvg(svg);
  const pngData = instance.render().asPng();
  fs.writeFileSync(output, pngData);
}

function runFfmpegOverlay({ input, overlay, output, verbose }) {
  const args = [
    "-y",
    "-i",
    input,
    "-loop",
    "1",
    "-i",
    overlay,
    "-filter_complex",
    "[1:v][0:v]scale2ref=w=iw:h=ih[ovr][base];[base][ovr]overlay=0:0:format=auto",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
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
    throw new Error(`ffmpeg overlay failed for ${output}`);
  }
}

function getVideoDimensions(file) {
  const res = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    return { width: 1920, height: 1080 };
  }
  const [w, h] = String(res.stdout || "").trim().split("x").map(Number);
  if (!w || !h) return { width: 1920, height: 1080 };
  return { width: w, height: h };
}

function getMediaDurationSec(file) {
  const res = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return 0;
  const d = Number(String(res.stdout || "").trim());
  if (!Number.isFinite(d) || d <= 0) return 0;
  return d;
}

function runFfmpegAppendTailVideo({
  mainInput,
  tailInput,
  output,
  width,
  height,
  tailDurationSec,
  verbose,
}) {
  const filter = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0]`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v1]`,
    "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]",
    "[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]",
    "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
  ].join(";");

  const args = [
    "-y",
    "-i",
    mainInput,
    "-i",
    tailInput,
    "-f",
    "lavfi",
    "-t",
    String(tailDurationSec),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    output,
  ];
  if (verbose) console.log(["ffmpeg", ...args].join(" "));
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg append tail failed for ${output}`);
  }
}

function svgEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function svgHighlighted(text, match, highlightColor) {
  if (!match) return svgEscape(text);
  const idx = text.indexOf(match);
  if (idx < 0) return svgEscape(text);
  const prefix = svgEscape(text.slice(0, idx));
  const mid = svgEscape(text.slice(idx, idx + match.length));
  const suffix = svgEscape(text.slice(idx + match.length));
  return `${prefix}<tspan fill="${highlightColor}">${mid}</tspan>${suffix}`;
}

function svgHighlightedCaseInsensitive(text, match, highlightColor) {
  if (!match) return svgEscape(text);
  const lowerText = text.toLowerCase();
  const lowerMatch = match.toLowerCase();
  const idx = lowerText.indexOf(lowerMatch);
  if (idx < 0) return svgEscape(text);
  const prefix = svgEscape(text.slice(0, idx));
  const mid = svgEscape(text.slice(idx, idx + match.length));
  const suffix = svgEscape(text.slice(idx + match.length));
  return `${prefix}<tspan fill="${highlightColor}">${mid}</tspan>${suffix}`;
}

function isKanjiChar(ch) {
  return /[一-龯]/.test(ch);
}

function charUnits(ch) {
  if (/[A-Za-z0-9]/.test(ch)) return 0.6;
  if (isKanjiChar(ch)) return 1.0;
  if (/[ぁ-んァ-ン]/.test(ch)) return 1.0;
  return 0.8;
}

function measureUnits(text) {
  return Array.from(text).reduce((sum, ch) => sum + charUnits(ch), 0);
}

function layoutTokens(tokens, width, marginPx) {
  const gapUnits = 0.5;
  const tokenUnits = tokens.map((t) => Math.max(0.8, measureUnits(t.surface)));
  const totalUnits =
    tokenUnits.reduce((s, u) => s + u, 0) + gapUnits * Math.max(0, tokens.length - 1);
  const available = Math.max(1, width - marginPx * 2);
  const unitPx = available / Math.max(1, totalUnits);
  let cursor = marginPx;
  return tokens.map((t, i) => {
    const widthPx = tokenUnits[i] * unitPx;
    const centerX = cursor + widthPx / 2;
    cursor += widthPx + gapUnits * unitPx;
    return { ...t, centerX };
  });
}

function layoutTokensContinuous(tokens, width, marginPx) {
  const tokenUnits = tokens.map((t) => Math.max(0.8, measureUnits(t.surface)));
  const totalUnits = tokenUnits.reduce((s, u) => s + u, 0);
  const available = Math.max(1, width - marginPx * 2);
  const unitPx = available / Math.max(1, totalUnits);
  let cursor = marginPx;
  return tokens.map((t, i) => {
    const widthPx = tokenUnits[i] * unitPx;
    const centerX = cursor + widthPx / 2;
    cursor += widthPx;
    return { ...t, centerX, widthPx };
  });
}

function layoutTokensCentered(tokens, width, maxWidthPx, fontSizePx) {
  const tokenWidths = tokens.map((t) =>
    Math.max(fontSizePx * 0.8, measureUnits(t.surface) * fontSizePx),
  );
  const totalBaseWidthPx = tokenWidths.reduce((s, w) => s + w, 0);
  const scale = Math.min(1, maxWidthPx / Math.max(1, totalBaseWidthPx));
  const totalWidthPx = totalBaseWidthPx * scale;
  let cursor = (width - totalWidthPx) / 2;
  return tokens.map((t, i) => {
    const widthPx = tokenWidths[i] * scale;
    const centerX = cursor + widthPx / 2;
    cursor += widthPx;
    return { ...t, centerX, widthPx };
  });
}

function estimateTextWidthPx(text, fontSizePx) {
  const units = measureUnits(text);
  return units * fontSizePx * 0.6;
}

function loadPngDataUri(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const b64 = fs.readFileSync(filePath).toString("base64");
  if (!b64) return "";
  return `data:image/png;base64,${b64}`;
}

async function buildQrDataUri(url, sizePx) {
  if (!QRCode) QRCode = require("qrcode");
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: Math.round(sizePx),
    color: { dark: "#000000", light: "#FFFFFFFF" },
  });
}

function buildOverlaySvg({
  width,
  height,
  headerLines,
  enLine,
  jpTokens,
  furiganaTokens,
  romajiLine,
  logoDataUri,
  qrDataUri,
}) {
  const scale = height / 1080;
  const fontJP = "Hiragino Sans, Noto Sans CJK JP, Arial";
  const fontEN = "Helvetica Neue, Arial, sans-serif";
  const headerY = 110 * scale;
  const headerGap = 60 * scale;

  const enY = height - 280 * scale;
  const furiY = height - 230 * scale;
  const jpY = height - 170 * scale;
  const romajiY = height - 115 * scale;

  const headerSizeSmall = 30 * scale;
  const headerSizeBig = 64 * scale;
  const headerSizeMed = 36 * scale;

  const enSize = 34 * scale;
  const furiSize = 28 * scale;
  const jpSize = 46 * scale;
  const romajiSize = 28 * scale;
  const logoSize = 170 * scale;
  const brandPad = 20 * scale;
  const blockW = 440 * scale;
  const blockX = width - blockW - 20 * scale;
  const blockY = 18 * scale;
  const blockH = 280 * scale;
  const logoX = blockX + brandPad;
  const logoY = blockY + brandPad;
  const appNameX = logoX + logoSize + 16 * scale;
  const appNameY = logoY + 58 * scale;
  const subtitleY1 = appNameY + 44 * scale;
  const subtitleY2 = subtitleY1 + 30 * scale;
  const appToQrY = subtitleY2 + 34 * scale;
  const qrSize = 92 * scale;
  const qrX = blockX + blockW - brandPad - qrSize;
  const qrY = blockY + blockH - brandPad - qrSize;

  const headerSizes = headerLines.map((line, i) => ({
    line,
    size:
      line.size ??
      (i === 0 ? headerSizeSmall : i === 1 ? headerSizeBig : headerSizeMed),
    y: headerY + i * headerGap,
  }));
  const headerMaxWidth = headerSizes.reduce((max, h) => {
    const w = estimateTextWidthPx(h.line.text, h.size);
    return Math.max(max, w);
  }, 0);
  const headerPadX = 22 * scale;
  const headerPadY = 14 * scale;
  const headerTop = headerSizes[0]?.y ? headerSizes[0].y - headerSizes[0].size : 0;
  const headerBottom = headerSizes.at(-1)?.y ?? 0;
  const headerRect = headerSizes.length
    ? `<rect x="${width / 2 - (headerMaxWidth + headerPadX * 2) / 2}" y="${headerTop - headerPadY}" width="${headerMaxWidth + headerPadX * 2}" height="${(headerBottom - headerTop) + headerPadY * 2 + headerSizes.at(-1).size * 0.2}" rx="${12 * scale}" ry="${12 * scale}" fill="rgba(20,120,150,0.65)"/>`
    : "";

  const headerText = headerLines
    .map((line, i) => {
      const size =
        line.size ??
        (i === 0 ? headerSizeSmall : i === 1 ? headerSizeBig : headerSizeMed);
      const y = headerY + i * headerGap;
      const color = line.color ?? "#ffffff";
      const text = svgEscape(line.text);
      return `<text x="50%" y="${y}" text-anchor="middle" font-family="${fontJP}" font-size="${size}" font-weight="700" fill="${color}" stroke="#000000" stroke-width="2" paint-order="stroke fill">${text}</text>`;
    })
    .join("\n");

  const enText = enLine
    ? `<text x="50%" y="${enY}" text-anchor="middle" font-family="${fontEN}" font-size="${enSize}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill">${enLine}</text>`
    : "";

  const marginPx = width * 0.08;
  const maxTextWidthPx = width - marginPx * 2;
  const jpLayout = layoutTokensCentered(jpTokens, width, maxTextWidthPx, jpSize);

  const jpText = jpLayout
    .map((t) => {
      return `<text x="${t.centerX}" y="${jpY}" text-anchor="middle" font-family="${fontJP}" font-size="${jpSize}" font-weight="700" fill="${t.color ?? "#ffffff"}" stroke="#000000" stroke-width="3" paint-order="stroke fill">${svgEscape(t.surface)}</text>`;
    })
    .join("\n");
  const furiText = furiganaTokens
    .map((t, i) => {
      if (!t.text) return "";
      const x = jpLayout[i]?.centerX;
      if (!x) return "";
      return `<text x="${x}" y="${furiY}" text-anchor="middle" font-family="${fontJP}" font-size="${furiSize}" font-weight="700" fill="${t.color ?? "#ffffff"}" stroke="#000000" stroke-width="2" paint-order="stroke fill">${svgEscape(t.text)}</text>`;
    })
    .filter(Boolean)
    .join("\n");
  const romajiText = `<text x="50%" y="${romajiY}" text-anchor="middle" font-family="${fontEN}" font-size="${romajiSize}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="2" paint-order="stroke fill">${romajiLine}</text>`;
  const logoImage = logoDataUri
    ? `<image x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" href="${logoDataUri}" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  const cornerQr = qrDataUri
    ? `<image x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" href="${qrDataUri}" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  const brandBlock = `
  <rect x="${blockX}" y="${blockY}" width="${blockW}" height="${blockH}" rx="${14 * scale}" ry="${14 * scale}" fill="rgba(0,0,0,0.45)"/>
  <text x="${appNameX}" y="${appNameY}" text-anchor="start" font-family="${fontEN}" font-size="${52 * scale}" font-weight="800" fill="#ffffff" stroke="#000000" stroke-width="${1.6 * scale}" paint-order="stroke fill">Bundai</text>
  <text x="${appNameX}" y="${subtitleY1}" text-anchor="start" font-family="${fontEN}" font-size="${20 * scale}" font-weight="700" fill="#ffffff">Learn Japanese</text>
  <text x="${appNameX}" y="${subtitleY2}" text-anchor="start" font-family="${fontEN}" font-size="${20 * scale}" font-weight="700" fill="#ffffff">watching anime</text>
  <text x="${appNameX}" y="${appToQrY}" text-anchor="start" font-family="${fontEN}" font-size="${24 * scale}" font-weight="800" fill="#ffd900">App -&gt;</text>
  ${cornerQr}
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="transparent"/>
  ${brandBlock}
  ${logoImage}
  ${headerRect}
  ${headerText}
  ${enText}
  ${furiText}
  ${jpText}
  ${romajiText}
</svg>`;
}

function buildEndCardSvg({
  width,
  height,
  logoDataUri,
  qrDataUri,
  cardDataUri,
}) {
  if (cardDataUri) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#000000"/>
  <image x="0" y="0" width="${width}" height="${height}" href="${cardDataUri}" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
  }

  const scale = height / 1080;
  const fontEN = "Helvetica Neue, Arial, sans-serif";
  const logoSize = 270 * scale;
  const qrSize = 300 * scale;
  const centerX = width / 2;
  const topY = 130 * scale;
  const logoX = centerX - logoSize / 2;
  const qrX = centerX - qrSize / 2;
  const qrY = height - qrSize - 150 * scale;

  const logo = logoDataUri
    ? `<image x="${logoX}" y="${topY}" width="${logoSize}" height="${logoSize}" href="${logoDataUri}" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  const qr = qrDataUri
    ? `<image x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" href="${qrDataUri}" preserveAspectRatio="xMidYMid meet"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#071321"/>
      <stop offset="100%" stop-color="#0f2b44"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${width * 0.82}" cy="${height * 0.18}" r="${220 * scale}" fill="rgba(255,217,0,0.16)"/>
  <circle cx="${width * 0.15}" cy="${height * 0.85}" r="${260 * scale}" fill="rgba(74,209,255,0.14)"/>
  ${logo}
  <text x="50%" y="${topY + logoSize + 80 * scale}" text-anchor="middle" font-family="${fontEN}" font-size="${86 * scale}" font-weight="800" fill="#ffffff">Bundai</text>
  <text x="50%" y="${topY + logoSize + 145 * scale}" text-anchor="middle" font-family="${fontEN}" font-size="${38 * scale}" font-weight="700" fill="#ffffff">Learn Japanese</text>
  <text x="50%" y="${topY + logoSize + 195 * scale}" text-anchor="middle" font-family="${fontEN}" font-size="${38 * scale}" font-weight="700" fill="#ffffff">watching anime</text>
  <text x="${qrX - 40 * scale}" y="${qrY + qrSize / 2}" text-anchor="end" font-family="${fontEN}" font-size="${40 * scale}" font-weight="800" fill="#ffd900">App -&gt;</text>
  <text x="50%" y="${qrY - 42 * scale}" text-anchor="middle" font-family="${fontEN}" font-size="${40 * scale}" font-weight="800" fill="#ffd900">download the browser extension &amp; app</text>
  ${qr}
  <text x="50%" y="${height - 64 * scale}" text-anchor="middle" font-family="${fontEN}" font-size="${30 * scale}" font-weight="700" fill="#ffffff">bundai.app</text>
</svg>`;
}

function runFfmpegStillClip({ image, durationSec, output, verbose }) {
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    image,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-t",
    String(durationSec),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    output,
  ];
  if (verbose) console.log(["ffmpeg", ...args].join(" "));
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg still clip failed for ${output}`);
  }
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
  // - "S01ep13"
  // - "3x13"
  // - "Shingeki no Kyojin S01E13 ..."
  // - "03. Episode Title" (episode only, season implied)
  const m1 = base.match(/s(\d{1,2})\s*e?p?(\d{1,3})/i);
  if (m1) {
    return {
      season: Number(m1[1]),
      episode: Number(m1[2]),
      key: `S${String(Number(m1[1])).padStart(2, "0")}E${String(Number(m1[2])).padStart(2, "0")}`,
    };
  }

  const m2 = base.match(/(\d{1,2})x(\d{1,3})/i);
  if (m2) {
    return {
      season: Number(m2[1]),
      episode: Number(m2[2]),
      key: `S${String(Number(m2[1])).padStart(2, "0")}E${String(Number(m2[2])).padStart(2, "0")}`,
    };
  }

  const m3 = base.match(/^\s*0*(\d{1,3})(?:\s*\.|\b)/);
  if (m3) {
    const ep = Number(m3[1]);
    return { season: null, episode: ep, key: `E${String(ep).padStart(2, "0")}` };
  }

  return null;
}

function buildVideoIndex(videosDir, exts) {
  const index = new Map();
  const stack = [videosDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.includes(ext)) continue;

      const base = path.basename(e.name, ext).toLowerCase();
      if (!index.has(`BASE:${base}`)) index.set(`BASE:${base}`, p);

      const info = extractEpisodeKeyFromName(e.name);
      if (!info) continue;
      // Prefer first match; deterministic order helps.
      if (info.key.startsWith("S") && info.key.includes("E")) {
        if (!index.has(info.key)) index.set(info.key, p);
        continue;
      }
      // Episode-only keys.
      if (!index.has(info.key)) index.set(info.key, p);
    }
  }
  return index;
}

function findVideoForSubs(subFile, videosDir, exts, videoIndex) {
  if (!videosDir) return null;

  const base = path.basename(subFile, path.extname(subFile));
  const byBase = videoIndex?.get(`BASE:${base.toLowerCase()}`);
  if (byBase) return byBase;
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
    "-pix_fmt",
    "yuv420p",
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
    "-pix_fmt",
    "yuv420p",
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

function applyClipWindowRules(item, args, { allowSkip = true } = {}) {
  let clipStartMs = Math.max(0, Number(item.clipStartMs) - Number(args.prePadMs || 0));
  let clipEndMs = Number(item.clipEndMs) + Number(args.postPadMs || 0);
  const matchStartMs = Number.isFinite(Number(item.matchStartMs))
    ? Number(item.matchStartMs)
    : Number(item.clipStartMs);
  const matchEndMs = Number.isFinite(Number(item.matchEndMs))
    ? Number(item.matchEndMs)
    : Number(item.clipEndMs);

  const maxed = applyMaxDuration({
    startMs: clipStartMs,
    endMs: clipEndMs,
    maxClipMs: args.maxClipMs,
    policy: allowSkip ? args.longPolicy : "shrink",
    matchStartMs,
    matchEndMs,
  });
  if (maxed.skipped) return null;
  clipStartMs = maxed.startMs;
  clipEndMs = maxed.endMs;

  const ensured = ensureMinDuration({
    startMs: clipStartMs,
    endMs: clipEndMs,
    minClipMs: args.minClipMs,
  });

  return {
    ...item,
    clipStartMs: ensured.startMs,
    clipEndMs: ensured.endMs,
    matchStartMs,
    matchEndMs,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const usingCandidatesIn = Boolean(args.candidatesIn);

  if (!args.query) {
    console.error("--query is required");
    printHelpAndExit(1);
  }
  if (!usingCandidatesIn && !args.subFile && !args.subsDir) {
    console.error("Provide --subFile or --subsDir");
    printHelpAndExit(1);
  }
  if (!usingCandidatesIn && args.subFile && args.subsDir) {
    console.error("Use either --subFile or --subsDir (not both)");
    printHelpAndExit(1);
  }
  if (args.video && args.videosDir) {
    console.error("Use either --video or --videosDir (not both)");
    printHelpAndExit(1);
  }
  if (!args.video && !args.videosDir && fs.existsSync(DEFAULT_VIDEOS_DIR)) {
    args.videosDir = DEFAULT_VIDEOS_DIR;
    if (args.verbose) console.log(`Using default --videosDir: ${DEFAULT_VIDEOS_DIR}`);
  }
  if (args.mode !== "line" && args.mode !== "sentence") {
    console.error('--mode must be "line" or "sentence"');
    printHelpAndExit(1);
  }
  if (!["best", "nearest", "merge"].includes(args.enLinePolicy)) {
    console.error('--enLinePolicy must be "best", "nearest", or "merge"');
    printHelpAndExit(1);
  }
  if (args.concatOnly) {
    args.concat = true;
  }

  if (!args.enSubsDir && args.subsDir) {
    // Common layouts: subs/japanese + subs/english_embedded (preferred), or + subs/english.
    const subsRoot = path.dirname(path.resolve(args.subsDir));
    const candidates = [path.join(subsRoot, "english_embedded"), path.join(subsRoot, "english")];
    const siblingEnglish = candidates.find((p) => fs.existsSync(p));
    if (siblingEnglish) {
      args.enSubsDir = siblingEnglish;
      if (args.verbose) console.log(`Using inferred --enSubsDir: ${siblingEnglish}`);
    }
  }
  if (args.enSubsDir && !fs.existsSync(args.enSubsDir)) {
    if (args.verbose) {
      console.log(`English subtitle dir not found, disabling EN matching: ${args.enSubsDir}`);
    }
    args.enSubsDir = null;
  }

  let wordListEntries = null;
  if (args.wordList) {
    if (fs.existsSync(args.wordList)) {
      const parsed = JSON.parse(fs.readFileSync(args.wordList, "utf8"));
      if (Array.isArray(parsed)) wordListEntries = parsed;
      else if (args.verbose) {
        console.log(`Ignoring --wordList (not an array): ${args.wordList}`);
      }
    } else if (args.verbose) {
      console.log(`Ignoring --wordList (file not found): ${args.wordList}`);
    }
  }
  const queryWordEntry = wordListEntries?.find((x) => x?.word === args.query) ?? null;
  const queryMatcher = buildQueryMatcher(args.query, queryWordEntry);
  if (args.verbose) {
    console.log(
      `Query matcher forms=${queryMatcher.forms.length} exclude=${queryMatcher.exclude.length}`,
    );
  }
  const planned = [];
  if (usingCandidatesIn) {
    const external = loadCandidatesIn(args.candidatesIn);
    for (const c of external) {
      // Keep index mapping stable for --pick in candidatesIn mode:
      // never drop candidates due to long-policy skip; shrink instead.
      const adjusted = applyClipWindowRules(c, args, { allowSkip: false });
      if (adjusted) planned.push(adjusted);
    }
    if (args.verbose) {
      console.log(`Loaded ${planned.length} candidates from --candidatesIn ${args.candidatesIn}`);
    }
  } else {
    const subFiles = args.subFile
      ? [args.subFile]
      : listSubtitleFiles(args.subsDir);
    const seasonOffsets = buildSeasonOffsets(subFiles);

    const videoIndex = args.videosDir ? buildVideoIndex(args.videosDir, args.videoExts) : null;
    const subOffsets = loadSubOffsets(args.subOffsetsFile, args.verbose);
    const enIndex = args.enSubsDir ? buildSubtitleIndex(args.enSubsDir) : null;
    const enCache = new Map();
    const dedupe = new Set();

    for (const subFile of subFiles) {
      const mappedJpOffsetMs = getSubOffsetForFile(subFile, subOffsets, "jp");
      const effectiveJpOffsetMs = mappedJpOffsetMs + args.subOffsetMs;
      const mappedEnOffsetMs = getSubOffsetForFile(subFile, subOffsets, "en");
      const effectiveEnOffsetMs = mappedEnOffsetMs + args.subOffsetMs;
      if (args.verbose && (effectiveJpOffsetMs !== 0 || effectiveEnOffsetMs !== 0)) {
        console.log(
          `Using offsets jp=${effectiveJpOffsetMs}ms en=${effectiveEnOffsetMs}ms for ${path.basename(subFile)}`,
        );
      }
      const items = applyOffset(parseSubsFile(subFile), effectiveJpOffsetMs);
      if (items.length === 0) continue;
      const enItems = getEnglishItemsForSubFile(
        subFile,
        enIndex,
        enCache,
        seasonOffsets,
        effectiveEnOffsetMs,
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const matchInfo = findMatchInText(it.text, queryMatcher);
        if (!matchInfo) continue;
        const matchText = matchInfo.matchText;
        if (args.matchContains && !matchText.includes(args.matchContains)) continue;

        const win =
          args.mode === "sentence"
            ? sentenceWindow(items, i, args)
            : { start: i, end: i };
        const startItem = items[win.start];
        const endItem = items[win.end];

        const estimated = estimateMatchTimeInLine({
          text: it.text,
          query: matchText,
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
            ? Math.max(0, it.startMs - args.prePadMs)
            : Math.max(0, startItem.startMs - args.prePadMs);
        let clipEndMs =
          args.mode === "line"
            ? it.endMs + args.postPadMs
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
          ? findEnglishForTime(enItems, clipStartMs, clipEndMs, {
              policy: args.enLinePolicy,
              focusStartMs: estimated.matchStartMs,
              focusEndMs: estimated.matchEndMs,
            })
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
          matchText,
          matchStartMs: estimated.matchStartMs,
          matchEndMs: estimated.matchEndMs,
          sentenceText,
          enText,
          score,
        });
      }
    }
  }

  let pool = planned;
  if (!usingCandidatesIn && args.rank) {
    pool = [...planned].sort((a, b) => b.score - a.score);
  }
  if (!usingCandidatesIn) {
    pool = uniqueBySentence(pool);
  }
  pool = pool.map((item, idx) => ({
    ...item,
    candidateIndex: idx + 1,
  }));

  let selectionPool = pool;
  let shuffleSeedUsed = null;
  if (args.shuffle) {
    if (args.pick) {
      console.log("Ignoring --shuffle because --pick was provided.");
    } else {
      const seedBase =
        Number.isFinite(args.shuffleSeed)
          ? args.shuffleSeed
          : `${args.query}:${Date.now()}:${process.pid}`;
      shuffleSeedUsed = seedFromValue(seedBase);
      const windowSize =
        Number.isFinite(args.shuffleTop) && args.shuffleTop > 0
          ? Math.min(args.shuffleTop, pool.length)
          : pool.length;
      const head = shuffleArray(pool.slice(0, windowSize), shuffleSeedUsed);
      selectionPool = head.concat(pool.slice(windowSize));
      if (args.verbose) {
        console.log(
          `Shuffle active (seed=${shuffleSeedUsed}, window=${windowSize}/${pool.length}).`,
        );
      }
    }
  }

  if (planned.length === 0) {
    if (args.candidatesOut) {
      writeJsonFile(args.candidatesOut, {
        query: args.query,
        createdAt: new Date().toISOString(),
        args: {
          rank: args.rank,
          shuffle: args.shuffle,
          shuffleSeed: shuffleSeedUsed,
          shuffleTop: args.shuffleTop,
          enLinePolicy: args.enLinePolicy,
          matchContains: args.matchContains,
          mode: args.mode,
          limit: args.limit,
        },
        stats: {
          plannedCount: 0,
          poolCount: 0,
          selectedCount: 0,
        },
        planned: [],
        pool: [],
        selected: [],
      });
    }
    console.error(`No matches found for query: ${args.query}`);
    process.exit(2);
  }

  if (args.printTop > 0) {
    console.log("");
    const title = args.rank ? "Top" : "Candidates";
    console.log(`${title} ${Math.min(args.printTop, pool.length)} candidates:`);
    pool.slice(0, args.printTop).forEach((c, idx) => {
      console.log(
        `${idx + 1}. score=${c.score} ${path.basename(c.subFile)} ${msToFfmpegTime(c.clipStartMs)}-${msToFfmpegTime(c.clipEndMs)}`,
      );
      console.log(`   JP: ${c.sentenceText}`);
      if (c.enText) console.log(`   EN: ${c.enText}`);
    });
  }

  let selected = selectionPool.slice(0, args.limit).map((x) => ({ ...x }));
  if (args.pick) {
    const picks = parsePickList(args.pick);
    const seenPick = new Set();
    selected = picks.map((pos) => {
      const item = pool[pos - 1];
      if (!item) {
        throw new Error(`--pick index #${pos} is out of range (candidates=${pool.length}).`);
      }
      const key = normalizeSentenceKey(item.sentenceText) || `idx:${pos}`;
      if (seenPick.has(key)) {
        throw new Error(`--pick contains duplicate sentence at index #${pos}.`);
      }
      seenPick.add(key);
      return { ...item };
    });
  }

  selected = applyReplaceRules(selected, pool, args.replace);
  selected = selected.map((x) => ({ ...x }));

  const gateAudit = [];
  if (args.clipFit || args.autoReplaceBad || args.enPolishModel) {
    const dicPath = path.join("node_modules", "kuromoji", "dict");
    let gateTokenizer = null;
    try {
      gateTokenizer = await buildTokenizer(dicPath);
    } catch (err) {
      if (args.verbose) {
        console.log(`Gate tokenizer init failed; continuing without lemma lock: ${err?.message || err}`);
      }
    }
    const gated = applyQualityGatesAndAutoReplace(selected, pool, args, {
      matcher: queryMatcher,
      tokenizer: gateTokenizer,
    });
    selected = gated.selected;
    gateAudit.push(...gated.audit);
    for (const a of gateAudit) {
      const from = Number.isInteger(Number(a.from)) ? `#${a.from}` : "(n/a)";
      const to = Number.isInteger(Number(a.to)) ? `#${a.to}` : "(n/a)";
      const reasons = Array.isArray(a.reasons) && a.reasons.length > 0 ? a.reasons.join(",") : "none";
      if (a.kept) {
        if (reasons !== "none") {
          console.log(`[gate] slot${a.slot} kept ${from} reasons=${reasons}`);
        }
      } else {
        console.log(`[gate] slot${a.slot} auto-replaced ${from} -> ${to} reasons=${reasons}`);
      }
    }
  }

  if (args.candidatesOut) {
    writeJsonFile(args.candidatesOut, {
      query: args.query,
      createdAt: new Date().toISOString(),
      args: {
        rank: args.rank,
        shuffle: args.shuffle,
        shuffleSeed: shuffleSeedUsed,
        shuffleTop: args.shuffleTop,
        enLinePolicy: args.enLinePolicy,
        matchContains: args.matchContains,
        mode: args.mode,
        limit: args.limit,
      },
        stats: {
          plannedCount: planned.length,
          poolCount: pool.length,
          selectedCount: selected.length,
        },
        gateAudit,
        planned: planned.map(toCandidateRecord),
        pool: pool.map(toCandidateRecord),
        selected: selected.map(toCandidateRecord),
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
    console.log(`  form:   ${c.matchText ?? args.query}`);
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

  if (args.decorate) {
    const dicPath = path.join("node_modules", "kuromoji", "dict");
    const tokenizer = await buildTokenizer(dicPath);
    const logoDataUri = loadPngDataUri(path.resolve("source_content", "logo.png"));
    const qrDataUri = await buildQrDataUri("http://bundai.app/", 220);

    const headerWord = args.matchContains || args.query;
    const headerWordEntry =
      wordListEntries?.find((x) => x?.word === headerWord) ?? queryWordEntry;
    const isFamilyMode = Boolean(args.matchContains && args.matchContains !== args.query);
    let meaning =
      args.meaning ??
      headerWordEntry?.meaning ??
      (!isFamilyMode ? queryWordEntry?.meaning : "") ??
      "";
    const meaningShort = normalizeMeaning(meaning);

    const headerReadingParts = tokenizeReading(tokenizer, headerWord);
    const headerReading = toHiragana(headerReadingParts.join(""));
    const headerRomaji = toRomaji(headerReading);
    const queryFormsSet = new Set(queryMatcher.forms);
    const highlightHex = "#ffd900";
    const headerKanjiColor = "#ffd900";

    for (const c of manifest) {
      const jpText = compactTextNoSpaces(c.sentenceText);
      const enText = c.enText ?? "";
      const clipMatch = c.matchText || args.query;
      const visualHighlightTerm = String(args.matchContains || args.query || "").trim();
      const clipReading = toHiragana(tokenizeReading(tokenizer, clipMatch).join(""));
      const clipRomaji = toRomaji(clipReading);

      const tokens = tokenizer.tokenize(jpText);
      const tokenSpans = buildTokenSpansBySurface(tokens);
      // Highlight only the learning target (family/query), not long matched phrases.
      const tokenMatchRanges = collectTextRanges(jpText, [visualHighlightTerm || args.query]);
      const hasRangeHighlight = tokenMatchRanges.length > 0;

      const jpTokens = tokens.map((t, tokenIdx) => {
        const surface = t.surface_form || "";
        const base = t.basic_form && t.basic_form !== "*" ? t.basic_form : "";
        const fallbackHit =
          (visualHighlightTerm && surface.includes(visualHighlightTerm)) ||
          (args.query && surface.includes(args.query)) ||
          queryFormsSet.has(surface) ||
          (base &&
            (queryFormsSet.has(base) ||
              (visualHighlightTerm && base.includes(visualHighlightTerm))));
        const spanHit = tokenSpanHitsAnyRange(tokenSpans[tokenIdx], tokenMatchRanges);
        const highlight = hasRangeHighlight ? spanHit : fallbackHit;
        return {
          surface,
          color: highlight ? highlightHex : "#ffffff",
        };
      });
      const furiTokens = tokens.map((t, tokenIdx) => {
        const surface = t.surface_form || "";
        const reading = toHiragana(t.reading || surface || "");
        const base = t.basic_form && t.basic_form !== "*" ? t.basic_form : "";
        const hasKanji = Array.from(surface).some(isKanjiChar);
        const fallbackSurfaceHit =
          (visualHighlightTerm && surface.includes(visualHighlightTerm)) ||
          (args.query && surface.includes(args.query)) ||
          queryFormsSet.has(surface) ||
          (base &&
            (queryFormsSet.has(base) ||
              (visualHighlightTerm && base.includes(visualHighlightTerm))));
        const spanHit = tokenSpanHitsAnyRange(tokenSpans[tokenIdx], tokenMatchRanges);
        const surfaceHit = hasRangeHighlight ? spanHit : fallbackSurfaceHit;
        const readingHit =
          (clipReading && reading.includes(clipReading)) ||
          (headerReading && reading.includes(headerReading));
        const highlight = hasKanji && (surfaceHit || (!hasRangeHighlight && readingHit));
        return {
          surface,
          text: hasKanji ? reading : "",
          color: highlight ? highlightHex : "#ffffff",
        };
      });
      const romajiTokens = tokens.map((t) =>
        toRomaji(toHiragana(t.reading || t.surface_form || "")),
      );
      const romajiText = joinRomajiTokens(tokens, romajiTokens);
      const romajiLine = svgHighlighted(
        romajiText,
        clipRomaji || headerRomaji,
        highlightHex,
      );
      const enHighlighted = meaningShort
        ? svgHighlightedCaseInsensitive(enText, meaningShort, highlightHex)
        : svgEscape(enText);

      const headerLines = [
        { text: headerReading },
        { text: headerWord, color: headerKanjiColor, bg: true },
        meaningShort ? { text: meaningShort } : null,
      ].filter(Boolean);

      const { width, height } = getVideoDimensions(c.output);
      const svg = buildOverlaySvg({
        width,
        height,
        headerLines,
        enLine: enText ? enHighlighted : "",
        jpTokens,
        furiganaTokens: furiTokens,
        romajiLine,
        logoDataUri,
        qrDataUri,
      });

      const overlayHash = crypto.createHash("sha1").update(c.output).digest("hex").slice(0, 10);
      const overlayPath = path.join(outputDir, `.tmp_overlay_${overlayHash}.png`);
      renderSvgToPng({ svg, output: overlayPath });

      const tmpOut = c.output.replace(/\.mp4$/i, "_decorated.mp4");
      runFfmpegOverlay({
        input: c.output,
        overlay: overlayPath,
        output: tmpOut,
        verbose: args.verbose,
      });
      fs.unlinkSync(overlayPath);
      fs.unlinkSync(c.output);
      fs.renameSync(tmpOut, c.output);
    }
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

    const cardVideoPath = path.resolve("source_content", "card.mp4");
    const hasCardVideo = fs.existsSync(cardVideoPath);
    if (hasCardVideo) {
      const { width, height } = getVideoDimensions(stitched);
      const tailDurationSec = getMediaDurationSec(cardVideoPath);
      if (tailDurationSec > 0) {
        const finalOut = stitched.replace(/\.mp4$/i, "_with_card.mp4");
        runFfmpegAppendTailVideo({
          mainInput: stitched,
          tailInput: cardVideoPath,
          output: finalOut,
          width,
          height,
          tailDurationSec,
          verbose: args.verbose,
        });
        fs.unlinkSync(stitched);
        fs.renameSync(finalOut, stitched);
        console.log(`Appended video end card (source_content/card.mp4) to: ${stitched}`);
      } else {
        console.warn(`Skipped source_content/card.mp4 because duration could not be read.`);
      }
    } else {
      const cardPath = path.resolve("source_content", "card.png");
      const hasCardImage = fs.existsSync(cardPath);
      if (args.decorate || hasCardImage) {
        const { width, height } = getVideoDimensions(stitched);
        const logoDataUri = loadPngDataUri(path.resolve("source_content", "logo.png"));
        const cardDataUri = hasCardImage ? loadPngDataUri(cardPath) : "";
        const qrDataUri = cardDataUri ? "" : await buildQrDataUri("http://bundai.app/", 540);
        const endSvg = buildEndCardSvg({
          width,
          height,
          logoDataUri,
          qrDataUri,
          cardDataUri,
        });
        const endHash = crypto.createHash("sha1").update(stitched).digest("hex").slice(0, 10);
        const endPng = path.join(path.dirname(stitched), `.tmp_endcard_${endHash}.png`);
        const endMp4 = path.join(path.dirname(stitched), `.tmp_endcard_${endHash}.mp4`);
        const finalOut = stitched.replace(/\.mp4$/i, "_with_endcard.mp4");
        renderSvgToPng({ svg: endSvg, output: endPng });
        runFfmpegStillClip({
          image: endPng,
          durationSec: 3,
          output: endMp4,
          verbose: args.verbose,
        });
        runFfmpegConcat({
          inputs: [stitched, endMp4],
          output: finalOut,
          verbose: args.verbose,
          listName: `.concat-endcard-${querySlug}.txt`,
        });
        fs.unlinkSync(endPng);
        fs.unlinkSync(endMp4);
        fs.unlinkSync(stitched);
        fs.renameSync(finalOut, stitched);
        if (cardDataUri) {
          console.log(`Appended image end card (source_content/card.png) to: ${stitched}`);
        } else {
          console.log(`Appended branded end card to: ${stitched}`);
        }
      }
    }

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
