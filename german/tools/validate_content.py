#!/usr/bin/env python3
"""Validate the built content databases before they are shipped.

Usage:  python3 validate_content.py

Runs the checks the import pipeline is required to make across both databases:
duplicates, missing German words, malformed articles and plurals, invalid
levels, missing source attribution, malformed grammar topics and accidental
duplicate variants. Exits non-zero if anything fails, so it can gate a build.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
VOCABULARY = DATA / "vocabulary.json"
GRAMMAR = DATA / "grammar.json"

VALID_ARTICLES = {"der", "die", "das", ""}
VALID_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2", "GCSE"}
VALID_TYPES = {"noun", "verb", "adjective", "adverb", "pronoun",
               "preposition", "conjunction", "other"}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    def check(self, ok: bool, message: str, *, warn: bool = False) -> None:
        self.checks += 1
        if ok:
            return
        (self.warnings if warn else self.errors).append(message)


def validate_vocabulary(report: Report) -> None:
    db = json.loads(VOCABULARY.read_text(encoding="utf-8"))
    words = db["words"]
    report.check(bool(db["meta"].get("source")), "vocabulary: meta has no source")

    ids = Counter(w["id"] for w in words)
    for wid, count in ids.items():
        report.check(count == 1, f"vocabulary: duplicate id {wid} ({count}x)")

    # Same headword + same meaning + same type twice is an import fault; the
    # same headword with a different meaning is a homonym and legitimate.
    keys = defaultdict(list)
    for w in words:
        keys[(w["word"].lower(), w["translation"].lower(), w["type"])].append(w["id"])
    for key, group in keys.items():
        report.check(len(group) == 1, f"vocabulary: duplicate entry {key[0]!r} = {key[1]!r} -> {group}")

    # Accidental duplicate variants: identical headword and type, and one
    # meaning is a prefix of the other (usually the same entry imported twice).
    by_head = defaultdict(list)
    for w in words:
        by_head[(w["word"].lower(), w["type"])].append(w)
    for (head, _), group in by_head.items():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                x, y = a["translation"].lower(), b["translation"].lower()
                report.check(not (x.startswith(y) or y.startswith(x)),
                             f"vocabulary: near-duplicate variants for {head!r}: "
                             f"{a['id']} {x!r} / {b['id']} {y!r}", warn=True)

    for w in words:
        wid = w["id"]
        report.check(bool(w["word"].strip()), f"vocabulary {wid}: missing German word")
        report.check(bool(w["translation"].strip()), f"vocabulary {wid}: missing translation")
        report.check(w["type"] in VALID_TYPES, f"vocabulary {wid}: invalid word type {w['type']!r}")
        report.check(w["article"] in VALID_ARTICLES, f"vocabulary {wid}: malformed article {w['article']!r}")
        report.check(w["type"] != "noun" or bool(w["article"]) or w.get("needsReview"),
                     f"vocabulary {wid}: noun {w['word']!r} has no article and is not flagged")
        report.check(not w["article"] or w["type"] == "noun",
                     f"vocabulary {wid}: article on a non-noun")
        report.check(w["level"] in VALID_LEVELS, f"vocabulary {wid}: invalid level {w['level']!r}")
        report.check(bool(w.get("source")), f"vocabulary {wid}: missing source")

        # Two kinds of card now sit in this file and they carry different
        # evidence, so they are checked differently rather than one standard
        # being relaxed for both. A card read out of the paginated GCSE document
        # must cite its page and carry a translated example. A card imported
        # from a word list has no page to cite, and the lists print a German
        # example without an English one — so the example is optional, but if it
        # is there it must not be half-built.
        from_document = bool(w.get("sourcePage"))
        if from_document:
            report.check(isinstance(w["sourcePage"], int) and w["sourcePage"] > 0,
                         f"vocabulary {wid}: missing or malformed source page")
            report.check(bool(w["example"].strip()) and bool(w["exampleTranslation"].strip()),
                         f"vocabulary {wid}: missing example or its translation")
        else:
            report.check(not w["exampleTranslation"].strip() or bool(w["example"].strip()),
                         f"vocabulary {wid}: example translation with no example")

        # CEFR levelling, whichever kind of card it is.
        level, level_source = w.get("cefr", ""), w.get("cefrSource", "")
        report.check(level in VALID_LEVELS or level == "",
                     f"vocabulary {wid}: invalid CEFR level {level!r}")
        report.check(bool(level) == bool(level_source),
                     f"vocabulary {wid}: CEFR level and its source disagree "
                     f"({level!r}, {level_source!r})")
        report.check(w.get("translationSource", "") in ("", "wordlist", "ding"),
                     f"vocabulary {wid}: unknown translation source "
                     f"{w.get('translationSource')!r}")
        report.check(bool(w["categories"]), f"vocabulary {wid}: no category")
        # A plural form, when present, must look like a German plural rather
        # than a stray article or a sentence.
        plural = w.get("pluralForm", "")
        report.check(plural == "" or re.fullmatch(r"[-\w äöüÄÖÜß./()]+", plural),
                     f"vocabulary {wid}: malformed plural {plural!r}")
        report.check(not (w.get("plural") and not w["article"]),
                     f"vocabulary {wid}: marked plural but has no article", warn=True)

        rank, count = w.get("frequencyRank", 0), w.get("frequencyCount", 0)
        report.check(isinstance(rank, int) and rank >= 0,
                     f"vocabulary {wid}: malformed frequency rank {rank!r}")
        report.check(bool(rank) == bool(count),
                     f"vocabulary {wid}: frequency rank and count disagree ({rank}, {count})")

    # A rank may legitimately be shared: the corpus is case-folded and lists one
    # form, so homographs (morgen/Morgen, wagen/Wagen, Paar/paar) and two senses
    # of one word both match it. What must not happen is two *different* words
    # claiming the same rank.
    ranks = [w["frequencyRank"] for w in words if w.get("frequencyRank")]
    by_rank: dict[int, set] = {}
    for w in words:
        if w.get("frequencyRank"):
            by_rank.setdefault(w["frequencyRank"], set()).add(w["word"].lower())
    for rank, heads in by_rank.items():
        report.check(len(heads) == 1,
                     f"vocabulary: rank {rank} claimed by different words {sorted(heads)}")
    meta_cefr = db["meta"].get("cefr")
    if meta_cefr:
        for level, count in meta_cefr["levelCounts"].items():
            actual = sum(1 for w in words if w.get("cefr") == level)
            report.check(actual == count,
                         f"vocabulary: meta says {count} words at {level}, found {actual}")
        report.check(bool(meta_cefr.get("sources")),
                     "vocabulary: CEFR levels carry no source attribution")
        report.check(meta_cefr["levelCounts"].get("B2", 0) > 0,
                     "vocabulary: B2 is empty")

    meta_frequency = db["meta"].get("frequency")
    if meta_frequency:
        report.check(meta_frequency["rankedWords"] == len(ranks),
                     f"vocabulary: meta says {meta_frequency['rankedWords']} ranked words, "
                     f"found {len(ranks)}")
        report.check(bool(meta_frequency.get("source")),
                     "vocabulary: frequency data has no source attribution")
        report.check(max(ranks, default=0) <= meta_frequency["formCount"],
                     "vocabulary: a rank exceeds the number of forms in the list")

    print(f"vocabulary: {len(words)} words checked")


def validate_grammar(report: Report) -> None:
    db = json.loads(GRAMMAR.read_text(encoding="utf-8"))
    topics = db["topics"]
    sources = db["meta"].get("sources") or []
    report.check(bool(sources), "grammar: meta names no source document")
    for source in sources:
        report.check(bool(source.get("title")), "grammar: a source has no title")
        report.check(bool(source.get("credit")), f"grammar: source {source.get('key')} has no credit line")

    ids = Counter(t["id"] for t in topics)
    for tid, count in ids.items():
        report.check(count == 1, f"grammar: duplicate topic id {tid} ({count}x)")

    # A heading may legitimately recur at a different level — DaF kompakt prints
    # "Prepositions of place" once for A1 and again for A2 — so the level is part
    # of the key. Two topics sharing a title AND a level in one group would be a
    # double annotation.
    titles = Counter((t["sourceKey"], t["group"], t["level"], t["title"].lower()) for t in topics)
    for key, count in titles.items():
        report.check(count == 1, f"grammar: duplicate {key[2]} title in {key[0]} / {key[1]}: {key[3]!r}")

    known = {t["id"] for t in topics}
    exercise_ids: Counter = Counter()

    for t in topics:
        tid = t["id"]
        report.check(bool(t["title"].strip()), f"grammar {tid}: missing title")
        report.check(bool(t["titleEn"].strip()), f"grammar {tid}: missing English title")
        report.check(bool(t["summary"].strip()), f"grammar {tid}: missing summary")
        report.check(bool(t["explanation"]), f"grammar {tid}: no explanation")
        report.check(bool(t["rules"]), f"grammar {tid}: no rules")
        report.check(bool(t["examples"]), f"grammar {tid}: no examples")
        report.check(bool(t["exercises"]), f"grammar {tid}: no exercises")
        report.check(t["level"] in VALID_LEVELS, f"grammar {tid}: invalid level {t['level']!r}")
        report.check(bool(t.get("source")), f"grammar {tid}: missing source")
        report.check(isinstance(t.get("sourcePage"), int) and t["sourcePage"] > 0,
                     f"grammar {tid}: missing or malformed source page")
        report.check(isinstance(t["difficulty"], int) and 1 <= t["difficulty"] <= 5,
                     f"grammar {tid}: difficulty out of range")
        for prerequisite in t["prerequisites"]:
            report.check(prerequisite in known, f"grammar {tid}: unknown prerequisite {prerequisite}")
            report.check(prerequisite != tid, f"grammar {tid}: is its own prerequisite")
        for ex in t["exercises"]:
            exercise_ids[ex["id"]] += 1
            report.check(bool(ex["prompt"].strip()), f"grammar {ex['id']}: missing prompt")
            report.check(bool(ex["answers"]), f"grammar {ex['id']}: no answer")
            report.check(bool(ex["explain"].strip()), f"grammar {ex['id']}: no explanation", warn=True)
            if ex["type"] == "choice":
                report.check(len(ex["options"]) >= 3, f"grammar {ex['id']}: fewer than 3 options")
                report.check(len(set(ex["options"])) == len(ex["options"]),
                             f"grammar {ex['id']}: duplicate options")
            if ex["type"] == "reorder":
                report.check(bool(ex["tokens"]), f"grammar {ex['id']}: reorder without tokens")

    for eid, count in exercise_ids.items():
        report.check(count == 1, f"grammar: duplicate exercise id {eid}")

    # Prerequisite graph must be acyclic, or the lesson engine can loop.
    order = {t["id"]: t["prerequisites"] for t in topics}
    state: dict[str, int] = {}

    def walk(node: str) -> bool:
        if state.get(node) == 1:
            return False
        if state.get(node) == 2:
            return True
        state[node] = 1
        ok = all(walk(p) for p in order.get(node, []))
        state[node] = 2
        return ok

    for tid in order:
        report.check(walk(tid), f"grammar: prerequisite cycle involving {tid}")

    print(f"grammar: {len(topics)} topics, "
          f"{sum(len(t['exercises']) for t in topics)} exercises checked")


def main() -> int:
    report = Report()
    validate_vocabulary(report)
    validate_grammar(report)

    print(f"\n{report.checks} checks run")
    for warning in report.warnings:
        print("  warning:", warning)
    for error in report.errors:
        print("  ERROR:", error)
    if report.errors:
        print(f"\nFAILED — {len(report.errors)} error(s)")
        return 1
    print(f"PASSED — 0 errors, {len(report.warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
