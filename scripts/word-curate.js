#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULTS = {
  wordsFile: path.join("source_content", "all_anime_top_2000.match.first2000.json"),
  subsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "japanese"),
  enSubsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "english_embedded"),
  videosDir: path.join("source_content", "shingeki_no_kyojin", "videos"),
  outBase: path.join("out", "shorts"),
  model: "llama3.2:3b",
  topK: 5,
  printTop: 40,
};

function usageAndExit(code = 0) {
  console.log(
    `
Usage:
  node scripts/word-curate.js <render|show|replace|pick> <word> [args]

Commands:
  render <word>
    Render one short (5 clips) for word with current pipeline defaults.

  show <word> [topN]
    Show current picks + top ranked candidates for manual review.

  replace <word> <slot=candidate> [why...]
    Replace one slot in current picks and re-render that word only.
    Example: replace 悪い 2=18 "EN mismatch"

  pick <word> <csv-picks> [why...]
    Re-render that word with exact picks.
    Example: pick 悪い 9,14,18,20,1 "manual final"
`.trim() + "\n",
  );
  process.exit(code);
}

function safeFilename(s) {
  const raw = String(s || "").trim();
  if (!raw) return "word";
  return raw
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function runOrThrow(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${cmd} failed (${res.status})`);
  }
}

function runCaptureOrThrow(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (res.status !== 0) {
    const stderr = String(res.stderr || "").trim();
    const stdout = String(res.stdout || "").trim();
    const tail = [stderr, stdout]
      .filter(Boolean)
      .join("\n")
      .split(/\r?\n/g)
      .slice(-40)
      .join("\n");
    throw new Error(`${cmd} failed (${res.status})${tail ? `\n${tail}` : ""}`);
  }
  return {
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
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

function parseCsvPicks(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => Number(s.trim()));
  const out = uniquePositiveInts(parts);
  if (out.length === 0) {
    throw new Error(`Bad picks "${raw}". Use comma list like 9,14,3,20,1`);
  }
  return out;
}

function parseReplaceSpec(spec) {
  const m = String(spec || "")
    .trim()
    .match(/^(\d+)\s*=\s*(\d+)$/);
  if (!m) {
    throw new Error(`Bad replace "${spec}". Use "<slot>=<candidate>", e.g. 2=18`);
  }
  const slot = Number(m[1]);
  const candidate = Number(m[2]);
  if (!Number.isInteger(slot) || slot <= 0) {
    throw new Error(`Bad slot in replace "${spec}".`);
  }
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`Bad candidate in replace "${spec}".`);
  }
  return { slot, candidate };
}

function getOutRoot() {
  return path.resolve(DEFAULTS.outBase);
}

function getManifestPath() {
  return path.join(getOutRoot(), "render-manifest.json");
}

function getRerankPath() {
  const outRoot = getOutRoot();
  const primary = path.join(outRoot, "word-candidates-llm-top.qwen2.5-3b.full.json");
  if (fs.existsSync(primary)) return primary;
  const backup = path.join(
    path.resolve(outRoot, "..", "saveFile"),
    "word-candidates-llm-top.qwen2.5-3b.full.backup.json",
  );
  if (fs.existsSync(backup)) return backup;
  return primary;
}

function getDbPath() {
  return path.join(getOutRoot(), "word-candidates-db.json");
}

function normalizeFileForKey(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function candidateKeyFromRecord(rec) {
  const videoFile = normalizeFileForKey(rec?.videoFile);
  const clipStartMs = Number(rec?.clipStartMs);
  const clipEndMs = Number(rec?.clipEndMs);
  if (!videoFile || !Number.isFinite(clipStartMs) || !Number.isFinite(clipEndMs)) {
    return "";
  }
  return `${videoFile}|${Math.round(clipStartMs)}|${Math.round(clipEndMs)}`;
}

function loadDbWordRecord(word) {
  const db = readJsonOrNull(getDbPath());
  if (!db || !Array.isArray(db.words)) return null;
  return db.words.find((w) => String(w?.word || "") === word) || null;
}

function buildRenderPool(word) {
  const outRoot = getOutRoot();
  const workDir = path.join(outRoot, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const poolFile = path.join(workDir, `.tmp_pool_${safeFilename(word)}.json`);

  runCaptureOrThrow(process.execPath, [
    path.join("scripts", "extract-clips.js"),
    "--query",
    word,
    "--subsDir",
    DEFAULTS.subsDir,
    "--enSubsDir",
    DEFAULTS.enSubsDir,
    "--videosDir",
    DEFAULTS.videosDir,
    "--wordList",
    DEFAULTS.wordsFile,
    "--mode",
    "line",
    "--rank",
    "--limit",
    "1",
    "--prePadMs",
    "0",
    "--postPadMs",
    "0",
    "--maxClipMs",
    "2000",
    "--longPolicy",
    "skip",
    "--dryRun",
    "--candidatesOut",
    poolFile,
  ]);

  const poolJson = readJsonOrNull(poolFile);
  const pool = Array.isArray(poolJson?.pool) ? poolJson.pool : [];
  if (pool.length === 0) {
    throw new Error(`No render candidates found for "${word}".`);
  }
  return pool;
}

function mapDbPicksToRenderPool(word, picks) {
  const dbRec = loadDbWordRecord(word);
  if (!dbRec || !Array.isArray(dbRec.candidates) || dbRec.candidates.length === 0) {
    return {
      dbPicks: uniquePositiveInts(picks).slice(0, DEFAULTS.topK),
      renderPicks: uniquePositiveInts(picks).slice(0, DEFAULTS.topK),
      mappingMode: "passthrough_no_db",
    };
  }

  const pool = buildRenderPool(word);
  const poolPositionsByKey = new Map();
  for (let i = 0; i < pool.length; i++) {
    const k = candidateKeyFromRecord(pool[i]);
    if (!k) continue;
    const arr = poolPositionsByKey.get(k) || [];
    arr.push(i + 1);
    poolPositionsByKey.set(k, arr);
  }

  const dbPicks = uniquePositiveInts(picks).slice(0, DEFAULTS.topK);
  const renderPicks = [];
  const used = new Set();
  const missing = [];

  for (const pick of dbPicks) {
    const dbCandidate = dbRec.candidates[pick - 1];
    if (!dbCandidate) {
      missing.push(`#${pick}(missing_db_candidate)`);
      continue;
    }
    const k = candidateKeyFromRecord(dbCandidate);
    const positions = poolPositionsByKey.get(k) || [];
    const pos = positions.find((p) => !used.has(p));
    if (!pos) {
      missing.push(`#${pick}`);
      continue;
    }
    used.add(pos);
    renderPicks.push(pos);
  }

  if (missing.length > 0) {
    throw new Error(
      `Could not map selected picks to render pool for "${word}": ${missing.join(", ")}.`,
    );
  }
  if (renderPicks.length === 0) {
    throw new Error(`No mapped picks available for "${word}".`);
  }

  return { dbPicks, renderPicks, mappingMode: "mapped_db_to_render_pool" };
}

function getCurrentPicks(word) {
  const manifest = readJsonOrNull(getManifestPath());
  const fromManifest = Array.isArray(manifest?.words)
    ? manifest.words.find((w) => String(w?.word || "") === word)
    : null;
  const picksA = uniquePositiveInts(fromManifest?.picks || []);
  if (picksA.length > 0) return picksA;

  const rerank = readJsonOrNull(getRerankPath());
  const fromRerank = Array.isArray(rerank?.words)
    ? rerank.words.find((w) => String(w?.word || "") === word)
    : null;
  const picksB = uniquePositiveInts((fromRerank?.top || []).map((x) => x?.candidateIndex));
  if (picksB.length > 0) return picksB.slice(0, DEFAULTS.topK);

  return [];
}

function upsertManifestWordPick(word, picks, outputPath) {
  const manifestPath = getManifestPath();
  const manifest = readJsonOrNull(manifestPath);
  if (!manifest || !Array.isArray(manifest.words)) return;
  const idx = manifest.words.findIndex((w) => String(w?.word || "") === word);
  if (idx < 0) return;
  manifest.words[idx] = {
    ...manifest.words[idx],
    status: "rendered",
    reason: "manual_override",
    picks,
    output: outputPath,
    error: null,
  };
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch {
    // ignore
  }
}

function appendCurationLog(entry) {
  const filePath = path.join(getOutRoot(), "curation-log.jsonl");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function renderWord(word) {
  runOrThrow(process.execPath, [
    path.join("scripts", "word-pipeline.js"),
    "full",
    "--word",
    word,
    "--fast",
    "--topK",
    String(DEFAULTS.topK),
    "--allowWeak",
    "--force",
    "--outBase",
    DEFAULTS.outBase,
    "--model",
    DEFAULTS.model,
  ]);
}

function showWord(word, topN) {
  const picks = getCurrentPicks(word);
  if (picks.length > 0) {
    console.log(`[word-curate] current picks ${word}: ${picks.join(",")}`);
  } else {
    console.log(`[word-curate] current picks ${word}: (none yet)`);
  }

  runOrThrow(process.execPath, [
    path.join("scripts", "extract-clips.js"),
    "--query",
    word,
    "--subsDir",
    DEFAULTS.subsDir,
    "--enSubsDir",
    DEFAULTS.enSubsDir,
    "--videosDir",
    DEFAULTS.videosDir,
    "--wordList",
    DEFAULTS.wordsFile,
    "--rank",
    "--printTop",
    String(topN),
    "--limit",
    String(DEFAULTS.topK),
    "--dryRun",
  ]);
}

function rerenderWithPicks(word, picks, why) {
  const outRoot = getOutRoot();
  const outDir = path.join(outRoot, "work");
  const outputDir = outRoot;
  const mapped = mapDbPicksToRenderPool(word, picks);
  const dbPickCsv = mapped.dbPicks.join(",");
  const renderPickCsv = mapped.renderPicks.join(",");
  if (!dbPickCsv) throw new Error("No valid picks to render.");
  if (!renderPickCsv) throw new Error("No mapped render picks available.");

  runOrThrow(process.execPath, [
    path.join("scripts", "make-vertical-shorts-clean.js"),
    "--query",
    word,
    "--subsDir",
    DEFAULTS.subsDir,
    "--enSubsDir",
    DEFAULTS.enSubsDir,
    "--videosDir",
    DEFAULTS.videosDir,
    "--wordList",
    DEFAULTS.wordsFile,
    "--outDir",
    outDir,
    "--outputDir",
    outputDir,
    "--mode",
    "line",
    "--prePadMs",
    "0",
    "--postPadMs",
    "0",
    "--maxClipMs",
    "2000",
    "--longPolicy",
    "skip",
    "--limit",
    String(mapped.renderPicks.length),
    "--pick",
    renderPickCsv,
    "--keepOutputs",
  ]);

  const slug = safeFilename(word);
  const generated = path.join(outputDir, `${slug}_clean_shorts.mp4`);
  const canonical = path.join(outputDir, `${slug}.mp4`);
  if (fs.existsSync(generated)) {
    fs.renameSync(generated, canonical);
  }

  upsertManifestWordPick(word, parseCsvPicks(dbPickCsv), canonical);
  appendCurationLog({
    at: new Date().toISOString(),
    word,
    picks: dbPickCsv,
    renderPicks: renderPickCsv,
    mappingMode: mapped.mappingMode,
    why: String(why || "").trim(),
    output: canonical,
  });
  console.log(
    `[word-curate] picks db=${dbPickCsv} -> render=${renderPickCsv} (${mapped.mappingMode})`,
  );
  console.log(`[word-curate] output: ${canonical}`);
}

function replaceAndRerender(word, spec, why) {
  const current = getCurrentPicks(word);
  if (current.length === 0) {
    throw new Error(`No current picks found for "${word}". Render it once first.`);
  }
  const picks = [...current];
  const { slot, candidate } = parseReplaceSpec(spec);
  if (slot > picks.length) throw new Error(`Slot ${slot} out of range for picks=${picks.join(",")}`);
  if (picks.some((v, i) => i !== slot - 1 && Number(v) === candidate)) {
    throw new Error(`Replace ${spec} would create duplicate picks.`);
  }

  const before = [...picks];
  picks[slot - 1] = candidate;
  const finalPicks = picks;

  rerenderWithPicks(word, finalPicks, why || `replace ${spec}`);
  appendCurationLog({
    at: new Date().toISOString(),
    word,
    action: "replace",
    replace: spec,
    before: before.join(","),
    after: finalPicks.join(","),
    why: String(why || "").trim(),
  });
}

function main() {
  const [, , cmd, rawWord, a3, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") usageAndExit(0);
  const word = String(rawWord || "").trim();
  if (!word) usageAndExit(1);

  if (cmd === "render") {
    renderWord(word);
    return;
  }
  if (cmd === "show") {
    const topN = Number(a3);
    showWord(word, Number.isFinite(topN) && topN > 0 ? topN : DEFAULTS.printTop);
    return;
  }
  if (cmd === "replace") {
    const spec = String(a3 || "").trim();
    if (!spec) usageAndExit(1);
    replaceAndRerender(word, spec, rest.join(" "));
    return;
  }
  if (cmd === "pick") {
    const csv = String(a3 || "").trim();
    if (!csv) usageAndExit(1);
    rerenderWithPicks(word, parseCsvPicks(csv), rest.join(" "));
    return;
  }

  throw new Error(`Unknown command "${cmd}".`);
}

try {
  main();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
