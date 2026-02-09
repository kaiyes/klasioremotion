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
const DEFAULT_DB_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "sub-sync-db.json",
);
const DEFAULT_WORK_ROOT = path.join("dissfiles", "sub-sync");

function parseArgs(argv) {
  const args = {
    videosDir: DEFAULT_VIDEOS_DIR,
    jpSubsDir: DEFAULT_JP_SUBS_DIR,
    enSubsDir: RESOLVED_DEFAULT_EN_SUBS_DIR,
    offsetsFile: DEFAULT_OFFSETS_FILE,
    dbFile: DEFAULT_DB_FILE,
    workRoot: DEFAULT_WORK_ROOT,
    episodes: null,
    sampleSec: 1800,
    minOffsetMs: -12000,
    maxOffsetMs: 12000,
    coarseStepMs: 100,
    fineStepMs: 20,
    checkDurationSec: 60,
    checkEvery: 0,
    limit: 0,
    force: false,
    stopOnError: false,
    noWriteOffsets: false,
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
      case "dbFile":
        args.dbFile = v;
        takeNext();
        break;
      case "workRoot":
        args.workRoot = v;
        takeNext();
        break;
      case "episodes":
        args.episodes = v;
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
      case "checkDurationSec":
        args.checkDurationSec = Number(v);
        takeNext();
        break;
      case "checkEvery":
        args.checkEvery = Number(v);
        takeNext();
        break;
      case "limit":
        args.limit = Number(v);
        takeNext();
        break;
      case "force":
        args.force = true;
        break;
      case "stopOnError":
        args.stopOnError = true;
        break;
      case "noWriteOffsets":
        args.noWriteOffsets = true;
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

  if (!Number.isFinite(args.sampleSec) || args.sampleSec <= 0) {
    throw new Error("--sampleSec must be > 0");
  }
  if (!Number.isFinite(args.minOffsetMs) || !Number.isFinite(args.maxOffsetMs)) {
    throw new Error("--minOffsetMs/--maxOffsetMs must be numbers");
  }
  if (args.maxOffsetMs <= args.minOffsetMs) {
    throw new Error("--maxOffsetMs must be greater than --minOffsetMs");
  }
  if (!Number.isFinite(args.coarseStepMs) || args.coarseStepMs <= 0) {
    throw new Error("--coarseStepMs must be > 0");
  }
  if (!Number.isFinite(args.fineStepMs) || args.fineStepMs <= 0) {
    throw new Error("--fineStepMs must be > 0");
  }
  if (!Number.isFinite(args.checkEvery) || args.checkEvery < 0) {
    throw new Error("--checkEvery must be >= 0");
  }
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error("--limit must be >= 0");
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/align-all-episode-subs.js [options]

What it does:
  1) Finds episodes that exist in videos + JP subs + EN subs
  2) Runs align-episode-subs for each episode
  3) Writes a durable database JSON with JP/EN offsets + confidence
  4) Optionally writes offsets to sub-offsets.json (default: on)

Options:
  --videosDir <dir>      Default: ${DEFAULT_VIDEOS_DIR}
  --jpSubsDir <dir>      Default: ${DEFAULT_JP_SUBS_DIR}
  --enSubsDir <dir>      Default: ${DEFAULT_EN_SUBS_DIR}
  --offsetsFile <file>   Default: ${DEFAULT_OFFSETS_FILE}
  --dbFile <file>        Default: ${DEFAULT_DB_FILE}
  --workRoot <dir>       Default: ${DEFAULT_WORK_ROOT}
  --episodes <list>      Comma list, e.g. "s1e1,s4e30" (default: all)
  --sampleSec <n>        Default: 1800
  --minOffsetMs <n>      Default: -12000
  --maxOffsetMs <n>      Default: 12000
  --coarseStepMs <n>     Default: 100
  --fineStepMs <n>       Default: 20
  --checkEvery <n>       Render check clip every N episodes (default: 0 = none)
  --checkDurationSec <n> Check clip duration when enabled (default: 60)
  --limit <n>            Process only first N episodes after filtering (default: 0 = all)
  --force                Recompute episodes even if DB already has offsets
  --stopOnError          Stop immediately on first failed episode
  --noWriteOffsets       Do not update sub-offsets.json
  --verbose              Extra logs
`.trim() + "\n",
  );
  process.exit(code);
}

function normalizeEpisodeToken(value) {
  const m = String(value || "").match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function parseEpisodeTuple(token) {
  const m = String(token || "").match(/^s(\d+)e(\d+)$/i);
  if (!m) return { season: Number.POSITIVE_INFINITY, episode: Number.POSITIVE_INFINITY };
  return { season: Number(m[1]), episode: Number(m[2]) };
}

function compareEpisodeTokens(a, b) {
  const aa = parseEpisodeTuple(a);
  const bb = parseEpisodeTuple(b);
  if (aa.season !== bb.season) return aa.season - bb.season;
  return aa.episode - bb.episode;
}

function listFilesRecursive(root, allowedExts) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!allowedExts.includes(ext)) continue;
      out.push(p);
    }
  }
  out.sort();
  return out;
}

function collectEpisodeFileMap(root, exts) {
  const map = new Map();
  const files = listFilesRecursive(root, exts);
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    const episode = normalizeEpisodeToken(base);
    if (!episode) continue;
    if (!map.has(episode)) map.set(episode, f);
  }
  return map;
}

function parseEpisodeFilter(raw) {
  if (!raw) return null;
  const set = new Set();
  const parts = String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const part of parts) {
    const normalized = normalizeEpisodeToken(part);
    if (!normalized) {
      throw new Error(`Invalid episode token "${part}". Expected like s4e30.`);
    }
    set.add(normalized);
  }
  return set;
}

function initDb() {
  return {
    version: 1,
    method: "embedded-subtitle-reference-v1",
    generatedAt: new Date().toISOString(),
    updatedAt: null,
    config: {},
    episodes: {},
    failures: {},
    summary: {},
  };
}

function loadDb(filePath) {
  if (!fs.existsSync(filePath)) return initDb();
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    version: Number(raw.version || 1),
    method: raw.method || "embedded-subtitle-reference-v1",
    generatedAt: raw.generatedAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || null,
    config: typeof raw.config === "object" && raw.config ? raw.config : {},
    episodes: typeof raw.episodes === "object" && raw.episodes ? raw.episodes : {},
    failures: typeof raw.failures === "object" && raw.failures ? raw.failures : {},
    summary: typeof raw.summary === "object" && raw.summary ? raw.summary : {},
  };
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hasOffsets(entry) {
  if (!entry || typeof entry !== "object") return false;
  return Number.isFinite(Number(entry.jpOffsetMs)) && Number.isFinite(Number(entry.enOffsetMs));
}

function isLowConfidence(conf) {
  return String(conf || "").toLowerCase() === "low";
}

function needsReviewByOffset(jpOffsetMs, enOffsetMs) {
  return (
    Math.abs(jpOffsetMs) > 5000 ||
    Math.abs(enOffsetMs) > 5000 ||
    Math.abs(jpOffsetMs - enOffsetMs) > 3500
  );
}

function runEpisodeAlign({ episode, args, renderCheck }) {
  const tempResultFile = path.resolve(args.workRoot, ".align_episode_result.json");
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
    "--minOffsetMs",
    String(args.minOffsetMs),
    "--maxOffsetMs",
    String(args.maxOffsetMs),
    "--coarseStepMs",
    String(args.coarseStepMs),
    "--fineStepMs",
    String(args.fineStepMs),
    "--offsetsFile",
    args.offsetsFile,
    "--resultJson",
    tempResultFile,
  ];

  if (!args.noWriteOffsets) cmdArgs.push("--write");

  if (renderCheck) {
    const checkOut = path.resolve(args.workRoot, "checks", `${episode}_check.mp4`);
    cmdArgs.push("--checkDurationSec", String(args.checkDurationSec), "--checkOut", checkOut);
  } else {
    cmdArgs.push("--noCheck");
  }
  if (args.verbose) cmdArgs.push("--verbose");

  const res = spawnSync("node", cmdArgs, { encoding: "utf8" });
  if (args.verbose && res.stdout) process.stdout.write(res.stdout);
  if (args.verbose && res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    const merged = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
    const tail = merged
      .split(/\r?\n/g)
      .slice(-30)
      .join("\n");
    return {
      ok: false,
      error: `align-episode-subs failed (exit ${res.status})`,
      tail,
    };
  }

  if (!fs.existsSync(tempResultFile)) {
    return {
      ok: false,
      error: `Expected result JSON not found: ${tempResultFile}`,
      tail: "",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(tempResultFile, "utf8"));
  } catch (err) {
    return {
      ok: false,
      error: `Failed parsing result JSON for ${episode}: ${err.message}`,
      tail: "",
    };
  } finally {
    try {
      fs.rmSync(tempResultFile, { force: true });
    } catch {
      // ignore
    }
  }

  return { ok: true, result: parsed };
}

function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(path.resolve(args.workRoot), { recursive: true });

  const videos = collectEpisodeFileMap(args.videosDir, [".mkv", ".mp4", ".mov", ".webm"]);
  const jpSubs = collectEpisodeFileMap(args.jpSubsDir, [".ass", ".srt"]);
  const enSubs = collectEpisodeFileMap(args.enSubsDir, [".ass", ".srt"]);

  const common = [];
  for (const episode of videos.keys()) {
    if (jpSubs.has(episode) && enSubs.has(episode)) {
      common.push(episode);
    }
  }
  common.sort(compareEpisodeTokens);

  const filter = parseEpisodeFilter(args.episodes);
  let episodes = filter ? common.filter((e) => filter.has(e)) : common;
  if (args.limit > 0) episodes = episodes.slice(0, args.limit);
  if (episodes.length === 0) {
    throw new Error("No episodes found with matching video + JP sub + EN sub.");
  }

  const dbPath = path.resolve(args.dbFile);
  const db = loadDb(dbPath);
  db.config = {
    videosDir: path.resolve(args.videosDir),
    jpSubsDir: path.resolve(args.jpSubsDir),
    enSubsDir: path.resolve(args.enSubsDir),
    offsetsFile: path.resolve(args.offsetsFile),
    sampleSec: args.sampleSec,
    minOffsetMs: args.minOffsetMs,
    maxOffsetMs: args.maxOffsetMs,
    coarseStepMs: args.coarseStepMs,
    fineStepMs: args.fineStepMs,
    checkEvery: args.checkEvery,
    checkDurationSec: args.checkDurationSec,
  };

  let processed = 0;
  let skipped = 0;
  let ok = 0;
  let needsReview = 0;
  let failed = 0;

  console.log(`Episodes detected (video+JP+EN): ${common.length}`);
  console.log(`Episodes selected for this run: ${episodes.length}`);
  if (args.force) console.log("Mode: force recompute");
  console.log(`DB: ${dbPath}`);
  console.log("");

  for (let i = 0; i < episodes.length; i++) {
    const episode = episodes[i];
    const existing = db.episodes[episode];
    if (!args.force && existing?.status === "ok" && hasOffsets(existing)) {
      skipped++;
      console.log(`[${String(i + 1).padStart(3, "0")}/${String(episodes.length).padStart(3, "0")}] ${episode} skip (already in DB)`);
      continue;
    }

    const renderCheck = args.checkEvery > 0 && (i + 1) % args.checkEvery === 0;
    console.log(`[${String(i + 1).padStart(3, "0")}/${String(episodes.length).padStart(3, "0")}] ${episode} align${renderCheck ? " +check" : ""}`);

    const run = runEpisodeAlign({ episode, args, renderCheck });
    processed++;
    if (!run.ok) {
      failed++;
      db.failures[episode] = {
        status: "error",
        updatedAt: new Date().toISOString(),
        error: run.error,
        tail: run.tail,
      };
      db.episodes[episode] = {
        status: "error",
        updatedAt: new Date().toISOString(),
        videoFile: videos.get(episode),
        jpSubFile: jpSubs.get(episode),
        enSubFile: enSubs.get(episode),
      };
      saveJson(dbPath, db);
      console.log(`  ERROR: ${run.error}`);
      if (run.tail) console.log(`  tail: ${run.tail.split(/\r?\n/g)[0]}`);
      if (args.stopOnError) {
        throw new Error(`Stopped on first error at ${episode}`);
      }
      continue;
    }

    const result = run.result;
    const jpOffsetMs = Number(result.jp?.offsetMs || 0);
    const enOffsetMs = Number(result.en?.offsetMs || 0);
    const confidenceLow =
      isLowConfidence(result.jp?.confidence) || isLowConfidence(result.en?.confidence);
    const reviewFlag = needsReviewByOffset(jpOffsetMs, enOffsetMs);
    db.episodes[episode] = {
      status: reviewFlag ? "needs_review" : "ok",
      updatedAt: new Date().toISOString(),
      videoFile: result.videoFile || videos.get(episode),
      jpSubFile: result.jpSubFile || jpSubs.get(episode),
      enSubFile: result.enSubFile || enSubs.get(episode),
      sampleSec: Number(result.sampleSec || args.sampleSec),
      jpOffsetMs,
      enOffsetMs,
      jpConfidence: result.jp?.confidence || "unknown",
      enConfidence: result.en?.confidence || "unknown",
      confidenceLow,
      jpOverlapRatio: Number(result.jp?.overlapRatio || 0),
      enOverlapRatio: Number(result.en?.overlapRatio || 0),
      checkClip: result.check?.output || null,
    };
    delete db.failures[episode];
    saveJson(dbPath, db);

    if (reviewFlag) needsReview++;
    else ok++;

    const rec = db.episodes[episode];
    console.log(
      `  jp=${rec.jpOffsetMs}ms (${rec.jpConfidence}) | en=${rec.enOffsetMs}ms (${rec.enConfidence})`,
    );
  }

  db.updatedAt = new Date().toISOString();
  db.summary = {
    selected: episodes.length,
    processed,
    skipped,
    ok,
    needsReview,
    failed,
  };
  saveJson(dbPath, db);

  console.log("");
  console.log("Batch alignment complete.");
  console.log(`Selected: ${episodes.length}`);
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`OK: ${ok}`);
  console.log(`Needs review: ${needsReview}`);
  console.log(`Failed: ${failed}`);
  console.log(`DB saved: ${dbPath}`);
  if (!args.noWriteOffsets) {
    console.log(`Offsets saved: ${path.resolve(args.offsetsFile)}`);
  }

  if (failed > 0) process.exit(2);
}

main();
