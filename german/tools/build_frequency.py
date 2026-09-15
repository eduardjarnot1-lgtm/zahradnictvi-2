#!/usr/bin/env python3
"""Build german/data/frequency.json from a FrequencyWords-style word list.

Usage:  python3 build_frequency.py <de_top2000_frequency.txt>

Input is the plain "<form> <count>" list published by the hermitdave/
FrequencyWords project, derived from the OpenSubtitles corpus. Output is the
same data as JSON with an explicit rank, plus a meta block that records what
the corpus is and what it is not.

WHAT THIS LIST IS
-----------------
A list of *word forms*, ordered by how often that exact string occurs in film
and television subtitles. It is not a lemma list: "ist", "sind" and "war" are
three separate entries and none of them is "sein". It is not a CEFR list
either, and it skews spoken and colloquial, because that is what subtitles are.

Both facts matter downstream, so they are written into the file rather than
left for a reader to assume: build_vocabulary.py matches on the printed
headword only, and the app labels every rank as subtitle frequency.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "frequency.json"

SOURCE = "hermitdave/FrequencyWords — German (OpenSubtitles corpus)"
CORPUS_NOTE = (
    "Word forms ranked by frequency in film and television subtitles. This is a "
    "list of surface forms, not lemmas, and it skews spoken and colloquial "
    "German. It is not a CEFR list and implies nothing about level."
)

LINE = re.compile(r"^(\S+)\s+(\d+)\s*$")


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"no such file: {path}")

    forms: list[dict] = []
    seen: dict[str, int] = {}
    problems: list[str] = []

    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        match = LINE.match(line)
        if not match:
            problems.append(f"line {number}: cannot parse {line[:40]!r}")
            continue
        form, count = match.group(1).lower(), int(match.group(2))
        if form in seen:
            # The corpus can list the same form twice through casing; fold the
            # counts together rather than keeping a duplicate rank.
            forms[seen[form]]["count"] += count
            continue
        seen[form] = len(forms)
        forms.append({"form": form, "rank": 0, "count": count})

    if problems:
        for problem in problems[:20]:
            print("  ERROR:", problem, file=sys.stderr)
        raise SystemExit(f"{len(problems)} unparsable line(s); nothing written")
    if not forms:
        raise SystemExit("no entries read")

    forms.sort(key=lambda entry: (-entry["count"], entry["form"]))
    for rank, entry in enumerate(forms, start=1):
        entry["rank"] = rank

    counts = [entry["count"] for entry in forms]
    if counts != sorted(counts, reverse=True):
        raise SystemExit("ranking failed: counts are not monotonically decreasing")

    payload = {
        "meta": {
            "language": "de",
            "source": SOURCE,
            "corpus": "OpenSubtitles",
            "note": CORPUS_NOTE,
            "formCount": len(forms),
            "totalCount": sum(counts),
        },
        "forms": forms,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"forms {len(forms)} -> {OUT}")
    print(f"  most frequent: {', '.join(e['form'] for e in forms[:8])}")
    print(f"  least frequent kept: {forms[-1]['form']} ({forms[-1]['count']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
