#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const PRIMARY_WORDS_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.first2000.json",
);
const FALLBACK_WORDS_FILE = path.join(
  "source_content",
  "all_anime_top_2000.json",
);

function parseArgs(argv) {
  const args = {
    videosDir: path.join(process.cwd(), "out", "shorts"),
    wordsFile: null,
    fallbackWordsFile: null,
    dryRun: false,
    padWidth: 3,
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
        args.videosDir = path.resolve(v);
        takeNext();
        break;
      case "wordsFile":
        args.wordsFile = path.resolve(v);
        takeNext();
        break;
      case "fallbackWordsFile":
        args.fallbackWordsFile = path.resolve(v);
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "padWidth":
        args.padWidth = Number(v || 3);
        takeNext();
        break;
      case "help":
      case "h":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  if (!Number.isFinite(args.padWidth) || args.padWidth < 1) {
    throw new Error("--padWidth must be a positive number.");
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node number-videos-by-json-index.js [options]

Options:
  --videosDir <dir>          Input dir with .mp4 files (default: current directory)
  --wordsFile <file>         Word list JSON file (default: auto-detected primary)
  --fallbackWordsFile <file> Fallback word list JSON (default: auto-detected fallback)
  --dryRun                   Show what would be renamed without actually renaming
  --padWidth <n>             Number of digits for padding (default: 3 = 001, 002)
  --help                     Show this help

Example:
  node number-videos-by-json-index.js --videosDir . --dryRun
  node number-videos-by-json-index.js --videosDir . --padWidth 4
`.trim() + "\n",
  );
  process.exit(code);
}

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const hasPackage = fs.existsSync(path.join(current, "package.json"));
    const hasSourceContent = fs.existsSync(
      path.join(current, "source_content"),
    );
    if (hasPackage && hasSourceContent) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeWordsPayload(payload, filePath) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.words)) return payload.words;
  throw new Error(
    `Words JSON must be an array (or {words:[...]}) -> ${filePath}`,
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseVideoFilename(fileName) {
  const stem = fileName.replace(/\.[^.]+$/u, "");
  let number = null;
  let rest = stem;

  const numbered = stem.match(/^(\d+)_/u);
  if (numbered) {
    number = Number(numbered[1]);
    rest = stem.slice(numbered[0].length);
  }

  const word = String(rest.split(".")[0] || "").trim();
  return { number, word };
}

function padNumber(num, width) {
  return String(num).padStart(width, "0");
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = findRepoRoot(process.cwd());

  const wordsPrimary = args.wordsFile
    ? args.wordsFile
    : repoRoot
      ? path.join(repoRoot, PRIMARY_WORDS_FILE)
      : null;
  const wordsFallback = args.fallbackWordsFile
    ? args.fallbackWordsFile
    : repoRoot
      ? path.join(repoRoot, FALLBACK_WORDS_FILE)
      : null;

  const wordsFileToUse =
    wordsPrimary && fs.existsSync(wordsPrimary)
      ? wordsPrimary
      : wordsFallback && fs.existsSync(wordsFallback)
        ? wordsFallback
        : null;

  if (!wordsFileToUse) {
    throw new Error(
      "Could not find a words file. Pass --wordsFile explicitly or run this under the remotionVideos repo.",
    );
  }

  if (!fs.existsSync(args.videosDir)) {
    throw new Error(`videosDir not found: ${args.videosDir}`);
  }

  const words = normalizeWordsPayload(readJson(wordsFileToUse), wordsFileToUse);
  const byWord = new Map(
    words.map((item) => [String(item.word || "").trim(), item]),
  );

  const videoFiles = fs
    .readdirSync(args.videosDir)
    .filter((name) => name.toLowerCase().endsWith(".mp4"));

  const renamed = [];
  const skipped = [];
  const errors = [];

  for (const videoFile of videoFiles) {
    const { number, word } = parseVideoFilename(videoFile);
    if (!word) {
      skipped.push({
        videoFile,
        reason: "Could not parse word from filename.",
      });
      continue;
    }
    const entry = byWord.get(word);
    if (!entry) {
      skipped.push({
        videoFile,
        word,
        reason: "Word not found in words file.",
      });
      continue;
    }

    const wordIndex = words.findIndex((item) => item === entry);
    if (wordIndex < 0) {
      skipped.push({
        videoFile,
        word,
        reason: "Word not found in words array.",
      });
      continue;
    }

    const newNumber = wordIndex + 1;

    if (Number.isFinite(number)) {
      skipped.push({
        videoFile,
        word,
        currentNumber: number,
        newNumber,
        reason: `Already numbered as ${number}.`,
      });
      continue;
    }

    const ext = path.extname(videoFile);
    const newFilename = `${padNumber(newNumber, args.padWidth)}_${videoFile}`;
    const oldPath = path.join(args.videosDir, videoFile);
    const newPath = path.join(args.videosDir, newFilename);

    if (args.dryRun) {
      renamed.push({
        videoFile,
        newFilename,
        word,
        number: newNumber,
        action: "DRY RUN",
      });
    } else {
      try {
        fs.renameSync(oldPath, newPath);
        renamed.push({
          videoFile,
          newFilename,
          word,
          number: newNumber,
          action: "RENAMED",
        });
      } catch (err) {
        errors.push({
          videoFile,
          newFilename,
          word,
          number: newNumber,
          error: err.message,
        });
      }
    }
  }

  console.log(`\nTotal videos found: ${videoFiles.length}`);
  console.log(`Renamed (or would rename): ${renamed.length}`);
  console.log(`Skipped: ${skipped.length}`);
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
  }

  if (renamed.length) {
    console.log("\nRenamed files:");
    for (const item of renamed) {
      console.log(
        `  ${item.action}: ${item.videoFile} → ${item.newFilename} (${item.word} = No ${item.number})`,
      );
    }
  }

  if (skipped.length) {
    console.log("\nSkipped files:");
    for (const item of skipped) {
      const detail =
        item.currentNumber !== undefined
          ? ` (${item.word}: No ${item.currentNumber} → would be No ${item.newNumber})`
          : ` (${item.word})`;
      console.log(`  ${item.videoFile}: ${item.reason}${detail}`);
    }
  }

  if (errors.length) {
    console.log("\nErrors:");
    for (const item of errors) {
      console.log(`  ${item.videoFile} → ${item.newFilename}: ${item.error}`);
    }
  }

  console.log(`\nWords source: ${wordsFileToUse}`);
  if (args.dryRun) {
    console.log("(DRY RUN mode - no files were actually renamed)");
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
