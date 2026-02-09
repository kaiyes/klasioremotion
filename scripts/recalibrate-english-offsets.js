#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
const DEFAULT_WORK_ROOT = path.join("dissfiles", "sub-sync", "en-only");

function parseArgs(argv) {
  const args = {
    episodes: "",
    videosDir: DEFAULT_VIDEOS_DIR,
    jpSubsDir: DEFAULT_JP_SUBS_DIR,
    enSubsDir: RESOLVED_DEFAULT_EN_SUBS_DIR,
    offsetsFile: DEFAULT_OFFSETS_FILE,
    sampleSec: 1200,
    checkDurationSec: 60,
    renderChecks: true,
    workRoot: DEFAULT_WORK_ROOT,
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
      case "episodes":
        args.episodes = String(v || "");
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
      case "offsetsFile":
        args.offsetsFile = v;
        takeNext();
        break;
      case "sampleSec":
        args.sampleSec = Number(v);
        takeNext();
        break;
      case "checkDurationSec":
        args.checkDurationSec = Number(v);
        takeNext();
        break;
      case "noChecks":
        args.renderChecks = false;
        break;
      case "workRoot":
        args.workRoot = v;
        takeNext();
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

  if (!args.episodes.trim()) {
    throw new Error("--episodes is required. Example: --episodes s3e11,s3e12");
  }
  if (!Number.isFinite(args.sampleSec) || args.sampleSec <= 0) {
    throw new Error("--sampleSec must be > 0");
  }
  if (!Number.isFinite(args.checkDurationSec) || args.checkDurationSec <= 0) {
    throw new Error("--checkDurationSec must be > 0");
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/recalibrate-english-offsets.js --episodes s3e11,s3e12 [options]

What it does:
  - Re-estimates EN offsets for selected episodes
  - Keeps JP offsets untouched
  - Optionally renders 60s check clips

Options:
  --episodes <list>      Required comma list, e.g. s3e11,s3e12
  --videosDir <dir>      Default: ${DEFAULT_VIDEOS_DIR}
  --jpSubsDir <dir>      Default: ${DEFAULT_JP_SUBS_DIR}
  --enSubsDir <dir>      Default: ${DEFAULT_EN_SUBS_DIR}
  --offsetsFile <file>   Default: ${DEFAULT_OFFSETS_FILE}
  --sampleSec <n>        Default: 1200
  --checkDurationSec <n> Default: 60
  --noChecks             Skip rendering check clips
  --workRoot <dir>       Default: ${DEFAULT_WORK_ROOT}
  --verbose              Extra logs
`.trim() + "\n",
  );
  process.exit(code);
}

function normalizeEpisodeToken(s) {
  const m = String(s || "").match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function loadOffsets(filePath) {
  if (!fs.existsSync(filePath)) {
    return { default: 0, byEpisode: {}, jpByEpisode: {}, enByEpisode: {} };
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

function runAlignEpisode({ episode, args, resultJson, checkOut }) {
  const cmdArgs = [
    "scripts/align-episode-subs.js",
    "--episode",
    episode,
    "--videosDir",
    args.videosDir,
    "--jpSubsDir",
    args.jpSubsDir,
    "--enSubsDir",
    args.enSubsDir,
    "--sampleSec",
    String(args.sampleSec),
    "--resultJson",
    resultJson,
  ];
  if (args.renderChecks) {
    cmdArgs.push("--checkDurationSec", String(args.checkDurationSec), "--checkOut", checkOut);
  } else {
    cmdArgs.push("--noCheck");
  }
  if (args.verbose) cmdArgs.push("--verbose");

  const res = spawnSync("node", cmdArgs, { encoding: "utf8" });
  if (args.verbose && res.stdout) process.stdout.write(res.stdout);
  if (args.verbose && res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    const detail = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
    throw new Error(`align-episode-subs failed for ${episode}\n${detail}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const episodes = args.episodes
    .split(",")
    .map((x) => normalizeEpisodeToken(x))
    .filter(Boolean);
  if (episodes.length === 0) {
    throw new Error("No valid episodes passed in --episodes.");
  }

  const workRoot = path.resolve(args.workRoot);
  const resultsDir = path.join(workRoot, "results");
  const checksDir = path.resolve("dissfiles", "sub-sync", "checks");
  fs.mkdirSync(resultsDir, { recursive: true });
  if (args.renderChecks) fs.mkdirSync(checksDir, { recursive: true });

  const offsetsPath = path.resolve(args.offsetsFile);
  const offsets = loadOffsets(offsetsPath);

  const updated = [];
  for (const ep of episodes) {
    const resultJson = path.join(resultsDir, `${ep}.json`);
    const checkOut = path.join(checksDir, `${ep}_check.mp4`);
    console.log(`Recalibrating EN offset: ${ep}`);
    runAlignEpisode({
      episode: ep,
      args,
      resultJson,
      checkOut,
    });
    const result = JSON.parse(fs.readFileSync(resultJson, "utf8"));
    const enOffset = Number(result.en?.offsetMs || 0);
    offsets.enByEpisode[ep] = enOffset;
    offsets.updatedAt = new Date().toISOString();
    updated.push({
      episode: ep,
      enOffsetMs: enOffset,
      confidence: result.en?.confidence || "unknown",
      check: args.renderChecks ? checkOut : null,
    });
    console.log(`  EN offset -> ${enOffset} ms (${result.en?.confidence || "unknown"})`);
  }

  saveOffsets(offsetsPath, offsets);
  console.log("");
  console.log(`Updated EN offsets in: ${offsetsPath}`);
  for (const row of updated) {
    console.log(`- ${row.episode}: en=${row.enOffsetMs}ms${row.check ? ` | check=${row.check}` : ""}`);
  }
}

main();
