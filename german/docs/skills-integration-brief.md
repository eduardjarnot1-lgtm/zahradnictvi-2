# Integration brief — learning-science features and tooling

> **Provenance.** This brief was meant to come from ChatGPT. This environment's
> egress policy blocks `chatgpt.com` and `api.openai.com` (403 at the proxy) and
> the session holds no OpenAI key, so it could not be fetched. It was written
> here instead, against the actual constraints of this codebase, and then
> executed. Nothing below is a quote from another model.

## The constraint that decides everything

The app is a **static site**: vanilla ES modules, no build step, no bundler, no
server, no runtime network access, deployed as plain files and also shipped as a
single self-contained HTML file. Any proposal that needs npm, a Python backend,
model weights, or an API round-trip is not integrable *as such* — it must either
be reimplemented in browser JavaScript or replaced by the browser-native
equivalent. The table below states, for each item in the research note, which
route was taken and why.

| Research note proposes | Route taken here | Why |
|---|---|---|
| **FSRS** scheduler, via `ts-fsrs` (npm) | **Implement FSRS-5 directly in `src/srs.js`**, default parameter vector, no dependency | `ts-fsrs` is a TypeScript npm package; there is no build step to consume it. The algorithm is published and short — reimplementing is more honest than pretending to vendor it. |
| **py-fsrs** (Python backend) | not applicable | There is no backend. |
| **Piper TTS** / **CrispTTS** (local neural TTS) | **Web Speech API `speechSynthesis`**, German voice | Piper needs ~60 MB of model weights and a local process. `speechSynthesis` ships in the browser, costs nothing, works offline once a German voice is installed, and needs zero bytes of payload. |
| **OpenAI Whisper** (pronunciation scoring) | **Web Speech API `SpeechRecognition`** (`de-DE`), scored with the app's existing lenient matcher | Whisper in the browser means ~40 MB of WASM and a build pipeline. `SpeechRecognition` gives a `de-DE` transcript natively in Chromium browsers. It is **not** available everywhere, so the feature must detect and hide itself, never break the page. |
| **`de_top2000_frequency.txt`** | **Imported.** Real pipeline, real data, ranks stamped onto vocabulary cards | The one data file actually supplied. |
| **`deu-eng.zip`** (Tatoeba sentence pairs) | **not integrated** | Described as "downloaded to your Downloads folder" but not supplied to this session. Not invented. |
| **FreeDict `deu-eng` StarDict** | **not integrated** | Same — not supplied. |
| Gamification (streaks, XP) | already present | `db.js` profile carries `xp`, `streakDays`, `lastActiveDay`. |
| Contextual / sentence-based learning | already present | Every card carries its source example sentence; one exercise type blanks the headword out of its own example. |
| Production practice over recognition | already present, now extended | Typed production already exists; dictation and speaking add two more production modes. |
| CEFR progression | already present | A1–C1 grammar carrying the documents' own level labels. |

## Work items

### 1. Frequency data → teaching priority

- `tools/build_frequency.py <file>` reads the raw list and emits `data/frequency.json`:
  `{ meta: {source, corpus, note, formCount}, forms: [{form, rank, count}] }`.
- `tools/build_vocabulary.py` stamps `frequencyRank` and `frequencyCount` onto
  each card whose **exact printed headword** matches a listed form.
- Matching is surface-form only, case-insensitively. The corpus is a *word-form*
  list, not a lemma list, so `ist` and `sind` do not resolve to `sein`. Cards
  that do not match carry no rank; the coverage number is reported honestly
  rather than inflated by guessing at lemmas.
- The corpus is subtitle-derived and therefore skews spoken/colloquial. Say so
  wherever a rank is displayed.
- `lessons.js` orders *new* words by rank, so frequent words are taught first.
- A **Core words** screen lists ranked cards in frequency order with status.
- The About page reports coverage in both directions: ranked cards, and listed
  forms absent from the vocabulary.

### 2. FSRS-5 replaces the SM-2 scheduler

- Implement in `src/srs.js` with the published FSRS-5 default weights.
  State per card becomes `stability` (days) and `difficulty` (1–10), with
  retrievability derived from elapsed time rather than stored.
- Grade mapping from what the app already knows about an answer:
  | Answer | Grade |
  |---|---|
  | wrong | 1 — Again |
  | "almost" (near miss by edit distance) | 2 — Hard |
  | correct | 3 — Good |
  | correct, typed German production, no hint shown | 4 — Easy |
- Same-day repeats use the FSRS-5 short-term stability path, not the long-term one.
- Existing records carry an SM-2 `difficulty` of 1.3–3.2 and a `repetitionCount`.
  Migrate them in place, do not discard: map the old difficulty onto the 1–10
  scale and seed `stability` from the interval the old scheduler had arrived at.
- `priority()` keeps its current contract so `lessons.js` is untouched, but is
  re-expressed in terms of retrievability.

### 3. Audio: hear German

- `src/audio.js` wraps `speechSynthesis`: voice selection preferring `de-DE`,
  a `speak()` that cancels anything in flight, and a capability flag.
- Speaker buttons on vocabulary cards (headword and example sentence), in
  exercise feedback, and on grammar examples.
- New exercise type **dictation**: hear the word, type what you heard. Offered
  only when a German voice is actually present.

### 4. Audio: speak German

- `src/audio.js` also wraps `SpeechRecognition` / `webkitSpeechRecognition`
  at `lang = 'de-DE'`.
- New exercise type **pronunciation**: the German is shown, the learner records,
  the transcript is scored with the existing `checkAnswer()` matcher.
- Must degrade silently: where the API is missing or the microphone is refused,
  the type is never generated and the UI never mentions it.

### 5. Non-negotiables carried over from the existing pipeline

- No invented vocabulary, examples, or translations.
- Every build script fails loudly rather than dropping content silently.
- `validate_content.py` covers the new fields.
- The single-file bundle keeps working: no aliased imports, no name collisions
  across modules, no new network dependency.
