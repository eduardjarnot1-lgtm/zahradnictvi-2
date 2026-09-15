#!/usr/bin/env python3
"""Extract the two B1 grammar topics the imported course documents do not cover.

Usage:
  python3 extract_web_grammar.py --grammar-dir DIR --exercises FILE.json --lingster FILE.pdf

WHY THIS EXISTS
---------------
The DaF kompakt document covers the werden-passive at A2 and the past-perfect
passive at B1, but has no Zustandspassiv block and no section on verbs that take
a fixed preposition. Those were the two gaps reported when that source was
imported, and nothing was invented to fill them at the time.

They are filled here from material that is actually published:

  * deutsch-lernen-goethe-a1-c2 by Abdullah Butt (CC BY-NC 4.0) — the
    Zustandspassiv section of its B2 grammar sheet, and the two
    "Verben mit Präposition" exercises in its B1 exercise set.
  * "Der deutsche Wortschatz von A1 bis B2", Lingster Academy — the entries
    that print a verb together with the preposition and case it governs
    ("warten auf A", "träumen von D"), which is a list of exactly the thing
    the missing topic is about.

The licence matters and is carried into the output: CC BY-NC permits this app,
which has no monetisation, and requires attribution, which build_grammar.py
prints on every screen that shows one of these topics.

As with every other source in this pipeline, the raw text of each topic is
written out so that build_grammar.py can check that nothing shown to a learner
is absent from it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web-grammar-source.json"

LINGSTER_ENTRY = re.compile(r"^(.*?)\s+(A1|A2|B1|B2)\s*$")
VERB_PREPOSITION = re.compile(
    r"^(.+?)\s+(über|auf|an|für|mit|von|zu|nach|um|in|bei|aus|vor|gegen|durch)\s+([ADG])$")

CREDIT = ("Zustandspassiv from deutsch-lernen-goethe-a1-c2 by Abdullah Butt, CC BY-NC 4.0; "
          "verb + preposition list from „Der deutsche Wortschatz von A1 bis B2“, Lingster Academy.")


def zustandspassiv(path: Path) -> dict:
    """The Zustandspassiv section of the B2 grammar sheet, verbatim."""
    text = path.read_text(encoding="utf-8")
    start = text.find("### Zustandspassiv")
    if start == -1:
        raise SystemExit(f"no Zustandspassiv section in {path}")
    end = text.find("###", start + 3)
    section = text[start:end if end != -1 else len(text)]

    # Also carry the werden-passive rows above it, because the topic is about
    # the contrast and the contrast sentences live there.
    table = re.findall(r"^\|\s*(?:Präsens|Präteritum|Perfekt|Plusquamperfekt|Futur I|"
                       r"Konjunktiv II|Modal \+ Passiv|mit Modalverb)\s*\|.*$",
                       text, re.MULTILINE)

    body = section + "\n" + "\n".join(table)
    body = body.replace("**", "").replace("### ", "")
    return {
        "id": "g-web-b1-zustandspassiv",
        "title": "Zustandspassiv (sein + Partizip II)",
        "level": "B1",
        "section": "Passiv",
        "sectionNumber": "I",
        "subsection": "Zustandspassiv",
        "page": 1,
        "pages": [1],
        "text": body.strip(),
    }


def verbs_with_prepositions(exercises: Path, lingster: Path) -> dict:
    lines: list[str] = []

    data = json.loads(exercises.read_text(encoding="utf-8"))
    for item in data:
        if not item.get("topic", "").startswith("Verben mit Präposition"):
            continue
        filled = item["prompt_de"].replace("____", item["correct"])
        lines.append(f"{item['topic']}: {filled} — {item['prompt_en']}")
        lines.append(item["explanation_en"].replace("<b>", "").replace("</b>", ""))

    pairs: list[str] = []
    for page in PdfReader(str(lingster)).pages:
        for raw in (page.extract_text() or "").split("\n"):
            match = LINGSTER_ENTRY.match(raw.strip())
            if not match:
                continue
            entry = VERB_PREPOSITION.match(match.group(1).strip())
            if entry:
                verb, preposition, case = entry.groups()
                pairs.append(f"{verb} {preposition} {case}")

    if len(pairs) < 20:
        raise SystemExit(f"only {len(pairs)} verb+preposition pairs found — refusing to build a "
                         f"topic about them on that")

    seen: list[str] = []
    for pair in pairs:
        if pair not in seen:
            seen.append(pair)

    body = "\n".join(lines + [""] + seen)
    return {
        "id": "g-web-b1-verben-mit-praeposition",
        "title": "Verben mit fester Präposition",
        "level": "B1",
        "section": "Verben",
        "sectionNumber": "II",
        "subsection": "Verben mit Präposition",
        "page": 1,
        "pages": [1],
        "text": body.strip(),
        "pairs": seen,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--grammar-dir", required=True, type=Path,
                        help="the deutsch-lernen-goethe-a1-c2 checkout")
    parser.add_argument("--exercises", required=True, type=Path, help="grammar_b1.json")
    parser.add_argument("--lingster", required=True, type=Path)
    args = parser.parse_args()

    topics = [
        zustandspassiv(args.grammar_dir / "B2" / "02_Grammatik.md"),
        verbs_with_prepositions(args.exercises, args.lingster),
    ]
    for topic in topics:
        if not topic["text"].strip():
            raise SystemExit(f"{topic['id']}: no source text extracted")

    OUT.write_text(json.dumps(topics, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"topics {len(topics)} -> {OUT}")
    for topic in topics:
        print(f"  {topic['level']} {topic['id']:<42} {len(topic['text'])}c")
    print(f"  credit: {CREDIT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
