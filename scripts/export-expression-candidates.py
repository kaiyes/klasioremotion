#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "out" / "corpus"
    parser = argparse.ArgumentParser(description="Export exact-surface expression candidates from the expression DB.")
    parser.add_argument("--expressionDb", type=Path, default=out_dir / "expression_candidates.sqlite")
    parser.add_argument("--surface", action="append", default=[])
    parser.add_argument("--outFile", type=Path, default=out_dir / "expression_export.json")
    parser.add_argument("--limit", type=int, default=200)
    return parser.parse_args()


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def fetch_surface(conn: sqlite3.Connection, surface: str, limit: int):
    rows = conn.execute(
        """
        SELECT ec.surface,
               ec.lemma_seq,
               ec.reading_seq,
               ec.pos_seq,
               ec.token_count,
               ec.char_len,
               ec.count,
               COUNT(DISTINCT eac.anime) AS anime_count,
               ee.example,
               ee.anime AS example_anime,
               ee.source_file
        FROM expression_counts ec
        LEFT JOIN expression_anime_counts eac
          ON eac.surface = ec.surface AND eac.lemma_seq = ec.lemma_seq
        LEFT JOIN expression_examples ee
          ON ee.surface = ec.surface AND ee.lemma_seq = ec.lemma_seq
        WHERE ec.surface = ?
        GROUP BY ec.surface, ec.lemma_seq, ec.reading_seq, ec.pos_seq, ec.token_count, ec.char_len, ec.count, ee.example, ee.anime, ee.source_file
        ORDER BY ec.count DESC, anime_count DESC, ec.surface ASC
        LIMIT ?
        """,
        (surface, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def main():
    args = parse_args()
    if not args.surface:
        raise SystemExit("--surface is required at least once")
    conn = connect(args.expressionDb.resolve())
    payload = {
        "meta": {
            "db": str(args.expressionDb.resolve()),
            "limit": args.limit,
        },
        "surfaces": {
            surface: fetch_surface(conn, surface, args.limit) for surface in args.surface
        },
    }
    args.outFile.parent.mkdir(parents=True, exist_ok=True)
    args.outFile.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf8")
    print(f"[expression-export] wrote {args.outFile}")


if __name__ == "__main__":
    main()
