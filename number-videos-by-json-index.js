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
    videosDir: process.cwd(),
    wordsFile: null,
    fallbackWordsFile: null,
    dryRun: false,
    padWidth: 3,
    includeFamily: false,
    preferBase: false,
    maxWordIndex: 0,
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
      case "includeFamily":
        args.includeFamily = true;
        break;
      case "preferBase":
        args.preferBase = true;
        break;
      case "maxWordIndex":
        args.maxWordIndex = Number(v || 0);
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
  --includeFamily            Also match family/conjugation forms from match.forms
  --preferBase              When word matches both base AND form, prefer base word's number
  --maxWordIndex <n>        Maximum word index to use (default: 0 = no limit). Family forms of words beyond this will be assigned to nearest base within range
  --help                     Show this help

Example:
  node number-videos-by-json-index.js --videosDir . --dryRun
  node number-videos-by-json-index.js --videosDir . --padWidth 4
  node number-videos-by-json-index.js --videosDir . --includeFamily
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

  let formToBaseWord = new Map();
  if (args.includeFamily) {
    for (const wordObj of words) {
      const baseWord = String(wordObj.word || "").trim();
      const forms = wordObj.match?.forms || [];
      for (const form of forms) {
        if (!formToBaseWord.has(form)) {
          formToBaseWord.set(form, baseWord);
        }
      }
    }
  }

  const videoFiles = fs
    .readdirSync(args.videosDir)
    .filter((name) => name.toLowerCase().endsWith(".mp4"));

  const renamed = [];
  const skipped = [];
  const errors = [];

  const usedFamilyIndices = new Map();

  for (const videoFile of videoFiles) {
    const { number, word } = parseVideoFilename(videoFile);
    if (!word) {
      skipped.push({
        videoFile,
        reason: "Could not parse word from filename.",
      });
      continue;
    }

    let entry = byWord.get(word);
    let baseWord = word;
    let familyIndex = null;

    const matchedBase = formToBaseWord.get(word);
    let wordIndex = entry ? words.findIndex((item) => item === entry) : -1;
    const isFormOfOtherWord = matchedBase && matchedBase !== word;

    if (args.preferBase && isFormOfOtherWord) {
      const baseEntry = byWord.get(matchedBase);
      if (baseEntry) {
        const baseIndex = words.findIndex((item) => item === baseEntry);
        const baseNum = baseIndex + 1;

        if (baseIndex >= 0 && baseNum <= args.maxWordIndex) {
          entry = baseEntry;
          baseWord = matchedBase;
          wordIndex = baseIndex;
          if (!usedFamilyIndices.has(baseWord)) {
            usedFamilyIndices.set(baseWord, 1);
          } else {
            usedFamilyIndices.set(
              baseWord,
              usedFamilyIndices.get(baseWord) + 1,
            );
          }
          familyIndex = usedFamilyIndices.get(baseWord);
        }
      }
    } else if (
      args.maxWordIndex > 0 &&
      wordIndex >= 0 &&
      wordIndex + 1 > args.maxWordIndex
    ) {
      if (isFormOfOtherWord) {
        const baseEntry = byWord.get(matchedBase);
        if (baseEntry) {
          const baseIndex = words.findIndex((item) => item === baseEntry);
          const baseNum = baseIndex + 1;
          if (baseIndex >= 0 && baseNum <= args.maxWordIndex) {
            entry = baseEntry;
            baseWord = matchedBase;
            wordIndex = baseIndex;
            if (!usedFamilyIndices.has(baseWord)) {
              usedFamilyIndices.set(baseWord, 1);
            } else {
              usedFamilyIndices.set(
                baseWord,
                usedFamilyIndices.get(baseWord) + 1,
              );
            }
            familyIndex = usedFamilyIndices.get(baseWord);
          }
        }
      }
      if (!entry || wordIndex < 0 || wordIndex + 1 > args.maxWordIndex) {
        skipped.push({
          videoFile,
          word,
          wordIndex: wordIndex + 1,
          reason: `Word index ${wordIndex + 1} exceeds maxWordIndex ${args.maxWordIndex}.`,
        });
        continue;
      }
    }

    if (!entry) {
      entry = byWord.get(matchedBase);
      baseWord = matchedBase;
      if (entry) {
        if (!usedFamilyIndices.has(baseWord)) {
          usedFamilyIndices.set(baseWord, 1);
        } else {
          usedFamilyIndices.set(baseWord, usedFamilyIndices.get(baseWord) + 1);
        }
        familyIndex = usedFamilyIndices.get(baseWord);
      }
    } else if (!entry && args.includeFamily && matchedBase) {
      entry = byWord.get(matchedBase);
      baseWord = matchedBase;
      if (entry) {
        if (!usedFamilyIndices.has(baseWord)) {
          usedFamilyIndices.set(baseWord, 1);
        } else {
          usedFamilyIndices.set(baseWord, usedFamilyIndices.get(baseWord) + 1);
        }
        familyIndex = usedFamilyIndices.get(baseWord);
      }
    }

    if (!entry) {
      skipped.push({
        videoFile,
        word,
        reason: "Word not found in words file.",
      });
      continue;
    }

    if (wordIndex < 0) {
      skipped.push({
        videoFile,
        word,
        reason: "Word not found in words array.",
      });
      continue;
    }

    const newNumber = wordIndex + 1;
    let displayNumber = newNumber;
    let actualBaseNumber = newNumber;

    if (args.maxWordIndex > 0 && newNumber > args.maxWordIndex) {
      const matchedBase = formToBaseWord.get(word);
      if (matchedBase && matchedBase !== word) {
        const baseEntry = byWord.get(matchedBase);
        if (baseEntry) {
          const baseWordIndex = words.findIndex((item) => item === baseEntry);
          if (baseWordIndex >= 0 && baseWordIndex + 1 <= args.maxWordIndex) {
            entry = baseEntry;
            baseWord = matchedBase;
            actualBaseNumber = baseWordIndex + 1;
            if (!usedFamilyIndices.has(baseWord)) {
              usedFamilyIndices.set(baseWord, 1);
            } else {
              usedFamilyIndices.set(
                baseWord,
                usedFamilyIndices.get(baseWord) + 1,
              );
            }
            familyIndex = usedFamilyIndices.get(baseWord);
            displayNumber = parseFloat(`${actualBaseNumber}.${familyIndex}`);
          }
        }
      }
    } else if (familyIndex !== null) {
      displayNumber = parseFloat(`${newNumber}.${familyIndex}`);
    }

    if (Number.isFinite(number)) {
      skipped.push({
        videoFile,
        word,
        currentNumber: number,
        newNumber: displayNumber,
        reason: `Already numbered as ${number}.`,
      });
      continue;
    }

    const ext = path.extname(videoFile);
    const paddedBase = padNumber(actualBaseNumber, args.padWidth);
    const familySuffix = familyIndex !== null ? `.${familyIndex}` : "";
    const newFilename = `${paddedBase}${familySuffix}_${videoFile}`;
    const oldPath = path.join(args.videosDir, videoFile);
    const newPath = path.join(args.videosDir, newFilename);

    if (args.dryRun) {
      renamed.push({
        videoFile,
        newFilename,
        word,
        number: displayNumber,
        action: "DRY RUN",
      });
    } else {
      try {
        fs.renameSync(oldPath, newPath);
        renamed.push({
          videoFile,
          newFilename,
          word,
          number: displayNumber,
          action: "RENAMED",
        });
      } catch (err) {
        errors.push({
          videoFile,
          newFilename,
          word,
          number: displayNumber,
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
  console.log(`Family forms enabled: ${args.includeFamily}`);
  console.log(`Prefer base word: ${args.preferBase}`);
  console.log(
    `Max word index: ${args.maxWordIndex > 0 ? args.maxWordIndex : "no limit"}`,
  );
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
