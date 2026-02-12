#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULTS = {
  wordsFile: path.join("source_content", "all_anime_top_2000.match.first2000.json"),
  queryField: "word",
  videosDir: path.join("source_content", "shingeki_no_kyojin", "videos"),
  subsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "japanese"),
  enSubsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "english_embedded"),
  subOffsetsFile: path.join("source_content", "shingeki_no_kyojin", "subs", "sub-offsets.json"),
  outBase: path.join("out", "shorts"),
  action: "full", // rank | render | full
  profile: "fast", // fast | whisper
  topK: 5,
  maxPerWord: 50,
  maxCandidates: 50,
  mode: "line",
  enLinePolicy: "best",
  model: "llama3.2:3b",
  printEvery: 25,
  renderMode: "short", // short | stitched
  allowFallbackRender: false,
  allowWeak: false,
  resume: true,
  force: false,
  decorate: false,
  dryRun: false,
  verbose: false,
  asrTopN: 12,
  asrWhisperBin: "whisper",
  asrWhisperModel: "small",
  asrLanguage: "Japanese",
  asrTimeoutSec: 90,
  scope: {
    kind: "all", // all | range | word
    value: null,
  },
};

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/word-pipeline.js <rank|render|full> [scope] [profile] [options]

Scope (pick one):
  --all                    All words (default)
  --range <start-end>      1-based inclusive range, e.g. 101-300
  --word <text>            Single word from words file

Profile (pick one):
  --fast                   Rank without Whisper ASR verification (default)
  --whisper                Rank with Whisper ASR verification

Options:
  --wordsFile <file>       Default: ${DEFAULTS.wordsFile}
  --queryField <name>      Default: ${DEFAULTS.queryField}
  --videosDir <dir>        Default: ${DEFAULTS.videosDir}
  --subsDir <dir>          Default: ${DEFAULTS.subsDir}
  --enSubsDir <dir>        Default: ${DEFAULTS.enSubsDir}
  --subOffsetsFile <file>  Default: ${DEFAULTS.subOffsetsFile}
  --noSubOffsetsFile       Disable offsets file
  --outBase <dir>          Default: ${DEFAULTS.outBase}
  --topK <n>               Default: ${DEFAULTS.topK}
  --maxPerWord <n>         Default: ${DEFAULTS.maxPerWord}
  --maxCandidates <n>      Default: ${DEFAULTS.maxCandidates}
  --mode <line|sentence>   Default: ${DEFAULTS.mode}
  --enLinePolicy <p>       best|nearest|merge (default: ${DEFAULTS.enLinePolicy})
  --model <name>           Default: ${DEFAULTS.model}
  --printEvery <n>         Default: ${DEFAULTS.printEvery}
  --renderMode <mode>      short|stitched (default: ${DEFAULTS.renderMode})
  --short                  Alias for --renderMode short
  --stitched               Alias for --renderMode stitched
  --allowFallbackRender    Allow rendering fallback-ranked words (default: off)
  --allowWeak              Accept weak/trivial LLM rankings (default: off)
  --resume / --no-resume   Default: resume
  --force                  Re-rank already processed words
  --decorate               Stitched mode only: burn JP+EN overlay cards
  --dryRun                 Dry run downstream scripts
  --verbose                Verbose logs

Whisper profile options:
  --asrTopN <n>            Default: ${DEFAULTS.asrTopN}
  --asrWhisperBin <cmd>    Default: ${DEFAULTS.asrWhisperBin}
  --asrWhisperModel <name> Default: ${DEFAULTS.asrWhisperModel}
  --asrLanguage <name>     Default: ${DEFAULTS.asrLanguage}
  --asrTimeoutSec <n>      Default: ${DEFAULTS.asrTimeoutSec}

Examples:
  npm run -s word-pipeline -- rank --all --fast
  npm run -s word-pipeline -- rank --all --whisper
  npm run -s word-pipeline -- render --word 言う --fast
  npm run -s word-pipeline -- render --word 言う --fast --short
  npm run -s word-pipeline -- render --word 言う --fast --stitched --decorate
  npm run -s word-pipeline -- render --range 1-200 --whisper
  npm run -s word-pipeline -- full --all --fast
`.trim() + "\n",
  );
  process.exit(code);
}

function parseNumber(raw, name) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  return n;
}

function parseRange(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) {
    throw new Error(`Bad --range "${raw}". Use "<start>-<end>", e.g. 1-200`);
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    throw new Error(`Bad --range "${raw}". Range must be positive and end >= start.`);
  }
  return { start, end };
}

function parseArgs(argv) {
  const args = JSON.parse(JSON.stringify(DEFAULTS));
  const positional = [];

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) {
      positional.push(raw);
      continue;
    }
    const [k, maybeV] = raw.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };

    switch (k) {
      case "all":
        args.scope = { kind: "all", value: null };
        break;
      case "range":
        args.scope = { kind: "range", value: parseRange(v) };
        takeNext();
        break;
      case "word":
        args.scope = { kind: "word", value: String(v || "").trim() };
        takeNext();
        break;
      case "fast":
        args.profile = "fast";
        break;
      case "whisper":
        args.profile = "whisper";
        break;
      case "wordsFile":
        args.wordsFile = String(v || "").trim();
        takeNext();
        break;
      case "queryField":
        args.queryField = String(v || "").trim();
        takeNext();
        break;
      case "videosDir":
        args.videosDir = String(v || "").trim();
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
      case "subOffsetsFile":
        args.subOffsetsFile = String(v || "").trim();
        takeNext();
        break;
      case "noSubOffsetsFile":
        args.subOffsetsFile = null;
        break;
      case "outBase":
        args.outBase = String(v || "").trim();
        takeNext();
        break;
      case "topK":
        args.topK = parseNumber(v, "--topK");
        takeNext();
        break;
      case "maxPerWord":
        args.maxPerWord = parseNumber(v, "--maxPerWord");
        takeNext();
        break;
      case "maxCandidates":
        args.maxCandidates = parseNumber(v, "--maxCandidates");
        takeNext();
        break;
      case "mode":
        args.mode = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "enLinePolicy":
        args.enLinePolicy = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "model":
        args.model = String(v || "").trim();
        takeNext();
        break;
      case "printEvery":
        args.printEvery = parseNumber(v, "--printEvery");
        takeNext();
        break;
      case "renderMode":
        args.renderMode = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "short":
        args.renderMode = "short";
        break;
      case "stitched":
        args.renderMode = "stitched";
        break;
      case "allowFallbackRender":
        args.allowFallbackRender = true;
        break;
      case "no-allowFallbackRender":
        args.allowFallbackRender = false;
        break;
      case "allowWeak":
        args.allowWeak = true;
        break;
      case "no-allowWeak":
        args.allowWeak = false;
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
      case "decorate":
        args.decorate = true;
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "asrTopN":
        args.asrTopN = parseNumber(v, "--asrTopN");
        takeNext();
        break;
      case "asrWhisperBin":
        args.asrWhisperBin = String(v || "").trim();
        takeNext();
        break;
      case "asrWhisperModel":
        args.asrWhisperModel = String(v || "").trim();
        takeNext();
        break;
      case "asrLanguage":
        args.asrLanguage = String(v || "").trim();
        takeNext();
        break;
      case "asrTimeoutSec":
        args.asrTimeoutSec = parseNumber(v, "--asrTimeoutSec");
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

  if (positional.length > 1) {
    throw new Error(`Unexpected positional args: ${positional.slice(1).join(" ")}`);
  }
  if (positional.length === 1) {
    args.action = String(positional[0] || "").trim().toLowerCase();
  }

  if (!["rank", "render", "full"].includes(args.action)) {
    throw new Error(`Action must be rank, render, or full. Got "${args.action}".`);
  }
  if (!["fast", "whisper"].includes(args.profile)) {
    throw new Error(`Profile must be fast or whisper. Got "${args.profile}".`);
  }
  if (!["line", "sentence"].includes(args.mode)) {
    throw new Error(`--mode must be "line" or "sentence".`);
  }
  if (!["best", "nearest", "merge"].includes(args.enLinePolicy)) {
    throw new Error(`--enLinePolicy must be "best", "nearest", or "merge".`);
  }
  if (!["short", "stitched"].includes(args.renderMode)) {
    throw new Error(`--renderMode must be "short" or "stitched".`);
  }
  if (args.scope.kind === "word" && !args.scope.value) {
    throw new Error("--word requires a non-empty value.");
  }

  return args;
}

function loadWords(wordsFile, queryField) {
  const raw = JSON.parse(fs.readFileSync(wordsFile, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`Words file must be a JSON array: ${wordsFile}`);
  }
  return raw.map((entry, i) => {
    if (typeof entry === "string") {
      return { idx: i + 1, word: entry.trim() };
    }
    if (!entry || typeof entry !== "object") {
      return { idx: i + 1, word: "" };
    }
    const w = String(entry[queryField] ?? entry.word ?? "").trim();
    return { idx: i + 1, word: w };
  });
}

function resolveWindow(args) {
  const words = loadWords(args.wordsFile, args.queryField);
  const total = words.length;
  if (total === 0) {
    throw new Error(`No entries found in words file: ${args.wordsFile}`);
  }

  if (args.scope.kind === "all") {
    return { fromIndex: 1, count: 0, total, selectedWord: null };
  }

  if (args.scope.kind === "range") {
    const { start, end } = args.scope.value;
    if (start > total) {
      throw new Error(`--range start ${start} is beyond words list length ${total}.`);
    }
    const clampedEnd = Math.min(end, total);
    return {
      fromIndex: start,
      count: clampedEnd - start + 1,
      total,
      selectedWord: null,
    };
  }

  const target = String(args.scope.value || "").trim();
  const found = words.find((w) => w.word === target);
  if (!found) {
    throw new Error(`Word "${target}" was not found in ${args.wordsFile}`);
  }
  return {
    fromIndex: found.idx,
    count: 1,
    total,
    selectedWord: target,
  };
}

function runOrThrow(cmd, cmdArgs, verbose) {
  if (verbose) {
    console.log("");
    console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  }
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${path.basename(cmdArgs[0])} failed with exit code ${res.status}`);
  }
}

function runCaptureOrThrow(cmd, cmdArgs, verbose) {
  if (verbose) {
    console.log("");
    console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  }
  const res = spawnSync(cmd, cmdArgs, {
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
      `${path.basename(cmdArgs[0])} failed with exit code ${res.status}${tail ? `\n${tail}` : ""}`,
    );
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(path.resolve(filePath), JSON.stringify(value, null, 2));
}

function printRenderedOutputsFromManifest(manifest, outRoot) {
  const words = Array.isArray(manifest?.words) ? manifest.words : [];
  const rendered = [];
  const seen = new Set();
  for (const rec of words) {
    const status = String(rec?.status || "");
    const out = String(rec?.output || "").trim();
    if (!out) continue;
    if (status !== "rendered") continue;
    const abs = path.resolve(out);
    if (seen.has(abs)) continue;
    seen.add(abs);
    rendered.push(abs);
  }

  if (rendered.length === 0) {
    const fallbackDir = path.resolve(outRoot);
    console.log(`[word-pipeline] output: none rendered (check ${fallbackDir})`);
    return;
  }
  for (const out of rendered) {
    console.log(`[word-pipeline] output: ${out}`);
  }
}

function generatedShortOutputPath(outputDir, word) {
  return path.join(outputDir, `${safeFilename(word)}_clean_shorts.mp4`);
}

function canonicalShortOutputPath(outputDir, word) {
  return path.join(outputDir, `${safeFilename(word)}.mp4`);
}

function finalizeShortOutputFile(outputDir, word) {
  const generated = generatedShortOutputPath(outputDir, word);
  const canonical = canonicalShortOutputPath(outputDir, word);
  if (fs.existsSync(generated) && path.resolve(generated) !== path.resolve(canonical)) {
    fs.renameSync(generated, canonical);
  }
  if (fs.existsSync(canonical)) return canonical;
  if (fs.existsSync(generated)) return generated;
  return canonical;
}

function safeFilename(s) {
  const raw = String(s || "").trim();
  if (!raw) return "word";
  return raw
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
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

function getTargetWordsForScope(args) {
  const words = loadWords(args.wordsFile, args.queryField)
    .map((x) => x.word)
    .filter(Boolean);

  if (args.scope.kind === "all") return words;
  if (args.scope.kind === "range") {
    const { start, end } = args.scope.value;
    const s = Math.max(1, start);
    const e = Math.min(words.length, end);
    return words.slice(s - 1, e);
  }
  return [String(args.scope.value || "").trim()].filter(Boolean);
}

function preflightRender(args, outRoot) {
  const rerankFile = path.resolve(outRoot, "word-candidates-llm-top.json");
  if (!fs.existsSync(rerankFile)) {
    throw new Error(
      `Render needs ranked output first. Missing: ${rerankFile}\nRun: npm run -s word-pipeline -- rank --${args.scope.kind === "all" ? "all" : args.scope.kind === "range" ? `range ${args.scope.value.start}-${args.scope.value.end}` : `word ${args.scope.value}`} --${args.profile}`,
    );
  }

  const rerank = readJson(rerankFile);
  const records = Array.isArray(rerank?.words) ? rerank.words : [];
  const rankedWordSet = new Set(records.map((r) => String(r?.word || "")));
  const targets = getTargetWordsForScope(args);
  const matched = targets.filter((w) => rankedWordSet.has(w));

  if (matched.length === 0) {
    throw new Error(
      `No ranked words available yet for this render scope in ${rerankFile}.\nRequested=${targets.length}, ranked_now=${records.length}.`,
    );
  }

  if (args.scope.kind === "word" && matched.length !== 1) {
    throw new Error(
      `Word "${args.scope.value}" is not ranked yet in ${rerankFile}. Ranked words currently: ${records.length}.`,
    );
  }

  if (matched.length !== targets.length) {
    const missing = targets.length - matched.length;
    console.log(
      `[word-pipeline] render preflight: ${missing} requested word(s) are not ranked yet; rendering available subset (${matched.length}/${targets.length}).`,
    );
  }

  return { rerank, targets, matched };
}

function buildAutoCurateCli(args, window, outRoot, mode) {
  const cli = [path.join("scripts", "auto-curate-word-shorts.js")];
  cli.push("--wordsFile", args.wordsFile);
  cli.push("--queryField", args.queryField);
  cli.push("--fromIndex", String(window.fromIndex));
  cli.push("--count", String(window.count));
  cli.push("--subsDir", args.subsDir);
  cli.push("--videosDir", args.videosDir);
  if (args.enSubsDir) cli.push("--enSubsDir", args.enSubsDir);
  if (args.subOffsetsFile) cli.push("--subOffsetsFile", args.subOffsetsFile);
  else cli.push("--noSubOffsetsFile");
  cli.push("--outRoot", outRoot);
  cli.push("--mode", args.mode);
  cli.push("--enLinePolicy", args.enLinePolicy);
  cli.push("--topK", String(args.topK));
  cli.push("--maxPerWord", String(args.maxPerWord));
  cli.push("--maxCandidates", String(args.maxCandidates));
  cli.push("--model", args.model);
  cli.push("--printEvery", String(args.printEvery));
  if (args.resume) cli.push("--resume");
  else cli.push("--no-resume");
  if (args.force) cli.push("--force");
  if (args.decorate) cli.push("--decorate");
  if (args.dryRun) cli.push("--dryRun");
  if (args.verbose) cli.push("--verbose");

  if (args.profile === "whisper") {
    cli.push("--asrVerify");
    cli.push("--asrTopN", String(args.asrTopN));
    cli.push("--asrWhisperBin", args.asrWhisperBin);
    cli.push("--asrWhisperModel", args.asrWhisperModel);
    cli.push("--asrLanguage", args.asrLanguage);
    cli.push("--asrTimeoutSec", String(args.asrTimeoutSec));
  }
  if (args.allowFallbackRender) {
    cli.push("--allowFallbackRender");
  }
  if (args.allowWeak) {
    cli.push("--allowWeak");
  }

  if (mode === "rank") {
    cli.push("--skipRender");
  } else if (mode === "render") {
    cli.push("--skipBuild");
    cli.push("--skipRerank");
  }
  return cli;
}

function parsePickOutOfRangeError(message) {
  const m = String(message || "").match(/--pick index #\d+ is out of range \(candidates=(\d+)\)/);
  if (!m) return null;
  const maxCandidate = Number(m[1]);
  if (!Number.isFinite(maxCandidate) || maxCandidate < 0) return null;
  return { maxCandidate };
}

function backfillPicks(picks, maxCandidate, targetCount) {
  const out = uniquePositiveInts(picks).filter((n) => n <= maxCandidate);
  if (out.length >= targetCount) return out.slice(0, targetCount);
  for (let i = 1; i <= maxCandidate && out.length < targetCount; i++) {
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

function buildVerticalShortCli(args, outRoot, word, picks) {
  const outDir = path.resolve(outRoot, "work");
  const outputDir = path.resolve(outRoot);
  const cli = [
    path.join("scripts", "make-vertical-shorts-clean.js"),
    "--query",
    word,
    "--wordList",
    args.wordsFile,
    "--subsDir",
    args.subsDir,
    "--videosDir",
    args.videosDir,
    "--outDir",
    outDir,
    "--outputDir",
    outputDir,
    "--mode",
    args.mode,
    "--limit",
    String(picks.length),
    "--pick",
    picks.join(","),
    "--rank",
    "--prePadMs",
    "0",
    "--postPadMs",
    "0",
    "--maxClipMs",
    "2000",
    "--longPolicy",
    "skip",
    "--keepOutputs",
  ];
  if (args.enSubsDir) cli.push("--enSubsDir", args.enSubsDir);
  if (args.verbose) cli.push("--verbose");
  return cli;
}

function runShortRenderStage(args, outRoot) {
  const preflight = preflightRender(args, outRoot);
  const rerankWords = Array.isArray(preflight.rerank?.words) ? preflight.rerank.words : [];
  const rerankMap = new Map(rerankWords.map((rec) => [String(rec?.word || ""), rec]));
  const targets = preflight.targets;
  const outputDir = path.resolve(outRoot);

  const manifest = {
    meta: {
      createdAt: new Date().toISOString(),
      renderMode: "short",
      wordsFile: path.resolve(args.wordsFile),
      rerankFile: path.resolve(outRoot, "word-candidates-llm-top.json"),
      outputDir,
      profile: args.profile,
      topK: args.topK,
      mode: args.mode,
      allowFallbackRender: args.allowFallbackRender,
      scope: args.scope,
    },
    summary: {
      targetWords: targets.length,
      attempted: 0,
      rendered: 0,
      skipped: 0,
      failed: 0,
    },
    words: [],
  };

  for (let i = 0; i < targets.length; i++) {
    const word = targets[i];
    const rec = rerankMap.get(word);
    let output = canonicalShortOutputPath(outputDir, word);
    if (!rec) {
      manifest.summary.skipped++;
      manifest.words.push({
        word,
        status: "skipped",
        reason: "not_ranked_yet",
        picks: [],
        output,
        error: null,
      });
      continue;
    }

    const status = String(rec?.status || "");
    const top = Array.isArray(rec?.top) ? rec.top : [];
    let picks = uniquePositiveInts(top.slice(0, args.topK).map((x) => x?.candidateIndex));
    if (picks.length < args.topK) {
      const allTop = uniquePositiveInts(top.map((x) => x?.candidateIndex));
      for (const n of allTop) {
        if (picks.includes(n)) continue;
        picks.push(n);
        if (picks.length >= args.topK) break;
      }
    }

    manifest.summary.attempted++;
    const canRenderStatus = status === "ok" || (args.allowFallbackRender && status === "fallback");
    if (!canRenderStatus || picks.length === 0) {
      manifest.summary.skipped++;
      manifest.words.push({
        word,
        status: "skipped",
        reason: !canRenderStatus
          ? (status === "fallback" ? "fallback_blocked" : status || "status_not_renderable")
          : "no_top_picks",
        picks: [],
        output,
        error: null,
      });
      continue;
    }

    let finalPicks = picks;
    let note = null;
    const cli = () => buildVerticalShortCli(args, outRoot, word, finalPicks);

    try {
      if (args.dryRun) {
        console.log(`$ ${process.execPath} ${cli().join(" ")}`);
      } else {
        runCaptureOrThrow(process.execPath, cli(), args.verbose);
        output = finalizeShortOutputFile(outputDir, word);
      }
      manifest.summary.rendered++;
      manifest.words.push({
        word,
        status: args.dryRun ? "planned" : "rendered",
        reason: note,
        picks: finalPicks,
        output,
        error: null,
      });
    } catch (err) {
      const outOfRange = parsePickOutOfRangeError(err?.message || String(err));
      if (outOfRange) {
        const adjusted = backfillPicks(finalPicks, outOfRange.maxCandidate, args.topK);
        if (adjusted.length > 0 && adjusted.join(",") !== finalPicks.join(",")) {
          note = `adjusted_picks_to_available_candidates(${adjusted.length}/${finalPicks.length})`;
          finalPicks = adjusted;
          try {
            if (args.dryRun) {
              console.log(`$ ${process.execPath} ${cli().join(" ")}`);
            } else {
              runCaptureOrThrow(process.execPath, cli(), args.verbose);
              output = finalizeShortOutputFile(outputDir, word);
            }
            manifest.summary.rendered++;
            manifest.words.push({
              word,
              status: args.dryRun ? "planned" : "rendered",
              reason: note,
              picks: finalPicks,
              output,
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
        reason: status || null,
        picks: finalPicks,
        output,
        error: err?.message || String(err),
      });
    }
  }

  const manifestPath = path.resolve(outRoot, "render-manifest.json");
  writeJson(manifestPath, manifest);
  console.log("");
  console.log(`Auto-curation manifest: ${manifestPath}`);
  console.log(
    `Summary: target=${manifest.summary.targetWords} attempted=${manifest.summary.attempted} rendered=${manifest.summary.rendered} skipped=${manifest.summary.skipped} failed=${manifest.summary.failed}`,
  );
  printRenderedOutputsFromManifest(manifest, outRoot);
}

function runStitchedRenderStage(args, window, outRoot) {
  preflightRender(args, outRoot);
  const cli = buildAutoCurateCli(args, window, outRoot, "render");
  runOrThrow(process.execPath, cli, args.verbose);
  const manifestPath = path.resolve(outRoot, "render-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = readJson(manifestPath);
      printRenderedOutputsFromManifest(manifest, outRoot);
    } catch {
      const fallbackDir = path.resolve(outRoot);
      console.log(`[word-pipeline] output: check ${fallbackDir}`);
    }
  } else {
    const fallbackDir = path.resolve(outRoot);
    console.log(`[word-pipeline] output: check ${fallbackDir}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const window = resolveWindow(args);

  const outRoot = path.resolve(args.outBase, args.profile);

  const scopeLabel =
    args.scope.kind === "all"
      ? "all"
      : args.scope.kind === "range"
        ? `${args.scope.value.start}-${args.scope.value.end}`
        : args.scope.value;
  console.log(`[word-pipeline] action=${args.action} profile=${args.profile} scope=${scopeLabel}`);
  console.log(
    `[word-pipeline] wordsWindow=${window.fromIndex} +${window.count === 0 ? "all" : window.count} outRoot=${outRoot}`,
  );
  console.log(`[word-pipeline] renderMode=${args.renderMode}`);
  if (window.selectedWord) {
    console.log(`[word-pipeline] selectedWord=${window.selectedWord} index=${window.fromIndex}/${window.total}`);
  }

  if (args.action === "rank") {
    const cli = buildAutoCurateCli(args, window, outRoot, "rank");
    runOrThrow(process.execPath, cli, args.verbose);
    return;
  }

  if (args.action === "render") {
    if (args.renderMode === "short") runShortRenderStage(args, outRoot);
    else runStitchedRenderStage(args, window, outRoot);
    return;
  }

  // full = rank + render
  const rankCli = buildAutoCurateCli(args, window, outRoot, "rank");
  runOrThrow(process.execPath, rankCli, args.verbose);
  if (args.renderMode === "short") runShortRenderStage(args, outRoot);
  else runStitchedRenderStage(args, window, outRoot);
}

try {
  main();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
