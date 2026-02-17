#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:8790",
    range: "1-10",
    cycles: 0, // 0 = infinite
    sleepMs: 300,
    pollMs: 1200,
    jobTimeoutMs: 15 * 60 * 1000,
    outLog: path.join("out", "shorts", "soak", "ui-soak-log.jsonl"),
    outSummary: path.join("out", "shorts", "soak", "ui-soak-summary.json"),
    strictPickMatch: true,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || "");
    if (!a.startsWith("--")) continue;
    const [k, inlineV] = a.slice(2).split("=");
    const v = inlineV ?? argv[i + 1];
    const take = () => {
      if (inlineV == null) i++;
    };

    switch (k) {
      case "baseUrl":
        args.baseUrl = String(v || args.baseUrl).trim();
        take();
        break;
      case "range":
        args.range = String(v || args.range).trim();
        take();
        break;
      case "cycles":
        args.cycles = Number(v);
        take();
        break;
      case "sleepMs":
        args.sleepMs = Number(v);
        take();
        break;
      case "pollMs":
        args.pollMs = Number(v);
        take();
        break;
      case "jobTimeoutMs":
        args.jobTimeoutMs = Number(v);
        take();
        break;
      case "outLog":
        args.outLog = String(v || args.outLog).trim();
        take();
        break;
      case "outSummary":
        args.outSummary = String(v || args.outSummary).trim();
        take();
        break;
      case "strictPickMatch":
        args.strictPickMatch = true;
        break;
      case "no-strictPickMatch":
        args.strictPickMatch = false;
        break;
      case "help":
      case "h":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  if (!Number.isFinite(args.cycles) || args.cycles < 0) {
    throw new Error("--cycles must be >= 0");
  }
  if (!Number.isFinite(args.sleepMs) || args.sleepMs < 0) {
    throw new Error("--sleepMs must be >= 0");
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) {
    throw new Error("--pollMs must be > 0");
  }
  if (!Number.isFinite(args.jobTimeoutMs) || args.jobTimeoutMs <= 0) {
    throw new Error("--jobTimeoutMs must be > 0");
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(`
Usage:
  node scripts/ui-soak-test.js [options]

Options:
  --baseUrl <url>         API base URL (default: http://127.0.0.1:8790)
  --range <a-b>           Word index range from /api/words (default: 1-10)
  --cycles <n>            Number of passes (0 = infinite, default: 0)
  --sleepMs <n>           Delay between words (default: 300)
  --pollMs <n>            Job polling interval (default: 1200)
  --jobTimeoutMs <n>      Per-render timeout (default: 900000)
  --outLog <file>         JSONL log output
  --outSummary <file>     Summary JSON output
  --strictPickMatch       Fail if manifest picks != requested picks (default: on)
  --no-strictPickMatch    Disable strict picks equality check
  --help, -h              Show help
`.trim());
  process.exit(code);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function parseRange(range, maxN) {
  const m = String(range || "").trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) throw new Error(`Bad --range "${range}" (expected A-B)`);
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (a > b) [a, b] = [b, a];
  a = Math.max(1, a);
  b = Math.max(1, b);
  if (Number.isFinite(maxN) && maxN > 0) {
    a = Math.min(a, maxN);
    b = Math.min(b, maxN);
  }
  return [a, b];
}

async function jsonFetch(url, init = {}, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const txt = await res.text();
    let data;
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      data = { raw: txt };
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function appendJsonl(filePath, row) {
  ensureDir(filePath);
  fs.appendFileSync(path.resolve(filePath), `${JSON.stringify(row)}\n`, "utf8");
}

async function waitJob(baseUrl, id, pollMs, timeoutMs) {
  const started = Date.now();
  while (true) {
    const data = await jsonFetch(`${baseUrl}/api/jobs/${encodeURIComponent(id)}`);
    const job = data?.job || {};
    const s = String(job.status || "");
    if (s === "done" || s === "error") return job;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`job timeout: ${id}`);
    }
    await sleep(pollMs);
  }
}

async function runOne({ baseUrl, word, idx, args }) {
  const t0 = Date.now();
  const before = await jsonFetch(`${baseUrl}/api/word?word=${encodeURIComponent(word)}`);
  const requestedPicks = uniquePositiveInts(before?.picks || []).slice(0, 5);
  if (requestedPicks.length === 0) {
    throw new Error("no picks available");
  }

  const enqueue = await jsonFetch(`${baseUrl}/api/jobs/pick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      word,
      picks: requestedPicks,
      reason: `soak idx=${idx}`,
    }),
  });
  const jobId = String(enqueue?.jobId || enqueue?.job?.id || "");
  if (!jobId) {
    throw new Error("enqueue failed: missing job id");
  }
  const job = await waitJob(baseUrl, jobId, args.pollMs, args.jobTimeoutMs);
  if (job.status !== "done") {
    throw new Error(job.error || `job ended with ${job.status}`);
  }

  const after = await jsonFetch(`${baseUrl}/api/word?word=${encodeURIComponent(word)}`);
  const manifestPicks = uniquePositiveInts(after?.manifest?.picks || []);
  if (args.strictPickMatch) {
    const lhs = manifestPicks.join(",");
    const rhs = requestedPicks.join(",");
    if (lhs !== rhs) {
      throw new Error(`pick mismatch requested=${rhs} manifest=${lhs}`);
    }
  }

  const outPath = String(after?.manifest?.output || after?.output || "").trim();
  if (!outPath || !fs.existsSync(outPath)) {
    throw new Error(`missing output file: ${outPath || "(empty)"}`);
  }
  const size = fs.statSync(outPath).size;
  if (size <= 0) {
    throw new Error(`empty output file: ${outPath}`);
  }

  return {
    word,
    idx,
    picks: requestedPicks,
    output: outPath,
    bytes: size,
    ms: Date.now() - t0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  ensureDir(args.outLog);
  ensureDir(args.outSummary);

  const wordsData = await jsonFetch(`${baseUrl}/api/words`);
  const words = Array.isArray(wordsData?.words) ? wordsData.words : [];
  if (words.length === 0) throw new Error("No words from /api/words");
  const [a, b] = parseRange(args.range, words.length);
  const selected = words.filter((w) => Number(w?.idx) >= a && Number(w?.idx) <= b);
  if (selected.length === 0) throw new Error(`No words in range ${a}-${b}`);

  console.log(`[ui-soak] base=${baseUrl} range=${a}-${b} words=${selected.length} cycles=${args.cycles || "infinite"}`);

  let pass = 0;
  let fail = 0;
  let cycle = 0;
  const startedAt = new Date().toISOString();

  while (args.cycles === 0 || cycle < args.cycles) {
    cycle += 1;
    for (const row of selected) {
      const word = String(row?.word || "").trim();
      const idx = Number(row?.idx || 0);
      if (!word) continue;
      const at = new Date().toISOString();
      try {
        const out = await runOne({ baseUrl, word, idx, args });
        pass += 1;
        const logRow = { at, cycle, status: "pass", ...out };
        appendJsonl(args.outLog, logRow);
        console.log(`[PASS c${cycle}] #${idx} ${word} picks=${out.picks.join(",")} ${out.ms}ms`);
      } catch (err) {
        fail += 1;
        const logRow = {
          at,
          cycle,
          status: "fail",
          word,
          idx,
          error: err?.message || String(err),
        };
        appendJsonl(args.outLog, logRow);
        console.log(`[FAIL c${cycle}] #${idx} ${word} ${logRow.error}`);
      }
      if (args.sleepMs > 0) await sleep(args.sleepMs);
    }

    const summary = {
      updatedAt: new Date().toISOString(),
      startedAt,
      cyclesCompleted: cycle,
      pass,
      fail,
      baseUrl,
      range: `${a}-${b}`,
      words: selected.length,
    };
    fs.writeFileSync(path.resolve(args.outSummary), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
