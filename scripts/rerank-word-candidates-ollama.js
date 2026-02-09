#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
    model: "llama3.2:latest",
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
    printEvery: 25,
    dryRun: false,
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
  --model <name>           Ollama model (default: llama3.2:latest)
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

function candidateLabel(c, idx) {
  const ep = c.episode || "";
  const start = c.clipStart || c.clipStartMs || "";
  const end = c.clipEnd || c.clipEndMs || "";
  const hs = Number.isFinite(Number(c.score)) ? Number(c.score) : null;
  return {
    i: idx + 1,
    episode: ep,
    start,
    end,
    heuristicScore: hs,
    jp: String(c.jpText || ""),
    en: String(c.enText || ""),
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
- Avoid noisy, fragmented, poetic/lyric, lore-heavy, or context-dependent lines.
- Use ONLY the given candidates.

Scoring rubric (0-100):
- clarity for beginners (40)
- natural/common usage (30)
- translation alignment quality (20)
- brevity and clean structure (10)

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

function fallbackRanking(candidates, topK) {
  return {
    top: candidates
      .map((c, idx) => ({
        candidateIndex: idx + 1,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0,
        reason: "Heuristic fallback",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK),
    confidence: null,
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
      dryRun: args.dryRun,
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

function enrichTopPicks(picks, candidates) {
  return picks.map((p, i) => {
    const c = candidates[p.candidateIndex - 1];
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
    };
  });
}

async function processWord({ args, sourceWord, outMap }) {
  const word = sourceWord.word;
  const base = {
    word,
    processedAt: new Date().toISOString(),
    model: args.model,
    sourceCandidateCount: Array.isArray(sourceWord.candidates) ? sourceWord.candidates.length : 0,
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
    ? sourceWord.candidates.slice(0, args.maxCandidates)
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

  const labeled = candidates.map(candidateLabel);
  const prompt = buildPrompt({
    word,
    topK: args.topK,
    candidates: labeled,
  });

  let ranking = null;
  let status = "ok";
  let errorMessage = null;

  if (args.dryRun) {
    ranking = fallbackRanking(candidates, args.topK);
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
        const normalized = normalizeRanking(parsed, candidates.length, args.topK);
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
      status = "fallback";
      errorMessage = String(lastErrToMessage(lastErr));
      ranking = fallbackRanking(candidates, args.topK);
    }
  }

  outMap.set(word, {
    ...base,
    status,
    reason: null,
    confidence: ranking.confidence,
    top: enrichTopPicks(ranking.top, candidates),
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

  for (let i = 0; i < total; i++) {
    const srcWord = targetWords[i];
    const existing = outMap.get(srcWord.word);
    const alreadyDone =
      existing &&
      (existing.status === "ok" ||
        existing.status === "fallback" ||
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
      await processWord({ args, sourceWord: srcWord, outMap });
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
