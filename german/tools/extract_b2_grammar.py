#!/usr/bin/env python3
"""Extract the B2 grammar topics supplied by the project owner.

Usage:  python3 extract_b2_grammar.py --pdf <part1.pdf> [--pdf <part2.pdf> ...] [--expect 15]

The set is published in parts. Pass them in order: the topics are numbered
sequentially across the whole set, so adding a later part never renumbers an
earlier one and the annotation ids stay stable.

Writes b2-grammar-source.json next to this script: one record per numbered
topic, with the German heading, the document's own English heading, the rule in
both languages, the four worked examples with their translations, the "Achtung"
note, and the raw source text of the topic.

That raw text is what build_grammar.py validates authored content against:
every example sentence shown in the app has to occur verbatim in the source
text of its own topic, so nothing reaches a learner that is not in the
document.

Like the B2 vocabulary list, this document is a styled layout rather than a
tagged one, so the structure is read off the fonts, which it applies
consistently:

    Helvetica-Bold    15.0   topic heading ("1. Konjunktiv II – ...")
    Helvetica-Oblique 10.0   the document's English heading for that topic
    Helvetica-Bold     9.5   a section marker ("Regel (Deutsch)", "Rule
                             (English)", "Beispiele / Examples", the table
                             headers, "Watch out / Achtung:")
    Helvetica         10.3   rule prose (bold/oblique 10.3 is inline emphasis
                             inside the same paragraph, so size alone groups it)
    Helvetica-Bold    10.0   a German example sentence
    Helvetica-Oblique  9.0   that sentence's English translation
    Helvetica          9.5   the Achtung note, German first then English

Nothing is written unless every topic yields both rules, exactly four
translated examples and a note, so a layout this reader does not understand
fails loudly instead of quietly dropping half a topic.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "b2-grammar-source.json"

SOURCE_TITLE = "Deutsche Grammatik – Niveau B2 (supplied by the project owner)"

TITLE = ("/Helvetica-Bold", 15.0)
TITLE_EN = ("/Helvetica-Oblique", 10.0)
SECTION = ("/Helvetica-Bold", 9.5)
EXAMPLE_DE = ("/Helvetica-Bold", 10.0)
EXAMPLE_EN = ("/Helvetica-Oblique", 9.0)
NOTE = ("/Helvetica", 9.5)
RULE_SIZE = 10.3

HEADING = re.compile(r"^(\d+)\.\s+(.+)$")
EXPECTED_EXAMPLES = 4


def read_runs(pdf: Path) -> list[tuple[tuple[str, float], str, int]]:
    """Every non-empty text run in reading order, tagged with style and page."""
    runs: list[tuple[tuple[str, float], str, int]] = []
    page_number = 0

    def visit(text, cm, tm, font_dict, font_size):
        piece = text.strip()
        if not piece or font_dict is None:
            return
        style = (font_dict.get("/BaseFont", ""), round(float(font_size), 1))
        runs.append((style, piece, page_number))

    for index, page in enumerate(PdfReader(str(pdf)).pages, start=1):
        page_number = index
        page.extract_text(visitor_text=visit)
    return runs


def join(parts: list[str]) -> str:
    """Join wrapped runs into one string, without a space before punctuation."""
    text = " ".join(part for part in parts if part)
    # A run can begin with the punctuation that closes the previous one
    # ("werden im Infinitiv" + ". Muster: ..."), so the space is dropped there.
    # The lookahead spares the document's own "+ ... +" pattern.
    text = re.sub(r"\s+([,.;:!?])(?!\.)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def slug(title: str) -> str:
    """An ascii id fragment: 'Passiv mit Modalverben' -> 'passiv-mit-modalverben'."""
    folded = title.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    folded = unicodedata.normalize("NFKD", folded).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded.lower())).strip("-")


def split_topics(runs, part: int, source_file: str):
    """Cut the run stream into one list per topic heading."""
    topics, current = [], None
    for style, piece, page in runs:
        if style == TITLE and HEADING.match(piece):
            current = {"heading": piece, "page": page, "pages": [page], "runs": [],
                       "part": part, "sourceFile": source_file}
            topics.append(current)
            continue
        if current is None:
            continue                      # the cover title and subtitle
        if page not in current["pages"]:
            current["pages"].append(page)
        current["runs"].append((style, piece))
    return topics


def parse_topic(topic: dict, number: int) -> dict:
    """Parse one topic. The number is the position in the whole set, not in its
    own part, so the ids do not shift when a later part is added."""
    title = HEADING.match(topic["heading"]).group(2).strip()

    title_en = ""
    rule_de: list[str] = []
    rule_en: list[str] = []
    note_de: list[str] = []
    note_en: list[str] = []
    examples: list[dict] = []
    cells: list[tuple[tuple[str, float], list[str]]] = []

    section = ""
    for style, piece in topic["runs"]:
        if style == TITLE_EN and not title_en:
            title_en = piece
            continue
        if style == SECTION:
            # The two table headers sit inside the examples block and are not a
            # section of their own.
            if piece not in ("Deutsch", "English"):
                section = piece
            continue
        if style[1] == RULE_SIZE:
            (rule_en if section.startswith("Rule") else rule_de).append(piece)
            continue
        if style in (EXAMPLE_DE, EXAMPLE_EN):
            if cells and cells[-1][0] == style:
                cells[-1][1].append(piece)
            else:
                cells.append((style, [piece]))
            continue
        if style == NOTE:
            # The document prints the German note first, then the English one;
            # each opens with its own word, which is what separates them.
            if piece.startswith("Watch out") or note_en:
                note_en.append(piece)
            else:
                note_de.append(piece)

    for index in range(0, len(cells) - 1, 2):
        (de_style, de_parts), (en_style, en_parts) = cells[index], cells[index + 1]
        if de_style != EXAMPLE_DE or en_style != EXAMPLE_EN:
            raise SystemExit(
                f"topic {number}: expected a German example then its translation, "
                f"got {de_style} then {en_style}")
        examples.append({"de": join(de_parts), "en": join(en_parts)})

    if len(examples) != EXPECTED_EXAMPLES:
        raise SystemExit(f"topic {number} ({title!r}): {len(examples)} examples, "
                         f"expected {EXPECTED_EXAMPLES}")
    for label, value in (("English title", title_en), ("German rule", rule_de),
                         ("English rule", rule_en), ("German note", note_de),
                         ("English note", note_en)):
        if not value:
            raise SystemExit(f"topic {number} ({title!r}): no {label}")

    # The raw text every authored sentence is checked against. The examples are
    # written one per line so a sentence is matched whole rather than running
    # into its neighbour.
    text = "\n".join([
        f"{number}. {title}",
        title_en,
        join(rule_de),
        join(rule_en),
        *[f"{example['de']} — {example['en']}" for example in examples],
        join(note_de),
        join(note_en),
    ])

    return {
        "id": f"g-b2-{number}-{slug(title)}",
        "number": number,
        "title": title,
        "titleEn": title_en,
        "level": "B2",
        "section": "Deutsche Grammatik B2",
        "sectionNumber": str(number),
        # The page is the page of the part the topic was printed in, which is
        # what a reader checking the source would look for.
        "part": topic["part"],
        "sourceFile": topic["sourceFile"],
        "page": topic["page"],
        "pages": topic["pages"],
        "ruleDe": join(rule_de),
        "ruleEn": join(rule_en),
        "noteDe": join(note_de),
        "noteEn": join(note_en),
        "examples": examples,
        "text": text,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path, action="append",
                        help="a part of the set; repeat in order for several parts")
    parser.add_argument("--expect", type=int, default=0,
                        help="fail unless exactly this many topics are found")
    args = parser.parse_args()

    for pdf in args.pdf:
        if not pdf.exists():
            raise SystemExit(f"no such file: {pdf}")

    topics = []
    for part, pdf in enumerate(args.pdf, start=1):
        for raw in split_topics(read_runs(pdf), part, pdf.name):
            topics.append(parse_topic(raw, len(topics) + 1))

    if args.expect and len(topics) != args.expect:
        raise SystemExit(f"expected {args.expect} topics, found {len(topics)}")
    ids = [topic["id"] for topic in topics]
    if len(set(ids)) != len(ids):
        raise SystemExit("two topics produced the same id")

    OUT.write_text(json.dumps(topics, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"topics : {len(topics)} from {len(args.pdf)} part(s) -> {OUT}")
    for topic in topics:
        print(f"  {topic['number']:2}. {topic['title']}  "
              f"(part {topic['part']}, p{topic['page']}, {len(topic['examples'])} examples)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
