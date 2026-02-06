#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let resvg;

function parseArgs(argv) {
  const args = {
    inputDir: "out/clips",
    input: null,
    outputDir: "out/shorts",
    wordList: "source_content/all_anime_top_2000.json",
    width: 1080,
    height: 1920,
    videoTop: 760,
    limit: 0,
    dryRun: false,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [key, maybeValue] = a.slice(2).split("=");
    const value = maybeValue ?? argv[i + 1];
    const takeNext = () => {
      if (maybeValue == null) i++;
    };

    switch (key) {
      case "inputDir":
        args.inputDir = value;
        takeNext();
        break;
      case "input":
        args.input = value;
        takeNext();
        break;
      case "outputDir":
        args.outputDir = value;
        takeNext();
        break;
      case "wordList":
        args.wordList = value;
        takeNext();
        break;
      case "width":
        args.width = Number(value);
        takeNext();
        break;
      case "height":
        args.height = Number(value);
        takeNext();
        break;
      case "videoTop":
        args.videoTop = Number(value);
        takeNext();
        break;
      case "limit":
        args.limit = Number(value);
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      default:
        throw new Error(`Unknown arg --${key}`);
    }
  }
  return args;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function listMp4Files(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.mp4$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function loadWordMap(wordListPath) {
  if (!fs.existsSync(wordListPath)) return new Map();
  const raw = JSON.parse(fs.readFileSync(wordListPath, "utf8"));
  const map = new Map();
  for (const item of raw) {
    if (!item?.word) continue;
    map.set(String(item.word), item);
  }
  return map;
}

function normalizeMeaning(meaning) {
  if (!meaning) return "";
  return String(meaning).split(/[;,.]/)[0].trim();
}

function guessWordFromFilename(file) {
  const base = path.basename(file, path.extname(file));
  const parts = [base, base.split("_")[0], base.split("-")[0]];
  for (const p of parts) {
    if (p && p.trim()) return p.trim();
  }
  return base;
}

function lookupWordMeta(wordMap, file) {
  const guessed = guessWordFromFilename(file);
  const entry = wordMap.get(guessed) ?? null;
  return {
    word: guessed,
    reading: entry?.reading ? String(entry.reading) : "",
    meaning: normalizeMeaning(entry?.meaning || ""),
  };
}

function escapeXml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHeaderSvg({ width, height, word, reading, meaning }) {
  const scale = height / 1920;
  const fontJP = "Hiragino Sans, Noto Sans CJK JP, Arial";
  const fontEN = "Helvetica Neue, Arial, sans-serif";

  const boxW = width * 0.9;
  const boxH = 360 * scale;
  const boxX = (width - boxW) / 2;
  const boxY = 84 * scale;

  const labelY = boxY + 62 * scale;
  const readingY = labelY + 58 * scale;
  const wordY = readingY + 108 * scale;
  const meaningY = wordY + 70 * scale;

  const meaningText = meaning || "Japanese in context";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="transparent"/>
  <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${26 * scale}" ry="${26 * scale}" fill="rgba(0,0,0,0.55)"/>
  <text x="50%" y="${labelY}" text-anchor="middle" font-family="${fontEN}" font-size="${42 * scale}" font-weight="700" fill="#ffffff">Kanji of the day</text>
  <text x="50%" y="${readingY}" text-anchor="middle" font-family="${fontJP}" font-size="${52 * scale}" font-weight="700" fill="#ffffff">${escapeXml(reading)}</text>
  <text x="50%" y="${wordY}" text-anchor="middle" font-family="${fontJP}" font-size="${126 * scale}" font-weight="800" fill="#ffd900" stroke="#000000" stroke-width="${4 * scale}" paint-order="stroke fill">${escapeXml(word)}</text>
  <text x="50%" y="${meaningY}" text-anchor="middle" font-family="${fontEN}" font-size="${48 * scale}" font-weight="700" fill="#ffffff">${escapeXml(meaningText)}</text>
</svg>`;
}

function renderSvgToPng({ svg, output }) {
  if (!resvg) {
    resvg = require("@resvg/resvg-js");
  }
  const instance = new resvg.Resvg(svg);
  fs.writeFileSync(output, instance.render().asPng());
}

function runFfmpegVertical({ input, overlay, output, width, height, videoTop, verbose }) {
  const filter = [
    `color=c=black:s=${width}x${height}[bg]`,
    `[0:v]scale=${width}:-2:flags=lanczos[clip]`,
    `[bg][clip]overlay=(W-w)/2:${videoTop}[base]`,
    `[base][1:v]overlay=0:0:format=auto[v]`,
  ].join(";");

  const args = [
    "-y",
    "-i",
    input,
    "-loop",
    "1",
    "-i",
    overlay,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ];

  if (verbose) console.log(["ffmpeg", ...args].join(" "));
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg vertical render failed for ${output}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outputDir);

  const inputs = args.input
    ? [path.resolve(args.input)]
    : listMp4Files(path.resolve(args.inputDir));

  if (inputs.length === 0) {
    throw new Error("No input clips found. Use --input or --inputDir.");
  }

  const wordMap = loadWordMap(path.resolve(args.wordList));
  const selected = args.limit > 0 ? inputs.slice(0, args.limit) : inputs;

  for (const input of selected) {
    const meta = lookupWordMeta(wordMap, input);
    const svg = buildHeaderSvg({
      width: args.width,
      height: args.height,
      word: meta.word,
      reading: meta.reading,
      meaning: meta.meaning,
    });

    const base = path.basename(input, path.extname(input));
    const overlayPath = path.join(args.outputDir, `.tmp_overlay_${base}.png`);
    const output = path.join(args.outputDir, `${base}_shorts.mp4`);
    renderSvgToPng({ svg, output: overlayPath });

    console.log(`Rendering vertical short: ${base}`);
    console.log(`  in:  ${input}`);
    console.log(`  out: ${output}`);

    if (!args.dryRun) {
      runFfmpegVertical({
        input,
        overlay: overlayPath,
        output,
        width: args.width,
        height: args.height,
        videoTop: args.videoTop,
        verbose: args.verbose,
      });
    }

    try {
      fs.unlinkSync(overlayPath);
    } catch {
      // no-op
    }
  }

  console.log("");
  console.log(`Done. Wrote ${selected.length} vertical short(s) to: ${args.outputDir}`);
}

main();
