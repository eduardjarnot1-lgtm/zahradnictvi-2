#!/usr/bin/env python3
"""Extract the grammar topics from the DaF kompakt neu A1/A2/B1 grammar PDF.

Usage:  python3 extract_daf_grammar.py <path-to-DaF_kompakt_neu_..._Grammar_English.pdf>

Writes daf-source.json next to this script: one record per grammar block, with
the Roman-numbered section it belongs to, the numbered sub-section, the CEFR
level the document itself prints beside the heading, the page and the raw
source text.

The level comes from the document, not from a judgement call: every block is
headed "... (A1)", "... (A2)" or "... (B1)".

As with the C1 extractor, the raw text is what the build step validates
authored content against, so nothing can be shown to a learner that is not in
the document.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "daf-source.json"

LEVELS = ("A1", "A2", "B1")

# Repeated on every page; none of it is content.
NOISE = re.compile(
    r"^(DaF Kompakt neu|DaF kompakt neu \w+\s+978-|© Ernst Klett Sprachen|"
    r"Alle Rechte vorbehalten|eigenen Unterrichtsgebrauch|Seite \d+\s*$)"
)
SECTION_RE = re.compile(r"^(I{1,3}|IV|V|VI{1,2}|IX|X)\.\s+(\S.*?)\s*$")
SUBSECTION_RE = re.compile(r"^(\d+)\.\s+(\S.*?)\s*$")
TOPIC_RE = re.compile(r"^(.*?)\s*\((A1|A2|B1)\)\s*$")


def normalise(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def wrapped_onto_next_line(previous: str) -> bool:
    """Did this line leave a heading unfinished?

    Only one heading in the document wraps, and it breaks inside a bracketed
    list: "... (e.g. an-, aus-, ... vorbei-," / "zurück-) (A1)". Checking that
    the line leaves a bracket open or ends mid-list is precise enough to catch
    it without swallowing headings that legitimately begin in lower case —
    "n-Declension: ...", "n-words", "aber, denn, und, ... → aduso-connectors".
    """
    if not previous:
        return False
    return previous.count("(") > previous.count(")") or previous.rstrip().endswith(",")


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    reader = PdfReader(sys.argv[1])

    # Flatten to (page, line) so a topic can span a page break.
    lines: list[tuple[int, str]] = []
    for number, page in enumerate(reader.pages, start=1):
        for raw in (page.extract_text() or "").split("\n"):
            line = normalise(raw)
            if not line or NOISE.match(line):
                continue
            lines.append((number, line))

    def next_content(index: int) -> str:
        for _, line in lines[index + 1:]:
            return line
        return ""

    topics: list[dict] = []
    section = ("", "")
    subsection = ""

    for index, (page, line) in enumerate(lines):
        match = SECTION_RE.match(line)
        if match and not TOPIC_RE.match(line):
            section = (match.group(1), match.group(2))
            subsection = ""
            continue

        sub = SUBSECTION_RE.match(line)
        # A real sub-heading is followed by a topic heading; a line like
        # "1. Hauptsatz" inside a table is followed by ordinary content.
        if sub and not TOPIC_RE.match(line) and TOPIC_RE.match(next_content(index)):
            subsection = sub.group(2)
            continue

        topic = TOPIC_RE.match(line)
        if topic:
            title, level = topic.group(1).strip(), topic.group(2)
            topics.append({
                "id": "",
                "section": section[1],
                "sectionNumber": section[0],
                "subsection": subsection,
                "title": title,
                "level": level,
                "page": page,
                "pages": [page],
                "lines": [],
            })
            continue

        if not topics:
            continue
        current = topics[-1]
        if page not in current["pages"]:
            current["pages"].append(page)
        current["lines"].append(line)

    # Rejoin the one heading that wraps: its first half was collected as the
    # last content line of the topic before it.
    for position, topic in enumerate(topics):
        if position == 0:
            continue
        previous = topics[position - 1]
        if previous["lines"] and wrapped_onto_next_line(previous["lines"][-1]):
            topic["title"] = normalise(f"{previous['lines'].pop()} {topic['title']}")

    slugs: dict[str, int] = {}
    for topic in topics:
        base = re.sub(r"[^a-z0-9]+", "-", topic["title"].lower()).strip("-")[:40] or "topic"
        slugs[base] = slugs.get(base, 0) + 1
        suffix = "" if slugs[base] == 1 else f"-{slugs[base]}"
        topic["id"] = f"g-daf-{topic['level'].lower()}-{base}{suffix}"
        topic["text"] = "\n".join(topic["lines"])
        del topic["lines"]

    ids = [t["id"] for t in topics]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise SystemExit(f"duplicate topic ids: {sorted(duplicates)}")

    empty = [t["id"] for t in topics if not t["text"].strip()]
    if empty:
        raise SystemExit(f"topics with no source text: {empty}")

    for topic in topics:
        if topic["level"] not in LEVELS:
            raise SystemExit(f"{topic['id']}: unexpected level {topic['level']!r}")
        if not topic["section"]:
            raise SystemExit(f"{topic['id']}: no section heading seen before this topic")

    OUT.write_text(json.dumps(topics, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {level: sum(1 for t in topics if t["level"] == level) for level in LEVELS}
    print(f"topics {len(topics)} -> {OUT}")
    print("  " + " · ".join(f"{level} {count}" for level, count in counts.items()))
    for topic in topics:
        print(f"  {topic['level']} {topic['sectionNumber']:>3}. {topic['section'][:22]:<22} "
              f"{topic['title'][:58]:<58} p{topic['page']:>2} {len(topic['text'])}c")
    return 0


if __name__ == "__main__":
    sys.exit(main())
