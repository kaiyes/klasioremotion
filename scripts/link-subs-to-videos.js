#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_FLAT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_SUBS_DIR = "source_content/shingeki_no_kyojin/subs/japanese";

function parseArgs(argv) {
  const args = {
    flatVideosDir: DEFAULT_FLAT_VIDEOS_DIR,
    subsDir: DEFAULT_SUBS_DIR,
    outDir: DEFAULT_FLAT_VIDEOS_DIR,
    mode: "link", // link | copy
    overwrite: false,
    dryRun: false,
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
      case "flatVideosDir":
        args.flatVideosDir = value;
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

  if (!["link", "copy"].includes(args.mode)) {
    throw new Error("--mode must be one of: link, copy");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/link-subs-to-videos.js [options]

Options:
  --flatVideosDir  Flat videos folder containing S01ep01.* (default: ${DEFAULT_FLAT_VIDEOS_DIR})
  --subsDir        Subtitle folder root (default: ${DEFAULT_SUBS_DIR})
  --outDir         Destination folder for renamed subtitles (default: same as --flatVideosDir)
  --mode           link | copy (default: link)
  --overwrite      Replace destination file if it exists
  --dryRun         Preview operations only
  --verbose        Print additional diagnostics
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
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
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

function parseSeasonEpisodeFromName(nameOrPath) {
  const base = path.basename(nameOrPath, path.extname(nameOrPath));
  const m1 = base.match(/s(\d{1,2})\s*e?p?(\d{1,3})/i);
  if (m1) return { season: Number(m1[1]), episode: Number(m1[2]) };
  const m2 = base.match(/(\d{1,2})x(\d{1,3})/i);
  if (m2) return { season: Number(m2[1]), episode: Number(m2[2]) };
  const m3 = base.match(/^\s*(\d{1,3})\s*[._-]/);
  if (m3) {
    const season = detectSeasonFromPath(nameOrPath);
    if (season != null) return { season, episode: Number(m3[1]) };
  }
  return null;
}

function buildFlatVideoKeySet(flatVideosDir) {
  const files = fs
    .readdirSync(flatVideosDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const keys = new Set();
  for (const f of files) {
    const m = f.match(/^S(\d{2})ep(\d{2,3})\./i);
    if (m) keys.add(`S${m[1]}E${String(Number(m[2])).padStart(2, "0")}`);
  }
  return keys;
}

function applyAction({ mode, src, dst }) {
  if (mode === "copy") {
    fs.copyFileSync(src, dst);
    return;
  }
  try {
    fs.symlinkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.flatVideosDir)) {
    throw new Error(`flat videos dir not found: ${args.flatVideosDir}`);
  }
  if (!fs.existsSync(args.subsDir)) {
    throw new Error(`subs dir not found: ${args.subsDir}`);
  }
  ensureDir(args.outDir);

  const keys = buildFlatVideoKeySet(args.flatVideosDir);
  const subs = listFilesRecursive(args.subsDir).filter((f) => /\.(ass|srt)$/i.test(f));
  let written = 0;
  let missingVideo = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const src of subs) {
    const info = parseSeasonEpisodeFromName(src);
    if (!info) {
      noMatch++;
      if (args.verbose) console.log(`NO MATCH: ${src}`);
      continue;
    }
    const key = `S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
    if (!keys.has(key)) {
      missingVideo++;
      if (args.verbose) console.log(`NO VIDEO for ${key}: ${src}`);
      continue;
    }

    const ext = path.extname(src).toLowerCase().replace(/^\./, "") || "ass";
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
  console.log(`Done. Sub files scanned: ${subs.length}`);
  console.log(
    `Written: ${written}, skipped existing: ${skipped}, no match: ${noMatch}, missing video: ${missingVideo}`,
  );
}

main();
