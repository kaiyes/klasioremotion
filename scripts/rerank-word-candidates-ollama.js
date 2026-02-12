#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const DEFAULT_DB_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "word-candidates-db.json",
);
const DEFAULT_OUT_FILE = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "word-candidates-llm-top.json",
);

function parseArgs(argv) {
  const args = {
    dbFile: DEFAULT_DB_FILE,
    outFile: DEFAULT_OUT_FILE,
    model: "llama3.2:3b",
    host: "http://127.0.0.1:11434",
    topK: 5,
    maxCandidates: 50,
    fromIndex: 1,
    count: 0,
    resume: true,
    force: false,
    timeoutSec: 120,
    temperature: 0.1,
    retries: 2,
    minReasonChars: 10,
    requireMeaningful: true,
    allowFallback: false,
    gateSenseLock: true,
    gateFragmentReject: true,
    minBreathChars: 6,
    printEvery: 25,
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
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, maybeV] = a.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };

    switch (k) {
      case "dbFile":
        args.dbFile = v;
        takeNext();
        break;
      case "outFile":
        args.outFile = v;
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
      case "topK":
        args.topK = Number(v);
        takeNext();
        break;
      case "maxCandidates":
        args.maxCandidates = Number(v);
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
      case "resume":
        args.resume = true;
        break;
      case "no-resume":
        args.resume = false;
        break;
      case "force":
        args.force = true;
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
      case "allowFallback":
        args.allowFallback = true;
        break;
      case "failClosed":
      case "no-allowFallback":
        args.allowFallback = false;
        break;
      case "gateSenseLock":
        args.gateSenseLock = true;
        break;
      case "no-gateSenseLock":
        args.gateSenseLock = false;
        break;
      case "gateFragmentReject":
        args.gateFragmentReject = true;
        break;
      case "no-gateFragmentReject":
        args.gateFragmentReject = false;
        break;
      case "minBreathChars":
        args.minBreathChars = Number(v);
        takeNext();
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
      case "asrVerify":
        args.asrVerify = true;
        break;
      case "no-asrVerify":
        args.asrVerify = false;
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

  if (!Number.isFinite(args.topK) || args.topK <= 0) {
    throw new Error("--topK must be a positive number.");
  }
  if (!Number.isFinite(args.maxCandidates) || args.maxCandidates <= 0) {
    throw new Error("--maxCandidates must be a positive number.");
  }
  if (!Number.isFinite(args.fromIndex) || args.fromIndex <= 0) {
    throw new Error("--fromIndex must be a positive number.");
  }
  if (!Number.isFinite(args.count) || args.count < 0) {
    throw new Error("--count must be >= 0.");
  }
  if (!Number.isFinite(args.timeoutSec) || args.timeoutSec <= 0) {
    throw new Error("--timeoutSec must be > 0.");
  }
  if (!Number.isFinite(args.retries) || args.retries < 0) {
    throw new Error("--retries must be >= 0.");
  }
  if (!Number.isFinite(args.minReasonChars) || args.minReasonChars < 0) {
    throw new Error("--minReasonChars must be >= 0.");
  }
  if (!Number.isFinite(args.minBreathChars) || args.minBreathChars < 0) {
    throw new Error("--minBreathChars must be >= 0.");
  }
  if (!Number.isFinite(args.asrTopN) || args.asrTopN < 0) {
    throw new Error("--asrTopN must be >= 0.");
  }
  if (!Number.isFinite(args.asrTimeoutSec) || args.asrTimeoutSec <= 0) {
    throw new Error("--asrTimeoutSec must be > 0.");
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/rerank-word-candidates-ollama.js [options]

What it does:
  - Reads word candidates DB
  - Uses local Ollama model to pick best examples per word
  - Writes progress after each word (resumable)

Options:
  --dbFile <file>          Default: ${DEFAULT_DB_FILE}
  --outFile <file>         Default: ${DEFAULT_OUT_FILE}
  --model <name>           Ollama model (default: llama3.2:3b)
  --host <url>             Ollama host (default: http://127.0.0.1:11434)
  --topK <n>               Top picks per word (default: 5)
  --maxCandidates <n>      Max candidates per word sent to LLM (default: 50)
  --fromIndex <n>          1-based start index in DB words (default: 1)
  --count <n>              Number of words to process (0 = all from fromIndex)
  --resume / --no-resume   Resume from existing outFile (default: resume)
  --force                  Recompute already processed words
  --timeoutSec <n>         Per-request timeout (default: 120)
  --temperature <n>        Sampling temperature (default: 0.1)
  --retries <n>            Retry count for invalid/failed responses (default: 2)
  --minReasonChars <n>     Minimum reason length per pick (default: 10)
  --requireMeaningful      Reject trivial rankings (default: on)
  --allowWeak              Accept weak/trivial rankings
  --allowFallback          Allow heuristic fallback when LLM fails (default: off / fail-closed)
  --failClosed             Alias for strict mode (default behavior)
  --gateSenseLock          Require inflected/specific form match; block shared-kanji false positives (default: on)
  --no-gateSenseLock       Disable sense-lock gate
  --gateFragmentReject     Reject fragment/ellipsis-like JP lines (default: on)
  --no-gateFragmentReject  Disable fragment gate
  --minBreathChars <n>     Minimum JP core length after cleanup (default: 6)
  --asrVerify              Verify subtitle/audio agreement via local Whisper (default: off)
  --asrTopN <n>            Verify only first N candidates per word (default: 12, 0 = all)
  --asrWhisperBin <cmd>    Whisper executable (default: whisper)
  --asrWhisperModel <name> Whisper model used for verification (default: small)
  --asrLanguage <name>     Whisper language for verification (default: Japanese)
  --asrTimeoutSec <n>      Timeout per ASR clip (default: 90)
  --asrWorkDir <dir>       Temp/cached ASR artifacts (default: dissfiles/word-candidate-asr)
  --asrCacheFile <file>    JSON cache for ASR results (default: dissfiles/word-candidate-asr/cache.json)
  --printEvery <n>         Progress interval (default: 25)
  --dryRun                 Skip Ollama calls, fallback to heuristic top-K
  --verbose                Verbose logs
`.trim() + "\n",
  );
  process.exit(code);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const abs = path.resolve(filePath);
  ensureDir(path.dirname(abs));
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, abs);
}

function sliceByWindow(items, fromIndex, count) {
  const start = Math.max(0, fromIndex - 1);
  if (count > 0) return items.slice(start, start + count);
  return items.slice(start);
}

function candidateLabel(c, idx, asr = null) {
  const ep = c.episode || "";
  const start = c.clipStart || c.clipStartMs || "";
  const end = c.clipEnd || c.clipEndMs || "";
  const hs = Number.isFinite(Number(c.score)) ? Number(c.score) : null;
  const asrText = String(asr?.text || "").replace(/\s+/g, " ").trim();
  return {
    i: idx + 1,
    episode: ep,
    start,
    end,
    heuristicScore: hs,
    jp: String(c.jpText || ""),
    en: String(c.enText || ""),
    asrAgreement: Number.isFinite(Number(asr?.agreement))
      ? Math.round(Number(asr.agreement) * 1000) / 1000
      : null,
    asr: asrText.slice(0, 160),
    asrStatus: String(asr?.status || ""),
  };
}

function buildPrompt({ word, topK, candidates }) {
  const payload = {
    targetWord: word,
    topK,
    candidates,
  };

  return `
You are ranking subtitle examples for Japanese beginners.

Task:
- Pick the best ${topK} examples that teach the target word in clear, natural context for beginner learners.
- Prefer short, concrete, high-frequency everyday usage.
- Prefer examples where JP and EN correspond clearly.
- If asrAgreement is present, prefer higher agreement and penalize low-agreement subtitle/audio pairs.
- Avoid noisy, fragmented, poetic/lyric, lore-heavy, or context-dependent lines.
- Use ONLY the given candidates.

Scoring rubric (0-100):
- clarity for beginners (40)
- natural/common usage (30)
- translation alignment quality (15)
- subtitle/audio agreement (asrAgreement + asr text) (10)
- brevity and clean structure (5)

Output:
- Return ONLY valid JSON with this exact shape:
{
  "top": [
    { "candidateIndex": 1, "score": 87, "reason": "short beginner-friendly everyday phrase with clear EN mapping" }
  ],
  "confidence": 82
}

Rules:
- candidateIndex must refer to the provided "i" field.
- score is 0-100, higher is better.
- top length should be exactly ${topK} unless fewer candidates exist.
- candidateIndex values must be unique.
- confidence is 0-100.
- reason must be concise but specific (at least 10 chars).
- Do not output placeholder zeros for scores.
- Do not output empty reasons.

Input:
${JSON.stringify(payload)}
`.trim();
}

function extractFirstJsonObject(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    // fall through
  }

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeRanking(raw, candidateCount, topK) {
  if (!raw || typeof raw !== "object") return null;
  const arr = Array.isArray(raw.top) ? raw.top : [];
  const seen = new Set();
  const top = [];

  for (const item of arr) {
    const idx = Number(item?.candidateIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > candidateCount) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);

    const score = Number(item?.score);
    const reason = String(item?.reason || "").trim();
    top.push({
      candidateIndex: idx,
      score: Number.isFinite(score) ? score : 0,
      reason,
    });
    if (top.length >= topK) break;
  }

  if (top.length === 0) return null;

  const confidence = Number(raw.confidence);
  return {
    top,
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
}

function isMeaningfulRanking(ranking, topK, minReasonChars) {
  if (!ranking || !Array.isArray(ranking.top) || ranking.top.length === 0) return false;
  const needed = Math.min(topK, ranking.top.length);
  const subset = ranking.top.slice(0, needed);
  if (subset.length === 0) return false;

  let reasonsOk = 0;
  let nonZeroScores = 0;
  const scoreSet = new Set();
  let strictlySequentialFromOne = true;
  for (let i = 0; i < subset.length; i++) {
    const it = subset[i];
    const reason = String(it.reason || "").trim();
    if (reason.length >= minReasonChars) reasonsOk++;
    const score = Number(it.score);
    if (Number.isFinite(score) && score > 0) nonZeroScores++;
    if (Number.isFinite(score)) scoreSet.add(Math.round(score * 10) / 10);
    if (it.candidateIndex !== i + 1) strictlySequentialFromOne = false;
  }

  if (reasonsOk < Math.max(1, Math.floor(subset.length * 0.6))) return false;
  if (nonZeroScores < Math.max(1, Math.floor(subset.length * 0.6))) return false;
  if (scoreSet.size <= 1) return false;
  // Reject trivial "1,2,3,4,5 with placeholders" patterns.
  if (strictlySequentialFromOne && scoreSet.size <= 2) return false;
  return true;
}

function fallbackCompositeScore(candidate, asr) {
  let score = Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0;
  const en = String(candidate?.enText || "").trim();
  if (!en) score -= 4;
  if (asr && Number.isFinite(Number(asr.agreement))) {
    score += Number(asr.agreement) * 30;
    if (Number(asr.agreement) < 0.35) score -= 10;
  }
  return Math.round(score * 10) / 10;
}

function fallbackRanking(candidates, topK, asrByIndex = null) {
  return {
    top: candidates
      .map((c, idx) => {
        const sourceIndex = Number(c?.__sourceIndex) || idx + 1;
        const asr = asrByIndex?.get?.(sourceIndex) || null;
        return {
          candidateIndex: idx + 1,
          score: fallbackCompositeScore(c, asr),
          reason:
            asr && Number.isFinite(Number(asr.agreement))
              ? `Heuristic fallback (ASR=${Math.round(Number(asr.agreement) * 100)}%)`
              : "Heuristic fallback",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK),
    confidence: null,
  };
}

function supplementRankingToTopK(ranking, candidates, topK, asrByIndex = null) {
  if (!ranking || !Array.isArray(ranking.top)) return ranking;
  const need = Math.min(Number(topK) || 0, candidates.length);
  if (need <= 0 || ranking.top.length >= need) return ranking;

  const seen = new Set(
    ranking.top
      .map((x) => Number(x?.candidateIndex))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  const fallback = fallbackRanking(candidates, topK, asrByIndex);
  const extra = [];
  for (const item of fallback.top || []) {
    const idx = Number(item?.candidateIndex);
    if (!Number.isInteger(idx) || idx <= 0 || seen.has(idx)) continue;
    seen.add(idx);
    extra.push(item);
    if (ranking.top.length + extra.length >= need) break;
  }

  return {
    ...ranking,
    top: [...ranking.top, ...extra].slice(0, need),
  };
}

function mapRankingToSourceIndices(ranking, rankedCandidates) {
  if (!ranking || !Array.isArray(ranking.top)) return null;
  const mappedTop = [];
  const seen = new Set();
  for (const item of ranking.top) {
    const localIdx = Number(item?.candidateIndex);
    if (!Number.isInteger(localIdx) || localIdx <= 0) continue;
    const sourceIdx = Number(rankedCandidates[localIdx - 1]?.__sourceIndex);
    if (!Number.isInteger(sourceIdx) || sourceIdx <= 0 || seen.has(sourceIdx)) continue;
    seen.add(sourceIdx);
    mappedTop.push({
      ...item,
      candidateIndex: sourceIdx,
    });
  }
  return {
    ...ranking,
    top: mappedTop,
  };
}

async function postOllamaJson({ url, body, signal }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

function stripAnsi(text) {
  return String(text || "").replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}

function callOllamaCli({ model, prompt, timeoutSec }) {
  const res = spawnSync("ollama", ["run", model, prompt], {
    encoding: "utf8",
    timeout: Math.round(timeoutSec * 1000),
    maxBuffer: 1024 * 1024 * 20,
  });
  if (res.status !== 0) {
    const errText = stripAnsi((res.stderr || res.stdout || "").trim());
    throw new Error(`ollama run failed (${res.status}): ${errText.slice(0, 400)}`);
  }
  return stripAnsi(String(res.stdout || "")).trim();
}

async function callOllama({ host, model, prompt, timeoutSec, temperature }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.round(timeoutSec * 1000));
  try {
    const base = host.replace(/\/$/, "");

    // Prefer chat API first (widest model support in newer Ollama versions).
    try {
      const chat = await postOllamaJson({
        url: `${base}/api/chat`,
        body: {
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          format: "json",
          options: { temperature },
        },
        signal: controller.signal,
      });
      const text = String(chat?.message?.content || "");
      if (text.trim()) return text;
      throw new Error("chat API returned empty content");
    } catch (err) {
      // Fall through to /api/generate for older setups.
      const msg = String(err?.message || err);
      if (!/does not support chat|404|not found|unknown/i.test(msg)) {
        throw err;
      }
    }

    try {
      const generated = await postOllamaJson({
        url: `${base}/api/generate`,
        body: {
          model,
          prompt,
          stream: false,
          format: "json",
          options: { temperature },
        },
        signal: controller.signal,
      });
      const text = String(generated?.response || "");
      if (!text.trim()) throw new Error("Empty Ollama response.");
      return text;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/does not support generate|unsupported|not implemented/i.test(msg)) {
        const cliText = callOllamaCli({ model, prompt, timeoutSec });
        if (cliText.trim()) return cliText;
      }
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }
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

function safeHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 20);
}

function asrCacheKey(args, candidate) {
  return safeHash(
    JSON.stringify({
      model: args.asrWhisperModel,
      language: args.asrLanguage,
      videoFile: path.resolve(String(candidate.videoFile || "")),
      clipStartMs: Number(candidate.clipStartMs || 0),
      clipEndMs: Number(candidate.clipEndMs || 0),
      jpText: String(candidate.jpText || ""),
    }),
  );
}

function loadAsrCache(cacheFile) {
  if (!cacheFile || !fs.existsSync(cacheFile)) {
    return {
      meta: { updatedAt: null },
      entries: {},
    };
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
    return {
      meta: { updatedAt: null },
      entries: {},
    };
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

function verifyCandidateAsr({ args, candidate, asrCache, verbose }) {
  if (!candidate || !candidate.videoFile || !fs.existsSync(candidate.videoFile)) {
    return {
      status: "no_video",
      text: "",
      agreement: null,
      error: "missing_video",
    };
  }
  if (!Number.isFinite(Number(candidate.clipStartMs)) || !Number.isFinite(Number(candidate.clipEndMs))) {
    return {
      status: "bad_clip_range",
      text: "",
      agreement: null,
      error: "invalid_clip_range",
    };
  }
  const clipStartMs = Number(candidate.clipStartMs);
  const clipEndMs = Number(candidate.clipEndMs);
  const durationSec = Math.max(0.08, (clipEndMs - clipStartMs) / 1000);
  if (durationSec <= 0) {
    return {
      status: "bad_clip_range",
      text: "",
      agreement: null,
      error: "non_positive_duration",
    };
  }

  ensureDir(args.asrWorkDir);
  const key = asrCacheKey(args, candidate);
  const cached = asrCache?.entries?.[key];
  if (cached && typeof cached === "object") return cached;

  const wavBase = `asr_${key}`;
  const wavPath = path.join(args.asrWorkDir, `${wavBase}.wav`);
  const jsonPath = path.join(args.asrWorkDir, `${wavBase}.json`);
  const ffmpegRes = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      msToFfmpegTime(clipStartMs),
      "-i",
      candidate.videoFile,
      "-t",
      String(durationSec.toFixed(3)),
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
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  if (ffmpegRes.status !== 0) {
    const result = {
      status: "ffmpeg_error",
      text: "",
      agreement: null,
      error: stripAnsi((ffmpegRes.stderr || ffmpegRes.stdout || "").trim()).slice(0, 400),
    };
    if (asrCache?.entries) asrCache.entries[key] = result;
    return result;
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
      maxBuffer: 1024 * 1024 * 20,
    },
  );
  if (whisperRes.status !== 0) {
    const result = {
      status: "whisper_error",
      text: "",
      agreement: null,
      error: stripAnsi((whisperRes.stderr || whisperRes.stdout || "").trim()).slice(0, 400),
    };
    if (asrCache?.entries) asrCache.entries[key] = result;
    return result;
  }

  const asrText = extractAsrText(jsonPath);
  const agreement = computeAsrAgreement({
    jpText: candidate.jpText,
    asrText,
  });
  const result = {
    status: asrText ? "ok" : "empty",
    text: asrText,
    agreement: Number.isFinite(agreement) ? Math.round(agreement * 1000) / 1000 : null,
    error: null,
  };
  if (asrCache?.entries) asrCache.entries[key] = result;

  if (!verbose) {
    // Keep temp artifacts only when debugging.
    try {
      if (fs.existsSync(wavPath)) fs.rmSync(wavPath, { force: true });
      if (fs.existsSync(jsonPath)) fs.rmSync(jsonPath, { force: true });
    } catch {
      // ignore
    }
  }

  return result;
}

function buildOutputSkeleton(args, sourceDb, targetWords) {
  return {
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generator: "rerank-word-candidates-ollama.v1",
      sourceDbFile: path.resolve(args.dbFile),
      sourceDbCreatedAt: sourceDb?.meta?.createdAt ?? null,
      model: args.model,
      host: args.host,
      topK: args.topK,
      maxCandidates: args.maxCandidates,
      fromIndex: args.fromIndex,
      count: args.count,
      timeoutSec: args.timeoutSec,
      temperature: args.temperature,
      retries: args.retries,
      minReasonChars: args.minReasonChars,
      requireMeaningful: args.requireMeaningful,
      allowFallback: args.allowFallback,
      gateSenseLock: args.gateSenseLock,
      gateFragmentReject: args.gateFragmentReject,
      minBreathChars: args.minBreathChars,
      dryRun: args.dryRun,
      asrVerify: args.asrVerify,
      asrTopN: args.asrTopN,
      asrWhisperBin: args.asrWhisperBin,
      asrWhisperModel: args.asrWhisperModel,
      asrLanguage: args.asrLanguage,
      asrTimeoutSec: args.asrTimeoutSec,
      asrWorkDir: args.asrWorkDir,
      asrCacheFile: args.asrCacheFile,
    },
    summary: {
      totalTargetWords: targetWords.length,
      processedWords: 0,
      okWords: 0,
      fallbackWords: 0,
      skipWords: 0,
      errorWords: 0,
    },
    words: [],
  };
}

function recomputeSummary(out, targetWords) {
  const targetSet = new Set(targetWords.map((w) => w.word));
  const filtered = out.words.filter((w) => targetSet.has(w.word));
  let ok = 0;
  let fallback = 0;
  let skip = 0;
  let error = 0;

  for (const item of filtered) {
    if (item.status === "ok") ok++;
    else if (item.status === "fallback") fallback++;
    else if (item.status === "skip") skip++;
    else if (item.status === "error") error++;
  }

  out.summary = {
    totalTargetWords: targetWords.length,
    processedWords: filtered.length,
    okWords: ok,
    fallbackWords: fallback,
    skipWords: skip,
    errorWords: error,
  };
  out.meta.updatedAt = new Date().toISOString();
}

function buildWordMap(words) {
  const map = new Map();
  for (const w of words) map.set(w.word, w);
  return map;
}

function enrichTopPicks(picks, candidates, asrByIndex) {
  return picks.map((p, i) => {
    const c = candidates[p.candidateIndex - 1];
    const asr = asrByIndex?.get?.(p.candidateIndex) || null;
    return {
      rank: i + 1,
      candidateIndex: p.candidateIndex,
      llmScore: p.score,
      llmReason: p.reason || "",
      episode: c?.episode ?? null,
      clipStartMs: c?.clipStartMs ?? null,
      clipEndMs: c?.clipEndMs ?? null,
      clipStart: c?.clipStart ?? null,
      clipEnd: c?.clipEnd ?? null,
      jpText: c?.jpText ?? "",
      enText: c?.enText ?? "",
      heuristicScore: Number.isFinite(Number(c?.score)) ? Number(c.score) : null,
      asrAgreement: Number.isFinite(Number(asr?.agreement)) ? Number(asr.agreement) : null,
      asrText: String(asr?.text || ""),
      asrStatus: String(asr?.status || ""),
    };
  });
}

function normalizeGateText(raw) {
  return String(raw || "")
    .normalize("NFKC")
    // Remove inline ruby/reading wrappers like 悪(わり)い or 悪（わり）い
    .replace(/[\(（][^)\）]*[\)）]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function compactGateText(raw) {
  return normalizeGateText(raw).replace(
    /[^0-9A-Za-z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
    "",
  );
}

function hasKana(text) {
  return /[\u3040-\u30ff]/.test(String(text || ""));
}

function buildSenseGate(sourceWord) {
  const word = String(sourceWord?.word || "");
  const formsRaw = [
    ...(Array.isArray(sourceWord?.meta?.match?.forms) ? sourceWord.meta.match.forms : []),
    word,
  ];
  const seen = new Set();
  const forms = [];
  for (const raw of formsRaw) {
    const s = compactGateText(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    forms.push(s);
  }
  const normalizedWord = compactGateText(word);
  const enforce = Array.from(normalizedWord).length >= 2 || hasKana(normalizedWord);
  const strongForms = forms
    .filter((f) => {
      if (f === normalizedWord) return true;
      const len = Array.from(f).length;
      if (len >= 2) return true;
      if (hasKana(f)) return true;
      return false;
    })
    .sort((a, b) => Array.from(b).length - Array.from(a).length);
  return { enforce, strongForms };
}

function matchesSenseGate(jpText, gate) {
  if (!gate?.enforce) return true;
  const text = compactGateText(jpText);
  if (!text) return false;
  return gate.strongForms.some((form) => text.includes(form));
}

function isFragmentLikeJp(jpText) {
  const text = normalizeGateText(jpText);
  if (!text) return true;
  // Ellipsis-heavy lines are usually clipped/fragmented for learning.
  if (/(?:…|\.{2,})/.test(text)) return true;
  // Leading/trailing punctuation-like fragments.
  if (/^[、,，。！？!?・―—-]/.test(text)) return true;
  if (/[、,，・―—-]$/.test(text)) return true;
  return false;
}

function breathLength(jpText) {
  const core = compactGateText(jpText);
  return Array.from(core).length;
}

function applyCandidateGates({ args, sourceWord, candidates }) {
  const gate = buildSenseGate(sourceWord);
  const kept = [];
  const stats = {
    input: candidates.length,
    kept: 0,
    rejectedSense: 0,
    rejectedFragment: 0,
    rejectedBreath: 0,
  };

  for (const c of candidates) {
    const jp = String(c?.jpText || "");
    if (args.gateSenseLock && !matchesSenseGate(jp, gate)) {
      stats.rejectedSense++;
      continue;
    }
    if (args.gateFragmentReject && isFragmentLikeJp(jp)) {
      stats.rejectedFragment++;
      continue;
    }
    if (args.minBreathChars > 0 && breathLength(jp) < args.minBreathChars) {
      stats.rejectedBreath++;
      continue;
    }
    kept.push(c);
  }

  stats.kept = kept.length;
  return { candidates: kept, stats };
}

async function processWord({ args, sourceWord, outMap, asrCache }) {
  const word = sourceWord.word;
  const base = {
    word,
    processedAt: new Date().toISOString(),
    model: args.model,
    sourceCandidateCount: Array.isArray(sourceWord.candidates) ? sourceWord.candidates.length : 0,
    gateStats: null,
  };

  if (sourceWord.missing) {
    outMap.set(word, {
      ...base,
      status: "skip",
      reason: "missing",
      confidence: null,
      top: [],
      error: null,
    });
    return;
  }
  if (sourceWord.error) {
    outMap.set(word, {
      ...base,
      status: "skip",
      reason: "source_error",
      confidence: null,
      top: [],
      error: String(sourceWord.error),
    });
    return;
  }

  const candidates = Array.isArray(sourceWord.candidates)
    ? sourceWord.candidates
        .slice(0, args.maxCandidates)
        .map((c, idx) => ({ ...c, __sourceIndex: idx + 1 }))
    : [];
  if (candidates.length === 0) {
    outMap.set(word, {
      ...base,
      status: "skip",
      reason: "no_candidates",
      confidence: null,
      top: [],
      error: null,
    });
    return;
  }

  const gated = applyCandidateGates({
    args,
    sourceWord,
    candidates,
  });
  const rankedCandidates = gated.candidates;
  if (rankedCandidates.length === 0) {
    outMap.set(word, {
      ...base,
      gateStats: gated.stats,
      status: "skip",
      reason: "no_candidates_after_gates",
      confidence: null,
      top: [],
      error: null,
    });
    return;
  }

  const asrBySourceIndex = new Map();
  if (args.asrVerify) {
    const verifyCount =
      args.asrTopN > 0 ? Math.min(args.asrTopN, rankedCandidates.length) : rankedCandidates.length;
    for (let idx = 0; idx < verifyCount; idx++) {
      const c = rankedCandidates[idx];
      const verified = verifyCandidateAsr({
        args,
        candidate: c,
        asrCache,
        verbose: args.verbose,
      });
      asrBySourceIndex.set(Number(c.__sourceIndex) || idx + 1, verified);
    }
  }

  const labeled = rankedCandidates.map((c, i) =>
    candidateLabel(c, i, asrBySourceIndex.get(Number(c.__sourceIndex) || i + 1) || null),
  );
  const prompt = buildPrompt({
    word,
    topK: args.topK,
    candidates: labeled,
  });

  let ranking = null;
  let status = "ok";
  let errorMessage = null;

  if (args.dryRun) {
    ranking = fallbackRanking(rankedCandidates, args.topK, asrBySourceIndex);
    status = "fallback";
  } else {
    let lastErr = null;
    for (let attempt = 0; attempt <= args.retries; attempt++) {
      try {
        const rawText = await callOllama({
          host: args.host,
          model: args.model,
          prompt,
          timeoutSec: args.timeoutSec,
          temperature: args.temperature,
        });
        const parsed = extractFirstJsonObject(rawText);
        const normalized = normalizeRanking(parsed, rankedCandidates.length, args.topK);
        if (!normalized) {
          throw new Error("Model response was not valid ranking JSON.");
        }
        if (
          args.requireMeaningful &&
          !isMeaningfulRanking(normalized, args.topK, args.minReasonChars)
        ) {
          throw new Error("Model response was trivial/weak ranking.");
        }
        ranking = normalized;
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!ranking) {
      errorMessage = String(lastErrToMessage(lastErr));
      if (args.allowFallback) {
        status = "fallback";
        ranking = fallbackRanking(rankedCandidates, args.topK, asrBySourceIndex);
      } else {
        outMap.set(word, {
          ...base,
          gateStats: gated.stats,
          status: "error",
          reason: "llm_failed_fail_closed",
          confidence: null,
          top: [],
          error: errorMessage,
        });
        return;
      }
    }
    if (ranking) {
      ranking = supplementRankingToTopK(ranking, rankedCandidates, args.topK, asrBySourceIndex);
      ranking = mapRankingToSourceIndices(ranking, rankedCandidates);
    }
  }

  if (!ranking || !Array.isArray(ranking.top) || ranking.top.length === 0) {
    outMap.set(word, {
      ...base,
      gateStats: gated.stats,
      status: "error",
      reason: "empty_rank_after_gates",
      confidence: null,
      top: [],
      error: errorMessage || "empty ranking after index mapping",
    });
    return;
  }

  outMap.set(word, {
    ...base,
    gateStats: gated.stats,
    status,
    reason: null,
    confidence: ranking.confidence,
    top: enrichTopPicks(ranking.top, candidates, asrBySourceIndex),
    error: errorMessage,
  });
}

function lastErrToMessage(err) {
  if (!err) return "unknown";
  if (err && typeof err === "object" && "message" in err) {
    return err.message;
  }
  return String(err);
}

async function main() {
  const args = parseArgs(process.argv);
  const source = readJson(args.dbFile);
  if (!source || !Array.isArray(source.words)) {
    throw new Error(`Invalid DB file: ${args.dbFile}`);
  }

  const targetWords = sliceByWindow(source.words, args.fromIndex, args.count);
  if (targetWords.length === 0) {
    throw new Error("No words selected by --fromIndex/--count.");
  }

  let out = null;
  if (args.resume && fs.existsSync(args.outFile)) {
    out = readJson(args.outFile);
    if (!out || !Array.isArray(out.words)) {
      throw new Error(`Invalid existing out file: ${args.outFile}`);
    }
  } else {
    out = buildOutputSkeleton(args, source, targetWords);
  }

  const outMap = buildWordMap(out.words);
  const total = targetWords.length;
  const asrCache = args.asrVerify ? loadAsrCache(args.asrCacheFile) : null;
  if (args.asrVerify) {
    ensureDir(path.dirname(path.resolve(args.asrCacheFile)));
    ensureDir(path.resolve(args.asrWorkDir));
  }

  for (let i = 0; i < total; i++) {
    const srcWord = targetWords[i];
    const existing = outMap.get(srcWord.word);
    const alreadyDone =
      existing &&
      (existing.status === "ok" ||
        (existing.status === "fallback" && args.allowFallback) ||
        existing.status === "skip");
    if (alreadyDone && !args.force) {
      if (args.verbose) {
        console.log(`[${i + 1}/${total}] skip existing: ${srcWord.word}`);
      }
      continue;
    }

    if (args.verbose) {
      console.log(`[${i + 1}/${total}] ranking: ${srcWord.word}`);
    }

    try {
      await processWord({ args, sourceWord: srcWord, outMap, asrCache });
    } catch (err) {
      outMap.set(srcWord.word, {
        word: srcWord.word,
        processedAt: new Date().toISOString(),
        model: args.model,
        status: "error",
        reason: "exception",
        confidence: null,
        top: [],
        error: lastErrToMessage(err),
      });
    }

    out.words = source.words
      .map((w) => outMap.get(w.word))
      .filter(Boolean);
    recomputeSummary(out, targetWords);
    writeJsonAtomic(args.outFile, out);
    if (args.asrVerify) saveAsrCache(args.asrCacheFile, asrCache);

    if (
      args.verbose ||
      i === 0 ||
      i === total - 1 ||
      (args.printEvery > 0 && (i + 1) % args.printEvery === 0)
    ) {
      const rec = outMap.get(srcWord.word);
      const status = rec?.status || "unknown";
      const topCount = Array.isArray(rec?.top) ? rec.top.length : 0;
      console.log(`[${i + 1}/${total}] ${srcWord.word} -> status=${status} top=${topCount}`);
    }
  }

  out.words = source.words
    .map((w) => outMap.get(w.word))
    .filter(Boolean);
  recomputeSummary(out, targetWords);
  writeJsonAtomic(args.outFile, out);
  if (args.asrVerify) saveAsrCache(args.asrCacheFile, asrCache);

  console.log("");
  console.log(`Done. Output: ${path.resolve(args.outFile)}`);
  console.log(
    `Summary: processed=${out.summary.processedWords}/${out.summary.totalTargetWords} ok=${out.summary.okWords} fallback=${out.summary.fallbackWords} skip=${out.summary.skipWords} error=${out.summary.errorWords}`,
  );
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
