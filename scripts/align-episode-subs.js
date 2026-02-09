#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let resvg;

const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_JP_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_EN_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_DIR_FALLBACK = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const RESOLVED_DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_DIR)
  ? DEFAULT_EN_SUBS_DIR
  : DEFAULT_EN_SUBS_DIR_FALLBACK;
const DEFAULT_OFFSETS_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "sub-offsets.json",
);
const DEFAULT_WORK_ROOT = "dissfiles";

function parseArgs(argv) {
  const args = {
    episode: null,
    videosDir: DEFAULT_VIDEOS_DIR,
    jpSubsDir: DEFAULT_JP_SUBS_DIR,
    enSubsDir: RESOLVED_DEFAULT_EN_SUBS_DIR,
    audioStream: "0:a:0",
    sampleSec: 1800,
    minOffsetMs: -12000,
    maxOffsetMs: 12000,
    coarseStepMs: 100,
    fineStepMs: 20,
    silenceNoise: "-30dB",
    silenceMinSec: 0.25,
    checkDurationSec: 60,
    checkAt: "auto",
    checkStartSec: null,
    checkOut: null,
    workRoot: DEFAULT_WORK_ROOT,
    offsetsFile: DEFAULT_OFFSETS_FILE,
    resultJson: null,
    noCheck: false,
    write: false,
    keepTemp: false,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, maybeV] = a.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };

    switch (k) {
      case "episode":
        args.episode = v;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = v;
        takeNext();
        break;
      case "jpSubsDir":
        args.jpSubsDir = v;
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = v;
        takeNext();
        break;
      case "audioStream":
        args.audioStream = v;
        takeNext();
        break;
      case "sampleSec":
        args.sampleSec = Number(v);
        takeNext();
        break;
      case "minOffsetMs":
        args.minOffsetMs = Number(v);
        takeNext();
        break;
      case "maxOffsetMs":
        args.maxOffsetMs = Number(v);
        takeNext();
        break;
      case "coarseStepMs":
        args.coarseStepMs = Number(v);
        takeNext();
        break;
      case "fineStepMs":
        args.fineStepMs = Number(v);
        takeNext();
        break;
      case "silenceNoise":
        args.silenceNoise = String(v);
        takeNext();
        break;
      case "silenceMinSec":
        args.silenceMinSec = Number(v);
        takeNext();
        break;
      case "checkDurationSec":
        args.checkDurationSec = Number(v);
        takeNext();
        break;
      case "checkAt":
        args.checkAt = String(v || "").toLowerCase();
        takeNext();
        break;
      case "checkStartSec":
        args.checkStartSec = Number(v);
        takeNext();
        break;
      case "checkOut":
        args.checkOut = v;
        takeNext();
        break;
      case "workRoot":
        args.workRoot = v;
        takeNext();
        break;
      case "offsetsFile":
        args.offsetsFile = v;
        takeNext();
        break;
      case "resultJson":
        args.resultJson = v;
        takeNext();
        break;
      case "noCheck":
        args.noCheck = true;
        break;
      case "write":
        args.write = true;
        break;
      case "keepTemp":
        args.keepTemp = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  if (!args.episode) printHelpAndExit(1);
  if (!Number.isFinite(args.sampleSec) || args.sampleSec <= 0) {
    throw new Error("--sampleSec must be > 0");
  }
  if (!Number.isFinite(args.checkDurationSec) || args.checkDurationSec <= 0) {
    throw new Error("--checkDurationSec must be > 0");
  }
  if (!["auto", "middle"].includes(args.checkAt)) {
    throw new Error('--checkAt must be "auto" or "middle"');
  }
  if (args.checkStartSec != null && (!Number.isFinite(args.checkStartSec) || args.checkStartSec < 0)) {
    throw new Error("--checkStartSec must be >= 0");
  }
  if (args.maxOffsetMs <= args.minOffsetMs) {
    throw new Error("--maxOffsetMs must be greater than --minOffsetMs");
  }
  if (args.coarseStepMs <= 0 || args.fineStepMs <= 0) {
    throw new Error("--coarseStepMs and --fineStepMs must be > 0");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/align-episode-subs.js --episode s4e30 [options]

What it does:
  1) Uses embedded subtitle track from the video as timing reference
  2) Estimates JP and EN external subtitle offsets against that reference
  2) Renders one flat 60s check clip with shifted JP+EN subtitles
  3) Optionally writes offsets to sub-offsets.json

Options:
  --episode <s4e30>      Required
  --videosDir <dir>      Default: ${DEFAULT_VIDEOS_DIR}
  --jpSubsDir <dir>      Default: ${DEFAULT_JP_SUBS_DIR}
  --enSubsDir <dir>      Default: ${DEFAULT_EN_SUBS_DIR}
  --sampleSec <n>        Seconds used for calibration (default: 1800)
  --minOffsetMs <n>      Default: -12000
  --maxOffsetMs <n>      Default: 12000
  --coarseStepMs <n>     Default: 100
  --fineStepMs <n>       Default: 20
  --checkDurationSec <n> Default: 60
  --checkAt <mode>       "auto" (default) or "middle"
  --checkStartSec <n>    Force check clip start second (overrides --checkAt)
  --checkOut <file>      Default: dissfiles/<episode>_aligned_check.mp4
  --offsetsFile <file>   Default: ${DEFAULT_OFFSETS_FILE}
  --resultJson <file>    Write machine-readable result JSON
  --noCheck              Skip rendering the visual check clip
  --write                Save offsets into offsets JSON
  --keepTemp             Keep temp files
  --verbose              Extra logs
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function normalizeEpisodeToken(s) {
  const m = String(s || "").match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function parseEpisodeTuple(token) {
  const m = String(token || "").match(/^s(\d+)e(\d+)$/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]) };
}

function commandOutput(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
    error: res.error || null,
  };
}

function runChecked(cmd, args, capture = false) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = capture ? `${res.stdout || ""}\n${res.stderr || ""}`.trim() : "";
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}${detail ? `\n${detail}` : ""}`);
  }
  return res;
}

function listFilesRecursive(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  out.sort();
  return out;
}

function findEpisodeFile(root, episode, exts) {
  const files = listFilesRecursive(root).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return exts.includes(ext);
  });
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    if (normalizeEpisodeToken(base) === episode) return f;
  }
  return null;
}

function parseEnglishEpisodeIndex(nameOrPath) {
  const base = path.basename(nameOrPath, path.extname(nameOrPath));
  if (normalizeEpisodeToken(base)) return null;

  const m1 = base.match(/^\s*0*(\d{1,3})\b/);
  if (m1) return Number(m1[1]);

  const m2 = base.match(/\bepisode\s*0*(\d{1,3})\b/i);
  if (m2) return Number(m2[1]);

  return null;
}

function buildSeasonOffsetsFromJpSubsDir(jpSubsDir) {
  const files = listFilesRecursive(jpSubsDir).filter((f) => [".ass", ".srt"].includes(path.extname(f).toLowerCase()));
  const seasonMax = new Map();
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    const token = normalizeEpisodeToken(base);
    const tuple = parseEpisodeTuple(token);
    if (!tuple) continue;
    const prev = seasonMax.get(tuple.season) || 0;
    if (tuple.episode > prev) seasonMax.set(tuple.season, tuple.episode);
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

function episodeToGlobalIndex(episodeToken, seasonOffsets) {
  const tuple = parseEpisodeTuple(episodeToken);
  if (!tuple) return null;
  if (!seasonOffsets.has(tuple.season)) return null;
  return seasonOffsets.get(tuple.season) + tuple.episode;
}

function findEnglishEpisodeFile(enSubsDir, episodeToken, jpSubsDir) {
  const all = listFilesRecursive(enSubsDir).filter((f) => [".ass", ".srt"].includes(path.extname(f).toLowerCase()));

  // 1) Exact sXeY filename match.
  for (const f of all) {
    const base = path.basename(f, path.extname(f));
    if (normalizeEpisodeToken(base) === episodeToken) return f;
  }

  // 2) Global index mapping (01..89) using JP season structure.
  const seasonOffsets = buildSeasonOffsetsFromJpSubsDir(jpSubsDir);
  const globalIdx = episodeToGlobalIndex(episodeToken, seasonOffsets);
  if (Number.isFinite(globalIdx)) {
    const matches = all.filter((f) => parseEnglishEpisodeIndex(f) === globalIdx);
    if (matches.length > 0) {
      matches.sort();
      return matches[0];
    }
  }

  return null;
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function timeAssToMs(ts) {
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

function cleanSubtitleText(t) {
  return String(t || "")
    .replace(/\\N/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
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
    const timeLineIdx = lines[0].includes("-->") ? 0 : 1;
    const m = lines[timeLineIdx].match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!m) continue;
    const text = cleanSubtitleText(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;
    items.push({
      startMs: timeSrtToMs(m[1]),
      endMs: timeSrtToMs(m[2]),
      text,
    });
  }
  return items;
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
    const text = cleanSubtitleText(parts.slice(9).join(","));
    if (!text) continue;
    items.push({
      startMs: timeAssToMs(parts[1].trim()),
      endMs: timeAssToMs(parts[2].trim()),
      text,
    });
  }
  return items;
}

function parseSubsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ass") return parseAssFile(filePath);
  if (ext === ".srt") return parseSrtFile(filePath);
  throw new Error(`Unsupported subtitle extension: ${ext}`);
}

function getMediaDurationSec(file) {
  const out = commandOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  if (out.status !== 0) return 0;
  const d = Number(out.stdout.trim());
  if (!Number.isFinite(d) || d <= 0) return 0;
  return d;
}

function getVideoDimensions(file) {
  const out = commandOutput("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    file,
  ]);
  if (out.status !== 0) return { width: 1920, height: 1080 };
  const [w, h] = out.stdout.trim().split("x").map(Number);
  if (!w || !h) return { width: 1920, height: 1080 };
  return { width: w, height: h };
}

function getSubtitleStreams(file) {
  const out = commandOutput("ffprobe", [
    "-v",
    "error",
    "-of",
    "json",
    "-show_streams",
    file,
  ]);
  if (out.status !== 0) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(out.stdout || "{}");
  } catch {
    return [];
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  return streams
    .filter((s) => s.codec_type === "subtitle")
    .map((s) => ({
      index: Number(s.index),
      codecName: String(s.codec_name || ""),
      language: String(s.tags?.language || "").toLowerCase(),
      title: String(s.tags?.title || "").toLowerCase(),
      dispositionDefault: Number(s.disposition?.default || 0),
    }))
    .filter((s) => Number.isFinite(s.index));
}

function pickReferenceSubtitleStream(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return null;
  let best = null;
  for (const s of streams) {
    let score = 0;
    if (s.language === "eng") score += 120;
    if (s.dispositionDefault) score += 20;
    if (/full|dialog|subtitle|subtitles|complete|complet/.test(s.title)) score += 30;
    if (/sign|song|forced/.test(s.title)) score -= 140;
    if (s.codecName === "ass") score += 5;
    if (!best || score > best.score) best = { ...s, score };
  }
  return best;
}

function extractSubtitleStream({ videoFile, streamIndex, outFile }) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoFile,
    "-map",
    `0:${streamIndex}`,
    outFile,
  ];
  runChecked("ffmpeg", args);
}

function parseSilenceIntervals(logText, maxMs) {
  const lines = String(logText || "").split(/\r?\n/g);
  const silences = [];
  let openStart = null;

  for (const line of lines) {
    const mStart = line.match(/silence_start:\s*([0-9.]+)/);
    if (mStart) {
      openStart = Math.max(0, Math.round(Number(mStart[1]) * 1000));
      continue;
    }
    const mEnd = line.match(/silence_end:\s*([0-9.]+)/);
    if (mEnd) {
      const endMs = Math.min(maxMs, Math.max(0, Math.round(Number(mEnd[1]) * 1000)));
      if (openStart == null) {
        silences.push({ startMs: 0, endMs });
      } else if (endMs > openStart) {
        silences.push({ startMs: openStart, endMs });
      }
      openStart = null;
    }
  }
  if (openStart != null && openStart < maxMs) {
    silences.push({ startMs: openStart, endMs: maxMs });
  }

  silences.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const s of silences) {
    const prev = merged[merged.length - 1];
    if (!prev || s.startMs > prev.endMs) merged.push({ ...s });
    else prev.endMs = Math.max(prev.endMs, s.endMs);
  }
  return merged;
}

function complementIntervals(silences, maxMs) {
  const out = [];
  let cur = 0;
  for (const s of silences) {
    if (s.startMs > cur) out.push({ startMs: cur, endMs: s.startMs });
    cur = Math.max(cur, s.endMs);
  }
  if (cur < maxMs) out.push({ startMs: cur, endMs: maxMs });
  return out.filter((x) => x.endMs > x.startMs);
}

function collectSpeechIntervals({
  videoFile,
  audioStream,
  sampleSec,
  silenceNoise,
  silenceMinSec,
}) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-t",
    String(sampleSec),
    "-i",
    videoFile,
    "-map",
    audioStream,
    "-af",
    `silencedetect=noise=${silenceNoise}:d=${silenceMinSec}`,
    "-f",
    "null",
    "-",
  ];
  const out = runChecked("ffmpeg", args, true);
  const maxMs = Math.round(sampleSec * 1000);
  const silences = parseSilenceIntervals(`${out.stdout}\n${out.stderr}`, maxMs);
  return complementIntervals(silences, maxMs);
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals
    .map((x) => ({ startMs: x.startMs, endMs: x.endMs }))
    .filter((x) => Number.isFinite(x.startMs) && Number.isFinite(x.endMs) && x.endMs > x.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (sorted.length === 0) return [];
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = out[out.length - 1];
    if (cur.startMs <= prev.endMs) prev.endMs = Math.max(prev.endMs, cur.endMs);
    else out.push(cur);
  }
  return out;
}

function intervalsWithin(items, maxMs) {
  return mergeIntervals(
    items
      .map((it) => ({
        startMs: Math.max(0, Math.min(maxMs, it.startMs)),
        endMs: Math.max(0, Math.min(maxMs, it.endMs)),
      }))
      .filter((x) => x.endMs > x.startMs),
  );
}

function sumDuration(intervals) {
  return intervals.reduce((acc, x) => acc + (x.endMs - x.startMs), 0);
}

function overlapDuration(a, b) {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].startMs, b[j].startMs);
    const e = Math.min(a[i].endMs, b[j].endMs);
    if (e > s) total += e - s;
    if (a[i].endMs < b[j].endMs) i++;
    else j++;
  }
  return total;
}

function shiftIntervals(intervals, offsetMs, maxMs) {
  return intervalsWithin(
    intervals.map((x) => ({
      startMs: x.startMs + offsetMs,
      endMs: x.endMs + offsetMs,
    })),
    maxMs,
  );
}

function scoreOffsetToReference({ subIntervals, refIntervals, offsetMs, maxMs }) {
  const shifted = shiftIntervals(subIntervals, offsetMs, maxMs);
  const subDur = sumDuration(shifted);
  if (subDur <= 0) {
    return {
      score: -Infinity,
      overlapRatio: 0,
      overlapMs: 0,
      subDurMs: 0,
    };
  }
  const ov = overlapDuration(shifted, refIntervals);
  const overlapRatio = ov / subDur;
  return {
    score: overlapRatio,
    overlapRatio,
    overlapMs: ov,
    subDurMs: subDur,
  };
}

function estimateOffsetToReference({
  subIntervals,
  refIntervals,
  maxMs,
  minOffsetMs,
  maxOffsetMs,
  coarseStepMs,
  fineStepMs,
}) {
  let best = null;
  const coarse = [];
  for (let off = minOffsetMs; off <= maxOffsetMs; off += coarseStepMs) {
    const s = scoreOffsetToReference({
      subIntervals,
      refIntervals,
      offsetMs: off,
      maxMs,
    });
    coarse.push({ offsetMs: off, ...s });
    if (!best || s.score > best.score) best = { offsetMs: off, ...s };
  }
  coarse.sort((a, b) => b.score - a.score);
  const secondCoarse = coarse[1] || coarse[0];

  const fineStart = Math.max(minOffsetMs, best.offsetMs - coarseStepMs);
  const fineEnd = Math.min(maxOffsetMs, best.offsetMs + coarseStepMs);
  const fine = [];
  for (let off = fineStart; off <= fineEnd; off += fineStepMs) {
    const s = scoreOffsetToReference({
      subIntervals,
      refIntervals,
      offsetMs: off,
      maxMs,
    });
    fine.push({ offsetMs: off, ...s });
    if (s.score > best.score) best = { offsetMs: off, ...s };
  }
  fine.sort((a, b) => b.score - a.score);
  const secondFine = fine[1] || fine[0] || secondCoarse;
  const ratioGap = best.overlapRatio - (secondFine?.overlapRatio ?? best.overlapRatio);

  let confidence = "low";
  if (best.overlapRatio >= 0.7 && ratioGap >= 0.01) confidence = "high";
  else if (best.overlapRatio >= 0.55 && ratioGap >= 0.006) confidence = "medium";

  return {
    ...best,
    confidence,
    ratioGap,
    top: fine.length > 0 ? fine.slice(0, 5) : coarse.slice(0, 5),
  };
}

function nearestDistanceMs(sortedPoints, value) {
  if (sortedPoints.length === 0) return Infinity;
  let lo = 0;
  let hi = sortedPoints.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const v = sortedPoints[mid];
    if (v < value) lo = mid + 1;
    else if (v > value) hi = mid - 1;
    else return 0;
  }
  const a = lo < sortedPoints.length ? Math.abs(sortedPoints[lo] - value) : Infinity;
  const b = hi >= 0 ? Math.abs(sortedPoints[hi] - value) : Infinity;
  return Math.min(a, b);
}

function boundaryCloseness(points, refs, scaleMs) {
  if (points.length === 0 || refs.length === 0) return 0;
  let sum = 0;
  for (const p of points) {
    const d = nearestDistanceMs(refs, p);
    // 1 when exact; decays smoothly toward 0 with distance.
    sum += Math.exp(-d / Math.max(1, scaleMs));
  }
  return sum / points.length;
}

function scoreOffset({ subIntervals, speechIntervals, offsetMs, maxMs, speechStarts, speechEnds }) {
  const shifted = shiftIntervals(subIntervals, offsetMs, maxMs);
  const subDur = sumDuration(shifted);
  if (subDur <= 0) {
    return {
      score: -Infinity,
      overlapRatio: 0,
      boundaryScore: 0,
      overlapMs: 0,
      subDurMs: 0,
    };
  }
  const ov = overlapDuration(shifted, speechIntervals);
  const overlapRatio = ov / subDur;
  const subStarts = shifted.map((x) => x.startMs);
  const subEnds = shifted.map((x) => x.endMs);
  const startClose = boundaryCloseness(subStarts, speechStarts, 320);
  const endClose = boundaryCloseness(subEnds, speechEnds, 320);
  const boundaryScore = (startClose + endClose) / 2;
  // Boundary score disambiguates continuous-dialogue windows where overlap alone is flat.
  const score = boundaryScore * 0.85 + overlapRatio * 0.15;
  return {
    score,
    overlapRatio,
    boundaryScore,
    overlapMs: ov,
    subDurMs: subDur,
  };
}

function estimateOffset({
  subIntervals,
  speechIntervals,
  maxMs,
  minOffsetMs,
  maxOffsetMs,
  coarseStepMs,
  fineStepMs,
}) {
  const speechStarts = speechIntervals
    .map((x) => x.startMs)
    .filter((x) => x > 0 && x < maxMs)
    .sort((a, b) => a - b);
  const speechEnds = speechIntervals
    .map((x) => x.endMs)
    .filter((x) => x > 0 && x < maxMs)
    .sort((a, b) => a - b);
  let best = null;
  const coarse = [];
  for (let off = minOffsetMs; off <= maxOffsetMs; off += coarseStepMs) {
    const s = scoreOffset({
      subIntervals,
      speechIntervals,
      offsetMs: off,
      maxMs,
      speechStarts,
      speechEnds,
    });
    coarse.push({ offsetMs: off, ...s });
    if (!best || s.score > best.score) best = { offsetMs: off, ...s };
  }
  coarse.sort((a, b) => b.score - a.score);
  const secondCoarse = coarse[1] || coarse[0];

  const fineStart = Math.max(minOffsetMs, best.offsetMs - coarseStepMs);
  const fineEnd = Math.min(maxOffsetMs, best.offsetMs + coarseStepMs);
  const fine = [];
  for (let off = fineStart; off <= fineEnd; off += fineStepMs) {
    const s = scoreOffset({
      subIntervals,
      speechIntervals,
      offsetMs: off,
      maxMs,
      speechStarts,
      speechEnds,
    });
    fine.push({ offsetMs: off, ...s });
    if (s.score > best.score) best = { offsetMs: off, ...s };
  }
  fine.sort((a, b) => b.score - a.score);
  const secondFine = fine[1] || fine[0] || secondCoarse;
  const scoreGap = best.score - (secondFine?.score ?? best.score);
  const ratioGap = best.overlapRatio - (secondFine?.overlapRatio ?? best.overlapRatio);

  let confidence = "low";
  if (best.boundaryScore >= 0.55 && ratioGap >= 0.01) confidence = "high";
  else if (best.boundaryScore >= 0.45 && ratioGap >= 0.006) confidence = "medium";

  return {
    ...best,
    confidence,
    scoreGap,
    ratioGap,
    top: fine.length > 0 ? fine.slice(0, 5) : coarse.slice(0, 5),
  };
}

function applyOffsetToItems(items, offsetMs) {
  if (!offsetMs) return items.map((x) => ({ ...x }));
  return items.map((it) => ({
    ...it,
    startMs: Math.max(0, it.startMs + offsetMs),
    endMs: Math.max(1, it.endMs + offsetMs),
  }));
}

function chooseCheckStartMs({ jpItems, enItems, checkDurationMs, maxMs }) {
  const latestStart = Math.max(0, maxMs - checkDurationMs);
  let best = { startMs: 0, score: -Infinity };
  for (let s = 0; s <= latestStart; s += 15000) {
    const e = s + checkDurationMs;
    const jpCount = jpItems.filter((x) => x.endMs > s && x.startMs < e).length;
    const enCount = enItems.filter((x) => x.endMs > s && x.startMs < e).length;
    const score = jpCount * 1.2 + enCount;
    if (score > best.score) best = { startMs: s, score };
  }
  return best.startMs;
}

function uniqueTextJoin(values) {
  const out = [];
  for (const v of values) {
    const t = String(v || "").trim();
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.join(" / ");
}

function buildRelativeItems(items, clipStartMs, clipEndMs) {
  const out = [];
  for (const it of items) {
    if (it.endMs <= clipStartMs || it.startMs >= clipEndMs) continue;
    out.push({
      startMs: Math.max(0, it.startMs - clipStartMs),
      endMs: Math.max(40, Math.min(clipEndMs, it.endMs) - clipStartMs),
      text: it.text,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return out;
}

function buildRelativeSubtitleIntervals(jpRel, enRel, clipDurationMs) {
  const MIN_INTERVAL_MS = 200;
  const points = new Set([0, clipDurationMs]);
  for (const it of jpRel) {
    points.add(Math.max(0, Math.min(clipDurationMs, it.startMs)));
    points.add(Math.max(0, Math.min(clipDurationMs, it.endMs)));
  }
  for (const it of enRel) {
    points.add(Math.max(0, Math.min(clipDurationMs, it.startMs)));
    points.add(Math.max(0, Math.min(clipDurationMs, it.endMs)));
  }

  const times = Array.from(points).sort((a, b) => a - b);
  const raw = [];
  for (let i = 0; i < times.length - 1; i++) {
    const startMs = times[i];
    const endMs = times[i + 1];
    if (endMs - startMs < 40) continue;
    const probe = (startMs + endMs) / 2;
    const jpText = uniqueTextJoin(
      jpRel.filter((x) => x.startMs <= probe && probe < x.endMs).map((x) => x.text),
    );
    const enText = uniqueTextJoin(
      enRel.filter((x) => x.startMs <= probe && probe < x.endMs).map((x) => x.text),
    );
    raw.push({ startMs, endMs, jpText, enText });
  }

  if (raw.length === 0) {
    return [{ startMs: 0, endMs: clipDurationMs, jpText: "", enText: "" }];
  }

  const merged = [];
  for (const cur of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.jpText === cur.jpText &&
      prev.enText === cur.enText &&
      Math.abs(prev.endMs - cur.startMs) <= 1
    ) {
      prev.endMs = cur.endMs;
    } else {
      merged.push({ ...cur });
    }
  }

  if (merged.length <= 1) return merged;
  const stable = [];
  for (const cur of merged) {
    if (stable.length === 0) {
      stable.push({ ...cur });
      continue;
    }
    if (cur.endMs - cur.startMs < MIN_INTERVAL_MS) {
      stable[stable.length - 1].endMs = cur.endMs;
      continue;
    }
    stable.push({ ...cur });
  }
  return stable;
}

function escapeSvgText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapEnglish(text, maxChars = 56) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if ((cur + " " + w).length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function wrapJapanese(text, maxChars = 24) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const lines = [];
  for (let i = 0; i < t.length; i += maxChars) {
    lines.push(t.slice(i, i + maxChars));
    if (lines.length >= 2) break;
  }
  return lines;
}

function svgMultilineText({ lines, x, y, family, size, weight, fill, stroke, strokeWidth, lineStep }) {
  if (!lines || lines.length === 0) return "";
  const first = escapeSvgText(lines[0]);
  const rest = lines
    .slice(1)
    .map((l) => `<tspan x="${x}" dy="${lineStep}">${escapeSvgText(l)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill">${first}${rest}</text>`;
}

function buildSubtitleOverlaySvg({ width, height, jpText, enText }) {
  const jpLines = wrapJapanese(jpText, Math.max(18, Math.floor(width / 75)));
  const enLines = wrapEnglish(enText, Math.max(36, Math.floor(width / 28)));
  const jpSize = Math.max(30, Math.round(width * 0.03));
  const enSize = Math.max(24, Math.round(width * 0.022));
  const enY = Math.round(height * 0.82);
  const jpY = Math.round(height * 0.90);

  const enNode = svgMultilineText({
    lines: enLines,
    x: "50%",
    y: enY,
    family: "Arial, Helvetica, sans-serif",
    size: enSize,
    weight: 700,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: Math.max(2, Math.round(width * 0.0017)),
    lineStep: Math.round(enSize * 1.2),
  });
  const jpNode = svgMultilineText({
    lines: jpLines,
    x: "50%",
    y: jpY,
    family: "Hiragino Sans, Arial, sans-serif",
    size: jpSize,
    weight: 700,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: Math.max(3, Math.round(width * 0.0022)),
    lineStep: Math.round(jpSize * 1.15),
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)"/>
${enNode}
${jpNode}
</svg>`;
}

function renderSvgToPng({ svg, output }) {
  if (!resvg) resvg = require("@resvg/resvg-js");
  const instance = new resvg.Resvg(svg);
  const pngData = instance.render().asPng();
  fs.writeFileSync(output, pngData);
}

function runFfmpegSegmentOverlay({ videoFile, startMs, durationMs, overlayPng, output }) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    (startMs / 1000).toFixed(3),
    "-t",
    (durationMs / 1000).toFixed(3),
    "-i",
    videoFile,
    "-loop",
    "1",
    "-i",
    overlayPng,
    "-filter_complex",
    "[1:v][0:v]scale2ref=w=iw:h=ih[ovr][base];[base][ovr]overlay=0:0:format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-sn",
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
  runChecked("ffmpeg", args);
}

function runFfmpegConcat({ segmentFiles, output, workDir }) {
  const listFile = path.join(workDir, ".concat_list.txt");
  const lines = segmentFiles.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listFile, `${lines.join("\n")}\n`, "utf8");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-sn",
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
  runChecked("ffmpeg", args);
  return listFile;
}

function renderCheckVideo({
  videoFile,
  jpItems,
  enItems,
  checkStartMs,
  checkDurationMs,
  outFile,
  workDir,
  verbose,
}) {
  const { width, height } = getVideoDimensions(videoFile);
  const clipEndMs = checkStartMs + checkDurationMs;
  const jpRel = buildRelativeItems(jpItems, checkStartMs, clipEndMs);
  const enRel = buildRelativeItems(enItems, checkStartMs, clipEndMs);
  const intervals = buildRelativeSubtitleIntervals(jpRel, enRel, checkDurationMs);

  const overlaysDir = path.join(workDir, "overlays");
  const segmentsDir = path.join(workDir, "segments");
  fs.mkdirSync(overlaysDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  const overlayCache = new Map();
  const segmentFiles = [];
  for (let i = 0; i < intervals.length; i++) {
    const it = intervals[i];
    const key = `${it.jpText}\n${it.enText}`;
    let overlayPng = overlayCache.get(key);
    if (!overlayPng) {
      overlayPng = path.join(overlaysDir, `ovr_${overlayCache.size}.png`);
      const svg = buildSubtitleOverlaySvg({
        width,
        height,
        jpText: it.jpText,
        enText: it.enText,
      });
      renderSvgToPng({ svg, output: overlayPng });
      overlayCache.set(key, overlayPng);
    }
    const segOut = path.join(segmentsDir, `seg_${String(i).padStart(4, "0")}.mp4`);
    const segAbsStartMs = checkStartMs + it.startMs;
    const segDurMs = it.endMs - it.startMs;
    if (verbose) {
      console.log(`  segment ${String(i + 1).padStart(3, "0")}/${String(intervals.length).padStart(3, "0")} ${Math.round(segDurMs)}ms`);
    }
    runFfmpegSegmentOverlay({
      videoFile,
      startMs: segAbsStartMs,
      durationMs: segDurMs,
      overlayPng,
      output: segOut,
    });
    segmentFiles.push(segOut);
  }
  return runFfmpegConcat({
    segmentFiles,
    output: outFile,
    workDir,
  });
}

function loadOffsets(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      default: 0,
      byEpisode: {},
      jpByEpisode: {},
      enByEpisode: {},
      updatedAt: null,
    };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    default: Number(raw.default || 0) || 0,
    byEpisode: { ...(raw.byEpisode || {}) },
    jpByEpisode: { ...(raw.jpByEpisode || {}) },
    enByEpisode: { ...(raw.enByEpisode || {}) },
    updatedAt: raw.updatedAt || null,
  };
}

function saveOffsets(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function cleanupTemp(workDir) {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function main() {
  const args = parseArgs(process.argv);
  const episode = normalizeEpisodeToken(args.episode);
  if (!episode) throw new Error("--episode must look like s4e30");

  const videoFile = findEpisodeFile(args.videosDir, episode, [".mkv", ".mp4", ".mov", ".webm"]);
  const jpSubFile = findEpisodeFile(args.jpSubsDir, episode, [".ass", ".srt"]);
  const enSubFile = findEnglishEpisodeFile(args.enSubsDir, episode, args.jpSubsDir);
  if (!videoFile) throw new Error(`Video not found: ${episode} in ${args.videosDir}`);
  if (!jpSubFile) throw new Error(`JP subs not found: ${episode} in ${args.jpSubsDir}`);
  if (!enSubFile) throw new Error(`EN subs not found: ${episode} in ${args.enSubsDir}`);

  const checkOut = args.noCheck
    ? null
    : args.checkOut
      ? path.resolve(args.checkOut)
      : path.resolve(args.workRoot, `${episode}_aligned_check.mp4`);
  const workDir = path.resolve(args.workRoot, `.align_tmp_${episode}`);
  fs.mkdirSync(workDir, { recursive: true });
  if (checkOut) fs.mkdirSync(path.dirname(checkOut), { recursive: true });

  const videoDurationSec = getMediaDurationSec(videoFile);
  const sampleSec = Math.min(args.sampleSec, Math.max(120, Math.floor(videoDurationSec || args.sampleSec)));
  const maxMs = Math.round(sampleSec * 1000);

  const jpItemsRaw = parseSubsFile(jpSubFile);
  const enItemsRaw = parseSubsFile(enSubFile);
  const jpIntervals = intervalsWithin(jpItemsRaw, maxMs);
  const enIntervals = intervalsWithin(enItemsRaw, maxMs);
  const subStreams = getSubtitleStreams(videoFile);
  const refStream = pickReferenceSubtitleStream(subStreams);
  if (!refStream) {
    throw new Error(
      "No embedded subtitle stream found in video. This alignment method needs an embedded reference track.",
    );
  }
  const referenceSubFile = path.join(workDir, `${episode}_reference.ass`);
  extractSubtitleStream({
    videoFile,
    streamIndex: refStream.index,
    outFile: referenceSubFile,
  });
  const refItemsRaw = parseSubsFile(referenceSubFile);
  const refIntervals = intervalsWithin(refItemsRaw, maxMs);
  if (refIntervals.length === 0) {
    throw new Error("Reference subtitle stream parsed to zero lines in sample window.");
  }

  const jpEst = estimateOffsetToReference({
    subIntervals: jpIntervals,
    refIntervals,
    maxMs,
    minOffsetMs: args.minOffsetMs,
    maxOffsetMs: args.maxOffsetMs,
    coarseStepMs: args.coarseStepMs,
    fineStepMs: args.fineStepMs,
  });
  const enEst = estimateOffsetToReference({
    subIntervals: enIntervals,
    refIntervals,
    maxMs,
    minOffsetMs: args.minOffsetMs,
    maxOffsetMs: args.maxOffsetMs,
    coarseStepMs: args.coarseStepMs,
    fineStepMs: args.fineStepMs,
  });

  console.log(`Episode: ${episode}`);
  console.log(`Video:   ${videoFile}`);
  console.log(`JP:      ${jpSubFile}`);
  console.log(`EN:      ${enSubFile}`);
  console.log(
    `Ref:     stream #${refStream.index} (${refStream.language || "?"}) ${refStream.title || "(no title)"}`,
  );
  console.log(`Window:  0s -> ${sampleSec}s`);
  console.log("");
  console.log(
    `JP offset: ${jpEst.offsetMs}ms (confidence=${jpEst.confidence}, overlap=${(
      jpEst.overlapRatio * 100
    ).toFixed(1)}%)`,
  );
  console.log(
    `EN offset: ${enEst.offsetMs}ms (confidence=${enEst.confidence}, overlap=${(
      enEst.overlapRatio * 100
    ).toFixed(1)}%)`,
  );

  if (args.verbose) {
    console.log("");
    console.log("JP top offsets:");
    for (const c of jpEst.top) {
      const boundaryPart = Number.isFinite(c.boundaryScore)
        ? ` | boundary ${(c.boundaryScore * 100).toFixed(1)}%`
        : "";
      console.log(
        `  ${String(c.offsetMs).padStart(6)}ms${boundaryPart} | overlap ${(c.overlapRatio * 100).toFixed(1)}%`,
      );
    }
    console.log("EN top offsets:");
    for (const c of enEst.top) {
      const boundaryPart = Number.isFinite(c.boundaryScore)
        ? ` | boundary ${(c.boundaryScore * 100).toFixed(1)}%`
        : "";
      console.log(
        `  ${String(c.offsetMs).padStart(6)}ms${boundaryPart} | overlap ${(c.overlapRatio * 100).toFixed(1)}%`,
      );
    }
  }

  const jpShifted = applyOffsetToItems(jpItemsRaw, jpEst.offsetMs);
  const enShifted = applyOffsetToItems(enItemsRaw, enEst.offsetMs);
  const checkDurationMs = Math.round(args.checkDurationSec * 1000);
  let checkStartMs = null;
  let renderedCheckOut = null;
  if (!args.noCheck) {
    if (Number.isFinite(args.checkStartSec)) {
      checkStartMs = Math.round(args.checkStartSec * 1000);
    } else if (args.checkAt === "middle") {
      const totalMs = Math.max(checkDurationMs, Math.round((videoDurationSec || args.sampleSec) * 1000));
      checkStartMs = Math.max(0, Math.min(totalMs - checkDurationMs, Math.round(totalMs / 2 - checkDurationMs / 2)));
    } else {
      checkStartMs = chooseCheckStartMs({
        jpItems: jpShifted,
        enItems: enShifted,
        checkDurationMs,
        maxMs,
      });
    }
    console.log("");
    console.log(`Rendering check clip: ${checkOut}`);
    renderCheckVideo({
      videoFile,
      jpItems: jpShifted,
      enItems: enShifted,
      checkStartMs,
      checkDurationMs,
      outFile: checkOut,
      workDir,
      verbose: args.verbose,
    });
    renderedCheckOut = checkOut;
  } else {
    console.log("");
    console.log("Skipping check clip render (--noCheck).");
  }

  if (args.write) {
    const offsets = loadOffsets(args.offsetsFile);
    offsets.byEpisode[episode] = jpEst.offsetMs;
    offsets.jpByEpisode[episode] = jpEst.offsetMs;
    offsets.enByEpisode[episode] = enEst.offsetMs;
    offsets.updatedAt = new Date().toISOString();
    saveOffsets(args.offsetsFile, offsets);
    console.log(`Saved offsets -> ${args.offsetsFile}`);
  } else {
    console.log("Dry run for offsets file (not written). Add --write to save.");
  }

  const result = {
    generatedAt: new Date().toISOString(),
    episode,
    sampleSec,
    window: { startSec: 0, endSec: sampleSec },
    videoFile: path.resolve(videoFile),
    jpSubFile: path.resolve(jpSubFile),
    enSubFile: path.resolve(enSubFile),
    reference: {
      streamIndex: refStream.index,
      language: refStream.language || "",
      title: refStream.title || "",
      subtitleFile: path.resolve(referenceSubFile),
    },
    jp: {
      offsetMs: jpEst.offsetMs,
      confidence: jpEst.confidence,
      overlapRatio: jpEst.overlapRatio,
      overlapMs: jpEst.overlapMs,
      subDurMs: jpEst.subDurMs,
      ratioGap: jpEst.ratioGap,
      top: jpEst.top,
    },
    en: {
      offsetMs: enEst.offsetMs,
      confidence: enEst.confidence,
      overlapRatio: enEst.overlapRatio,
      overlapMs: enEst.overlapMs,
      subDurMs: enEst.subDurMs,
      ratioGap: enEst.ratioGap,
      top: enEst.top,
    },
    writeApplied: args.write,
    offsetsFile: path.resolve(args.offsetsFile),
    check: {
      rendered: !args.noCheck,
      output: renderedCheckOut ? path.resolve(renderedCheckOut) : null,
      startMs: checkStartMs,
      durationMs: args.noCheck ? null : checkDurationMs,
    },
  };
  if (args.resultJson) {
    const absResultJson = path.resolve(args.resultJson);
    fs.mkdirSync(path.dirname(absResultJson), { recursive: true });
    fs.writeFileSync(absResultJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`Result JSON -> ${absResultJson}`);
  }

  if (!args.keepTemp) cleanupTemp(workDir);
  else console.log(`Temp kept: ${workDir}`);

  console.log("");
  if (renderedCheckOut) console.log(`Done. Check clip: ${checkOut}`);
  else console.log("Done. Offsets estimated.");
}

main();
