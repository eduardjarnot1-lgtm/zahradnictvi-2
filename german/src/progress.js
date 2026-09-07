/**
 * Learning status + progress tracking.
 *
 * Statuses: 'new' (not learned) -> 'learning' -> 'learned'.
 * Persisted per browser in localStorage. The store is deliberately a thin
 * key/value map so a later version can sync it to an account without changing
 * the call sites.
 */

const STORAGE_KEY = 'fuka-german-progress-v1';

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

let state = {};
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode or storage full — the session still works, it just won't persist */
  }
}

export function initProgress() {
  state = read();
}

export function onProgressChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStatus(wordId) {
  return state[wordId]?.status || STATUS.NEW;
}

export function setStatus(wordId, status) {
  if (status === STATUS.NEW) delete state[wordId];
  else state[wordId] = { status, updatedAt: Date.now() };
  write();
  for (const listener of listeners) listener(wordId, status);
}

/** Pressing the button of the status a word already has clears it back to 'new'. */
export function toggleStatus(wordId, status) {
  const next = getStatus(wordId) === status ? STATUS.NEW : status;
  setStatus(wordId, next);
  return next;
}

/** { total, learned, learning, new } for a list of words. */
export function summarise(words) {
  const stats = { total: words.length, learned: 0, learning: 0, new: 0 };
  for (const word of words) stats[getStatus(word.id)] += 1;
  return stats;
}

export function resetAllProgress() {
  state = {};
  write();
  for (const listener of listeners) listener(null, null);
}
