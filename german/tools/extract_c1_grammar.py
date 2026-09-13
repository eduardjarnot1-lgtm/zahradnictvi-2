#!/usr/bin/env python3
"""Extract the grammar topics from the Sicher! C1 Grammatikübersicht PDF.

Usage:  python3 extract_c1_grammar.py <path-to-Sicher_C1_Grammatikuebersicht.pdf>

Writes c1-source.json next to this script: one record per numbered topic, with
the Lektion it belongs to, the topic number, the title, the Kursbuch reference
printed beside the title ("| S. 15/1"), the page it came from and the raw
source text of the topic.

The raw text is what the build step validates authored content against: every
example sentence shown in the app has to occur in the source text of its own
topic, so nothing can reach a learner that is not in the document.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "c1-source.json"

# Lines repeated on every page that carry no content.
NOISE = re.compile(
    r"^(GRAMMATIK C1|Erweiterte Darstellung der Grammatikseiten|Susanne Schwalb, Magdalena Matussek)"
)
# The PDF separates a heading from its Kursbuch reference with "|" plus a
# private-use arrow glyph (U+F0DF), e.g. "1 Zweiteilige Konnektoren | S. 28/3".
REF = r"(?:[|\uf0d0-\uf0ff\s]+(S\.[^|]*?))?"
TOPIC_RE = re.compile(r"^(\d)\s+([A-ZÄÖÜ][^|\uf0d0-\uf0ff]*?)\s*" + REF + r"\s*$")
SUBTOPIC_RE = re.compile(r"^([a-e])\s+([^|\uf0d0-\uf0ff]*?)\s*" + REF + r"\s*$")


def dehyphenate(text: str) -> str:
    """Undo the line-break hyphenation the PDF uses ("angemes -\\nsen").

    A line starting with a single letter and a space is a sub-topic heading
    ("a Verben mit ..."), never the tail of a hyphenated word, so those are
    left alone — otherwise "ver-" + "a Verben" would fuse into "vera Verben".
    """
    pattern = r"(\w)\s*-\s*\n\s*(?![a-e]\s)([a-zäöüß]{2,})"
    return re.sub(pattern, r"\1\2", text)


def normalise(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    reader = PdfReader(sys.argv[1])

    pages = []
    for number, page in enumerate(reader.pages, start=1):
        text = dehyphenate(page.extract_text() or "")
        lines = [normalise(line) for line in text.split("\n")]
        lines = [line for line in lines if line and not NOISE.match(line)]

        # Each page prints its own page number and its Lektion number on their
        # own lines; whichever lone number is not the page number is the Lektion.
        lone_numbers = [int(line) for line in lines if re.fullmatch(r"\d{1,2}", line)]
        candidates = [n for n in lone_numbers if n != number] or lone_numbers
        if not candidates:
            raise SystemExit(f"page {number}: no Lektion number found")
        lektion = candidates[0]
        lines = [line for line in lines if not re.fullmatch(r"\d{1,2}", line)]
        pages.append({"page": number, "lektion": lektion, "lines": lines})

    topics: list[dict] = []
    for page in pages:
        for line in page["lines"]:
            # A title that wraps ("... nach Adjektiven /") continues on the
            # next line, which carries the Kursbuch reference.
            if topics and topics[-1]["title"].endswith("/") and not topics[-1]["kursbuch"]:
                tail = SUBTOPIC_RE.match(line) or TOPIC_RE.match(line)
                cont = re.match(r"^([^|\uf0d0-\uf0ff]*?)\s*" + REF + r"\s*$", line)
                if cont and not tail:
                    topics[-1]["title"] = f"{topics[-1]['title'].rstrip('/').strip()} / {cont.group(1).strip()}"
                    topics[-1]["kursbuch"] = (cont.group(2) or "").strip()
                    continue

            match = TOPIC_RE.match(line)
            if match:
                topics.append({
                    "id": "",
                    "lektion": page["lektion"],
                    "number": int(match.group(1)),
                    "title": match.group(2).strip(),
                    "kursbuch": (match.group(3) or "").strip(),
                    "page": page["page"],
                    "pages": [page["page"]],
                    "subtopics": [],
                    "lines": [],
                })
                continue
            if not topics:
                continue
            topic = topics[-1]
            if page["page"] not in topic["pages"]:
                topic["pages"].append(page["page"])
            sub = SUBTOPIC_RE.match(line)
            if sub and len(line) < 110:
                topic["subtopics"].append({
                    "letter": sub.group(1),
                    "title": sub.group(2).strip(),
                    "kursbuch": (sub.group(3) or "").strip(),
                })
            topic["lines"].append(line)

    for topic in topics:
        topic["id"] = f"g-l{topic['lektion']:02d}-{topic['number']}"
        topic["text"] = "\n".join(topic["lines"])
        del topic["lines"]

    duplicates = [t["id"] for t in topics if [x["id"] for x in topics].count(t["id"]) > 1]
    if duplicates:
        raise SystemExit(f"duplicate topic ids: {sorted(set(duplicates))}")

    # Topic numbers restart at 1 in every Lektion and run without gaps; a break
    # in that sequence means a heading was missed or a table row was misread.
    for lektion in sorted({t["lektion"] for t in topics}):
        numbers = [t["number"] for t in topics if t["lektion"] == lektion]
        if numbers != list(range(1, len(numbers) + 1)):
            raise SystemExit(f"Lektion {lektion}: topic numbers are {numbers}, expected 1..{len(numbers)}")

    OUT.write_text(json.dumps(topics, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"topics {len(topics)} -> {OUT}")
    for topic in topics:
        subs = "".join(s["letter"] for s in topic["subtopics"])
        print(f"  L{topic['lektion']:>2} {topic['number']}  {topic['title'][:62]:<62} "
              f"{topic['kursbuch'][:18]:<18} p{topic['page']:>2} [{subs}] {len(topic['text'])}c")
    return 0


if __name__ == "__main__":
    sys.exit(main())
