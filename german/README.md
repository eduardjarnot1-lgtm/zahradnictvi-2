# Master Fuka — German Vocabulary (beta)

A small learning app for the vocabulary in the attached PDF,
**OCR GCSE German Vocabulary List — General and Topic Areas 1 to 5** (52 pages).

Open `german/index.html` through a web server (the app uses ES modules and
`fetch`, so `file://` will not work):

```bash
python3 -m http.server 8000     # from the repository root
# then open http://localhost:8000/german/
```

On Netlify the site publishes the repository root, so the app is served at
`/german/`.

## What it does

* **Topics** – six large circular buttons, one per section of the document
  (General + Topic Areas 1–5), then the document's sub-topics, then word type.
* **Vocabulary cards** – German word with its article, English meaning, word
  type, a German example sentence and its English translation. The meaning is
  hidden until you ask for it, so browsing is also recall practice.
* **Learning status** – every word is *Not learned*, *Learning* or *Learned*.
  Press "I know this ✅" or "Practise 🔄"; press the same button again to clear.
* **Practice** – a ten-question round from the whole list, one topic, one
  sub-topic or one word type. Words marked "practise" come first, then unseen
  words, then revision. Nouns are asked as an article question
  (`_____ Tisch` → der / die / das); everything else reveals the card and you
  say whether you knew it.
* **Progress** – per category, per sub-topic, per word type and overall,
  calculated from the actual data. Nothing is invented.
* **Search** – German or English, over the imported words only.
* **Master Fuka** – short guidance and encouragement, kept out of the way.

Progress lives in this browser's `localStorage`. No accounts, no server, no
tracking.

## The data

| | |
|---|---|
| Entries read from the PDF | 2060 |
| Vocabulary cards (after merging repeated entries) | 2047 |
| Nouns (all with an article) | 1202 |
| Articles flagged for review | 11 |

Every word and every category comes from the document. Nothing was added.
What *was* added, as metadata on existing entries: the word type, the noun
article, a German example sentence and its English translation, and a note
where the document's own spelling or the article needs a caveat. The 11
entries whose article cannot be given as a single certain answer (adjectival
nouns such as *Verwandte*, words with two accepted genders such as *Cola*) are
flagged in the app under **Data** and marked on their card, rather than
presented as certain.

### How the data is built

```
dbf540a1-68532vocabularylistbytopic.pdf     (the attached source document)
        │  tools/extract_pdf.py
        ▼
tools/source-entries.json                   German term, English gloss, topic,
        │                                   sub-topic, tier, page — 2060 rows
        │  tools/annotations/*.tsv          one row per source entry, in order:
        │                                   type, article, example, translation, note
        ▼  tools/build_vocabulary.py
data/vocabulary.json                        what the app loads
```

Rebuild after editing an annotation:

```bash
python3 german/tools/build_vocabulary.py
```

The build **fails** if an annotation file has a different number of rows than
the source, or if a row's German term does not match the source term — so no
vocabulary item can be added or lost by accident. It also warns when a noun has
no article or an example sentence looks like it does not use its word.

`tools/extract_pdf.py` regenerates `source-entries.json` from the PDF
(`pip install pypdf`); the PDF itself is not committed.

## Code layout

```
german/
  index.html          shell: top bar, search, main region
  styles.css          light + dark theme, no framework
  data/vocabulary.json
  assets/master-fuka.jpg
  src/
    data.js           loading + indexing (the only module that reads the JSON)
    progress.js       learning status, persistence, summaries
    practice.js       session building and scoring — pure logic, no DOM
    search.js         German/English search
    fuka.js           Master Fuka's lines
    ui.js             progress rings, circles, the vocabulary card
    views.js          screens
    app.js            hash router + event wiring
  tools/              the data pipeline described above
```

The separation is deliberate so the beta can grow: spaced repetition slots into
`practice.js` (it already orders a pool by need), audio and pronunciation onto
the card in `ui.js`, and accounts or cloud sync behind `progress.js` and
`data.js` without touching any screen.

### A note on the GraphQL starter kit

The brief linked `kriasoft/graphql-starter-kit`. It was not used: it is a
full-stack monorepo built around a database, user accounts and a GraphQL API,
all of which the brief explicitly rules out for this beta (no accounts, no
cloud sync, no server). A dependency-free static app loads instantly, deploys
to the existing Netlify site as-is, and keeps `data.js` / `progress.js` as the
seams where a GraphQL backend can be added later without rewriting the UI.

## Single-file build

`python3 german/tools/build_artifact.py` inlines the CSS, the modules, the
vocabulary and Master Fuka's picture into `dist/master-fuka-german.html` — one
file that runs with no server and no network. Edit the sources, never the
bundle.
