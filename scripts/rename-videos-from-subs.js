#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_VIDEOS_ROOT = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_SUBS_DIR = "source_content/shingeki_no_kyojin/subs/japanese";
const DEFAULT_OUT_DIR = path.join("source_content", "shingeki_no_kyojin", "videos_flat");

function parseArgs(argv) {
  const args = {
    videosRoot: DEFAULT_VIDEOS_ROOT,
    subsDir: DEFAULT_SUBS_DIR,
    outDir: DEFAULT_OUT_DIR,
    mode: "copy", // copy | move | link
    overwrite: false,
    dryRun: false,
    forceExt: null, // e.g. mkv
    videoExts: [".mkv", ".mp4", ".webm", ".mov"],
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
      case "videosRoot":
        args.videosRoot = value;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = value;
        takeNext();
        break;
      case "outDir":
        args.outDir = value;
        takeNext();
        break;
      case "mode":
        args.mode = value;
        takeNext();
        break;
      case "forceExt":
        args.forceExt = String(value || "").replace(/^\./, "").toLowerCase();
        takeNext();
        break;
      case "videoExts":
        args.videoExts = String(value || "")
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
          .map((x) => (x.startsWith(".") ? x : `.${x}`));
        takeNext();
        break;
      case "overwrite":
        args.overwrite = true;
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
        throw new Error(`Unknown arg --${key}`);
    }
  }

  if (!["copy", "move", "link"].includes(args.mode)) {
    throw new Error("--mode must be one of: copy, move, link");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/rename-videos-from-subs.js [options]

Options:
  --videosRoot  Root folder containing season folders/videos (default: ${DEFAULT_VIDEOS_ROOT})
  --subsDir     Subtitle folder to map episodes from (default: ${DEFAULT_SUBS_DIR})
  --outDir      Flat output folder for renamed videos (default: ${DEFAULT_OUT_DIR})
  --mode        copy | move | link (default: copy)
  --forceExt    Force destination extension (example: mkv)
  --videoExts   Comma list of allowed video extensions (default: .mkv,.mp4,.webm,.mov)
  --overwrite   Replace destination file if it exists
  --dryRun      Print planned actions only
  --verbose     Print additional diagnostics
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function listFilesRecursive(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        out.push(p);
      }
    }
  }
  out.sort();
  return out;
}

function detectSeasonFromPath(filePath) {
  const parts = filePath.split(path.sep);
  for (const p of parts) {
    const m = p.match(/(?:season|s)\s*0?(\d{1,2})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function extractEpisodeKeyFromName(nameOrPath) {
  const base = path.basename(nameOrPath, path.extname(nameOrPath));
  const m1 = base.match(/s(\d{1,2})\s*e?p?(\d{1,3})/i);
  if (m1) {
    const s = Number(m1[1]);
    const e = Number(m1[2]);
    return {
      season: s,
      episode: e,
      key: `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`,
    };
  }
  const m2 = base.match(/^\s*(\d{1,3})\s*[._-]/);
  if (m2) {
    const ep = Number(m2[1]);
    return { season: null, episode: ep, key: `E${String(ep).padStart(2, "0")}` };
  }
  return null;
}

function buildVideoIndex(videosRoot, videoExts) {
  const files = listFilesRecursive(videosRoot);
  const byKey = new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!videoExts.includes(ext)) continue;
    const info = extractEpisodeKeyFromName(f);
    if (!info) continue;
    const inferredSeason = info.season ?? detectSeasonFromPath(f);
    if (inferredSeason != null) {
      const k = `S${String(inferredSeason).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
      if (!byKey.has(k)) byKey.set(k, f);
    }
    if (!byKey.has(info.key)) byKey.set(info.key, f);
  }
  return byKey;
}

function listSubtitleEpisodes(subsDir) {
  const files = listFilesRecursive(subsDir).filter((f) => /\.(ass|srt)$/i.test(f));
  const byKey = new Map();
  for (const f of files) {
    const info = extractEpisodeKeyFromName(f);
    if (!info) continue;
    if (!byKey.has(info.key)) byKey.set(info.key, info);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function resolveVideoForEpisode(epInfo, videoIndex) {
  if (epInfo.season != null) {
    const full = `S${String(epInfo.season).padStart(2, "0")}E${String(epInfo.episode).padStart(2, "0")}`;
    if (videoIndex.has(full)) return videoIndex.get(full);
  }
  if (videoIndex.has(epInfo.key)) return videoIndex.get(epInfo.key);
  if (epInfo.episode != null) {
    const suffix = `E${String(epInfo.episode).padStart(2, "0")}`;
    for (const [k, v] of videoIndex) {
      if (k.endsWith(suffix)) return v;
    }
  }
  return null;
}

function applyAction({ mode, src, dst }) {
  if (mode === "copy") {
    fs.copyFileSync(src, dst);
    return;
  }
  if (mode === "move") {
    try {
      fs.renameSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
    }
    return;
  }
  if (mode === "link") {
    try {
      fs.linkSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.videosRoot)) {
    throw new Error(`videos root not found: ${args.videosRoot}`);
  }
  if (!fs.existsSync(args.subsDir)) {
    throw new Error(`subs dir not found: ${args.subsDir}`);
  }
  ensureDir(args.outDir);

  const videoIndex = buildVideoIndex(args.videosRoot, args.videoExts);
  const episodes = listSubtitleEpisodes(args.subsDir);
  const missing = [];
  let written = 0;
  let skipped = 0;

  for (const ep of episodes) {
    const src = resolveVideoForEpisode(ep, videoIndex);
    if (!src) {
      missing.push(ep.key);
      continue;
    }
    const season = ep.season ?? 1;
    const episode = ep.episode ?? 0;
    const srcExt = path.extname(src).toLowerCase().replace(/^\./, "");
    const ext = args.forceExt || srcExt || "mkv";
    const outName = `S${String(season).padStart(2, "0")}ep${String(episode).padStart(2, "0")}.${ext}`;
    const dst = path.join(args.outDir, outName);

    if (fs.existsSync(dst) && !args.overwrite) {
      skipped++;
      if (args.verbose) console.log(`SKIP existing: ${dst}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`${args.mode.toUpperCase()} ${src} -> ${dst}`);
      written++;
      continue;
    }
    if (fs.existsSync(dst) && args.overwrite) fs.unlinkSync(dst);
    applyAction({ mode: args.mode, src, dst });
    written++;
    console.log(`${args.mode.toUpperCase()} ${src} -> ${dst}`);
  }

  console.log("");
  console.log(`Done. Episodes processed: ${episodes.length}`);
  console.log(`Written: ${written}, skipped existing: ${skipped}, missing: ${missing.length}`);
  if (missing.length > 0) {
    console.log(`Missing episode keys: ${missing.join(", ")}`);
  }
}

main();
