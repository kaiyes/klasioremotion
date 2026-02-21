#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function parseArgs(argv) {
  const args = {
    clip: "",
    query: "",
    matchText: "",
    expectedMeaning: "",
    candidateJp: "",
    candidateEn: "",
    whisperModel: String(process.env.AV_WHISPER_MODEL || "small").trim(),
    whisperLanguage: String(process.env.AV_WHISPER_LANGUAGE || "Japanese").trim(),
    visionModel: String(process.env.AV_VISION_MODEL || "qwen3-vl:8b").trim(),
    ollamaHost: String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").trim(),
    visionTimeoutMs: 90000,
    frames: 3,
    outDir: "",
    outJson: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, mv] = a.slice(2).split("=");
    const v = mv ?? argv[i + 1];
    const take = () => {
      if (mv == null) i++;
    };
    switch (k) {
      case "clip":
        args.clip = String(v || "").trim();
        take();
        break;
      case "query":
        args.query = String(v || "").trim();
        take();
        break;
      case "matchText":
        args.matchText = String(v || "").trim();
        take();
        break;
      case "expectedMeaning":
        args.expectedMeaning = String(v || "").trim();
        take();
        break;
      case "candidateJp":
        args.candidateJp = String(v || "").trim();
        take();
        break;
      case "candidateEn":
        args.candidateEn = String(v || "").trim();
        take();
        break;
      case "whisperModel":
        args.whisperModel = String(v || "").trim();
        take();
        break;
      case "whisperLanguage":
        args.whisperLanguage = String(v || "").trim();
        take();
        break;
      case "visionModel":
        args.visionModel = String(v || "").trim();
        take();
        break;
      case "ollamaHost":
        args.ollamaHost = String(v || "").trim();
        take();
        break;
      case "visionTimeoutMs":
        args.visionTimeoutMs = Number(v);
        take();
        break;
      case "frames":
        args.frames = Number(v);
        take();
        break;
      case "outDir":
        args.outDir = String(v || "").trim();
        take();
        break;
      case "outJson":
        args.outJson = String(v || "").trim();
        take();
        break;
      case "help":
        printHelpAndExit(0);
        break;
      default:
        throw new Error(`Unknown arg --${k}`);
    }
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(`
Usage:
  node scripts/eval-clip-av.js --clip <file.mp4> [options]

Options:
  --clip <file>            Clip file to evaluate (required)
  --query <jp-word>        Target word
  --matchText <jp-form>    Expected matched JP form
  --expectedMeaning <en>   Expected meaning for sense check
  --candidateJp <text>     Candidate JP subtitle text
  --candidateEn <text>     Candidate EN subtitle text
  --whisperModel <m>       Whisper model (default: small)
  --whisperLanguage <l>    Whisper language (default: Japanese)
  --visionModel <m>        Vision model via Ollama (default: qwen3-vl:8b)
  --ollamaHost <url>       Ollama host (default: http://127.0.0.1:11434)
  --visionTimeoutMs <ms>   Per-frame vision timeout (default: 90000)
  --frames <n>             Number of frames sampled across clip (default: 3)
  --outDir <dir>           Eval output directory (default: <clipDir>/eval_out)
  --outJson <file>         JSON output path (default: <outDir>/<clipBase>.eval.json)
`.trim());
  process.exit(code);
}

function normalizeJapaneseText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function normalizeEnglishText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function diceSimilarity(a, b) {
  const x = normalizeJapaneseText(a);
  const y = normalizeJapaneseText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    const chars = Array.from(s);
    if (chars.length <= 1) return new Set(chars);
    const set = new Set();
    for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
    return set;
  };
  const ax = grams(x);
  const by = grams(y);
  let overlap = 0;
  for (const g of ax) if (by.has(g)) overlap++;
  return (2 * overlap) / Math.max(1, ax.size + by.size);
}

function extractFirstJsonObject(text) {
  const src = String(text || "");
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(src.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseVision(raw) {
  const obj = extractFirstJsonObject(raw);
  const parseBool = (v, fallback = false) => {
    if (typeof v === "boolean") return v;
    const s = String(v || "").trim().toLowerCase();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
    return fallback;
  };
  if (!obj) return { ok: false, jp: "", en: "", hasExtra: false, lineOk: true, kanjiOk: true, senseOk: true, notes: "" };
  return {
    ok: true,
    jp: String(obj.jp || obj.japanese || "").trim(),
    en: String(obj.en || obj.english || "").trim(),
    hasExtra: parseBool(obj.has_extra ?? obj.hasExtra, false),
    lineOk: parseBool(obj.line_ok ?? obj.lineOk, true),
    kanjiOk: parseBool(obj.kanji_ok ?? obj.kanjiOk, true),
    senseOk: parseBool(obj.sense_ok ?? obj.senseOk, true),
    notes: String(obj.notes || obj.reason || "").trim(),
  };
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return res;
}

function ffprobeDurationSec(clip) {
  const res = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    clip,
  ]);
  if (res.status !== 0) throw new Error(`ffprobe failed: ${res.stderr || res.stdout}`);
  const n = Number(String(res.stdout || "").trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid clip duration");
  return n;
}

function extractAudio(clip, outWav) {
  const res = run("ffmpeg", ["-y", "-v", "error", "-i", clip, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWav]);
  if (res.status !== 0) throw new Error(`ffmpeg audio extract failed: ${res.stderr || res.stdout}`);
}

function extractFrames(clip, durationSec, count, outDir) {
  const n = Math.max(1, Math.min(8, Number(count) || 3));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const ratio = n === 1 ? 0.5 : 0.15 + (0.70 * i) / (n - 1);
    const t = Math.max(0, durationSec * ratio);
    const out = path.join(outDir, `frame_${String(i + 1).padStart(2, "0")}.jpg`);
    const res = run("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", clip, "-frames:v", "1", "-q:v", "2", out]);
    if (res.status === 0 && fs.existsSync(out)) frames.push(out);
  }
  return frames;
}

function runWhisper(wav, model, language, outDir) {
  const res = run("whisper", [
    wav,
    "--model",
    model,
    "--language",
    language,
    "--task",
    "transcribe",
    "--word_timestamps",
    "False",
    "--output_format",
    "json",
    "--output_dir",
    outDir,
  ]);
  const jsonFile = path.join(outDir, `${path.basename(wav, path.extname(wav))}.json`);
  if (res.status !== 0 || !fs.existsSync(jsonFile)) return { ok: false, text: "" };
  const parsed = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  return { ok: true, text: String(parsed.text || "").trim() };
}

async function runVisionFrame({ frame, model, host, timeoutMs, prompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 90000));
  try {
    const body = {
      model,
      prompt,
      images: [fs.readFileSync(frame).toString("base64")],
      stream: false,
      format: "json",
      options: { temperature: 0 },
    };
    const res = await fetch(`${host.replace(/\/+$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `http_${res.status}`, raw: "" };
    const raw = String(data.response || data.thinking || data.output || "").trim();
    const parsed = parseVision(raw);
    return { ok: parsed.ok, error: parsed.ok ? "" : "parse_failed", raw, parsed };
  } catch (err) {
    return { ok: false, error: String(err?.name || err?.message || "vision_failed"), raw: "" };
  } finally {
    clearTimeout(timer);
  }
}

function uniqJoin(values) {
  return Array.from(new Set((values || []).map((x) => String(x || "").trim()).filter(Boolean))).join(" ");
}

function extractMeaningKeywords(meaning) {
  const src = String(meaning || "").toLowerCase().replace(/[()]/g, " ").replace(/[;|/,+]/g, " ");
  const stop = new Set(["to", "a", "an", "the", "is", "are", "of", "in", "on", "for", "with", "and", "or"]);
  return Array.from(new Set(src.split(/\s+/g).map((x) => x.trim()).filter((x) => x.length >= 3 && !stop.has(x))));
}

function countKeywordHits(text, keywords) {
  const src = normalizeEnglishText(text);
  return (keywords || []).filter((k) => src.includes(k)).length;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.clip) printHelpAndExit(1);
  const clip = path.resolve(args.clip);
  if (!fs.existsSync(clip)) throw new Error(`clip not found: ${clip}`);

  const outDir = path.resolve(args.outDir || path.join(path.dirname(clip), "eval_out"));
  fs.mkdirSync(outDir, { recursive: true });
  const outJson = path.resolve(args.outJson || path.join(outDir, `${path.basename(clip, path.extname(clip))}.eval.json`));

  const durationSec = ffprobeDurationSec(clip);
  const wav = path.join(outDir, "audio.wav");
  extractAudio(clip, wav);
  const frames = extractFrames(clip, durationSec, args.frames, outDir);
  const asr = runWhisper(wav, args.whisperModel, args.whisperLanguage, outDir);

  const prompt = [
    "Read burned subtitles from this anime frame.",
    "Target word: " + (args.query || ""),
    "Matched form: " + (args.matchText || ""),
    "Expected meaning: " + (args.expectedMeaning || ""),
    "Whisper JP transcript: " + (asr.text || ""),
    "Return strict JSON only:",
    '{"jp":"...","en":"...","has_extra":true|false,"line_ok":true|false,"kanji_ok":true|false,"sense_ok":true|false,"notes":"..."}',
  ].join("\n");

  const perFrame = [];
  for (const frame of frames) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runVisionFrame({
      frame,
      model: args.visionModel,
      host: args.ollamaHost,
      timeoutMs: args.visionTimeoutMs,
      prompt,
    });
    perFrame.push({ frame, ...r });
  }

  const okFrames = perFrame.filter((x) => x.ok && x.parsed);
  const merged = {
    jp: uniqJoin(okFrames.map((x) => x.parsed.jp)),
    en: uniqJoin(okFrames.map((x) => x.parsed.en)),
    hasExtra: okFrames.some((x) => x.parsed.hasExtra),
    lineOk: okFrames.every((x) => x.parsed.lineOk),
    kanjiOk: okFrames.every((x) => x.parsed.kanjiOk),
    senseOk: okFrames.every((x) => x.parsed.senseOk),
    notes: uniqJoin(okFrames.map((x) => x.parsed.notes)),
  };

  const asrSim = args.candidateJp ? diceSimilarity(args.candidateJp, asr.text || "") : null;
  const visionSim = args.candidateJp ? diceSimilarity(args.candidateJp, merged.jp || "") : null;
  const meaningKeywords = extractMeaningKeywords(args.expectedMeaning);
  const meaningHits = meaningKeywords.length > 0 ? countKeywordHits(`${args.candidateEn} ${merged.en}`, meaningKeywords) : null;

  const reasons = [];
  if (!asr.ok) reasons.push("asr_failed");
  if (okFrames.length === 0) reasons.push("vision_failed");
  if (merged.hasExtra) reasons.push("trailing");
  if (!merged.lineOk) reasons.push("line_mismatch");
  if (!merged.kanjiOk) reasons.push("kanji_mismatch");
  if (!merged.senseOk) reasons.push("sense_mismatch");
  if (asrSim != null && asrSim < 0.5) reasons.push("audio_mismatch");
  if (visionSim != null && visionSim < 0.42) reasons.push("vision_mismatch");
  if (meaningHits != null && meaningHits === 0) reasons.push("meaning_mismatch");

  const report = {
    clip,
    durationSec,
    query: args.query || "",
    matchText: args.matchText || "",
    expectedMeaning: args.expectedMeaning || "",
    candidateJp: args.candidateJp || "",
    candidateEn: args.candidateEn || "",
    whisper: {
      ok: asr.ok,
      model: args.whisperModel,
      language: args.whisperLanguage,
      text: asr.text || "",
    },
    vision: {
      model: args.visionModel,
      frameCount: frames.length,
      okFrameCount: okFrames.length,
      merged,
      perFrame: perFrame.map((x) => ({
        frame: x.frame,
        ok: x.ok,
        error: x.error || "",
        raw: x.raw || "",
        parsed: x.parsed || null,
      })),
    },
    checks: {
      asrSim,
      visionSim,
      meaningHits,
    },
    verdict: {
      ok: reasons.length === 0,
      reasons,
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Eval report: ${outJson}`);
  console.log(`Whisper: ${report.whisper.text || "(empty)"}`);
  console.log(`Vision JP: ${report.vision.merged.jp || "(empty)"}`);
  console.log(`Vision EN: ${report.vision.merged.en || "(empty)"}`);
  console.log(`Verdict: ${report.verdict.ok ? "PASS" : "FAIL"} ${report.verdict.reasons.join(",") || ""}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

