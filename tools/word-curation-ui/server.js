#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const url = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const UI_ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT || 8790);

const WORDS_FILE = path.resolve(ROOT, "source_content", "all_anime_top_2000.match.first2000.json");
const OUT_ROOT = path.resolve(ROOT, "out", "shorts");
const MANIFEST_FILE = path.join(OUT_ROOT, "render-manifest.json");
const RERANK_FILE = path.join(OUT_ROOT, "word-candidates-llm-top.qwen2.5-3b.full.json");
const DB_FILE = path.join(OUT_ROOT, "word-candidates-db.json");
const DB_FALLBACK_FILES = [
  path.join(ROOT, "out", "word-auto-fast", "word-candidates-db.json"),
  path.join(ROOT, "source_content", "shingeki_no_kyojin", "subs", "word-candidates-db.json"),
];
const RERANK_FALLBACK_FILES = [
  path.join(ROOT, "out", "saveFile", "word-candidates-llm-top.qwen2.5-3b.full.backup.json"),
];
const LOG_FILE = path.join(OUT_ROOT, "curation-log.jsonl");
const PREVIEW_DIR = path.join(OUT_ROOT, "work", "previews");
const LIVE_POOL_DIR = path.join(OUT_ROOT, "work", "live-pools");
const FAMILY_MEANINGS_FILE = path.join(ROOT, "source_content", "family-meanings.json");
const UI_PRE_PAD_MS = Math.max(0, Number(process.env.UI_PRE_PAD_MS || 350));
const UI_POST_PAD_MS = Math.max(0, Number(process.env.UI_POST_PAD_MS || 550));
const UI_MAX_CLIP_MS = Math.max(500, Number(process.env.UI_MAX_CLIP_MS || 3200));
const UI_MIN_PREVIEW_MS = Math.max(200, Number(process.env.UI_MIN_PREVIEW_MS || 1100));

const DEFAULT_JP_SUBS_DIR = path.join(
  ROOT,
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_EN_SUBS_EMBEDDED = path.join(
  ROOT,
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_LEGACY = path.join(
  ROOT,
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_EMBEDDED)
  ? DEFAULT_EN_SUBS_EMBEDDED
  : fs.existsSync(DEFAULT_EN_SUBS_LEGACY)
    ? DEFAULT_EN_SUBS_LEGACY
    : null;
const DEFAULT_VIDEOS_DIR = path.join(ROOT, "source_content", "shingeki_no_kyojin", "videos");
const livePoolCache = new Map();

const jobs = new Map();
const queue = [];
let activeJobId = null;

function familyKey(word, family = "") {
  return `${String(word || "").trim()}::${String(family || "").trim()}`;
}

function safeFilename(s) {
  const raw = String(s || "").trim();
  if (!raw) return "word";
  return raw
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonlOrEmpty(filePath) {
  try {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeMeaning(meaning) {
  if (!meaning) return "";
  return String(meaning).split(/[;,.]/)[0].trim();
}

function loadFamilyMeaningMap(filePath = FAMILY_MEANINGS_FILE) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

function getFamilyMeaningOverride(map, query, family) {
  if (!family || !map || typeof map !== "object") return "";
  const direct = map[family];
  if (typeof direct === "string" && direct.trim()) return normalizeMeaning(direct);
  const nested = map[query];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const v = nested[family];
    if (typeof v === "string" && v.trim()) return normalizeMeaning(v);
  }
  return "";
}

function saveFamilyMeaningOverride({ query, family, meaning, filePath = FAMILY_MEANINGS_FILE }) {
  const q = String(query || "").trim();
  const f = String(family || "").trim();
  const m = normalizeMeaning(meaning);
  if (!q) throw new Error("word is required");
  if (!f) throw new Error("family is required");
  if (!m) throw new Error("meaning is required");

  const map = loadFamilyMeaningMap(filePath);
  let changed = false;

  if (map[f] !== m) {
    map[f] = m;
    changed = true;
  }
  if (!map[q] || typeof map[q] !== "object" || Array.isArray(map[q])) {
    map[q] = {};
  }
  if (map[q][f] !== m) {
    map[q][f] = m;
    changed = true;
  }

  if (!changed) {
    return { updated: false, filePath };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);

  return { updated: true, filePath };
}

function uniquePositiveInts(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function fillToTopK(picks, pool, topK = 5) {
  const out = uniquePositiveInts(picks);
  for (const n of uniquePositiveInts(pool)) {
    if (out.length >= topK) break;
    if (!out.includes(n)) out.push(n);
  }
  let k = 1;
  while (out.length < topK) {
    if (!out.includes(k)) out.push(k);
    k++;
  }
  return out.slice(0, topK);
}

function msToFfmpegTime(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const totalMs = Math.round(n);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const rem = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(rem).padStart(3, "0")}`;
}

function normalizeCandidateRecord(raw, fallbackRank) {
  const clipStartMs = Number(raw?.clipStartMs);
  const clipEndMs = Number(raw?.clipEndMs);
  return {
    rank: Number(raw?.rank || fallbackRank),
    score: Number(raw?.score || 0),
    episode: String(raw?.episode || ""),
    subFile: String(raw?.subFile || ""),
    videoFile: String(raw?.videoFile || ""),
    clipStartMs: Number.isFinite(clipStartMs) ? clipStartMs : 0,
    clipEndMs: Number.isFinite(clipEndMs) ? clipEndMs : 0,
    clipStart: String(raw?.clipStart || msToFfmpegTime(clipStartMs)),
    clipEnd: String(raw?.clipEnd || msToFfmpegTime(clipEndMs)),
    matchStartMs: Number(raw?.matchStartMs || 0),
    matchEndMs: Number(raw?.matchEndMs || 0),
    matchText: String(raw?.matchText || ""),
    jpText: String(raw?.jpText || raw?.sentenceText || ""),
    enText: String(raw?.enText || ""),
  };
}

function familyTextPoolFromDb(dbRec, familyFilter) {
  const fam = String(familyFilter || "").trim();
  if (!fam) return [];
  const rows = Array.isArray(dbRec?.candidates) ? dbRec.candidates : [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i];
    const matchText = String(rec?.matchText || "").trim();
    const jp = String(rec?.jpText || rec?.sentenceText || "");
    if (!(matchText.includes(fam) || jp.includes(fam))) continue;
    out.push(normalizeCandidateRecord(rec, out.length + 1));
  }
  return out;
}

function livePoolFilePath(word, family = "") {
  const w = safeFilename(String(word || "").trim());
  const f = String(family || "").trim();
  if (!f) return path.join(LIVE_POOL_DIR, `${w}.pool.json`);
  return path.join(LIVE_POOL_DIR, `${w}__family_${safeFilename(f)}.pool.json`);
}

function buildLivePoolForWord(word, family = "") {
  const q = String(word || "").trim();
  if (!q) return [];
  const fam = String(family || "").trim();
  fs.mkdirSync(LIVE_POOL_DIR, { recursive: true });
  const outFile = livePoolFilePath(q, fam);
  const cli = [
    path.join("scripts", "extract-clips.js"),
    "--query",
    q,
    "--wordList",
    WORDS_FILE,
    "--subsDir",
    DEFAULT_JP_SUBS_DIR,
    "--videosDir",
    DEFAULT_VIDEOS_DIR,
    "--mode",
    "line",
    "--rank",
    "--limit",
    "1",
    "--prePadMs",
    String(UI_PRE_PAD_MS),
    "--postPadMs",
    String(UI_POST_PAD_MS),
    "--maxClipMs",
    String(UI_MAX_CLIP_MS),
    "--longPolicy",
    "skip",
    "--dryRun",
    "--candidatesOut",
    outFile,
  ];
  if (DEFAULT_EN_SUBS_DIR) cli.push("--enSubsDir", DEFAULT_EN_SUBS_DIR);
  if (fam) cli.push("--matchContains", fam);

  const res = spawnSync(process.execPath, cli, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });
  if (res.status !== 0) {
    const tail = `${String(res.stderr || "")}\n${String(res.stdout || "")}`
      .trim()
      .split(/\r?\n/g)
      .slice(-20)
      .join("\n");
    throw new Error(`extract-clips failed for "${q}" (${res.status})${tail ? `\n${tail}` : ""}`);
  }

  const payload = readJsonOrNull(outFile);
  const pool = Array.isArray(payload?.pool) ? payload.pool : [];
  const normalized = pool.map((rec, i) => normalizeCandidateRecord(rec, i + 1));
  livePoolCache.set(familyKey(q, fam), normalized);
  return normalized;
}

function getLivePool(word, family = "") {
  const q = String(word || "").trim();
  const fam = String(family || "").trim();
  if (!q) return [];
  const key = familyKey(q, fam);
  const cached = livePoolCache.get(key);
  if (cached) return cached;
  const payload = readJsonOrNull(livePoolFilePath(q, fam));
  const pool = Array.isArray(payload?.pool) ? payload.pool.map((rec, i) => normalizeCandidateRecord(rec, i + 1)) : [];
  livePoolCache.set(key, pool);
  return pool;
}

function loadWordsArray() {
  const raw = readJsonOrNull(WORDS_FILE);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, i) => {
      if (typeof entry === "string") {
        return {
          idx: i + 1,
          word: entry.trim(),
          reading: "",
          romaji: "",
          meaning: "",
          matchForms: [],
          matchExclude: [],
        };
      }
      if (!entry || typeof entry !== "object") {
        return {
          idx: i + 1,
          word: "",
          reading: "",
          romaji: "",
          meaning: "",
          matchForms: [],
          matchExclude: [],
        };
      }
      const forms = Array.isArray(entry.match?.forms)
        ? entry.match.forms.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const exclude = Array.isArray(entry.match?.exclude)
        ? entry.match.exclude.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      return {
        idx: i + 1,
        word: String(entry.word || "").trim(),
        reading: String(entry.reading || "").trim(),
        romaji: String(entry.romaji || "").trim(),
        meaning: String(entry.meaning || "").trim(),
        matchForms: forms,
        matchExclude: exclude,
      };
    })
    .filter((x) => x.word);
}

function getMaps() {
  const manifest = readJsonOrNull(MANIFEST_FILE) || { words: [] };
  const rerankSources = [{ file: RERANK_FILE, data: readJsonOrNull(RERANK_FILE) }];
  for (const f of RERANK_FALLBACK_FILES) {
    rerankSources.push({ file: f, data: readJsonOrNull(f) });
  }
  const dbSources = [{ file: DB_FILE, data: readJsonOrNull(DB_FILE) }];
  for (const f of DB_FALLBACK_FILES) {
    dbSources.push({ file: f, data: readJsonOrNull(f) });
  }

  const manifestMap = new Map();
  const rerankMap = new Map();
  const dbMap = new Map();

  for (const rec of Array.isArray(manifest.words) ? manifest.words : []) {
    const w = String(rec?.word || "").trim();
    if (w) manifestMap.set(w, rec);
  }
  for (const src of rerankSources) {
    for (const rec of Array.isArray(src?.data?.words) ? src.data.words : []) {
      const w = String(rec?.word || "").trim();
      if (!w || rerankMap.has(w)) continue;
      rerankMap.set(w, rec);
    }
  }
  for (const src of dbSources) {
    for (const rec of Array.isArray(src?.data?.words) ? src.data.words : []) {
      const w = String(rec?.word || "").trim();
      if (!w || dbMap.has(w)) continue;
      dbMap.set(w, rec);
    }
  }

  return { manifest, rerank: { words: [...rerankMap.values()] }, db: { words: [...dbMap.values()] }, manifestMap, rerankMap, dbMap };
}

function deriveWordStatus(manifestRec, rerankRec, dbRec) {
  if (manifestRec?.status) return String(manifestRec.status);
  if (rerankRec?.status) return `rank:${String(rerankRec.status)}`;
  if (dbRec?.missing) return "missing";
  if (dbRec) return "built";
  return "new";
}

function listWords() {
  const words = loadWordsArray();
  const { manifestMap, rerankMap, dbMap } = getMaps();

  const out = words.map((item) => {
    const manifestRec = manifestMap.get(item.word) || null;
    const rerankRec = rerankMap.get(item.word) || null;
    const dbRec = dbMap.get(item.word) || null;

    const pool = uniquePositiveInts((rerankRec?.top || []).map((x) => x?.candidateIndex));
    const savedPicks = uniquePositiveInts(manifestRec?.picks || []);
    const hasRenderedOverride =
      savedPicks.length > 0 && String(manifestRec?.status || "").toLowerCase() === "rendered";
    // Use ranked picks by default, but preserve saved manual picks for already-rendered words.
    const picks = hasRenderedOverride
      ? fillToTopK(savedPicks, pool.length > 0 ? pool : savedPicks)
      : fillToTopK(pool, pool);

    return {
      idx: item.idx,
      word: item.word,
      reading: item.reading,
      romaji: item.romaji,
      meaning: item.meaning,
      matchForms: item.matchForms || [],
      status: deriveWordStatus(manifestRec, rerankRec, dbRec),
      candidateCount: Number(dbRec?.candidateCount || rerankRec?.sourceCandidateCount || 0),
      picks,
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    words: out,
  };
}

function getWordDetail(word, family = "") {
  const familyFilter = String(family || "").trim();
  const words = loadWordsArray();
  let meta = words.find((x) => x.word === word) || {
    word,
    reading: "",
    romaji: "",
    meaning: "",
    matchForms: [],
    matchExclude: [],
  };
  if (familyFilter) {
    const map = loadFamilyMeaningMap(FAMILY_MEANINGS_FILE);
    const overrideMeaning = getFamilyMeaningOverride(map, word, familyFilter);
    if (overrideMeaning) {
      meta = { ...meta, meaning: overrideMeaning };
    }
  }
  const { manifestMap, rerankMap, dbMap } = getMaps();

  const manifestRec = manifestMap.get(word) || null;
  const rerankRec = rerankMap.get(word) || null;
  const dbRec = dbMap.get(word) || null;
  const log = readJsonlOrEmpty(LOG_FILE).filter((x) => String(x?.word || "") === word);

  const rerankPool = uniquePositiveInts((rerankRec?.top || []).map((x) => x?.candidateIndex));
  let livePool = [];
  let livePoolError = null;
  try {
    livePool = getLivePool(word, familyFilter);
  } catch (err) {
    livePool = [];
    livePoolError = err?.message || String(err);
  }
  const familyDbPool = familyFilter ? familyTextPoolFromDb(dbRec, familyFilter) : [];
  const textPool = familyFilter
    ? livePool.length > 0
      ? livePool
      : familyDbPool
    : [];
  const livePoolIndexes = Array.isArray(livePool)
    ? livePool.map((_, i) => i + 1)
    : [];
  const textPoolIndexes = Array.isArray(textPool)
    ? textPool.map((_, i) => i + 1)
    : [];
  const dbIndexes = Array.isArray(dbRec?.candidates)
    ? dbRec.candidates.map((_, i) => i + 1)
    : [];
  const nonFamilyPool =
    rerankPool.length > 0
      ? rerankPool
      : dbIndexes.length > 0
        ? dbIndexes
        : livePoolIndexes.length > 0
          ? livePoolIndexes
          : [];
  const basePool = familyFilter ? textPoolIndexes : nonFamilyPool;
  const savedPicks = uniquePositiveInts(manifestRec?.picks || []);
  const hasRenderedOverride =
    !familyFilter &&
    savedPicks.length > 0 &&
    String(manifestRec?.status || "").toLowerCase() === "rendered";
  const picks = hasRenderedOverride
    ? fillToTopK(savedPicks, basePool.length > 0 ? basePool : savedPicks)
    : fillToTopK(basePool, basePool);
  const dbCandidateCount = Number(
    dbRec?.candidateCount ||
      (Array.isArray(dbRec?.candidates) ? dbRec.candidates.length : 0),
  );
  const rerankCandidateCount = Number(rerankRec?.sourceCandidateCount || 0);
  const effectiveCandidateCount = familyFilter
    ? textPool.length
    : rerankCandidateCount > 0
      ? rerankCandidateCount
      : dbCandidateCount > 0
        ? dbCandidateCount
        : livePool.length > 0
          ? livePool.length
          : 0;

  const output =
    String(manifestRec?.output || "").trim() ||
    path.join(OUT_ROOT, `${safeFilename(word)}.mp4`);

  return {
    word,
    family: familyFilter || null,
    meta,
    status: deriveWordStatus(manifestRec, rerankRec, dbRec),
    picks,
    output,
    manifest: manifestRec,
    rerank: rerankRec,
    db: dbRec,
    livePool: livePool,
    textPool: textPool,
    livePoolError,
    candidateStats: {
      family: familyFilter || null,
      effectiveCount: effectiveCandidateCount,
      livePoolCount: livePool.length,
      dbCandidateCount,
      rerankCandidateCount,
      clipsReady: livePool.length > 0,
      source: familyFilter
        ? livePool.length > 0
          ? "family-live-pool"
          : "family-db-text"
        : rerankCandidateCount > 0
            ? "rerank"
            : dbCandidateCount > 0
              ? "db"
              : livePool.length > 0
                ? "live-pool"
                : "none",
    },
    notes: log,
  };
}

function extractWordFromEntry(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object") return String(entry.word || "").trim();
  return "";
}

function deleteWordFromSourceList(word) {
  const target = String(word || "").trim();
  if (!target) throw new Error("word is required");

  const raw = readJsonOrNull(WORDS_FILE);
  if (!Array.isArray(raw)) {
    throw new Error(`words file is not a JSON array: ${WORDS_FILE}`);
  }

  const next = raw.filter((entry) => extractWordFromEntry(entry) !== target);
  const removed = raw.length - next.length;
  if (removed <= 0) {
    return { removed: 0, countBefore: raw.length, countAfter: raw.length };
  }

  const backupPath = `${WORDS_FILE}.bak`;
  fs.copyFileSync(WORDS_FILE, backupPath);

  const tmpPath = `${WORDS_FILE}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, WORDS_FILE);

  return {
    removed,
    countBefore: raw.length,
    countAfter: next.length,
    backupPath,
  };
}

function updateFamilyMeaningOnly(word, family, meaning) {
  return saveFamilyMeaningOverride({
    query: word,
    family,
    meaning,
    filePath: FAMILY_MEANINGS_FILE,
  });
}

function candidateFromSources(word, candidateIndex, family = "") {
  const fam = String(family || "").trim();
  const idx = Number(candidateIndex);
  if (!Number.isInteger(idx) || idx <= 0) return null;
  if (fam) {
    // Family mode uses family-local indexing; live pool (or family-filtered DB) is authoritative.
    const livePool = getLivePool(word, fam);
    if (idx <= livePool.length) return normalizeCandidateRecord(livePool[idx - 1], idx);
    const { dbMap } = getMaps();
    const dbRec = dbMap.get(word);
    const famPool = familyTextPoolFromDb(dbRec, fam);
    if (idx <= famPool.length) return normalizeCandidateRecord(famPool[idx - 1], idx);
    return null;
  }

  // Non-family mode uses DB/rerank candidateIndex semantics.
  const { dbMap } = getMaps();
  const dbRec = dbMap.get(word);
  if (dbRec && Array.isArray(dbRec.candidates) && idx <= dbRec.candidates.length) {
    return normalizeCandidateRecord(dbRec.candidates[idx - 1], idx);
  }
  const livePool = getLivePool(word, fam);
  if (idx <= livePool.length) return normalizeCandidateRecord(livePool[idx - 1], idx);
  return null;
}

function ensurePreviewClip(word, candidateIndex, family = "") {
  const fam = String(family || "").trim();
  const candidate = candidateFromSources(word, candidateIndex, fam);
  if (!candidate) {
    throw new Error(`Candidate ${candidateIndex} not found for word "${word}".`);
  }

  const videoFile = path.resolve(ROOT, String(candidate.videoFile || ""));
  if (!fs.existsSync(videoFile)) {
    throw new Error(`Video not found: ${videoFile}`);
  }

  const rawStartMs = Number(candidate.clipStartMs);
  const rawEndMs = Number(candidate.clipEndMs);
  if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs) || rawEndMs <= rawStartMs) {
    throw new Error(`Invalid clip time range for candidate ${candidateIndex}.`);
  }
  const startMs = Math.max(0, rawStartMs - UI_PRE_PAD_MS);
  let endMs = rawEndMs + UI_POST_PAD_MS;
  if (endMs - startMs < UI_MIN_PREVIEW_MS) {
    endMs = startMs + UI_MIN_PREVIEW_MS;
  }
  if (endMs - startMs > UI_MAX_CLIP_MS) {
    endMs = startMs + UI_MAX_CLIP_MS;
  }
  const startSec = startMs / 1000;
  const endSec = endMs / 1000;

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const familySuffix = fam ? `__f_${safeFilename(fam)}` : "";
  const padSig = `p${UI_PRE_PAD_MS}_${UI_POST_PAD_MS}_${UI_MIN_PREVIEW_MS}_${UI_MAX_CLIP_MS}`;
  const outName = `${safeFilename(word)}${familySuffix}__${padSig}__c${String(candidateIndex).padStart(3, "0")}.mp4`;
  const outPath = path.join(PREVIEW_DIR, outName);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return outPath;
  }

  const vf =
    "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black";
  const args = [
    "-y",
    "-ss",
    String(startSec),
    "-to",
    String(endSec),
    "-i",
    videoFile,
    "-vf",
    vf,
    "-r",
    "25",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath,
  ];
  const res = spawn("ffmpeg", args, {
    cwd: ROOT,
    stdio: "pipe",
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    let err = "";
    res.stderr.on("data", (d) => {
      err += d.toString("utf8");
    });
    res.on("error", (e) => reject(e));
    res.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error(`ffmpeg failed (${code}): ${err.split("\n").slice(-10).join("\n")}`));
    });
  });
}

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const txt = Buffer.concat(chunks).toString("utf8");
      if (!txt.trim()) return resolve({});
      try {
        resolve(JSON.parse(txt));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createJob(name, payload, runner) {
  const id = crypto.randomBytes(8).toString("hex");
  const job = {
    id,
    name,
    payload,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    logs: [],
    error: null,
  };
  jobs.set(id, job);
  queue.push({ id, runner });
  maybeRunNext();
  return job;
}

function appendJobLog(job, line) {
  if (!line) return;
  const text = String(line).replace(/\r/g, "").trimEnd();
  if (!text) return;
  const parts = text.split("\n");
  for (const p of parts) {
    const msg = p.trimEnd();
    if (!msg) continue;
    job.logs.push(msg);
    if (job.logs.length > 1000) job.logs.splice(0, job.logs.length - 1000);
  }
}

function runNode(args, job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d) => appendJobLog(job, d.toString("utf8")));
    child.stderr.on("data", (d) => appendJobLog(job, d.toString("utf8")));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
  });
}

async function maybeRunNext() {
  if (activeJobId || queue.length === 0) return;
  const next = queue.shift();
  if (!next) return;

  const job = jobs.get(next.id);
  if (!job) return maybeRunNext();

  activeJobId = job.id;
  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    await next.runner(job);
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err?.message || String(err);
    appendJobLog(job, `ERROR: ${job.error}`);
  } finally {
    job.finishedAt = new Date().toISOString();
    activeJobId = null;
    setImmediate(maybeRunNext);
  }
}

function enqueueRenderWord(word) {
  return createJob("render-word", { word }, async (job) => {
    appendJobLog(job, `Render word: ${word}`);
    await runNode([path.join("scripts", "word-curate.js"), "render", word], job);
  });
}

function enqueueRenderMany(words) {
  return createJob("render-many", { count: words.length, words }, async (job) => {
    let i = 0;
    for (const word of words) {
      i++;
      appendJobLog(job, `[${i}/${words.length}] render ${word}`);
      await runNode([path.join("scripts", "word-curate.js"), "render", word], job);
    }
  });
}

function upsertManifestWord({ word, picks, reason, output, family }) {
  const manifest = readJsonOrNull(MANIFEST_FILE);
  if (!manifest || !Array.isArray(manifest.words)) return;
  const idx = manifest.words.findIndex((w) => String(w?.word || "").trim() === word);
  const next = {
    word,
    status: "rendered",
    reason: String(reason || "").trim() || "manual_override",
    picks: uniquePositiveInts(picks).slice(0, 5),
    output: String(output || "").trim(),
    error: null,
  };
  if (family) next.family = String(family).trim();
  if (idx >= 0) {
    const merged = { ...manifest.words[idx], ...next };
    if (!family) delete merged.family;
    manifest.words[idx] = merged;
  } else {
    manifest.words.push(next);
  }
  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function runPickRender(job, { word, picks, reason = "", family = "", meaning = "" }) {
  const fam = String(family || "").trim();
  const m = String(meaning || "").trim();
  const targetPicks = uniquePositiveInts(picks).slice(0, 5);
  if (targetPicks.length === 0) {
    throw new Error("picks required");
  }

  const pickCsv = targetPicks.join(",");

  // Non-family UI picks use DB/rerank candidateIndex semantics.
  // Render directly from DB candidate pool so selected indices map 1:1.
  if (!fam) {
    const { dbMap } = getMaps();
    const dbRec = dbMap.get(word) || null;
    if (!dbRec || !Array.isArray(dbRec.candidates) || dbRec.candidates.length === 0) {
      throw new Error(`No DB candidates available for "${word}". Build DB before rendering picks.`);
    }
    const missing = targetPicks.filter((n) => n > dbRec.candidates.length);
    if (missing.length > 0) {
      throw new Error(
        `Selected picks out of range for "${word}" (candidates=${dbRec.candidates.length}): ${missing
          .map((n) => `#${n}`)
          .join(", ")}`,
      );
    }

    const pickWorkDir = path.join(OUT_ROOT, "work", "pick-candidates");
    fs.mkdirSync(pickWorkDir, { recursive: true });
    const pickPoolFile = path.join(
      pickWorkDir,
      `${safeFilename(word)}__${Date.now()}__${process.pid}.json`,
    );
    fs.writeFileSync(
      pickPoolFile,
      `${JSON.stringify(
        {
          query: word,
          source: "db",
          candidateCount: dbRec.candidates.length,
          pool: dbRec.candidates,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    try {
      const args = [
        path.join("scripts", "make-vertical-shorts-clean.js"),
        "--query",
        word,
        "--subsDir",
        DEFAULT_JP_SUBS_DIR,
        "--videosDir",
        DEFAULT_VIDEOS_DIR,
        "--wordList",
        WORDS_FILE,
        "--outDir",
        path.join(OUT_ROOT, "work"),
        "--outputDir",
        OUT_ROOT,
        "--mode",
        "line",
        "--prePadMs",
        String(UI_PRE_PAD_MS),
        "--postPadMs",
        String(UI_POST_PAD_MS),
        "--maxClipMs",
        String(UI_MAX_CLIP_MS),
        "--longPolicy",
        "skip",
        "--limit",
        String(Math.min(5, Math.max(1, targetPicks.length))),
        "--candidatesIn",
        pickPoolFile,
        "--pick",
        pickCsv,
        "--keepOutputs",
      ];
      if (DEFAULT_EN_SUBS_DIR) {
        args.splice(5, 0, "--enSubsDir", DEFAULT_EN_SUBS_DIR);
      }
      if (m) {
        args.push("--meaning", m);
      }

      appendJobLog(job, `Pick ${word}: ${pickCsv}`);
      await runNode(args, job);

      const renderedOut = path.join(OUT_ROOT, `${safeFilename(word)}_clean_shorts.mp4`);
      const canonical = path.join(OUT_ROOT, `${safeFilename(word)}.mp4`);
      if (!fs.existsSync(renderedOut)) {
        throw new Error(`Rendered output not found at ${renderedOut}`);
      }
      fs.copyFileSync(renderedOut, canonical);
      appendJobLog(job, `Copied output -> ${canonical}`);

      upsertManifestWord({
        word,
        picks: targetPicks,
        reason,
        output: canonical,
      });
      return;
    } finally {
      try {
        fs.unlinkSync(pickPoolFile);
      } catch {
        // ignore temp cleanup failures
      }
    }
  }

  const args = [
    path.join("scripts", "make-vertical-shorts-clean.js"),
    "--query",
    word,
    "--subsDir",
    DEFAULT_JP_SUBS_DIR,
    "--videosDir",
    DEFAULT_VIDEOS_DIR,
    "--wordList",
    WORDS_FILE,
    "--outDir",
    path.join(OUT_ROOT, "work"),
    "--outputDir",
    OUT_ROOT,
    "--mode",
    "line",
    "--prePadMs",
    String(UI_PRE_PAD_MS),
    "--postPadMs",
    String(UI_POST_PAD_MS),
    "--maxClipMs",
    String(UI_MAX_CLIP_MS),
    "--longPolicy",
    "skip",
    "--limit",
    String(Math.min(5, Math.max(1, targetPicks.length))),
    "--pick",
    pickCsv,
    "--keepOutputs",
  ];
  if (DEFAULT_EN_SUBS_DIR) {
    args.splice(5, 0, "--enSubsDir", DEFAULT_EN_SUBS_DIR);
  }
  if (fam) {
    args.splice(3, 0, "--matchContains", fam);
  }
  if (m) {
    args.push("--meaning", m);
  }

  appendJobLog(job, `Pick ${word}${fam ? ` family=${fam}` : ""}: ${pickCsv}`);
  await runNode(args, job);

  const outputSlug = fam ? `${safeFilename(word)}_${safeFilename(fam)}` : safeFilename(word);
  const renderedOut = path.join(OUT_ROOT, `${outputSlug}_clean_shorts.mp4`);
  const canonical = path.join(OUT_ROOT, `${safeFilename(word)}.mp4`);
  if (!fs.existsSync(renderedOut)) {
    throw new Error(`Rendered output not found at ${renderedOut}`);
  }
  fs.copyFileSync(renderedOut, canonical);
  appendJobLog(job, `Copied output -> ${canonical}`);
  upsertManifestWord({
    word,
    picks: targetPicks,
    reason,
    output: canonical,
    family: fam,
  });
}

function enqueuePick(word, picks, reason, family = "", meaning = "") {
  const fam = String(family || "").trim();
  const m = String(meaning || "").trim();
  return createJob("pick", { word, picks, reason, family: fam || null, meaning: m || null }, async (job) => {
    await runPickRender(job, { word, picks, reason, family: fam, meaning: m });
  });
}

function enqueueReplace(word, spec, reason) {
  return createJob("replace", { word, spec, reason }, async (job) => {
    const m = String(spec || "").trim().match(/^(\d+)\s*=\s*(\d+)$/);
    if (!m) throw new Error(`Bad replace spec "${spec}"`);
    const slot = Number(m[1]);
    const to = Number(m[2]);
    const detail = getWordDetail(word, "");
    const picks = uniquePositiveInts(detail?.manifest?.picks || detail?.picks || []).slice(0, 5);
    if (picks.length === 0) throw new Error(`No current picks for ${word}`);
    if (slot < 1 || slot > picks.length) throw new Error(`Slot ${slot} out of range`);
    if (picks.some((v, i) => i !== slot - 1 && v === to)) {
      throw new Error(`Replace ${spec} would create duplicate picks.`);
    }
    picks[slot - 1] = to;
    appendJobLog(job, `Replace ${word}: ${spec} -> picks=${picks.join(",")}`);
    await runPickRender(job, { word, picks, reason: String(reason || "").trim() || `replace ${spec}` });
  });
}

function enqueueRegenerateWord(word, family = "") {
  const fam = String(family || "").trim();
  return createJob("regenerate-word", { word, family: fam || null }, async (job) => {
    appendJobLog(job, `Regenerate candidates: ${word}${fam ? ` family=${fam}` : ""}`);
    const pool = buildLivePoolForWord(word, fam);
    appendJobLog(job, `Candidates ready: ${pool.length}`);
  });
}

function enqueueCutClips(word, picks, family = "") {
  const fam = String(family || "").trim();
  const target = uniquePositiveInts(picks).slice(0, 5);
  return createJob("cut-clips", { word, family: fam || null, picks: target }, async (job) => {
    if (target.length === 0) {
      throw new Error("picks required for cut-clips");
    }
    if (fam) {
      const existing = getLivePool(word, fam);
      if (!Array.isArray(existing) || existing.length === 0) {
        appendJobLog(job, `Building family pool first: ${word} family=${fam}`);
        buildLivePoolForWord(word, fam);
      }
    }
    let ok = 0;
    for (const idx of target) {
      appendJobLog(
        job,
        `Cut preview ${word}${fam ? ` family=${fam}` : ""} #${idx}`,
      );
      try {
        await ensurePreviewClip(word, idx, fam);
        ok++;
      } catch (err) {
        appendJobLog(job, `Preview failed #${idx}: ${err?.message || err}`);
      }
    }
    appendJobLog(job, `Cut clips done: ${ok}/${target.length}`);
    if (ok === 0) {
      throw new Error("No preview clips could be generated.");
    }
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

function streamFile(req, res, abs) {
  const stat = fs.statSync(abs);
  const size = stat.size;
  const ctype = contentType(abs);
  const range = String(req.headers.range || "").trim();

  res.setHeader("Content-Type", ctype);
  res.setHeader("Accept-Ranges", "bytes");

  if (!range) {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(size));
    fs.createReadStream(abs).pipe(res);
    return;
  }

  const m = range.match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }

  let start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isInteger(start) || start < 0) start = 0;
  if (!Number.isInteger(end) || end < 0 || end >= size) end = size - 1;

  if (start > end || start >= size) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }

  res.statusCode = 206;
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", String(end - start + 1));
  fs.createReadStream(abs, { start, end }).pipe(res);
}

function sendStatic(req, res, pathname) {
  const rawRel = pathname === "/" ? "/index.html" : pathname;
  let rel = rawRel;
  try {
    rel = decodeURIComponent(rawRel);
  } catch {
    rel = rawRel;
  }

  // allow previewing rendered mp4 under /out/*
  if (rel.startsWith("/out/")) {
    const abs = path.resolve(ROOT, "." + rel);
    if (!abs.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return json(res, 404, { error: "not found" });
    res.setHeader("Cache-Control", "no-store");
    streamFile(req, res, abs);
    return;
  }

  const abs = path.resolve(UI_ROOT, "." + rel);
  if (!abs.startsWith(UI_ROOT)) return json(res, 403, { error: "forbidden" });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return json(res, 404, { error: "not found" });

  res.setHeader("Cache-Control", "no-store");
  streamFile(req, res, abs);
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);
  const pathname = parsed.pathname || "/";

  try {
    if (pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        outRoot: OUT_ROOT,
        activeJobId,
        queueLength: queue.length,
      });
    }

    if (pathname === "/api/words" && req.method === "GET") {
      return json(res, 200, listWords());
    }

    if (pathname === "/api/word" && req.method === "GET") {
      const word = String(parsed.query.word || "").trim();
      const family = String(parsed.query.family || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      return json(res, 200, getWordDetail(word, family));
    }

    if (pathname === "/api/words/delete" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      const result = deleteWordFromSourceList(word);
      return json(res, 200, {
        ok: true,
        word,
        removed: result.removed,
        countBefore: result.countBefore,
        countAfter: result.countAfter,
        backupPath: result.backupPath || null,
      });
    }

    if (pathname === "/api/words/update-meaning" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      const family = String(body.family || "").trim();
      const meaning = String(body.meaning || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      if (!family) return json(res, 400, { error: "family is required for meaning override" });
      const result = updateFamilyMeaningOnly(word, family, meaning);
      return json(res, 200, {
        ok: true,
        word,
        family,
        meaning,
        updated: Boolean(result.updated),
        filePath: result.filePath || FAMILY_MEANINGS_FILE,
      });
    }

    if (pathname === "/api/preview" && req.method === "GET") {
      const word = String(parsed.query.word || "").trim();
      const family = String(parsed.query.family || "").trim();
      const candidateIndex = Number(parsed.query.candidate || 0);
      if (!word) return json(res, 400, { error: "word is required" });
      if (!Number.isInteger(candidateIndex) || candidateIndex <= 0) {
        return json(res, 400, { error: "candidate must be positive integer" });
      }
      const outPath = await ensurePreviewClip(word, candidateIndex, family);
      const rel = path
        .relative(ROOT, outPath)
        .split(path.sep)
        .join("/");
      return json(res, 200, {
        ok: true,
        url: encodeURI(`/${rel}`),
        word,
        family: family || null,
        candidateIndex,
      });
    }

    if (pathname === "/api/jobs" && req.method === "GET") {
      const list = Array.from(jobs.values())
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 30)
        .map((j) => ({
          id: j.id,
          name: j.name,
          status: j.status,
          createdAt: j.createdAt,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          error: j.error,
          payload: j.payload,
          logTail: j.logs.slice(-20),
        }));
      return json(res, 200, { activeJobId, queueLength: queue.length, jobs: list });
    }

    if (pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const id = pathname.split("/").pop();
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: "job not found" });
      return json(res, 200, job);
    }

    if (pathname === "/api/jobs/render-word" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      const job = enqueueRenderWord(word);
      return json(res, 200, { ok: true, jobId: job.id });
    }

    if (pathname === "/api/jobs/render-many" && req.method === "POST") {
      const body = await readBody(req);
      const words = Array.isArray(body.words)
        ? body.words.map((w) => String(w || "").trim()).filter(Boolean)
        : [];
      if (words.length === 0) return json(res, 400, { error: "words[] required" });
      const job = enqueueRenderMany(words);
      return json(res, 200, { ok: true, jobId: job.id, count: words.length });
    }

    if (pathname === "/api/jobs/pick" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      const family = String(body.family || "").trim();
      const meaning = String(body.meaning || "").trim();
      const picks = uniquePositiveInts(body.picks || []);
      const reason = String(body.reason || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      if (picks.length === 0) return json(res, 400, { error: "picks required" });
      const job = enqueuePick(word, picks.slice(0, 5), reason, family, meaning);
      return json(res, 200, { ok: true, jobId: job.id });
    }

    if (pathname === "/api/jobs/replace" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      const spec = String(body.spec || "").trim();
      const reason = String(body.reason || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      if (!spec) return json(res, 400, { error: "spec is required (e.g. 2=10)" });
      const job = enqueueReplace(word, spec, reason);
      return json(res, 200, { ok: true, jobId: job.id });
    }

    if (pathname === "/api/jobs/regenerate-word" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      const family = String(body.family || "").trim();
      if (!word) return json(res, 400, { error: "word is required" });
      const job = enqueueRegenerateWord(word, family);
      return json(res, 200, { ok: true, jobId: job.id });
    }

    if (pathname === "/api/jobs/cut-clips" && req.method === "POST") {
      const body = await readBody(req);
      const word = String(body.word || "").trim();
      const family = String(body.family || "").trim();
      const picks = uniquePositiveInts(body.picks || []);
      if (!word) return json(res, 400, { error: "word is required" });
      if (picks.length === 0) return json(res, 400, { error: "picks required" });
      const job = enqueueCutClips(word, picks, family);
      return json(res, 200, { ok: true, jobId: job.id });
    }

    if (pathname.startsWith("/api/")) {
      return json(res, 404, { error: "not found" });
    }

    return sendStatic(req, res, pathname);
  } catch (err) {
    return json(res, 500, { error: err?.message || String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[word-curation-ui] http://localhost:${PORT}`);
  console.log(`[word-curation-ui] outRoot=${OUT_ROOT}`);
});
