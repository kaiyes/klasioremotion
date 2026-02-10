#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

let kuromoji;
let wanakana;

const DEFAULT_WORDS_FILE = path.join("source_content", "all_anime_top_2000.json");
const DEFAULT_SUBS_DIR = path.join("source_content", "shingeki_no_kyojin", "subs", "japanese");
const DEFAULT_OUT_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.generated.json",
);

function parseArgs(argv) {
  const args = {
    wordsFile: DEFAULT_WORDS_FILE,
    subsDir: DEFAULT_SUBS_DIR,
    outFile: DEFAULT_OUT_FILE,
    count: 100,
    start: 1,
    maxForms: 25,
    printEvery: 10,
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
      case "wordsFile":
        args.wordsFile = v;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = v;
        takeNext();
        break;
      case "outFile":
        args.outFile = v;
        takeNext();
        break;
      case "count":
        args.count = Number(v);
        takeNext();
        break;
      case "start":
        args.start = Number(v);
        takeNext();
        break;
      case "maxForms":
        args.maxForms = Number(v);
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
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg: --${k}`);
    }
  }

  if (!Number.isFinite(args.start) || args.start < 1) {
    throw new Error("--start must be >= 1");
  }
  if (!Number.isFinite(args.count) || args.count < 0) {
    throw new Error("--count must be >= 0");
  }
  if (!Number.isFinite(args.maxForms) || args.maxForms < 2) {
    throw new Error("--maxForms must be >= 2");
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/generate-word-match-forms.js [options]

Options:
  --wordsFile <file>     Word list JSON (default: ${DEFAULT_WORDS_FILE})
  --subsDir <dir>        JP subtitles dir (default: ${DEFAULT_SUBS_DIR})
  --outFile <file>       Output JSON (default: ${DEFAULT_OUT_FILE})
  --start <n>            1-based start index in words list (default: 1)
  --count <n>            Number of words to update (default: 100, 0 = all)
  --maxForms <n>         Max forms per word (default: 25)
  --printEvery <n>       Progress interval (default: 10)
  --dryRun               Build stats and print sample, do not write file
  --verbose              Extra logs
`.trim() + "\n",
  );
  process.exit(code);
}

function stripBom(s) {
  return String(s || "").replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4]);
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

function timeAssToMs(ts) {
  const m = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) throw new Error(`Bad ASS timestamp: ${ts}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const frac = m[4];
  const base = ((hh * 60 + mm) * 60 + ss) * 1000;
  if (frac.length === 1) return base + Number(frac) * 100;
  if (frac.length === 2) return base + Number(frac) * 10;
  return base + Number(frac);
}

function looksLikeAssVectorDrawing(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return false;
  return /^[mnlbspc0-9.\-\s]+$/.test(s);
}

function cleanSubtitleText(t) {
  const normalized = String(t ?? "")
    .replace(/\\N/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>\n]*>/g, "")
    .replace(/(?:^|\s)(?:[a-z][a-z0-9_-]*\s*=\s*"[^"]*"\s*)+>/gi, " ")
    .replace(/[<>]/g, " ");

  const lines = normalized
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !looksLikeAssVectorDrawing(x));

  return lines.join(" ").trim();
}

function parseSrtFile(filePath) {
  const raw = stripBom(fs.readFileSync(filePath, "utf8"));
  const blocks = raw
    .split(/\r?\n\r?\n+/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/g);
    if (lines.length < 2) continue;
    const timeLineIdx = lines[0].includes("-->") ? 0 : 1;
    const timeLine = lines[timeLineIdx];
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!m) continue;
    const startMs = timeSrtToMs(m[1]);
    const endMs = timeSrtToMs(m[2]);
    const text = cleanSubtitleText(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;
    items.push({ startMs, endMs, text });
  }
  return items;
}

function parseAssFile(filePath) {
  const raw = stripBom(fs.readFileSync(filePath, "utf8"));
  const lines = raw.split(/\r?\n/g);
  const items = [];
  for (const line of lines) {
    if (!line.startsWith("Dialogue:")) continue;
    const rest = line.slice("Dialogue:".length).trim();
    const parts = rest.split(",");
    if (parts.length < 10) continue;
    const text = cleanSubtitleText(parts.slice(9).join(","));
    if (!text) continue;
    items.push({
      startMs: timeAssToMs(parts[1].trim()),
      endMs: timeAssToMs(parts[2].trim()),
      text,
    });
  }
  return items;
}

function parseSubsFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".srt") return parseSrtFile(filePath);
  if (ext === ".ass") return parseAssFile(filePath);
  return [];
}

function listSubtitleFiles(subsDir) {
  const out = [];
  const stack = [subsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".srt" || ext === ".ass") out.push(p);
    }
  }
  out.sort();
  return out;
}

function buildTokenizer(dicPath) {
  if (!kuromoji) kuromoji = require("kuromoji");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function toHiragana(text) {
  if (!wanakana) wanakana = require("wanakana");
  return wanakana.toHiragana(String(text || ""));
}

function containsJapanese(text) {
  return /[一-龯ぁ-んァ-ン々〆ヵヶー]/.test(String(text || ""));
}

function normalizeForm(raw) {
  const s = String(raw || "").replace(/\s+/g, "").trim();
  if (!s) return "";
  if (!containsJapanese(s)) return "";
  if (s.length > 24) return "";
  return s;
}

function bump(map, key, value = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + value);
}

function bumpNested(map, key, subKey, value = 1) {
  if (!key || !subKey) return;
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  inner.set(subKey, (inner.get(subKey) || 0) + value);
}

function asSortedArray(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
}

function readJsonArray(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must be a JSON array.`);
  }
  return data;
}

function dedupeArray(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLiteralForms(word, lineTexts) {
  const out = new Map();
  const target = normalizeForm(word);
  if (!target) return out;
  const particles = new Set(["に", "の", "は", "を", "が", "で", "へ", "も", "と", "から", "まで", "より"]);
  const pattern = new RegExp(
    `[一-龯ぁ-んァ-ン々〆ヵヶー]{0,4}${escapeRegExp(target)}[一-龯ぁ-んァ-ン々〆ヵヶー]{0,4}`,
    "g",
  );

  for (const line of lineTexts) {
    if (!line.includes(target)) continue;
    const matches = line.match(pattern);
    if (!matches) continue;
    for (const m of matches) {
      const form = normalizeForm(m);
      if (!form) continue;
      if (Array.from(form).length <= 6) {
        bump(out, form, 1);
      }

      const idx = form.indexOf(target);
      if (idx >= 0) {
        const prefix = Array.from(form.slice(0, idx));
        const suffix = Array.from(form.slice(idx + target.length));
        if (suffix.length > 0 && particles.has(suffix[0])) {
          bump(out, `${target}${suffix[0]}`, 2);
        }
        if (prefix.length >= 2 && prefix[prefix.length - 1] === "の") {
          const stem = prefix[prefix.length - 2];
          if (containsJapanese(stem)) {
            bump(out, `${stem}の${target}`, 2);
          }
        }
      }
    }
  }

  return out;
}

function buildStats({ subsDir, verbose }) {
  const dicPath = path.join("node_modules", "kuromoji", "dict");

  return buildTokenizer(dicPath).then((tokenizer) => {
    const files = listSubtitleFiles(subsDir);
    if (files.length === 0) {
      throw new Error(`No subtitle files found in ${subsDir}`);
    }

    const surfaceFreq = new Map();
    const lemmaToForms = new Map();
    const readingToForms = new Map();
    const lineTexts = [];

    let totalLines = 0;
    let totalTokens = 0;

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      const items = parseSubsFile(file);
      for (const item of items) {
        const text = String(item.text || "").trim();
        if (!text) continue;
        lineTexts.push(text);
        totalLines++;

        const tokens = tokenizer.tokenize(text);
        totalTokens += tokens.length;
        for (const t of tokens) {
          const surface = normalizeForm(t.surface_form || "");
          if (!surface) continue;

          const basic = normalizeForm(
            t.basic_form && t.basic_form !== "*" ? t.basic_form : surface,
          );
          const reading = normalizeForm(toHiragana(t.reading || surface));

          bump(surfaceFreq, surface, 1);
          if (basic) bumpNested(lemmaToForms, basic, surface, 1);
          if (reading) bumpNested(readingToForms, reading, surface, 1);
        }
      }

      if (verbose && (fileIdx + 1 === 1 || (fileIdx + 1) % 10 === 0 || fileIdx + 1 === files.length)) {
        console.log(
          `Parsed subtitles: ${fileIdx + 1}/${files.length} files, lines=${totalLines}, tokens=${totalTokens}`,
        );
      }
    }

    return {
      surfaceFreq,
      lemmaToForms,
      readingToForms,
      lineTexts,
      totalLines,
      totalTokens,
      totalFiles: files.length,
    };
  });
}

function generateFormsForWord({ entry, stats, maxForms }) {
  const word = normalizeForm(entry.word || "");
  const reading = normalizeForm(toHiragana(entry.reading || ""));
  const existingForms = dedupeArray(entry.match?.forms || []);

  const scores = new Map();
  const add = (rawForm, amount) => {
    const form = normalizeForm(rawForm);
    if (!form) return;
    scores.set(form, (scores.get(form) || 0) + amount);
  };

  // Keep canonical values always at the top.
  if (word) add(word, 1_000_000);
  if (reading && reading !== word) add(reading, 999_999);
  for (const f of existingForms) add(f, 100_000);

  const lemmaHits = stats.lemmaToForms.get(word);
  if (lemmaHits) {
    for (const [form, freq] of lemmaHits.entries()) {
      add(form, freq * 12);
    }
  }

  if (reading) {
    const readingHits = stats.readingToForms.get(reading);
    if (readingHits) {
      for (const [form, freq] of readingHits.entries()) {
        add(form, freq * 8);
      }
    }
  }

  // Catch compounds that include the written form, e.g. 前 -> お前 / 目の前 / 名前.
  if (word) {
    for (const [surface, freq] of stats.surfaceFreq.entries()) {
      if (surface.includes(word)) add(surface, freq * 6);
    }

    const literal = collectLiteralForms(word, stats.lineTexts);
    for (const [form, freq] of literal.entries()) {
      add(form, freq * 5);
    }
  }

  const ranked = asSortedArray(scores)
    .map(([form, score]) => ({
      form,
      score,
      freq: stats.surfaceFreq.get(form) || 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.freq !== a.freq) return b.freq - a.freq;
      return a.form.length - b.form.length;
    })
    .map((x) => x.form);

  // Ensure canonical form order.
  const forms = [];
  const pushUnique = (f) => {
    if (!f) return;
    if (forms.includes(f)) return;
    forms.push(f);
  };
  pushUnique(word);
  pushUnique(reading !== word ? reading : "");
  for (const f of ranked) pushUnique(f);

  return forms.slice(0, maxForms);
}

async function main() {
  const args = parseArgs(process.argv);
  const words = readJsonArray(args.wordsFile);

  if (!fs.existsSync(args.subsDir)) {
    throw new Error(`Subtitle directory not found: ${args.subsDir}`);
  }

  const stats = await buildStats({ subsDir: args.subsDir, verbose: args.verbose });

  const startIdx = Math.max(0, Math.floor(args.start) - 1);
  const endIdx = args.count > 0 ? Math.min(words.length, startIdx + Math.floor(args.count)) : words.length;

  if (startIdx >= words.length) {
    throw new Error(`--start ${args.start} is out of range for ${words.length} words.`);
  }

  let updated = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const entry = words[i];
    if (!entry || typeof entry !== "object") continue;

    const forms = generateFormsForWord({ entry, stats, maxForms: args.maxForms });
    const exclude = dedupeArray(entry.match?.exclude || []);

    entry.match = {
      forms,
      exclude,
    };

    updated++;
    const n = i - startIdx + 1;
    if (
      n === 1 ||
      n === endIdx - startIdx ||
      (args.printEvery > 0 && n % args.printEvery === 0)
    ) {
      console.log(
        `[${n}/${endIdx - startIdx}] ${entry.word} -> forms=${forms.length} sample=${forms.slice(0, 5).join(", ")}`,
      );
    }
  }

  const maeEntry = words.find((x) => x && x.word === "前");
  if (maeEntry?.match?.forms) {
    console.log(`Sample 前 forms: ${maeEntry.match.forms.slice(0, 12).join(", ")}`);
  }

  if (args.dryRun) {
    console.log("Dry run complete. No file written.");
    return;
  }

  const outAbs = path.resolve(args.outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(words, null, 2));

  console.log("");
  console.log(`Done. Updated ${updated} words.`);
  console.log(`Output: ${outAbs}`);
  console.log(
    `Corpus stats: files=${stats.totalFiles} lines=${stats.totalLines} tokens=${stats.totalTokens} uniqueForms=${stats.surfaceFreq.size}`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
