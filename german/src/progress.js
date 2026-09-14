/**
 * Vocabulary learning status.
 *
 * This is the façade the browsing screens use. It keeps the small API the
 * cards and lists were written against, but the records themselves now live in
 * db.js alongside the spaced-repetition fields, so a word marked by hand on a
 * card and a word answered in a lesson end up in the same record.
 */

import {
  initDb, vocabProgress, putVocabProgress, onChange, all, clearAll, logEvent, recordActivity,
} from './db.js';
import { review, isDue, seedLearned, GRADE, DAY } from './srs.js';

export const STATUS = {
  NEW: 'new',
  LEARNING: 'learning',
  LEARNED: 'learned',
};

export const STATUS_LABEL = {
  [STATUS.NEW]: 'Not learned',
  [STATUS.LEARNING]: 'Learning',
  [STATUS.LEARNED]: 'Learned',
};

const statusListeners = new Set();
let migratedCount = 0;

export function initProgress() {
  const result = initDb();
  migratedCount = result.migrated;
  onChange((collection) => {
    if (collection !== 'vocabProgress') return;
    for (const listener of statusListeners) listener(null, null);
  });
  return result;
}

export const migratedFromLegacy = () => migratedCount;

export function onProgressChange(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export const getStatus = (wordId) => vocabProgress(wordId).status;
export const getRecord = (wordId) => vocabProgress(wordId);

/**
 * Set a status by hand, from a card button.
 * Marking "learned" schedules a real review rather than retiring the word;
 * marking "practise" brings it back soon.
 */
export function setStatus(wordId, status) {
  const record = vocabProgress(wordId);
  const now = Date.now();
  const next = { ...record, status, seen: status !== STATUS.NEW, lastSeen: now };

  if (status === STATUS.LEARNED) {
    putVocabProgress(seedLearned(record, now));
    for (const listener of statusListeners) listener(wordId, status);
    return vocabProgress(wordId);
  }
  if (status === STATUS.LEARNING) {
    next.repetitionCount = 0;
    next.nextReview = now + 10 * 60000;
  } else {
    next.repetitionCount = 0;
    next.nextReview = 0;
    next.seen = false;
  }

  putVocabProgress(next);
  for (const listener of statusListeners) listener(wordId, status);
  return next;
}

/** Pressing the button of the status a word already has clears it back to 'new'. */
export function toggleStatus(wordId, status) {
  const next = getStatus(wordId) === status ? STATUS.NEW : status;
  setStatus(wordId, next);
  return next;
}

/**
 * Record the outcome of an answer — the spaced-repetition path.
 *
 * `grade` is the FSRS grade the runner derived from the answer itself. It is
 * optional so that a caller with nothing but a boolean still works: a plain
 * right answer is Good and a wrong one is Again.
 */
export function recordAnswer(wordId, correct, { given = '', expected = '', grade = 0 } = {}) {
  const record = vocabProgress(wordId);
  const next = review(record, grade || (correct ? GRADE.GOOD : GRADE.AGAIN));
  putVocabProgress(next);
  logEvent({ kind: 'answer', itemKind: 'vocab', itemId: wordId, correct, given, expected });
  recordActivity(correct ? 10 : 2);
  for (const listener of statusListeners) listener(wordId, next.status);
  return next;
}

/** { total, learned, learning, new, due } for a list of words. */
export function summarise(words, now = Date.now()) {
  const stats = { total: words.length, learned: 0, learning: 0, new: 0, due: 0 };
  for (const word of words) {
    const record = vocabProgress(word.id);
    stats[record.status] += 1;
    if (isDue(record, now)) stats.due += 1;
  }
  return stats;
}

export const countDue = (now = Date.now()) =>
  all('vocabProgress').filter((record) => isDue(record, now)).length;

export function resetAllProgress() {
  clearAll();
  for (const listener of statusListeners) listener(null, null);
}
