#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parseArgs(argv) {
  const args = {
    base: "",
    target: "",
    cacheDir: "out/family_audio_cache",
    subsDir: "source_content/shingeki_no_kyojin/subs/japanese",
    enSubsDir: "source_content/shingeki_no_kyojin/subs/english_embedded",
    videosDir: "source_content/shingeki_no_kyojin/videos",
    wordList: "source_content/all_anime_top_2000.match.first2000.json",
    outDir: "out/shorts_work",
    outputDir: "out/shorts",
    layout: "standard",
    meaning: "",
    reading: "",
    romaji: "",
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
    if (!a.startsWith("--")) continue;
    const [k, maybeV] = a.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };
    switch (k) {
      case "base":
        args.base = String(v || "").trim();
        takeNext();
        break;
      case "target":
        args.target = String(v || "").trim();
        takeNext();
        break;
      case "cacheDir":
        args.cacheDir = String(v || "").trim();
        takeNext();
        break;
      case "subsDir":
        args.subsDir = String(v || "").trim();
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = String(v || "").trim();
        takeNext();
        break;
      case "videosDir":
        args.videosDir = String(v || "").trim();
        takeNext();
        break;
      case "wordList":
        args.wordList = String(v || "").trim();
        takeNext();
        break;
      case "outDir":
        args.outDir = String(v || "").trim();
        takeNext();
        break;
      case "outputDir":
        args.outputDir = String(v || "").trim();
        takeNext();
        break;
      case "layout":
        args.layout = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "meaning":
        args.meaning = String(v || "").trim();
        takeNext();
        break;
      case "reading":
        args.reading = String(v || "").trim();
        takeNext();
        break;
      case "romaji":
        args.romaji = String(v || "").trim();
        takeNext();
        break;
      case "verbose":
        args.verbose = true;
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
  node scripts/render-family-cache-one.js --base <word> --target <family> [options]

What it does:
  - Reads cached family picks from: <cacheDir>/<base>__<target>.json
  - Renders exactly that one family short into outputDir
  - No AV rerun, no QR, no end card

Options:
  --base <word>          Base word used for cache key (required)
  --target <text>        Family target to render (required)
  --meaning <text>       Override top-card meaning
  --reading <text>       Override top-card reading
  --romaji <text>        Override top-card romaji
  --cacheDir <dir>       Default: out/family_audio_cache
  --subsDir <dir>        Default: source_content/shingeki_no_kyojin/subs/japanese
  --enSubsDir <dir>      Default: source_content/shingeki_no_kyojin/subs/english_embedded
  --videosDir <dir>      Default: source_content/shingeki_no_kyojin/videos
  --wordList <file>      Default: source_content/all_anime_top_2000.match.first2000.json
  --outDir <dir>         Default: out/shorts_work
  --outputDir <dir>      Default: out/shorts
  --layout <name>        standard|instagram (default: standard)
  --verbose              Print command before running
`.trim() + "\n",
  );
  process.exit(code);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.base) fail("Missing required --base");
  if (!args.target) fail("Missing required --target");

  const cacheFile = path.join(args.cacheDir, `${args.base}__${args.target}.json`);
  if (!fs.existsSync(cacheFile)) {
    fail(`Cache not found: ${cacheFile}`);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    fail(`Invalid cache JSON: ${cacheFile}`);
  }

  const selected = Array.isArray(payload?.selected) ? payload.selected : [];
  const pick = selected
    .map((x) => Number(x?.candidateIndex || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .join(",");
  if (!pick) {
    fail(`No selected candidate indices in cache: ${cacheFile}`);
  }

  const cmd = [
    "node",
    "scripts/make-vertical-shorts-clean.js",
    "--query",
    args.target,
    "--subsDir",
    args.subsDir,
    "--enSubsDir",
    args.enSubsDir,
    "--videosDir",
    args.videosDir,
    "--wordList",
    args.wordList,
    "--outDir",
    args.outDir,
    "--outputDir",
    args.outputDir,
    "--layout",
    args.layout,
    "--rank",
    "--candidatesIn",
    cacheFile,
    "--pick",
    pick,
    "--noAutoReplaceBad",
    "--noQr",
    "--noEndCard",
    "--keepOutputs",
  ];

  if (args.reading) cmd.push("--reading", args.reading);
  if (args.romaji) cmd.push("--romaji", args.romaji);
  if (args.meaning) cmd.push("--meaning", args.meaning);
  if (args.verbose) cmd.push("--verbose");

  if (args.verbose) {
    console.log(cmd.join(" "));
  }
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

main();
