#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
from collections import Counter
from datetime import datetime, UTC
from pathlib import Path

import orjson
from fugashi import Tagger

from corpus_mining_utils import (
    BANNED_EDGE_POS,
    BANNED_INTERNAL_POS,
    CONTENT_POS,
    anime_name_for_file,
    connect_db,
    ensure_dir,
    extract_dialogue_lines,
    has_japanese,
    is_expression_end_token,
    iter_subtitle_files,
    resolve_default_corpus_dir,
    token_lemma,
    token_pos,
    token_reading,
    token_surface_key,
)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "out" / "corpus"
    parser = argparse.ArgumentParser(description="Build recurring expression candidates from subtitle corpus.")
    parser.add_argument("--corpusDir", type=Path, default=resolve_default_corpus_dir())
    parser.add_argument("--db", type=Path, default=out_dir / "expression_candidates.sqlite")
    parser.add_argument("--jsonOut", type=Path, default=out_dir / "expression_candidates.json")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--no-resume", dest="resume", action="store_false")
    parser.add_argument("--limitFiles", type=int, default=0)
    parser.add_argument("--flushEvery", type=int, default=150)
    parser.add_argument("--printEvery", type=int, default=50)
    parser.add_argument("--maxWindow", type=int, default=6)
    parser.add_argument("--minChars", type=int, default=3)
    parser.add_argument("--maxChars", type=int, default=18)
    parser.add_argument("--minCount", type=int, default=3)
    parser.add_argument("--topAnimePerExpression", type=int, default=8)
    return parser.parse_args()


def init_db(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS processed_files (
          path TEXT PRIMARY KEY,
          anime TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          processed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS expression_counts (
          surface TEXT NOT NULL,
          lemma_seq TEXT NOT NULL,
          reading_seq TEXT NOT NULL,
          pos_seq TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          char_len INTEGER NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (surface, lemma_seq)
        );
        CREATE TABLE IF NOT EXISTS expression_anime_counts (
          surface TEXT NOT NULL,
          lemma_seq TEXT NOT NULL,
          anime TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (surface, lemma_seq, anime)
        );
        CREATE TABLE IF NOT EXISTS expression_examples (
          surface TEXT NOT NULL,
          lemma_seq TEXT NOT NULL,
          example TEXT NOT NULL,
          anime TEXT NOT NULL,
          source_file TEXT NOT NULL,
          PRIMARY KEY (surface, lemma_seq)
        );
        CREATE INDEX IF NOT EXISTS idx_expression_counts_surface ON expression_counts(surface);
        CREATE INDEX IF NOT EXISTS idx_expression_counts_lemma_seq ON expression_counts(lemma_seq);
        CREATE INDEX IF NOT EXISTS idx_expression_anime_counts_surface ON expression_anime_counts(surface, lemma_seq);
        """
    )
    conn.commit()


def processed_signature(conn, rel_path: str):
    row = conn.execute(
        "SELECT size, mtime FROM processed_files WHERE path = ?",
        (rel_path,),
    ).fetchone()
    return tuple(row) if row else None


def expression_windows(tokens, max_window: int, min_chars: int, max_chars: int):
    out = []
    n = len(tokens)
    for end in range(n):
        if not is_expression_end_token(tokens[end]):
            continue
        for start in range(max(0, end - max_window + 1), end):
            segment = tokens[start : end + 1]
            if len(segment) < 2:
                continue
            first_pos = token_pos(segment[0])
            last_pos = token_pos(segment[-1])
            if first_pos in BANNED_EDGE_POS or last_pos in {"助詞", "補助記号", "記号"}:
                continue
            if any(token_pos(tok) in BANNED_INTERNAL_POS for tok in segment):
                continue
            if not any(token_pos(tok) in CONTENT_POS for tok in segment):
                continue
            surface = "".join(token_surface_key(tok) for tok in segment).strip()
            if not surface or not has_japanese(surface):
                continue
            char_len = len(surface)
            if char_len < min_chars or char_len > max_chars:
                continue
            lemma_seq = " ".join(token_lemma(tok) for tok in segment)
            reading_seq = " ".join(token_reading(tok) for tok in segment if token_reading(tok))
            pos_seq = " ".join(token_pos(tok) for tok in segment)
            out.append(
                {
                    "surface": surface,
                    "lemma_seq": lemma_seq,
                    "reading_seq": reading_seq,
                    "pos_seq": pos_seq,
                    "token_count": len(segment),
                    "char_len": char_len,
                }
            )
    return out


def flush_batch(conn, batch_expr, batch_expr_anime, batch_examples, processed_rows):
    with conn:
        conn.executemany(
            """
            INSERT INTO expression_counts (surface, lemma_seq, reading_seq, pos_seq, token_count, char_len, count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(surface, lemma_seq)
            DO UPDATE SET count = count + excluded.count
            """,
            (
                (
                    surface,
                    lemma_seq,
                    meta["reading_seq"],
                    meta["pos_seq"],
                    meta["token_count"],
                    meta["char_len"],
                    meta["count"],
                )
                for (surface, lemma_seq), meta in batch_expr.items()
            ),
        )
        conn.executemany(
            """
            INSERT INTO expression_anime_counts (surface, lemma_seq, anime, count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(surface, lemma_seq, anime)
            DO UPDATE SET count = count + excluded.count
            """,
            (
                (surface, lemma_seq, anime, count)
                for (surface, lemma_seq, anime), count in batch_expr_anime.items()
            ),
        )
        conn.executemany(
            """
            INSERT OR IGNORE INTO expression_examples (surface, lemma_seq, example, anime, source_file)
            VALUES (?, ?, ?, ?, ?)
            """,
            batch_examples,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO processed_files (path, anime, size, mtime, processed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            processed_rows,
        )


def export_json(conn, json_out: Path, corpus_dir: Path, min_count: int, top_anime_per_expression: int):
    expr_rows = conn.execute(
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
               ee.anime,
               ee.source_file
        FROM expression_counts ec
        LEFT JOIN expression_anime_counts eac
          ON eac.surface = ec.surface AND eac.lemma_seq = ec.lemma_seq
        LEFT JOIN expression_examples ee
          ON ee.surface = ec.surface AND ee.lemma_seq = ec.lemma_seq
        WHERE ec.count >= ?
        GROUP BY ec.surface, ec.lemma_seq, ec.reading_seq, ec.pos_seq, ec.token_count, ec.char_len, ec.count, ee.example, ee.anime, ee.source_file
        ORDER BY ec.count DESC, anime_count DESC, ec.surface ASC
        """,
        (min_count,),
    ).fetchall()

    expressions = []
    for surface, lemma_seq, reading_seq, pos_seq, token_count, char_len, count, anime_count, example, example_anime, source_file in expr_rows:
        top_anime = conn.execute(
            """
            SELECT anime, count
            FROM expression_anime_counts
            WHERE surface = ? AND lemma_seq = ?
            ORDER BY count DESC, anime ASC
            LIMIT ?
            """,
            (surface, lemma_seq, top_anime_per_expression),
        ).fetchall()
        expressions.append(
            {
                "surface": surface,
                "lemmaSequence": lemma_seq.split(" "),
                "readingSequence": reading_seq.split(" ") if reading_seq else [],
                "posSequence": pos_seq.split(" "),
                "tokenCount": token_count,
                "charLen": char_len,
                "totalCount": count,
                "animeCount": anime_count,
                "weight": round(count * math.log1p(anime_count or 0), 3),
                "topAnime": [{"anime": anime, "count": anime_count_value} for anime, anime_count_value in top_anime],
                "example": {
                    "text": example,
                    "anime": example_anime,
                    "sourceFile": source_file,
                }
                if example
                else None,
            }
        )

    payload = {
        "meta": {
            "createdAt": datetime.now(UTC).isoformat(),
            "corpusDir": str(corpus_dir.resolve()),
            "processedFiles": conn.execute("SELECT COUNT(*) FROM processed_files").fetchone()[0],
            "expressionRows": conn.execute("SELECT COUNT(*) FROM expression_counts").fetchone()[0],
            "minCount": min_count,
            "tagger": "fugashi+unidic-lite",
        },
        "expressions": expressions,
    }
    ensure_dir(json_out.parent)
    json_out.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))


def main():
    args = parse_args()
    corpus_dir = args.corpusDir.resolve()
    if not corpus_dir.exists():
        raise SystemExit(f"corpusDir not found: {corpus_dir}")

    conn = connect_db(args.db.resolve())
    init_db(conn)
    tagger = Tagger()

    files = list(iter_subtitle_files(corpus_dir))
    if args.limitFiles > 0:
        files = files[: args.limitFiles]

    batch_expr: dict[tuple[str, str], dict] = {}
    batch_expr_anime: Counter = Counter()
    batch_examples: list[tuple[str, str, str, str, str]] = []
    processed_rows = []

    processed_now = 0
    skipped = 0
    total_lines = 0
    total_candidates = 0

    for idx, file_path in enumerate(files, start=1):
        rel_path = str(file_path.relative_to(corpus_dir))
        stat = file_path.stat()
        signature = (stat.st_size, int(stat.st_mtime))
        if args.resume and processed_signature(conn, rel_path) == signature:
            skipped += 1
            continue

        anime = anime_name_for_file(corpus_dir, file_path)
        lines = extract_dialogue_lines(file_path)
        for line in lines:
            total_lines += 1
            tokens = [tok for tok in tagger(line) if has_japanese(token_surface_key(tok))]
            for expr in expression_windows(tokens, args.maxWindow, args.minChars, args.maxChars):
                key = (expr["surface"], expr["lemma_seq"])
                existing = batch_expr.get(key)
                if existing is None:
                    batch_expr[key] = {
                        "reading_seq": expr["reading_seq"],
                        "pos_seq": expr["pos_seq"],
                        "token_count": expr["token_count"],
                        "char_len": expr["char_len"],
                        "count": 1,
                    }
                    batch_examples.append((expr["surface"], expr["lemma_seq"], line, anime, rel_path))
                else:
                    existing["count"] += 1
                batch_expr_anime[(expr["surface"], expr["lemma_seq"], anime)] += 1
                total_candidates += 1

        processed_rows.append(
            (
                rel_path,
                anime,
                signature[0],
                signature[1],
                datetime.now(UTC).isoformat(),
            )
        )
        processed_now += 1

        if processed_now % args.flushEvery == 0:
            flush_batch(conn, batch_expr, batch_expr_anime, batch_examples, processed_rows)
            batch_expr.clear()
            batch_expr_anime.clear()
            batch_examples.clear()

        if processed_now and processed_now % args.printEvery == 0:
            print(
                f"[expressions] processed={processed_now} skipped={skipped} filesSeen={idx}/{len(files)} "
                f"lines={total_lines} candidates={total_candidates}"
            )

    if batch_expr or processed_rows:
        flush_batch(conn, batch_expr, batch_expr_anime, batch_examples, processed_rows)

    export_json(conn, args.jsonOut.resolve(), corpus_dir, args.minCount, args.topAnimePerExpression)
    print(
        f"[expressions] done processed={processed_now} skipped={skipped} "
        f"lines={total_lines} candidates={total_candidates} db={args.db} json={args.jsonOut}"
    )


if __name__ == "__main__":
    main()
