#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path
import sqlite3

import orjson


PRIMARY_WORDS_FILE = Path("source_content") / "all_anime_top_2000.match.first2000.json"
FALLBACK_WORDS_FILE = Path("source_content") / "all_anime_top_2000.json"
DEFAULT_JMDICT_FILE = Path("jmdict-simplified-flat-full.json")


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "out" / "corpus"
    parser = argparse.ArgumentParser(description="Promote lemma/forms/expressions into teachable targets.")
    parser.add_argument("--lemmaDb", type=Path, default=out_dir / "lemma_forms.sqlite")
    parser.add_argument("--expressionDb", type=Path, default=out_dir / "expression_candidates.sqlite")
    parser.add_argument("--wordsFile", type=Path, default=repo_root / PRIMARY_WORDS_FILE)
    parser.add_argument("--fallbackWordsFile", type=Path, default=repo_root / FALLBACK_WORDS_FILE)
    parser.add_argument("--jmdictFile", type=Path, default=repo_root / DEFAULT_JMDICT_FILE)
    parser.add_argument("--jsonOut", type=Path, default=out_dir / "promoted_targets.json")
    parser.add_argument("--maxTargets", type=int, default=10)
    parser.add_argument("--maxInflections", type=int, default=4)
    parser.add_argument("--maxRelated", type=int, default=3)
    parser.add_argument("--maxExpressions", type=int, default=3)
    parser.add_argument("--minExpressionCount", type=int, default=5)
    parser.add_argument("--minExpressionAnime", type=int, default=2)
    parser.add_argument("--topFormsPerWord", type=int, default=20)
    return parser.parse_args()


def read_json(path: Path):
    with path.open("rb") as fh:
        return orjson.loads(fh.read())


def load_words(words_file: Path, fallback_words_file: Path):
    file_to_use = words_file if words_file.exists() else fallback_words_file
    if not file_to_use.exists():
        raise SystemExit(f"Words file not found: {words_file} or {fallback_words_file}")
    data = read_json(file_to_use)
    return data if isinstance(data, list) else data.get("words", [])


def connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise SystemExit(f"DB not found: {path}")
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def load_jmdict_index(path: Path):
    data = read_json(path)
    by_surface = defaultdict(list)
    for entry in data:
        kanji_list = [str(x).strip() for x in entry.get("kanji", []) if str(x).strip()]
        kana_list = [str(x).strip() for x in entry.get("kana", []) if str(x).strip()]
        senses = entry.get("senses", [])
        for surface in kanji_list + kana_list:
            by_surface[surface].append(entry)
    return by_surface


def summarize_jmdict(entries):
    if not entries:
        return None
    entry = entries[0]
    senses = entry.get("senses", [])
    glosses = []
    pos = []
    tags = []
    for sense in senses[:3]:
        glosses.extend(sense.get("gloss", [])[:3])
        pos.extend(sense.get("pos", [])[:3])
        tags.extend(sense.get("tags", [])[:5])
    return {
        "kanji": entry.get("kanji", []),
        "kana": entry.get("kana", []),
        "gloss": glosses[:6],
        "pos": sorted(set(pos)),
        "tags": sorted(set(tags)),
    }


def pick_primary_lemma(conn: sqlite3.Connection, word: str):
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
        """,
        (word,),
    ).fetchall()
    return dict(rows[0]) if rows else None


def fetch_inflections(conn: sqlite3.Connection, lemma: str, pos: str, limit: int):
    return conn.execute(
        """
        SELECT surface,
               reading,
               conj_type,
               conj_form,
               SUM(count) AS count
        FROM form_counts
        WHERE lemma = ? AND pos = ?
        GROUP BY surface, reading, conj_type, conj_form
        ORDER BY count DESC, LENGTH(surface) ASC, surface ASC
        LIMIT ?
        """,
        (lemma, pos, limit),
    ).fetchall()


def fetch_related_lemmas(conn: sqlite3.Connection, seed_forms: list[str], primary_lemma: str, limit: int):
    if not seed_forms:
        return []
    placeholders = ",".join("?" for _ in seed_forms)
    rows = conn.execute(
        f"""
        SELECT surface,
               lemma,
               pos,
               MAX(reading) AS reading,
               SUM(count) AS count
        FROM form_counts
        WHERE surface IN ({placeholders}) AND lemma != ?
        GROUP BY surface, lemma, pos
        ORDER BY count DESC, surface ASC
        LIMIT ?
        """,
        (*seed_forms, primary_lemma, limit * 5),
    ).fetchall()

    deduped = []
    seen_surface = set()
    for row in rows:
        surface = row["surface"]
        if surface in seen_surface:
            continue
        seen_surface.add(surface)
        anime_count = conn.execute(
            "SELECT COUNT(*) FROM lemma_anime_counts WHERE lemma = ?",
            (row["lemma"],),
        ).fetchone()[0]
        deduped.append(
            {
                "surface": surface,
                "lemma": row["lemma"],
                "pos": row["pos"],
                "reading": row["reading"],
                "count": row["count"],
                "animeCount": anime_count,
                "weight": round(row["count"] * math.log1p(anime_count or 0), 3),
            }
        )
        if len(deduped) >= limit:
            break
    return deduped


def fetch_expressions(conn: sqlite3.Connection, lemma_terms: list[str], min_count: int, min_anime: int, limit: int):
    out = []
    seen_surface = set()
    for lemma in lemma_terms:
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
            WHERE ec.lemma_seq LIKE ?
            GROUP BY ec.surface, ec.lemma_seq, ec.reading_seq, ec.pos_seq, ec.token_count, ec.char_len, ec.count, ee.example, ee.anime, ee.source_file
            HAVING ec.count >= ? AND anime_count >= ?
            ORDER BY ec.count DESC, anime_count DESC, ec.surface ASC
            LIMIT ?
            """,
            (f"%{lemma}%", min_count, min_anime, limit * 8),
        ).fetchall()
        for row in rows:
            surface = row["surface"]
            if surface in seen_surface:
                continue
            seen_surface.add(surface)
            out.append(
                {
                    "surface": surface,
                    "lemmaSequence": row["lemma_seq"].split(" "),
                    "readingSequence": row["reading_seq"].split(" ") if row["reading_seq"] else [],
                    "posSequence": row["pos_seq"].split(" "),
                    "tokenCount": row["token_count"],
                    "charLen": row["char_len"],
                    "count": row["count"],
                    "animeCount": row["anime_count"],
                    "weight": round(row["count"] * math.log1p(row["anime_count"] or 0), 3),
                    "example": {
                        "text": row["example"],
                        "anime": row["example_anime"],
                        "sourceFile": row["source_file"],
                    }
                    if row["example"]
                    else None,
                }
            )
            if len(out) >= limit:
                return out
    return out[:limit]


def build_target_payload(word_entry, primary_lemma, inflections, related, expressions, jmdict_index, args):
    base_word = str(word_entry.get("word", "")).strip()
    base_reading = str(word_entry.get("reading", "")).strip()
    base_meaning = word_entry.get("meaning")
    seen = set()
    targets = []

    for row in inflections:
        surface = row["surface"]
        if not surface or surface in seen:
            continue
        seen.add(surface)
        target_type = "base" if surface in {base_word, primary_lemma["lemma"]} else "inflection"
        targets.append(
            {
                "type": target_type,
                "surface": surface,
                "lemma": primary_lemma["lemma"],
                "reading": row["reading"] or base_reading,
                "meaning": base_meaning,
                "count": row["count"],
                "weight": round(row["count"], 3),
                "conjType": row["conj_type"],
                "conjForm": row["conj_form"],
                "source": "lemma_forms",
            }
        )
        if len([t for t in targets if t["type"] in {"base", "inflection"}]) >= args.maxInflections:
            break

    for row in related:
        surface = row["surface"]
        if not surface or surface in seen:
            continue
        seen.add(surface)
        jm = summarize_jmdict(jmdict_index.get(surface))
        targets.append(
            {
                "type": "relatedLemma",
                "surface": surface,
                "lemma": row["lemma"],
                "reading": row["reading"] or (jm["kana"][0] if jm and jm.get("kana") else ""),
                "meaning": jm["gloss"] if jm else None,
                "count": row["count"],
                "animeCount": row["animeCount"],
                "weight": row["weight"],
                "source": "match_forms+lemma_forms",
                "jmdict": jm,
            }
        )
        if len([t for t in targets if t["type"] == "relatedLemma"]) >= args.maxRelated:
            break

    for row in expressions:
        surface = row["surface"]
        if not surface or surface in seen:
            continue
        seen.add(surface)
        jm = summarize_jmdict(jmdict_index.get(surface))
        targets.append(
            {
                "type": "expression",
                "surface": surface,
                "lemmaSequence": row["lemmaSequence"],
                "readingSequence": row["readingSequence"],
                "meaning": jm["gloss"] if jm else None,
                "count": row["count"],
                "animeCount": row["animeCount"],
                "weight": row["weight"],
                "source": "expression_candidates",
                "example": row["example"],
                "jmdict": jm,
            }
        )
        if len([t for t in targets if t["type"] == "expression"]) >= args.maxExpressions:
            break

    return targets[: args.maxTargets]


def main():
    args = parse_args()
    words = load_words(args.wordsFile.resolve(), args.fallbackWordsFile.resolve())
    lemma_conn = connect(args.lemmaDb.resolve())
    expr_conn = connect(args.expressionDb.resolve())
    jmdict_index = load_jmdict_index(args.jmdictFile.resolve())

    promoted = []
    unmatched = []

    for idx, word_entry in enumerate(words, start=1):
        base_word = str(word_entry.get("word", "")).strip()
        if not base_word:
            continue
        primary_lemma = pick_primary_lemma(lemma_conn, base_word)
        if not primary_lemma:
            unmatched.append(base_word)
            continue

        inflections = fetch_inflections(
            lemma_conn,
            primary_lemma["lemma"],
            primary_lemma["pos"],
            args.topFormsPerWord,
        )
        seed_forms = [base_word]
        match = word_entry.get("match") or {}
        for form in match.get("forms", []) or []:
            form = str(form).strip()
            if form and form not in seed_forms:
                seed_forms.append(form)

        related = fetch_related_lemmas(
            lemma_conn,
            seed_forms,
            primary_lemma["lemma"],
            args.maxRelated,
        )
        lemma_terms = [primary_lemma["lemma"], *(row["lemma"] for row in related[: args.maxRelated])]
        expressions = fetch_expressions(
            expr_conn,
            lemma_terms,
            args.minExpressionCount,
            args.minExpressionAnime,
            args.maxExpressions,
        )

        targets = build_target_payload(word_entry, primary_lemma, inflections, related, expressions, jmdict_index, args)
        promoted.append(
            {
                "index": idx,
                "word": base_word,
                "reading": word_entry.get("reading"),
                "meaning": word_entry.get("meaning"),
                "primaryLemma": primary_lemma,
                "targets": targets,
            }
        )

    payload = {
        "meta": {
            "createdAt": datetime.now(UTC).isoformat(),
            "lemmaDb": str(args.lemmaDb.resolve()),
            "expressionDb": str(args.expressionDb.resolve()),
            "wordsFile": str((args.wordsFile if args.wordsFile.exists() else args.fallbackWordsFile).resolve()),
            "jmdictFile": str(args.jmdictFile.resolve()),
            "maxTargets": args.maxTargets,
            "maxInflections": args.maxInflections,
            "maxRelated": args.maxRelated,
            "maxExpressions": args.maxExpressions,
            "minExpressionCount": args.minExpressionCount,
            "minExpressionAnime": args.minExpressionAnime,
        },
        "summary": {
            "words": len(promoted),
            "unmatchedWords": len(unmatched),
        },
        "unmatchedWords": unmatched,
        "words": promoted,
    }
    args.jsonOut.parent.mkdir(parents=True, exist_ok=True)
    args.jsonOut.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))
    print(f"[promote-targets] wrote {args.jsonOut} words={len(promoted)} unmatched={len(unmatched)}")


if __name__ == "__main__":
    main()
