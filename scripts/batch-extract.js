#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch extract + stitch for the first N words in a JSON list.
 *
 * Example:
 *   node scripts/batch-extract.js --count 10 \
 *     --wordsFile source_content/all_anime_top_2000.match.first2000.json \
 *     --subsDir source_content/shingeki_no_kyojin/subs/japanese \
 *     --videosDir source_content/shingeki_no_kyojin/videos \
 *     --limit 5 --concat --flatOut --concatOnly
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");

function parseArgs(argv) {
  const args = {
    wordsFile: "source_content/all_anime_top_2000.match.first2000.json",
    count: 10,
    subsDir: null,
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : null,
    limit: 5,
    outDir: "out/clips",
    concat: true,
    flatOut: true,
    concatOnly: true,
    continueOnMissing: true,
    extra: [],
  };

  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const [key, maybeValue] = a.slice(2).split("=");
    const value = maybeValue ?? argv[i + 1];
    const takeNext = () => {
      if (maybeValue != null) return;
      i++;
    };

    switch (key) {
      case "wordsFile":
        args.wordsFile = value;
        takeNext();
        break;
      case "count":
        args.count = Number(value);
        takeNext();
        break;
      case "subsDir":
        args.subsDir = value;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = value;
        takeNext();
        break;
      case "limit":
        args.limit = Number(value);
        takeNext();
        break;
      case "outDir":
        args.outDir = value;
        takeNext();
        break;
      case "concat":
        args.concat = true;
        break;
      case "no-concat":
        args.concat = false;
        break;
      case "flatOut":
        args.flatOut = true;
        break;
      case "no-flatOut":
        args.flatOut = false;
        break;
      case "concatOnly":
        args.concatOnly = true;
        break;
      case "no-concatOnly":
        args.concatOnly = false;
        break;
      case "continueOnMissing":
        args.continueOnMissing = true;
        break;
      case "no-continueOnMissing":
        args.continueOnMissing = false;
        break;
      case "extra":
        args.extra.push(value);
        takeNext();
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        // forward unknown args to extract-clips
        args.extra.push(`--${key}`);
        if (maybeValue == null && argv[i + 1] && !argv[i + 1].startsWith("--")) {
          args.extra.push(argv[i + 1]);
          i++;
        } else if (maybeValue != null) {
          args.extra.push(value);
        }
        break;
    }
  }

  if (rest.length > 0) {
    console.error(`Unexpected positional args: ${rest.join(" ")}`);
    printHelpAndExit(1);
  }

  if (!args.subsDir) {
    console.error("--subsDir is required");
    printHelpAndExit(1);
  }
  if (!args.videosDir) {
    console.error(
      `--videosDir is required (or place videos in default: ${DEFAULT_VIDEOS_DIR})`,
    );
    printHelpAndExit(1);
  }

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/batch-extract.js --count 10 \\
    --wordsFile source_content/all_anime_top_2000.match.first2000.json \\
    --subsDir source_content/shingeki_no_kyojin/subs/japanese \\
    --videosDir source_content/shingeki_no_kyojin/videos \\
    --limit 5 --concat --flatOut --concatOnly

Options:
  --wordsFile   JSON file with [{ word, ... }]
  --count       Number of words to process (default: 10)
  --subsDir     Japanese subtitle directory (required)
  --videosDir   Video directory (default: ${DEFAULT_VIDEOS_DIR} if present)
  --limit       Clips per word (default: 5)
  --outDir      Output directory for clips (default: out/clips)
  --concat      Stitch clips (default: on)
  --flatOut     Write outputs into --outDir (default: on)
  --concatOnly  Delete per-clip files after stitching (default: on)
  --continueOnMissing Continue when a word has no matches (default: on)
  --extra       Pass-through extra arg to extract-clips (repeatable)

Any unknown --flags will be forwarded to extract-clips.
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function loadWords(filePath, count) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("Words file must be a JSON array");
  }
  return data.slice(0, count).map((x) => x.word).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv);
  const words = loadWords(args.wordsFile, args.count);
  if (words.length === 0) {
    console.error("No words found.");
    process.exit(2);
  }

  let ok = 0;
  let missing = 0;
  let failed = 0;

  for (const word of words) {
    console.log("");
    console.log(`==> ${word}`);

    const cmd = path.join("scripts", "extract-clips.js");
    const cliArgs = [
      cmd,
      "--query",
      word,
      "--subsDir",
      args.subsDir,
      "--videosDir",
      args.videosDir,
      "--limit",
      String(args.limit),
      "--outDir",
      args.outDir,
    ];

    if (args.concat) cliArgs.push("--concat");
    if (args.flatOut) cliArgs.push("--flatOut");
    if (args.concatOnly) cliArgs.push("--concatOnly");
    if (args.extra.length) cliArgs.push(...args.extra);

    const res = spawnSync(process.execPath, cliArgs, { stdio: "inherit" });
    if (res.status !== 0) {
      // extract-clips uses exit code 2 when no matches were found.
      if (res.status === 2 && args.continueOnMissing) {
        missing++;
        console.log(`Skipping (no matches): ${word}`);
        continue;
      }
      failed++;
      console.error(`Failed for word: ${word}`);
      process.exit(res.status ?? 1);
    }
    ok++;
  }

  console.log("");
  console.log(`Batch complete. words=${words.length}, ok=${ok}, missing=${missing}, failed=${failed}`);
}

main();
