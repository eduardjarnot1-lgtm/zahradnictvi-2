/**
 * Exercise generation.
 *
 * Turns one vocabulary item or one grammar topic into a question the app can
 * ask. Everything here is derived from data that is actually in the databases:
 * an exercise type whose data is missing is reported as unavailable rather
 * than invented, which is what `availability()` is for.
 *
 * Answer checking is deliberately forgiving: case, punctuation, ß/ss and
 * surrounding whitespace are ignored, several answers may be accepted, and a
 * near miss is reported as "close" instead of simply wrong.
 */

import { getAllWords, displayForm, wordsOfType } from './data.js';
import { canSpeak, canListen } from './audio.js';

export const VOCAB_TYPES = {
  DE_EN: 'de-en',
  EN_DE: 'en-de',
  CHOICE: 'choice',
  ARTICLE: 'article',
  PLURAL: 'plural',
  SENTENCE: 'sentence',
  CONTEXT: 'context',
  RECOGNISE: 'recognise',
  VERB_FORM: 'verb-form',
  DICTATION: 'dictation',
  PRONOUNCE: 'pronounce',
};

export const ARTICLES = ['der', 'die', 'das'];
const BLANK = '_____';

// --- answer checking --------------------------------------------------------

const fold = (text) =>
  String(text)
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .replace(/[.,!?;:„“"'`()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Levenshtein distance, capped — used only to tell "close" from "wrong". */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Check a typed answer against the accepted ones.
 * Returns { correct, close, matched } — `close` means it was nearly right,
 * which the app reports as a near miss rather than a plain failure.
 */
export function checkAnswer(given, answers) {
  const candidate = fold(given);
  if (!candidate) return { correct: false, close: false, matched: '' };
  for (const answer of answers) {
    if (candidate === fold(answer)) return { correct: true, close: false, matched: answer };
  }
  // An answer that contains the whole expected answer (the learner wrote a
  // fuller sentence) counts as correct.
  for (const answer of answers) {
    const expected = fold(answer);
    if (expected.length > 8 && candidate.includes(expected)) {
      return { correct: true, close: false, matched: answer };
    }
  }
  for (const answer of answers) {
    const expected = fold(answer);
    const allowed = expected.length > 12 ? 3 : expected.length > 6 ? 2 : 1;
    if (distance(candidate, expected) <= allowed) {
      return { correct: false, close: true, matched: answer };
    }
  }
  return { correct: false, close: false, matched: answers[0] || '' };
}

// --- helpers ----------------------------------------------------------------

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const pick = (items) => items[Math.floor(Math.random() * items.length)];

/**
 * Plausible wrong answers: same word type, and where possible the same
 * sub-topic, so the choice is a real decision rather than a giveaway.
 */
function distractors(word, count, field) {
  const placement = word.categories[0];
  const sameArea = placement
    ? wordsOfType(placement.category, placement.subcategory, word.type)
    : [];
  const pool = sameArea.length > count * 3 ? sameArea : getAllWords().filter((w) => w.type === word.type);
  const seen = new Set([field(word)]);
  const out = [];
  for (const candidate of shuffle(pool)) {
    const value = field(candidate);
    if (seen.has(value) || candidate.id === word.id) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= count) break;
  }
  return out;
}

/** Blank out a word inside its own example sentence. */
function blankOut(sentence, headword) {
  const stem = headword.length > 5 ? headword.slice(0, Math.ceil(headword.length * 0.7)) : headword;
  const pattern = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'i');
  return pattern.test(sentence) ? sentence.replace(pattern, BLANK) : '';
}

// --- vocabulary exercises ---------------------------------------------------

/** Which exercise types this word can actually support. */
export function availability(word) {
  const gapped = blankOut(word.example, word.word);
  return {
    [VOCAB_TYPES.DE_EN]: true,
    [VOCAB_TYPES.EN_DE]: true,
    [VOCAB_TYPES.CHOICE]: true,
    [VOCAB_TYPES.RECOGNISE]: true,
    [VOCAB_TYPES.ARTICLE]: Boolean(word.article) && !word.plural,
    // The word lists print a German example but no English one, so this type
    // needs both before it can ask the learner to translate a sentence.
    [VOCAB_TYPES.SENTENCE]: Boolean(word.example) && Boolean(word.exampleTranslation),
    [VOCAB_TYPES.CONTEXT]: Boolean(gapped),
    // The OCR source list prints neither plural forms nor verb tables, so
    // these two stay switched off until a source that carries them is imported.
    [VOCAB_TYPES.PLURAL]: Boolean(word.pluralForm),
    [VOCAB_TYPES.VERB_FORM]: Boolean(word.verbForms && Object.keys(word.verbForms).length),
    // Audio types exist only where the browser can actually do the job. A
    // browser that cannot speak must never be asked a listening question, and
    // one that cannot listen must never be asked to pronounce.
    [VOCAB_TYPES.DICTATION]: canSpeak(),
    [VOCAB_TYPES.PRONOUNCE]: canListen(),
  };
}

export function buildVocabExercise(word, type) {
  const can = availability(word);
  const kind = can[type] ? type : VOCAB_TYPES.DE_EN;
  const base = { itemKind: 'vocab', itemId: word.id, word, type: kind, explain: '' };

  switch (kind) {
    case VOCAB_TYPES.ARTICLE:
      return {
        ...base,
        mode: 'options',
        prompt: 'What is the correct article?',
        text: `${BLANK} ${word.word}`,
        options: ARTICLES,
        answers: [word.article],
        explain: `${displayForm(word)} — ${word.translation}`,
      };

    case VOCAB_TYPES.EN_DE: {
      const options = shuffle([word.word, ...distractors(word, 3, (w) => w.word)]);
      return {
        ...base,
        mode: 'options',
        prompt: 'Which German word means this?',
        text: word.translation,
        options,
        answers: [word.word],
        explain: `${displayForm(word)} — ${word.translation}`,
      };
    }

    case VOCAB_TYPES.CHOICE:
    case VOCAB_TYPES.RECOGNISE: {
      const options = shuffle([word.translation, ...distractors(word, 3, (w) => w.translation)]);
      return {
        ...base,
        mode: 'options',
        prompt: 'What does this word mean?',
        text: displayForm(word),
        options,
        answers: [word.translation],
        explain: `${displayForm(word)} — ${word.translation}`,
      };
    }

    case VOCAB_TYPES.CONTEXT:
      return {
        ...base,
        mode: 'typing',
        producesGerman: true,
        prompt: 'Which word is missing?',
        text: blankOut(word.example, word.word),
        answers: [word.word, displayForm(word)],
        hint: word.translation,
        explain: `${word.example} — ${word.exampleTranslation}`,
      };

    case VOCAB_TYPES.DICTATION:
      return {
        ...base,
        mode: 'typing',
        speak: word.word,
        producesGerman: true,
        prompt: 'Listen, then write what you hear.',
        text: '',
        answers: [word.word, displayForm(word)],
        hint: '',
        explain: `${displayForm(word)} — ${word.translation}`,
      };

    case VOCAB_TYPES.PRONOUNCE:
      return {
        ...base,
        mode: 'speech',
        speak: word.word,
        producesGerman: true,
        prompt: 'Say this in German.',
        text: displayForm(word),
        answers: [word.word, displayForm(word)],
        explain: `${displayForm(word)} — ${word.translation}`,
      };

    case VOCAB_TYPES.SENTENCE:
      return {
        ...base,
        mode: 'reveal',
        prompt: 'Read the sentence, then check yourself.',
        text: word.example,
        answers: [word.exampleTranslation],
        explain: `${displayForm(word)} — ${word.translation}`,
      };

    case VOCAB_TYPES.DE_EN:
    default:
      return {
        ...base,
        type: VOCAB_TYPES.DE_EN,
        mode: 'reveal',
        prompt: 'What does this word mean?',
        text: displayForm(word),
        answers: [word.translation],
        explain: word.example ? `${word.example} — ${word.exampleTranslation}` : '',
      };
  }
}

/** Choose a sensible exercise type for a word given how well it is known. */
export function chooseVocabType(word, record) {
  const can = availability(word);
  const options = [];
  if (!record.seen) {
    options.push(VOCAB_TYPES.DE_EN, VOCAB_TYPES.SENTENCE);
  } else {
    options.push(VOCAB_TYPES.CHOICE, VOCAB_TYPES.DE_EN);
    if (can[VOCAB_TYPES.EN_DE]) options.push(VOCAB_TYPES.EN_DE);
    if (can[VOCAB_TYPES.CONTEXT] && record.correctCount > 0) options.push(VOCAB_TYPES.CONTEXT);
  }
  if (can[VOCAB_TYPES.ARTICLE]) options.push(VOCAB_TYPES.ARTICLE, VOCAB_TYPES.ARTICLE);
  // Audio work is for words already met once: hearing a word you have never
  // seen written is a spelling test, not a memory test.
  if (record.seen && record.correctCount > 0) {
    if (can[VOCAB_TYPES.DICTATION]) options.push(VOCAB_TYPES.DICTATION);
    if (can[VOCAB_TYPES.PRONOUNCE]) options.push(VOCAB_TYPES.PRONOUNCE);
  }
  return pick(options.filter((type) => can[type])) || VOCAB_TYPES.DE_EN;
}

// --- grammar exercises ------------------------------------------------------

export function buildGrammarExercise(topic, exercise) {
  const base = {
    itemKind: 'grammar',
    itemId: topic.id,
    exerciseId: exercise.id,
    topic,
    type: exercise.type,
    prompt: exercise.prompt,
    answers: exercise.answers,
    hint: exercise.hint,
    explain: exercise.explain,
    fromSource: exercise.fromSource,
  };

  if (exercise.type === 'choice' || (exercise.type === 'context' && exercise.options.length)) {
    return { ...base, mode: 'options', text: exercise.text, options: shuffle(exercise.options) };
  }
  if (exercise.type === 'reorder') {
    return { ...base, mode: 'reorder', text: '', tokens: shuffle(exercise.tokens) };
  }
  if (exercise.type === 'transform') {
    return { ...base, mode: 'typing', text: exercise.from || exercise.text };
  }
  return { ...base, mode: 'typing', text: exercise.text };
}

export function grammarExercisesFor(topic, count) {
  return shuffle(topic.exercises).slice(0, count).map((exercise) => buildGrammarExercise(topic, exercise));
}
