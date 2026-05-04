#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_WORDS_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.first2000.json",
);
const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_JP_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_EN_SUBS_DIR_EMBEDDED = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_DIR_LEGACY = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_DIR_EMBEDDED)
  ? DEFAULT_EN_SUBS_DIR_EMBEDDED
  : DEFAULT_EN_SUBS_DIR_LEGACY;
const DEFAULT_OFFSETS_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "sub-offsets.json",
);
const DEFAULT_OUT_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "word-candidates-db.json",
);
const DEFAULT_WORK_DIR = path.join("dissfiles", "word-candidates-db");

function parseArgs(argv) {
  const args = {
    wordsFile: DEFAULT_WORDS_FILE,
    count: 0,
    queryField: "word",
    subsDir: DEFAULT_JP_SUBS_DIR,
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : null,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : null,
    subOffsetsFile: fs.existsSync(DEFAULT_OFFSETS_FILE) ? DEFAULT_OFFSETS_FILE : null,
    outFile: DEFAULT_OUT_FILE,
    workDir: DEFAULT_WORK_DIR,
    mode: "sentence",
    rank: true,
    selectPerWord: 10,
    prePadMs: 350,
    postPadMs: 650,
    minClipMs: 1200,
    maxClipMs: 3200,
    longPolicy: "shrink",
    avEval: false,
    avWhisperModel: "",
    avWhisperLanguage: "",
    avQueryOnly: true,
    avPoolLimit: 25,
    avMaxSwapCandidates: 25,
    maxPerWord: 0,
    printEvery: 25,
    continueOnError: true,
    resume: true,
    keepTmp: false,
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
      case "wordsFile":
        args.wordsFile = v;
        takeNext();
        break;
      case "count":
        args.count = Number(v);
        takeNext();
        break;
      case "queryField":
        args.queryField = String(v);
        takeNext();
        break;
      case "subsDir":
        args.subsDir = v;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = v;
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = v;
        takeNext();
        break;
      case "subOffsetsFile":
        args.subOffsetsFile = v;
        takeNext();
        break;
      case "noSubOffsetsFile":
        args.subOffsetsFile = null;
        break;
      case "outFile":
        args.outFile = v;
        takeNext();
        break;
      case "workDir":
        args.workDir = v;
        takeNext();
        break;
      case "mode":
        args.mode = String(v);
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "no-rank":
        args.rank = false;
        break;
      case "selectPerWord":
        args.selectPerWord = Number(v);
        takeNext();
        break;
      case "prePadMs":
        args.prePadMs = Number(v);
        takeNext();
        break;
      case "postPadMs":
        args.postPadMs = Number(v);
        takeNext();
        break;
      case "minClipMs":
        args.minClipMs = Number(v);
        takeNext();
        break;
      case "maxClipMs":
        args.maxClipMs = Number(v);
        takeNext();
        break;
      case "longPolicy":
        args.longPolicy = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "avEval":
        args.avEval = true;
        break;
      case "no-avEval":
        args.avEval = false;
        break;
      case "avWhisperModel":
        args.avWhisperModel = String(v || "").trim();
        takeNext();
        break;
      case "avWhisperLanguage":
        args.avWhisperLanguage = String(v || "").trim();
        takeNext();
        break;
      case "avQueryOnly":
        args.avQueryOnly = true;
        break;
      case "noAvQueryOnly":
        args.avQueryOnly = false;
        break;
      case "avPoolLimit":
        args.avPoolLimit = Number(v);
        takeNext();
        break;
      case "avMaxSwapCandidates":
        args.avMaxSwapCandidates = Number(v);
        takeNext();
        break;
      case "maxPerWord":
        args.maxPerWord = Number(v);
        takeNext();
        break;
      case "printEvery":
        args.printEvery = Number(v);
        takeNext();
        break;
      case "continueOnError":
        args.continueOnError = true;
        break;
      case "no-continueOnError":
        args.continueOnError = false;
        break;
      case "resume":
        args.resume = true;
        break;
      case "no-resume":
        args.resume = false;
        break;
      case "keepTmp":
        args.keepTmp = true;
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

  if (!args.subsDir) throw new Error("--subsDir is required.");
  if (!args.videosDir) throw new Error("--videosDir is required.");
  if (args.mode !== "line" && args.mode !== "sentence") {
    throw new Error('--mode must be "line" or "sentence".');
  }
  if (!Number.isFinite(args.prePadMs) || args.prePadMs < 0) {
    throw new Error("--prePadMs must be >= 0.");
  }
  if (!Number.isFinite(args.postPadMs) || args.postPadMs < 0) {
    throw new Error("--postPadMs must be >= 0.");
  }
  if (!Number.isFinite(args.minClipMs) || args.minClipMs < 0) {
    throw new Error("--minClipMs must be >= 0.");
  }
  if (!Number.isFinite(args.maxClipMs) || args.maxClipMs <= 0) {
    throw new Error("--maxClipMs must be > 0.");
  }
  if (!["skip", "shrink"].includes(args.longPolicy)) {
    throw new Error('--longPolicy must be "skip" or "shrink".');
  }
  if (!Number.isFinite(args.selectPerWord) || args.selectPerWord <= 0) {
    throw new Error("--selectPerWord must be > 0.");
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/build-word-candidates-db.js [options]

What it does:
  - Iterates words from a JSON list
  - Calls extract-clips in dry-run mode for each word
  - Stores all found candidates in one big JSON

Options:
  --wordsFile <file>        Default: ${DEFAULT_WORDS_FILE}
  --count <n>               0 = all words (default: 0)
  --queryField <name>       Field name in words JSON objects (default: word)
  --subsDir <dir>           JP subtitle dir (default: ${DEFAULT_JP_SUBS_DIR})
  --videosDir <dir>         Video dir (default: ${DEFAULT_VIDEOS_DIR})
  --enSubsDir <dir>         EN subtitle dir (default: ${DEFAULT_EN_SUBS_DIR})
  --subOffsetsFile <file>   Offsets JSON (default: ${DEFAULT_OFFSETS_FILE} if present)
  --noSubOffsetsFile        Disable offsets file
  --outFile <file>          Output DB JSON (default: ${DEFAULT_OUT_FILE})
  --workDir <dir>           Temp json dir (default: ${DEFAULT_WORK_DIR})
  --mode <line|sentence>    Match mode passed to extract-clips (default: sentence)
  --rank / --no-rank        Candidate ranking toggle (default: rank)
  --selectPerWord <n>       Number of selected clips to keep per word (default: 10)
  --prePadMs <n>            Extra context before match (default: 350)
  --postPadMs <n>           Extra context after match (default: 650)
  --minClipMs <n>           Minimum candidate duration (default: 1200)
  --maxClipMs <n>           Maximum candidate duration (default: 3200)
  --longPolicy <p>          skip|shrink for long clips (default: shrink)
  --avEval                  Enable audio/video evaluator in extract-clips
  --avWhisperModel <name>   Whisper model for AV evaluator
  --avWhisperLanguage <x>   Whisper language for AV evaluator
  --avQueryOnly             Require only target-word presence in Whisper audio (default)
  --noAvQueryOnly           Also require JP similarity vs Whisper
  --avPoolLimit <n>         Max top-ranked candidates considered for AV replacement search (default: 25)
  --avMaxSwapCandidates <n> Max deeper replacement AV checks per bad slot (default: 25)
  --maxPerWord <n>          Keep at most N candidates per word (default: 0 = all)
  --printEvery <n>          Progress print interval (default: 25)
  --continueOnError         Keep going when a word fails (default: on)
  --no-continueOnError      Stop on first failure
  --resume / --no-resume    Merge into existing outFile (default: resume)
  --keepTmp                 Keep per-word temp candidate files
  --verbose                 Extra logs
`.trim() + "\n",
  );
  process.exit(code);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const abs = path.resolve(filePath);
  ensureDir(path.dirname(abs));
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, abs);
}

function normalizeDbPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const words = Array.isArray(raw.words) ? raw.words : null;
  if (!words) return null;
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  return { meta, summary, words };
}

function buildWordMap(records) {
  const map = new Map();
  for (const rec of records || []) {
    const word = String(rec?.word || "").trim();
    if (!word) continue;
    map.set(word, rec);
  }
  return map;
}

function mergeWordOrder(existingWords, processedWords) {
  const out = [];
  const seen = new Set();
  for (const w of existingWords || []) {
    const word = String(w || "").trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  for (const w of processedWords || []) {
    const word = String(w || "").trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

function recomputeSummary(words) {
  let okWords = 0;
  let missingWords = 0;
  let errorWords = 0;
  let totalCandidates = 0;

  for (const rec of words || []) {
    if (!rec || typeof rec !== "object") continue;
    if (rec.error) errorWords++;
    else if (rec.missing) missingWords++;
    else okWords++;

    if (Array.isArray(rec.candidates)) totalCandidates += rec.candidates.length;
    else if (Number.isFinite(Number(rec.candidateCount))) {
      totalCandidates += Number(rec.candidateCount);
    }
  }

  return {
    totalWords: Array.isArray(words) ? words.length : 0,
    okWords,
    missingWords,
    errorWords,
    totalCandidates,
  };
}

function buildDbSnapshot({
  existingWordOrder,
  processedWords,
  outMap,
  db,
}) {
  const finalOrder = mergeWordOrder(existingWordOrder, processedWords);
  const words = finalOrder.map((w) => outMap.get(w)).filter(Boolean);
  return {
    ...db,
    words,
    summary: recomputeSummary(words),
    meta: {
      ...db.meta,
      processedCount: words.length,
      updatedAt: new Date().toISOString(),
    },
  };
}

function hashWord(word) {
  return crypto.createHash("sha1").update(String(word)).digest("hex").slice(0, 10);
}

function extractEpisodeToken(filePath) {
  const base = path.basename(String(filePath || ""));
  const m = base.match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function msToClock(msRaw) {
  const ms = Math.max(0, Math.round(Number(msRaw) || 0));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

function normalizeCandidate(c, idx) {
  const episode = extractEpisodeToken(c.subFile) || extractEpisodeToken(c.videoFile);
  return {
    rank: idx + 1,
    score: Number(c.score || 0),
    episode,
    subFile: c.subFile,
    videoFile: c.videoFile,
    clipStartMs: c.clipStartMs,
    clipEndMs: c.clipEndMs,
    clipStart: msToClock(c.clipStartMs),
    clipEnd: msToClock(c.clipEndMs),
    matchStartMs: c.matchStartMs,
    matchEndMs: c.matchEndMs,
    jpText: c.sentenceText,
    enText: c.enText || "",
  };
}

function loadWordEntries(filePath, queryField, count) {
  const raw = readJson(filePath);
  if (!Array.isArray(raw)) {
    throw new Error("wordsFile must be a JSON array.");
  }
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    let word = null;
    let meta = {};
    if (typeof entry === "string") {
      word = entry;
    } else if (entry && typeof entry === "object") {
      word = String(entry[queryField] ?? entry.word ?? "").trim();
      meta = { ...entry };
    }
    if (!word) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push({ word, meta });
    if (count > 0 && out.length >= count) break;
  }
  return out;
}

function runExtractClips(word, args, tmpOutPath) {
  const cli = [
    "scripts/extract-clips.js",
    "--query",
    word,
    "--wordList",
    args.wordsFile,
    "--subsDir",
    args.subsDir,
    "--videosDir",
    args.videosDir,
    "--mode",
    args.mode,
    "--prePadMs",
    String(args.prePadMs),
    "--postPadMs",
    String(args.postPadMs),
    "--minClipMs",
    String(args.minClipMs),
    "--maxClipMs",
    String(args.maxClipMs),
    "--longPolicy",
    String(args.longPolicy),
    "--limit",
    String(args.selectPerWord),
    "--dryRun",
    "--candidatesOut",
    tmpOutPath,
  ];

  if (args.enSubsDir) cli.push("--enSubsDir", args.enSubsDir);
  if (args.subOffsetsFile) cli.push("--subOffsetsFile", args.subOffsetsFile);
  else cli.push("--noSubOffsetsFile");
  if (args.rank) cli.push("--rank");
  if (args.avEval) cli.push("--avEval");
  if (args.avWhisperModel) cli.push("--avWhisperModel", args.avWhisperModel);
  if (args.avWhisperLanguage) cli.push("--avWhisperLanguage", args.avWhisperLanguage);
  if (args.avQueryOnly) cli.push("--avQueryOnly");
  else cli.push("--noAvQueryOnly");
  if (Number.isFinite(args.avPoolLimit) && args.avPoolLimit > 0) {
    cli.push("--avPoolLimit", String(args.avPoolLimit));
  }
  if (Number.isFinite(args.avMaxSwapCandidates) && args.avMaxSwapCandidates > 0) {
    cli.push("--avMaxSwapCandidates", String(args.avMaxSwapCandidates));
  }
  if (args.verbose) cli.push("--verbose");

  const res = spawnSync(process.execPath, cli, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.workDir);

  const words = loadWordEntries(args.wordsFile, args.queryField, args.count);
  if (words.length === 0) throw new Error("No words loaded from wordsFile.");

  const nowIso = new Date().toISOString();
  const existingRaw = args.resume && fs.existsSync(args.outFile) ? readJson(args.outFile) : null;
  const existing = normalizeDbPayload(existingRaw);
  const existingWordOrder = existing?.words?.map((rec) => String(rec?.word || "").trim()) || [];
  const outMap = buildWordMap(existing?.words || []);
  const requestedWords = words.map((x) => x.word);
  const resumableWords = new Set(existingWordOrder.filter((word) => requestedWords.includes(word)));

  const db = {
    meta: {
      ...(existing?.meta || {}),
      createdAt: existing?.meta?.createdAt || nowIso,
      updatedAt: nowIso,
      generator: "build-word-candidates-db.v1",
      wordsFile: path.resolve(args.wordsFile),
      queryField: args.queryField,
      requestedCount: args.count,
      processedCount: 0,
      subsDir: path.resolve(args.subsDir),
      enSubsDir: args.enSubsDir ? path.resolve(args.enSubsDir) : null,
      videosDir: path.resolve(args.videosDir),
      subOffsetsFile: args.subOffsetsFile ? path.resolve(args.subOffsetsFile) : null,
      mode: args.mode,
      rank: args.rank,
      selectPerWord: args.selectPerWord,
      avEval: args.avEval,
      avWhisperModel: args.avWhisperModel || null,
      avWhisperLanguage: args.avWhisperLanguage || null,
      avQueryOnly: args.avQueryOnly,
      avPoolLimit: args.avPoolLimit,
      avMaxSwapCandidates: args.avMaxSwapCandidates,
      maxPerWord: args.maxPerWord,
    },
    summary: existing?.summary || {
      totalWords: 0,
      okWords: 0,
      missingWords: 0,
      errorWords: 0,
      totalCandidates: 0,
    },
    words: [],
  };

  if (resumableWords.size > 0) {
    console.log(
      `Resuming from existing DB: skipping ${resumableWords.size} previously processed word(s).`,
    );
  }

  for (let i = 0; i < words.length; i++) {
    const entry = words[i];
    const word = entry.word;
    if (args.resume && outMap.has(word)) {
      const existingRec = outMap.get(word);
      if (
        args.verbose ||
        i === 0 ||
        i === words.length - 1 ||
        (args.printEvery > 0 && (i + 1) % args.printEvery === 0)
      ) {
        console.log(
          `[${i + 1}/${words.length}] ${word} -> skip=resume cands=${existingRec?.candidateCount || existingRec?.candidates?.length || 0} missing=${existingRec?.missing ? "yes" : "no"} error=${existingRec?.error ? "yes" : "no"}`,
        );
      }
      continue;
    }
    const tmpOutPath = path.join(
      args.workDir,
      `${String(i + 1).padStart(5, "0")}_${hashWord(word)}.json`,
    );
    if (fs.existsSync(tmpOutPath)) fs.rmSync(tmpOutPath, { force: true });

    const res = runExtractClips(word, args, tmpOutPath);
    let wordRec = null;

    if (res.status === 2) {
      wordRec = {
        word,
        meta: entry.meta,
        missing: true,
        error: null,
        candidates: [],
        selected: [],
      };
    } else if (res.status !== 0) {
      const err = (res.stderr || res.stdout || `exit=${res.status}`).trim();
      wordRec = {
        word,
        meta: entry.meta,
        missing: false,
        error: err,
        candidates: [],
        selected: [],
      };
      if (!args.continueOnError) {
        outMap.set(word, wordRec);
        writeJson(
          args.outFile,
          buildDbSnapshot({
            existingWordOrder,
            processedWords: requestedWords,
            outMap,
            db,
          }),
        );
        throw new Error(`Failed on word "${word}": ${err}`);
      }
    } else {
      const payload = fs.existsSync(tmpOutPath) ? readJson(tmpOutPath) : {};
      let candidates = Array.isArray(payload.pool)
        ? payload.pool
        : Array.isArray(payload.planned)
          ? payload.planned
          : [];
      if (args.maxPerWord > 0) candidates = candidates.slice(0, args.maxPerWord);
      const selected = Array.isArray(payload.selected) ? payload.selected : [];
      const normalizedCandidates = candidates.map(normalizeCandidate);
      const normalizedSelected = selected.map(normalizeCandidate);
      wordRec = {
        word,
        meta: entry.meta,
        missing: false,
        error: null,
        candidateCount: normalizedCandidates.length,
        selectedCount: normalizedSelected.length,
        candidateStats: payload.stats || null,
        candidates: normalizedCandidates,
        selected: normalizedSelected,
      };
    }

    outMap.set(word, wordRec);
    writeJson(
      args.outFile,
      buildDbSnapshot({
        existingWordOrder,
        processedWords: requestedWords,
        outMap,
        db,
      }),
    );

    if (!args.keepTmp && fs.existsSync(tmpOutPath)) {
      fs.rmSync(tmpOutPath, { force: true });
    }
    if (
      args.verbose ||
      i === 0 ||
      i === words.length - 1 ||
      (args.printEvery > 0 && (i + 1) % args.printEvery === 0)
    ) {
      console.log(
        `[${i + 1}/${words.length}] ${word} -> cands=${wordRec.candidates.length} missing=${wordRec.missing ? "yes" : "no"} error=${wordRec.error ? "yes" : "no"}`,
      );
    }
  }

  const finalDb = buildDbSnapshot({
    existingWordOrder,
    processedWords: requestedWords,
    outMap,
    db,
  });
  writeJson(args.outFile, finalDb);
  console.log("");
  console.log(`Done. DB written to: ${path.resolve(args.outFile)}`);
  console.log(
    `Summary: words=${finalDb.summary.totalWords} ok=${finalDb.summary.okWords} missing=${finalDb.summary.missingWords} errors=${finalDb.summary.errorWords} candidates=${finalDb.summary.totalCandidates}`,
  );
}

main();
