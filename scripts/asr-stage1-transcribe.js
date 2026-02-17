#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_DB_FILE = path.join("out", "shorts", "word-candidates-db.json");
const DEFAULT_OUT_FILE = path.join("out", "shorts", "word-candidates-asr-stage1.json");

function parseRange(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) throw new Error(`Bad --range "${raw}". Use "<start>-<end>", e.g. 70-80`);
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    throw new Error(`Bad --range "${raw}". Range must be positive and end >= start.`);
  }
  return { start, end };
}

function parseArgs(argv) {
  const args = {
    dbFile: DEFAULT_DB_FILE,
    outFile: DEFAULT_OUT_FILE,
    fromIndex: 1,
    count: 0,
    range: null,
    word: "",
    topN: 5,
    resume: true,
    force: false,
    printEvery: 1,
    dryRun: false,
    verbose: false,
    asrWhisperBin: "whisper",
    asrWhisperModel: "small",
    asrLanguage: "Japanese",
    asrTimeoutSec: 120,
    asrWorkDir: path.join("dissfiles", "word-candidate-asr-stage1"),
    asrCacheFile: path.join("dissfiles", "word-candidate-asr-stage1", "cache.json"),
    prePadMs: 350,
    postPadMs: 550,
    maxClipMs: 3200,
    longPolicy: "shrink", // shrink | skip
    keepArtifacts: false,
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
      case "dbFile":
        args.dbFile = String(v || "").trim();
        takeNext();
        break;
      case "outFile":
        args.outFile = String(v || "").trim();
        takeNext();
        break;
      case "fromIndex":
        args.fromIndex = Number(v);
        takeNext();
        break;
      case "count":
        args.count = Number(v);
        takeNext();
        break;
      case "range":
        args.range = parseRange(v);
        takeNext();
        break;
      case "word":
        args.word = String(v || "").trim();
        takeNext();
        break;
      case "topN":
        args.topN = Number(v);
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
      case "printEvery":
        args.printEvery = Number(v);
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "verbose":
        args.verbose = true;
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
        args.asrTimeoutSec = Number(v);
        takeNext();
        break;
      case "asrWorkDir":
        args.asrWorkDir = String(v || "").trim();
        takeNext();
        break;
      case "asrCacheFile":
        args.asrCacheFile = String(v || "").trim();
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
      case "maxClipMs":
        args.maxClipMs = Number(v);
        takeNext();
        break;
      case "longPolicy":
        args.longPolicy = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "keepArtifacts":
        args.keepArtifacts = true;
        break;
      case "help":
      case "h":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  if (!Number.isFinite(args.fromIndex) || args.fromIndex <= 0) {
    throw new Error("--fromIndex must be a positive number.");
  }
  if (!Number.isFinite(args.count) || args.count < 0) {
    throw new Error("--count must be >= 0.");
  }
  if (!Number.isFinite(args.topN) || args.topN <= 0) {
    throw new Error("--topN must be a positive number.");
  }
  if (!Number.isFinite(args.printEvery) || args.printEvery <= 0) {
    throw new Error("--printEvery must be a positive number.");
  }
  if (!Number.isFinite(args.asrTimeoutSec) || args.asrTimeoutSec <= 0) {
    throw new Error("--asrTimeoutSec must be > 0.");
  }
  if (!Number.isFinite(args.prePadMs) || args.prePadMs < 0) {
    throw new Error("--prePadMs must be >= 0.");
  }
  if (!Number.isFinite(args.postPadMs) || args.postPadMs < 0) {
    throw new Error("--postPadMs must be >= 0.");
  }
  if (!Number.isFinite(args.maxClipMs) || args.maxClipMs <= 0) {
    throw new Error("--maxClipMs must be > 0.");
  }
  if (!["shrink", "skip"].includes(args.longPolicy)) {
    throw new Error('--longPolicy must be "shrink" or "skip".');
  }

  args.dbFile = path.resolve(args.dbFile);
  args.outFile = path.resolve(args.outFile);
  args.asrWorkDir = path.resolve(args.asrWorkDir);
  args.asrCacheFile = path.resolve(args.asrCacheFile);

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/asr-stage1-transcribe.js [options]

Scope (pick one):
  --word <text>           Single word
  --range <start-end>     1-based inclusive range
  --fromIndex <n>         Start index (default: 1)
  --count <n>             Number of words (0 = all from start)

Core:
  --dbFile <file>         Candidate DB (default: ${DEFAULT_DB_FILE})
  --outFile <file>        Sidecar output JSON (default: ${DEFAULT_OUT_FILE})
  --topN <n>              Candidates per word to transcribe (default: 5)
  --resume                Skip words already present in outFile (default: on)
  --force                 Re-process even if already present
  --printEvery <n>        Progress print interval (default: 1)
  --dryRun                Plan only, no ASR calls
  --verbose               Verbose logs

ASR:
  --asrWhisperBin <cmd>   Whisper executable (default: whisper)
  --asrWhisperModel <m>   Whisper model (default: small)
  --asrLanguage <name>    Whisper language (default: Japanese)
  --asrTimeoutSec <n>     Timeout per candidate (default: 120)
  --asrWorkDir <dir>      Temp ASR artifacts (default: dissfiles/word-candidate-asr-stage1)
  --asrCacheFile <file>   ASR cache JSON (default: dissfiles/word-candidate-asr-stage1/cache.json)

Clip window:
  --prePadMs <n>          Pad before candidate clip (default: 350)
  --postPadMs <n>         Pad after candidate clip (default: 550)
  --maxClipMs <n>         Max clip duration after pad (default: 3200)
  --longPolicy <p>        shrink|skip for overlong clips (default: shrink)
  --keepArtifacts         Keep wav/json artifacts in asrWorkDir
`.trim() + "\n",
  );
  process.exit(code);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  const out = path.resolve(filePath);
  ensureDir(path.dirname(out));
  const tmp = `${out}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, out);
}

function safeHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 20);
}

function stripAnsi(s) {
  return String(s || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function msToFfmpegTime(msRaw) {
  const ms = Math.max(0, Number(msRaw) || 0);
  const totalSeconds = ms / 1000;
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${hh}:${mm}:${ss}`;
}

function normalizeForAsr(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。！？!?…〜~ー―—・、,，.「」『』（）()［］【】<>＜＞"'`]/g, "");
}

function toBigramSet(text) {
  const chars = Array.from(text || "");
  if (chars.length === 0) return new Set();
  if (chars.length === 1) return new Set(chars);
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  const aSet = toBigramSet(a);
  const bSet = toBigramSet(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const x of aSet) {
    if (bSet.has(x)) inter++;
  }
  return (2 * inter) / (aSet.size + bSet.size);
}

function containmentSimilarity(a, b) {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (!shorter || !longer) return 0;
  if (!longer.includes(shorter)) return 0;
  return shorter.length / Math.max(1, longer.length);
}

function computeAsrAgreement({ jpText, asrText }) {
  const jp = normalizeForAsr(jpText);
  const asr = normalizeForAsr(asrText);
  if (!jp || !asr) return 0;
  const dice = diceSimilarity(jp, asr);
  const contain = containmentSimilarity(jp, asr);
  return Math.max(dice, contain);
}

function asrCacheKey(args, candidate, clipWindow) {
  return safeHash(
    JSON.stringify({
      model: args.asrWhisperModel,
      language: args.asrLanguage,
      videoFile: path.resolve(String(candidate.videoFile || "")),
      clipStartMs: Number(clipWindow.startMs || 0),
      clipEndMs: Number(clipWindow.endMs || 0),
      prePadMs: args.prePadMs,
      postPadMs: args.postPadMs,
      maxClipMs: args.maxClipMs,
      longPolicy: args.longPolicy,
      jpText: String(candidate.jpText || ""),
    }),
  );
}

function loadAsrCache(cacheFile) {
  if (!cacheFile || !fs.existsSync(cacheFile)) {
    return { meta: { updatedAt: null }, entries: {} };
  }
  try {
    const parsed = readJson(cacheFile);
    return {
      meta: parsed?.meta && typeof parsed.meta === "object" ? parsed.meta : { updatedAt: null },
      entries:
        parsed?.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)
          ? parsed.entries
          : {},
    };
  } catch {
    return { meta: { updatedAt: null }, entries: {} };
  }
}

function saveAsrCache(cacheFile, cache) {
  if (!cacheFile || !cache) return;
  cache.meta = cache.meta && typeof cache.meta === "object" ? cache.meta : {};
  cache.meta.updatedAt = new Date().toISOString();
  writeJsonAtomic(cacheFile, cache);
}

function extractAsrText(jsonPath) {
  if (!jsonPath || !fs.existsSync(jsonPath)) return "";
  try {
    const parsed = readJson(jsonPath);
    const direct = String(parsed?.text || "").trim();
    if (direct) return direct;
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const pieces = segments
      .map((s) => String(s?.text || "").trim())
      .filter(Boolean);
    return pieces.join(" ").trim();
  } catch {
    return "";
  }
}

function boundedClipWindow(candidate, args) {
  const rawStart = Math.max(0, Number(candidate.clipStartMs || 0) - args.prePadMs);
  const rawEnd = Number(candidate.clipEndMs || 0) + args.postPadMs;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) {
    return null;
  }
  let startMs = rawStart;
  let endMs = rawEnd;
  const duration = endMs - startMs;
  if (duration > args.maxClipMs) {
    if (args.longPolicy === "skip") return null;
    const anchorStart = Number.isFinite(Number(candidate.matchStartMs))
      ? Number(candidate.matchStartMs)
      : Number(candidate.clipStartMs || 0);
    const anchorEnd = Number.isFinite(Number(candidate.matchEndMs))
      ? Number(candidate.matchEndMs)
      : Number(candidate.clipEndMs || 0);
    const mid = (anchorStart + anchorEnd) / 2;
    startMs = Math.max(0, Math.round(mid - args.maxClipMs / 2));
    endMs = startMs + args.maxClipMs;
  }
  if (endMs <= startMs) return null;
  return { startMs, endMs, durationMs: endMs - startMs };
}

function verifyCandidateAsr({ args, candidate, asrCache }) {
  if (!candidate || !candidate.videoFile) {
    return {
      status: "no_video",
      text: "",
      agreement: null,
      error: "missing_video",
      fromCache: false,
      clipWindow: null,
    };
  }
  const videoFile = path.resolve(String(candidate.videoFile));
  if (!fs.existsSync(videoFile)) {
    return {
      status: "no_video",
      text: "",
      agreement: null,
      error: "video_not_found",
      fromCache: false,
      clipWindow: null,
    };
  }

  const clipWindow = boundedClipWindow(candidate, args);
  if (!clipWindow) {
    return {
      status: "window_skipped",
      text: "",
      agreement: null,
      error: "invalid_or_overlong_clip",
      fromCache: false,
      clipWindow: null,
    };
  }

  ensureDir(args.asrWorkDir);
  const key = asrCacheKey(args, candidate, clipWindow);
  const cached = asrCache?.entries?.[key];
  if (cached && typeof cached === "object") {
    return {
      ...cached,
      fromCache: true,
      clipWindow,
    };
  }

  const wavBase = `asr_${key}`;
  const wavPath = path.join(args.asrWorkDir, `${wavBase}.wav`);
  const jsonPath = path.join(args.asrWorkDir, `${wavBase}.json`);
  const ffmpegRes = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      msToFfmpegTime(clipWindow.startMs),
      "-i",
      videoFile,
      "-t",
      String((clipWindow.durationMs / 1000).toFixed(3)),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ],
    {
      encoding: "utf8",
      timeout: Math.round(args.asrTimeoutSec * 1000),
      maxBuffer: 1024 * 1024 * 20,
    },
  );
  if (ffmpegRes.status !== 0) {
    const result = {
      status: "ffmpeg_error",
      text: "",
      agreement: null,
      error: stripAnsi(ffmpegRes.stderr || ffmpegRes.stdout || "").slice(0, 400),
      fromCache: false,
    };
    if (asrCache?.entries) asrCache.entries[key] = result;
    return { ...result, clipWindow };
  }

  const whisperRes = spawnSync(
    args.asrWhisperBin,
    [
      wavPath,
      "--model",
      args.asrWhisperModel,
      "--language",
      args.asrLanguage,
      "--task",
      "transcribe",
      "--output_dir",
      args.asrWorkDir,
      "--output_format",
      "json",
      "--fp16",
      "False",
    ],
    {
      encoding: "utf8",
      timeout: Math.round(args.asrTimeoutSec * 1000),
      maxBuffer: 1024 * 1024 * 30,
    },
  );
  if (whisperRes.status !== 0) {
    const result = {
      status: "whisper_error",
      text: "",
      agreement: null,
      error: stripAnsi(whisperRes.stderr || whisperRes.stdout || "").slice(0, 400),
      fromCache: false,
    };
    if (asrCache?.entries) asrCache.entries[key] = result;
    return { ...result, clipWindow };
  }

  const asrText = extractAsrText(jsonPath);
  const agreement = computeAsrAgreement({
    jpText: String(candidate.jpText || ""),
    asrText,
  });
  const result = {
    status: asrText ? "ok" : "empty",
    text: asrText,
    agreement: Number.isFinite(agreement) ? Math.round(agreement * 1000) / 1000 : null,
    error: null,
    fromCache: false,
  };
  if (asrCache?.entries) asrCache.entries[key] = result;

  if (!args.keepArtifacts) {
    try {
      if (fs.existsSync(wavPath)) fs.rmSync(wavPath, { force: true });
      if (fs.existsSync(jsonPath)) fs.rmSync(jsonPath, { force: true });
    } catch {
      // ignore cleanup failures
    }
  }

  return { ...result, clipWindow };
}

function selectTargetWords(db, args) {
  const all = (Array.isArray(db?.words) ? db.words : []).map((w, i) => ({
    index: i + 1,
    word: String(w?.word || ""),
    source: w,
  }));
  if (all.length === 0) throw new Error("No words found in DB.");

  if (args.word) {
    const found = all.find((x) => x.word === args.word);
    if (!found) throw new Error(`Word "${args.word}" not found in DB.`);
    return [found];
  }
  if (args.range) {
    const start = args.range.start;
    const end = Math.min(args.range.end, all.length);
    if (start > all.length) throw new Error(`Range start ${start} exceeds DB length ${all.length}.`);
    return all.slice(start - 1, end);
  }
  const start = Math.max(1, args.fromIndex);
  const end = args.count > 0 ? Math.min(all.length, start - 1 + args.count) : all.length;
  return all.slice(start - 1, end);
}

function toWordMap(words) {
  const m = new Map();
  for (const w of words || []) {
    const key = String(w?.word || "");
    if (!key || m.has(key)) continue;
    m.set(key, w);
  }
  return m;
}

function buildOutSkeleton(args, db, targets) {
  return {
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generator: "asr-stage1-transcribe.v1",
      sourceDbFile: path.resolve(args.dbFile),
      sourceDbCreatedAt: db?.meta?.createdAt ?? null,
      asrWhisperBin: args.asrWhisperBin,
      asrWhisperModel: args.asrWhisperModel,
      asrLanguage: args.asrLanguage,
      asrTimeoutSec: args.asrTimeoutSec,
      asrWorkDir: args.asrWorkDir,
      asrCacheFile: args.asrCacheFile,
      topN: args.topN,
      prePadMs: args.prePadMs,
      postPadMs: args.postPadMs,
      maxClipMs: args.maxClipMs,
      longPolicy: args.longPolicy,
      scope: args.word
        ? { kind: "word", value: args.word }
        : args.range
          ? { kind: "range", value: args.range }
          : { kind: "window", fromIndex: args.fromIndex, count: args.count },
    },
    summary: {
      targetWords: targets.length,
      processedWords: 0,
      okWords: 0,
      partialWords: 0,
      skipWords: 0,
      errorWords: 0,
      totalCandidates: 0,
      okCandidates: 0,
      emptyCandidates: 0,
      errorCandidates: 0,
      cacheHits: 0,
    },
    words: [],
  };
}

function recomputeSummary(out, targets) {
  const targetSet = new Set(targets.map((t) => t.word));
  const scoped = (Array.isArray(out?.words) ? out.words : []).filter((w) => targetSet.has(String(w?.word || "")));
  const s = {
    targetWords: targets.length,
    processedWords: scoped.length,
    okWords: 0,
    partialWords: 0,
    skipWords: 0,
    errorWords: 0,
    totalCandidates: 0,
    okCandidates: 0,
    emptyCandidates: 0,
    errorCandidates: 0,
    cacheHits: 0,
  };
  for (const w of scoped) {
    const status = String(w?.status || "");
    if (status === "ok") s.okWords++;
    else if (status === "partial") s.partialWords++;
    else if (status === "skip") s.skipWords++;
    else s.errorWords++;

    const list = Array.isArray(w?.candidates) ? w.candidates : [];
    s.totalCandidates += list.length;
    for (const c of list) {
      const st = String(c?.asrStatus || "");
      if (st === "ok") s.okCandidates++;
      else if (st === "empty") s.emptyCandidates++;
      else if (st === "window_skipped") {
        // treated as error bucket for now
        s.errorCandidates++;
      } else if (st) {
        s.errorCandidates++;
      }
      if (c?.fromCache) s.cacheHits++;
    }
  }
  out.summary = s;
}

function wordAlreadyDone(existing, expectedCandidates) {
  if (!existing || typeof existing !== "object") return false;
  const status = String(existing.status || "");
  const done = Array.isArray(existing.candidates) ? existing.candidates.length : 0;
  if (!["ok", "partial", "skip", "error"].includes(status)) return false;
  return done >= expectedCandidates;
}

function processWord({ target, args, asrCache }) {
  const source = target.source || {};
  const sourceCandidates = Array.isArray(source.candidates) ? source.candidates : [];
  const candidates = sourceCandidates.slice(0, args.topN);
  const outWord = {
    word: target.word,
    index: target.index,
    sourceCandidateCount: sourceCandidates.length,
    candidatesRequested: candidates.length,
    status: "skip",
    updatedAt: new Date().toISOString(),
    candidates: [],
    error: null,
  };

  if (candidates.length === 0) {
    return outWord;
  }

  let ok = 0;
  let anyError = false;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const asr = verifyCandidateAsr({
      args,
      candidate: c,
      asrCache,
    });
    if (asr.status === "ok") ok++;
    if (!["ok", "empty"].includes(asr.status)) anyError = true;
    outWord.candidates.push({
      candidateIndex: i + 1,
      sourceRank: Number(c?.rank || i + 1),
      episode: String(c?.episode || ""),
      clipStartMs: Number(c?.clipStartMs || 0),
      clipEndMs: Number(c?.clipEndMs || 0),
      clipStartUsedMs: Number(asr?.clipWindow?.startMs ?? c?.clipStartMs ?? 0),
      clipEndUsedMs: Number(asr?.clipWindow?.endMs ?? c?.clipEndMs ?? 0),
      durationUsedMs: Number(asr?.clipWindow?.durationMs ?? 0),
      jpText: String(c?.jpText || ""),
      enText: String(c?.enText || ""),
      asrStatus: String(asr?.status || ""),
      asrAgreement: Number.isFinite(Number(asr?.agreement)) ? Number(asr.agreement) : null,
      asrText: String(asr?.text || ""),
      fromCache: Boolean(asr?.fromCache),
      error: asr?.error ? String(asr.error) : null,
    });
  }

  if (ok === candidates.length) outWord.status = "ok";
  else if (ok > 0 || (ok === 0 && !anyError)) outWord.status = "partial";
  else outWord.status = "error";
  return outWord;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.dbFile)) throw new Error(`DB file not found: ${args.dbFile}`);
  const db = readJson(args.dbFile);
  const targets = selectTargetWords(db, args);

  const asrCache = loadAsrCache(args.asrCacheFile);
  let out = null;
  if (args.resume && fs.existsSync(args.outFile)) {
    out = readJson(args.outFile);
  } else {
    out = buildOutSkeleton(args, db, targets);
  }
  out.meta = out.meta && typeof out.meta === "object" ? out.meta : {};
  out.meta.updatedAt = new Date().toISOString();
  out.meta.asrWhisperModel = args.asrWhisperModel;
  out.meta.asrLanguage = args.asrLanguage;
  out.meta.topN = args.topN;
  out.meta.prePadMs = args.prePadMs;
  out.meta.postPadMs = args.postPadMs;
  out.meta.maxClipMs = args.maxClipMs;
  out.meta.longPolicy = args.longPolicy;
  out.meta.scope = args.word
    ? { kind: "word", value: args.word }
    : args.range
      ? { kind: "range", value: args.range }
      : { kind: "window", fromIndex: args.fromIndex, count: args.count };

  const outWords = Array.isArray(out.words) ? out.words : [];
  const outMap = toWordMap(outWords);
  let processedNow = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const srcCandidates = Array.isArray(t?.source?.candidates) ? t.source.candidates : [];
    const expected = Math.min(args.topN, srcCandidates.length);
    const existing = outMap.get(t.word);
    if (!args.force && wordAlreadyDone(existing, expected)) {
      if ((i + 1) % args.printEvery === 0 || i === targets.length - 1) {
        console.log(`[${i + 1}/${targets.length}] ${t.word} -> status=skip(existing) top=${expected}`);
      }
      continue;
    }

    const nextWord = args.dryRun
      ? {
          word: t.word,
          index: t.index,
          sourceCandidateCount: srcCandidates.length,
          candidatesRequested: expected,
          status: "skip",
          updatedAt: new Date().toISOString(),
          candidates: [],
          error: "dry_run",
        }
      : processWord({ target: t, args, asrCache });
    outMap.set(t.word, nextWord);
    processedNow++;

    out.words = Array.from(outMap.values()).sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    out.meta.updatedAt = new Date().toISOString();
    recomputeSummary(out, targets);
    if (!args.dryRun) {
      writeJsonAtomic(args.outFile, out);
      saveAsrCache(args.asrCacheFile, asrCache);
    }

    if ((i + 1) % args.printEvery === 0 || i === targets.length - 1) {
      console.log(
        `[${i + 1}/${targets.length}] ${t.word} -> status=${nextWord.status} top=${nextWord.candidatesRequested}`,
      );
    }
  }

  out.words = Array.from(outMap.values()).sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  recomputeSummary(out, targets);
  out.meta.updatedAt = new Date().toISOString();
  if (!args.dryRun) {
    writeJsonAtomic(args.outFile, out);
    saveAsrCache(args.asrCacheFile, asrCache);
  }

  console.log("");
  console.log(`Done. Output: ${args.outFile}`);
  console.log(
    `Summary: processedNow=${processedNow}/${targets.length} words, ok=${out.summary.okWords}, partial=${out.summary.partialWords}, skip=${out.summary.skipWords}, error=${out.summary.errorWords}`,
  );
  console.log(
    `Candidates: total=${out.summary.totalCandidates}, ok=${out.summary.okCandidates}, empty=${out.summary.emptyCandidates}, error=${out.summary.errorCandidates}, cacheHits=${out.summary.cacheHits}`,
  );
}

main();

