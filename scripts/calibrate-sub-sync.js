#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_WORK_DIR = "dissfiles";
const DEFAULT_OFFSETS_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "sub-offsets.json",
);

function parseArgs(argv) {
  const args = {
    episode: null,
    videoFile: null,
    subFile: null,
    videosDir: DEFAULT_VIDEOS_DIR,
    subsDir: DEFAULT_SUBS_DIR,
    workDir: DEFAULT_WORK_DIR,
    offsetsFile: DEFAULT_OFFSETS_FILE,
    sampleSec: 60,
    windowStartSec: null,
    maxAttempts: 4,
    model: "small",
    language: "Japanese",
    whisperBin: "whisper",
    allowLowConfidence: false,
    apply: false,
    verbose: false,
    estimateArgs: [],
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
      case "episode":
        args.episode = value;
        takeNext();
        break;
      case "videoFile":
      case "video":
        args.videoFile = value;
        takeNext();
        break;
      case "subFile":
      case "sub":
        args.subFile = value;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = value;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = value;
        takeNext();
        break;
      case "workDir":
        args.workDir = value;
        takeNext();
        break;
      case "offsetsFile":
        args.offsetsFile = value;
        takeNext();
        break;
      case "sampleSec":
        args.sampleSec = Number(value);
        takeNext();
        break;
      case "maxAttempts":
        args.maxAttempts = Number(value);
        takeNext();
        break;
      case "windowStartSec":
        args.windowStartSec = Number(value);
        takeNext();
        break;
      case "model":
        args.model = value;
        takeNext();
        break;
      case "language":
        args.language = value;
        takeNext();
        break;
      case "whisperBin":
        args.whisperBin = value;
        takeNext();
        break;
      case "allowLowConfidence":
        args.allowLowConfidence = true;
        break;
      case "apply":
        args.apply = true;
        break;
      case "dryRun":
        args.apply = false;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "estimateArg":
        args.estimateArgs.push(value);
        takeNext();
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${key}`);
    }
  }

  if (!args.episode && (!args.videoFile || !args.subFile)) {
    throw new Error("Provide --episode (recommended), or both --videoFile and --subFile");
  }
  if (!Number.isFinite(args.sampleSec) || args.sampleSec <= 0) {
    throw new Error("--sampleSec must be > 0");
  }
  if (!Number.isFinite(args.maxAttempts) || args.maxAttempts < 1) {
    throw new Error("--maxAttempts must be >= 1");
  }
  if (
    args.windowStartSec != null &&
    (!Number.isFinite(args.windowStartSec) || args.windowStartSec < 0)
  ) {
    throw new Error("--windowStartSec must be >= 0");
  }

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/calibrate-sub-sync.js --episode s4e30 [options]

What it does:
  1) Extracts first N seconds audio to ./dissfiles
  2) Runs local whisper CLI
  3) Estimates subtitle offset
  4) Optionally writes/updates offsets JSON

Options:
  --episode <s4e30>    Episode token (preferred)
  --videoFile <path>   Explicit video file (if not using --episode)
  --subFile <path>     Explicit subtitle file (if not using --episode)
  --videosDir <path>   Video dir (default: ${DEFAULT_VIDEOS_DIR})
  --subsDir <path>     Japanese subs dir (default: ${DEFAULT_SUBS_DIR})
  --workDir <path>     Temp artifacts folder (default: ${DEFAULT_WORK_DIR})
  --offsetsFile <path> Offsets JSON to update (default: ${DEFAULT_OFFSETS_FILE})
  --sampleSec <n>      Audio seconds to use (default: 60)
  --windowStartSec <n> Absolute video start second for calibration window (default: auto from first subtitle)
  --maxAttempts <n>    Retry windows when no speech/alignment (default: 4)
  --model <name>       Whisper model (default: small)
  --language <name>    Whisper language (default: Japanese)
  --whisperBin <cmd>   Whisper executable name (default: whisper)
  --allowLowConfidence Accept low-confidence estimates without extra retries
  --estimateArg <arg>  Extra arg passed to estimate-sub-offset.js (repeatable)
  --apply              Write offset into offsets file
  --dryRun             Compute only; do not write offsets file (default)
  --verbose            More logs
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function normalizeEpisodeToken(s) {
  if (!s) return null;
  const m = String(s).match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function parseEpisodeFromPath(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return normalizeEpisodeToken(base);
}

function srtTimeToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function assTimeToMs(ts) {
  const m = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const frac = m[4];
  const base = ((hh * 60 + mm) * 60 + ss) * 1000;
  if (frac.length === 1) return base + Number(frac) * 100;
  if (frac.length === 2) return base + Number(frac) * 10;
  return base + Number(frac);
}

function firstSubtitleStartMs(subFile) {
  const ext = path.extname(subFile).toLowerCase();
  const raw = fs.readFileSync(subFile, "utf8");
  const lines = raw.split(/\r?\n/g);

  let minMs = Infinity;
  if (ext === ".srt") {
    for (const line of lines) {
      const m = line.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->/);
      if (!m) continue;
      const ms = srtTimeToMs(m[1]);
      if (ms != null && ms < minMs) minMs = ms;
    }
  } else if (ext === ".ass") {
    for (const line of lines) {
      if (!line.startsWith("Dialogue:")) continue;
      const parts = line.slice("Dialogue:".length).trim().split(",");
      if (parts.length < 3) continue;
      const ms = assTimeToMs(parts[1].trim());
      if (ms != null && ms < minMs) minMs = ms;
    }
  }
  return Number.isFinite(minMs) ? minMs : null;
}

function listFilesRecursive(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  out.sort();
  return out;
}

function findEpisodeFile(root, episodeToken, exts) {
  const files = listFilesRecursive(root).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return exts.includes(ext);
  });
  const candidates = files.filter((f) => parseEpisodeFromPath(f) === episodeToken);
  if (candidates.length === 0) return null;
  return candidates[0];
}

function runChecked(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = opts.capture ? `${res.stdout || ""}\n${res.stderr || ""}`.trim() : "";
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}${msg ? `\n${msg}` : ""}`);
  }
  return res;
}

function normalizeOffsets(raw) {
  const out = {
    default: 0,
    bySeason: {},
    byEpisode: {},
    updatedAt: null,
  };
  if (!raw || typeof raw !== "object") return out;

  if (Number.isFinite(Number(raw.default))) out.default = Number(raw.default);
  if (Number.isFinite(Number(raw.defaultMs))) out.default = Number(raw.defaultMs);

  const addEpisode = (k, v) => {
    const key = normalizeEpisodeToken(k);
    const n = Number(v);
    if (!key || !Number.isFinite(n)) return;
    out.byEpisode[key] = n;
  };
  const addSeason = (k, v) => {
    const m = String(k || "").match(/s\s*0*(\d{1,2})/i);
    const n = Number(v);
    if (!m || !Number.isFinite(n)) return;
    out.bySeason[`s${Number(m[1])}`] = n;
  };

  for (const [k, v] of Object.entries(raw.byEpisode || {})) addEpisode(k, v);
  for (const [k, v] of Object.entries(raw.episodes || {})) addEpisode(k, v);
  for (const [k, v] of Object.entries(raw.bySeason || {})) addSeason(k, v);
  for (const [k, v] of Object.entries(raw.seasons || {})) addSeason(k, v);

  for (const [k, v] of Object.entries(raw)) {
    if (["default", "defaultMs", "byEpisode", "episodes", "bySeason", "seasons", "updatedAt"].includes(k)) {
      continue;
    }
    if (normalizeEpisodeToken(k)) addEpisode(k, v);
    else addSeason(k, v);
  }

  if (typeof raw.updatedAt === "string") out.updatedAt = raw.updatedAt;
  return out;
}

function loadOffsets(filePath) {
  if (!fs.existsSync(filePath)) return normalizeOffsets(null);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return normalizeOffsets(raw);
}

function saveOffsets(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseEstimateSummary(text) {
  const raw = String(text || "");
  const off = raw.match(/Estimated subtitle offset:\s*([+-]?\d+)\s*ms/i);
  const conf = raw.match(/Confidence:\s*([a-z]+)/i);
  const matched = raw.match(/matched\s+(\d+)\s*\/\s*(\d+)/i);
  return {
    offsetMs: off ? Number(off[1]) : null,
    confidence: conf ? conf[1].toLowerCase() : null,
    matched: matched ? Number(matched[1]) : null,
    total: matched ? Number(matched[2]) : null,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const episode = normalizeEpisodeToken(args.episode || parseEpisodeFromPath(args.videoFile) || parseEpisodeFromPath(args.subFile));
  if (!episode) {
    throw new Error("Could not determine episode token. Use --episode like s4e30.");
  }

  const videoFile =
    args.videoFile || findEpisodeFile(args.videosDir, episode, [".mkv", ".mp4", ".mov", ".webm"]);
  const subFile = args.subFile || findEpisodeFile(args.subsDir, episode, [".ass", ".srt"]);

  if (!videoFile) throw new Error(`Video not found for ${episode} in ${args.videosDir}`);
  if (!subFile) throw new Error(`Subtitle not found for ${episode} in ${args.subsDir}`);

  const detectedFirstMs = firstSubtitleStartMs(subFile);
  const autoStartSec = detectedFirstMs == null ? 0 : Math.max(0, Math.floor(detectedFirstMs / 1000) - 2);
  const initialWindowStartSec =
    Number.isFinite(args.windowStartSec) && args.windowStartSec != null
      ? Math.max(0, args.windowStartSec)
      : autoStartSec;

  fs.mkdirSync(args.workDir, { recursive: true });
  console.log(`Episode: ${episode}`);
  console.log(`Video:   ${videoFile}`);
  console.log(`Subs:    ${subFile}`);
  console.log(`Window:  ${Math.floor(initialWindowStartSec)}s + ${args.sampleSec}s (start)`);
  console.log(`Retries: ${args.maxAttempts}`);
  console.log(`WorkDir: ${args.workDir}`);
  console.log("");
  let windowStartSec = initialWindowStartSec;
  let offsetMs = null;
  let estimateSummary = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    const base = `${episode}_from${Math.floor(windowStartSec)}s_${args.sampleSec}s`;
    const wavFile = path.join(args.workDir, `${base}.wav`);
    const asrJson = path.join(args.workDir, `${base}.json`);

    console.log(`Attempt ${attempt}/${args.maxAttempts}: window ${Math.floor(windowStartSec)}s + ${args.sampleSec}s`);

    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(windowStartSec),
      "-t",
      String(args.sampleSec),
      "-i",
      videoFile,
      "-ac",
      "1",
      "-ar",
      "16000",
      wavFile,
    ];
    console.log(`Running ffmpeg -> ${wavFile}`);
    runChecked("ffmpeg", ffmpegArgs);

    const whisperArgs = [
      wavFile,
      "--model",
      args.model,
      "--language",
      args.language,
      "--task",
      "transcribe",
      "--output_format",
      "json",
      "--output_dir",
      args.workDir,
    ];
    console.log(`Running whisper -> ${asrJson}`);
    runChecked(args.whisperBin, whisperArgs);

    if (!fs.existsSync(asrJson)) {
      throw new Error(`Whisper JSON not found at ${asrJson}`);
    }

    const estimateArgs = [
      "scripts/estimate-sub-offset.js",
      "--subFile",
      subFile,
      "--asrJson",
      asrJson,
      "--sampleSec",
      String(args.sampleSec),
      "--windowStartSec",
      String(windowStartSec),
      ...args.estimateArgs,
      "--verbose",
    ];

    try {
      const est = runChecked("node", estimateArgs, { capture: true });
      process.stdout.write(est.stdout);
      if (est.stderr) process.stderr.write(est.stderr);

      estimateSummary = parseEstimateSummary(est.stdout);
      offsetMs = estimateSummary.offsetMs;
      if (!Number.isFinite(offsetMs)) {
        throw new Error("Failed to parse estimated offset from estimator output.");
      }

      const lowConfidence = estimateSummary.confidence === "low";
      if (lowConfidence && !args.allowLowConfidence && attempt < args.maxAttempts) {
        windowStartSec += args.sampleSec;
        console.log("Low-confidence estimate; retrying next window.");
        console.log("");
        continue;
      }

      lastErr = null;
      break;
    } catch (err) {
      const text = String(err?.message || err);
      const retryable =
        text.includes("No ASR segments found in sample window.") ||
        text.includes("No subtitle lines found in sample window.") ||
        text.includes("No alignable subtitle/ASR pairs found in sample window.");
      lastErr = err;
      if (!retryable || attempt >= args.maxAttempts) {
        throw err;
      }
      windowStartSec += args.sampleSec;
      console.log("No alignment in this window; retrying next window.");
      console.log("");
    }
  }

  if (!Number.isFinite(offsetMs)) {
    throw lastErr || new Error("Failed to estimate subtitle offset.");
  }

  if (args.apply && estimateSummary?.confidence === "low" && !args.allowLowConfidence) {
    throw new Error(
      `Estimated offset has low confidence (matched ${estimateSummary.matched}/${estimateSummary.total}). ` +
        "Re-run with higher sample/retries or pass --allowLowConfidence to force save.",
    );
  }

  if (!args.apply) {
    console.log("");
    console.log("Dry run mode. Offsets file not updated.");
    console.log(`To save it: npm run calibrate-sub-sync -- --episode ${episode} --apply`);
    return;
  }

  const offsets = loadOffsets(args.offsetsFile);
  offsets.byEpisode[episode] = offsetMs;
  offsets.updatedAt = new Date().toISOString();
  saveOffsets(args.offsetsFile, offsets);

  console.log("");
  console.log(`Saved ${episode} => ${offsetMs} ms in ${args.offsetsFile}`);
  console.log("extract-clips will auto-use this file if present.");
}

main();
