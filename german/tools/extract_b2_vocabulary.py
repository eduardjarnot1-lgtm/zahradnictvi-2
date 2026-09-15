#!/usr/bin/env python3
"""Extract the B2 vocabulary list supplied by the project owner.

Usage:  python3 extract_b2_vocabulary.py --pdf <German_Vocabulary_B2.pdf> [--expect 500]

Writes b2-vocabulary-source.json next to this script: the topics in the order
the document prints them and one record per entry, with the German headword,
its article, the English gloss, the German example sentence and that sentence's
English translation.

The document is a three-column table (German / English / Example sentence)
under a heading per topic. Every cell is its own text run and a long cell wraps
across several runs, so the columns cannot be read off x positions. What does
separate them reliably is the styling, which the document applies consistently:

    Helvetica-Bold   14.0   topic heading
    Helvetica-Bold   10.0   the table header row ("German" / "English" / ...)
    Helvetica-Bold   11.0   the German headword
    Helvetica        10.0   the English gloss
    Helvetica-Oblique 9.5   the example sentence and its translation

So consecutive runs of one style are joined back into a cell, and an entry is a
headword cell followed by a gloss cell followed by an example cell. The example
cell holds both sentences; they are split at the first run that ends in
terminal punctuation, which is where the German sentence ends and the English
one begins.

Nothing is written unless every entry parses and the totals match --expect, so
a layout this reader does not understand fails loudly instead of silently
dropping or mangling words.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "b2-vocabulary-source.json"

SOURCE_TITLE = "German Vocabulary — Level B2 (supplied by the project owner)"

HEADWORD = ("/Helvetica-Bold", 11.0)
GLOSS = ("/Helvetica", 10.0)
EXAMPLE = ("/Helvetica-Oblique", 9.5)
TOPIC = ("/Helvetica-Bold", 14.0)
TABLE_HEADER = ("/Helvetica-Bold", 10.0)

SENTENCE_END = re.compile(r"[.!?…][\"'»]?$")
ARTICLE = re.compile(r"^(der|die|das)\s+(.+)$")


def read_runs(pdf: Path) -> list[tuple[tuple[str, float], str]]:
    """Every non-empty text run in reading order, tagged with its style."""
    runs: list[tuple[tuple[str, float], str]] = []

    def visit(text, cm, tm, font_dict, font_size):
        piece = text.strip()
        if not piece or font_dict is None:
            return
        style = (font_dict.get("/BaseFont", ""), round(float(font_size), 1))
        runs.append((style, piece))

    for page in PdfReader(str(pdf)).pages:
        page.extract_text(visitor_text=visit)
    return runs


def group(runs) -> list[tuple[tuple[str, float], list[str]]]:
    """Merge consecutive runs of one style, so a wrapped cell becomes one cell."""
    cells: list[tuple[tuple[str, float], list[str]]] = []
    for style, piece in runs:
        if cells and cells[-1][0] == style:
            cells[-1][1].append(piece)
        else:
            cells.append((style, [piece]))
    return cells


def split_example(parts: list[str]) -> tuple[str, str]:
    """Split the example cell into the German sentence and its translation.

    Both sentences sit in one styled block, wrapped over however many lines they
    need. The German one ends at the first line that ends in terminal
    punctuation; everything after that is the English one.
    """
    for i, part in enumerate(parts):
        if SENTENCE_END.search(part):
            german = " ".join(parts[: i + 1])
            english = " ".join(parts[i + 1:])
            return german.strip(), english.strip()
    return " ".join(parts).strip(), ""


def parse(cells) -> tuple[list[dict], list[str]]:
    entries: list[dict] = []
    topics: list[str] = []
    topic = ""
    i = 0
    while i < len(cells):
        style, parts = cells[i]
        if style == TOPIC:
            topic = " ".join(parts).strip()
            if topic not in topics:
                topics.append(topic)
            i += 1
            continue
        if style == HEADWORD:
            if topic == "":
                raise SystemExit(f"entry {' '.join(parts)!r} before any topic heading")
            if i + 2 >= len(cells):
                raise SystemExit(f"entry {' '.join(parts)!r} has no gloss and example")
            gloss_style, gloss_parts = cells[i + 1]
            example_style, example_parts = cells[i + 2]
            if gloss_style != GLOSS or example_style != EXAMPLE:
                raise SystemExit(
                    f"entry {' '.join(parts)!r}: expected a gloss then an example, "
                    f"got {gloss_style} then {example_style}")

            word = " ".join(parts).strip()
            article = ""
            match = ARTICLE.match(word)
            if match:
                article, word = match.group(1), match.group(2).strip()

            example, example_en = split_example(example_parts)
            if not example_en:
                raise SystemExit(f"entry {word!r}: example has no English translation")

            entries.append({
                "word": word,
                "article": article,
                "translation": " ".join(gloss_parts).strip(),
                "example": example,
                "exampleTranslation": example_en,
                "topic": topic,
            })
            i += 3
            continue
        i += 1
    return entries, topics


def soft_check(entries: list[dict]) -> list[str]:
    """Report entries whose example does not obviously contain the headword.

    This is advisory only. German separable, reflexive and strong verbs change
    shape enough that a stem comparison flags them wrongly, so a hit here is
    something to read, not a reason to drop an entry.
    """
    notes = []
    for entry in entries:
        stem = entry["word"].lower()[:5]
        if stem and stem not in entry["example"].lower():
            notes.append(f"{entry['word']} -> {entry['example']}")
    return notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--expect", type=int, default=0,
                        help="fail unless exactly this many entries are found")
    args = parser.parse_args()

    if not args.pdf.exists():
        raise SystemExit(f"no such file: {args.pdf}")

    cells = group(read_runs(args.pdf))
    entries, topics = parse(cells)

    if args.expect and len(entries) != args.expect:
        raise SystemExit(f"expected {args.expect} entries, found {len(entries)}")

    seen: dict[str, str] = {}
    for entry in entries:
        for field in ("word", "translation", "example", "exampleTranslation"):
            if not entry[field]:
                raise SystemExit(f"entry {entry['word']!r}: empty {field}")
        key = entry["word"].lower()
        if key in seen:
            print(f"  note: {entry['word']} appears in both "
                  f"{seen[key]} and {entry['topic']}")
        seen[key] = entry["topic"]

    OUT.write_text(json.dumps({
        "source": SOURCE_TITLE,
        "level": "B2",
        "topics": topics,
        "entries": entries,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"entries : {len(entries)} -> {OUT}")
    print(f"topics  : {len(topics)}")
    notes = soft_check(entries)
    if notes:
        print(f"\n{len(notes)} example(s) where the headword is not visible unchanged "
              f"(inflection, separable prefix or a compound — read, do not assume a fault):")
        for note in notes[:40]:
            print("  -", note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
