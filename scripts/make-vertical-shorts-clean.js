#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let kuromoji;
let wanakana;
let resvg;
let QRCode;
const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_EN_SUBS_DIR_EMBEDDED = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_DIR_LEGACY = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_DIR_EMBEDDED)
  ? DEFAULT_EN_SUBS_DIR_EMBEDDED
  : DEFAULT_EN_SUBS_DIR_LEGACY;

function parseArgs(argv) {
  const args = {
    query: null,
    subsDir: null,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : null,
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : null,
    outDir: "out/shorts_work",
    outputDir: "out/shorts",
    wordList: "source_content/all_anime_top_2000.json",
    width: 1080,
    height: 1920,
    videoTop: 760,
    limit: 5,
    rank: true,
    shuffle: false,
    shuffleSeed: null,
    shuffleTop: 0,
    prePadMs: 1500,
    postPadMs: 1500,
    maxClipMs: 2500,
    longPolicy: "shrink",
    printTop: 0,
    pick: null,
    replace: [],
    tailRepeat: 3,
    brandQrUrl: "http://bundai.app/",
    cleanOutputs: true,
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
      case "query":
        args.query = v;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = v;
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = v;
        takeNext();
        break;
      case "videosDir":
        args.videosDir = v;
        takeNext();
        break;
      case "outDir":
        args.outDir = v;
        takeNext();
        break;
      case "outputDir":
        args.outputDir = v;
        takeNext();
        break;
      case "wordList":
        args.wordList = v;
        takeNext();
        break;
      case "width":
        args.width = Number(v);
        takeNext();
        break;
      case "height":
        args.height = Number(v);
        takeNext();
        break;
      case "videoTop":
        args.videoTop = Number(v);
        takeNext();
        break;
      case "limit":
        args.limit = Number(v);
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "shuffle":
        args.shuffle = true;
        break;
      case "shuffleSeed":
        args.shuffleSeed = Number(v);
        takeNext();
        break;
      case "shuffleTop":
        args.shuffleTop = Number(v);
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
        args.longPolicy = v;
        takeNext();
        break;
      case "printTop":
        args.printTop = Number(v);
        takeNext();
        break;
      case "pick":
        args.pick = String(v);
        takeNext();
        break;
      case "replace":
        args.replace.push(String(v));
        takeNext();
        break;
      case "tailRepeat":
        args.tailRepeat = Number(v);
        takeNext();
        break;
      case "brandQrUrl":
        args.brandQrUrl = v;
        takeNext();
        break;
      case "cleanOutputs":
        args.cleanOutputs = true;
        break;
      case "keepOutputs":
        args.cleanOutputs = false;
        break;
      case "verbose":
        args.verbose = true;
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }
  return args;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function cleanOutputDirs({ outDir, outputDir, verbose }) {
  const targets = [
    path.resolve("out", "clips"),
    path.resolve(outDir),
    path.resolve(outputDir),
  ];
  const unique = Array.from(new Set(targets));

  for (const absPath of unique) {
    const rel = path.relative(process.cwd(), absPath);
    // Safety rail: only allow deleting directories under ./out
    if (rel.startsWith("..") || path.isAbsolute(rel) || !rel.startsWith("out")) {
      throw new Error(`Refusing to delete non-output path: ${absPath}`);
    }
    if (verbose) console.log(`Cleaning output dir: ${absPath}`);
    fs.rmSync(absPath, { recursive: true, force: true });
  }
}

function safeFilename(s) {
  return String(s)
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function spawnOrThrow(cmd, cmdArgs, verbose) {
  if (verbose) console.log([cmd, ...cmdArgs].join(" "));
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} failed`);
}

function readDurationSec(file) {
  const res = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return 0;
  const n = Number(String(res.stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function loadPngDataUri(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const b64 = fs.readFileSync(filePath).toString("base64");
  if (!b64) return "";
  return `data:image/png;base64,${b64}`;
}

async function buildQrDataUri(url, size) {
  if (!url) return "";
  if (!QRCode) QRCode = require("qrcode");
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: size,
  });
}

function svgEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function svgHighlight(text, match, color, caseInsensitive = false) {
  if (!match) return svgEscape(text);
  const src = String(text || "");
  const idx = caseInsensitive
    ? src.toLowerCase().indexOf(String(match).toLowerCase())
    : src.indexOf(match);
  if (idx < 0) return svgEscape(src);
  const a = svgEscape(src.slice(0, idx));
  const b = svgEscape(src.slice(idx, idx + String(match).length));
  const c = svgEscape(src.slice(idx + String(match).length));
  return `${a}<tspan fill="${color}">${b}</tspan>${c}`;
}

function isKanjiChar(ch) {
  return /[一-龯]/.test(ch);
}

function charUnits(ch) {
  if (/[A-Za-z0-9]/.test(ch)) return 0.6;
  if (isKanjiChar(ch)) return 1.0;
  if (/[ぁ-んァ-ン]/.test(ch)) return 1.0;
  return 0.8;
}

function measureUnits(text) {
  return Array.from(String(text || "")).reduce((sum, ch) => sum + charUnits(ch), 0);
}

function layoutTokensCentered(tokens, width, maxWidthPx, fontSizePx) {
  const tokenWidths = tokens.map((t) =>
    Math.max(fontSizePx * 0.8, measureUnits(t.surface) * fontSizePx),
  );
  const total = tokenWidths.reduce((s, w) => s + w, 0);
  const scale = Math.min(1, maxWidthPx / Math.max(1, total));
  const finalW = total * scale;
  let x = (width - finalW) / 2;
  return tokens.map((t, i) => {
    const w = tokenWidths[i] * scale;
    const centerX = x + w / 2;
    x += w;
    return { ...t, centerX };
  });
}

function toHiragana(text) {
  if (!wanakana) wanakana = require("wanakana");
  return wanakana.toHiragana(text);
}

function toRomaji(text) {
  if (!wanakana) wanakana = require("wanakana");
  return wanakana.toRomaji(text);
}

function isKanaContinuationSurface(surface) {
  return /^[んンっッゃゅょャュョぁぃぅぇぉァィゥェォー]$/.test(surface);
}

function joinRomajiTokens(tokens, romajiTokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const surface = tokens[i]?.surface_form || "";
    const piece = String(romajiTokens[i] || "").trim();
    if (!piece) continue;
    if (out.length === 0) {
      out.push(piece);
      continue;
    }
    if (isKanaContinuationSurface(surface)) {
      out[out.length - 1] += piece;
      continue;
    }
    out.push(piece);
  }
  return out.join(" ");
}

async function buildTokenizer() {
  if (!kuromoji) kuromoji = require("kuromoji");
  const dicPath = path.join("node_modules", "kuromoji", "dict");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
}

function normalizeMeaning(meaning) {
  if (!meaning) return "";
  return String(meaning).split(/[;,.]/)[0].trim();
}

function loadWordMeta(wordList, query) {
  if (!fs.existsSync(wordList)) return { reading: "", meaning: "" };
  const arr = JSON.parse(fs.readFileSync(wordList, "utf8"));
  const found = arr.find((x) => x.word === query);
  return {
    reading: found?.reading || "",
    meaning: normalizeMeaning(found?.meaning || ""),
  };
}

function renderSvgToPng({ svg, output }) {
  if (!resvg) resvg = require("@resvg/resvg-js");
  const pngData = new resvg.Resvg(svg).render().asPng();
  fs.writeFileSync(output, pngData);
}

function buildSegmentOverlaySvg({
  width,
  height,
  videoTop,
  query,
  queryReading,
  queryMeaning,
  jpTokens,
  furiTokens,
  romajiLine,
  enLine,
  logoDataUri,
  qrDataUri,
  highlightColor,
  queryRomaji,
}) {
  const s = height / 1920;
  const fontJP = "Hiragino Sans, Noto Sans CJK JP, Arial";
  const fontEN = "Helvetica Neue, Arial, sans-serif";
  const margin = width * 0.08;
  const videoHeight = (width * 9) / 16;
  const videoBottom = videoTop + videoHeight;

  const headerRectH = 430 * s;
  const headerRectY = Math.max(48 * s, videoTop - headerRectH - 116 * s);
  const labelY = headerRectY + 86 * s;
  const readingY = labelY + 82 * s;
  const kanjiY = readingY + 134 * s;
  const meaningY = kanjiY + 96 * s;

  const subtitleTop = videoBottom + 26 * s;
  const enY = subtitleTop + 42 * s;
  const furiY = enY + 56 * s;
  const jpY = furiY + 54 * s;
  const romajiY = jpY + 52 * s;

  const jpSize = 54 * s;
  const furiSize = 30 * s;
  const enSize = 40 * s;
  const romajiSize = 34 * s;
  const jpLayout = layoutTokensCentered(jpTokens, width, width - margin * 2, jpSize);
  const brandW = 356 * s;
  const brandH = 188 * s;
  const brandX = width - brandW - 24 * s;
  const brandY = 24 * s;
  const brandPad = 14 * s;
  const logoSize = 76 * s;
  const logoX = brandX + brandPad;
  const logoY = brandY + brandPad;
  const brandTitleX = logoX + logoSize + 12 * s;
  const brandTitleY = logoY + 31 * s;
  const brandSubY1 = brandTitleY + 25 * s;
  const brandSubY2 = brandSubY1 + 20 * s;
  const qrSize = 86 * s;
  const qrX = brandX + brandW - qrSize - brandPad;
  const qrY = brandY + brandPad;

  const jpText = jpLayout
    .map(
      (t) =>
        `<text x="${t.centerX}" y="${jpY}" text-anchor="middle" font-family="${fontJP}" font-size="${jpSize}" font-weight="800" fill="${t.color || "#ffffff"}" stroke="#000000" stroke-width="${3 * s}" paint-order="stroke fill">${svgEscape(t.surface)}</text>`,
    )
    .join("\n");
  const furiText = furiTokens
    .map((t, i) => {
      if (!t.text) return "";
      return `<text x="${jpLayout[i]?.centerX ?? width / 2}" y="${furiY}" text-anchor="middle" font-family="${fontJP}" font-size="${furiSize}" font-weight="700" fill="${t.color || "#ffffff"}" stroke="#000000" stroke-width="${2 * s}" paint-order="stroke fill">${svgEscape(t.text)}</text>`;
    })
    .join("\n");
  const romajiText = svgHighlight(romajiLine || "", queryRomaji || "", highlightColor, true);
  const enText = svgHighlight(enLine || "", queryMeaning || "", highlightColor, true);
  const brandBlock = `
  <rect x="${brandX}" y="${brandY}" width="${brandW}" height="${brandH}" rx="${14 * s}" ry="${14 * s}" fill="rgba(27,58,48,0.9)" stroke="rgba(198,233,212,0.85)" stroke-width="${2 * s}"/>
  ${logoDataUri ? `<image x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" href="${logoDataUri}" preserveAspectRatio="xMidYMid meet"/>` : ""}
  ${qrDataUri ? `<image x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" href="${qrDataUri}" preserveAspectRatio="xMidYMid meet"/>` : ""}
  <text x="${brandTitleX}" y="${brandTitleY}" text-anchor="start" font-family="${fontEN}" font-size="${30 * s}" font-weight="800" fill="#ffffff">Bundai</text>
  <text x="${brandTitleX}" y="${brandSubY1}" text-anchor="start" font-family="${fontEN}" font-size="${14 * s}" font-weight="700" fill="#d6efe2">Learn Japanese</text>
  <text x="${brandTitleX}" y="${brandSubY2}" text-anchor="start" font-family="${fontEN}" font-size="${14 * s}" font-weight="700" fill="#d6efe2">watching anime</text>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="transparent"/>
  <rect x="${width * 0.05}" y="${headerRectY}" width="${width * 0.9}" height="${headerRectH}" rx="${24 * s}" ry="${24 * s}" fill="rgba(198,233,212,0.92)"/>
  <text x="50%" y="${labelY}" text-anchor="middle" font-family="${fontEN}" font-size="${42 * s}" font-weight="800" fill="#1e3a34">Anime word of the day</text>
  <text x="50%" y="${readingY}" text-anchor="middle" font-family="${fontJP}" font-size="${54 * s}" font-weight="700" fill="#1e3a34">${svgEscape(queryReading)}</text>
  <text x="50%" y="${kanjiY}" text-anchor="middle" font-family="${fontJP}" font-size="${126 * s}" font-weight="800" fill="#ffd900" stroke="#000000" stroke-width="${4 * s}" paint-order="stroke fill">${svgEscape(query)}</text>
  <text x="50%" y="${meaningY}" text-anchor="middle" font-family="${fontEN}" font-size="${48 * s}" font-weight="800" fill="#1e3a34">${svgEscape(queryMeaning || "Japanese in context")}</text>
  ${brandBlock}
  <text x="50%" y="${enY}" text-anchor="middle" font-family="${fontEN}" font-size="${enSize}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="${2 * s}" paint-order="stroke fill">${enText}</text>
  ${furiText}
  ${jpText}
  <text x="50%" y="${romajiY}" text-anchor="middle" font-family="${fontEN}" font-size="${romajiSize}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="${2 * s}" paint-order="stroke fill">${romajiText}</text>
</svg>`;
}

function runFfmpegAppendTailVideo({
  mainInput,
  tailInput,
  output,
  width,
  height,
  tailDurationSec,
  tailRepeat,
  verbose,
}) {
  const repeats = Math.max(1, Math.floor(Number(tailRepeat) || 1));
  const args = ["-y", "-i", mainInput];
  for (let i = 0; i < repeats; i++) args.push("-i", tailInput);
  for (let i = 0; i < repeats; i++) {
    args.push(
      "-f",
      "lavfi",
      "-t",
      String(tailDurationSec),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
    );
  }

  const filterParts = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0]`,
    "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]",
  ];
  for (let i = 0; i < repeats; i++) {
    const videoInputIdx = i + 1;
    const audioInputIdx = repeats + 1 + i;
    const partIdx = i + 1;
    filterParts.push(
      `[${videoInputIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${partIdx}]`,
    );
    filterParts.push(
      `[${audioInputIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${partIdx}]`,
    );
  }

  const concatInputs = ["[v0][a0]"];
  for (let i = 0; i < repeats; i++) {
    const partIdx = i + 1;
    concatInputs.push(`[v${partIdx}][a${partIdx}]`);
  }
  filterParts.push(`${concatInputs.join("")}concat=n=${repeats + 1}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
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
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    output,
  );
  spawnOrThrow("ffmpeg", args, verbose);
}

function runFfmpegVerticalTimed({
  input,
  overlays,
  output,
  width,
  height,
  videoTop,
  durationSec,
  verbose,
}) {
  const args = ["-y", "-i", input];
  for (const o of overlays) args.push("-loop", "1", "-i", o.path);

  const filters = [
    `color=c=black:s=${width}x${height}[bg]`,
    `[0:v]scale=${width}:-2:flags=lanczos[clip]`,
    `[bg][clip]overlay=(W-w)/2:${videoTop}[v0]`,
    `[0:a]atrim=duration=${durationSec.toFixed(3)},asetpts=PTS-STARTPTS[a0]`,
  ];
  for (let i = 0; i < overlays.length; i++) {
    const inV = `v${i}`;
    const outV = `v${i + 1}`;
    const idx = i + 1;
    const t0 = overlays[i].start.toFixed(3);
    const t1 = overlays[i].end.toFixed(3);
    filters.push(
      `[${inV}][${idx}:v]overlay=0:0:format=auto:enable='between(t\\,${t0}\\,${t1})'[${outV}]`,
    );
  }
  const last = `v${overlays.length}`;
  filters.push(
    `[${last}]trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS[vout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[a0]",
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
  );

  spawnOrThrow("ffmpeg", args, verbose);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.query || !args.subsDir || !args.videosDir) {
    throw new Error(
      `Required: --query --subsDir [--videosDir]. Default videos dir: ${DEFAULT_VIDEOS_DIR}`,
    );
  }
  if (args.cleanOutputs) {
    cleanOutputDirs({ outDir: args.outDir, outputDir: args.outputDir, verbose: args.verbose });
  }
  ensureDir(args.outDir);
  ensureDir(args.outputDir);

  const querySlug = safeFilename(args.query);
  const extractArgs = [
    "scripts/extract-clips.js",
    "--query",
    args.query,
    "--subsDir",
    args.subsDir,
    "--videosDir",
    args.videosDir,
    "--outDir",
    args.outDir,
    "--limit",
    String(args.limit),
    "--prePadMs",
    String(args.prePadMs),
    "--postPadMs",
    String(args.postPadMs),
    "--maxClipMs",
    String(args.maxClipMs),
    "--longPolicy",
    String(args.longPolicy),
    "--concat",
    "--concatOnly",
    "--flatOut",
    "--manifest",
  ];
  if (args.enSubsDir) extractArgs.push("--enSubsDir", args.enSubsDir);
  if (args.rank) extractArgs.push("--rank");
  if (args.shuffle) extractArgs.push("--shuffle");
  if (Number.isFinite(args.shuffleSeed)) extractArgs.push("--shuffleSeed", String(args.shuffleSeed));
  if (Number.isFinite(args.shuffleTop) && args.shuffleTop > 0) {
    extractArgs.push("--shuffleTop", String(args.shuffleTop));
  }
  if (args.printTop > 0) extractArgs.push("--printTop", String(args.printTop));
  if (args.pick) extractArgs.push("--pick", args.pick);
  for (const r of args.replace) extractArgs.push("--replace", r);
  if (args.verbose) extractArgs.push("--verbose");

  console.log("Step 1/2: Extracting clean stitched clip...");
  spawnOrThrow("node", extractArgs, args.verbose);

  const stitched = path.join(args.outDir, `${querySlug}.mp4`);
  const manifestPath = path.join(args.outDir, `manifest.${querySlug}.json`);
  if (!fs.existsSync(stitched)) throw new Error(`Missing stitched clip: ${stitched}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const clips = manifest.clips || [];
  if (clips.length === 0) throw new Error("Manifest has no clips.");

  const tokenizer = await buildTokenizer();
  const meta = loadWordMeta(args.wordList, args.query);
  const queryReading =
    meta.reading || toHiragana(tokenizer.tokenize(args.query).map((t) => t.reading || t.surface_form).join(""));
  const queryMeaning = meta.meaning || "";
  const queryRomaji = toRomaji(queryReading);
  const highlightColor = "#ffd900";
  const logoDataUri = loadPngDataUri(path.resolve("source_content", "logo.png"));
  const qrDataUri = await buildQrDataUri(args.brandQrUrl, 192);

  let t = 0;
  const overlays = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dur = readDurationSec(c.output) || Math.max(0.2, (c.clipEndMs - c.clipStartMs) / 1000);
    const start = t;
    const end = t + dur;
    t = end;

    const jpText = String(c.sentenceText || "").replace(/\s+/g, "");
    const tokens = tokenizer.tokenize(jpText);
    const jpTokens = tokens.map((x) => {
      const surface = x.surface_form || "";
      return {
        surface,
        color: surface.includes(args.query) ? highlightColor : "#ffffff",
      };
    });
    const furiTokens = tokens.map((x) => {
      const surface = x.surface_form || "";
      const reading = toHiragana(x.reading || surface);
      const hasKanji = Array.from(surface).some(isKanjiChar);
      return {
        surface,
        text: hasKanji ? reading : "",
        color: hasKanji && reading.includes(queryReading) ? highlightColor : "#ffffff",
      };
    });
    const romajiTokens = tokens.map((x) =>
      toRomaji(toHiragana(x.reading || x.surface_form || "")),
    );
    const romaji = joinRomajiTokens(tokens, romajiTokens);

    const svg = buildSegmentOverlaySvg({
      width: args.width,
      height: args.height,
      videoTop: args.videoTop,
      query: args.query,
      queryReading,
      queryMeaning,
      jpTokens,
      furiTokens,
      romajiLine: romaji,
      enLine: c.enText || "",
      logoDataUri,
      qrDataUri,
      highlightColor,
      queryRomaji,
    });
    const png = path.join(args.outputDir, `.tmp_short_overlay_${querySlug}_${i + 1}.png`);
    renderSvgToPng({ svg, output: png });
    overlays.push({ path: png, start, end });
  }

  const outPath = path.join(args.outputDir, `${querySlug}_clean_shorts.mp4`);
  console.log("Step 2/2: Rendering vertical clean short...");
  runFfmpegVerticalTimed({
    input: stitched,
    overlays,
    output: outPath,
    width: args.width,
    height: args.height,
    videoTop: args.videoTop,
    durationSec: t,
    verbose: args.verbose,
  });

  const cardVideoPath = path.resolve("source_content", "card.mp4");
  if (fs.existsSync(cardVideoPath)) {
    const tailDurationSec = readDurationSec(cardVideoPath);
    const tailRepeat = Math.max(1, Math.floor(Number(args.tailRepeat) || 1));
    if (tailDurationSec > 0) {
      const finalOut = outPath.replace(/\.mp4$/i, "_with_card.mp4");
      runFfmpegAppendTailVideo({
        mainInput: outPath,
        tailInput: cardVideoPath,
        output: finalOut,
        width: args.width,
        height: args.height,
        tailDurationSec,
        tailRepeat,
        verbose: args.verbose,
      });
      fs.unlinkSync(outPath);
      fs.renameSync(finalOut, outPath);
      console.log(
        `Appended video end card (source_content/card.mp4) x${tailRepeat} to: ${outPath}`,
      );
    }
  }

  for (const o of overlays) {
    try {
      fs.unlinkSync(o.path);
    } catch {
      // ignore
    }
  }

  console.log("");
  console.log(`Done: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
