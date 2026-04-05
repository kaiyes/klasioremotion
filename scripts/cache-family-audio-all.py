#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
WORDS_FILE = REPO_ROOT / "source_content" / "all_anime_top_2000.match.first2000.json"
DEFAULT_DONE_DIR = REPO_ROOT / "out" / "family_audio_cache" / "_done"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run family audio cache pass for the whole word list with resume markers."
    )
    parser.add_argument("--wordsFile", type=Path, default=WORDS_FILE)
    parser.add_argument("--top", type=int, default=6)
    parser.add_argument("--start", type=int, default=1, help="1-based inclusive start index")
    parser.add_argument("--count", type=int, default=0, help="0 means all remaining words")
    parser.add_argument("--doneDir", type=Path, default=DEFAULT_DONE_DIR)
    parser.add_argument("--subsDir", default="")
    parser.add_argument("--enSubsDir", default="")
    parser.add_argument("--videosDir", default="")
    parser.add_argument("--cacheDir", default="")
    parser.add_argument("--outDir", default="")
    parser.add_argument("--outputDir", default="")
    parser.add_argument("--avWhisperModel", default="")
    parser.add_argument("--avWhisperLanguage", default="")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def load_words(path: Path) -> list[str]:
    with path.open("r", encoding="utf8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise SystemExit(f"Words file must be a JSON array: {path}")
    out = []
    for item in data:
        if isinstance(item, str):
            word = item.strip()
        else:
            word = str((item or {}).get("word") or "").strip()
        if word:
            out.append(word)
    return out


def safe_name(text: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in text).strip("._") or "item"


def done_path(done_dir: Path, index: int, word: str) -> Path:
    return done_dir / f"{index:04d}_{safe_name(word)}.done"


def main() -> None:
    args = parse_args()
    words = load_words(args.wordsFile.resolve())
    if not words:
        raise SystemExit("No words found.")

    start_idx = max(1, int(args.start))
    if start_idx > len(words):
        raise SystemExit(f"--start {start_idx} is beyond words list length {len(words)}")
    end_idx = len(words) if args.count <= 0 else min(len(words), start_idx + int(args.count) - 1)

    args.doneDir.mkdir(parents=True, exist_ok=True)
    failures: list[tuple[int, str, int]] = []
    completed = 0
    skipped = 0
    total = end_idx - start_idx + 1

    for idx in range(start_idx, end_idx + 1):
        word = words[idx - 1]
        marker = done_path(args.doneDir, idx, word)
        if marker.exists() and not args.force:
            skipped += 1
            print(f"[{idx}/{len(words)}] {word} -> skip(done)")
            continue

        print(f"[{idx}/{len(words)}] {word} -> cache")
        cmd = [
            "npm",
            "run",
            "-s",
            "family:shorts",
            "--",
            "--word",
            word,
            "--top",
            str(args.top),
            "--cacheOnly",
        ]
        if args.subsDir:
            cmd.extend(["--subsDir", args.subsDir])
        if args.enSubsDir:
            cmd.extend(["--enSubsDir", args.enSubsDir])
        if args.videosDir:
            cmd.extend(["--videosDir", args.videosDir])
        if args.cacheDir:
            cmd.extend(["--cacheDir", args.cacheDir])
        if args.outDir:
            cmd.extend(["--outDir", args.outDir])
        if args.outputDir:
            cmd.extend(["--outputDir", args.outputDir])
        if args.avWhisperModel:
            cmd.extend(["--avWhisperModel", args.avWhisperModel])
        if args.avWhisperLanguage:
            cmd.extend(["--avWhisperLanguage", args.avWhisperLanguage])
        if args.verbose:
            cmd.append("--verbose")
        res = subprocess.run(cmd, cwd=str(REPO_ROOT))
        if res.returncode == 0:
            marker.write_text("ok\n", encoding="utf8")
            completed += 1
        else:
            failures.append((idx, word, res.returncode))
            print(f"[{idx}/{len(words)}] {word} -> fail(exit={res.returncode})", file=sys.stderr)

    print("")
    print(
        f"[family-audio-all] total={total} completed={completed} skipped={skipped} failed={len(failures)}"
    )
    for idx, word, code in failures[:50]:
        print(f"  failed: [{idx}] {word} exit={code}")


if __name__ == "__main__":
    main()
