#!/usr/bin/env python3
"""Build german/data/cefr.json — a sourced CEFR level for German vocabulary.

Usage:
  python3 build_cefr.py --goethe-dir DIR --tsv-dir DIR --lingster FILE.pdf --ding FILE.xz

Inputs
------
--goethe-dir  holds the three official Goethe-Institut word lists as PDFs:
                Goethe-Zertifikat_A1_Wortliste.pdf   (Start Deutsch 1)
                Goethe-Zertifikat_A2_Wortliste.pdf
                Goethe-Zertifikat_B1_Wortliste.pdf
--tsv-dir     holds a1/ a2/ b1/ directories of tab-separated transcriptions of
              those same PDFs (headword, German example sentence, English).
--lingster    "Der deutsche Wortschatz von A1 bis B2", Lingster Academy, whose
              entries each carry their own CEFR tag.
--ding        the Ding German-English dictionary (TU Chemnitz, GPL), used only
              to gloss words no word list translates — almost all of them B2,
              because the Lingster list gives levels but no English.

WHY BOTH A PDF AND A TSV FOR THE SAME LIST
------------------------------------------
The official PDFs are the authority on which words sit at which level, but two
of the three are laid out in columns that do not survive text extraction — the
B1 list interleaves headwords and example sentences out of order. The TSVs are
a third-party transcription of those same documents and are clean, but a
transcription is exactly the kind of source that can quietly drift from the
original.

So the two are used against each other: the TSV supplies the headword, the
example sentence and the English, and the headword is then required to occur in
the raw text of the official PDF for that level. A TSV row the official document
does not support is dropped and counted, never levelled on trust. The report
prints the verification rate so a drop in transcription quality is visible
rather than silent.

Lingster is the only source here that reaches B2, so B2 rests on it alone. That
is stated in the output's meta block rather than being smoothed over.

LEVELLING RULE
--------------
A word is assigned the *lowest* level any source lists it at. A word taught at
A1 is an A1 word even though it naturally also appears in the B1 list; the
alternative — letting a later list overwrite an earlier one — would push almost
everything to B1.
"""

from __future__ import annotations

import argparse
import json
import lzma
import re
import sys
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "cefr.json"

LEVELS = ["A1", "A2", "B1", "B2"]

SOURCES = {
    "goethe-a1": {
        "title": "Goethe-Zertifikat A1: Start Deutsch 1 — Wortliste",
        "publisher": "Goethe-Institut",
        "url": "https://www.goethe.de/pro/relaunch/prf/de/A1_SD1_Wortliste_02.pdf",
        "levels": ["A1"],
    },
    "goethe-a2": {
        "title": "Goethe-Zertifikat A2 — Wortliste",
        "publisher": "Goethe-Institut",
        "url": "https://www.goethe.de/pro/relaunch/prf/en/Goethe-Zertifikat_A2_Wortliste.pdf",
        "levels": ["A2"],
    },
    "goethe-b1": {
        "title": "Goethe-Zertifikat B1 — Wortliste",
        "publisher": "Goethe-Institut / ÖSD",
        "url": "https://www.goethe.de/pro/relaunch/prf/en/Goethe-Zertifikat_B1_Wortliste.pdf",
        "levels": ["B1"],
    },
    "ding": {
        "title": "Ding German-English dictionary",
        "publisher": "Frank Richter, TU Chemnitz (GPL v2 or later)",
        "url": "https://dict.zero-g.net/",
        "levels": [],
    },
    "lingster": {
        "title": "Der deutsche Wortschatz von A1 bis B2",
        "publisher": "Lingster Academy",
        "url": "https://lingster.academy/",
        "levels": ["A1", "A2", "B1", "B2"],
    },
}

GOETHE_PDFS = {
    "A1": "Goethe-Zertifikat_A1_Wortliste.pdf",
    "A2": "Goethe-Zertifikat_A2_Wortliste.pdf",
    "B1": "Goethe-Zertifikat_B1_Wortliste.pdf",
}

ARTICLES = ("der", "die", "das")
LINGSTER_ENTRY = re.compile(r"^(.*?)\s+(A1|A2|B1|B2)\s*$")
# "warten auf A", "sich erinnern an A", "schmecken nach D"
VERB_PREPOSITION = re.compile(
    r"\b(über|auf|an|für|mit|von|zu|nach|um|in|bei|aus|vor|gegen|durch)\s+([ADG])\b")


# Ding lines read "German side :: English side"; each side lists synonyms
# separated by ";" that correspond position by position, inflections after "|",
# grammar in {braces} and subject domains in [brackets].
DING_STRIP = re.compile(r"^(etw\.|jdn\.|jdm\.|jds\.|sich)\s+", re.I)
DING_DOMAIN = re.compile(r"\[(?!ugs\.|pej\.|geh\.|übtr\.)")


def ding_clean(text: str) -> str:
    text = re.sub(r"\{[^}]*\}", "", text)
    text = re.sub(r"\[[^\]]*\]", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    return re.sub(r"\s+", " ", text).strip(" ;,/")


def read_ding(path: Path, report: list[str]) -> dict:
    """{headword_lower: "sense one; sense two"}.

    Two senses rather than one, because Ding is ordered alphabetically and not
    by frequency: the first sense of a word can be a technical one. Entries
    carrying a subject domain are ranked below general-language entries for the
    same reason. This is a dictionary lookup, not a curated gloss, and every
    card built from it says so.
    """
    candidates: dict[str, list] = defaultdict(list)
    lines = 0
    with lzma.open(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("#") or "::" not in line:
                continue
            lines += 1
            german, english = line.split("::", 1)
            german, english = german.split("|")[0], english.split("|")[0]
            specialised = bool(DING_DOMAIN.search(german + english))
            german_parts, english_parts = german.split(";"), english.split(";")
            for index, part in enumerate(german_parts):
                head = DING_STRIP.sub("", ding_clean(part))
                if not head or len(head.split()) > 2:
                    continue
                gloss = ding_clean(english_parts[index] if index < len(english_parts)
                                   else english_parts[0])
                gloss = DING_STRIP.sub("", gloss)
                if gloss:
                    candidates[head.lower()].append((specialised, index, gloss))

    glosses = {}
    for head, senses in candidates.items():
        senses.sort(key=lambda item: (item[0], item[1]))
        chosen: list[str] = []
        for _, _, gloss in senses:
            if gloss.lower() not in (existing.lower() for existing in chosen):
                chosen.append(gloss)
            if len(chosen) == 2:
                break
        glosses[head] = "; ".join(chosen)
    report.append(f"Ding: {lines} dictionary lines read, {len(glosses)} headwords indexed")
    return glosses


def pdf_text(path: Path) -> str:
    """The whole document as one lowercased, whitespace-flattened string."""
    pages = (page.extract_text() or "" for page in PdfReader(str(path)).pages)
    return re.sub(r"\s+", " ", "\n".join(pages)).lower()


def split_headword(raw: str) -> tuple[str, str, str]:
    """'die Abfahrt, -en' -> ('Abfahrt', 'die', '-en'); 'abholen(1)' -> ('abholen', '', '')."""
    text = re.sub(r"\(\d+\)\s*$", "", raw).strip()
    text = re.split(r"\s*(?:→|/)\s*", text)[0].strip()      # keep the first variant only
    parts = [part.strip() for part in text.split(",")]
    head, rest = parts[0], parts[1:]
    article = ""
    for candidate in ARTICLES:
        if head.lower().startswith(candidate + " "):
            article, head = candidate, head[len(candidate) + 1:].strip()
            break
    # The lists use two notations for the same thing: B1 writes "-¨er" while A1
    # splits it across fields as "-ö, er". Keep every field after the headword so
    # the expander can see both shapes.
    plural = ", ".join(rest) if rest and rest[0].startswith(("-", "¨", '"')) else ""
    head = re.sub(r"\s*\(.*?\)\s*", " ", head).strip()
    return head, article, plural


def read_goethe(goethe_dir: Path, tsv_dir: Path, report: list[str]) -> dict:
    """{headword_lower: {level, article, plural, example, translation, source}}."""
    found: dict[str, dict] = {}
    for level in ("B1", "A2", "A1"):          # reverse order: A1 written last, so it wins
        pdf = goethe_dir / GOETHE_PDFS[level]
        if not pdf.exists():
            raise SystemExit(f"missing {pdf}")
        haystack = pdf_text(pdf)

        folder = tsv_dir / level.lower()
        files = sorted(folder.glob("*.tsv"))
        if not files:
            raise SystemExit(f"no .tsv files in {folder}")

        total = verified = 0
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                cells = line.split("\t")
                if len(cells) < 3 or not cells[0].strip():
                    continue
                if cells[0].strip() == "german word":
                    continue
                total += 1
                head, article, plural = split_headword(cells[0])
                if len(head) < 2 or head.lower() not in haystack:
                    continue
                verified += 1
                found[head.lower()] = {
                    "word": head,
                    "level": level,
                    "article": article,
                    "plural": plural,
                    "example": cells[1].strip(),
                    "translation": cells[2].strip(),
                    "source": f"goethe-{level.lower()}",
                }
        rate = round(100 * verified / total) if total else 0
        report.append(f"{level}: {verified} of {total} transcribed entries verified "
                      f"against the official PDF ({rate}%)")
        if rate < 75:
            raise SystemExit(f"{level}: only {rate}% of the transcription is supported by the "
                             f"official document — refusing to level words on that")
    return found


def read_lingster(path: Path, report: list[str]) -> dict:
    found: dict[str, dict] = {}
    rows = 0
    for page in PdfReader(str(path)).pages:
        for raw in (page.extract_text() or "").split("\n"):
            match = LINGSTER_ENTRY.match(raw.strip())
            if not match or not match.group(1).strip():
                continue
            rows += 1
            text, level = match.group(1).strip(), match.group(2)
            preposition = ""
            hit = VERB_PREPOSITION.search(text)
            if hit:
                preposition = f"{hit.group(1)} + {hit.group(2)}"
                text = text[:hit.start()].strip()
            head, article, plural = split_headword(text)
            if len(head) < 2:
                continue
            key = head.lower()
            # Lowest level wins within this document too.
            if key in found and LEVELS.index(found[key]["level"]) <= LEVELS.index(level):
                continue
            found[key] = {
                "word": head, "level": level, "article": article, "plural": plural,
                "example": "", "translation": "", "preposition": preposition,
                "source": "lingster",
            }
    report.append(f"Lingster: {rows} tagged lines read, {len(found)} distinct headwords")
    if not any(entry["level"] == "B2" for entry in found.values()):
        raise SystemExit("Lingster produced no B2 entries — B2 has no other source, so this is fatal")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--goethe-dir", required=True, type=Path)
    parser.add_argument("--tsv-dir", required=True, type=Path)
    parser.add_argument("--lingster", required=True, type=Path)
    parser.add_argument("--ding", required=True, type=Path)
    args = parser.parse_args()

    report: list[str] = []
    goethe = read_goethe(args.goethe_dir, args.tsv_dir, report)
    lingster = read_lingster(args.lingster, report)

    merged: dict[str, dict] = {}
    for table in (goethe, lingster):
        for key, entry in table.items():
            existing = merged.get(key)
            if existing is None:
                merged[key] = {**entry, "sources": [entry["source"]]}
                continue
            if entry["source"] not in existing["sources"]:
                existing["sources"].append(entry["source"])
            # lowest level wins
            if LEVELS.index(entry["level"]) < LEVELS.index(existing["level"]):
                existing["level"] = entry["level"]
            # fill gaps without overwriting what a source already gave
            for field in ("article", "plural", "example", "translation", "preposition"):
                if entry.get(field) and not existing.get(field):
                    existing[field] = entry[field]

    ding = read_ding(args.ding, report)
    glossed = 0
    for entry in merged.values():
        entry["translationSource"] = "wordlist" if entry.get("translation") else ""
        if entry.get("translation"):
            continue
        gloss = ding.get(entry["word"].lower())
        if gloss:
            entry["translation"] = gloss
            entry["translationSource"] = "ding"
            entry["sources"].append("ding")
            glossed += 1
    report.append(f"glossed from Ding: {glossed} entries no word list translates")

    entries = sorted(merged.values(), key=lambda e: (LEVELS.index(e["level"]), e["word"].lower()))
    for entry in entries:
        entry.pop("source", None)

    counts = {level: sum(1 for e in entries if e["level"] == level) for level in LEVELS}
    for level, count in counts.items():
        if not count:
            raise SystemExit(f"level {level} ended up empty — nothing would be levelled there")

    payload = {
        "meta": {
            "language": "de",
            "note": ("A word is listed at the lowest level any source assigns it. Levels A1-B1 come "
                     "from the official Goethe-Institut word lists, each transcribed entry verified "
                     "against the published PDF. B2 rests on the Lingster Academy list alone, which "
                     "is the only source here that reaches B2."),
            "sources": [{"key": key, **spec} for key, spec in SOURCES.items()],
            "levelCounts": counts,
            "entryCount": len(entries),
            "verification": report,
        },
        "entries": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"entries {len(entries)} -> {OUT}")
    for line in report:
        print("  " + line)
    print("  levels: " + " · ".join(f"{level} {count}" for level, count in counts.items()))
    prepositions = sum(1 for e in entries if e.get("preposition"))
    print(f"  verbs carrying a preposition: {prepositions}")
    untranslated = sum(1 for e in entries if not e.get("translation"))
    print(f"  still without any English: {untranslated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
