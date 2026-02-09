#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_OUT_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);

function parseArgs(argv) {
  const args = {
    videosDir: DEFAULT_VIDEOS_DIR,
    outDir: DEFAULT_OUT_DIR,
    episodes: null,
    overwrite: false,
    dryRun: false,
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
      case "outDir":
        args.outDir = v;
        takeNext();
        break;
      case "episodes":
        args.episodes = v;
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
        throw new Error(`Unknown arg --${k}`);
    }
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/extract-embedded-english-subs.js [options]

What it does:
  - Reads each video's embedded subtitle streams
  - Picks the best English dialog/full stream
  - Extracts it to sXeY.srt

Options:
  --videosDir <dir>   Default: ${DEFAULT_VIDEOS_DIR}
  --outDir <dir>      Default: ${DEFAULT_OUT_DIR}
  --episodes <list>   Comma list, e.g. s3e11,s3e12 (default: all)
  --overwrite         Replace existing output files
  --dryRun            Print what would run, no extraction
  --verbose           Extra logs
`.trim() + "\n",
  );
  process.exit(code);
}

function normalizeEpisodeToken(s) {
  const m = String(s || "").match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function parseEpisodeFilter(raw) {
  if (!raw) return null;
  const set = new Set();
  const parts = String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const part of parts) {
    const token = normalizeEpisodeToken(part);
    if (!token) throw new Error(`Invalid episode token "${part}"`);
    set.add(token);
  }
  return set;
}

function listFilesRecursive(root, exts) {
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
      if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
      out.push(p);
    }
  }
  out.sort();
  return out;
}

function commandOutput(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function runChecked(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit", encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function getSubtitleStreams(file) {
  const out = commandOutput("ffprobe", ["-v", "error", "-of", "json", "-show_streams", file]);
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

function pickEnglishDialogStream(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return null;
  let best = null;
  for (const s of streams) {
    let score = 0;
    if (s.language === "eng") score += 120;
    if (s.dispositionDefault) score += 25;
    if (/full|dialog|subtitle|subtitles|complete|complet/.test(s.title)) score += 35;
    if (/sign|song|forced/.test(s.title)) score -= 150;
    if (s.codecName === "ass") score += 5;
    if (!best || score > best.score) best = { ...s, score };
  }
  return best;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.videosDir)) throw new Error(`videosDir not found: ${args.videosDir}`);

  const filter = parseEpisodeFilter(args.episodes);
  const videos = listFilesRecursive(args.videosDir, [".mkv", ".mp4", ".mov", ".webm"])
    .map((f) => ({ file: f, episode: normalizeEpisodeToken(path.basename(f, path.extname(f))) }))
    .filter((x) => x.episode);

  const selected = filter ? videos.filter((v) => filter.has(v.episode)) : videos;
  if (selected.length === 0) {
    throw new Error("No matching episode videos found.");
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const { file, episode } of selected) {
    const outFile = path.join(args.outDir, `${episode}.srt`);
    if (fs.existsSync(outFile) && !args.overwrite) {
      skipped++;
      console.log(`${episode}: skip (exists)`);
      continue;
    }

    const streams = getSubtitleStreams(file);
    const pick = pickEnglishDialogStream(streams);
    if (!pick) {
      failed++;
      console.log(`${episode}: fail (no subtitle streams)`);
      continue;
    }

    const ffArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-map",
      `0:${pick.index}`,
      "-c:s",
      "srt",
      outFile,
    ];
    if (args.verbose || args.dryRun) {
      console.log(
        `${episode}: stream #${pick.index} lang=${pick.language || "?"} codec=${pick.codecName} title=${pick.title || "(no title)"}`,
      );
      console.log(`  ffmpeg ${ffArgs.join(" ")}`);
    } else {
      console.log(`${episode}: stream #${pick.index} -> ${path.basename(outFile)}`);
    }

    if (args.dryRun) {
      ok++;
      continue;
    }

    try {
      runChecked("ffmpeg", ffArgs);
      ok++;
    } catch (err) {
      failed++;
      console.log(`${episode}: fail (${err.message})`);
    }
  }

  console.log("");
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`Output dir: ${path.resolve(args.outDir)}`);
  if (failed > 0) process.exit(2);
}

main();
