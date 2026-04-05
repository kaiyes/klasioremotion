#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


PRIMARY_WORDS_FILE = Path("source_content") / "all_anime_top_2000.match.first2000.json"
FALLBACK_WORDS_FILE = Path("source_content") / "all_anime_top_2000.json"


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "out" / "corpus"
    parser = argparse.ArgumentParser(description="Show mined lemma/forms and exact expression hits for a word.")
    parser.add_argument("--word", required=True)
    parser.add_argument("--lemmaDb", type=Path, default=out_dir / "lemma_forms.sqlite")
    parser.add_argument("--expressionDb", type=Path, default=out_dir / "expression_candidates.sqlite")
    parser.add_argument("--wordsFile", type=Path, default=repo_root / PRIMARY_WORDS_FILE)
    parser.add_argument("--fallbackWordsFile", type=Path, default=repo_root / FALLBACK_WORDS_FILE)
    parser.add_argument("--topForms", type=int, default=15)
    parser.add_argument("--topRelated", type=int, default=10)
    parser.add_argument("--topExpressions", type=int, default=20)
    parser.add_argument("--extraSurface", action="append", default=[])
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def load_words(words_file: Path, fallback_words_file: Path):
    file_to_use = words_file if words_file.exists() else fallback_words_file
    if not file_to_use.exists():
        return []
    with file_to_use.open("r", encoding="utf8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else data.get("words", [])


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def word_entry(words, word: str):
    for item in words:
        if str(item.get("word", "")).strip() == word:
            return item
    return None


def find_primary_lemma(conn: sqlite3.Connection, word: str):
    rows = conn.execute(
        """
        SELECT lemma, pos, count
        FROM lemma_counts
        WHERE lemma = ?
        ORDER BY count DESC
        """,
        (word,),
    ).fetchall()
    if rows:
        return dict(rows[0])
    rows = conn.execute(
        """
        SELECT lemma, pos, SUM(count) AS count
        FROM form_counts
        WHERE surface = ?
        GROUP BY lemma, pos
        ORDER BY count DESC, lemma ASC
        LIMIT 1
        """,
        (word,),
    ).fetchall()
    return dict(rows[0]) if rows else None


def top_forms(conn: sqlite3.Connection, lemma: str, pos: str, limit: int):
    rows = conn.execute(
        """
        SELECT surface, reading, conj_type, conj_form, SUM(count) AS count
        FROM form_counts
        WHERE lemma = ? AND pos = ?
        GROUP BY surface, reading, conj_type, conj_form
        ORDER BY count DESC, LENGTH(surface) ASC, surface ASC
        LIMIT ?
        """,
        (lemma, pos, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def related_lemmas(conn: sqlite3.Connection, surfaces: list[str], primary_lemma: str, limit: int):
    if not surfaces:
        return []
    placeholders = ",".join("?" for _ in surfaces)
    rows = conn.execute(
        f"""
        SELECT surface, lemma, pos, MAX(reading) AS reading, SUM(count) AS count
        FROM form_counts
        WHERE surface IN ({placeholders}) AND lemma != ?
        GROUP BY surface, lemma, pos
        ORDER BY count DESC, surface ASC
        LIMIT ?
        """,
        (*surfaces, primary_lemma, limit * 5),
    ).fetchall()
    out = []
    seen = set()
    for row in rows:
        key = (row["surface"], row["lemma"])
        if key in seen:
            continue
        seen.add(key)
        anime_count = conn.execute(
            "SELECT COUNT(*) FROM lemma_anime_counts WHERE lemma = ?",
            (row["lemma"],),
        ).fetchone()[0]
        item = dict(row)
        item["anime_count"] = anime_count
        out.append(item)
        if len(out) >= limit:
            break
    return out


def exact_expression_hits(conn: sqlite3.Connection, surfaces: list[str], limit: int):
    out = []
    for surface in surfaces:
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
                   ee.anime AS example_anime
            FROM expression_counts ec
            LEFT JOIN expression_anime_counts eac
              ON eac.surface = ec.surface AND eac.lemma_seq = ec.lemma_seq
            LEFT JOIN expression_examples ee
              ON ee.surface = ec.surface AND ee.lemma_seq = ec.lemma_seq
            WHERE ec.surface = ?
            GROUP BY ec.surface, ec.lemma_seq, ec.reading_seq, ec.pos_seq, ec.token_count, ec.char_len, ec.count, ee.example, ee.anime
            ORDER BY ec.count DESC, anime_count DESC, ec.surface ASC
            LIMIT ?
            """,
            (surface, limit),
        ).fetchall()
        out.extend(dict(row) for row in rows)
    out.sort(key=lambda row: (-row["count"], -row["anime_count"], row["surface"]))
    return out[:limit]


def build_surface_seed_list(entry, primary_word: str, forms: list[dict], extra_surfaces: list[str]):
    seeds = [primary_word]
    if entry:
        for form in (entry.get("match") or {}).get("forms", []) or []:
            form = str(form).strip()
            if form and form not in seeds:
                seeds.append(form)
    for row in forms:
        surface = str(row.get("surface", "")).strip()
        if surface and surface not in seeds:
            seeds.append(surface)
    for surface in extra_surfaces:
        surface = str(surface).strip()
        if surface and surface not in seeds:
            seeds.append(surface)
    return seeds


def main():
    args = parse_args()
    words = load_words(args.wordsFile.resolve(), args.fallbackWordsFile.resolve())
    lemma_conn = connect(args.lemmaDb.resolve())
    expr_conn = connect(args.expressionDb.resolve())

    entry = word_entry(words, args.word)
    primary = find_primary_lemma(lemma_conn, args.word)
    if not primary:
        raise SystemExit(f'No lemma/form data found for "{args.word}"')

    forms = top_forms(lemma_conn, primary["lemma"], primary["pos"], args.topForms)
    seed_surfaces = build_surface_seed_list(entry, args.word, forms, args.extraSurface)
    related = related_lemmas(lemma_conn, seed_surfaces, primary["lemma"], args.topRelated)
    expression_hits = exact_expression_hits(expr_conn, seed_surfaces, args.topExpressions)

    payload = {
        "word": args.word,
        "wordEntry": entry,
        "primaryLemma": primary,
        "topForms": forms,
        "relatedLemmas": related,
        "seedSurfaces": seed_surfaces,
        "exactExpressionHits": expression_hits,
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    print(f'Word: {args.word}')
    print(f'Primary lemma: {primary["lemma"]} ({primary["pos"]}) count={primary["count"]}')
    if entry:
        print(f'Reading: {entry.get("reading","")}  Meaning: {entry.get("meaning","")}')
    print("")
    print("Top forms:")
    for row in forms:
        print(
            f'  {row["surface"]:<12} count={row["count"]:<8} reading={row["reading"] or "-":<10} '
            f'conj={row["conj_type"] or "-"}/{row["conj_form"] or "-"}'
        )
    print("")
    print("Related lemmas:")
    for row in related:
        print(
            f'  {row["surface"]:<12} -> {row["lemma"]} ({row["pos"]}) '
            f'count={row["count"]:<8} anime={row["anime_count"]}'
        )
    print("")
    print("Exact expression hits:")
    for row in expression_hits:
        example = (row.get("example") or "").strip()
        if len(example) > 80:
            example = example[:77] + "..."
        print(
            f'  {row["surface"]:<12} count={row["count"]:<8} anime={row["anime_count"]:<5} '
            f'lemmas={row["lemma_seq"]}  example={example}'
        )


if __name__ == "__main__":
    main()
