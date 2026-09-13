#!/usr/bin/env python3
"""Importer scaffold for the Goethe-Zertifikat B1 Wortliste.

Usage:  python3 extract_goethe_b1.py <Goethe-Zertifikat_B1_Wortliste.pdf>

WHY THIS IS A SCAFFOLD
----------------------
The B1 Wortliste was not supplied with the task. What arrived in its place was
a text file holding a fliphtml5 link, and that host is blocked by this
environment's network egress policy, so the document could never be read. A
parser cannot honestly be written against a layout nobody has seen, and
inventing ~2400 B1 words was explicitly ruled out — so the parsing step below
raises instead of guessing.

Everything around that step is real and ready:

  * ``RECORD`` documents the target shape, including the fields the OCR list
    cannot supply (plural, gender, verb forms, regional D/A/CH labels,
    cross-references between variants).
  * the helpers below normalise those fields once a parser produces raw strings.
  * ``write_entries`` emits ``goethe-b1-source.json`` in the same shape
    ``build_vocabulary.py`` already consumes.

To finish the import: read the PDF, fill in ``parse_entries``, run this script,
then run ``build_vocabulary.py`` and ``validate_content.py``. Nothing else in
the pipeline or the app needs to change — the exercise generator already
switches plural and verb-form questions on for any word that carries them.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "goethe-b1-source.json"

SOURCE_TITLE = "Goethe-Zertifikat B1 Wortliste"
LEVEL = "B1"

# The record every parsed entry must produce. Fields the document does not give
# for a particular entry stay empty — they are never filled in by guesswork.
RECORD = {
    "de": "",               # headword exactly as printed
    "en": "",               # gloss, only if the document prints one
    "article": "",          # der / die / das
    "plural": "",           # e.g. "-e", "die Tische"
    "gender": "",           # m / f / n, where stated separately from the article
    "wordType": "",         # noun / verb / adjective / ...
    "verbForms": {},        # {"3sg": "", "praeteritum": "", "perfekt": "", "separable": False}
    "examples": [],         # example sentences printed in the document
    "related": [],          # derived or related words printed with the entry
    "regionalVariant": "",  # D / A / CH label as printed
    "seeAlso": [],          # cross-references between variants
    "category": "",         # thematic group heading
    "subcategory": "",      # sub-heading within the group
    "section": "",          # "thematic" or "alphabetical"
    "page": 0,              # source page the entry was read from
}

ARTICLES = {"der", "die", "das"}
GENDER_BY_ARTICLE = {"der": "m", "die": "f", "das": "n"}
REGIONS = {"D", "A", "CH"}


def normalise_article(raw: str) -> tuple[str, str]:
    """('der Tisch', …) -> ('der', 'Tisch'); returns ('', raw) when absent."""
    parts = raw.strip().split(maxsplit=1)
    if len(parts) == 2 and parts[0].lower() in ARTICLES:
        return parts[0].lower(), parts[1].strip()
    return "", raw.strip()


def normalise_plural(raw: str, headword: str) -> str:
    """Expand a printed plural ending ('-e', '"-er') into a full form."""
    value = raw.strip()
    if not value or value in {"-", "–"}:
        return ""
    if not value.startswith(("-", "¨", '"')):
        return value
    ending = value.lstrip('-"¨')
    umlauted = value.startswith(('"', "¨"))
    stem = headword
    if umlauted:
        for plain, umlaut in (("au", "äu"), ("a", "ä"), ("o", "ö"), ("u", "ü")):
            if plain in stem.lower():
                index = stem.lower().rindex(plain)
                stem = stem[:index] + umlaut + stem[index + len(plain):]
                break
    return stem + ending


def normalise_region(raw: str) -> str:
    """Keep only labels the document actually uses; never merge variants."""
    label = raw.strip().strip("()").upper()
    return label if label in REGIONS else ""


def normalise_verb_forms(raw: str) -> dict:
    """'fährt, fuhr, ist gefahren' -> the three named forms."""
    parts = [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]
    forms: dict[str, object] = {}
    if len(parts) >= 1:
        forms["3sg"] = parts[0]
    if len(parts) >= 2:
        forms["praeteritum"] = parts[1]
    if len(parts) >= 3:
        forms["perfekt"] = parts[2]
    return forms


def blank_record(**fields) -> dict:
    record = {key: (value.copy() if isinstance(value, (dict, list)) else value)
              for key, value in RECORD.items()}
    record.update(fields)
    if record["article"] and not record["gender"]:
        record["gender"] = GENDER_BY_ARTICLE.get(record["article"], "")
    return record


def parse_entries(pdf_path: str) -> list[dict]:
    """Read the Wortliste and return one ``RECORD`` per lexical unit.

    NOT IMPLEMENTED — the source document was never available, so there is no
    layout to parse. Write this against the real PDF; the helpers above and
    ``write_entries`` below handle everything after it.
    """
    raise NotImplementedError(
        f"No parser yet for {pdf_path!r}.\n\n"
        "The Goethe-Zertifikat B1 Wortliste was not supplied with the task — the\n"
        "attachment was a fliphtml5 link whose host is blocked by this\n"
        "environment's network policy, so the document could not be read.\n\n"
        "Supply the PDF and implement parse_entries() against its real layout.\n"
        "Produce one record per lexical unit using blank_record(); the helpers\n"
        "above normalise articles, plurals, regional labels and verb forms.\n"
        "Keep D/A/CH variants as separate records linked through 'seeAlso' —\n"
        "never merge them into one entry."
    )


def write_entries(entries: list[dict]) -> None:
    problems = []
    seen = set()
    for index, entry in enumerate(entries):
        where = f"entry {index}"
        if not entry.get("de", "").strip():
            problems.append(f"{where}: missing German word")
        if entry.get("article") and entry["article"] not in ARTICLES:
            problems.append(f"{where}: malformed article {entry['article']!r}")
        if entry.get("regionalVariant") and entry["regionalVariant"] not in REGIONS:
            problems.append(f"{where}: unknown regional label {entry['regionalVariant']!r}")
        if not entry.get("page"):
            problems.append(f"{where}: missing source page")
        key = (entry.get("de"), entry.get("en"), entry.get("regionalVariant"))
        if key in seen:
            problems.append(f"{where}: duplicate of an earlier entry {key}")
        seen.add(key)
    if problems:
        for problem in problems[:40]:
            print("  ERROR:", problem, file=sys.stderr)
        raise SystemExit(f"{len(problems)} problem(s); nothing written")

    payload = {
        "meta": {"source": SOURCE_TITLE, "level": LEVEL, "entryCount": len(entries)},
        "entries": entries,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"entries {len(entries)} -> {OUT}")


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    write_entries(parse_entries(sys.argv[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
