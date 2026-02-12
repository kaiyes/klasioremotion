#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let kuromoji = null;
let wanakana = null;

const DEFAULTS = {
  episode: "s2e6",
  start: "00:17:31.000",
  end: "00:22:04.000",
  videosDir: path.join("source_content", "shingeki_no_kyojin", "videos"),
  jpSubsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "japanese"),
  enSubsDir: path.join("source_content", "shingeki_no_kyojin", "subs", "english_embedded"),
  subOffsetsFile: path.join("source_content", "shingeki_no_kyojin", "subs", "sub-offsets.json"),
  outDir: path.join("out", "compare"),
  whisperBin: "whisper",
  whisperModel: "medium",
  whisperLanguage: "Japanese",
  noOffsets: false,
  skipWhisper: false,
  skipProvided: false,
  skipBurn: false,
  verbose: false,
};

const VIDEO_EXTS = [".mkv", ".mp4", ".webm", ".mov"];
const SUB_EXTS = [".ass", ".srt"];

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [k, maybeV] = raw.slice(2).split("=");
    const v = maybeV ?? argv[i + 1];
    const takeNext = () => {
      if (maybeV == null) i++;
    };

    switch (k) {
      case "episode":
        args.episode = String(v || "").trim();
        takeNext();
        break;
      case "start":
        args.start = String(v || "").trim();
        takeNext();
        break;
      case "end":
        args.end = String(v || "").trim();
        takeNext();
        break;
      case "videosDir":
        args.videosDir = String(v || "").trim();
        takeNext();
        break;
      case "jpSubsDir":
        args.jpSubsDir = String(v || "").trim();
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = String(v || "").trim();
        takeNext();
        break;
      case "subOffsetsFile":
        args.subOffsetsFile = String(v || "").trim();
        takeNext();
        break;
      case "noOffsets":
        args.noOffsets = true;
        break;
      case "outDir":
        args.outDir = String(v || "").trim();
        takeNext();
        break;
      case "whisperBin":
        args.whisperBin = String(v || "").trim();
        takeNext();
        break;
      case "whisperModel":
        args.whisperModel = String(v || "").trim();
        takeNext();
        break;
      case "whisperLanguage":
        args.whisperLanguage = String(v || "").trim();
        takeNext();
        break;
      case "skipWhisper":
        args.skipWhisper = true;
        break;
      case "skipProvided":
        args.skipProvided = true;
        break;
      case "skipBurn":
        args.skipBurn = true;
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

  if (!args.episode) throw new Error("--episode is required");
  if (!args.start) throw new Error("--start is required");
  if (!args.end) throw new Error("--end is required");
  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/compare-subtitle-sources.js [options]

Default run (no flags) does:
  episode=s2e6, start=00:17:31.000, end=00:22:04.000
  creates clip + Whisper subtitles + provided subtitles + both burned comparison videos

Options:
  --episode <token>         Episode token, e.g. s2e6 (default: ${DEFAULTS.episode})
  --start <HH:MM:SS.mmm>    Clip start time (default: ${DEFAULTS.start})
  --end <HH:MM:SS.mmm>      Clip end time (default: ${DEFAULTS.end})
  --videosDir <dir>         Video directory (default: ${DEFAULTS.videosDir})
  --jpSubsDir <dir>         Japanese subtitle directory (default: ${DEFAULTS.jpSubsDir})
  --enSubsDir <dir>         English subtitle directory (default: ${DEFAULTS.enSubsDir})
  --subOffsetsFile <file>   Offsets JSON (default: ${DEFAULTS.subOffsetsFile})
  --noOffsets               Disable subtitle offsets
  --outDir <dir>            Output root (default: ${DEFAULTS.outDir})
  --whisperBin <cmd>        Whisper executable (default: ${DEFAULTS.whisperBin})
  --whisperModel <name>     Whisper model (default: ${DEFAULTS.whisperModel})
  --whisperLanguage <name>  Whisper language (default: ${DEFAULTS.whisperLanguage})
  --skipWhisper             Skip Whisper JP/EN generation
  --skipProvided            Skip provided JP/EN extraction
  --skipBurn                Skip burning comparison videos
  --verbose                 Print detailed command logs

Outputs:
  clip.mp4
  whisper-jp.srt / whisper-en.srt / whisper-jp-furi.srt
  provided-jp.srt / provided-en.srt / provided-jp-furi.srt
  compare-whisper.mp4
  compare-provided.mp4

Notes:
  If ffmpeg lacks the subtitles filter on this machine, the script auto-falls back
  to muxed subtitle tracks (softsubs) instead of hard-burned captions.
`.trim() + "\n",
  );
  process.exit(code);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function runOrThrow(cmd, cmdArgs, verbose) {
  if (verbose) console.log([cmd, ...cmdArgs].join(" "));
  const res = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });
  if (res.status !== 0) {
    if (!verbose) {
      const tail = `${res.stderr || res.stdout || ""}`
        .trim()
        .split(/\r?\n/g)
        .slice(-20)
        .join("\n");
      if (tail) console.error(tail);
    }
    throw new Error(`${cmd} failed (exit ${res.status})`);
  }
}

function runCapture(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });
}

function normalizeEpisodeToken(value) {
  const m = String(value || "").trim().match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function findEpisodeFile(dir, episodeToken, exts) {
  if (!dir || !fs.existsSync(dir)) return null;
  const token = normalizeEpisodeToken(episodeToken);
  if (!token) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!exts.includes(ext)) continue;
    const normalized = normalizeEpisodeToken(e.name);
    if (normalized === token) return path.join(dir, e.name);
  }
  return null;
}

function parseHmsToMs(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) throw new Error(`Bad time format "${raw}". Use HH:MM:SS.mmm`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const mmm = Number(String(m[4] || "0").padEnd(3, "0").slice(0, 3));
  return ((hh * 60 + mm) * 60 + ss) * 1000 + mmm;
}

function msToSrtTime(msRaw) {
  const ms = Math.max(0, Math.round(Number(msRaw) || 0));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(mmm).padStart(3, "0")}`;
}

function msToFfmpegTime(msRaw) {
  const ms = Math.max(0, Math.round(Number(msRaw) || 0));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

function stripBom(s) {
  return String(s || "").replace(/^\uFEFF/, "");
}

function cleanSubtitleText(t) {
  return String(t ?? "")
    .replace(/\\N/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>\n]*>/g, "")
    .replace(/\r/g, "")
    .trim();
}

function timeSrtToMs(ts) {
  const m = String(ts).trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function timeAssToMs(ts) {
  const m = String(ts).trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) throw new Error(`Bad ASS timestamp: ${ts}`);
  const base = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
  const frac = m[4];
  if (frac.length === 1) return base + Number(frac) * 100;
  if (frac.length === 2) return base + Number(frac) * 10;
  return base + Number(frac);
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
    const m = lines[timeLineIdx].match(
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

function parseSubtitleFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".srt") return parseSrtFile(filePath);
  if (ext === ".ass") return parseAssFile(filePath);
  return [];
}

function writeSrtFile(filePath, items) {
  let idx = 1;
  const body = items
    .map((it) => {
      const text = String(it.text || "").replace(/\r/g, "").trim();
      return `${idx++}\n${msToSrtTime(it.startMs)} --> ${msToSrtTime(it.endMs)}\n${text}\n`;
    })
    .join("\n");
  fs.writeFileSync(filePath, body);
}

function srtHasCues(filePath) {
  try {
    const items = parseSrtFile(filePath);
    return items.length > 0;
  } catch {
    return false;
  }
}

function clipSubtitleItems(items, clipStartMs, clipEndMs) {
  const out = [];
  for (const it of items) {
    const s = Math.max(it.startMs, clipStartMs);
    const e = Math.min(it.endMs, clipEndMs);
    if (e <= s) continue;
    const relStart = s - clipStartMs;
    const relEnd = e - clipStartMs;
    if (relEnd - relStart < 80) continue;
    out.push({
      startMs: relStart,
      endMs: relEnd,
      text: it.text,
    });
  }
  return out;
}

function applyOffset(items, offsetMs) {
  if (!offsetMs) return items;
  return items.map((it) => ({
    ...it,
    startMs: Math.max(0, it.startMs + offsetMs),
    endMs: Math.max(0, it.endMs + offsetMs),
  }));
}

function normalizeSeasonToken(value) {
  const m = String(value || "").match(/s\s*0*(\d{1,2})/i);
  if (!m) return null;
  return `s${Number(m[1])}`;
}

function normalizeOffsets(raw) {
  const out = {
    defaultMs: 0,
    jpDefaultMs: null,
    enDefaultMs: null,
    byEpisode: new Map(),
    bySeason: new Map(),
    jpByEpisode: new Map(),
    jpBySeason: new Map(),
    enByEpisode: new Map(),
    enBySeason: new Map(),
  };
  if (!raw || typeof raw !== "object") return out;

  const pushEpisode = (map, k, v) => {
    const ep = normalizeEpisodeToken(k);
    const n = Number(v);
    if (!ep || !Number.isFinite(n)) return;
    map.set(ep, n);
  };
  const pushSeason = (map, k, v) => {
    const s = normalizeSeasonToken(k);
    const n = Number(v);
    if (!s || !Number.isFinite(n)) return;
    map.set(s, n);
  };

  if (Number.isFinite(Number(raw.default))) out.defaultMs = Number(raw.default);
  if (Number.isFinite(Number(raw.defaultMs))) out.defaultMs = Number(raw.defaultMs);
  if (Number.isFinite(Number(raw.jpDefaultMs))) out.jpDefaultMs = Number(raw.jpDefaultMs);
  if (Number.isFinite(Number(raw.enDefaultMs))) out.enDefaultMs = Number(raw.enDefaultMs);

  const epBuckets = [
    [out.byEpisode, raw.byEpisode],
    [out.byEpisode, raw.episodes],
    [out.jpByEpisode, raw.jpByEpisode],
    [out.jpByEpisode, raw.jpEpisodes],
    [out.enByEpisode, raw.enByEpisode],
    [out.enByEpisode, raw.enEpisodes],
  ];
  for (const [map, obj] of epBuckets) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) pushEpisode(map, k, v);
  }

  const seasonBuckets = [
    [out.bySeason, raw.bySeason],
    [out.bySeason, raw.seasons],
    [out.jpBySeason, raw.jpBySeason],
    [out.jpBySeason, raw.jpSeasons],
    [out.enBySeason, raw.enBySeason],
    [out.enBySeason, raw.enSeasons],
  ];
  for (const [map, obj] of seasonBuckets) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) pushSeason(map, k, v);
  }

  for (const [k, v] of Object.entries(raw)) {
    if (
      [
        "default",
        "defaultMs",
        "jpDefaultMs",
        "enDefaultMs",
        "byEpisode",
        "episodes",
        "jpByEpisode",
        "jpEpisodes",
        "enByEpisode",
        "enEpisodes",
        "bySeason",
        "seasons",
        "jpBySeason",
        "jpSeasons",
        "enBySeason",
        "enSeasons",
      ].includes(k)
    ) {
      continue;
    }
    if (normalizeEpisodeToken(k)) pushEpisode(out.byEpisode, k, v);
    else if (normalizeSeasonToken(k)) pushSeason(out.bySeason, k, v);
  }

  return out;
}

function getOffsetMs(offsets, episodeToken, track) {
  if (!offsets) return 0;
  const seasonToken = normalizeSeasonToken(episodeToken);
  const epToken = normalizeEpisodeToken(episodeToken);
  if (!seasonToken || !epToken) return offsets.defaultMs || 0;

  const trackEp = track === "en" ? offsets.enByEpisode : offsets.jpByEpisode;
  const trackSeason = track === "en" ? offsets.enBySeason : offsets.jpBySeason;
  const trackDefault = track === "en" ? offsets.enDefaultMs : offsets.jpDefaultMs;

  if (trackEp.has(epToken)) return trackEp.get(epToken);
  if (offsets.byEpisode.has(epToken)) return offsets.byEpisode.get(epToken);
  if (trackSeason.has(seasonToken)) return trackSeason.get(seasonToken);
  if (offsets.bySeason.has(seasonToken)) return offsets.bySeason.get(seasonToken);
  if (Number.isFinite(trackDefault)) return trackDefault;
  return offsets.defaultMs || 0;
}

function loadTokenizer() {
  if (!kuromoji || !wanakana) {
    kuromoji = require("kuromoji");
    wanakana = require("wanakana");
  }
  const dicPath = path.join("node_modules", "kuromoji", "dict");
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function isKanjiChar(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

function buildFuriganaLine(tokenizer, text) {
  const source = String(text || "").replace(/\n/g, " ").trim();
  if (!source) return "";
  const hasKanji = Array.from(source).some(isKanjiChar);
  if (!hasKanji) return "";

  const tokens = tokenizer.tokenize(source);
  const reading = tokens
    .map((t) => t.reading || t.surface_form || "")
    .map((r) => wanakana.toHiragana(r))
    .join("");
  return reading.trim();
}

async function addFuriganaToSrt(inputSrt, outputSrt) {
  const items = parseSrtFile(inputSrt);
  const tokenizer = await loadTokenizer();
  const out = items.map((it) => {
    const raw = String(it.text || "").replace(/\s+/g, " ").trim();
    const furi = buildFuriganaLine(tokenizer, raw);
    const text = furi ? `${furi}\n${raw}` : raw;
    return { ...it, text };
  });
  writeSrtFile(outputSrt, out);
}

function ffSubPath(filePath) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/ /g, "\\ ");
}

function runWhisperTask({
  clipPath,
  outDir,
  whisperBin,
  whisperModel,
  whisperLanguage,
  task,
  outputPath,
  verbose,
}) {
  const baseSrt = path.join(outDir, `${path.basename(clipPath, path.extname(clipPath))}.srt`);
  if (fs.existsSync(baseSrt)) fs.rmSync(baseSrt, { force: true });

  runOrThrow(
    whisperBin,
    [
      clipPath,
      "--model",
      whisperModel,
      "--language",
      whisperLanguage,
      "--task",
      task,
      "--word_timestamps",
      "True",
      "--output_format",
      "srt",
      "--output_dir",
      outDir,
    ],
    verbose,
  );

  if (!fs.existsSync(baseSrt)) {
    throw new Error(`Whisper did not generate SRT at ${baseSrt}`);
  }
  fs.renameSync(baseSrt, outputPath);
}

function burnDualSubtitles({
  inputVideo,
  jpSrt,
  enSrt,
  outputVideo,
  verbose,
}) {
  const jpEsc = ffSubPath(jpSrt);
  const enEsc = ffSubPath(enSrt);
  const filter = [
    `subtitles=filename='${jpEsc}':force_style='FontName=Hiragino Sans,FontSize=34,Alignment=2,MarginV=120,Outline=2,Shadow=0,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&'`,
    `subtitles=filename='${enEsc}':force_style='FontName=Arial,FontSize=28,Alignment=2,MarginV=52,Outline=2,Shadow=0,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&'`,
  ].join(",");

  runOrThrow(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputVideo,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "copy",
      outputVideo,
    ],
    verbose,
  );
}

let hasSubtitleFilterCache = null;
function hasSubtitleFilter() {
  if (hasSubtitleFilterCache != null) return hasSubtitleFilterCache;
  const res = runCapture("ffmpeg", ["-filters"]);
  const text = `${res.stdout || ""}\n${res.stderr || ""}`;
  hasSubtitleFilterCache = /\bsubtitles\b/.test(text);
  return hasSubtitleFilterCache;
}

function muxDualSubtitleTracks({
  inputVideo,
  jpSrt,
  enSrt,
  outputVideo,
  verbose,
}) {
  runOrThrow(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputVideo,
      "-i",
      jpSrt,
      "-i",
      enSrt,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-map",
      "1:0",
      "-map",
      "2:0",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      "language=jpn",
      "-metadata:s:s:1",
      "language=eng",
      outputVideo,
    ],
    verbose,
  );
}

function buildComparisonVideo(opts) {
  if (hasSubtitleFilter()) {
    burnDualSubtitles(opts);
    return "burned";
  }
  muxDualSubtitleTracks(opts);
  return "softsubs";
}

async function main() {
  const args = parseArgs(process.argv);
  const episode = normalizeEpisodeToken(args.episode);
  if (!episode) throw new Error(`Invalid --episode "${args.episode}"`);

  const clipStartMs = parseHmsToMs(args.start);
  const clipEndMs = parseHmsToMs(args.end);
  if (clipEndMs <= clipStartMs) {
    throw new Error(`--end must be greater than --start`);
  }

  const videoFile = findEpisodeFile(args.videosDir, episode, VIDEO_EXTS);
  if (!videoFile) throw new Error(`Video not found for ${episode} in ${args.videosDir}`);

  const jpFile = findEpisodeFile(args.jpSubsDir, episode, SUB_EXTS);
  const enFile = findEpisodeFile(args.enSubsDir, episode, SUB_EXTS);
  if (!jpFile && !args.skipProvided) {
    throw new Error(`JP subtitle not found for ${episode} in ${args.jpSubsDir}`);
  }
  if (!enFile && !args.skipProvided) {
    throw new Error(`EN subtitle not found for ${episode} in ${args.enSubsDir}`);
  }

  const startTag = args.start.replace(/[^\d]/g, "").slice(0, 9);
  const endTag = args.end.replace(/[^\d]/g, "").slice(0, 9);
  const workDir = path.resolve(args.outDir, `${episode}_${startTag}_${endTag}`);
  ensureDir(workDir);

  const clipPath = path.join(workDir, "clip.mp4");
  const clipDurationMs = clipEndMs - clipStartMs;
  const clipDurationFfmpeg = msToFfmpegTime(clipDurationMs);
  runOrThrow(
    "ffmpeg",
    [
      "-y",
      "-ss",
      msToFfmpegTime(clipStartMs),
      "-i",
      videoFile,
      "-t",
      clipDurationFfmpeg,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      clipPath,
    ],
    args.verbose,
  );

  const manifest = {
    createdAt: new Date().toISOString(),
    episode,
    start: args.start,
    end: args.end,
    videoFile: path.resolve(videoFile),
    jpSubtitleFile: jpFile ? path.resolve(jpFile) : null,
    enSubtitleFile: enFile ? path.resolve(enFile) : null,
    offsets: { jpMs: 0, enMs: 0 },
    outputs: {
      clip: clipPath,
      whisper: null,
      provided: null,
    },
    renderMode: null,
  };

  if (!args.skipWhisper) {
    const whisperJp = path.join(workDir, "whisper-jp.srt");
    const whisperEn = path.join(workDir, "whisper-en.srt");
    const whisperJpFuri = path.join(workDir, "whisper-jp-furi.srt");

    runWhisperTask({
      clipPath,
      outDir: workDir,
      whisperBin: args.whisperBin,
      whisperModel: args.whisperModel,
      whisperLanguage: args.whisperLanguage,
      task: "transcribe",
      outputPath: whisperJp,
      verbose: args.verbose,
    });

    runWhisperTask({
      clipPath,
      outDir: workDir,
      whisperBin: args.whisperBin,
      whisperModel: args.whisperModel,
      whisperLanguage: args.whisperLanguage,
      task: "translate",
      outputPath: whisperEn,
      verbose: args.verbose,
    });

    const jpOk = srtHasCues(whisperJp);
    const enOk = srtHasCues(whisperEn);
    if (!jpOk || !enOk) {
      console.warn(
        `Skipping Whisper comparison: empty cues (jp=${jpOk ? "ok" : "empty"}, en=${enOk ? "ok" : "empty"})`,
      );
    } else {
      await addFuriganaToSrt(whisperJp, whisperJpFuri);
      manifest.outputs.whisper = {
        jp: whisperJp,
        jpFurigana: whisperJpFuri,
        en: whisperEn,
        video: path.join(workDir, "compare-whisper.mp4"),
      };
    }
  }

  if (!args.skipProvided && jpFile && enFile) {
    const offsets = !args.noOffsets && fs.existsSync(args.subOffsetsFile)
      ? normalizeOffsets(JSON.parse(fs.readFileSync(args.subOffsetsFile, "utf8")))
      : null;
    const jpOffsetMs = getOffsetMs(offsets, episode, "jp");
    const enOffsetMs = getOffsetMs(offsets, episode, "en");
    manifest.offsets.jpMs = jpOffsetMs;
    manifest.offsets.enMs = enOffsetMs;

    const jpItems = clipSubtitleItems(
      applyOffset(parseSubtitleFile(jpFile), jpOffsetMs),
      clipStartMs,
      clipEndMs,
    );
    const enItems = clipSubtitleItems(
      applyOffset(parseSubtitleFile(enFile), enOffsetMs),
      clipStartMs,
      clipEndMs,
    );

    const providedJp = path.join(workDir, "provided-jp.srt");
    const providedEn = path.join(workDir, "provided-en.srt");
    const providedJpFuri = path.join(workDir, "provided-jp-furi.srt");
    writeSrtFile(providedJp, jpItems);
    writeSrtFile(providedEn, enItems);
    await addFuriganaToSrt(providedJp, providedJpFuri);

    manifest.outputs.provided = {
      jp: providedJp,
      jpFurigana: providedJpFuri,
      en: providedEn,
      video: path.join(workDir, "compare-provided.mp4"),
    };
  }

  if (!args.skipBurn) {
    if (manifest.outputs.whisper) {
      manifest.renderMode = buildComparisonVideo({
        inputVideo: clipPath,
        jpSrt: manifest.outputs.whisper.jpFurigana,
        enSrt: manifest.outputs.whisper.en,
        outputVideo: manifest.outputs.whisper.video,
        verbose: args.verbose,
      });
    }
    if (manifest.outputs.provided) {
      manifest.renderMode = buildComparisonVideo({
        inputVideo: clipPath,
        jpSrt: manifest.outputs.provided.jpFurigana,
        enSrt: manifest.outputs.provided.en,
        outputVideo: manifest.outputs.provided.video,
        verbose: args.verbose,
      });
    }
  }

  const manifestPath = path.join(workDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log("");
  console.log(`Done: ${workDir}`);
  console.log(`- clip: ${clipPath}`);
  if (manifest.outputs.whisper) {
    console.log(`- whisper compare: ${manifest.outputs.whisper.video}`);
  }
  if (manifest.outputs.provided) {
    console.log(`- provided compare: ${manifest.outputs.provided.video}`);
  }
  if (manifest.renderMode === "softsubs") {
    console.log("- note: ffmpeg subtitles filter is unavailable, so subtitles were muxed as tracks");
  }
  console.log(`- manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
