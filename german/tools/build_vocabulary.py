#!/usr/bin/env python3
"""Build german/data/vocabulary.json from the extracted source list + annotations.

Pipeline
--------
1. ``extract_pdf.py``  reads the OCR GCSE German Vocabulary List PDF and writes
   ``source-entries.json`` (German term, English gloss, topic area, sub-topic,
   tier, page).  That file is the *only* source of vocabulary items.
2. ``annotations/*.tsv`` add metadata for each source entry, in exactly the same
   order: word type, article, example sentence, English translation of the
   example and an optional note.  No annotation file may add or remove a row --
   the build fails loudly if the German term of a row does not match the source.
3. This script merges duplicates, applies the curated overrides below and emits
   the runtime database.

Nothing here may introduce a vocabulary item that is not in source-entries.json.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_OUT = ROOT.parent / "data" / "vocabulary.json"
SOURCE = ROOT / "source-entries.json"
ANNOTATIONS = ROOT / "annotations"

SOURCE_TITLE = "OCR GCSE German Vocabulary List (General and Topic Areas 1 to 5)"

# The document grades its entries by tier, not by CEFR level. The mapping below
# is the usual approximation and is labelled as such everywhere it is shown —
# the document itself never states a CEFR level.
TIER_TO_CEFR = {"Foundation": "A2", "Higher": "B1"}
CEFR_NOTE = ("Approximate mapping of the document's Foundation/Higher tier. "
             "The OCR list does not state CEFR levels itself.")
SOURCE_NOTE = (
    "All vocabulary items and all categories come from the OCR GCSE German "
    "Vocabulary List. Articles, example sentences and example translations were "
    "added as metadata for the existing entries; no words were added."
)

# --- categories -------------------------------------------------------------
# id, emoji, full name as printed in the document
CATEGORIES = [
    ("general", "\U0001F5C2️", "General"),
    ("home", "\U0001F3E0", "Home and local area"),
    ("health", "\U0001F4AA", "Health and sport"),
    ("leisure", "\U0001F3AC", "Leisure and entertainment"),
    ("travel", "✈️", "Travel and the wider world"),
    ("education", "\U0001F393", "Education and work"),
    # Every card also sits under its CEFR level, so the whole vocabulary can be
    # browsed by level and not only by the GCSE document's own topics.
    ("levels", "\U0001F4C8", "By level"),
]

LEVEL_EMOJI = {"A1": "\U0001F331", "A2": "\U0001F33F", "B1": "\U0001F333", "B2": "\U0001F332"}

# document sub-topic -> (category id, sub id, short label, emoji)
SUBTOPICS = {
    "General": ("general", "general", "General vocabulary", "\U0001F5C2️"),
    "Life in the home; friends and relationships": (
        "home", "home-life", "Life in the home, friends & relationships", "\U0001F6CB️"),
    "Local area, facilities and getting around": (
        "home", "local-area", "Local area, facilities & getting around", "\U0001F5FA️"),
    "Sport, outdoor pursuits and healthy lifestyle": (
        "health", "sport", "Sport, outdoor pursuits & healthy lifestyle", "⚽"),
    "Food and drink as aspects of culture and health": (
        "health", "food", "Food and drink", "\U0001F37D️"),
    "Socialising, special occasions and festivals": (
        "leisure", "socialising", "Socialising, occasions & festivals", "\U0001F389"),
    "TV, films and music": ("leisure", "media", "TV, films and music", "\U0001F3B5"),
    "Holidays and exchanges": ("travel", "holidays", "Holidays and exchanges", "\U0001F3D6️"),
    "Environmental, cultural and social issues": (
        "travel", "environment", "Environmental, cultural & social issues", "\U0001F30D"),
    "School life in the UK and in the target language country or community": (
        "education", "school", "School life", "\U0001F4DA"),
    "Work experience, future study and jobs, working abroad": (
        "education", "work", "Work experience, study & jobs", "\U0001F4BC"),
}

WORD_TYPES = [
    ("noun", "Nouns", "\U0001F9E9"),
    ("verb", "Verbs", "⚡"),
    ("adjective", "Adjectives", "\U0001F3A8"),
    ("adverb", "Adverbs", "\U0001F9ED"),
    ("pronoun", "Pronouns", "\U0001F464"),
    ("preposition", "Prepositions", "\U0001F4CD"),
    ("conjunction", "Conjunctions", "\U0001F517"),
    ("other", "Other useful vocabulary", "✨"),
]
VALID_TYPES = {t[0] for t in WORD_TYPES}
VALID_ARTICLES = {"der", "die", "das", ""}

# --- curated overrides ------------------------------------------------------
# Entries the document lists in the plural. "die" is then the plural article,
# not the gender of the singular, so the card says so instead of teaching a
# wrong gender.
PLURAL_ENTRIES = {
    "Haare", "Ohrringe", "Schuhe", "Turnschuhe", "Kleider / Kleidung", "Möbel",
    "Kontaktlinsen", "Streichhölzer", "Senioren", "Zwillinge", "Eltern",
    "Geschwister", "Leute / Menschen", "Bremsen", "Lebensmittel(geschäft)",
    "Bohnen", "Erbsen", "Nudeln", "Chips / Kartoffelschips", "Cornflakes",
    "Kekse", "Pommes (frites)", "Pralinen", "Salzkartoffeln",
    "Bratkartoffeln (Bratpfanne)", "Süßigkeiten", "Bonbons", "Ferien",
    "Herbergseltern", "Medien (Massenmedien)", "Nachrichten", "Sitten",
    "Vokabeln", "Naturwissenschaften", "Halsschmerzen", "Kopfschmerzen",
    "Schmerzen (schmerzhaft)", "Erfrischungen", "Aufheiterungen",
    "Haus(aufgaben/arbeit)",
}

# Entries where stripping the bracketed part leaves a fragment rather than a
# word ("Geburts(tag / ort)" -> "Geburts"), so the card shows a real headword.
ARTICLE_OVERRIDES = {
    "Jura": "",   # a plural-form subject name, used without an article
}

HEADWORD_OVERRIDES = {
    "Geburts(tag / ort)": "Geburtstag",
    "Klapp- (stuhl / tisch)": "Klappstuhl",
    "Geschwindigkeits(begrenzung)": "Geschwindigkeitsbegrenzung",
    "alkohol(frei)": "Alkohol",
    "Haus(aufgaben/arbeit)": "Hausaufgaben",
}

# Extra notes, keyed by the document's German term.
EXTRA_NOTES = {
    "See (der/die) (an der See)":
        "The document itself lists both genders: der See = lake, die See = sea.",
    "Cola": "Both die Cola and das Cola are used; die Cola is the most common.",
    "Gummi": "der Gummi (rubber, the material and the eraser); das Gummi also occurs.",
    "Prospekt": "der Prospekt is standard in Germany; das Prospekt is used in Austria.",
    "Schaschlick": "Usually spelled Schaschlik today; both der and das are found.",
    "Verwandte": "Adjectival noun: der Verwandte / die Verwandte depending on the person.",
    "Erwachsene": "Adjectival noun: der Erwachsene / die Erwachsene depending on the person.",
    "Jugendliche (r)": "Adjectival noun: der Jugendliche / die Jugendliche depending on the person.",
    "Bekannter": "Adjectival noun: der Bekannte / die Bekannte depending on the person.",
    "Reisende(r)": "Adjectival noun: der Reisende / die Reisende depending on the person.",
    "Illustrierte": "Adjectival noun: die Illustrierte (plural: die Illustrierten).",
    "Weihnachten": "Normally used without an article: zu Weihnachten, an Weihnachten.",
    "Ostern": "Normally used without an article: zu Ostern.",
    "Silvester": "Normally used without an article: an Silvester.",
    "Jura": "Used without an article: Jura studieren.",
    "Retten": "The document capitalises this entry, but it is the verb retten.",
    "Bemerken": "The document capitalises this entry, but it is the verb bemerken.",
    "Rücken": "Listed in the transport section of the document; it means the body part.",
    "Teil": "der Teil (a part of a whole); das Teil is used for a separate component.",
    "Schild (Straßenschild)": "das Schild = sign; der Schild = shield.",
    "Steuer(rad)": "das Steuer = steering wheel; die Steuer = tax.",
    "Lieblings-": "A prefix rather than a free-standing word: Lieblingsfilm, Lieblingsfach.",
}

# Entries whose article could not be settled with confidence and that a teacher
# should check. Kept deliberately small and explicit.
NEEDS_REVIEW = {
    "Cola", "Gummi", "Prospekt", "Schaschlick", "Jura",
    "Verwandte", "Erwachsene", "Jugendliche (r)", "Bekannter", "Reisende(r)",
    "See (der/die) (an der See)",
}


def clean_term(term: str) -> str:
    term = term.replace("`", "").strip()
    return re.sub(r"\s+", " ", term)


def headword_of(term: str) -> str:
    """The single form used for the article line on the card."""
    if term in HEADWORD_OVERRIDES:
        return HEADWORD_OVERRIDES[term]
    # drop a trailing/attached parenthetical: "Wetter(bericht)" / "Abend (abends)"
    head = re.sub(r"\s*\([^)]*\)", "", term).strip()
    if not head:
        head = term
    # first alternative of "Krawatte / Schlips"
    head = re.split(r"\s*/\s*", head)[0].strip()
    return head or term


def variants_of(term: str, head: str) -> str:
    return "" if clean_term(term) == head else clean_term(term)


SEPARABLE_PREFIXES = (
    "zurück", "wieder", "herunter", "vorbei", "zusammen", "heraus", "durch",
    "unter", "über", "statt", "gegen", "voran", "hinter", "auseinander",
    "auf", "aus", "ein", "mit", "nach", "vor", "zu", "an", "ab", "bei",
    "her", "hin", "weg", "los", "um", "fest", "frei", "teil", "dar", "empor",
)
UMLAUTS = str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "s", "é": "e"})


def _fold(text: str) -> str:
    return text.lower().translate(UMLAUTS)


def _skeleton(text: str) -> str:
    """Consonant skeleton, so strong verbs (brechen -> gebrochen) still match."""
    return re.sub(r"[aeiouy]+", "", _fold(text))


def example_uses_word(term: str, head: str, example: str) -> bool:
    """Loose check that the example really uses the entry (inflections allowed)."""
    hay = _fold(example)
    hay_skeleton = _skeleton(example)
    short, long_ = set(), set()
    for token in re.split(r"[\s/()…,.!?-]+", term) + [head]:
        token = token.strip()
        if len(token) < 2:
            continue
        base = _fold(token)
        forms = {base}
        for suffix in ("en", "ern", "eln", "n", "e"):
            if base.endswith(suffix) and len(base) - len(suffix) >= 3:
                forms.add(base[: -len(suffix)])
        for form in list(forms):
            for prefix in SEPARABLE_PREFIXES:
                if form.startswith(prefix) and len(form) - len(prefix) >= 3:
                    forms.add(form[len(prefix):])
        for form in forms:
            (short if len(form) < 4 else long_).add(form)

    if any(f in hay for f in long_):
        return True
    if any(re.search(rf"\b{re.escape(f)}", hay) for f in short if f):
        return True
    return any(len(s) >= 3 and s in hay_skeleton for s in (_skeleton(f) for f in long_))


def load_source():
    entries = json.loads(SOURCE.read_text(encoding="utf-8"))
    groups = OrderedDict()
    for e in entries:
        groups.setdefault((e["topic"], e["sub"]), []).append(e)
    return groups


def load_annotations():
    files = sorted(ANNOTATIONS.glob("*.tsv"))
    out = []
    for f in files:
        rows = []
        for lineno, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 5:
                raise SystemExit(f"{f.name}:{lineno}: expected 5-6 tab separated fields, got {len(parts)}")
            de, wtype, article, example, example_en = (p.strip() for p in parts[:5])
            note = parts[5].strip() if len(parts) > 5 else ""
            if wtype not in VALID_TYPES:
                raise SystemExit(f"{f.name}:{lineno}: unknown word type {wtype!r}")
            if article not in VALID_ARTICLES:
                raise SystemExit(f"{f.name}:{lineno}: unknown article {article!r}")
            if wtype != "noun" and article:
                raise SystemExit(f"{f.name}:{lineno}: article given for a non-noun ({de})")
            if not example or not example_en:
                raise SystemExit(f"{f.name}:{lineno}: missing example for {de!r}")
            rows.append(dict(de=de, type=wtype, article=article, example=example,
                             exampleTranslation=example_en, note=note))
        out.append((f.name, rows))
    return out


FREQUENCY = Path(__file__).resolve().parent.parent / "data" / "frequency.json"
CEFR = Path(__file__).resolve().parent.parent / "data" / "cefr.json"

# A card built from the CEFR word lists rather than from the GCSE document.
CEFR_SOURCE = "Goethe-Institut word lists (A1/A2/B1) and Lingster Academy A1-B2"


def level_placement(level: str) -> dict:
    """The same shape the GCSE placements use, so nothing downstream changes."""
    return {"category": "levels", "subcategory": level.lower(), "tier": "", "page": 0}


LEVELS_ORDER = ["A1", "A2", "B1", "B2"]


def word_type_of(entry: dict) -> str:
    """Classify a word-list entry the same way the GCSE annotations do.

    The word lists do not print a part of speech, so it is read off the shape of
    the entry: an article makes it a noun, the German infinitive endings make it
    a verb, and anything else is left unclassified rather than guessed at — the
    app already copes with a card whose type is empty.
    """
    if entry.get("article"):
        return "noun"
    word = entry["word"]
    # A capitalised entry with no article printed is not called a noun here.
    # Some are prefixes (Öko-, Haupt-), some are phrases (Bescheid geben), and
    # for the rest the list simply did not give a gender — and a noun card with
    # no article would be teaching a blank where the article should be.
    if word[:1].isupper():
        return "other"
    if word.endswith(("en", "ern", "eln")) and len(word) > 3:
        return "verb"
    # The word lists print no part of speech, so anything the shape of the entry
    # does not settle goes to "other" rather than being guessed at.
    return "other"


UMLAUT = {"au": "äu", "a": "ä", "o": "ö", "u": "ü"}
UMLAUT_LETTERS = {"ä": "a", "ö": "o", "ü": "u"}


def umlaut_stem(stem: str) -> str:
    """Umlaut the last stem vowel: Abflug -> Abflüg, Haus -> Häus, Vater -> Väter."""
    lowered = stem.lower()
    best, best_len = -1, 0
    for plain in ("au", "a", "o", "u"):
        index = lowered.rfind(plain)
        if index == -1:
            continue
        # Rightmost vowel wins. Where two candidates end at the same place, the
        # longer one is the real nucleus — the "u" of Haus is part of "au", so
        # Haus becomes Häuser and never "Haüser".
        if (index + len(plain), len(plain)) > (best + best_len, best_len):
            best, best_len = index, len(plain)
    if best == -1:
        return ""
    replacement = UMLAUT[lowered[best:best + best_len]]
    if stem[best].isupper():
        replacement = replacement.capitalize()
    return stem[:best] + replacement + stem[best + best_len:]


def expand_plural(marker: str, headword: str) -> str:
    """Turn the word lists' plural shorthand into a form a learner can read.

    Two notations appear, because the lists do not agree with each other:

        "-e"        Tisch   -> Tische          ending only
        "-n"        Frage   -> Fragen
        "-¨er"      Haus    -> Häuser          diaeresis marks an umlaut
        "-ö, er"    Dorf    -> Dörfer          A1 spells the umlauted vowel out
        "-¨"        Vater   -> Väter           umlaut with no ending

    The umlaut lands on the *last* stem vowel, not the first: Abflug is Abflüge,
    never "äbfluge". Anything outside these shapes is dropped rather than
    mangled — a wrong plural on a card is worse than no plural at all.
    """
    value = marker.strip()
    if not value or value in {"-", "–"} or not re.fullmatch(r"[A-Za-zÄÖÜäöüß]+", headword):
        return ""

    fields = [field.strip() for field in value.split(",") if field.strip()]
    if not fields:
        return ""

    head = fields[0]
    umlauted = "¨" in head or '"' in head
    ending = head.lstrip('-¨"')

    # "-ö, er": the first field names the umlauted vowel, the rest is the ending.
    if len(ending) == 1 and ending in UMLAUT_LETTERS:
        umlauted, ending = True, "".join(fields[1:])
    elif len(fields) > 1:
        return ""                      # an extra field we do not understand

    if not re.fullmatch(r"[a-zäöüß]*", ending):
        return ""

    stem = umlaut_stem(headword) if umlauted else headword
    if not stem:
        return ""
    return stem + ending


def cefr_index() -> tuple[dict, dict]:
    """Load data/cefr.json, or return empty if it has not been built."""
    if not CEFR.exists():
        return {}, {}
    payload = json.loads(CEFR.read_text(encoding="utf-8"))
    return {entry["word"].lower(): entry for entry in payload["entries"]}, payload["meta"]


def frequency_index() -> tuple[dict, dict]:
    """Load data/frequency.json, or return empty if it has not been built.

    The rank is matched against the *printed headword*, lowercased, and nothing
    else. The corpus lists surface forms, so "ist" and "sind" are their own
    entries and neither resolves to "sein"; pretending otherwise would attach a
    number to a card the corpus never measured. Cards that do not match simply
    carry no rank.
    """
    if not FREQUENCY.exists():
        return {}, {}
    payload = json.loads(FREQUENCY.read_text(encoding="utf-8"))
    index = {entry["form"]: entry for entry in payload["forms"]}
    return index, payload["meta"]


def main() -> int:
    groups = load_source()
    annotations = load_annotations()

    if len(groups) != len(annotations):
        raise SystemExit(f"{len(groups)} source groups but {len(annotations)} annotation files")

    words = OrderedDict()   # (headword, translation, type) -> word record
    order = []
    problems = []

    for (key, src_rows), (fname, ann_rows) in zip(groups.items(), annotations):
        topic, sub = key
        if len(src_rows) != len(ann_rows):
            raise SystemExit(f"{fname}: {len(ann_rows)} rows for {len(src_rows)} source entries ({topic} / {sub})")
        cat_id, sub_id, _, _ = SUBTOPICS[sub]
        for src, ann in zip(src_rows, ann_rows):
            if clean_term(src["de"]) != clean_term(ann["de"]):
                raise SystemExit(f"{fname}: expected {src['de']!r}, annotation says {ann['de']!r}")

            term = clean_term(src["de"])
            head = headword_of(term)
            translation = clean_term(src["en"])
            dedup_key = (head.lower(), translation.lower(), ann["type"])

            placement = {
                "category": cat_id,
                "subcategory": sub_id,
                "tier": src["tier"],
                "page": src["page"],
            }

            if dedup_key in words:
                w = words[dedup_key]
                if placement not in w["categories"]:
                    w["categories"].append(placement)
                # A word listed in both tiers keeps the easier of the two.
                if src["tier"] == "Foundation":
                    w["cefrApprox"] = TIER_TO_CEFR["Foundation"]
                continue

            note = ann["note"] or EXTRA_NOTES.get(term, "")
            if term in EXTRA_NOTES and ann["note"] and EXTRA_NOTES[term] not in note:
                note = f"{note} {EXTRA_NOTES[term]}"

            plural = term in PLURAL_ENTRIES
            article = ARTICLE_OVERRIDES.get(term, ann["article"])
            if plural and article:
                note = (note + " " if note else "") + \
                    "Listed in the plural, so “die” here is the plural article."

            tiers = {placement["tier"]}
            word = {
                "id": "",
                "language": "de",
                "level": "GCSE",
                "cefrApprox": TIER_TO_CEFR.get(src["tier"], ""),
                "source": SOURCE_TITLE,
                "sourcePage": src["page"],
                "regionalVariant": "",
                "pluralForm": "",
                "verbForms": {},
                "word": head,
                "term": term,
                "variants": variants_of(term, head),
                "translation": translation,
                "type": ann["type"],
                "article": article,
                "plural": plural,
                "example": ann["example"],
                "exampleTranslation": ann["exampleTranslation"],
                "note": note,
                "needsReview": term in NEEDS_REVIEW,
                "categories": [placement],
            }
            words[dedup_key] = word
            order.append(dedup_key)

            if ann["type"] == "noun" and not article:
                problems.append(f"noun without article: {term}")
            if not example_uses_word(term, head, ann["example"]):
                problems.append(f"example may not use {head!r}: {ann['example']}")

    word_list = [words[k] for k in order]

    # --- CEFR levels ---------------------------------------------------------
    # The GCSE document grades by Foundation/Higher tier, which is not CEFR. Where
    # a word appears in one of the CEFR word lists, that level replaces the tier
    # approximation and the card records which list said so. Where it does not,
    # the card keeps the approximation and says that is what it is.
    cefr, cefr_meta = cefr_index()
    levelled = 0
    for word in word_list:
        entry = cefr.get(word["word"].lower())
        if entry:
            word["cefr"] = entry["level"]
            word["cefrSource"] = ", ".join(entry["sources"])
            levelled += 1
        else:
            word["cefr"] = word.get("cefrApprox", "")
            word["cefrSource"] = "tier-approximation"

    # --- new cards from the word lists ---------------------------------------
    # Everything above comes from the GCSE document. These are the words the CEFR
    # lists carry that the GCSE list does not, which is what actually gives the
    # app an A1-B2 span rather than one exam board's selection.
    known = {w["word"].lower() for w in word_list}
    imported = 0
    skipped_no_english = 0
    for entry in sorted(cefr.values(), key=lambda e: (LEVELS_ORDER.index(e["level"]), e["word"])):
        if entry["word"].lower() in known:
            continue
        # Prefixes and bare fragments are not words a card can teach.
        if entry["word"].endswith("-") or entry["word"].startswith("-"):
            continue
        if not entry.get("translation"):
            # A card with no meaning teaches nothing; it is dropped and counted,
            # never filled in by guesswork.
            skipped_no_english += 1
            continue
        known.add(entry["word"].lower())
        imported += 1
        word_list.append({
            "id": "",
            "language": "de",
            "level": entry["level"],
            "cefr": entry["level"],
            "cefrApprox": entry["level"],
            "cefrSource": ", ".join(entry["sources"]),
            "source": CEFR_SOURCE,
            "sourcePage": 0,
            "regionalVariant": "",
            "pluralForm": expand_plural(entry.get("plural", ""), entry["word"]),
            "verbForms": {},
            "word": entry["word"],
            "term": entry["word"],
            "variants": "",
            "translation": entry["translation"],
            "translationSource": entry.get("translationSource", ""),
            "type": word_type_of(entry),
            "article": entry.get("article", ""),
            "plural": False,
            "example": entry.get("example", ""),
            "exampleTranslation": "",
            "note": entry.get("preposition", "") and
                    f"Takes the preposition {entry['preposition']}.",
            "needsReview": False,
            "categories": [level_placement(entry["level"])],
        })

    for i, word in enumerate(word_list, 1):
        word["id"] = f"w{i:04d}"

    # Give every card its level placement, so browsing by level covers the whole
    # vocabulary rather than only the imported half.
    for word in word_list:
        if not word.get("cefr"):
            continue
        if any(c["category"] == "levels" for c in word["categories"]):
            continue
        word["categories"].append(level_placement(word["cefr"]))

    frequency, frequency_meta = frequency_index()
    ranked = 0
    heads = Counter(w["word"].lower() for w in word_list)
    for word in word_list:
        entry = frequency.get(word["word"].lower())
        word["frequencyRank"] = entry["rank"] if entry else 0
        word["frequencyCount"] = entry["count"] if entry else 0
        # The corpus is case-folded and counts one string. Where two cards share
        # a printed form — morgen/Morgen, wagen/Wagen — the count covers both,
        # so the card says the rank is shared rather than claiming it outright.
        word["frequencyShared"] = bool(entry) and heads[word["word"].lower()] > 1
        if entry:
            ranked += 1

    categories = []
    for cat_id, emoji, name in CATEGORIES:
        subs = []
        if cat_id == "levels":
            for level in LEVELS_ORDER:
                if any(w.get("cefr") == level for w in word_list):
                    subs.append({"id": level.lower(), "name": f"{level} vocabulary",
                                 "documentName": level, "emoji": LEVEL_EMOJI[level]})
        else:
            for doc_sub, (c, s, label, sub_emoji) in SUBTOPICS.items():
                if c != cat_id:
                    continue
                subs.append({"id": s, "name": label, "documentName": doc_sub, "emoji": sub_emoji})
        categories.append({"id": cat_id, "name": name, "emoji": emoji, "subcategories": subs})

    db = {
        "meta": {
            "language": "de",
            "source": SOURCE_TITLE,
            "sourceNote": SOURCE_NOTE,
            "level": "GCSE",
            "cefrNote": CEFR_NOTE,
            "wordCount": len(word_list),
            "sourceEntryCount": sum(len(v) for v in groups.values()),
            "frequency": {
                "source": frequency_meta.get("source", ""),
                "note": frequency_meta.get("note", ""),
                "formCount": frequency_meta.get("formCount", 0),
                "rankedWords": ranked,
            } if frequency_meta else None,
            "cefr": {
                "sources": [source["title"] for source in cefr_meta.get("sources", [])],
                "note": cefr_meta.get("note", ""),
                "levelCounts": {level: sum(1 for w in word_list if w.get("cefr") == level)
                                for level in LEVELS_ORDER},
                "levelledWords": levelled + imported,
                "approximatedWords": sum(1 for w in word_list
                                         if w.get("cefrSource") == "tier-approximation"),
                "importedWords": imported,
            } if cefr_meta else None,
        },
        "wordTypes": [{"id": i, "name": n, "emoji": e} for i, n, e in WORD_TYPES],
        "categories": categories,
        "words": word_list,
    }

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"source entries : {db['meta']['sourceEntryCount']}")
    print(f"words written  : {len(word_list)}  -> {DATA_OUT}")
    print(f"needs review   : {sum(1 for w in word_list if w['needsReview'])}")
    if cefr_meta:
        print(f"cefr levels    : {levelled} of the {len(order)} GCSE cards levelled from a word list, "
              f"{sum(1 for w in word_list if w.get('cefrSource') == 'tier-approximation')} left on the "
              f"tier approximation")
        print(f"cefr imports   : {imported} new cards from the word lists, "
              f"{skipped_no_english} skipped for having no English")
        counts = {lv: sum(1 for w in word_list if w.get("cefr") == lv) for lv in LEVELS_ORDER}
        print("                 " + " · ".join(f"{k} {v}" for k, v in counts.items()))
    if frequency_meta:
        unmatched = sum(1 for form in frequency
                        if form not in {w["word"].lower() for w in word_list})
        print(f"frequency rank : {ranked} of {len(word_list)} words matched a listed form; "
              f"{unmatched} of {len(frequency)} listed forms are not vocabulary headwords")
    else:
        print("frequency rank : skipped — data/frequency.json not built")
    if problems:
        print(f"\n{len(problems)} warning(s):")
        for p in problems[:60]:
            print("  -", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
