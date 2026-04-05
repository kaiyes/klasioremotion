#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shlex
import sqlite3
import subprocess
from pathlib import Path


PRIMARY_WORDS_FILE = Path("source_content") / "all_anime_top_2000.match.first2000.json"
FALLBACK_WORDS_FILE = Path("source_content") / "all_anime_top_2000.json"
JMDICT_FILE = Path("jmdict-simplified-flat-full.json")

JP_REPO_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    out_dir = JP_REPO_ROOT / "out" / "corpus"
    parser = argparse.ArgumentParser(
        description="Generate multiple strict family/related/expression shorts for a base word."
    )
    parser.add_argument("--word", required=True)
    parser.add_argument("--lemmaDb", type=Path, default=out_dir / "lemma_forms.sqlite")
    parser.add_argument("--expressionDb", type=Path, default=out_dir / "expression_candidates.sqlite")
    parser.add_argument("--wordsFile", type=Path, default=JP_REPO_ROOT / PRIMARY_WORDS_FILE)
    parser.add_argument("--fallbackWordsFile", type=Path, default=JP_REPO_ROOT / FALLBACK_WORDS_FILE)
    parser.add_argument("--jmdictFile", type=Path, default=JP_REPO_ROOT / JMDICT_FILE)
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--clips", type=int, default=5)
    parser.add_argument("--maxInflections", type=int, default=3)
    parser.add_argument("--maxRelated", type=int, default=3)
    parser.add_argument("--maxDerived", type=int, default=2)
    parser.add_argument("--maxExpressions", type=int, default=0)
    parser.add_argument("--minFormCount", type=int, default=1000)
    parser.add_argument("--minRelatedCount", type=int, default=800)
    parser.add_argument("--minRelatedAnime", type=int, default=40)
    parser.add_argument("--minExpressionCount", type=int, default=120)
    parser.add_argument("--minExpressionAnime", type=int, default=20)
    parser.add_argument("--extraTarget", action="append", default=[])
    parser.add_argument(
        "--onlyKinds",
        action="append",
        default=[],
        help='Limit targets by type, e.g. --onlyKinds base or --onlyKinds inflection,related',
    )
    parser.add_argument(
        "--setMeaning",
        action="append",
        default=[],
        help='Override one target meaning: --setMeaning "思っ=thought"',
    )
    parser.add_argument("--outDir", default="out/shorts_work")
    parser.add_argument("--outputDir", default="out/testEval")
    parser.add_argument("--cacheDir", default="out/family_audio_cache")
    parser.add_argument("--subsDir", default="source_content/shingeki_no_kyojin/subs/japanese")
    parser.add_argument("--enSubsDir", default="source_content/shingeki_no_kyojin/subs/english_embedded")
    parser.add_argument("--videosDir", default="source_content/shingeki_no_kyojin/videos")
    parser.add_argument("--layout", default="standard")
    parser.add_argument("--prePadMs", type=int, default=1700)
    parser.add_argument("--postPadMs", type=int, default=1700)
    parser.add_argument("--maxClipMs", type=int, default=3200)
    parser.add_argument("--longPolicy", default="shrink")
    parser.add_argument("--avMinAsrSim", type=float, default=0.70)
    parser.add_argument("--avMaxSwapCandidates", type=int, default=2)
    parser.add_argument("--avWhisperModel", default="/home/kaiyes/projects/whisper.cpp/models/ggml-base.bin")
    parser.add_argument("--avWhisperLanguage", default="Japanese")
    parser.add_argument("--withVision", action="store_true")
    parser.add_argument("--cacheOnly", action="store_true", help="Run audio-only AV family pass and save candidate JSON, do not render.")
    parser.add_argument("--useCache", action="store_true", help="Render from saved family audio cache instead of running live AV.")
    parser.add_argument("--strict", action="store_true", help="Stop on first render failure.")
    parser.add_argument("--dryRun", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def load_json(path: Path):
    with path.open("r", encoding="utf8") as fh:
        return json.load(fh)


def parse_override_map(pairs: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in pairs or []:
        txt = str(raw or "").strip()
        if not txt or "=" not in txt:
            continue
        k, v = txt.split("=", 1)
        key = str(k).strip()
        val = str(v).strip()
        if key and val:
            out[key] = val
    return out


def parse_kind_filter(values: list[str]) -> set[str]:
    out: set[str] = set()
    for raw in values or []:
        txt = str(raw or "").strip()
        if not txt:
            continue
        for part in txt.split(","):
            kind = str(part or "").strip().lower()
            if kind:
                out.add(kind)
    return out


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def load_words(words_file: Path, fallback_words_file: Path):
    file_to_use = words_file if words_file.exists() else fallback_words_file
    if not file_to_use.exists():
        return []
    data = load_json(file_to_use)
    return data if isinstance(data, list) else data.get("words", [])


def find_word_entry(words, word: str):
    for item in words:
        if str(item.get("word", "")).strip() == word:
            return item
    return None


def has_kanji(text: str) -> bool:
    return any(
        ("\u3400" <= ch <= "\u9fff") or ("\uf900" <= ch <= "\ufaff")
        for ch in str(text or "")
    )


def katakana_to_hiragana(text: str) -> str:
    out = []
    for ch in str(text or ""):
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            out.append(chr(code - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def find_primary_lemma(conn: sqlite3.Connection, word: str):
    rows = conn.execute(
        """
        SELECT lemma, pos, count
        FROM lemma_counts
        WHERE lemma = ?
        ORDER BY count DESC
        LIMIT 1
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


def related_lemmas_for_surfaces(conn: sqlite3.Connection, surfaces: list[str], primary_lemma: str, limit: int):
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
        (*surfaces, primary_lemma, max(limit * 8, 24)),
    ).fetchall()
    out = []
    for row in rows:
        anime_count = conn.execute(
            "SELECT COUNT(*) FROM lemma_anime_counts WHERE lemma = ?",
            (row["lemma"],),
        ).fetchone()[0]
        item = dict(row)
        item["anime_count"] = anime_count
        out.append(item)
    return out


def same_kanji_related_lemmas(conn: sqlite3.Connection, primary_lemma: str, limit: int):
    kanji_chars = [ch for ch in primary_lemma if has_kanji(ch)]
    if not kanji_chars:
      return []
    prefix = kanji_chars[0]
    rows = conn.execute(
        """
        SELECT lemma, pos, MAX(reading) AS reading, SUM(count) AS count
        FROM form_counts
        WHERE lemma LIKE ? AND lemma != ?
        GROUP BY lemma, pos
        ORDER BY count DESC, lemma ASC
        LIMIT ?
        """,
        (f"{prefix}%", primary_lemma, max(limit * 6, 24)),
    ).fetchall()
    out = []
    for row in rows:
        anime_count = conn.execute(
            "SELECT COUNT(*) FROM lemma_anime_counts WHERE lemma = ?",
            (row["lemma"],),
        ).fetchone()[0]
        item = dict(row)
        item["surface"] = item["lemma"]
        item["anime_count"] = anime_count
        out.append(item)
    return out


def exact_expression_hits(conn: sqlite3.Connection, surfaces: list[str], limit: int):
    out = []
    seen = set()
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
                   ee.example
            FROM expression_counts ec
            LEFT JOIN expression_anime_counts eac
              ON eac.surface = ec.surface AND eac.lemma_seq = ec.lemma_seq
            LEFT JOIN expression_examples ee
              ON ee.surface = ec.surface AND ee.lemma_seq = ec.lemma_seq
            WHERE ec.surface = ?
            GROUP BY ec.surface, ec.lemma_seq, ec.reading_seq, ec.pos_seq, ec.token_count, ec.char_len, ec.count, ee.example
            ORDER BY ec.count DESC, anime_count DESC, ec.surface ASC
            LIMIT ?
            """,
            (surface, limit),
        ).fetchall()
        for row in rows:
            item = dict(row)
            key = (item["surface"], item["lemma_seq"])
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    out.sort(key=lambda row: (-row["count"], -row["anime_count"], row["surface"]))
    return out[:limit]


def build_seed_surfaces(base_word: str, base_entry, forms: list[dict], extra_targets: list[str]):
    seeds = []
    for value in [base_word]:
        if value and value not in seeds:
            seeds.append(value)
    if base_entry:
        for form in (base_entry.get("match") or {}).get("forms", []) or []:
            form = str(form).strip()
            if form and form not in seeds:
                seeds.append(form)
    for row in forms:
        surface = str(row.get("surface") or "").strip()
        if surface and surface not in seeds:
            seeds.append(surface)
    for target in extra_targets:
        target = str(target).strip()
        if target and target not in seeds:
            seeds.append(target)
    return seeds


def load_jmdict_index(path: Path):
    if not path.exists():
        return {}
    data = load_json(path)
    index = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        for key in item.get("kanji", []) or []:
            key = str(key).strip()
            if key and key not in index:
                index[key] = item
        for key in item.get("kana", []) or []:
            key = str(key).strip()
            if key and key not in index:
                index[key] = item
    return index


def gloss_from_jmdict(item):
    senses = item.get("senses") or []
    if not senses:
        return ""
    gloss = senses[0].get("gloss") or []
    return "; ".join(str(x).strip() for x in gloss[:3] if str(x).strip())


def reading_from_jmdict(item):
    kana = item.get("kana") or []
    return str(kana[0]).strip() if kana else ""


def best_form_variants(forms: list[dict], primary_word: str, primary_pos: str, max_items: int, min_count: int):
    choices = {}
    require_kanji = has_kanji(primary_word)
    primary_kanji_prefix = next((ch for ch in primary_word if has_kanji(ch)), "")
    for row in forms:
        surface = str(row.get("surface") or "").strip()
        if not surface:
            continue
        if int(row.get("count") or 0) < min_count:
            continue
        if len(surface) <= 1:
            continue
        if require_kanji:
            if not has_kanji(surface):
                continue
            if primary_kanji_prefix and not surface.startswith(primary_kanji_prefix):
                continue
        if primary_pos in {"動詞", "形容詞", "形状詞"} and len(surface) <= 1:
            continue
        conj_form = str(row.get("conj_form") or "").strip()
        reading = str(row.get("reading") or "").strip()
        key = (reading or surface, conj_form)
        kana_surface = surface if not has_kanji(surface) else ""
        score = (
            1 if surface == primary_word else 0,
            1 if has_kanji(surface) else 0,
            int(row.get("count") or 0),
            -len(surface),
        )
        current = choices.get(key)
        if current is None or score > current["score"]:
            saved = dict(row)
            if kana_surface:
                saved["_reading_surface"] = kana_surface
            choices[key] = {"row": saved, "score": score}
        elif current is not None and kana_surface and not current["row"].get("_reading_surface"):
            current["row"]["_reading_surface"] = kana_surface
    picked = [v["row"] for v in choices.values()]
    picked.sort(
        key=lambda row: (
            0 if str(row.get("surface") or "") == primary_word else 1,
            -int(row.get("count") or 0),
            -len(str(row.get("surface") or "")),
            str(row.get("surface") or ""),
        )
    )
    return picked[:max_items]


def target_meta(target: str, target_type: str, base_entry, word_entries, jmdict_index, reading_hint: str = ""):
    exact = find_word_entry(word_entries, target)
    if exact:
        return {
            "reading": katakana_to_hiragana(str(exact.get("reading") or "").strip()),
            "romaji": str(exact.get("romaji") or "").strip(),
            "meaning": str(exact.get("meaning") or "").strip(),
            "query": target,
            "target": target,
            "type": target_type,
            "explicit_meta": True,
        }
    jmdict = jmdict_index.get(target)
    if jmdict:
        return {
            "reading": katakana_to_hiragana(reading_from_jmdict(jmdict)),
            "romaji": "",
            "meaning": gloss_from_jmdict(jmdict),
            "query": target,
            "target": target,
            "type": target_type,
            "explicit_meta": True,
        }
    return {
        "reading": katakana_to_hiragana(str(reading_hint or "").strip()),
        "romaji": "",
        "meaning": str(base_entry.get("meaning") or "").strip() if base_entry else "",
        "query": target,
        "target": target,
        "type": target_type,
        "explicit_meta": False,
    }


def reading_stem(reading: str):
    text = katakana_to_hiragana(str(reading or "").strip())
    if len(text) >= 2 and text[-1] in "うくぐすつぬぶむるふぷゆるえるいる":
        return text[:-1]
    return text[:-1] if len(text) >= 2 else text


def auto_discover_derived_targets(conn: sqlite3.Connection, base_entry, primary, jmdict_index, limit: int):
    if limit <= 0:
        return []
    reading = str((base_entry or {}).get("reading") or "").strip()
    stem = reading_stem(reading)
    if not stem or len(stem) < 1:
        return []
    suffixes = ["たい"]
    rows = conn.execute(
        """
        SELECT lemma, pos, MAX(reading) AS reading, SUM(count) AS count
        FROM form_counts
        WHERE lemma LIKE ?
        GROUP BY lemma, pos
        ORDER BY count DESC, lemma ASC
        LIMIT 100
        """,
        (f"{stem}%",),
    ).fetchall()
    out = []
    seen = set()
    for row in rows:
        lemma = str(row["lemma"] or "").strip()
        if not lemma or lemma == primary["lemma"]:
            continue
        if has_kanji(lemma):
            continue
        if not any(lemma.endswith(sfx) for sfx in suffixes):
            continue
        jmdict = jmdict_index.get(lemma)
        if not jmdict:
            continue
        anime_count = conn.execute(
            "SELECT COUNT(*) FROM lemma_anime_counts WHERE lemma = ?",
            (lemma,),
        ).fetchone()[0]
        item = dict(row)
        item["anime_count"] = anime_count
        key = (lemma, item["pos"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def build_promoted_targets(args, lemma_conn, expr_conn, word_entries, jmdict_index):
    base_entry = find_word_entry(word_entries, args.word)
    primary = find_primary_lemma(lemma_conn, args.word)
    if not primary:
        raise SystemExit(f'No lemma/form data found for "{args.word}"')

    forms = top_forms(lemma_conn, primary["lemma"], primary["pos"], max(args.top * 6, 30))
    seed_surfaces = build_seed_surfaces(args.word, base_entry, forms, args.extraTarget)
    related = related_lemmas_for_surfaces(
        lemma_conn, seed_surfaces, primary["lemma"], max(args.top * 4, 20)
    )
    related.extend(same_kanji_related_lemmas(lemma_conn, primary["lemma"], max(args.top * 4, 20)))
    dedup_related = {}
    for row in related:
        key = (str(row.get("surface") or "").strip(), str(row.get("lemma") or "").strip())
        if not key[0]:
            continue
        prev = dedup_related.get(key)
        if prev is None or int(row.get("count") or 0) > int(prev.get("count") or 0):
            dedup_related[key] = row
    related = sorted(
        dedup_related.values(),
        key=lambda row: (-int(row.get("count") or 0), str(row.get("surface") or "")),
    )
    derived = auto_discover_derived_targets(
        lemma_conn,
        base_entry,
        primary,
        jmdict_index,
        max(args.maxDerived * 4, 8),
    )
    expressions = exact_expression_hits(expr_conn, seed_surfaces, max(args.top * 6, 30))

    targets = []
    seen = set()

    def push(meta, score):
        key = meta["target"]
        if not key or key in seen:
            return
        seen.add(key)
        meta["score"] = score
        targets.append(meta)

    base_meta = target_meta(args.word, "base", base_entry or {"meaning": ""}, word_entries, jmdict_index)
    push(base_meta, 10**12)

    inflections = best_form_variants(forms, args.word, primary["pos"], args.maxInflections * 3, args.minFormCount)
    inflections_added = 0
    for row in inflections:
        surface = str(row.get("surface") or "").strip()
        if not surface:
            continue
        if surface == args.word:
            continue
        reading_hint = str(row.get("_reading_surface") or row.get("reading") or "")
        meta = target_meta(surface, "inflection", base_entry or {"meaning": ""}, word_entries, jmdict_index, reading_hint)
        push(meta, int(row.get("count") or 0))
        inflections_added += 1
        if inflections_added >= args.maxInflections:
            break

    related_added = 0
    for row in related:
        surface = str(row.get("surface") or "").strip()
        if not surface or surface == args.word:
            continue
        if len(surface) <= 1:
            continue
        if has_kanji(args.word):
            base_kanji = next((ch for ch in args.word if has_kanji(ch)), "")
            if not has_kanji(surface):
                continue
            if base_kanji and not surface.startswith(base_kanji):
                continue
        if int(row.get("count") or 0) < args.minRelatedCount:
            continue
        if int(row.get("anime_count") or 0) < args.minRelatedAnime:
            continue
        meta = target_meta(surface, "related", base_entry or {"meaning": ""}, word_entries, jmdict_index, str(row.get("reading") or ""))
        push(meta, int(row.get("count") or 0))
        related_added += 1
        if related_added >= args.maxRelated:
            break

    derived_added = 0
    for row in derived:
        surface = str(row.get("lemma") or "").strip()
        if not surface or surface == args.word:
            continue
        meta = target_meta(surface, "derived", base_entry or {"meaning": ""}, word_entries, jmdict_index, str(row.get("reading") or ""))
        push(meta, int(row.get("count") or 0))
        derived_added += 1
        if derived_added >= args.maxDerived:
            break

    expr_added = 0
    for row in expressions:
        surface = str(row.get("surface") or "").strip()
        if not surface or surface == args.word:
            continue
        if int(row.get("token_count") or 0) < 1:
            continue
        if int(row.get("count") or 0) < args.minExpressionCount:
            continue
        if int(row.get("anime_count") or 0) < args.minExpressionAnime:
            continue
        meta = target_meta(surface, "expression", base_entry or {"meaning": ""}, word_entries, jmdict_index)
        push(meta, int(row.get("count") or 0))
        expr_added += 1
        if expr_added >= args.maxExpressions:
            break

    for target in args.extraTarget:
        target = str(target).strip()
        if not target:
            continue
        push(target_meta(target, "manual", base_entry or {"meaning": ""}, word_entries, jmdict_index), 10**11)

    type_order = {"base": 0, "inflection": 1, "related": 2, "derived": 3, "expression": 4, "manual": 5}
    targets.sort(key=lambda item: (type_order.get(item["type"], 9), -int(item.get("score") or 0), item["target"]))
    return {
        "primary": primary,
        "baseEntry": base_entry,
        "forms": forms,
        "related": related,
        "derived": derived,
        "expressions": expressions,
        "targets": targets[: args.top],
    }


def build_render_command(args, target_meta):
    cache_file = target_meta.get("cacheFile")
    use_cache = bool(args.useCache and cache_file and Path(cache_file).exists())
    cmd = [
        "node",
        "scripts/make-vertical-shorts-clean.js",
        "--query",
        target_meta["query"],
        "--subsDir",
        args.subsDir,
        "--enSubsDir",
        args.enSubsDir,
        "--videosDir",
        args.videosDir,
        "--wordList",
        str(args.wordsFile if args.wordsFile.exists() else args.fallbackWordsFile),
        "--outDir",
        args.outDir,
        "--outputDir",
        args.outputDir,
        "--layout",
        args.layout,
        "--rank",
        "--limit",
        str(args.clips),
        "--prePadMs",
        str(args.prePadMs),
        "--postPadMs",
        str(args.postPadMs),
        "--maxClipMs",
        str(args.maxClipMs),
        "--longPolicy",
        args.longPolicy,
        "--noQr",
        "--noEndCard",
        "--keepOutputs",
    ]
    if use_cache:
        cmd.extend(["--candidatesIn", cache_file])
        pick = target_meta.get("cachePick") or ""
        if pick:
            cmd.extend(["--pick", pick])
        cmd.append("--noAutoReplaceBad")
    else:
        cmd.extend(
            [
                "--avEval",
                "--noAvQueryOnly",
                "--avFailPolicy",
                "strict",
                "--avMinAsrSim",
                str(args.avMinAsrSim),
                "--avMaxSwapCandidates",
                str(args.avMaxSwapCandidates),
                "--avWhisperModel",
                args.avWhisperModel,
                "--avWhisperLanguage",
                args.avWhisperLanguage,
            ]
        )
    if target_meta.get("reading") and (target_meta.get("explicit_meta") or target_meta.get("type") != "inflection"):
        cmd.extend(["--reading", target_meta["reading"]])
    if target_meta.get("romaji") and target_meta.get("explicit_meta"):
        cmd.extend(["--romaji", target_meta["romaji"]])
    if target_meta.get("meaning"):
        cmd.extend(["--meaning", target_meta["meaning"]])
    if args.withVision:
        # Vision backend/model come from environment or package defaults if caller wants them.
        pass
    if args.verbose:
        cmd.append("--verbose")
    return cmd


def safe_slug(text: str) -> str:
    text = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in str(text or ""))
    text = text.strip("._")
    return text or "item"


def cache_file_path(args, base_word: str, target: str) -> Path:
    cache_dir = JP_REPO_ROOT / args.cacheDir
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{safe_slug(base_word)}__{safe_slug(target)}.json"


def build_cache_command(args, base_word: str, target_meta):
    cache_path = cache_file_path(args, base_word, target_meta["target"])
    cmd = [
        "node",
        "scripts/extract-clips.js",
        "--query",
        target_meta["query"],
        "--subsDir",
        args.subsDir,
        "--enSubsDir",
        args.enSubsDir,
        "--videosDir",
        args.videosDir,
        "--wordList",
        str(args.wordsFile if args.wordsFile.exists() else args.fallbackWordsFile),
        "--outDir",
        args.cacheDir,
        "--limit",
        str(args.clips),
        "--mode",
        "line",
        "--prePadMs",
        str(args.prePadMs),
        "--postPadMs",
        str(args.postPadMs),
        "--maxClipMs",
        str(args.maxClipMs),
        "--longPolicy",
        args.longPolicy,
        "--rank",
        "--flatOut",
        "--manifest",
        "--dryRun",
        "--candidatesOut",
        str(cache_path),
        "--avEval",
        "--noAvQueryOnly",
        "--avFailPolicy",
        "strict",
        "--avMinAsrSim",
        str(args.avMinAsrSim),
        "--avMaxSwapCandidates",
        str(args.avMaxSwapCandidates),
        "--avWhisperModel",
        args.avWhisperModel,
        "--avWhisperLanguage",
        args.avWhisperLanguage,
    ]
    if args.verbose:
        cmd.append("--verbose")
    return cmd, cache_path


def load_cache_pick(cache_path: Path):
    if not cache_path.exists():
        return ""
    try:
        data = load_json(cache_path)
    except Exception:
        return ""
    selected = data.get("selected") if isinstance(data, dict) else None
    if not isinstance(selected, list):
        return ""
    picks = []
    for item in selected:
        idx = int(item.get("candidateIndex") or 0)
        if idx > 0:
            picks.append(str(idx))
    return ",".join(picks)


def main():
    args = parse_args()
    lemma_conn = connect(args.lemmaDb.resolve())
    expr_conn = connect(args.expressionDb.resolve())
    word_entries = load_words(args.wordsFile.resolve(), args.fallbackWordsFile.resolve())
    jmdict_index = load_jmdict_index(args.jmdictFile.resolve())
    plan = build_promoted_targets(args, lemma_conn, expr_conn, word_entries, jmdict_index)
    only_kinds = parse_kind_filter(args.onlyKinds)
    if only_kinds:
        plan["targets"] = [item for item in plan["targets"] if str(item.get("type") or "").lower() in only_kinds]

    meaning_overrides = parse_override_map(args.setMeaning)

    payload = {
        "word": args.word,
        "primary": plan["primary"],
        "targets": [
            {
                "target": item["target"],
                "query": item["query"],
                "type": item["type"],
                "reading": item.get("reading", ""),
                "meaning": item.get("meaning", ""),
                "score": item.get("score", 0),
                "cacheFile": str(cache_file_path(args, args.word, item["target"])),
            }
            for item in plan["targets"]
        ],
    }

    for item, target in zip(payload["targets"], plan["targets"]):
        item["cachePick"] = load_cache_pick(Path(item["cacheFile"]))
        override_meaning = meaning_overrides.get(item["target"], "")
        if override_meaning:
            item["meaning"] = override_meaning
            target = {**target, "meaning": override_meaning}
        item["command"] = build_render_command(args, {**target, "cacheFile": item["cacheFile"], "cachePick": item["cachePick"]})

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    print(f'[family-shorts] word={args.word} primary={plan["primary"]["lemma"]} ({plan["primary"]["pos"]})')
    for item in payload["targets"]:
        print(
            f'  - {item["target"]} [{item["type"]}] reading={item["reading"] or "-"} '
            f'meaning={item["meaning"] or "-"}'
        )

    if args.dryRun:
        print("")
        for item in payload["targets"]:
            if args.cacheOnly:
                cmd, _ = build_cache_command(args, args.word, item)
            else:
                cmd = item["command"]
            print(shlex.join(cmd))
        return

    failures = []
    completed = []
    for item in payload["targets"]:
        if args.cacheOnly:
            print(f'[family-shorts] caching {item["target"]} [{item["type"]}]')
            cmd, cache_path = build_cache_command(args, args.word, item)
        else:
            print(f'[family-shorts] rendering {item["target"]} [{item["type"]}]')
            cmd = item["command"]
            cache_path = None
        res = subprocess.run(cmd, cwd=str(JP_REPO_ROOT))
        if res.returncode != 0:
            failures.append({"target": item["target"], "type": item["type"], "code": res.returncode})
            print(f'[family-shorts] skipped {item["target"]} [{item["type"]}] exit={res.returncode}')
            if args.strict:
                raise SystemExit(res.returncode)
            continue
        if args.cacheOnly and cache_path is not None:
            item["cachePick"] = load_cache_pick(cache_path)
            print(f'[family-shorts] cached {item["target"]} -> {cache_path}')
        completed.append(item["target"])

    print(f"[family-shorts] done completed={len(completed)} failed={len(failures)}")
    for item in failures:
        print(f'  failed: {item["target"]} [{item["type"]}] exit={item["code"]}')


if __name__ == "__main__":
    main()
