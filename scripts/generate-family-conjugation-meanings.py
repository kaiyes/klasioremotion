#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PRIMARY_WORDS_FILE = REPO_ROOT / "source_content" / "all_anime_top_2000.match.first2000.json"
FALLBACK_WORDS_FILE = REPO_ROOT / "source_content" / "all_anime_top_2000.json"
DEFAULT_CACHE_DIR = REPO_ROOT / "out" / "family_audio_cache"
DEFAULT_LEMMA_DB = REPO_ROOT / "out" / "corpus" / "lemma_forms.sqlite"
DEFAULT_OUT_FILE = REPO_ROOT / "out" / "corpus" / "family_conjugation_meanings.json"
DEFAULT_FAMILY_MEANINGS = REPO_ROOT / "source_content" / "family-meanings.json"
DEFAULT_JMDICT_EXAMPLES_DIR = REPO_ROOT / "JMdict_english_with_examples"

IRREGULAR_PAST = {
    "think": "thought",
    "say": "said",
    "go": "went",
    "come": "came",
    "do": "did",
    "make": "made",
    "know": "knew",
    "see": "saw",
    "hear": "heard",
    "take": "took",
    "give": "gave",
    "get": "got",
    "leave": "left",
    "feel": "felt",
    "keep": "kept",
    "buy": "bought",
    "bring": "brought",
    "teach": "taught",
    "tell": "told",
    "speak": "spoke",
    "eat": "ate",
    "drink": "drank",
    "run": "ran",
    "write": "wrote",
    "read": "read",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate family inflection meanings from existing family cache + lemma DB."
    )
    parser.add_argument(
        "--cacheDir",
        action="append",
        default=[],
        help="Family cache directory (repeatable). Default: out/family_audio_cache",
    )
    parser.add_argument("--wordsFile", type=Path, default=PRIMARY_WORDS_FILE)
    parser.add_argument("--fallbackWordsFile", type=Path, default=FALLBACK_WORDS_FILE)
    parser.add_argument("--lemmaDb", type=Path, default=DEFAULT_LEMMA_DB)
    parser.add_argument("--jmdictExamplesDir", type=Path, default=DEFAULT_JMDICT_EXAMPLES_DIR)
    parser.add_argument("--outFile", type=Path, default=DEFAULT_OUT_FILE)
    parser.add_argument("--familyMeaningsFile", type=Path, default=DEFAULT_FAMILY_MEANINGS)
    parser.add_argument("--mergeFamilyMeanings", action="store_true")
    parser.add_argument("--llmBackend", choices=["none", "llamacpp"], default="none")
    parser.add_argument("--llmHost", default="http://127.0.0.1:18080")
    parser.add_argument("--llmModel", default="qwen35-4b-q4km")
    parser.add_argument("--llmTimeoutSec", type=int, default=30)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def read_json(path: Path):
    with path.open("r", encoding="utf8") as fh:
        return json.load(fh)


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def normalize_words_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("words"), list):
        return payload["words"]
    return []


def load_words_map(words_file: Path, fallback_file: Path) -> dict[str, dict]:
    file_to_use = words_file if words_file.exists() else fallback_file
    if not file_to_use.exists():
        return {}
    words = normalize_words_payload(read_json(file_to_use))
    out = {}
    for item in words:
        if not isinstance(item, dict):
            continue
        w = str(item.get("word") or "").strip()
        if w:
            out[w] = item
    return out


def normalize_meaning(text: str) -> str:
    parts = [x.strip() for x in str(text or "").replace(",", ";").split(";")]
    parts = [x for x in parts if x]
    return "; ".join(parts[:3]) if parts else ""


def meaning_head(meaning: str) -> str:
    txt = normalize_meaning(meaning)
    if not txt:
        return ""
    return txt.split(";")[0].strip()


def past_tense(verb: str) -> str:
    v = verb.strip().lower()
    if not v:
        return ""
    if v in IRREGULAR_PAST:
        return IRREGULAR_PAST[v]
    if v.endswith("e"):
        return v + "d"
    if v.endswith("y") and len(v) > 1 and v[-2] not in "aeiou":
        return v[:-1] + "ied"
    return v + "ed"


def imperative_gloss(verb: str) -> str:
    if not verb:
        return ""
    return f"{verb}!"


def heuristic_inflection_gloss(base_meaning: str, target: str, conj_form: str) -> str:
    head = meaning_head(base_meaning)
    if not head:
        return ""
    if not head.lower().startswith("to "):
        return head
    verb = head[3:].strip().lower()
    if not verb:
        return head

    t = str(target or "")
    cf = str(conj_form or "")

    if "命令" in cf or t.endswith("ろ") or t.endswith("よ"):
        return imperative_gloss(verb)
    if "意志" in cf or "推量" in cf or t.endswith("よう") or t.endswith("おう"):
        return f"let's {verb}"
    if "仮定" in cf or t.endswith("れ"):
        return f"if (someone) {verb}"
    if "未然" in cf or t.endswith("ない"):
        return f"not {verb}"
    if t.endswith("て") or t.endswith("で"):
        return f"{verb} and..."
    if t.endswith("た") or t.endswith("だ") or t.endswith("っ"):
        return past_tense(verb)
    if "連用" in cf:
        return f"{verb} (stem)"
    return head


def list_cache_pairs(cache_dirs: list[Path], limit: int) -> list[tuple[Path, str, str]]:
    out: list[tuple[Path, str, str]] = []
    for cache_dir in cache_dirs:
        if not cache_dir.exists():
            continue
        for p in sorted(cache_dir.glob("*.json")):
            stem = p.stem
            if "__" not in stem:
                continue
            base, target = stem.split("__", 1)
            base = base.strip()
            target = target.strip()
            if not base or not target:
                continue
            out.append((p, base, target))
            if limit > 0 and len(out) >= limit:
                return out
    return out


def _flatten_text(obj) -> list[str]:
    out: list[str] = []
    if obj is None:
        return out
    if isinstance(obj, str):
        txt = obj.strip()
        if txt:
            out.append(txt)
        return out
    if isinstance(obj, list):
        for x in obj:
            out.extend(_flatten_text(x))
        return out
    if isinstance(obj, dict):
        for key in ("content", "text", "gloss", "value"):
            if key in obj:
                out.extend(_flatten_text(obj[key]))
        return out
    return out


def load_jmdict_examples_glosses(root: Path, needed_terms: set[str]) -> dict[str, str]:
    if not root.exists() or not needed_terms:
        return {}
    out: dict[str, str] = {}
    for file in sorted(root.glob("term_bank_*.json")):
        try:
            arr = read_json(file)
        except Exception:
            continue
        if not isinstance(arr, list):
            continue
        for row in arr:
            if not isinstance(row, list) or len(row) < 6:
                continue
            term = str(row[0] or "").strip()
            reading = str(row[1] or "").strip()
            if term not in needed_terms and reading not in needed_terms:
                continue
            defs = row[5]
            texts = [t for t in _flatten_text(defs) if t and not t.startswith("see: ")]
            gloss = normalize_meaning("; ".join(texts))
            if not gloss:
                continue
            if term in needed_terms and term not in out:
                out[term] = gloss
            if reading in needed_terms and reading not in out:
                out[reading] = gloss
    return out


def connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def primary_lemma(conn: sqlite3.Connection, base: str) -> tuple[str, str]:
    row = conn.execute(
        """
        SELECT lemma, pos, SUM(count) AS c
        FROM form_counts
        WHERE surface = ?
        GROUP BY lemma, pos
        ORDER BY c DESC
        LIMIT 1
        """,
        (base,),
    ).fetchone()
    if row:
        return str(row["lemma"] or base), str(row["pos"] or "")

    row = conn.execute(
        """
        SELECT lemma, pos, count AS c
        FROM lemma_counts
        WHERE lemma = ?
        ORDER BY c DESC
        LIMIT 1
        """,
        (base,),
    ).fetchone()
    if row:
        return str(row["lemma"] or base), str(row["pos"] or "")
    return base, ""


def top_conj_form(conn: sqlite3.Connection, lemma: str, target: str) -> str:
    row = conn.execute(
        """
        SELECT conj_form, SUM(count) AS c
        FROM form_counts
        WHERE lemma = ? AND surface = ?
        GROUP BY conj_form
        ORDER BY c DESC
        LIMIT 1
        """,
        (lemma, target),
    ).fetchone()
    return str(row["conj_form"] or "") if row else ""


def read_cache_examples(cache_path: Path, n: int = 3) -> list[str]:
    try:
        data = read_json(cache_path)
    except Exception:
        return []
    selected = data.get("selected") if isinstance(data, dict) else None
    if not isinstance(selected, list):
        return []
    out = []
    for item in selected:
        if not isinstance(item, dict):
            continue
        en = str(item.get("enText") or "").strip()
        jp = str(item.get("sentenceText") or "").strip()
        one = f"JP: {jp} | EN: {en}" if jp or en else ""
        if one:
            out.append(one)
        if len(out) >= n:
            break
    return out


def llm_refine_gloss(
    *,
    host: str,
    model: str,
    timeout_sec: int,
    base: str,
    target: str,
    base_meaning: str,
    conj_form: str,
    heuristic: str,
    examples: list[str],
) -> str:
    prompt = [
        "You are generating concise English flashcard glosses for Japanese inflections.",
        "Return ONLY one short gloss (1-4 words), no punctuation at end.",
        f"Base word: {base}",
        f"Target form: {target}",
        f"Base meaning: {base_meaning}",
        f"Conjugation form tag: {conj_form}",
        f"Heuristic gloss: {heuristic}",
    ]
    if examples:
        prompt.append("Examples:")
        prompt.extend(f"- {x}" for x in examples[:3])
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "\n".join(prompt)}],
        "temperature": 0.1,
        "max_tokens": 24,
    }
    req = urllib.request.Request(
        url=f"{host.rstrip('/')}/v1/chat/completions",
        data=json.dumps(payload).encode("utf8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = json.loads(resp.read().decode("utf8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return ""
    try:
        text = str(raw["choices"][0]["message"]["content"]).strip()
    except Exception:
        return ""
    text = " ".join(text.split())
    text = text.strip("\"'` ")
    if not text:
        return ""
    if len(text.split()) > 6:
        return ""
    return text


def merge_family_meanings(file_path: Path, items: list[dict]):
    if file_path.exists():
        try:
            data = read_json(file_path)
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {}
    else:
        data = {}

    for it in items:
        base = it["base"]
        target = it["target"]
        meaning = it["meaning"]
        if not base or not target or not meaning:
            continue
        # direct for convenience
        data[target] = meaning
        # nested for base-specific lookup
        bucket = data.get(base)
        if not isinstance(bucket, dict):
            bucket = {}
            data[base] = bucket
        bucket[target] = meaning

    write_json(file_path, data)


def main() -> None:
    args = parse_args()
    cache_dirs = [Path(x).resolve() for x in args.cacheDir] if args.cacheDir else [DEFAULT_CACHE_DIR.resolve()]

    words = load_words_map(args.wordsFile.resolve(), args.fallbackWordsFile.resolve())
    if not words:
        raise SystemExit("No words loaded from words files.")
    if not args.lemmaDb.exists():
        raise SystemExit(f"lemma DB not found: {args.lemmaDb}")

    pairs = list_cache_pairs(cache_dirs, args.limit)
    if not pairs:
        raise SystemExit("No family cache pairs found.")

    needed_terms = set()
    for _, base, target in pairs:
        needed_terms.add(base)
        needed_terms.add(target)
    jmdict_examples = load_jmdict_examples_glosses(args.jmdictExamplesDir.resolve(), needed_terms)

    conn = connect_db(args.lemmaDb.resolve())
    items: list[dict] = []
    seen = set()

    for cache_path, base, target in pairs:
        if target == base:
            continue
        key = (base, target)
        if key in seen:
            continue
        seen.add(key)

        base_entry = words.get(base)
        # Prefer full JMdict examples; fallback to the curated top-2000 entry if missing.
        base_meaning = normalize_meaning(jmdict_examples.get(base, ""))
        if not base_meaning:
            base_meaning = normalize_meaning((base_entry or {}).get("meaning") or "")
        if not base_meaning:
            continue

        lemma, pos = primary_lemma(conn, base)
        conj_form = top_conj_form(conn, lemma, target)
        heuristic = heuristic_inflection_gloss(base_meaning, target, conj_form)
        if not heuristic:
            heuristic = normalize_meaning(jmdict_examples.get(target, ""))
            if not heuristic:
                continue

        gloss = heuristic
        source = "heuristic"
        if args.llmBackend == "llamacpp":
            examples = read_cache_examples(cache_path, n=3)
            llm_gloss = llm_refine_gloss(
                host=args.llmHost,
                model=args.llmModel,
                timeout_sec=args.llmTimeoutSec,
                base=base,
                target=target,
                base_meaning=base_meaning,
                conj_form=conj_form,
                heuristic=heuristic,
                examples=examples,
            )
            if llm_gloss:
                gloss = llm_gloss
                source = "llm"

        item = {
            "base": base,
            "target": target,
            "lemma": lemma,
            "pos": pos,
            "conjForm": conj_form,
            "baseMeaning": base_meaning,
            "meaning": gloss,
            "source": source,
            "cacheFile": str(cache_path),
        }
        items.append(item)
        if args.verbose:
            print(f"{base} -> {target} [{conj_form}] = {gloss} ({source})")

    payload = {
        "meta": {
            "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "cacheDirs": [str(x) for x in cache_dirs],
            "lemmaDb": str(args.lemmaDb.resolve()),
            "jmdictExamplesDir": str(args.jmdictExamplesDir.resolve()) if args.jmdictExamplesDir else "",
            "wordsFile": str((args.wordsFile if args.wordsFile.exists() else args.fallbackWordsFile).resolve()),
            "llmBackend": args.llmBackend,
            "llmModel": args.llmModel if args.llmBackend == "llamacpp" else "",
            "count": len(items),
        },
        "items": items,
    }
    write_json(args.outFile.resolve(), payload)
    print(f"[family-conj] wrote {args.outFile} items={len(items)}")

    if args.mergeFamilyMeanings and items:
        merge_family_meanings(args.familyMeaningsFile.resolve(), items)
        print(f"[family-conj] merged into {args.familyMeaningsFile}")


if __name__ == "__main__":
    main()
