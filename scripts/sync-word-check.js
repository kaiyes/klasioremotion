#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
let resvg;

const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_EN_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_EN_SUBS_DIR_FALLBACK = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);
const RESOLVED_DEFAULT_EN_SUBS_DIR = fs.existsSync(DEFAULT_EN_SUBS_DIR)
  ? DEFAULT_EN_SUBS_DIR
  : DEFAULT_EN_SUBS_DIR_FALLBACK;
const DEFAULT_OUT_DIR = path.join("dissfiles", "sync-check");

function parseArgs(argv) {
  const args = {
    episode: null,
    query: null,
    offsets: [0],
    videosDir: DEFAULT_VIDEOS_DIR,
    subsDir: DEFAULT_SUBS_DIR,
    enSubsDir: fs.existsSync(RESOLVED_DEFAULT_EN_SUBS_DIR) ? RESOLVED_DEFAULT_EN_SUBS_DIR : null,
    outDir: DEFAULT_OUT_DIR,
    prePadMs: 500,
    postPadMs: 500,
    maxClipMs: 5000,
    longPolicy: "shrink",
    offsetEnglish: true,
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
      case "episode":
        args.episode = value;
        takeNext();
        break;
      case "query":
        args.query = value;
        takeNext();
        break;
      case "offsets":
        args.offsets = String(value || "")
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isFinite(n));
        takeNext();
        break;
      case "videosDir":
        args.videosDir = value;
        takeNext();
        break;
      case "subsDir":
        args.subsDir = value;
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = value;
        takeNext();
        break;
      case "outDir":
        args.outDir = value;
        takeNext();
        break;
      case "prePadMs":
        args.prePadMs = Number(value);
        takeNext();
        break;
      case "postPadMs":
        args.postPadMs = Number(value);
        takeNext();
        break;
      case "maxClipMs":
        args.maxClipMs = Number(value);
        takeNext();
        break;
      case "longPolicy":
        args.longPolicy = value;
        takeNext();
        break;
      case "offsetEnglish":
        args.offsetEnglish = true;
        break;
      case "noOffsetEnglish":
        args.offsetEnglish = false;
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
        throw new Error(`Unknown arg --${key}`);
    }
  }

  if (!args.episode || !args.query) {
    printHelpAndExit(1);
  }
  if (args.offsets.length === 0) {
    throw new Error("No valid offsets provided.");
  }
  if (!["skip", "shrink"].includes(args.longPolicy)) {
    throw new Error("--longPolicy must be skip or shrink");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/sync-word-check.js --episode s4e30 --query "何だろう" [options]

What it does:
  Creates comparison clips and burns NORMAL timestamped JP+EN subtitles over the video,
  so you can visually confirm sync for different offsets.

Options:
  --offsets <csv>         Offsets to compare in ms (default: 0)
  --videosDir <dir>       Videos dir (default: ${DEFAULT_VIDEOS_DIR})
  --subsDir <dir>         JP subs dir (default: ${DEFAULT_SUBS_DIR})
  --enSubsDir <dir>       EN subs dir (default: ${DEFAULT_EN_SUBS_DIR} if present)
  --outDir <dir>          Output root (default: ${DEFAULT_OUT_DIR})
  --prePadMs <n>          Clip pad before matched line (default: 500)
  --postPadMs <n>         Clip pad after matched line (default: 500)
  --maxClipMs <n>         Max clip duration (default: 5000)
  --longPolicy <v>        skip|shrink (default: shrink)
  --offsetEnglish         Apply the same offset to EN subs (default: on)
  --noOffsetEnglish       Keep EN subs unshifted
  --dryRun                Preview only
  --verbose               Print extra details

Example:
  npm run sync-word-check -- --episode s4e30 --query "言う" --offsets 0,5100 --prePadMs 30000 --postPadMs 30000 --maxClipMs 60000
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function normalizeEpisodeToken(s) {
  const m = String(s || "").match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  return `s${Number(m[1])}e${Number(m[2])}`;
}

function safeFilename(s) {
  return String(s || "")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function listFilesRecursive(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  out.sort();
  return out;
}

function findEpisodeFile(root, episodeToken, exts) {
  const files = listFilesRecursive(root).filter((f) => exts.includes(path.extname(f).toLowerCase()));
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    if (normalizeEpisodeToken(base) === episodeToken) return f;
  }
  return null;
}

function runChecked(cmd, args, dryRun) {
  if (dryRun) {
    console.log(`[dryRun] ${cmd} ${args.join(" ")}`);
    return;
  }
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function commandOutput(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function ffmpegHasFilter(filterName) {
  const out = commandOutput("ffmpeg", ["-hide_banner", "-filters"]);
  const hay = `${out.stdout}\n${out.stderr}`;
  return new RegExp(`\\b${filterName}\\b`).test(hay);
}

function stripBom(s) {
  return s.replace(/^\uFEFF/, "");
}

function timeSrtToMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${ts}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function msToSrt(msRaw) {
  const ms = Math.max(0, Math.round(msRaw));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(
    2,
    "0",
  )},${String(mmm).padStart(3, "0")}`;
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
  const normalized = String(t || "")
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

  return lines.join(" ");
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
    const text = cleanSubtitleText(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;
    items.push({
      startMs: timeSrtToMs(m[1]),
      endMs: timeSrtToMs(m[2]),
      text,
    });
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
  if (ext === ".ass") return parseAssFile(filePath);
  if (ext === ".srt") return parseSrtFile(filePath);
  throw new Error(`Unsupported subtitle extension: ${ext}`);
}

function findFirstMatch(items, query) {
  return items.find((it) => it.text.includes(query)) || null;
}

function computeClipRange(match, offsetMs, prePadMs, postPadMs, maxClipMs, longPolicy) {
  const matchStart = match.startMs + offsetMs;
  const matchEnd = match.endMs + offsetMs;
  let startMs = Math.max(0, matchStart - prePadMs);
  let endMs = Math.max(startMs + 1, matchEnd + postPadMs);

  const dur = endMs - startMs;
  if (dur > maxClipMs) {
    if (longPolicy === "skip") {
      throw new Error(`Computed clip ${dur}ms exceeds --maxClipMs ${maxClipMs} with longPolicy=skip`);
    }
    const center = (matchStart + matchEnd) / 2;
    startMs = Math.max(0, Math.round(center - maxClipMs / 2));
    endMs = startMs + maxClipMs;
  }
  return { startMs, endMs, matchStart, matchEnd };
}

function buildRelativeItems(items, clipStartMs, clipEndMs, offsetMs) {
  const out = [];
  for (const it of items) {
    const absStart = it.startMs + offsetMs;
    const absEnd = it.endMs + offsetMs;
    if (absEnd <= clipStartMs || absStart >= clipEndMs) continue;
    const startMs = Math.max(0, absStart - clipStartMs);
    const endMs = Math.max(
      startMs + 40,
      Math.min(clipEndMs, absEnd) - clipStartMs,
    );
    out.push({ startMs, endMs, text: it.text });
  }
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return out;
}

function writeSrtFile(items, outFile) {
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    lines.push(String(i + 1));
    lines.push(`${msToSrt(it.startMs)} --> ${msToSrt(it.endMs)}`);
    lines.push(it.text);
    lines.push("");
  }
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");
}

function msToClock(msRaw) {
  const ms = Math.max(0, Math.round(msRaw));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(
    2,
    "0",
  )}.${String(mmm).padStart(3, "0")}`;
}

function escapeForSubtitleFilter(filePath) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/'/g, "\\'");
}

function buildSubtitleFilter(jpSrtPath, enSrtPath) {
  const jpEsc = escapeForSubtitleFilter(jpSrtPath);
  const jpStyle = "FontName=Arial,FontSize=34,Outline=2,Shadow=0,Alignment=2,MarginV=48";
  let filter = `subtitles=filename='${jpEsc}':force_style='${jpStyle}'`;

  if (enSrtPath) {
    const enEsc = escapeForSubtitleFilter(enSrtPath);
    const enStyle = "FontName=Arial,FontSize=30,Outline=2,Shadow=0,Alignment=2,MarginV=112";
    filter += `,subtitles=filename='${enEsc}':force_style='${enStyle}'`;
  }
  return filter;
}

function getVideoDimensions(file) {
  const out = commandOutput("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    file,
  ]);
  if (out.status !== 0) return { width: 1920, height: 1080 };
  const [w, h] = out.stdout.trim().split("x").map(Number);
  if (!w || !h) return { width: 1920, height: 1080 };
  return { width: w, height: h };
}

function escapeSvgText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapEnglish(text, maxChars = 56) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if ((cur + " " + w).length <= maxChars) {
      cur += ` ${w}`;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function wrapJapanese(text, maxChars = 24) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const lines = [];
  for (let i = 0; i < t.length; i += maxChars) {
    lines.push(t.slice(i, i + maxChars));
    if (lines.length >= 2) break;
  }
  return lines;
}

function svgMultilineText({ lines, x, y, family, size, weight, fill, stroke, strokeWidth, lineStep }) {
  if (!lines || lines.length === 0) return "";
  const first = escapeSvgText(lines[0]);
  const rest = lines
    .slice(1)
    .map((l) => `<tspan x="${x}" dy="${lineStep}">${escapeSvgText(l)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill">${first}${rest}</text>`;
}

function renderSvgToPng({ svg, output }) {
  if (!resvg) {
    resvg = require("@resvg/resvg-js");
  }
  const instance = new resvg.Resvg(svg);
  const pngData = instance.render().asPng();
  fs.writeFileSync(output, pngData);
}

function buildSubtitleOverlaySvg({ width, height, jpText, enText }) {
  const jpLines = wrapJapanese(jpText, Math.max(18, Math.floor(width / 75)));
  const enLines = wrapEnglish(enText, Math.max(36, Math.floor(width / 28)));
  const jpSize = Math.max(30, Math.round(width * 0.030));
  const enSize = Math.max(24, Math.round(width * 0.022));
  const enY = Math.round(height * 0.82);
  const jpY = Math.round(height * 0.90);
  const lineStepEn = Math.round(enSize * 1.2);
  const lineStepJp = Math.round(jpSize * 1.15);

  const enNode = svgMultilineText({
    lines: enLines,
    x: "50%",
    y: enY,
    family: "Arial, Helvetica, sans-serif",
    size: enSize,
    weight: 700,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: Math.max(2, Math.round(width * 0.0017)),
    lineStep: lineStepEn,
  });
  const jpNode = svgMultilineText({
    lines: jpLines,
    x: "50%",
    y: jpY,
    family: "Hiragino Sans, Arial, sans-serif",
    size: jpSize,
    weight: 700,
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidth: Math.max(3, Math.round(width * 0.0022)),
    lineStep: lineStepJp,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)"/>
${enNode}
${jpNode}
</svg>`;
}

function uniqueTextJoin(values) {
  const out = [];
  for (const v of values) {
    const t = String(v || "").trim();
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.join(" / ");
}

function buildRelativeSubtitleIntervals(jpRel, enRel, clipDurationMs) {
  const MIN_INTERVAL_MS = 200;
  const points = new Set([0, clipDurationMs]);
  for (const it of jpRel) {
    points.add(Math.max(0, Math.min(clipDurationMs, it.startMs)));
    points.add(Math.max(0, Math.min(clipDurationMs, it.endMs)));
  }
  for (const it of enRel) {
    points.add(Math.max(0, Math.min(clipDurationMs, it.startMs)));
    points.add(Math.max(0, Math.min(clipDurationMs, it.endMs)));
  }

  const times = Array.from(points)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const raw = [];
  for (let i = 0; i < times.length - 1; i++) {
    const startMs = times[i];
    const endMs = times[i + 1];
    if (endMs - startMs < 40) continue;
    const probe = (startMs + endMs) / 2;
    const jpText = uniqueTextJoin(
      jpRel.filter((x) => x.startMs <= probe && probe < x.endMs).map((x) => x.text),
    );
    const enText = uniqueTextJoin(
      enRel.filter((x) => x.startMs <= probe && probe < x.endMs).map((x) => x.text),
    );
    raw.push({ startMs, endMs, jpText, enText });
  }

  if (raw.length === 0) {
    return [{ startMs: 0, endMs: clipDurationMs, jpText: "", enText: "" }];
  }

  const merged = [];
  for (const cur of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.jpText === cur.jpText &&
      prev.enText === cur.enText &&
      Math.abs(prev.endMs - cur.startMs) <= 1
    ) {
      prev.endMs = cur.endMs;
    } else {
      merged.push({ ...cur });
    }
  }

  // Very short cuts can create empty/corrupt micro-segments in ffmpeg concat.
  // Fold short intervals into the previous interval for robust rendering.
  if (merged.length <= 1) return merged;
  const stable = [];
  for (const cur of merged) {
    if (stable.length === 0) {
      stable.push({ ...cur });
      continue;
    }
    if (cur.endMs - cur.startMs < MIN_INTERVAL_MS) {
      stable[stable.length - 1].endMs = cur.endMs;
      continue;
    }
    stable.push({ ...cur });
  }
  return stable;
}

function runFfmpegSegmentOverlay({ videoFile, startMs, durationMs, overlayPng, output, dryRun }) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    (startMs / 1000).toFixed(3),
    "-t",
    (durationMs / 1000).toFixed(3),
    "-i",
    videoFile,
    "-loop",
    "1",
    "-i",
    overlayPng,
    "-filter_complex",
    "[1:v][0:v]scale2ref=w=iw:h=ih[ovr][base];[base][ovr]overlay=0:0:format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-sn",
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
  runChecked("ffmpeg", args, dryRun);
}

function runFfmpegConcat({ segmentFiles, output, workDir, dryRun }) {
  const listFile = path.join(workDir, ".tmp_segments_concat.txt");
  const lines = segmentFiles.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n", "utf8");

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-sn",
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
  runChecked("ffmpeg", args, dryRun);

  return listFile;
}

function renderTimedSubtitleOverlayClip({
  videoFile,
  rangeStartMs,
  clipDurationMs,
  jpRel,
  enRel,
  bucketDir,
  outPath,
  verbose,
  dryRun,
}) {
  const { width, height } = getVideoDimensions(videoFile);
  const intervals = buildRelativeSubtitleIntervals(jpRel, enRel, clipDurationMs);
  const overlaysDir = path.join(bucketDir, ".tmp_overlays");
  const segmentsDir = path.join(bucketDir, ".tmp_segments");
  fs.mkdirSync(overlaysDir, { recursive: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  const overlayCache = new Map();
  const segmentFiles = [];
  for (let i = 0; i < intervals.length; i++) {
    const it = intervals[i];
    const key = `${it.jpText}\n${it.enText}`;
    let overlayPng = overlayCache.get(key);
    if (!overlayPng) {
      overlayPng = path.join(overlaysDir, `ovr_${overlayCache.size}.png`);
      const svg = buildSubtitleOverlaySvg({
        width,
        height,
        jpText: it.jpText,
        enText: it.enText,
      });
      if (!dryRun) renderSvgToPng({ svg, output: overlayPng });
      overlayCache.set(key, overlayPng);
    }

    const segOut = path.join(segmentsDir, `seg_${String(i).padStart(3, "0")}.mp4`);
    const absStartMs = rangeStartMs + it.startMs;
    const segDurationMs = it.endMs - it.startMs;
    if (verbose) {
      console.log(
        `   segment ${String(i + 1).padStart(2, "0")}/${String(intervals.length).padStart(
          2,
          "0",
        )} ${msToClock(absStartMs)} +${(segDurationMs / 1000).toFixed(3)}s`,
      );
    }
    runFfmpegSegmentOverlay({
      videoFile,
      startMs: absStartMs,
      durationMs: segDurationMs,
      overlayPng,
      output: segOut,
      dryRun,
    });
    segmentFiles.push(segOut);
  }

  const concatList = runFfmpegConcat({
    segmentFiles,
    output: outPath,
    workDir: bucketDir,
    dryRun,
  });

  if (!verbose && !dryRun) {
    for (const f of segmentFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(concatList);
    } catch {
      // ignore
    }
    try {
      fs.rmSync(overlaysDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(segmentsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const ep = normalizeEpisodeToken(args.episode);
  if (!ep) throw new Error("--episode must look like s4e30");

  const videoFile = findEpisodeFile(args.videosDir, ep, [".mkv", ".mp4", ".mov", ".webm"]);
  const jpSubFile = findEpisodeFile(args.subsDir, ep, [".ass", ".srt"]);
  const enSubFile = args.enSubsDir
    ? findEpisodeFile(args.enSubsDir, ep, [".ass", ".srt"])
    : null;
  if (!videoFile) throw new Error(`Video not found for ${ep} in ${args.videosDir}`);
  if (!jpSubFile) throw new Error(`JP subtitle not found for ${ep} in ${args.subsDir}`);

  const jpItems = parseSubsFile(jpSubFile);
  const enItems = enSubFile ? parseSubsFile(enSubFile) : null;
  const match = findFirstMatch(jpItems, args.query);
  if (!match) {
    throw new Error(`Query "${args.query}" not found in ${jpSubFile}`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  console.log(`Episode: ${ep}`);
  console.log(`Query:   ${args.query}`);
  console.log(`Video:   ${videoFile}`);
  console.log(`JP Subs: ${jpSubFile}`);
  console.log(`EN Subs: ${enSubFile || "(none)"}`);
  console.log(`Offsets: ${args.offsets.join(", ")}`);
  const hasSubtitleFilter = ffmpegHasFilter("subtitles");
  const renderMode = hasSubtitleFilter ? "ffmpeg-subtitles-filter" : "segment-overlay-fallback";
  console.log(`Render:  ${renderMode}`);
  console.log("");

  for (const offset of args.offsets) {
    const bucket = `o${offset >= 0 ? `+${offset}` : offset}`;
    const bucketDir = path.join(args.outDir, ep, bucket);
    fs.mkdirSync(bucketDir, { recursive: true });

    const range = computeClipRange(
      match,
      offset,
      args.prePadMs,
      args.postPadMs,
      args.maxClipMs,
      args.longPolicy,
    );

    const clipDurationMs = range.endMs - range.startMs;
    const jpRel = buildRelativeItems(jpItems, range.startMs, range.endMs, offset);
    const enOffset = args.offsetEnglish ? offset : 0;
    const enRel = enItems ? buildRelativeItems(enItems, range.startMs, range.endMs, enOffset) : [];

    const outName = `${safeFilename(args.query)}_${ep}_${bucket}.mp4`;
    const outPath = path.join(bucketDir, outName);

    console.log(`== Offset ${offset}ms -> ${outPath}`);
    console.log(
      `   range: ${msToClock(range.startMs)} -> ${msToClock(range.endMs)} (${(
        clipDurationMs / 1000
      ).toFixed(3)}s)`,
    );
    if (args.verbose) {
      console.log(`   JP lines in clip: ${jpRel.length}`);
      console.log(`   EN lines in clip: ${enRel.length}`);
    }

    if (hasSubtitleFilter) {
      const jpSrtTmp = path.join(bucketDir, `.tmp_${ep}_${bucket}_jp.srt`);
      const enSrtTmp = path.join(bucketDir, `.tmp_${ep}_${bucket}_en.srt`);
      writeSrtFile(jpRel, jpSrtTmp);
      if (enRel.length > 0) writeSrtFile(enRel, enSrtTmp);
      const useEn = enRel.length > 0 ? enSrtTmp : null;
      const vf = buildSubtitleFilter(jpSrtTmp, useEn);

      const ffArgs = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        (range.startMs / 1000).toFixed(3),
        "-t",
        (clipDurationMs / 1000).toFixed(3),
        "-i",
        videoFile,
        "-vf",
        vf,
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
        outPath,
      ];
      runChecked("ffmpeg", ffArgs, args.dryRun);

      if (!args.verbose && !args.dryRun) {
        try {
          fs.unlinkSync(jpSrtTmp);
        } catch {
          // ignore
        }
        try {
          if (useEn) fs.unlinkSync(enSrtTmp);
        } catch {
          // ignore
        }
      }
    } else {
      renderTimedSubtitleOverlayClip({
        videoFile,
        rangeStartMs: range.startMs,
        clipDurationMs,
        jpRel,
        enRel,
        bucketDir,
        outPath,
        verbose: args.verbose,
        dryRun: args.dryRun,
      });
    }
    console.log("");
  }

  console.log(`Done. Check clips in: ${path.join(args.outDir, ep)}`);
}

main();
