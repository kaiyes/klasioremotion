#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SUBS_DIR = path.join("source_content", "shingeki_no_kyojin", "subs", "japanese");
const DEFAULT_EN_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english_embedded",
);
const DEFAULT_VIDEOS_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_WORD_LIST_PRIMARY = path.join("source_content", "all_anime_top_2000.match.first2000.json");
const DEFAULT_WORD_LIST_FALLBACK = path.join("source_content", "all_anime_top_2000.json");

function parseArgs(argv) {
  const args = {
    query: "",
    family: "",
    interactive: false, // list families only
    list: false,
    limit: 5,
    topFamilies: 30,
    mode: "line",
    rank: true,
    dryRun: false,
    shorts: true,
    printTop: 0,
    pick: "",
    replace: [],
    decorate: false,
    meaning: "",
    subsDir: DEFAULT_SUBS_DIR,
    enSubsDir: fs.existsSync(DEFAULT_EN_SUBS_DIR) ? DEFAULT_EN_SUBS_DIR : "",
    videosDir: fs.existsSync(DEFAULT_VIDEOS_DIR) ? DEFAULT_VIDEOS_DIR : "",
    wordList: fs.existsSync(DEFAULT_WORD_LIST_PRIMARY)
      ? DEFAULT_WORD_LIST_PRIMARY
      : DEFAULT_WORD_LIST_FALLBACK,
    outDir: "out/clips",
    shortsWorkDir: "out/shorts_work",
    shortsOutputDir: "out/shorts",
    keepOutputs: false,
    workDir: path.join("dissfiles", "tmp"),
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
        args.query = String(v || "").trim();
        takeNext();
        break;
      case "family":
        args.family = String(v || "").trim();
        takeNext();
        break;
      case "interactive":
        args.interactive = true;
        break;
      case "list":
      case "listFamilies":
        args.list = true;
        break;
      case "limit":
        args.limit = Number(v);
        takeNext();
        break;
      case "topFamilies":
        args.topFamilies = Number(v);
        takeNext();
        break;
      case "mode":
        args.mode = String(v || "line");
        takeNext();
        break;
      case "dryRun":
        args.dryRun = true;
        break;
      case "shorts":
        args.shorts = true;
        break;
      case "clipsOnly":
        args.shorts = false;
        break;
      case "decorate":
        args.decorate = true;
        break;
      case "printTop":
        args.printTop = Number(v);
        takeNext();
        break;
      case "pick":
        args.pick = String(v || "").trim();
        takeNext();
        break;
      case "replace":
        args.replace.push(String(v || "").trim());
        takeNext();
        break;
      case "meaning":
        args.meaning = String(v || "").trim();
        takeNext();
        break;
      case "rank":
        args.rank = true;
        break;
      case "noRank":
        args.rank = false;
        break;
      case "subsDir":
        args.subsDir = String(v || "").trim();
        takeNext();
        break;
      case "enSubsDir":
        args.enSubsDir = String(v || "").trim();
        takeNext();
        break;
      case "videosDir":
        args.videosDir = String(v || "").trim();
        takeNext();
        break;
      case "wordList":
        args.wordList = String(v || "").trim();
        takeNext();
        break;
      case "outDir":
        args.outDir = String(v || "").trim();
        takeNext();
        break;
      case "shortsWorkDir":
        args.shortsWorkDir = String(v || "").trim();
        takeNext();
        break;
      case "shortsOutputDir":
        args.shortsOutputDir = String(v || "").trim();
        takeNext();
        break;
      case "keepOutputs":
        args.keepOutputs = true;
        break;
      case "cleanOutputs":
        args.keepOutputs = false;
        break;
      case "workDir":
        args.workDir = String(v || "").trim();
        takeNext();
        break;
      case "help":
        printHelpAndExit(0);
        break;
      case "verbose":
        args.verbose = true;
        break;
      default:
        throw new Error(`Unknown arg: --${k}`);
    }
  }

  if (!args.query) throw new Error("--query is required");
  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(args.topFamilies) || args.topFamilies <= 0) {
    throw new Error("--topFamilies must be a positive integer");
  }
  if (args.mode !== "line" && args.mode !== "sentence") {
    throw new Error('--mode must be "line" or "sentence"');
  }

  return args;
}

function printHelpAndExit(code) {
  console.log(
    `
Usage:
  node scripts/extract-family-clips.js --query <word> --list [options]
  node scripts/extract-family-clips.js --query <word> --family <form> [options]

What it does:
  - List families for a root word (fast, no rendering)
  - Render clips/short by choosing one family via --family

Options:
  --query <text>          Root word/kanji to search (required)
  --interactive           Alias for --list (lists families and exits)
  --list                  List families and exit
  --family <text>         Family filter text (matches by contains)
  --limit <n>             Final number of clips (default: 5)
  --topFamilies <n>       Number of form options to print (default: 30)
  --mode <line|sentence>  Match mode (default: line)
  --dryRun                Plan only, do not render final clips
  --shorts                Render final short in out/shorts (default: on)
  --clipsOnly             Only extract clips (old behavior)
  --printTop <n>          Print top ranked candidates before selection
  --pick <list>           Exact candidate indices, e.g. "1,2,7,9,11"
  --replace <a=b>         Replace selected slot with ranked candidate index, e.g. "3=12", "last=9"
  --decorate              Ask extractor to burn subtitle overlay
  --meaning <text>        Meaning override (used when --decorate is on)
  --rank / --noRank       Ranked candidate pool (default: rank)
  --subsDir <dir>         JP subtitle dir
  --enSubsDir <dir>       EN subtitle dir
  --videosDir <dir>       Video dir
  --wordList <file>       Word list JSON with optional match.forms
  --outDir <dir>          Output clips dir (default: out/clips)
  --shortsWorkDir <dir>   Shorts work dir (default: out/shorts_work)
  --shortsOutputDir <dir> Shorts output dir (default: out/shorts)
  --keepOutputs           Keep previous shorts outputs
  --verbose               Verbose logs
  --workDir <dir>         Temp dir for candidates JSON (default: dissfiles/tmp)
`.trim() + "\n",
  );
  process.exit(code);
}

function runExtract({
  args,
  dryRun,
  candidatesOut,
  family,
  limit,
  inheritStdio,
}) {
  const cli = [
    "scripts/extract-clips.js",
    "--query",
    args.query,
    "--subsDir",
    args.subsDir,
    "--mode",
    args.mode,
    "--outDir",
    args.outDir,
    "--limit",
    String(limit),
  ];

  if (args.wordList) cli.push("--wordList", args.wordList);
  if (args.enSubsDir) cli.push("--enSubsDir", args.enSubsDir);
  if (args.videosDir) cli.push("--videosDir", args.videosDir);
  if (args.rank) cli.push("--rank");
  if (args.decorate) cli.push("--decorate");
  if (args.printTop > 0) cli.push("--printTop", String(args.printTop));
  if (args.pick) cli.push("--pick", args.pick);
  for (const r of args.replace) if (r) cli.push("--replace", r);
  if (args.meaning) cli.push("--meaning", args.meaning);
  if (family) cli.push("--matchContains", family);
  if (dryRun) cli.push("--dryRun");
  if (candidatesOut) cli.push("--candidatesOut", candidatesOut);

  const res = spawnSync(process.execPath, cli, {
    encoding: "utf8",
    stdio: inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function runShorts({
  args,
  family,
  inheritStdio,
}) {
  const cli = [
    "scripts/make-vertical-shorts-clean.js",
    "--query",
    args.query,
    "--subsDir",
    args.subsDir,
    "--mode",
    args.mode,
    "--outDir",
    args.shortsWorkDir,
    "--outputDir",
    args.shortsOutputDir,
    "--limit",
    String(args.limit),
  ];

  if (args.wordList) cli.push("--wordList", args.wordList);
  if (args.enSubsDir) cli.push("--enSubsDir", args.enSubsDir);
  if (args.videosDir) cli.push("--videosDir", args.videosDir);
  if (args.rank) cli.push("--rank");
  if (family) cli.push("--matchContains", family);
  if (args.printTop > 0) cli.push("--printTop", String(args.printTop));
  if (args.pick) cli.push("--pick", args.pick);
  for (const r of args.replace) if (r) cli.push("--replace", r);
  if (args.meaning) cli.push("--meaning", args.meaning);
  if (args.keepOutputs) cli.push("--keepOutputs");
  if (args.verbose) cli.push("--verbose");

  const res = spawnSync(process.execPath, cli, {
    encoding: "utf8",
    stdio: inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    status: res.status ?? 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function readCandidates(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const pool = Array.isArray(payload.pool) ? payload.pool : [];
  const stats = new Map();
  for (const c of pool) {
    const key = String(c.matchText || "").trim();
    if (!key) continue;
    const prev = stats.get(key) || { form: key, count: 0, sample: "" };
    prev.count += 1;
    if (!prev.sample) prev.sample = String(c.sentenceText || "").trim();
    stats.set(key, prev);
  }
  return [...stats.values()].sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
}

function printFamilies(forms, topN) {
  if (forms.length === 0) return;
  const top = forms.slice(0, topN);

  console.log("");
  console.log(`Top ${top.length} form families:`);
  top.forEach((f, idx) => {
    console.log(`${idx + 1}. ${f.form} (count=${f.count})`);
    if (f.sample) console.log(`   sample: ${f.sample}`);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.workDir, { recursive: true });

  const wantsList = args.list || args.interactive;
  const chosenFamily = args.family;

  if (wantsList) {
    const tmpCandidates = path.join(
      args.workDir,
      `family-candidates-${Date.now()}-${process.pid}.json`,
    );

    const previewArgs = {
      ...args,
      rank: false,
      printTop: 0,
      pick: "",
      replace: [],
      decorate: false,
      meaning: "",
    };

    const preview = runExtract({
      args: previewArgs,
      dryRun: true,
      candidatesOut: tmpCandidates,
      family: "",
      limit: 1,
      inheritStdio: false,
    });

    if (preview.status !== 0 && preview.status !== 2) {
      const err = (preview.stderr || preview.stdout || `exit=${preview.status}`).trim();
      throw new Error(`Failed to build candidate pool: ${err}`);
    }
    if (!fs.existsSync(tmpCandidates)) {
      throw new Error("Candidate pool file was not produced.");
    }

    const forms = readCandidates(tmpCandidates);
    if (forms.length === 0) {
      throw new Error(`No forms found for query: ${args.query}`);
    }

    printFamilies(forms, args.topFamilies);
    console.log("");
    console.log("Render command:");
    console.log(
      `  npm run -s extract-family-clips:aot -- --query ${args.query} --family "<form>" --limit 5`,
    );
    return;
  }

  if (!chosenFamily) {
    console.log("");
    console.log("Family is required for rendering. List first, then render.");
    console.log("Step 1 (list):");
    console.log(`  npm run -s family-list:aot -- --query ${args.query}`);
    console.log("Step 2 (render):");
    console.log(
      `  npm run -s extract-family-clips:aot -- --query ${args.query} --family "<form>" --limit 5`,
    );
    process.exit(1);
  }

  console.log("");
  console.log(`Selected family: ${chosenFamily}`);

  const finalRes = args.dryRun
    ? runExtract({
        args,
        dryRun: true,
        candidatesOut: "",
        family: chosenFamily,
        limit: args.limit,
        inheritStdio: true,
      })
    : args.shorts
      ? runShorts({
          args,
          family: chosenFamily,
          inheritStdio: true,
        })
      : runExtract({
          args,
          dryRun: false,
          candidatesOut: "",
          family: chosenFamily,
          limit: args.limit,
          inheritStdio: true,
        });

  if (finalRes.status !== 0) {
    const label = args.dryRun ? "dry-run extract" : args.shorts ? "short render" : "clip extract";
    throw new Error(`Final ${label} failed (exit=${finalRes.status}).`);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
