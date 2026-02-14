#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
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
const DEFAULT_OUT_ROOT = path.join("out", "word-auto");
const DEFAULT_DB_WORK_DIR = path.join("dissfiles", "word-auto-candidates-db");

function parseArgs(argv) {
  const args = {
    wordsFile: DEFAULT_WORDS_FILE,
    queryField: "word",
    count: 0,
    fromIndex: 1,
    subsDir: DEFAULT_JP_SUBS_DIR,
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : null,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : null,
    subOffsetsFile: fs.existsSync(DEFAULT_OFFSETS_FILE) ? DEFAULT_OFFSETS_FILE : null,
    outRoot: DEFAULT_OUT_ROOT,
    dbFile: null,
    rerankFile: null,
    renderOutDir: null,
    manifestFile: null,
    dbWorkDir: DEFAULT_DB_WORK_DIR,
    mode: "line",
    enLinePolicy: "best",
    rank: true,
    maxPerWord: 50,
    topK: 5,
    maxCandidates: 50,
    model: "llama3.2:3b",
    host: "http://127.0.0.1:11434",
    timeoutSec: 120,
    temperature: 0.1,
    retries: 2,
    minReasonChars: 10,
    requireMeaningful: true,
    allowFallbackRender: false,
    printEvery: 25,
    resume: true,
    force: false,
    skipBuild: false,
    skipRerank: false,
    skipRender: false,
    continueOnRenderError: true,
    decorate: false,
    dryRun: false,
    verbose: false,
    asrVerify: false,
    asrTopN: 12,
    asrWhisperBin: "whisper",
    asrWhisperModel: "small",
    asrLanguage: "Japanese",
    asrTimeoutSec: 90,
    asrWorkDir: path.join("dissfiles", "word-candidate-asr"),
    asrCacheFile: path.join("dissfiles", "word-candidate-asr", "cache.json"),
  };

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [k, maybeV] = raw.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };

    switch (k) {
      case "wordsFile":
        args.wordsFile = v;
        takeNext();
        break;
      case "queryField":
        args.queryField = v;
        takeNext();
        break;
      case "count":
        args.count = Number(v);
        takeNext();
        break;
      case "fromIndex":
        args.fromIndex = Number(v);
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
      case "outRoot":
        args.outRoot = v;
        takeNext();
        break;
      case "dbFile":
        args.dbFile = v;
        takeNext();
        break;
      case "dbWorkDir":
        args.dbWorkDir = v;
        takeNext();
        break;
      case "rerankFile":
        args.rerankFile = v;
        takeNext();
        break;
      case "renderOutDir":
        args.renderOutDir = v;
        takeNext();
        break;
      case "manifestFile":
        args.manifestFile = v;
        takeNext();
        break;
      case "mode":
        args.mode = String(v || "").toLowerCase();
        takeNext();
        break;
      case "enLinePolicy":
        args.enLinePolicy = String(v || "").toLowerCase();
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "no-rank":
        args.rank = false;
        break;
      case "maxPerWord":
        args.maxPerWord = Number(v);
        takeNext();
        break;
      case "topK":
        args.topK = Number(v);
        takeNext();
        break;
      case "maxCandidates":
        args.maxCandidates = Number(v);
        takeNext();
        break;
      case "model":
        args.model = v;
        takeNext();
        break;
      case "host":
        args.host = v;
        takeNext();
        break;
      case "timeoutSec":
        args.timeoutSec = Number(v);
        takeNext();
        break;
      case "temperature":
        args.temperature = Number(v);
        takeNext();
        break;
      case "retries":
        args.retries = Number(v);
        takeNext();
        break;
      case "minReasonChars":
        args.minReasonChars = Number(v);
        takeNext();
        break;
      case "requireMeaningful":
        args.requireMeaningful = true;
        break;
      case "allowWeak":
      case "no-requireMeaningful":
        args.requireMeaningful = false;
        break;
      case "allowFallbackRender":
        args.allowFallbackRender = true;
        break;
      case "no-allowFallbackRender":
        args.allowFallbackRender = false;
        break;
      case "printEvery":
        args.printEvery = Number(v);
        takeNext();
        break;
      case "resume":
        args.resume = true;
        break;
      case "no-resume":
        args.resume = false;
        break;
      case "force":
        args.force = true;
        break;
      case "skipBuild":
        args.skipBuild = true;
        break;
      case "skipRerank":
        args.skipRerank = true;
        break;
      case "skipRender":
        args.skipRender = true;
        break;
      case "continueOnRenderError":
        args.continueOnRenderError = true;
        break;
      case "no-continueOnRenderError":
        args.continueOnRenderError = false;
        break;
      case "decorate":
        args.decorate = true;
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "asrVerify":
        args.asrVerify = true;
        break;
      case "asrTopN":
        args.asrTopN = Number(v);
        takeNext();
        break;
      case "asrWhisperBin":
        args.asrWhisperBin = v;
        takeNext();
        break;
      case "asrWhisperModel":
        args.asrWhisperModel = v;
        takeNext();
        break;
      case "asrLanguage":
        args.asrLanguage = v;
        takeNext();
        break;
      case "asrTimeoutSec":
        args.asrTimeoutSec = Number(v);
        takeNext();
        break;
      case "asrWorkDir":
        args.asrWorkDir = v;
        takeNext();
        break;
      case "asrCacheFile":
        args.asrCacheFile = v;
        takeNext();
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  if (!args.videosDir) throw new Error("--videosDir is required.");
  if (!args.subsDir) throw new Error("--subsDir is required.");
  if (!["line", "sentence"].includes(args.mode)) {
    throw new Error('--mode must be "line" or "sentence".');
  }
  if (!["best", "nearest", "merge"].includes(args.enLinePolicy)) {
    throw new Error('--enLinePolicy must be "best", "nearest", or "merge".');
  }
  if (!Number.isFinite(args.fromIndex) || args.fromIndex <= 0) {
    throw new Error("--fromIndex must be a positive number.");
  }
  if (!Number.isFinite(args.count) || args.count < 0) {
    throw new Error("--count must be >= 0.");
  }
  if (!Number.isFinite(args.topK) || args.topK <= 0) {
    throw new Error("--topK must be > 0.");
  }
  if (!Number.isFinite(args.maxCandidates) || args.maxCandidates <= 0) {
    throw new Error("--maxCandidates must be > 0.");
  }
  if (!Number.isFinite(args.maxPerWord) || args.maxPerWord <= 0) {
    throw new Error("--maxPerWord must be > 0.");
  }
  if (!Number.isFinite(args.asrTopN) || args.asrTopN < 0) {
    throw new Error("--asrTopN must be >= 0.");
  }
  if (!Number.isFinite(args.asrTimeoutSec) || args.asrTimeoutSec <= 0) {
    throw new Error("--asrTimeoutSec must be > 0.");
  }

  args.outRoot = path.resolve(args.outRoot);
  args.dbFile = path.resolve(args.dbFile || path.join(args.outRoot, "word-candidates-db.json"));
  args.rerankFile = path.resolve(
    args.rerankFile || path.join(args.outRoot, "word-candidates-llm-top.qwen2.5-3b.full.json"),
  );
  args.renderOutDir = path.resolve(args.renderOutDir || path.join(args.outRoot, "videos"));
  args.manifestFile = path.resolve(
    args.manifestFile || path.join(args.outRoot, "render-manifest.json"),
  );
  args.dbWorkDir = path.resolve(args.dbWorkDir);
  args.asrWorkDir = path.resolve(args.asrWorkDir);
  args.asrCacheFile = path.resolve(args.asrCacheFile);

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/auto-curate-word-shorts.js [options]

What it does:
  1) Build candidate DB for your target word window
  2) Rerank with local Ollama (optional Whisper verification)
  3) Render 5-clip stitched videos per word (no manual review step)

Core options:
  --wordsFile <file>        Default: ${DEFAULT_WORDS_FILE}
  --queryField <name>       Word field in words JSON (default: word)
  --fromIndex <n>           1-based word index window start (default: 1)
  --count <n>               Number of words in window, 0 = all from --fromIndex
  --subsDir <dir>           JP subtitle dir (default: ${DEFAULT_JP_SUBS_DIR})
  --videosDir <dir>         Video dir (default: ${DEFAULT_VIDEOS_DIR})
  --enSubsDir <dir>         EN subtitle dir (default: ${DEFAULT_EN_SUBS_DIR})
  --subOffsetsFile <file>   Offsets file (default: ${DEFAULT_OFFSETS_FILE} if present)
  --mode <line|sentence>    Candidate extraction mode (default: line)
  --enLinePolicy <policy>   EN cue selection: best|nearest|merge (default: best)

Ranking options:
  --topK <n>                Clips per word (default: 5)
  --maxPerWord <n>          Candidate cap in DB (default: 50)
  --maxCandidates <n>       Candidate cap sent to LLM (default: 50)
  --model <name>            Ollama model (default: llama3.2:3b)
  --host <url>              Ollama host (default: http://127.0.0.1:11434)
  --requireMeaningful       Reject weak LLM ranking (default: on)
  --allowWeak               Accept weak rankings
  --allowFallbackRender     Render words with fallback rank status (default: off)
  --asrVerify               Run local Whisper agreement checks before ranking
  --asrTopN <n>             Verify only first N candidates per word (default: 12, 0 = all)

Pipeline control:
  --skipBuild               Reuse existing DB
  --skipRerank              Reuse existing rerank JSON
  --skipRender              Skip final video rendering
  --dryRun                  Dry run rerank fallback + dry run extract step
  --resume / --no-resume    Resume rerank output file (default: resume)
  --force                   Recompute already ranked words
  --continueOnRenderError   Keep going if a word render fails (default: on)

Output options:
  --outRoot <dir>           Root output folder (default: ${DEFAULT_OUT_ROOT})
  --dbFile <file>           Candidate DB output
  --rerankFile <file>       Rerank output
  --renderOutDir <dir>      Final stitched videos output
  --manifestFile <file>     Render summary JSON
  --dbWorkDir <dir>         Temp DB candidate json folder
  --decorate                Burn JP/EN overlay cards on clips
  --verbose                 Verbose logs
`.trim();

  console.log(msg + "\n");
  process.exit(code);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(path.resolve(filePath)));
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(value, null, 2));
}

function runNodeScript(scriptPath, scriptArgs, verbose) {
  const cli = [scriptPath, ...scriptArgs];
  if (verbose) {
    console.log("");
    console.log(`$ ${process.execPath} ${cli.join(" ")}`);
  }
  const res = spawnSync(process.execPath, cli, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed with exit code ${res.status}`);
  }
}

function runNodeScriptCapture(scriptPath, scriptArgs, verbose) {
  const cli = [scriptPath, ...scriptArgs];
  if (verbose) {
    console.log("");
    console.log(`$ ${process.execPath} ${cli.join(" ")}`);
  }

  const res = spawnSync(process.execPath, cli, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });

  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  if (verbose) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }

  if (res.status !== 0) {
    const tail = `${stderr}\n${stdout}`
      .trim()
      .split(/\r?\n/g)
      .slice(-60)
      .join("\n");
    throw new Error(
      `${path.basename(scriptPath)} failed with exit code ${res.status}${tail ? `\n${tail}` : ""}`,
    );
  }
}

function safeFilename(s) {
  const raw = String(s || "").trim();
  if (!raw) return "word";
  return raw
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function sliceByWindow(items, fromIndex, count) {
  const start = Math.max(0, Number(fromIndex || 1) - 1);
  if (count > 0) return items.slice(start, start + count);
  return items.slice(start);
}

function loadWordWindow(wordsFile, queryField, fromIndex, count) {
  const raw = readJson(wordsFile);
  if (!Array.isArray(raw)) {
    throw new Error(`Words file must be a JSON array: ${wordsFile}`);
  }
  const windowEntries = sliceByWindow(raw, fromIndex, count);
  const words = [];
  const seen = new Set();
  for (const entry of windowEntries) {
    let w = "";
    if (typeof entry === "string") {
      w = entry.trim();
    } else if (entry && typeof entry === "object") {
      w = String(entry[queryField] ?? entry.word ?? "").trim();
    }
    if (!w || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return { entries: windowEntries, words };
}

function uniquePositiveInts(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function parsePickOutOfRangeError(message) {
  const m = String(message || "").match(/--pick index #\d+ is out of range \(candidates=(\d+)\)/);
  if (!m) return null;
  const maxCandidate = Number(m[1]);
  if (!Number.isFinite(maxCandidate) || maxCandidate < 0) return null;
  return { maxCandidate };
}

function buildRenderArgs(args, word, picks) {
  const renderArgs = [
    "--query",
    word,
    "--subsDir",
    args.subsDir,
    "--videosDir",
    args.videosDir,
    "--wordList",
    args.wordsFile,
    "--mode",
    args.mode,
    "--enLinePolicy",
    args.enLinePolicy,
    "--rank",
    "--limit",
    String(picks.length),
    "--pick",
    picks.join(","),
    "--outDir",
    args.renderOutDir,
    "--flatOut",
    "--concat",
    "--concatOnly",
  ];
  if (args.decorate) renderArgs.push("--decorate");
  if (args.enSubsDir) renderArgs.push("--enSubsDir", args.enSubsDir);
  if (args.subOffsetsFile) renderArgs.push("--subOffsetsFile", args.subOffsetsFile);
  else renderArgs.push("--noSubOffsetsFile");
  if (args.dryRun) renderArgs.push("--dryRun");
  if (args.verbose) renderArgs.push("--verbose");
  return renderArgs;
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outRoot);
  ensureDir(args.renderOutDir);
  ensureDir(args.dbWorkDir);

  const wordWindow = loadWordWindow(args.wordsFile, args.queryField, args.fromIndex, args.count);
  if (wordWindow.words.length === 0) {
    throw new Error("No words selected by --fromIndex/--count.");
  }
  const targetWordSet = new Set(wordWindow.words);

  const windowWordsFile = path.join(args.outRoot, ".tmp.words-window.json");
  let rerankFromIndex = args.fromIndex;
  let rerankCount = args.count;

  if (!args.skipBuild) {
    writeJson(windowWordsFile, wordWindow.entries);
    rerankFromIndex = 1;
    rerankCount = 0;

    const buildArgs = [
      "--wordsFile",
      windowWordsFile,
      "--queryField",
      args.queryField,
      "--subsDir",
      args.subsDir,
      "--videosDir",
      args.videosDir,
      "--outFile",
      args.dbFile,
      "--workDir",
      args.dbWorkDir,
      "--mode",
      args.mode,
      "--maxPerWord",
      String(args.maxPerWord),
      "--printEvery",
      String(args.printEvery),
    ];
    if (args.enSubsDir) buildArgs.push("--enSubsDir", args.enSubsDir);
    if (args.subOffsetsFile) buildArgs.push("--subOffsetsFile", args.subOffsetsFile);
    else buildArgs.push("--noSubOffsetsFile");
    if (args.rank) buildArgs.push("--rank");
    else buildArgs.push("--no-rank");
    if (args.resume) buildArgs.push("--resume");
    else buildArgs.push("--no-resume");
    if (args.verbose) buildArgs.push("--verbose");
    runNodeScript(path.join("scripts", "build-word-candidates-db.js"), buildArgs, args.verbose);
  } else if (!fs.existsSync(args.dbFile)) {
    throw new Error(`DB file not found for --skipBuild: ${args.dbFile}`);
  }

  if (!args.skipRerank) {
    const rerankArgs = [
      "--dbFile",
      args.dbFile,
      "--outFile",
      args.rerankFile,
      "--model",
      args.model,
      "--host",
      args.host,
      "--topK",
      String(args.topK),
      "--maxCandidates",
      String(args.maxCandidates),
      "--fromIndex",
      String(rerankFromIndex),
      "--count",
      String(rerankCount),
      "--timeoutSec",
      String(args.timeoutSec),
      "--temperature",
      String(args.temperature),
      "--retries",
      String(args.retries),
      "--minReasonChars",
      String(args.minReasonChars),
      "--printEvery",
      String(args.printEvery),
    ];
    if (args.resume) rerankArgs.push("--resume");
    else rerankArgs.push("--no-resume");
    if (args.force) rerankArgs.push("--force");
    if (args.requireMeaningful) rerankArgs.push("--requireMeaningful");
    else rerankArgs.push("--allowWeak");
    if (args.dryRun) rerankArgs.push("--dryRun");
    if (args.verbose) rerankArgs.push("--verbose");

    if (args.asrVerify) {
      rerankArgs.push("--asrVerify");
      rerankArgs.push("--asrTopN", String(args.asrTopN));
      rerankArgs.push("--asrWhisperBin", args.asrWhisperBin);
      rerankArgs.push("--asrWhisperModel", args.asrWhisperModel);
      rerankArgs.push("--asrLanguage", args.asrLanguage);
      rerankArgs.push("--asrTimeoutSec", String(args.asrTimeoutSec));
      rerankArgs.push("--asrWorkDir", args.asrWorkDir);
      rerankArgs.push("--asrCacheFile", args.asrCacheFile);
    }

    runNodeScript(
      path.join("scripts", "rerank-word-candidates-ollama.js"),
      rerankArgs,
      args.verbose,
    );
  } else if (!fs.existsSync(args.rerankFile)) {
    throw new Error(`Rerank file not found for --skipRerank: ${args.rerankFile}`);
  }

  const manifest = {
    meta: {
      createdAt: new Date().toISOString(),
      wordsFile: path.resolve(args.wordsFile),
      fromIndex: args.fromIndex,
      count: args.count,
      dbFile: args.dbFile,
      rerankFile: args.rerankFile,
      renderOutDir: args.renderOutDir,
      topK: args.topK,
      mode: args.mode,
      enLinePolicy: args.enLinePolicy,
      allowFallbackRender: args.allowFallbackRender,
      asrVerify: args.asrVerify,
    },
    summary: {
      targetWords: wordWindow.words.length,
      attempted: 0,
      rendered: 0,
      skipped: 0,
      failed: 0,
    },
    words: [],
  };

  if (!args.skipRender) {
    const rerank = readJson(args.rerankFile);
    if (!rerank || !Array.isArray(rerank.words)) {
      throw new Error(`Invalid rerank file: ${args.rerankFile}`);
    }

    const candidates = rerank.words.filter((w) => targetWordSet.has(String(w?.word || "")));
    for (const rec of candidates) {
      const word = String(rec?.word || "").trim();
      if (!word) continue;
      manifest.summary.attempted++;

      const recStatus = String(rec?.status || "");
      const top = Array.isArray(rec?.top) ? rec.top : [];
      const picks = uniquePositiveInts(top.slice(0, args.topK).map((x) => x?.candidateIndex));
      const canRenderStatus = recStatus === "ok" || (args.allowFallbackRender && recStatus === "fallback");
      if (picks.length === 0 || !canRenderStatus) {
        manifest.summary.skipped++;
        manifest.words.push({
          word,
          status: "skipped",
          reason: !canRenderStatus
            ? (recStatus === "fallback" ? "fallback_blocked" : recStatus || "status_not_renderable")
            : "no_top_picks",
          picks,
          output: path.join(args.renderOutDir, `${safeFilename(word)}.mp4`),
          error: null,
        });
        continue;
      }

      let finalPicks = picks;
      let retryNotice = null;

      try {
        runNodeScriptCapture(
          path.join("scripts", "extract-clips.js"),
          buildRenderArgs(args, word, finalPicks),
          args.verbose,
        );
        manifest.summary.rendered++;
        manifest.words.push({
          word,
          status: "rendered",
          reason: retryNotice,
          picks: finalPicks,
          output: path.join(args.renderOutDir, `${safeFilename(word)}.mp4`),
          error: null,
        });
      } catch (err) {
        const outOfRange = parsePickOutOfRangeError(err?.message || String(err));
        if (outOfRange) {
          const adjusted = finalPicks.filter((n) => n <= outOfRange.maxCandidate);
          if (adjusted.length > 0 && adjusted.length !== finalPicks.length) {
            retryNotice = `adjusted_picks_to_available_candidates(${adjusted.length}/${finalPicks.length})`;
            if (args.verbose) {
              console.log(
                `[render retry] ${word}: pick indices exceed candidates=${outOfRange.maxCandidate}; retrying with picks=${adjusted.join(",")}`,
              );
            }
            try {
              finalPicks = adjusted;
              runNodeScriptCapture(
                path.join("scripts", "extract-clips.js"),
                buildRenderArgs(args, word, finalPicks),
                args.verbose,
              );
              manifest.summary.rendered++;
              manifest.words.push({
                word,
                status: "rendered",
                reason: retryNotice,
                picks: finalPicks,
                output: path.join(args.renderOutDir, `${safeFilename(word)}.mp4`),
                error: null,
              });
              continue;
            } catch (retryErr) {
              err = retryErr;
            }
          }
        }

        manifest.summary.failed++;
        manifest.words.push({
          word,
          status: "failed",
          reason: rec?.status || null,
          picks: finalPicks,
          output: path.join(args.renderOutDir, `${safeFilename(word)}.mp4`),
          error: err?.message || String(err),
        });
        if (!args.continueOnRenderError) throw err;
      }
    }
  }

  writeJson(args.manifestFile, manifest);
  console.log("");
  console.log(`Auto-curation manifest: ${args.manifestFile}`);
  console.log(
    `Summary: target=${manifest.summary.targetWords} attempted=${manifest.summary.attempted} rendered=${manifest.summary.rendered} skipped=${manifest.summary.skipped} failed=${manifest.summary.failed}`,
  );
}

main();
