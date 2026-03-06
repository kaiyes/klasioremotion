#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let kuromoji;
let wanakana;

const ROOT = process.cwd();
const DEFAULT_VIDEOS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "videos",
);
const DEFAULT_EN_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_JP_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const OUTPUT_DIR = path.join("out", "range-shorts");

function parseArgs(argv) {
  const args = {
    videoFile: null,
    startTime: null,
    endTime: null,
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : null,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : null,
    jpSubsDir: fs.existsSync(DEFAULT_JP_SUBS_DIR) ? DEFAULT_JP_SUBS_DIR : null,
    outputDir: OUTPUT_DIR,
    width: 720,
    height: 1280,
    videoTop: 500,
    fps: 20,
    gpu: "auto",
    gpuDevice: "/dev/dri/renderD128",
    draft: false,
    listVideos: false,
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
      case "videoFile":
      case "v":
        args.videoFile = String(v || "").trim();
        takeNext();
        break;
      case "startTime":
      case "start":
      case "s":
        args.startTime = String(v || "").trim();
        takeNext();
        break;
      case "endTime":
      case "end":
      case "e":
        args.endTime = String(v || "").trim();
        takeNext();
        break;
      case "videosDir":
        args.videosDir = path.resolve(String(v || "").trim());
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = path.resolve(String(v || "").trim());
        takeNext();
        break;
      case "jpSubsDir":
        args.jpSubsDir = path.resolve(String(v || "").trim());
        takeNext();
        break;
      case "outputDir":
      case "o":
        args.outputDir = path.resolve(String(v || "").trim());
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
      case "fps":
        args.fps = Number(v);
        takeNext();
        break;
      case "gpu":
        args.gpu = String(v || "").trim().toLowerCase();
        takeNext();
        break;
      case "gpuDevice":
        args.gpuDevice = String(v || "").trim();
        takeNext();
        break;
      case "draft":
        args.draft = true;
        break;
      case "listVideos":
        args.listVideos = true;
        break;
      case "verbose":
        args.verbose = true;
        break;
      case "help":
      case "h":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/make-manual-clip.js --videoFile <file> --startTime <MM:SS|HH:MM:SS> --endTime <MM:SS|HH:MM:SS> [options]

Options:
  --videoFile <file>          Video file (absolute or relative)
  --startTime <time>          Start time (MM:SS or HH:MM:SS)
  --endTime <time>            End time (MM:SS or HH:MM:SS)
  --videosDir <dir>           Video lookup dir (default: ${DEFAULT_VIDEOS_DIR})
  --enSubsDir <dir>           English subtitle dir (default: ${DEFAULT_EN_SUBS_DIR})
  --jpSubsDir <dir>           Japanese subtitle dir (default: ${DEFAULT_JP_SUBS_DIR})
  --outputDir <dir>           Output dir (default: ${OUTPUT_DIR})
  --width <n>                 Width (default: 720)
  --height <n>                Height (default: 1280)
  --videoTop <n>              Top offset for video (default: 500)
  --fps <n>                   Output fps for fast pipeline (default: 20)
  --gpu <mode>                auto|cpu|none|nvidia|qsv|vaapi (default: auto)
  --gpuDevice <path>          VAAPI device path (default: /dev/dri/renderD128)
  --draft                     Extra-fast preview mode (540x960 @ 12fps)
  --listVideos                List available videos
  --verbose                   Verbose logs
  --help, -h                  Show this help

Notes:
  - Max duration: 180 seconds.
  - Fast pipeline: trim first, then vertical render.
  - GPU mode auto-detects hardware encoder and falls back to CPU.
  - Constant top-right logo.
  - Japanese subtitle line is yellow.
`.trim() + "\n",
  );
  process.exit(code);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeFilename(s) {
  return String(s || "")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function parseTimeString(timeStr) {
  const parts = String(timeStr || "")
    .trim()
    .split(":")
    .map((x) => Number(x));
  if (parts.length === 2) {
    if (!Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return NaN;
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    if (
      !Number.isFinite(parts[0]) ||
      !Number.isFinite(parts[1]) ||
      !Number.isFinite(parts[2])
    ) {
      return NaN;
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return NaN;
}

function formatClock(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTag(seconds) {
  return formatClock(seconds).replace(/:/g, "-");
}

function run(cmd, args, verbose = false) {
  if (verbose) console.log([cmd, ...args].join(" "));
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
  });
  if (res.status !== 0) {
    const msg = String(res.stderr || res.stdout || "").trim();
    throw new Error(`${cmd} failed${msg ? `\n${msg}` : ""}`);
  }
  return String(res.stdout || "");
}

function runOrNull(cmd, args, verbose = false) {
  if (verbose) console.log([cmd, ...args].join(" "));
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
  });
  if (res.status !== 0) return null;
  return String(res.stdout || "");
}

function ffmpegHasEncoder(encoderName) {
  const out = runOrNull("ffmpeg", ["-hide_banner", "-encoders"], false);
  if (!out) return false;
  return out.includes(` ${encoderName} `);
}

function canUseEncoder(encoderName, gpuDevice, verbose = false) {
  const common = [
    "-hide_banner",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x90:d=0.1",
    "-frames:v",
    "1",
    "-an",
  ];

  if (encoderName === "h264_vaapi") {
    const dev = String(gpuDevice || "").trim();
    if (!dev) return false;
    if (!fs.existsSync(dev)) return false;
    const out = runOrNull(
      "ffmpeg",
      [
        ...common,
        "-vaapi_device",
        dev,
        "-vf",
        "format=nv12,hwupload",
        "-c:v",
        "h264_vaapi",
        "-f",
        "null",
        "-",
      ],
      verbose,
    );
    return out !== null;
  }

  const out = runOrNull(
    "ffmpeg",
    [...common, "-c:v", encoderName, "-f", "null", "-"],
    verbose,
  );
  return out !== null;
}

function resolveEncoderMode(gpuMode, gpuDevice, verbose = false) {
  const requested = String(gpuMode || "auto").trim().toLowerCase();
  const cpu = {
    mode: "cpu",
    codec: "libx264",
    label: "CPU (libx264)",
    gpuDevice: null,
    fallbackReason: "",
  };

  const aliases = {
    auto: "auto",
    cpu: "cpu",
    none: "cpu",
    off: "cpu",
    nvidia: "h264_nvenc",
    nvenc: "h264_nvenc",
    qsv: "h264_qsv",
    vaapi: "h264_vaapi",
  };
  const normalized = aliases[requested];
  if (!normalized) {
    throw new Error(`Invalid --gpu mode "${gpuMode}". Use auto|cpu|none|nvidia|qsv|vaapi`);
  }

  if (normalized === "cpu") return cpu;

  const pickIfWorking = (encoder) => {
    if (!ffmpegHasEncoder(encoder)) return null;
    if (!canUseEncoder(encoder, gpuDevice, false)) return null;
    return {
      mode: encoder,
      codec: encoder,
      label: `GPU (${encoder})`,
      gpuDevice: encoder === "h264_vaapi" ? String(gpuDevice || "").trim() : null,
      fallbackReason: "",
    };
  };

  if (normalized !== "auto") {
    const selected = pickIfWorking(normalized);
    if (!selected) {
      throw new Error(
        `Requested GPU mode "${requested}" is not available/usable on this machine. Try --gpu auto or --gpu cpu.`,
      );
    }
    return selected;
  }

  const order = ["h264_nvenc", "h264_qsv", "h264_vaapi"];
  for (const encoder of order) {
    const selected = pickIfWorking(encoder);
    if (selected) return selected;
  }

  const fallback = { ...cpu };
  fallback.fallbackReason = "No working GPU H.264 encoder detected, using CPU.";
  if (verbose) {
    // Optional diagnostic probe for logs.
    for (const encoder of order) {
      const has = ffmpegHasEncoder(encoder);
      const ok = has ? canUseEncoder(encoder, gpuDevice, false) : false;
      console.log(`[gpu:auto] ${encoder} hasEncoder=${has} usable=${ok}`);
    }
  }
  return fallback;
}

function appendVideoEncodeArgs({
  ffmpegArgs,
  encoderConfig,
  stage,
}) {
  const encoder = encoderConfig?.codec || "libx264";
  if (encoder === "h264_nvenc") {
    const cq = stage === "trim" ? "31" : "27";
    ffmpegArgs.push(
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p1",
      "-rc",
      "vbr",
      "-cq",
      cq,
      "-b:v",
      "0",
    );
    return;
  }

  if (encoder === "h264_qsv") {
    const q = stage === "trim" ? "32" : "28";
    ffmpegArgs.push(
      "-c:v",
      "h264_qsv",
      "-preset",
      "veryfast",
      "-global_quality",
      q,
    );
    return;
  }

  if (encoder === "h264_vaapi") {
    const q = stage === "trim" ? "32" : "28";
    ffmpegArgs.push(
      "-c:v",
      "h264_vaapi",
      "-qp",
      q,
    );
    return;
  }

  // CPU baseline.
  ffmpegArgs.push(
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    stage === "trim" ? "28" : "24",
  );
}

function getVideoDurationSec(videoPath) {
  const out = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    false,
  );
  const n = Number(out.trim());
  return Number.isFinite(n) ? n : 0;
}

function listVideos(videosDir) {
  const roots = [
    videosDir ? path.resolve(videosDir) : null,
    path.resolve(ROOT, "source_content"),
    path.resolve(ROOT, "out", "source_content"),
  ].filter(Boolean);

  const exts = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm"]);
  const seen = new Set();
  const out = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const abs = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!ent.isFile()) continue;
        if (!exts.has(path.extname(ent.name).toLowerCase())) continue;
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        if (seen.has(rel)) continue;
        seen.add(rel);
        out.push(rel);
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  console.log(`Found ${out.length} video(s):`);
  for (const v of out) console.log(`  ${v}`);
}

function findFileRecursive(rootDir, predicate) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile() && predicate(abs)) {
        return abs;
      }
    }
  }
  return null;
}

function resolveVideoPath(videoFile, videosDir) {
  const input = String(videoFile || "").trim();
  if (!input) throw new Error("--videoFile is required");

  const candidates = [];
  if (path.isAbsolute(input)) candidates.push(input);
  candidates.push(path.resolve(ROOT, input));
  if (videosDir) candidates.push(path.resolve(videosDir, input));

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  const base = path.basename(input);
  const roots = [videosDir, path.join(ROOT, "source_content"), path.join(ROOT, "out", "source_content")]
    .filter(Boolean)
    .map((p) => path.resolve(p));

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const found = findFileRecursive(root, (abs) => path.basename(abs) === base);
    if (found) return found;
  }

  throw new Error(`Video not found: ${videoFile}`);
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function timeAssToMs(ts) {
  const m = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) throw new Error(`Bad ASS timestamp: ${ts}`);
  const base = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
  const frac = m[4];
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
    .replace(/<[^>\n]*>/g, " ")
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
    const startMs = timeAssToMs(parts[1].trim());
    const endMs = timeAssToMs(parts[2].trim());
    const text = cleanSubtitleText(parts.slice(9).join(","));
    if (!text) continue;
    items.push({ startMs, endMs, text });
  }
  return items;
}

function parseSubsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ass") return parseAssFile(filePath);
  if (ext === ".srt") return parseSrtFile(filePath);
  return [];
}

function findSubtitleFile(subsDir, videoPath) {
  if (!subsDir) return null;
  const dir = path.resolve(subsDir);
  if (!fs.existsSync(dir)) return null;

  const base = path.basename(videoPath, path.extname(videoPath));
  const preferred = [
    path.join(dir, `${base}.ass`),
    path.join(dir, `${base}.srt`),
  ];
  for (const p of preferred) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }

  const files = fs.readdirSync(dir);
  const hit = files.find((f) => path.basename(f, path.extname(f)) === base);
  return hit ? path.join(dir, hit) : null;
}

function collectCuesInRange(cues, startMs, endMs) {
  const out = [];
  for (const cue of cues || []) {
    const s = Number(cue.startMs);
    const e = Number(cue.endMs);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    if (e <= startMs || s >= endMs) continue;
    out.push({
      startMs: Math.max(s, startMs),
      endMs: Math.min(e, endMs),
      text: String(cue.text || "").trim(),
      absStartMs: s,
      absEndMs: e,
    });
  }
  return out;
}

function findBestEnText(jpCue, enCues) {
  if (!jpCue || !Array.isArray(enCues) || enCues.length === 0) return "";

  let best = null;
  let bestOverlap = 0;
  for (const en of enCues) {
    const overlap = Math.max(
      0,
      Math.min(jpCue.endMs, en.endMs) - Math.max(jpCue.startMs, en.startMs),
    );
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = en;
    }
  }
  if (best && bestOverlap > 0) return String(best.text || "").trim();

  const center = (jpCue.startMs + jpCue.endMs) / 2;
  let nearest = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const en of enCues) {
    const c = (en.startMs + en.endMs) / 2;
    const d = Math.abs(c - center);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = en;
    }
  }
  return nearestDist <= 2500 ? String(nearest?.text || "").trim() : "";
}

function charUnits(ch) {
  if (/[A-Za-z0-9]/.test(ch)) return 0.6;
  if (/[一-龯ぁ-んァ-ン]/.test(ch)) return 1.0;
  return 0.8;
}

function measureUnits(text) {
  return Array.from(String(text || "")).reduce((s, ch) => s + charUnits(ch), 0);
}

function wrapTextByUnits(text, maxUnits, maxLines, kind = "en") {
  const src = String(text || "").trim();
  if (!src) return [];

  const lines = [];
  if (kind === "en") {
    const words = src.split(/\s+/).filter(Boolean);
    let line = "";
    let units = 0;
    for (const w of words) {
      const add = line ? ` ${w}` : w;
      const addUnits = measureUnits(add);
      if (line && units + addUnits > maxUnits) {
        lines.push(line.trim());
        line = w;
        units = measureUnits(w);
      } else {
        line += add;
        units += addUnits;
      }
    }
    if (line) lines.push(line.trim());
  } else {
    let line = "";
    let units = 0;
    for (const ch of Array.from(src)) {
      const u = charUnits(ch);
      if (line && units + u > maxUnits) {
        lines.push(line);
        line = ch;
        units = u;
      } else {
        line += ch;
        units += u;
      }
    }
    if (line) lines.push(line);
  }

  if (lines.length <= maxLines) return lines;
  return lines.slice(0, maxLines);
}

async function buildTokenizer() {
  if (!kuromoji) kuromoji = require("kuromoji");
  const dicPath = path.join("node_modules", "kuromoji", "dict");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
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

function assEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function toAssTime(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const cs = Math.round(n / 10);
  const hh = Math.floor(cs / 360000);
  const mm = Math.floor((cs % 360000) / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

function ffmpegFilterPath(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\'");
}

function buildAssText({
  cues,
  clipStartMs,
  enCues,
  tokenizer,
  width,
  height,
  videoTop,
}) {
  const s = height / 1920;
  const enSize = Math.max(24, Math.round(44 * s));
  const jpSize = Math.max(34, Math.round(60 * s));
  const roSize = Math.max(20, Math.round(34 * s));
  const xMid = Math.round(width / 2);
  const videoHeight = Math.round((width * 9) / 16);
  const videoBottom = videoTop + videoHeight;
  const enY = Math.min(height - 180, Math.round(videoBottom + 70 * s));
  const jpY = Math.min(height - 110, Math.round(enY + 120 * s));
  const roY = Math.min(height - 50, Math.round(jpY + 84 * s));

  const lines = [];
  lines.push("[Script Info]");
  lines.push("ScriptType: v4.00+");
  lines.push("WrapStyle: 2");
  lines.push(`PlayResX: ${width}`);
  lines.push(`PlayResY: ${height}`);
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push(
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
  );
  lines.push(
    `Style: EN,Arial,${enSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,0,5,10,10,10,1`,
  );
  lines.push(
    `Style: JP,Noto Sans CJK JP,${jpSize},&H0000D7FF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,0,5,10,10,10,1`,
  );
  lines.push(
    `Style: RO,Arial,${roSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,2,0,5,10,10,10,1`,
  );
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text");

  for (const cue of cues) {
    const relStart = Math.max(0, cue.startMs - clipStartMs);
    const relEnd = Math.max(relStart + 40, cue.endMs - clipStartMs);
    const start = toAssTime(relStart);
    const end = toAssTime(relEnd);

    const jpTextRaw = String(cue.text || "").replace(/\s+/g, "").trim();
    if (!jpTextRaw) continue;

    const tokens = tokenizer.tokenize(jpTextRaw);
    const romajiTokens = tokens.map((t) => toRomaji(toHiragana(t.reading || t.surface_form || "")));
    const romaji = joinRomajiTokens(tokens, romajiTokens);
    const enTextRaw = findBestEnText(cue, enCues);

    const enText = wrapTextByUnits(enTextRaw, 34, 2, "en").join(" ");
    const jpText = wrapTextByUnits(jpTextRaw, 22, 1, "jp").join("");
    const roText = wrapTextByUnits(romaji, 34, 2, "en").join(" ");

    if (enText) {
      lines.push(
        `Dialogue: 0,${start},${end},EN,,0,0,0,,{\\pos(${xMid},${enY})}${assEscape(enText)}`,
      );
    }
    if (jpText) {
      lines.push(
        `Dialogue: 1,${start},${end},JP,,0,0,0,,{\\pos(${xMid},${jpY})}${assEscape(jpText)}`,
      );
    }
    if (roText) {
      lines.push(
        `Dialogue: 2,${start},${end},RO,,0,0,0,,{\\pos(${xMid},${roY})}${assEscape(roText)}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function extractTrimFast({
  input,
  startSec,
  durationSec,
  fps,
  output,
  encoderConfig,
  verbose,
}) {
  const args = ["-y"];
  if (encoderConfig?.codec === "h264_vaapi" && encoderConfig?.gpuDevice) {
    args.push("-vaapi_device", encoderConfig.gpuDevice);
  }
  args.push(
    "-ss",
    String(startSec),
    "-t",
    String(durationSec),
    "-i",
    input,
  );

  let trimFilter = `fps=${Math.max(1, Number(fps) || 20)},format=yuv420p`;
  if (encoderConfig?.codec === "h264_vaapi") {
    trimFilter = `fps=${Math.max(1, Number(fps) || 20)},format=nv12,hwupload`;
  }
  args.push("-vf", trimFilter);

  appendVideoEncodeArgs({ ffmpegArgs: args, encoderConfig, stage: "trim" });
  args.push(
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    output,
  );
  run("ffmpeg", args, verbose);
}

function renderVertical({
  input,
  output,
  assFile,
  logoPath,
  width,
  height,
  videoTop,
  fps,
  encoderConfig,
  verbose,
}) {
  const args = ["-y"];
  if (encoderConfig?.codec === "h264_vaapi" && encoderConfig?.gpuDevice) {
    args.push("-vaapi_device", encoderConfig.gpuDevice);
  }
  args.push("-i", input);
  const hasLogo = logoPath && fs.existsSync(logoPath);
  if (hasLogo) args.push("-loop", "1", "-i", logoPath);

  const assFilter = ffmpegFilterPath(path.resolve(assFile));
  const filter = [];
  filter.push(
    `[0:v]scale=${width}:-2:flags=bicubic,pad=${width}:${height}:(ow-iw)/2:${videoTop}:black,subtitles='${assFilter}'[vbase]`,
  );

  if (hasLogo) {
    const s = height / 1920;
    const logoSize = Math.round(60 * s);
    const margin = Math.round(18 * s);
    filter.push(`[1:v]scale=${logoSize}:${logoSize}[logo]`);
    filter.push(`[vbase][logo]overlay=W-w-${margin}:${margin}:shortest=1:eof_action=pass[vout]`);
  }

  let mappedLabel = hasLogo ? "[vout]" : "[vbase]";
  if (encoderConfig?.codec === "h264_vaapi") {
    const uploadIn = hasLogo ? "vout" : "vbase";
    filter.push(`[${uploadIn}]format=nv12,hwupload[vhw]`);
    mappedLabel = "[vhw]";
  }

  args.push(
    "-filter_complex",
    filter.join(";"),
    "-map",
    mappedLabel,
    "-map",
    "0:a?",
    "-r",
    String(Math.max(1, Number(fps) || 20)),
  );
  appendVideoEncodeArgs({ ffmpegArgs: args, encoderConfig, stage: "render" });
  if (encoderConfig?.codec !== "h264_vaapi") {
    args.push("-pix_fmt", "yuv420p");
  }
  args.push(
    "-c:a",
    "copy",
    "-shortest",
    "-movflags",
    "+faststart",
    output,
  );

  run("ffmpeg", args, verbose);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.listVideos) {
    listVideos(args.videosDir);
    return;
  }

  if (args.draft) {
    args.width = 540;
    args.height = 960;
    args.videoTop = 370;
    args.fps = 12;
  }

  let encoderConfig = resolveEncoderMode(args.gpu, args.gpuDevice, args.verbose);
  if (encoderConfig.fallbackReason) {
    console.log(encoderConfig.fallbackReason);
  }
  console.log(`Encoder: ${encoderConfig.label}`);

  if (!args.videoFile) throw new Error("--videoFile is required");
  if (!args.startTime) throw new Error("--startTime is required");
  if (!args.endTime) throw new Error("--endTime is required");

  const startSec = parseTimeString(args.startTime);
  const endSec = parseTimeString(args.endTime);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new Error("Time must be MM:SS or HH:MM:SS");
  }
  if (endSec <= startSec) throw new Error("End time must be after start time");

  const durationSec = endSec - startSec;
  if (durationSec > 180) {
    throw new Error(`Clip duration ${durationSec.toFixed(2)}s exceeds 180s limit`);
  }

  const videoPath = resolveVideoPath(args.videoFile, args.videosDir);
  const videoDuration = getVideoDurationSec(videoPath);
  if (videoDuration > 0 && endSec > videoDuration + 0.01) {
    throw new Error(
      `End time ${formatClock(endSec)} exceeds source duration ${formatClock(videoDuration)}`,
    );
  }

  const jpSubsFile = findSubtitleFile(args.jpSubsDir, videoPath);
  if (!jpSubsFile) {
    throw new Error(
      `Japanese subtitles not found for ${path.basename(videoPath)} in ${args.jpSubsDir || "(none)"}`,
    );
  }
  const enSubsFile = findSubtitleFile(args.enSubsDir, videoPath);

  const clipStartMs = Math.round(startSec * 1000);
  const clipEndMs = Math.round(endSec * 1000);

  const jpAll = parseSubsFile(jpSubsFile);
  const enAll = enSubsFile ? parseSubsFile(enSubsFile) : [];
  const jpCues = collectCuesInRange(jpAll, clipStartMs, clipEndMs);
  const enCues = collectCuesInRange(enAll, clipStartMs, clipEndMs);

  if (jpCues.length === 0) {
    throw new Error(`No JP subtitle lines found in range ${formatClock(startSec)} -> ${formatClock(endSec)}`);
  }

  ensureDir(args.outputDir);
  const base = safeFilename(path.basename(videoPath, path.extname(videoPath)));
  const outName = `${base}_${formatTag(startSec)}-${formatTag(endSec)}.mp4`;
  const outputPath = path.resolve(args.outputDir, outName);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "range-short-"));
  const trimPath = path.join(tmpDir, "trim.mp4");
  const assPath = path.join(tmpDir, "overlay.ass");

  try {
    const tokenizer = await buildTokenizer();
    const assText = buildAssText({
      cues: jpCues,
      clipStartMs,
      enCues,
      tokenizer,
      width: args.width,
      height: args.height,
      videoTop: args.videoTop,
    });
    fs.writeFileSync(assPath, assText, "utf8");

    const runPipeline = (encCfg) => {
      console.log("Step 1/2: Fast trim...");
      extractTrimFast({
        input: videoPath,
        startSec,
        durationSec,
        fps: args.fps,
        output: trimPath,
        encoderConfig: encCfg,
        verbose: args.verbose,
      });

      console.log("Step 2/2: Render vertical with subtitles...");
      renderVertical({
        input: trimPath,
        output: outputPath,
        assFile: assPath,
        logoPath: path.resolve(ROOT, "source_content", "logo.png"),
        width: args.width,
        height: args.height,
        videoTop: args.videoTop,
        fps: args.fps,
        encoderConfig: encCfg,
        verbose: args.verbose,
      });
    };

    try {
      runPipeline(encoderConfig);
    } catch (err) {
      const autoMode = String(args.gpu || "").trim().toLowerCase() === "auto";
      if (!autoMode || encoderConfig.codec === "libx264") {
        throw err;
      }
      console.warn(`GPU pipeline failed (${encoderConfig.codec}), retrying on CPU...`);
      encoderConfig = resolveEncoderMode("cpu", args.gpuDevice, args.verbose);
      console.log(`Encoder: ${encoderConfig.label}`);
      runPipeline(encoderConfig);
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log(`Source: ${videoPath}`);
  console.log(`Range: ${formatClock(startSec)} -> ${formatClock(endSec)} (${durationSec.toFixed(3)}s)`);
  console.log(`JP subs: ${jpSubsFile}`);
  console.log(`EN subs: ${enSubsFile || "(not found)"}`);
  console.log(`JP cues: ${jpCues.length}`);
  console.log(`Encoder used: ${encoderConfig.label}`);
  console.log(`Output: ${outputPath}`);
  console.log(`OUTPUT_FILE: ${outputPath}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
