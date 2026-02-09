#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_VIDEO_DIR = path.join("source_content", "shingeki_no_kyojin", "videos");
const DEFAULT_JP_SUBS_DIR = path.join(
  "source_content",
  "shingeki_no_kyojin",
  "subs",
  "japanese",
);

function parseArgs(argv) {
  const args = {
    dirs: [DEFAULT_VIDEO_DIR, DEFAULT_JP_SUBS_DIR],
    recursive: true,
    overwrite: false,
    apply: false,
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
      case "dir":
        args.dirs.push(value);
        takeNext();
        break;
      case "dirs":
        args.dirs = String(value || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        takeNext();
        break;
      case "recursive":
        args.recursive = true;
        break;
      case "no-recursive":
        args.recursive = false;
        break;
      case "overwrite":
        args.overwrite = true;
        break;
      case "apply":
        args.apply = true;
        break;
      case "dryRun":
        args.apply = false;
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

  args.dirs = [...new Set(args.dirs)].filter(Boolean);
  if (args.dirs.length === 0) {
    throw new Error("No directories provided. Use --dir or --dirs.");
  }
  return args;
}

function printHelpAndExit(code) {
  const msg = `
Usage:
  node scripts/normalize-episode-names.js [options]

Defaults:
  - ${DEFAULT_VIDEO_DIR}
  - ${DEFAULT_JP_SUBS_DIR}

Options:
  --dir <path>         Add a directory (repeatable)
  --dirs a,b,c         Set directories as comma-separated list
  --recursive          Scan subfolders (default: on)
  --no-recursive       Only scan the top-level files in each directory
  --overwrite          Overwrite destination if it already exists
  --apply              Execute renames (default is dry-run)
  --dryRun             Print planned renames only
  --verbose            Print skipped-file diagnostics

Output format:
  Files are normalized to: s<season>e<episode><ext>
  Example: S02ep03.mkv -> s2e3.mkv
`;
  console.log(msg.trim() + "\n");
  process.exit(code);
}

function detectSeasonFromPath(filePath) {
  const parts = String(filePath).split(path.sep);
  for (const p of parts) {
    const m = p.match(/(?:season|s)\s*0*(\d{1,2})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseSeasonEpisode(filePath) {
  const base = path.basename(filePath, path.extname(filePath));

  const m1 = base.match(/s\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,3})/i);
  if (m1) {
    return { season: Number(m1[1]), episode: Number(m1[2]) };
  }

  const m2 = base.match(/(\d{1,2})x(\d{1,3})/i);
  if (m2) {
    return { season: Number(m2[1]), episode: Number(m2[2]) };
  }

  // Fallback for "03. title" style, if season is detectable in folder path.
  const m3 = base.match(/^\s*0*(\d{1,3})\s*[._ -]/);
  if (m3) {
    const season = detectSeasonFromPath(filePath);
    if (season != null) return { season, episode: Number(m3[1]) };
  }

  return null;
}

function listFiles(dir, recursive) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const curr = stack.pop();
    const entries = fs.readdirSync(curr, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(curr, e.name);
      if (e.isDirectory()) {
        if (recursive) stack.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.startsWith(".")) continue;
      out.push(p);
    }
  }
  out.sort();
  return out;
}

function canonicalPath(src) {
  const info = parseSeasonEpisode(src);
  if (!info) return null;
  if (!Number.isFinite(info.season) || !Number.isFinite(info.episode)) return null;
  if (info.season < 0 || info.episode < 0) return null;
  const ext = path.extname(src).toLowerCase();
  const base = `s${info.season}e${info.episode}`;
  return path.join(path.dirname(src), `${base}${ext}`);
}

function buildPlans(dirs, recursive, verbose) {
  const plans = [];
  const skippedNoPattern = [];
  let scanned = 0;

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      throw new Error(`Directory not found: ${dir}`);
    }
    const files = listFiles(dir, recursive);
    scanned += files.length;
    for (const src of files) {
      const dst = canonicalPath(src);
      if (!dst) {
        skippedNoPattern.push(src);
        continue;
      }
      if (src === dst) continue;
      plans.push({ src, dst });
    }
  }

  if (verbose && skippedNoPattern.length > 0) {
    for (const f of skippedNoPattern) console.log(`SKIP no season/episode pattern: ${f}`);
  }
  return { plans, scanned, skippedNoPattern };
}

function resolveConflicts(plans, overwrite) {
  const byDst = new Map();
  for (const p of plans) {
    const arr = byDst.get(p.dst) ?? [];
    arr.push(p);
    byDst.set(p.dst, arr);
  }

  const srcSet = new Set(plans.map((p) => p.src));
  const valid = [];
  const conflicts = [];

  for (const p of plans) {
    const sameTarget = byDst.get(p.dst) || [];
    if (sameTarget.length > 1) {
      conflicts.push({
        type: "duplicate_target",
        dst: p.dst,
        src: p.src,
      });
      continue;
    }

    const dstExists = fs.existsSync(p.dst);
    const dstIsAnotherSource = srcSet.has(p.dst);
    if (dstExists && !dstIsAnotherSource && !overwrite) {
      conflicts.push({
        type: "target_exists",
        dst: p.dst,
        src: p.src,
      });
      continue;
    }

    valid.push(p);
  }

  return { valid, conflicts };
}

function executeRenames(plans, overwrite) {
  const staged = [];

  try {
    for (const p of plans) {
      const tmp = `${p.src}.rename-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    // Best effort recovery for still-staged files.
    for (const p of staged) {
      if (fs.existsSync(p.tmp) && !fs.existsSync(p.src)) {
        try {
          fs.renameSync(p.tmp, p.src);
        } catch {
          // leave file in tmp path if recovery fails
        }
      }
    }
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv);
  const { plans, scanned, skippedNoPattern } = buildPlans(args.dirs, args.recursive, args.verbose);
  const { valid, conflicts } = resolveConflicts(plans, args.overwrite);

  for (const p of valid) {
    console.log(`RENAME ${p.src} -> ${p.dst}`);
  }

  if (conflicts.length > 0) {
    console.log("");
    console.log("Conflicts:");
    for (const c of conflicts) {
      if (c.type === "duplicate_target") {
        console.log(`  DUPLICATE TARGET ${c.src} -> ${c.dst}`);
      } else {
        console.log(`  TARGET EXISTS   ${c.src} -> ${c.dst}`);
      }
    }
  }

  if (args.apply && valid.length > 0) {
    executeRenames(valid, args.overwrite);
  }

  console.log("");
  console.log(`Done. Scanned: ${scanned}`);
  console.log(`Planned renames: ${plans.length}`);
  console.log(`Ready: ${valid.length}, conflicts: ${conflicts.length}`);
  console.log(`No pattern match: ${skippedNoPattern.length}`);
  console.log(args.apply ? "Mode: apply (changes written)" : "Mode: dry-run (no changes written)");
}

main();
