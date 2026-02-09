#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_JP_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);
const DEFAULT_EN_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "english",
);

function parseArgs(argv) {
  const args = {
    jpDir: DEFAULT_JP_DIR,
    enDir: DEFAULT_EN_DIR,
    apply: false,
    overwrite: false,
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
      case "jpDir":
        args.jpDir = value;
        takeNext();
        break;
      case "enDir":
        args.enDir = value;
        takeNext();
        break;
      case "apply":
        args.apply = true;
        break;
      case "dryRun":
        args.apply = false;
        break;
      case "overwrite":
        args.overwrite = true;
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

  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/rename-english-subs.js [options]

Options:
  --jpDir <path>       Japanese subtitles dir (default: ${DEFAULT_JP_DIR})
  --enDir <path>       English subtitles dir (default: ${DEFAULT_EN_DIR})
  --apply              Execute renames (default: dry-run)
  --dryRun             Print planned renames only
  --overwrite          Replace destination file if it already exists
  --verbose            Print extra diagnostics

Behavior:
  - Builds JP episode order from sXeY filenames in --jpDir.
  - Maps EN files by numeric episode prefix (01..89) to the JP ordered episode key.
  - Renames EN files to lower-case episode names: s1e1.srt, s1e2.srt, ...
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function listSubtitleFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(srt|ass)$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function parseJpKeyFromName(nameOrPath) {
  const base = path.basename(nameOrPath, path.extname(nameOrPath));
  const m = base.match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  return {
    season,
    episode,
    key: `s${season}e${episode}`,
  };
}

function parseEnEpisodeIndex(nameOrPath) {
  const base = path.basename(nameOrPath, path.extname(nameOrPath));

  const keyLike = parseJpKeyFromName(base);
  if (keyLike) return null;

  const m1 = base.match(/^\s*0*(\d{1,3})\b/);
  if (m1) return Number(m1[1]);

  const m2 = base.match(/\bepisode\s*0*(\d{1,3})\b/i);
  if (m2) return Number(m2[1]);

  return null;
}

function buildJpOrder(jpFiles) {
  const infos = [];
  for (const f of jpFiles) {
    const info = parseJpKeyFromName(f);
    if (!info) continue;
    infos.push(info);
  }
  infos.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });
  return infos;
}

function buildPlan({ jpOrder, enFiles, enDir, verbose }) {
  const plan = [];
  const skipped = [];

  for (const src of enFiles) {
    const ext = path.extname(src).toLowerCase();
    const keyInfo = parseJpKeyFromName(src);

    if (keyInfo) {
      const dst = path.join(enDir, `${keyInfo.key}${ext}`);
      if (src !== dst) {
        plan.push({ src, dst, reason: "normalize existing sXeY" });
      }
      continue;
    }

    const idx = parseEnEpisodeIndex(src);
    if (!Number.isFinite(idx)) {
      skipped.push({ src, reason: "no episode number prefix" });
      continue;
    }
    if (idx < 1 || idx > jpOrder.length) {
      skipped.push({
        src,
        reason: `episode index ${idx} out of range (JP count ${jpOrder.length})`,
      });
      continue;
    }

    const key = jpOrder[idx - 1].key;
    const dst = path.join(enDir, `${key}${ext}`);
    if (src === dst) continue;
    plan.push({ src, dst, reason: `mapped from global #${idx}` });
  }

  if (verbose && skipped.length > 0) {
    for (const s of skipped) {
      console.log(`SKIP ${path.basename(s.src)} (${s.reason})`);
    }
  }
  return { plan, skipped };
}

function validatePlan(plan, overwrite) {
  const conflicts = [];
  const byDst = new Map();
  const srcSet = new Set(plan.map((p) => p.src));

  for (const p of plan) {
    const arr = byDst.get(p.dst) ?? [];
    arr.push(p.src);
    byDst.set(p.dst, arr);
  }

  for (const [dst, srcs] of byDst.entries()) {
    if (srcs.length > 1) {
      conflicts.push({ type: "duplicate_target", dst, srcs });
    }
  }

  for (const p of plan) {
    const exists = fs.existsSync(p.dst);
    if (!exists) continue;
    if (srcSet.has(p.dst)) continue;
    if (!overwrite) {
      conflicts.push({ type: "target_exists", dst: p.dst, src: p.src });
    }
  }

  return conflicts;
}

function executePlan(plan, overwrite) {
  const staged = [];
  try {
    for (const p of plan) {
      const tmp = `${p.src}.tmp-rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      fs.renameSync(p.src, tmp);
      staged.push({ ...p, tmp });
    }

    for (const p of staged) {
      if (fs.existsSync(p.dst)) {
        if (!overwrite) {
          throw new Error(`Target exists and overwrite is off: ${p.dst}`);
        }
        fs.unlinkSync(p.dst);
      }
      fs.renameSync(p.tmp, p.dst);
    }
  } catch (err) {
    for (const p of staged) {
      if (fs.existsSync(p.tmp) && !fs.existsSync(p.src)) {
        try {
          fs.renameSync(p.tmp, p.src);
        } catch {
          // best effort rollback
        }
      }
    }
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.jpDir)) throw new Error(`JP dir not found: ${args.jpDir}`);
  if (!fs.existsSync(args.enDir)) throw new Error(`EN dir not found: ${args.enDir}`);

  const jpFiles = listSubtitleFiles(args.jpDir);
  const enFiles = listSubtitleFiles(args.enDir);
  const jpOrder = buildJpOrder(jpFiles);
  const { plan, skipped } = buildPlan({
    jpOrder,
    enFiles,
    enDir: args.enDir,
    verbose: args.verbose,
  });

  const conflicts = validatePlan(plan, args.overwrite);
  if (conflicts.length > 0) {
    console.error(`Conflicts detected (${conflicts.length}).`);
    for (const c of conflicts.slice(0, 20)) {
      if (c.type === "duplicate_target") {
        console.error(`- duplicate target: ${c.dst}`);
      } else {
        console.error(`- target exists: ${c.dst} (from ${c.src})`);
      }
    }
    process.exit(2);
  }

  console.log(`JP files: ${jpFiles.length}`);
  console.log(`EN files: ${enFiles.length}`);
  console.log(`JP ordered episodes: ${jpOrder.length}`);
  console.log(`Planned renames: ${plan.length}`);
  console.log(`Skipped: ${skipped.length}`);

  for (const p of plan.slice(0, 25)) {
    console.log(`- ${path.basename(p.src)} -> ${path.basename(p.dst)} (${p.reason})`);
  }
  if (plan.length > 25) {
    console.log(`... ${plan.length - 25} more`);
  }

  if (!args.apply) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to execute.");
    return;
  }

  executePlan(plan, args.overwrite);
  console.log("");
  console.log(`Renamed ${plan.length} file(s).`);
}

main();
