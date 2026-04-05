#!/usr/bin/env python3

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Iterable

JP_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
TIMESTAMP_RE = re.compile(
    r"^\s*\d{1,2}:\d{2}:\d{2}[,.:]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.:]\d{2,3}"
)
SRT_COUNTER_RE = re.compile(r"^\s*\d+\s*$")
ASS_TAG_RE = re.compile(r"\{[^{}]*\}")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BRACKETED_META_RE = re.compile(r"^\s*[\[(【].*?[\])】]\s*$")
WHITESPACE_RE = re.compile(r"\s+")
ALLOWED_EXTS = {".srt", ".ass", ".ssa", ".txt"}
CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞", "副詞", "感動詞", "連体詞", "接頭辞"}
END_POS = {"動詞", "形容詞", "形状詞"}
BANNED_EDGE_POS = {"助詞", "助動詞", "補助記号", "接尾辞", "接頭辞", "記号"}
BANNED_INTERNAL_POS = {"補助記号", "記号"}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_default_corpus_dir() -> Path:
    candidates = [
        repo_root().parent / "kitsunekko-mirror" / "subtitles" / "anime_tv",
        Path.home() / "projects" / "kitsunekko-mirror" / "subtitles" / "anime_tv",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def connect_db(db_path: Path) -> sqlite3.Connection:
    ensure_dir(db_path.parent)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-200000")
    return conn


def iter_subtitle_files(corpus_dir: Path) -> Iterable[Path]:
    for path in sorted(corpus_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTS:
            yield path


def anime_name_for_file(corpus_dir: Path, file_path: Path) -> str:
    rel = file_path.relative_to(corpus_dir)
    return rel.parts[0] if rel.parts else "unknown"


def has_japanese(text: str) -> bool:
    return bool(JP_RE.search(text or ""))


def clean_subtitle_text(text: str) -> str:
    s = text.replace("\\N", " ").replace("\\n", " ")
    s = ASS_TAG_RE.sub(" ", s)
    s = HTML_TAG_RE.sub(" ", s)
    s = s.replace("\u200b", " ").replace("\ufeff", " ")
    s = WHITESPACE_RE.sub(" ", s).strip()
    return s


def extract_dialogue_lines(file_path: Path) -> list[str]:
    try:
        raw = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    lines: list[str] = []
    suffix = file_path.suffix.lower()
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if suffix in {".ass", ".ssa"}:
            if not line.startswith("Dialogue:"):
                continue
            parts = line.split(",", 9)
            if len(parts) < 10:
                continue
            line = parts[9]
        else:
            if SRT_COUNTER_RE.match(line) or TIMESTAMP_RE.match(line):
                continue
        line = clean_subtitle_text(line)
        if not line:
            continue
        if BRACKETED_META_RE.match(line):
            continue
        if not has_japanese(line):
            continue
        lines.append(line)
    return lines


def token_surface_key(token) -> str:
    return str(token.surface or "").strip()


def token_lemma(token) -> str:
    feature = token.feature
    lemma = getattr(feature, "lemma", None) or getattr(feature, "orthBase", None) or token.surface
    return str(lemma or token.surface or "").strip()


def token_reading(token) -> str:
    feature = token.feature
    reading = getattr(feature, "kanaBase", None) or getattr(feature, "kana", None) or ""
    return str(reading or "").strip()


def token_pos(token) -> str:
    return str(getattr(token.feature, "pos1", "") or "").strip()


def token_conj_type(token) -> str:
    return str(getattr(token.feature, "cType", "") or "").strip()


def token_conj_form(token) -> str:
    return str(getattr(token.feature, "cForm", "") or "").strip()


def is_content_token(token) -> bool:
    return token_pos(token) in CONTENT_POS and has_japanese(token_surface_key(token))


def is_expression_end_token(token) -> bool:
    return token_pos(token) in END_POS and has_japanese(token_surface_key(token))
