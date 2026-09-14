# Master Fuka — German Learning (beta)

A learning app built on three imported source documents. It is not a PDF reader:
the documents are extracted, normalised, validated and turned into vocabulary
cards, grammar units, exercises, spaced review and progress tracking.

Open `german/index.html` through a web server (ES modules and `fetch` do not
work over `file://`):

```bash
python3 -m http.server 8000     # from the repository root
# then open http://localhost:8000/german/
```

On Netlify the site publishes the repository root, so the app is served at
`/german/`.

## Sources

| Content | Source | Status |
|---|---|---|
| Vocabulary — 2 047 items | OCR GCSE German Vocabulary List (General and Topic Areas 1–5) | imported |
| Grammar — 87 A1/A2/B1 topics | DaF kompakt neu A1/A2/B1, Grammatikerklärungen, © Ernst Klett Sprachen GmbH, Stuttgart 2018 | imported |
| Grammar — 32 C1 topics | Sicher! C1 Grammatikübersicht, © Hueber Verlag | imported |
| Goethe-Zertifikat B1 Wortliste | **not supplied** — see below | **missing** |

### The Goethe B1 Wortliste is not in the repository

That task named two PDFs. Only one arrived: `Sicher_C1_Grammatikuebersicht.pdf`
(the DaF kompakt grammar PDF came later, with a separate request). In place of
the Goethe B1 Wortliste there was a text file containing a fliphtml5 link, and
that host is blocked by this environment's network egress policy, so the list
could not be fetched.

Roughly 2 400 B1 lexical units are therefore **not** in the app. No substitute
was invented: the existing OCR GCSE vocabulary is carried under its own real
name, and the level picker states plainly that B1 holds no Goethe content.

Everything needed to ingest it is already built. When the PDF is available:

```bash
python3 german/tools/extract_goethe_b1.py <Goethe-Zertifikat_B1_Wortliste.pdf>
```

That script is a stub that documents the target record shape (article, plural,
gender, verb forms, regional D/A/CH labels, cross-references, thematic
category, source page) and exits with a clear message. Fill in its parser, then
the existing `build_vocabulary.py` → `validate_content.py` chain and the whole
learning engine pick the new items up unchanged.

## What the app does

* **German Learning hub** — the coach, the four sections, the target level.
* **Vocabulary** — the document's own topics → sub-topics → word type → cards
  with article, meaning, example sentence and English translation.
* **Grammar** — 119 topics from A1 to C1, grouped by level and then by the
  source's own section (DaF kompakt's Roman-numbered chapters, Sicher!'s
  Lektionen), each with an English summary, the rules, the source's own
  examples, and 4–7 exercises.
* **Lessons** — a personalised mix of new words, weak words, overdue reviews
  and one grammar exercise, composed from your own records.
* **Review** — everything the spaced-repetition schedule says is due.
* **Progress** — per topic, per grammar unit, streak, XP, weak words, recent
  mistakes, recent sessions.
* **Search** — German, English and grammar topics in one box.
* **Learning Coach** — recommendations computed from the database.

### Exercise types

Vocabulary: German→English, English→German, multiple choice, article
(`der/die/das`), sentence context (the word blanked out of its own example),
sentence reading, word recognition.
Grammar: fill in the blank, multiple choice, transformation, sentence
reconstruction, error correction, context selection.

Two types are deliberately **switched off**: plural forms and verb tables. The
OCR list prints neither, so `exercises.js#availability()` reports them as
unavailable rather than generating questions from data that does not exist.
They turn themselves on for any word that arrives with `pluralForm` or
`verbForms` populated — which the Goethe list would supply.

Typed answers are checked leniently: case, punctuation, ß/ss and whitespace are
ignored, several answers can be accepted, and a near miss is reported as
"almost" rather than wrong.

## Data integrity

`build_grammar.py` refuses to build unless **every example sentence occurs
verbatim in the source text of its own topic** (whitespace-normalised, footnote
markers removed). Exercises that use a source sentence are checked the same
way; anything written for practice is marked `fromSource: false`. The same rule
caught two mistakes while this was being written — a phrase that was not in the
document and a sentence with a footnote marker — which is exactly what it is
for.

`validate_content.py` runs 35 000+ checks over both databases: duplicate ids,
duplicate entries, near-duplicate variants, missing German words, malformed
articles and plurals, invalid levels, missing source attribution, malformed
grammar topics, unknown or circular prerequisites.

```bash
python3 german/tools/validate_content.py
# vocabulary: 2047 words checked
# grammar: 119 topics, 602 exercises checked
# PASSED — 0 errors, 1 warning
```

The one warning is genuine and left standing: the OCR list prints *einwerfen —
to post* in the Foundation tier and *einwerfen — to post (a letter)* in the
Higher tier, so both are kept and flagged for a human.

### Levels

The app has A1–C2 as structure. It does **not** claim to hold an A1–C2
curriculum.

A1, A2, B1 and C1 hold grammar, and those labels are the documents' own: DaF
kompakt prints `(A1)`, `(A2)` or `(B1)` beside every block, and the extractor
reads the level off the heading rather than guessing it. B2 and C2 are empty
and say so.

The vocabulary is labelled `GCSE`, because that is what the document is, with
an *approximate* CEFR mapping of its Foundation/Higher tiers (`cefrApprox`)
that is labelled as approximate everywhere it appears.

## The pipeline

```
Sicher_C1_...pdf     DaF_kompakt_neu_...pdf      OCR GCSE vocabulary PDF
  │ extract_c1_         │ extract_daf_             │ tools/extract_pdf.py
  │   grammar.py        │   grammar.py             ▼
  ▼                     ▼                        tools/source-entries.json
tools/c1-source.json  tools/daf-source.json        2060 entries
  32 topics             87 topics                   │ tools/annotations/*.tsv
  + raw source text     + raw source text           │   type, article, example,
  │                     │                           │   translation, note
  │ tools/annotations/grammar/*.json                │
  │   summary, rules, examples, exercises           │
  ▼ tools/build_grammar.py                          ▼ tools/build_vocabulary.py
data/grammar.json                                 data/vocabulary.json
        └──────────────────────┬─────────────────────────┘
                               ▼  tools/validate_content.py
                          the learning engine
```

`build_grammar.py` is source-agnostic: each document is one entry in its
`SOURCES` table, saying where its level comes from (Sicher! is C1 throughout;
DaF kompakt prints a level per block) and how its topics are grouped for
display. Adding a fourth document means writing an extractor and one table
entry, not touching the app.

Rebuild everything:

```bash
python3 german/tools/extract_c1_grammar.py <Sicher_C1_Grammatikuebersicht.pdf>
python3 german/tools/extract_daf_grammar.py <DaF_kompakt_neu_A1_A2_B1_Grammar_English.pdf>
python3 german/tools/build_grammar.py
python3 german/tools/build_vocabulary.py
python3 german/tools/validate_content.py
python3 german/tools/build_artifact.py          # single-file bundle
```

Both builds fail loudly rather than silently dropping content: the vocabulary
build fails if an annotation row count or German term diverges from the source;
the grammar build fails on an ungrounded example, a missing answer, a choice
whose answer is not among its options, or an unannotated topic.

Source PDFs are not committed — only the extracted structured data, so the
imported text stays limited to what the app needs and is traceable to a page
number.

## Code layout

```
german/
  index.html            shell: top bar, search, main region
  styles.css            light + dark theme, no framework
  data/vocabulary.json  2047 items
  data/grammar.json     119 topics, 599 examples, 602 exercises
  src/
    data.js         vocabulary loading + indexing
    grammar.js      grammar loading + indexing (by level, group, category)
    db.js           the learner database: profile, progress, sessions, events
    srs.js          spaced repetition (SM-2 style) — pure functions
    progress.js     vocabulary status façade over db.js
    exercises.js    exercise generation + lenient answer checking
    lessons.js      the personalised lesson engine
    coach.js        the Learning Coach — reads records, invents nothing
    runner.js       one state machine for every activity
    search.js       German/English search
    fuka.js         Master Fuka's lines
    ui.js           rings, circles, cards, breadcrumbs
    views.js        vocabulary screens
    learnViews.js   hub, progress, grammar screens
    app.js          hash router + event wiring
  tools/            the pipeline above
```

### The database

There is no server and no account system, so the store is `localStorage` — but
the *schema* is the real one, keyed by user id, so the adapter can be swapped
for a server without touching a call site:

| Collection | Fields |
|---|---|
| `profile` | userId, displayName, targetLevel, createdAt, streakDays, lastActiveDay, xp |
| `vocabProgress` | userId, vocabularyItemId, status, seen, correctCount, incorrectCount, repetitionCount, lastSeen, nextReview, difficulty |
| `grammarProgress` | userId, grammarTopicId, completion, correctCount, incorrectCount, masteryScore, lastPracticed, nextReview |
| `sessions` | id, userId, startedAt, finishedAt, kind, items, correct, total |
| `events` | id, userId, at, kind, itemId, itemKind, correct, given, expected |

Progress saved by the previous version of the app is migrated on first load,
non-destructively, and given a real place in the review schedule.

### The Learning Coach

Deterministic and data-driven. The app is a static page with no server, so
there is no language model at runtime; the coach computes every statement from
the records above and names the numbers behind it ("you have answered 3 of 8
questions on this topic correctly"). It never asserts progress the database
does not show, and when there is nothing recorded it says so.

## Single-file build

`python3 german/tools/build_artifact.py` inlines the CSS, the modules, both
databases and Master Fuka's picture into `dist/master-fuka-german.html` — one
file that runs with no server and no network. Edit the sources, never the
bundle. The modules are flattened into one scope, so the bundler rejects
aliased imports (`x as y`) that cannot survive flattening.
