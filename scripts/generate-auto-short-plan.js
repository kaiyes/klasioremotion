#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

function parseArgs(argv) {
  const args = {
    input: null,
    subtitleFile: null,
    outDir: path.join("out", "auto-short"),
    generatedPlan: path.join("src", "auto-short", "generated-plan.ts"),
    publicVideoDir: path.join("public", "auto-short", "videos"),
    publicAssetDir: path.join("public", "auto-short", "assets"),
    publicCardDir: path.join("public", "auto-short", "cards"),
    whisperBin: "whisper",
    whisperModel: "small",
    language: "English",
    skipWhisper: false,
    llmMode: "heuristic",
    llmBaseUrl:
      process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "http://127.0.0.1:11434/v1",
    llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
    llmApiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    fps: DEFAULT_FPS,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [key, maybeValue] = arg.slice(2).split("=");
    const value = maybeValue ?? argv[i + 1];
    const takeNext = () => {
      if (maybeValue == null) i++;
    };

    switch (key) {
      case "input":
      case "video":
        args.input = value;
        takeNext();
        break;
      case "subtitleFile":
      case "srt":
        args.subtitleFile = value;
        takeNext();
        break;
      case "outDir":
        args.outDir = value;
        takeNext();
        break;
      case "generatedPlan":
        args.generatedPlan = value;
        takeNext();
        break;
      case "publicVideoDir":
        args.publicVideoDir = value;
        takeNext();
        break;
      case "publicAssetDir":
        args.publicAssetDir = value;
        takeNext();
        break;
      case "publicCardDir":
        args.publicCardDir = value;
        takeNext();
        break;
      case "whisperBin":
        args.whisperBin = value;
        takeNext();
        break;
      case "whisperModel":
      case "model":
        args.whisperModel = value;
        takeNext();
        break;
      case "language":
        args.language = value;
        takeNext();
        break;
      case "skipWhisper":
        args.skipWhisper = true;
        break;
      case "llmMode":
        args.llmMode = String(value || "").toLowerCase();
        takeNext();
        break;
      case "llmBaseUrl":
        args.llmBaseUrl = value;
        takeNext();
        break;
      case "llmModel":
        args.llmModel = value;
        takeNext();
        break;
      case "llmApiKey":
        args.llmApiKey = value;
        takeNext();
        break;
      case "fps":
        args.fps = Number(value);
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

  if (!args.input) {
    throw new Error("Missing --input <video-file>");
  }
  if (!Number.isFinite(args.fps) || args.fps < 1) {
    throw new Error("--fps must be a positive number");
  }
  if (!Number.isFinite(args.width) || args.width < 100) {
    throw new Error("--width must be >= 100");
  }
  if (!Number.isFinite(args.height) || args.height < 100) {
    throw new Error("--height must be >= 100");
  }

  if (!["heuristic", "openai"].includes(args.llmMode)) {
    throw new Error('--llmMode must be either "heuristic" or "openai"');
  }

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/generate-auto-short-plan.js --input "src/make bank.mp4" [options]

What it does:
  1) Copies source video to public/auto-short/videos/latest.mp4
  2) Runs local Whisper to generate subtitles (SRT)
  3) Detects narrative beats (list intros, numbered points, key moments)
  4) Writes Remotion plan to src/auto-short/generated-plan.ts

Options:
  --input <path>            Input video file (required)
  --subtitleFile <path>     Use an existing subtitle file instead of Whisper
  --skipWhisper             Skip Whisper and reuse latest .srt in outDir
  --whisperBin <cmd>        Whisper executable (default: whisper)
  --whisperModel <name>     Whisper model (default: small)
  --language <name>         Whisper language (default: English)
  --llmMode <heuristic|openai>  Segment planning mode (default: heuristic)
  --llmBaseUrl <url>        OpenAI-compatible endpoint (default: $LLM_BASE_URL or Ollama style URL)
  --llmModel <name>         LLM model id for openai mode
  --llmApiKey <key>         API key for openai mode (or use $LLM_API_KEY / $OPENAI_API_KEY)
  --outDir <path>           Work folder (default: out/auto-short)
  --generatedPlan <path>    Plan output TS file (default: src/auto-short/generated-plan.ts)
  --publicVideoDir <path>   Public video dir (default: public/auto-short/videos)
  --publicAssetDir <path>   Optional decorative image dir (default: public/auto-short/assets)
  --publicCardDir <path>    Optional background-card dir (default: public/auto-short/cards)
  --fps <n>                 Timeline FPS (default: 30)
  --width <n>               Composition width (default: 1080)
  --height <n>              Composition height (default: 1920)
  --verbose                 Print commands and debug logs
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runChecked(cmd, cmdArgs, verbose) {
  if (verbose) {
    console.log([cmd, ...cmdArgs].join(" "));
  }
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed`);
  }
}

function readDurationSec(filePath) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return 0;
  const duration = Number(String(result.stdout || "").trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function roundSec(value) {
  return Math.round(value * 1000) / 1000;
}

function safeSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function copyVideoToPublic({ inputAbs, slug, publicVideoDir }) {
  ensureDir(publicVideoDir);

  const slugOutput = path.join(publicVideoDir, `${slug}.mp4`);
  const latestOutput = path.join(publicVideoDir, "latest.mp4");
  fs.copyFileSync(inputAbs, slugOutput);
  fs.copyFileSync(inputAbs, latestOutput);

  return {
    slugRelative: path.posix.join("auto-short", "videos", `${slug}.mp4`),
    latestRelative: path.posix.join("auto-short", "videos", "latest.mp4"),
    slugOutput,
    latestOutput,
  };
}

function srtTimeToSec(ts) {
  const match = String(ts)
    .trim()
    .match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return NaN;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const ms = Number(String(match[4]).padEnd(3, "0").slice(0, 3));
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

function cleanCueText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSrtFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const blocks = raw.split(/\r?\n\r?\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) continue;

    const timeLine = lines[timeLineIndex];
    const [startRaw, endRaw] = timeLine.split("-->").map((value) => value.trim());
    const startSec = srtTimeToSec(startRaw);
    const endSec = srtTimeToSec(endRaw);
    const text = cleanCueText(lines.slice(timeLineIndex + 1).join(" "));

    if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      continue;
    }

    cues.push({
      startSec: roundSec(startSec),
      endSec: roundSec(endSec),
      text,
    });
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

function findWhisperSrt(workDir, inputAbs) {
  const expected = path.join(workDir, `${path.basename(inputAbs, path.extname(inputAbs))}.srt`);
  if (fs.existsSync(expected)) return expected;

  const candidates = fs
    .readdirSync(workDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.srt$/i.test(entry.name))
    .map((entry) => path.join(workDir, entry.name))
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return candidates[0]?.filePath ?? null;
}

function findWhisperJson(workDir, inputAbs) {
  const expected = path.join(workDir, `${path.basename(inputAbs, path.extname(inputAbs))}.json`);
  if (fs.existsSync(expected)) return expected;

  const candidates = fs
    .readdirSync(workDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .filter((entry) => !["plan.json", "captions.json"].includes(entry.name))
    .map((entry) => path.join(workDir, entry.name))
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return candidates[0]?.filePath ?? null;
}

function parseWhisperWordCaptions(filePath, durationSec) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const words = [];

    for (const segment of segments) {
      const segmentWords = Array.isArray(segment?.words) ? segment.words : [];
      for (const word of segmentWords) {
        const startSec = Number(word?.start);
        const endSec = Number(word?.end);
        const text = cleanCueText(word?.word || word?.text || "");

        if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
          continue;
        }

        words.push({
          startSec: roundSec(Math.max(0, startSec)),
          endSec: roundSec(Math.min(durationSec, endSec)),
          text,
        });
      }
    }

    return words
      .filter((word) => word.endSec > word.startSec)
      .sort((a, b) => a.startSec - b.startSec);
  } catch (error) {
    console.warn(`Failed to parse Whisper JSON for word timestamps: ${error.message}`);
    return [];
  }
}

function detectNumberCue(text) {
  const normalized = String(text || "").toLowerCase();
  const patterns = [
    {
      number: 1,
      tests: [
        /\b(?:number|step|point|tip|way)\s*(?:1|one|first)\b/,
        /^\s*(?:1|one|first)\b[\s:.-]/,
      ],
    },
    {
      number: 2,
      tests: [
        /\b(?:number|step|point|tip|way)\s*(?:2|two|second)\b/,
        /^\s*(?:2|two|second)\b[\s:.-]/,
      ],
    },
    {
      number: 3,
      tests: [
        /\b(?:number|step|point|tip|way)\s*(?:3|three|third)\b/,
        /^\s*(?:3|three|third)\b[\s:.-]/,
      ],
    },
    {
      number: 4,
      tests: [
        /\b(?:number|step|point|tip|way)\s*(?:4|four|fourth)\b/,
        /^\s*(?:4|four|fourth)\b[\s:.-]/,
      ],
    },
  ];

  for (const pattern of patterns) {
    if (pattern.tests.some((regex) => regex.test(normalized))) {
      return pattern.number;
    }
  }
  return null;
}

function stripNumberLabel(text, number) {
  const words = {
    1: "one|first",
    2: "two|second",
    3: "three|third",
    4: "four|fourth",
  };
  const token = words[number] || String(number);
  return cleanCueText(
    String(text || "")
      .replace(new RegExp(`\\b(?:number|step|point|tip|way)\\s*(?:${number}|${token})\\b[:\\-.]?`, "i"), "")
      .replace(new RegExp(`^\\s*(?:${number}|${token})\\b[\\s:\\-.]*`, "i"), ""),
  );
}

function shorten(text, maxWords = 12, maxChars = 96) {
  const cleaned = cleanCueText(text);
  if (!cleaned) return "";

  const words = cleaned.split(/\s+/).filter(Boolean);
  let clipped = words.slice(0, maxWords).join(" ");
  if (words.length > maxWords) {
    clipped += "...";
  }

  if (clipped.length > maxChars) {
    return `${clipped.slice(0, maxChars).trimEnd()}...`;
  }
  return clipped;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "but",
  "by",
  "can",
  "clue",
  "do",
  "does",
  "for",
  "from",
  "going",
  "have",
  "if",
  "in",
  "is",
  "it",
  "its",
  "mark",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "same",
  "so",
  "still",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "thing",
  "this",
  "to",
  "us",
  "using",
  "was",
  "we",
  "what",
  "who",
  "words",
]);

function toTitleCase(value) {
  return String(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function splitWords(text) {
  return cleanCueText(text).match(/[A-Za-z0-9'-]+/g) || [];
}

function contentTokens(text) {
  const words = splitWords(text);
  return words
    .map((word) => word.toLowerCase().replace(/^'+|'+$/g, ""))
    .filter((word) => word.length >= 3)
    .filter((word) => !STOP_WORDS.has(word))
    .filter((word) => !/^\d+$/.test(word));
}

function extractFocusPhrase(text) {
  const cleaned = cleanCueText(text);
  const lower = cleaned.toLowerCase();

  if (/\bopenclaw\b/i.test(cleaned)) {
    return "Open Claw";
  }

  const openPair = cleaned.match(/\b(open)\s+([a-z0-9'-]+)/i);
  if (openPair) {
    return `${toTitleCase(openPair[1])} ${toTitleCase(openPair[2])}`;
  }

  const mapped = [
    { regex: /\bai automation\b/i, label: "AI Automation" },
    { regex: /\buser[- ]?friendly\b/i, label: "User-Friendly" },
    { regex: /\bmake bank\b/i, label: "Make Bank" },
    { regex: /\b(bank|money|cash|profit)\b/i, label: "Money" },
    { regex: /\bworkflow(s)?\b/i, label: "Workflow" },
    { regex: /\bcli\b/i, label: "CLI" },
    { regex: /\bdevelopers?\b/i, label: "Developers" },
    { regex: /\bserver\b/i, label: "Server" },
    { regex: /\bopenclaw\b/i, label: "Open Claw" },
  ];

  for (const item of mapped) {
    if (item.regex.test(lower)) return item.label;
  }

  const tokens = contentTokens(cleaned);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return toTitleCase(tokens[0]);
  return `${toTitleCase(tokens[0])} ${toTitleCase(tokens[1])}`;
}

function cutawayHeadlineFromText(text, index) {
  const focus = extractFocusPhrase(text);
  const lower = focus.toLowerCase();
  if (!focus) return `Key Idea ${index + 1}`;
  if (lower === "ai automation") return "AI Automation Gap";
  if (lower === "user-friendly") return "User-Friendly Wins";
  if (lower === "cli") return "CLI Barrier";
  if (lower === "developers") return "Developer-Only Flow";
  if (lower === "server") return "No Server Required";
  if (lower === "workflow") return "Simplify Workflow";
  if (lower === "money" || lower === "make bank") return "Make Bank";
  return focus;
}

function overlayPhraseFromText(text) {
  const focus = extractFocusPhrase(text);
  if (!focus) return "";
  const words = focus.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return focus;
  return words.slice(0, 2).join(" ");
}

function scoreCue(text) {
  const value = String(text || "").toLowerCase();
  const keywordHits =
    (value.match(/\b(important|key|main|remember|first|second|third|because|result|steps?|ways?)\b/g) || [])
      .length * 1.2;
  const lengthBoost = Math.min(value.split(/\s+/).filter(Boolean).length / 10, 1.4);
  return keywordHits + lengthBoost;
}

function pickFallbackAnchors(cues) {
  const ranked = cues
    .map((cue, cueIndex) => ({
      cue,
      cueIndex,
      score: scoreCue(cue.text),
    }))
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  for (const candidate of ranked) {
    if (candidate.score < 0.8) continue;
    const tooClose = chosen.some((picked) => Math.abs(picked.cue.startSec - candidate.cue.startSec) < 2.8);
    if (tooClose) continue;
    chosen.push(candidate);
    if (chosen.length >= 3) break;
  }

  if (chosen.length > 0) {
    return chosen.sort((a, b) => a.cue.startSec - b.cue.startSec);
  }

  const stride = Math.max(1, Math.floor(cues.length / 3));
  const basic = [];
  for (let index = 0; index < cues.length && basic.length < 3; index += stride) {
    basic.push({ cue: cues[index], cueIndex: index });
  }
  return basic;
}

function normalizeCutaways(rawCutaways, durationSec) {
  const sorted = [...rawCutaways].sort((a, b) => a.startSec - b.startSec);
  const normalized = [];
  const introHoldSec = durationSec > 8 ? 2.4 : 0.8;
  const minCutawaySec = durationSec > 12 ? 2.1 : 1.8;
  const targetCutawaySec = durationSec > 20 ? 2.8 : 2.4;
  const maxCutawaySec = durationSec > 20 ? 3.8 : 3.2;
  let cursor = introHoldSec;

  for (const segment of sorted) {
    let startSec = Math.max(0, segment.startSec, cursor);
    let endSec = Math.min(durationSec, Math.max(segment.endSec, startSec + targetCutawaySec));
    endSec = Math.min(endSec, startSec + maxCutawaySec);
    if (endSec - startSec < minCutawaySec) {
      endSec = Math.min(durationSec, startSec + minCutawaySec);
    }

    if (endSec - startSec < minCutawaySec * 0.65 || startSec >= durationSec - 0.2) {
      continue;
    }

    normalized.push({
      id: `cutaway-${normalized.length}`,
      type: "cutaway",
      startSec: roundSec(startSec),
      endSec: roundSec(endSec),
      headline: shorten(segment.headline || "Key idea", 6, 48),
      supportingText: shorten(segment.supportingText || "", 14, 84) || undefined,
      points: (segment.points || []).slice(0, 3),
    });

    cursor = endSec + 0.22;
  }

  return normalized;
}

function buildHeuristicCutaways(cues, durationSec) {
  const rawCutaways = [];
  const listIntro = cues.find((cue) =>
    /\b(?:three|3|four|4|five|5)\s+(?:ways|steps|tips|methods|reasons|things|points)\b/i.test(cue.text),
  );
  const numberedMentions = [];

  for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    const cue = cues[cueIndex];
    const number = detectNumberCue(cue.text);
    if (number == null) continue;
    if (numberedMentions.some((entry) => entry.number === number)) continue;
    numberedMentions.push({ cue, cueIndex, number });
  }

  const numbered = numberedMentions
    .sort((a, b) => a.cue.startSec - b.cue.startSec)
    .slice(0, 4);

  if (listIntro) {
    const introStart = Math.max(0, listIntro.startSec - 0.06);
    const firstNumberStart = numbered[0]?.cue.startSec ?? Number.POSITIVE_INFINITY;
    let introEnd = Math.min(durationSec, introStart + 2.8, firstNumberStart - 0.1);
    if (!Number.isFinite(introEnd) || introEnd <= introStart) {
      introEnd = Math.min(durationSec, introStart + 2.6);
    }

    rawCutaways.push({
      startSec: introStart,
      endSec: introEnd,
      headline: cutawayHeadlineFromText(listIntro.text, 0),
      supportingText: shorten(listIntro.text, 10, 84),
      points: numbered.slice(0, 3).map((entry) => ({
        title: `Point ${entry.number}`,
      })),
    });
  }

  if (numbered.length > 0) {
    for (let index = 0; index < numbered.length; index++) {
      const marker = numbered[index];
      const next = numbered[index + 1];
      const contextEndIndex = next ? next.cueIndex : Math.min(cues.length, marker.cueIndex + 3);
      const context = cues.slice(marker.cueIndex, contextEndIndex);

      const startSec = Math.max(0, marker.cue.startSec - 0.08);
      const nextStart = next ? next.cue.startSec - 0.1 : durationSec;
      let endSec = Math.min(durationSec, marker.cue.endSec + 2.3, marker.cue.startSec + 3.8, nextStart);
      if (endSec - startSec < 2.2) {
        endSec = Math.min(durationSec, startSec + 2.2);
      }

      const detail = shorten(stripNumberLabel(marker.cue.text, marker.number), 12, 84);
      const points = context
        .map((cue) => shorten(stripNumberLabel(cue.text, marker.number), 9, 52))
        .filter(Boolean)
        .filter((text, itemIndex, arr) => arr.indexOf(text) === itemIndex)
        .slice(0, 3)
        .map((title) => ({ title }));

      rawCutaways.push({
        startSec,
        endSec,
        headline: `Point ${marker.number}`,
        supportingText: detail || undefined,
        points,
      });
    }
  }

  if (rawCutaways.length === 0) {
    const anchors = pickFallbackAnchors(cues);
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const next = anchors[index + 1];
      const startSec = Math.max(0, anchor.cue.startSec - 0.1);
      const nextStart = next ? next.cue.startSec - 0.1 : durationSec;
      let endSec = Math.min(durationSec, startSec + 3.2, nextStart, anchor.cue.endSec + 2.5);
      if (endSec - startSec < 2.2) {
        endSec = Math.min(durationSec, startSec + 2.2);
      }

      rawCutaways.push({
        startSec,
        endSec,
        headline: cutawayHeadlineFromText(anchor.cue.text, index),
        supportingText: shorten(anchor.cue.text, 14, 96),
        points: [{ title: overlayPhraseFromText(anchor.cue.text) || shorten(anchor.cue.text, 8, 52) }],
      });
    }
  }

  return normalizeCutaways(rawCutaways, durationSec);
}

function overlapsCutaway(startSec, endSec, cutaways) {
  return cutaways.some((segment) => startSec < segment.endSec && endSec > segment.startSec);
}

function buildTopOverlays(cues, cutaways, durationSec) {
  const overlays = [];
  const dedupe = new Set();
  let lastStart = -100;

  for (const cue of cues) {
    const text = overlayPhraseFromText(cue.text);
    if (!text) continue;

    const startSec = cue.startSec;
    if (startSec - lastStart < 1.1) continue;

    let endSec = Math.min(durationSec, cue.endSec + 0.8, startSec + 2.1);
    if (endSec - startSec < 0.95) {
      endSec = Math.min(durationSec, startSec + 0.95);
    }
    if (overlapsCutaway(startSec, endSec, cutaways)) continue;

    const normalized = text.toLowerCase();
    if (dedupe.has(normalized)) continue;

    overlays.push({
      text,
      startSec: roundSec(startSec),
      endSec: roundSec(endSec),
    });
    dedupe.add(normalized);
    lastStart = startSec;

    if (overlays.length >= 12) break;
  }

  if (overlays.length === 0 && cues[0]) {
    overlays.push({
      text: overlayPhraseFromText(cues[0].text) || "Takeaway",
      startSec: roundSec(cues[0].startSec),
      endSec: roundSec(Math.min(durationSec, cues[0].startSec + 1.8)),
    });
  }

  return overlays;
}

function buildTalkSegments(cutaways, durationSec) {
  const talks = [];
  let cursor = 0;

  for (const cutaway of cutaways) {
    if (cutaway.startSec - cursor > 0.35) {
      talks.push({
        id: `talk-${talks.length}`,
        type: "talk",
        startSec: roundSec(cursor),
        endSec: roundSec(cutaway.startSec),
      });
    }
    cursor = Math.max(cursor, cutaway.endSec);
  }

  if (durationSec - cursor > 0.35) {
    talks.push({
      id: `talk-${talks.length}`,
      type: "talk",
      startSec: roundSec(cursor),
      endSec: roundSec(durationSec),
    });
  }

  if (talks.length === 0) {
    talks.push({
      id: "talk-0",
      type: "talk",
      startSec: 0,
      endSec: roundSec(durationSec),
    });
  }

  return talks;
}

function buildIconMoments(cues, durationSec) {
  const moments = [];
  let lastStart = -100;
  const moneyRegex = /\b(bank|money|cash|profit|dollar|dollars|bucks?)\b/i;

  for (const cue of cues) {
    if (!moneyRegex.test(cue.text)) continue;
    const startSec = cue.startSec + 0.14;
    if (startSec - lastStart < 1.15) continue;

    let endSec = Math.min(durationSec, cue.endSec + 1, startSec + 2.2);
    if (endSec - startSec < 1) {
      endSec = Math.min(durationSec, startSec + 1);
    }

    moments.push({
      kind: "money",
      startSec: roundSec(startSec),
      endSec: roundSec(endSec),
    });
    lastStart = startSec;

    if (moments.length >= 6) break;
  }

  return moments;
}

function listDecorativeImages(publicAssetDir) {
  if (!fs.existsSync(publicAssetDir)) return [];

  return fs
    .readdirSync(publicAssetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(entry.name))
    .map((entry) => path.posix.join("auto-short", "assets", entry.name))
    .slice(0, 8);
}

function pickBackgroundCard(publicCardDir) {
  if (!fs.existsSync(publicCardDir)) return null;

  const cards = fs
    .readdirSync(publicCardDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|avif)$/i.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      mtime: fs.statSync(path.join(publicCardDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const latest = cards[0];
  if (!latest) return null;
  return path.posix.join("auto-short", "cards", latest.name);
}

function parseJsonFromText(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) {}
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  return null;
}

function sanitizeLlmCutaways(rawCutaways, durationSec) {
  if (!Array.isArray(rawCutaways)) return [];
  const cleaned = [];

  for (const candidate of rawCutaways) {
    const startSec = Number(candidate?.startSec);
    const endSec = Number(candidate?.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      continue;
    }

    const pointsRaw = Array.isArray(candidate?.points) ? candidate.points : [];
    const points = pointsRaw
      .map((point) => {
        if (typeof point === "string") return shorten(point, 8, 52);
        return shorten(point?.title || "", 8, 52);
      })
      .filter(Boolean)
      .slice(0, 3)
      .map((title) => ({ title }));

    cleaned.push({
      startSec: Math.max(0, startSec),
      endSec: Math.min(durationSec, endSec),
      headline: shorten(candidate?.headline || "Key idea", 7, 54),
      supportingText: shorten(candidate?.supportingText || "", 14, 88) || undefined,
      points,
    });
  }

  return normalizeCutaways(cleaned, durationSec);
}

function sanitizeLlmOverlays(rawOverlays, durationSec) {
  if (!Array.isArray(rawOverlays)) return [];

  const cleaned = [];
  for (const candidate of rawOverlays) {
    const startSec = Number(candidate?.startSec);
    const endSec = Number(candidate?.endSec);
    const text = shorten(candidate?.text || "", 9, 64);
    if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      continue;
    }
    cleaned.push({
      text,
      startSec: roundSec(Math.max(0, startSec)),
      endSec: roundSec(Math.min(durationSec, endSec)),
    });
  }

  return cleaned.slice(0, 12);
}

async function maybeRefineWithLlm({
  args,
  cues,
  durationSec,
  cutaways,
  topOverlays,
}) {
  if (args.llmMode !== "openai") {
    return { cutaways, topOverlays };
  }
  if (typeof fetch !== "function") {
    console.warn("LLM refinement skipped: fetch API is unavailable in this Node runtime.");
    return { cutaways, topOverlays };
  }

  const transcript = cues
    .map((cue) => `[${cue.startSec.toFixed(2)}-${cue.endSec.toFixed(2)}] ${cue.text}`)
    .join("\n");
  const prompt = `
You are planning a dynamic vertical talking-head video edit.
Return strict JSON with this shape:
{
  "cutaways": [
    {
      "startSec": number,
      "endSec": number,
      "headline": string,
      "supportingText": string,
      "points": [string, string, string]
    }
  ],
  "topOverlays": [
    {
      "startSec": number,
      "endSec": number,
      "text": string
    }
  ]
}

Rules:
- Keep cutaways short (1.4s to 4.2s) and avoid overlaps.
- Prefer moments where speaker lists numbered points.
- Keep text concise and energetic.
- If transcript is not a listicle, do not use generic labels like "Key idea 1".
- topOverlays text should usually be 1-2 words.
- Include at most 4 cutaways and 10 topOverlays.
- Duration is ${durationSec.toFixed(2)} seconds.

Transcript:
${transcript}
`.trim();

  const headers = { "content-type": "application/json" };
  if (args.llmApiKey) headers.authorization = `Bearer ${args.llmApiKey}`;

  try {
    const response = await fetch(`${String(args.llmBaseUrl).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: args.llmModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are an expert short-form video editor. Output valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseJsonFromText(content);
    if (!parsed) {
      throw new Error("model output was not valid JSON");
    }

    const llmCutaways = sanitizeLlmCutaways(parsed.cutaways, durationSec);
    const llmOverlays = sanitizeLlmOverlays(parsed.topOverlays, durationSec);

    return {
      cutaways: llmCutaways.length > 0 ? llmCutaways : cutaways,
      topOverlays: llmOverlays.length > 0 ? llmOverlays : topOverlays,
    };
  } catch (error) {
    console.warn(`LLM refinement skipped: ${error.message}`);
    return { cutaways, topOverlays };
  }
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function choosePalette(slug) {
  const palettes = [
    {
      backgroundA: "#101426",
      backgroundB: "#1d2a61",
      accent: "#ffcf5d",
      accentMuted: "#63d2ff",
      textPrimary: "#f8fafc",
    },
    {
      backgroundA: "#0f172a",
      backgroundB: "#064e3b",
      accent: "#facc15",
      accentMuted: "#7dd3fc",
      textPrimary: "#f1f5f9",
    },
    {
      backgroundA: "#1f2937",
      backgroundB: "#7c2d12",
      accent: "#fb7185",
      accentMuted: "#fde68a",
      textPrimary: "#f8fafc",
    },
  ];
  return palettes[hashString(slug) % palettes.length];
}

function writeGeneratedPlanTs(generatedPlanPath, plan) {
  const body = JSON.stringify(plan, null, 2);
  const content = `import type {AutoShortPlan} from './types';

export const generatedPlan: AutoShortPlan = ${body};
`;
  fs.writeFileSync(generatedPlanPath, content);
}

function runWhisper({ args, inputAbs, workDir }) {
  const whisperArgs = [
    inputAbs,
    "--model",
    args.whisperModel,
    "--language",
    args.language,
    "--task",
    "transcribe",
    "--output_dir",
    workDir,
    "--output_format",
    "all",
    "--word_timestamps",
    "True",
  ];
  runChecked(args.whisperBin, whisperArgs, args.verbose);

  const srtPath = findWhisperSrt(workDir, inputAbs);
  if (!srtPath) {
    throw new Error(`Whisper completed but no .srt file was found in ${workDir}`);
  }
  return srtPath;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputAbs = path.resolve(args.input);
  if (!fs.existsSync(inputAbs)) {
    throw new Error(`Input video not found: ${inputAbs}`);
  }

  const slugBase = safeSlug(path.basename(inputAbs, path.extname(inputAbs)));
  const slug = slugBase || "video";
  const workDir = path.resolve(args.outDir, slug);

  ensureDir(workDir);
  ensureDir(path.dirname(path.resolve(args.generatedPlan)));

  const copiedVideo = copyVideoToPublic({
    inputAbs,
    slug,
    publicVideoDir: path.resolve(args.publicVideoDir),
  });

  let srtPath = args.subtitleFile ? path.resolve(args.subtitleFile) : null;
  if (!srtPath) {
    if (args.skipWhisper) {
      srtPath = findWhisperSrt(workDir, inputAbs);
      if (!srtPath) {
        throw new Error(`--skipWhisper was set but no .srt exists in ${workDir}`);
      }
    } else {
      console.log(`Transcribing with Whisper (${args.whisperModel})...`);
      srtPath = runWhisper({ args, inputAbs, workDir });
    }
  }
  if (!fs.existsSync(srtPath)) {
    throw new Error(`Subtitle file not found: ${srtPath}`);
  }

  const cues = parseSrtFile(srtPath);
  if (cues.length === 0) {
    throw new Error(`No subtitle cues found in ${srtPath}`);
  }

  const videoDurationSec = readDurationSec(inputAbs);
  const subtitleDurationSec = cues[cues.length - 1].endSec + 0.2;
  const durationSec = Math.max(videoDurationSec, subtitleDurationSec, 2);
  const whisperJsonPath = findWhisperJson(workDir, inputAbs);
  const wordCaptions = parseWhisperWordCaptions(whisperJsonPath, durationSec);
  if (whisperJsonPath && wordCaptions.length === 0) {
    console.warn(
      `Whisper JSON found but had no word timestamps. Re-run transcription with --word_timestamps True. File: ${whisperJsonPath}`,
    );
  }

  let cutaways = buildHeuristicCutaways(cues, durationSec);
  let topOverlays = buildTopOverlays(cues, cutaways, durationSec);

  ({ cutaways, topOverlays } = await maybeRefineWithLlm({
    args,
    cues,
    durationSec,
    cutaways,
    topOverlays,
  }));

  const talkSegments = buildTalkSegments(cutaways, durationSec);
  const segments = [...talkSegments, ...cutaways].sort((a, b) => a.startSec - b.startSec);
  const iconMoments = buildIconMoments(cues, durationSec);

  const captions = cues
    .map((cue) => ({
      startSec: roundSec(cue.startSec),
      endSec: roundSec(Math.min(durationSec, cue.endSec)),
      text: shorten(cue.text, 18, 112),
    }))
    .filter((cue) => cue.text && cue.endSec > cue.startSec);

  const plan = {
    version: 1,
    sourceVideo: copiedVideo.latestRelative,
    fps: Number(args.fps),
    width: Number(args.width),
    height: Number(args.height),
    durationInFrames: Math.max(1, Math.ceil(durationSec * Number(args.fps))),
    segments,
    topOverlays,
    captions,
    wordCaptions,
    decorativeImages: listDecorativeImages(path.resolve(args.publicAssetDir)),
    backgroundCard: pickBackgroundCard(path.resolve(args.publicCardDir)),
    iconMoments,
    palette: choosePalette(slug),
  };

  const generatedPlanPath = path.resolve(args.generatedPlan);
  writeGeneratedPlanTs(generatedPlanPath, plan);

  const planJsonPath = path.join(workDir, "plan.json");
  const captionsJsonPath = path.join(workDir, "captions.json");
  fs.writeFileSync(planJsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(captionsJsonPath, `${JSON.stringify(cues, null, 2)}\n`);

  const localSrtCopy = path.join(workDir, `${slug}.srt`);
  if (path.resolve(srtPath) !== path.resolve(localSrtCopy)) {
    fs.copyFileSync(srtPath, localSrtCopy);
  }

  console.log(`Plan written: ${generatedPlanPath}`);
  console.log(`Debug JSON: ${planJsonPath}`);
  console.log(`Source video copied: ${copiedVideo.latestOutput}`);
  console.log(
    `Segments -> cutaways: ${cutaways.length}, talks: ${talkSegments.length}, overlays: ${topOverlays.length}`,
  );
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
