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
    anime_name_for_file,
    connect_db,
    ensure_dir,
    extract_dialogue_lines,
    is_content_token,
    iter_subtitle_files,
    resolve_default_corpus_dir,
    token_conj_form,
    token_conj_type,
    token_lemma,
    token_pos,
    token_reading,
    token_surface_key,
)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "out" / "corpus"
    parser = argparse.ArgumentParser(description="Build lemma/form stats from subtitle corpus.")
    parser.add_argument("--corpusDir", type=Path, default=resolve_default_corpus_dir())
    parser.add_argument("--db", type=Path, default=out_dir / "lemma_forms.sqlite")
    parser.add_argument("--jsonOut", type=Path, default=out_dir / "lemma_forms.json")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--no-resume", dest="resume", action="store_false")
    parser.add_argument("--limitFiles", type=int, default=0)
    parser.add_argument("--flushEvery", type=int, default=250)
    parser.add_argument("--topFormsPerLemma", type=int, default=40)
    parser.add_argument("--topAnimePerLemma", type=int, default=10)
    parser.add_argument("--printEvery", type=int, default=100)
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
        CREATE TABLE IF NOT EXISTS lemma_counts (
          lemma TEXT NOT NULL,
          pos TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (lemma, pos)
        );
        CREATE TABLE IF NOT EXISTS lemma_anime_counts (
          lemma TEXT NOT NULL,
          anime TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (lemma, anime)
        );
        CREATE TABLE IF NOT EXISTS form_counts (
          lemma TEXT NOT NULL,
          surface TEXT NOT NULL,
          reading TEXT NOT NULL,
          pos TEXT NOT NULL,
          conj_type TEXT NOT NULL,
          conj_form TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (lemma, surface, reading, pos, conj_type, conj_form)
        );
        CREATE INDEX IF NOT EXISTS idx_form_counts_surface ON form_counts(surface);
        CREATE INDEX IF NOT EXISTS idx_form_counts_lemma ON form_counts(lemma);
        CREATE INDEX IF NOT EXISTS idx_lemma_anime_counts_lemma ON lemma_anime_counts(lemma);
        """
    )
    conn.commit()


def processed_signature(conn, rel_path: str):
    row = conn.execute(
        "SELECT size, mtime FROM processed_files WHERE path = ?",
        (rel_path,),
    ).fetchone()
    return tuple(row) if row else None


def flush_batch(conn, batch_lemmas, batch_lemma_anime, batch_forms, processed_rows):
    with conn:
        conn.executemany(
            """
            INSERT INTO lemma_counts (lemma, pos, count)
            VALUES (?, ?, ?)
            ON CONFLICT(lemma, pos) DO UPDATE SET count = count + excluded.count
            """,
            ((lemma, pos, count) for (lemma, pos), count in batch_lemmas.items()),
        )
        conn.executemany(
            """
            INSERT INTO lemma_anime_counts (lemma, anime, count)
            VALUES (?, ?, ?)
            ON CONFLICT(lemma, anime) DO UPDATE SET count = count + excluded.count
            """,
            ((lemma, anime, count) for (lemma, anime), count in batch_lemma_anime.items()),
        )
        conn.executemany(
            """
            INSERT INTO form_counts (lemma, surface, reading, pos, conj_type, conj_form, count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lemma, surface, reading, pos, conj_type, conj_form)
            DO UPDATE SET count = count + excluded.count
            """,
            (
                (lemma, surface, reading, pos, conj_type, conj_form, count)
                for (lemma, surface, reading, pos, conj_type, conj_form), count in batch_forms.items()
            ),
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO processed_files (path, anime, size, mtime, processed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            processed_rows,
        )


def export_json(conn, json_out: Path, corpus_dir: Path, top_forms_per_lemma: int, top_anime_per_lemma: int):
    total_files = conn.execute("SELECT COUNT(*) FROM processed_files").fetchone()[0]
    total_lemmas = conn.execute("SELECT COUNT(*) FROM lemma_counts").fetchone()[0]
    total_forms = conn.execute("SELECT COUNT(*) FROM form_counts").fetchone()[0]

    lemma_rows = conn.execute(
        """
        SELECT lc.lemma, lc.pos, lc.count, COUNT(DISTINCT lac.anime) AS anime_count
        FROM lemma_counts lc
        LEFT JOIN lemma_anime_counts lac ON lac.lemma = lc.lemma
        GROUP BY lc.lemma, lc.pos, lc.count
        ORDER BY lc.count DESC, lc.lemma ASC
        """
    ).fetchall()

    lemmas = []
    for lemma, pos, count, anime_count in lemma_rows:
        forms = conn.execute(
            """
            SELECT surface, reading, conj_type, conj_form, count
            FROM form_counts
            WHERE lemma = ? AND pos = ?
            ORDER BY count DESC, LENGTH(surface) ASC, surface ASC
            LIMIT ?
            """,
            (lemma, pos, top_forms_per_lemma),
        ).fetchall()
        top_anime = conn.execute(
            """
            SELECT anime, count
            FROM lemma_anime_counts
            WHERE lemma = ?
            ORDER BY count DESC, anime ASC
            LIMIT ?
            """,
            (lemma, top_anime_per_lemma),
        ).fetchall()
        lemmas.append(
            {
                "lemma": lemma,
                "pos": pos,
                "totalCount": count,
                "animeCount": anime_count,
                "weight": round(count * math.log1p(anime_count or 0), 3),
                "topForms": [
                    {
                        "surface": surface,
                        "reading": reading,
                        "conjType": conj_type,
                        "conjForm": conj_form,
                        "count": form_count,
                    }
                    for surface, reading, conj_type, conj_form, form_count in forms
                ],
                "topAnime": [{"anime": anime, "count": anime_count_value} for anime, anime_count_value in top_anime],
            }
        )

    payload = {
        "meta": {
            "createdAt": datetime.now(UTC).isoformat(),
            "corpusDir": str(corpus_dir.resolve()),
            "processedFiles": total_files,
            "lemmaRows": total_lemmas,
            "formRows": total_forms,
            "tagger": "fugashi+unidic-lite",
        },
        "lemmas": lemmas,
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

    batch_lemmas: Counter = Counter()
    batch_lemma_anime: Counter = Counter()
    batch_forms: Counter = Counter()
    processed_rows = []

    processed_now = 0
    skipped = 0
    total_lines = 0
    total_tokens = 0

    for idx, file_path in enumerate(files, start=1):
        rel_path = str(file_path.relative_to(corpus_dir))
        stat = file_path.stat()
        signature = (stat.st_size, int(stat.st_mtime))
        if args.resume and processed_signature(conn, rel_path) == signature:
            skipped += 1
            continue

        anime = anime_name_for_file(corpus_dir, file_path)
        lines = extract_dialogue_lines(file_path)
        file_lemma_counts: Counter = Counter()

        for line in lines:
            total_lines += 1
            for token in tagger(line):
                if not is_content_token(token):
                    continue
                lemma = token_lemma(token)
                surface = token_surface_key(token)
                pos = token_pos(token)
                reading = token_reading(token)
                conj_type = token_conj_type(token)
                conj_form = token_conj_form(token)
                if not lemma or not surface:
                    continue
                batch_lemmas[(lemma, pos)] += 1
                batch_forms[(lemma, surface, reading, pos, conj_type, conj_form)] += 1
                file_lemma_counts[(lemma, anime)] += 1
                total_tokens += 1

        for key, count in file_lemma_counts.items():
            batch_lemma_anime[key] += count

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
            flush_batch(conn, batch_lemmas, batch_lemma_anime, batch_forms, processed_rows)
            batch_lemmas.clear()
            batch_lemma_anime.clear()
            batch_forms.clear()
            processed_rows.clear()

        if processed_now and processed_now % args.printEvery == 0:
            print(
                f"[lemma-forms] processed={processed_now} skipped={skipped} filesSeen={idx}/{len(files)} "
                f"lines={total_lines} tokens={total_tokens}"
            )

    if batch_lemmas or batch_forms or processed_rows:
        flush_batch(conn, batch_lemmas, batch_lemma_anime, batch_forms, processed_rows)

    export_json(conn, args.jsonOut.resolve(), corpus_dir, args.topFormsPerLemma, args.topAnimePerLemma)
    print(
        f"[lemma-forms] done processed={processed_now} skipped={skipped} "
        f"lines={total_lines} tokens={total_tokens} db={args.db} json={args.jsonOut}"
    )


if __name__ == "__main__":
    main()
