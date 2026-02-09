#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_VIDEOS_ROOT = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_OUT_DIR = path.join("source_content", "shingeki_no_kyojin", "videos_flat");

function parseArgs(argv) {
  const args = {
    videosRoot: DEFAULT_VIDEOS_ROOT,
    outDir: DEFAULT_OUT_DIR,
    mode: "move", // move | copy | link
    overwrite: false,
    dryRun: false,
    forceExt: null,
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

  if (!["move", "copy", "link"].includes(args.mode)) {
    throw new Error("--mode must be one of: move, copy, link");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/flatten-videos-by-episode.js [options]

Options:
  --videosRoot  Root folder with season subfolders/videos (default: ${DEFAULT_VIDEOS_ROOT})
  --outDir      Flat target folder (default: ${DEFAULT_OUT_DIR})
  --mode        move | copy | link (default: move)
  --forceExt    Force destination extension (example: mkv)
  --videoExts   Comma list of video extensions (default: .mkv,.mp4,.webm,.mov)
  --overwrite   Replace destination when it exists
  --dryRun      Preview operations only
  --verbose     Print extra diagnostics
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
  const parts = String(filePath).split(path.sep);
  for (const p of parts) {
    const m = p.match(/(?:season|s)\s*0?(\d{1,2})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function extractSeasonEpisode(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const m1 = base.match(/s(\d{1,2})\s*e?p?(\d{1,3})/i);
  if (m1) {
    return { season: Number(m1[1]), episode: Number(m1[2]) };
  }
  const m2 = base.match(/(\d{1,2})x(\d{1,3})/i);
  if (m2) {
    return { season: Number(m2[1]), episode: Number(m2[2]) };
  }
  const m3 = base.match(/^\s*(\d{1,3})\s*[._-]/);
  if (m3) {
    const season = detectSeasonFromPath(filePath);
    if (season != null) return { season, episode: Number(m3[1]) };
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
  ensureDir(args.outDir);

  const files = listFilesRecursive(args.videosRoot)
    .filter((f) => args.videoExts.includes(path.extname(f).toLowerCase()));

  const seen = new Set();
  let written = 0;
  let skipped = 0;
  let noMatch = 0;
  const collisions = [];

  for (const src of files) {
    const info = extractSeasonEpisode(src);
    if (!info) {
      noMatch++;
      if (args.verbose) console.log(`NO MATCH: ${src}`);
      continue;
    }
    const key = `S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
    if (seen.has(key)) {
      collisions.push(src);
      if (args.verbose) console.log(`COLLISION for ${key}: ${src}`);
      continue;
    }
    seen.add(key);

    const ext = args.forceExt || path.extname(src).toLowerCase().replace(/^\./, "") || "mkv";
    const outName = `S${String(info.season).padStart(2, "0")}ep${String(info.episode).padStart(2, "0")}.${ext}`;
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
    console.log(`${args.mode.toUpperCase()} ${src} -> ${dst}`);
    written++;
  }

  console.log("");
  console.log(`Done. Files scanned: ${files.length}`);
  console.log(`Written: ${written}, skipped existing: ${skipped}`);
  console.log(`No season/episode match: ${noMatch}, collisions: ${collisions.length}`);
}

main();
