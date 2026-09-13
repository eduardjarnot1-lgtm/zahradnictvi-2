#!/usr/bin/env python3
"""Build german/data/grammar.json from the extracted C1 topics + annotations.

Pipeline
--------
1. ``extract_c1_grammar.py`` reads the Sicher! C1 Grammatikübersicht PDF and
   writes ``c1-source.json`` — 32 topics with their raw source text.
2. ``annotations/grammar/l*.json`` add, per topic, an English summary, the
   rules, the examples to show and the exercises to generate.
3. This script validates that authored content is actually grounded in the
   document and emits the runtime database.

The validation is the point of this step. Every example sentence, and every
exercise sentence marked ``"source": true``, must occur verbatim (whitespace
normalised) in the source text of its own topic. An exercise the author wrote
from scratch must say so with ``"source": false``, and is then labelled as a
practice item in the app rather than passed off as document content.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "c1-source.json"
ANNOTATIONS = ROOT / "annotations" / "grammar"
OUT = ROOT.parent / "data" / "grammar.json"

SOURCE_TITLE = "Sicher! C1 Grammatikübersicht"
SOURCE_CREDIT = (
    "Erweiterte Darstellung der Grammatikseiten zu Sicher! C1 Kursbuch, "
    "© Hueber Verlag; Autorinnen: Michaela Perlmann-Balme, Susanne Schwalb, "
    "Magdalena Matussek."
)

EXERCISE_TYPES = {"fill", "choice", "transform", "reorder", "error", "context"}
BLANK = "___"


def norm(text: str) -> str:
    """Whitespace-normalised, with the document's footnote markers removed.

    The PDF marks footnotes with an asterisk inside the sentence ("ich bin es*
    leider nicht"). The marker is typography, not language, so it is stripped
    on both sides of the comparison instead of being copied into learner text.
    """
    return re.sub(r"\s+", " ", text.replace("*", "")).strip()


def grounded(sentence: str, source_text: str) -> bool:
    """Is this sentence actually in the source text of its topic?

    Checked twice. Normally a whitespace-normalised substring match; failing
    that, a match with all spaces removed, because the document highlights
    suffixes by spacing them out inside the word ("das Vokabul ar"). The
    fallback still requires the full character sequence in order, so it cannot
    let through a sentence the document does not contain.
    """
    needle, hay = norm(sentence).rstrip(" ."), norm(source_text)
    if needle in hay:
        return True
    return needle.replace(" ", "") in hay.replace(" ", "")


def main() -> int:
    source = {t["id"]: t for t in json.loads(SOURCE.read_text(encoding="utf-8"))}
    files = sorted(ANNOTATIONS.glob("l*.json"))
    if not files:
        raise SystemExit(f"no annotation files in {ANNOTATIONS}")

    problems: list[str] = []
    topics: list[dict] = []
    seen: set[str] = set()

    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        for entry in data["topics"]:
            tid = entry["id"]
            where = f"{path.name}:{tid}"
            if tid not in source:
                problems.append(f"{where}: no such topic in the source document")
                continue
            if tid in seen:
                problems.append(f"{where}: topic annotated twice")
                continue
            seen.add(tid)
            src = source[tid]

            for example in entry.get("examples", []):
                if not grounded(example["de"], src["text"]):
                    problems.append(f"{where}: example not found in the source: {example['de'][:70]!r}")

            exercises = []
            for index, ex in enumerate(entry.get("exercises", []), start=1):
                eid = f"{tid}-e{index}"
                kind = ex.get("type")
                if kind not in EXERCISE_TYPES:
                    problems.append(f"{where} #{index}: unknown exercise type {kind!r}")
                    continue
                answers = [a for a in ex.get("answers", []) if a.strip()]
                if not answers:
                    problems.append(f"{where} #{index}: no answer given")
                # fill always needs a gap; context may instead offer options.
                needs_blank = kind == "fill" or (kind == "context" and not ex.get("options"))
                if needs_blank and BLANK not in ex.get("text", ""):
                    problems.append(f"{where} #{index}: {kind} exercise has no '{BLANK}' blank")
                if kind == "choice":
                    options = ex.get("options", [])
                    if len(options) < 3:
                        problems.append(f"{where} #{index}: choice needs at least 3 options")
                    for answer in answers:
                        if answer not in options:
                            problems.append(f"{where} #{index}: answer {answer!r} is not among the options")
                if ex.get("source") and "sentence" in ex:
                    if not grounded(ex["sentence"], src["text"]):
                        problems.append(
                            f"{where} #{index}: marked as a source sentence but not found: {ex['sentence'][:70]!r}")
                exercises.append({
                    "id": eid,
                    "topicId": tid,
                    "type": kind,
                    "prompt": ex["prompt"],
                    "text": ex.get("text", ""),
                    "from": ex.get("from", ""),
                    "options": ex.get("options", []),
                    "answers": answers,
                    "tokens": ex.get("tokens", []),
                    "hint": ex.get("hint", ""),
                    "explain": ex.get("explain", ""),
                    "fromSource": bool(ex.get("source")),
                })

            if not exercises:
                problems.append(f"{where}: no exercises")

            topics.append({
                "id": tid,
                "language": "de",
                "level": "C1",
                "lektion": src["lektion"],
                "number": src["number"],
                "title": src["title"],
                "titleEn": entry["titleEn"],
                "summary": entry["summary"],
                "category": entry.get("category", "Grammatik"),
                "tags": entry.get("tags", []),
                "difficulty": entry.get("difficulty", 3),
                "prerequisites": entry.get("prerequisites", []),
                "explanation": entry.get("explanation", []),
                "rules": entry.get("rules", []),
                "examples": entry.get("examples", []),
                "exercises": exercises,
                "kursbuch": src["kursbuch"],
                "source": SOURCE_TITLE,
                "sourcePage": src["page"],
                "sourcePages": src["pages"],
                "subtopics": src["subtopics"],
            })

    missing = [tid for tid in source if tid not in seen]
    if missing:
        problems.append(f"topics in the document with no annotation: {missing}")

    for topic in topics:
        for prerequisite in topic["prerequisites"]:
            if prerequisite not in source:
                problems.append(f"{topic['id']}: prerequisite {prerequisite!r} does not exist")

    if problems:
        print(f"{len(problems)} problem(s):", file=sys.stderr)
        for problem in problems:
            print("  -", problem, file=sys.stderr)
        return 1

    topics.sort(key=lambda t: (t["lektion"], t["number"]))
    database = {
        "meta": {
            "source": SOURCE_TITLE,
            "credit": SOURCE_CREDIT,
            "level": "C1",
            "topicCount": len(topics),
            "exerciseCount": sum(len(t["exercises"]) for t in topics),
            "exampleCount": sum(len(t["examples"]) for t in topics),
        },
        "lektionen": [
            {"lektion": n, "topics": [t["id"] for t in topics if t["lektion"] == n]}
            for n in sorted({t["lektion"] for t in topics})
        ],
        "topics": topics,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(database, ensure_ascii=False, indent=1), encoding="utf-8")
    meta = database["meta"]
    print(f"topics {meta['topicCount']} · examples {meta['exampleCount']} · "
          f"exercises {meta['exerciseCount']} -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
