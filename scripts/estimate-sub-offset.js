#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    subFile: null,
    asrJson: null,
    sampleSec: 60,
    windowStartSec: 0,
    minOffsetMs: -5000,
    maxOffsetMs: 5000,
    coarseStepMs: 100,
    fineStepMs: 20,
    maxPairDistMs: 1400,
    minTextLen: 2,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [key, maybeValue] = a.slice(2).split("=");
    const value = maybeValue ?? argv[i + 1];
    const takeNext = () => {
      if (maybeValue == null) i++;
    };

    switch (key) {
      case "subFile":
      case "sub":
        args.subFile = value;
        takeNext();
        break;
      case "asrJson":
        args.asrJson = value;
        takeNext();
        break;
      case "sampleSec":
        args.sampleSec = Number(value);
        takeNext();
        break;
      case "windowStartSec":
        args.windowStartSec = Number(value);
        takeNext();
        break;
      case "minOffsetMs":
        args.minOffsetMs = Number(value);
        takeNext();
        break;
      case "maxOffsetMs":
        args.maxOffsetMs = Number(value);
        takeNext();
        break;
      case "coarseStepMs":
        args.coarseStepMs = Number(value);
        takeNext();
        break;
      case "fineStepMs":
        args.fineStepMs = Number(value);
        takeNext();
        break;
      case "maxPairDistMs":
        args.maxPairDistMs = Number(value);
        takeNext();
        break;
      case "minTextLen":
        args.minTextLen = Number(value);
        takeNext();
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${key}`);
    }
  }

  if (!args.subFile || !args.asrJson) {
    printHelpAndExit(1);
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
  node scripts/estimate-sub-offset.js --subFile <subs.ass|srt> --asrJson <whisper.json> [options]

Purpose:
  Estimate a constant subtitle offset by aligning Whisper ASR segments
  against subtitle lines from the first N seconds.

Options:
  --sampleSec      Seconds to analyze from start (default: 60)
  --windowStartSec Absolute subtitle window start in seconds (default: 0)
  --minOffsetMs    Min offset to test (default: -5000)
  --maxOffsetMs    Max offset to test (default: 5000)
  --coarseStepMs   Coarse search step (default: 100)
  --fineStepMs     Fine search step (default: 20)
  --maxPairDistMs  Max center distance for segment pairing (default: 1400)
  --minTextLen     Minimum normalized text length to score (default: 2)
  --verbose        Print top candidates

Notes:
  - Positive offset means subtitles should be shifted later.
  - Use output with extract-clips: --subOffsetMs <offset>
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
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

function cleanAssText(t) {
  return t
    .replace(/\\N/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .trim();
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
    const timeLine = lines[timeLineIdx];
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!m) continue;
    const startMs = timeSrtToMs(m[1]);
    const endMs = timeSrtToMs(m[2]);
    const text = lines.slice(timeLineIdx + 1).join("\n").trim();
    if (!text) continue;
    items.push({ startMs, endMs, text });
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
    const text = cleanAssText(parts.slice(9).join(","));
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

function normalizeText(s) {
  return String(s || "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9]/gu, "")
    .toLowerCase();
}

function bigrams(s) {
  const out = new Set();
  if (s.length <= 1) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size || 1);
}

function loadAsrSegments(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const arr = Array.isArray(data) ? data : data?.segments;
  if (!Array.isArray(arr)) {
    throw new Error("ASR JSON must be an array or have a .segments array");
  }
  const out = [];
  for (const seg of arr) {
    const start = Number(seg.start ?? seg.start_time ?? seg.startTime);
    const end = Number(seg.end ?? seg.end_time ?? seg.endTime);
    const text = String(seg.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!text) continue;
    out.push({
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text,
      norm: normalizeText(text),
    });
  }
  return out;
}

function centerMs(it) {
  return (it.startMs + it.endMs) / 2;
}

function bestSubForSegment(seg, subs, offsetMs, maxPairDistMs, minTextLen) {
  const shifted = {
    startMs: seg.startMs + offsetMs,
    endMs: seg.endMs + offsetMs,
  };
  const segCenter = centerMs(shifted);
  let best = null;
  let bestScore = 0;

  for (const sub of subs) {
    const subCenter = centerMs(sub);
    const dist = Math.abs(subCenter - segCenter);
    if (dist > maxPairDistMs) continue;

    const subNorm = sub.norm;
    if (subNorm.length < minTextLen) continue;
    if (seg.norm.length < minTextLen) continue;

    const textSim = diceCoefficient(seg.norm, subNorm);
    if (textSim <= 0) continue;

    const timeWeight = Math.max(0, 1 - dist / maxPairDistMs);
    const score = textSim * (0.65 + 0.35 * timeWeight);

    if (score > bestScore) {
      bestScore = score;
      best = { sub, dist, textSim, score };
    }
  }
  return best;
}

function scoreOffset(offsetMs, asrSegs, subs, maxPairDistMs, minTextLen) {
  let score = 0;
  let matched = 0;
  for (const seg of asrSegs) {
    const best = bestSubForSegment(seg, subs, offsetMs, maxPairDistMs, minTextLen);
    if (!best) continue;
    if (best.score < 0.2) continue;
    score += best.score;
    matched++;
  }
  const mean = matched > 0 ? score / matched : 0;
  return { offsetMs, score, mean, matched };
}

function searchBestOffset({
  asrSegs,
  subs,
  minOffsetMs,
  maxOffsetMs,
  coarseStepMs,
  fineStepMs,
  maxPairDistMs,
  minTextLen,
}) {
  const coarse = [];
  for (let off = minOffsetMs; off <= maxOffsetMs; off += coarseStepMs) {
    coarse.push(scoreOffset(off, asrSegs, subs, maxPairDistMs, minTextLen));
  }
  coarse.sort((a, b) => (b.mean === a.mean ? b.matched - a.matched : b.mean - a.mean));
  const coarseBest = coarse[0];

  const fineMin = coarseBest.offsetMs - coarseStepMs;
  const fineMax = coarseBest.offsetMs + coarseStepMs;
  const fine = [];
  for (let off = fineMin; off <= fineMax; off += fineStepMs) {
    fine.push(scoreOffset(off, asrSegs, subs, maxPairDistMs, minTextLen));
  }
  fine.sort((a, b) => (b.mean === a.mean ? b.matched - a.matched : b.mean - a.mean));
  const best = fine[0];
  const second = fine[1] || coarse[1] || { mean: 0 };
  return { best, second, coarseTop: coarse.slice(0, 5), fineTop: fine.slice(0, 5) };
}

function confidenceLabel(best, second, asrCount) {
  if (!best || best.matched === 0) return "low";
  const margin = best.mean - (second?.mean ?? 0);
  const coverage = best.matched / Math.max(1, asrCount);
  if (margin >= 0.08 && coverage >= 0.45) return "high";
  if (margin >= 0.04 && coverage >= 0.25) return "medium";
  return "low";
}

function main() {
  const args = parseArgs(process.argv);
  const windowStartMs = Math.round(args.windowStartSec * 1000);
  const sampleMs = Math.round(args.sampleSec * 1000);
  const windowEndMs = windowStartMs + sampleMs;

  const subs = parseSubsFile(args.subFile)
    .filter((x) => x.endMs > windowStartMs && x.startMs < windowEndMs)
    .map((x) => ({
      ...x,
      startMs: Math.max(0, x.startMs - windowStartMs),
      endMs: Math.max(0, x.endMs - windowStartMs),
      norm: normalizeText(x.text),
    }));

  const asrSegs = loadAsrSegments(args.asrJson).filter((x) => x.startMs < sampleMs);

  if (subs.length === 0) throw new Error("No subtitle lines found in sample window.");
  if (asrSegs.length === 0) throw new Error("No ASR segments found in sample window.");

  const { best, second, coarseTop, fineTop } = searchBestOffset({
    asrSegs,
    subs,
    minOffsetMs: args.minOffsetMs,
    maxOffsetMs: args.maxOffsetMs,
    coarseStepMs: args.coarseStepMs,
    fineStepMs: args.fineStepMs,
    maxPairDistMs: args.maxPairDistMs,
    minTextLen: args.minTextLen,
  });

  if (!best || best.matched === 0) {
    throw new Error("No alignable subtitle/ASR pairs found in sample window.");
  }

  const conf = confidenceLabel(best, second, asrSegs.length);
  const sign = best.offsetMs >= 0 ? "+" : "";

  console.log(`Estimated subtitle offset: ${sign}${best.offsetMs} ms`);
  console.log(`Confidence: ${conf} (matched ${best.matched}/${asrSegs.length} ASR segments)`);
  console.log(`Use with extractor: --subOffsetMs ${best.offsetMs}`);

  if (args.verbose) {
    console.log("");
    console.log("Top coarse offsets:");
    for (const r of coarseTop) {
      console.log(`  ${r.offsetMs} ms | mean=${r.mean.toFixed(4)} | matched=${r.matched}`);
    }
    console.log("Top fine offsets:");
    for (const r of fineTop) {
      console.log(`  ${r.offsetMs} ms | mean=${r.mean.toFixed(4)} | matched=${r.matched}`);
    }
  }
}

main();
