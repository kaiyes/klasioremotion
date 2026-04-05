#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const PRIMARY_WORDS_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.first2000.json",
);
const CACHE_DIR = path.join("out", "family_audio_cache");

function parseArgs(argv) {
  const args = {
    videosDir: path.resolve("out", "shorts", "aot"),
    wordsFile: null,
    cacheDir: CACHE_DIR,
    dryRun: false,
    padWidth: 3,
    maxWordIndex: 300,
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
      case "cacheDir":
        args.cacheDir = path.resolve(v);
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "padWidth":
        args.padWidth = Number(v || 3);
        takeNext();
        break;
      case "maxWordIndex":
        args.maxWordIndex = Number(v || 300);
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

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node remap-family-to-base.js [options]

Options:
  --videosDir <dir>          Input dir with .mp4 files (default: out/shorts/aot)
  --wordsFile <file>         Word list JSON file (default: auto-detected)
  --cacheDir <dir>           Family audio cache dir (default: out/family_audio_cache)
  --dryRun                   Show what would be renamed without actually renaming
  --padWidth <n>             Number of digits for padding (default: 3)
  --maxWordIndex <n>         Max base word index to use (default: 300)
  --help                     Show this help
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeWordsPayload(payload, filePath) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.words)) return payload.words;
  throw new Error(
    `Words JSON must be an array (or {words:[...]}) -> ${filePath}`,
  );
}

function parseVideoFilename(fileName) {
  const stem = fileName.replace(/\.[^.]+$/u, "");
  let number = null;
  let rest = stem;

  const numbered = stem.match(/^(\d+(?:\.\d+)?)_/u);
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

function buildCacheMapping(cacheDir, words, maxWordIndex) {
  // Build baseWord -> index map
  const wordToIndex = new Map();
  for (let i = 0; i < words.length && i < maxWordIndex; i++) {
    wordToIndex.set(String(words[i].word || "").trim(), i + 1);
  }

  // Read all cache files named base__target.json
  const targetToBase = new Map();
  const cacheFiles = fs
    .readdirSync(cacheDir)
    .filter((f) => f.includes("__") && f.endsWith(".json"));

  for (const file of cacheFiles) {
    const name = file.replace(/\.json$/, "");
    const parts = name.split("__");
    if (parts.length !== 2) continue;

    const [baseWord, targetWord] = parts;
    const baseIndex = wordToIndex.get(baseWord);
    if (!baseIndex || baseIndex > maxWordIndex) continue;

    // Store the mapping: target -> { baseWord, baseIndex }
    // If target already mapped, keep the one with lower baseIndex
    if (!targetToBase.has(targetWord)) {
      targetToBase.set(targetWord, { baseWord, baseIndex });
    } else {
      const existing = targetToBase.get(targetWord);
      if (baseIndex < existing.baseIndex) {
        targetToBase.set(targetWord, { baseWord, baseIndex });
      }
    }
  }

  return targetToBase;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = findRepoRoot(process.cwd());

  const wordsFile = args.wordsFile
    ? args.wordsFile
    : repoRoot
      ? path.join(repoRoot, PRIMARY_WORDS_FILE)
      : null;

  if (!wordsFile || !fs.existsSync(wordsFile)) {
    throw new Error(
      "Could not find words file. Pass --wordsFile explicitly or run this under the repo root.",
    );
  }

  const cacheDir = path.isAbsolute(args.cacheDir)
    ? args.cacheDir
    : path.join(repoRoot, args.cacheDir);

  if (!fs.existsSync(cacheDir)) {
    throw new Error(`Cache dir not found: ${cacheDir}`);
  }

  if (!fs.existsSync(args.videosDir)) {
    throw new Error(`videosDir not found: ${args.videosDir}`);
  }

  const words = normalizeWordsPayload(readJson(wordsFile), wordsFile);

  // Build exact target->base mapping from cache files
  const targetToBase = buildCacheMapping(cacheDir, words, args.maxWordIndex);

  console.log(
    `Loaded ${targetToBase.size} target->base mappings from cache files`,
  );

  // Scan existing numbered files to find max family index per base word
  const allFiles = fs
    .readdirSync(args.videosDir)
    .filter((name) => name.toLowerCase().endsWith(".mp4"));

  const existingFamilyIndex = new Map();
  const alreadyNumbered = new Set();

  for (const file of allFiles) {
    const { number, word } = parseVideoFilename(file);
    if (number !== null) {
      alreadyNumbered.add(file);
      const numStr = String(number);
      if (numStr.includes(".")) {
        const [baseNumStr, familyStr] = numStr.split(".");
        const baseNum = parseInt(baseNumStr, 10);
        const familyIdx = parseInt(familyStr, 10);
        if (baseNum <= args.maxWordIndex) {
          const baseWord = String(words[baseNum - 1]?.word || "").trim();
          if (baseWord) {
            const current = existingFamilyIndex.get(baseWord) || 0;
            existingFamilyIndex.set(baseWord, Math.max(current, familyIdx));
          }
        }
      } else {
        const baseNum = parseInt(numStr, 10);
        if (baseNum <= args.maxWordIndex) {
          const baseWord = String(words[baseNum - 1]?.word || "").trim();
          if (baseWord && !existingFamilyIndex.has(baseWord)) {
            existingFamilyIndex.set(baseWord, 0);
          }
        }
      }
    }
  }

  // Process unnumbered files
  const unnumberedFiles = allFiles.filter((f) => !alreadyNumbered.has(f));

  const renamed = [];
  const skipped = [];
  const errors = [];

  for (const file of unnumberedFiles) {
    const { word } = parseVideoFilename(file);
    if (!word) {
      skipped.push({ file, reason: "Could not parse word from filename." });
      continue;
    }

    const mapping = targetToBase.get(word);
    if (!mapping) {
      skipped.push({ file, word, reason: "Not found in cache mapping." });
      continue;
    }

    // Assign family index
    const currentMax = existingFamilyIndex.get(mapping.baseWord) || 0;
    const familyIndex = currentMax + 1;
    existingFamilyIndex.set(mapping.baseWord, familyIndex);

    const baseNum = mapping.baseIndex;
    const paddedBase = padNumber(baseNum, args.padWidth);
    const familySuffix = `.${familyIndex}`;
    const newFilename = `${paddedBase}${familySuffix}_${file}`;

    const oldPath = path.join(args.videosDir, file);
    const newPath = path.join(args.videosDir, newFilename);

    if (args.dryRun) {
      renamed.push({
        file,
        newFilename,
        word,
        baseWord: mapping.baseWord,
        baseIndex: mapping.baseIndex,
        familyIndex,
        action: "DRY RUN",
      });
    } else {
      try {
        fs.renameSync(oldPath, newPath);
        renamed.push({
          file,
          newFilename,
          word,
          baseWord: mapping.baseWord,
          baseIndex: mapping.baseIndex,
          familyIndex,
          action: "RENAMED",
        });
      } catch (err) {
        errors.push({
          file,
          newFilename,
          word,
          error: err.message,
        });
      }
    }
  }

  console.log(`\nTotal unnumbered files: ${unnumberedFiles.length}`);
  console.log(`Already numbered: ${alreadyNumbered.size}`);
  console.log(`Renamed (or would rename): ${renamed.length}`);
  console.log(`Skipped: ${skipped.length}`);
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
  }

  if (renamed.length) {
    console.log("\nRenamed files:");
    for (const item of renamed) {
      console.log(
        `  ${item.action}: ${item.file} → ${item.newFilename} (${item.word} → form of ${item.baseWord} #${item.baseIndex}.${item.familyIndex})`,
      );
    }
  }

  if (skipped.length) {
    console.log("\nSkipped files:");
    for (const item of skipped) {
      console.log(`  ${item.file}: ${item.reason} (${item.word})`);
    }
  }

  if (errors.length) {
    console.log("\nErrors:");
    for (const item of errors) {
      console.log(`  ${item.file} → ${item.newFilename}: ${item.error}`);
    }
  }

  console.log(`\nCache dir: ${cacheDir}`);
  console.log(`Max word index: ${args.maxWordIndex}`);
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
