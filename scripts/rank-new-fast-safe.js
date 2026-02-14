#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RERANK_SCRIPT = path.join(ROOT, "scripts", "rerank-word-candidates-ollama.js");
const DB_FILE = path.join(
  ROOT,
  "out",
  "shorts",
  "word-candidates-db.json",
);
const OUT_ROOT = path.join(ROOT, "out", "shorts");
const PRIMARY_OUT_FILE = path.join(OUT_ROOT, "word-candidates-llm-top.qwen2.5-3b.full.json");
const BACKUP_OUT_FILE = path.join(
  ROOT,
  "out",
  "saveFile",
  "word-candidates-llm-top.qwen2.5-3b.full.backup.json",
);

function getArgValue(args, key, fallback = null) {
  const needle = `--${key}`;
  for (let i = args.length - 1; i >= 0; i--) {
    const a = String(args[i] || "");
    if (a === needle) {
      const next = args[i + 1];
      if (next != null && !String(next).startsWith("--")) return String(next);
      return fallback;
    }
    if (a.startsWith(`${needle}=`)) {
      return a.slice(needle.length + 1);
    }
  }
  return fallback;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function validateRerankJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!raw || !Array.isArray(raw.words)) {
    throw new Error(`Invalid rerank JSON (missing words[]): ${filePath}`);
  }
  if (!raw.meta || typeof raw.meta !== "object") {
    throw new Error(`Invalid rerank JSON (missing meta): ${filePath}`);
  }
  return raw;
}

function run() {
  const passThrough = process.argv.slice(2);
  if (passThrough.includes("--help") || passThrough.includes("-h")) {
    console.log("Usage: npm run -s rank:new-fast [extra rerank flags]");
    console.log(`Default outFile: ${PRIMARY_OUT_FILE}`);
    process.exit(0);
  }

  ensureDir(OUT_ROOT);
  ensureDir(path.dirname(BACKUP_OUT_FILE));

  const defaultArgs = [
    RERANK_SCRIPT,
    "--dbFile",
    DB_FILE,
    "--outFile",
    PRIMARY_OUT_FILE,
    "--model",
    "qwen2.5:3b",
    "--topK",
    "5",
    "--maxCandidates",
    "50",
    "--fromIndex",
    "1",
    "--count",
    "0",
    "--resume",
    "--allowWeak",
    "--printEvery",
    "1",
  ];
  const resolvedOutFile = path.resolve(
    getArgValue(passThrough, "outFile", PRIMARY_OUT_FILE),
  );
  const cli = [...defaultArgs, ...passThrough];
  console.log(`[rank:new-fast] outFile=${resolvedOutFile}`);

  const res = spawnSync(process.execPath, cli, { stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }

  const parsed = validateRerankJson(resolvedOutFile);
  copyFile(resolvedOutFile, BACKUP_OUT_FILE);

  console.log(`[rank:new-fast] words=${parsed.words.length}`);
  console.log(`[rank:new-fast] main=${resolvedOutFile}`);
  console.log(`[rank:new-fast] backup=${BACKUP_OUT_FILE}`);
}

try {
  run();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
