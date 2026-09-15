/**
 * The learner database.
 *
 * The app ships as a static site with no server and no accounts, so the
 * "database" is a record store in this browser. What matters is that the
 * *schema* is the real one: every collection below holds the fields the
 * learning engine and the coach need, keyed by user id, so the store can be
 * swapped for a server-backed one without touching a single call site.
 *
 * Collections
 * -----------
 * profile              one record: { userId, displayName, targetLevel, createdAt,
 *                                    streakDays, lastActiveDay, xp }
 * vocabProgress        { userId, vocabularyItemId, status, seen, correctCount,
 *                        incorrectCount, repetitionCount, lastSeen, nextReview,
 *                        difficulty, stability }
 *                      difficulty and stability are the FSRS state; records
 *                      written by the older SM-2 scheduler are brought up to
 *                      them on read, non-destructively, by srs.js#ensureFsrs.
 * grammarProgress      { userId, grammarTopicId, completion, correctCount,
 *                        incorrectCount, masteryScore, lastPracticed, nextReview }
 * sessions             { id, userId, startedAt, finishedAt, kind, items,
 *                        correct, total }
 * events               { id, userId, at, kind, itemId, itemKind, correct,
 *                        given, expected }   — the recent-mistake log
 */

import { ensureFsrs } from './srs.js';

const PREFIX = 'fuka-german-db-v1';
const LEGACY_PROGRESS_KEY = 'fuka-german-progress-v1';
const EVENT_LIMIT = 300;
const SESSION_LIMIT = 100;

export const COLLECTIONS = ['profile', 'vocabProgress', 'grammarProgress', 'sessions', 'events'];

const cache = new Map();
const listeners = new Set();
let available = true;

function key(collection) {
  return `${PREFIX}:${collection}`;
}

function read(collection) {
  if (cache.has(collection)) return cache.get(collection);
  let value = {};
  try {
    const raw = localStorage.getItem(key(collection));
    if (raw) value = JSON.parse(raw);
  } catch {
    available = false;
  }
  cache.set(collection, value);
  return value;
}

function write(collection) {
  try {
    localStorage.setItem(key(collection), JSON.stringify(cache.get(collection)));
  } catch {
    // Private mode or a full quota: the session keeps working in memory.
    available = false;
  }
  for (const listener of listeners) listener(collection);
}

export const storageAvailable = () => available;
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- record access ----------------------------------------------------------

export function get(collection, id) {
  return read(collection)[id] || null;
}

export function put(collection, id, record) {
  read(collection)[id] = record;
  write(collection);
  return record;
}

export function update(collection, id, patch) {
  const current = read(collection)[id] || {};
  const next = { ...current, ...patch };
  return put(collection, id, next);
}

export function all(collection) {
  return Object.values(read(collection));
}

export function remove(collection, id) {
  delete read(collection)[id];
  write(collection);
}

export function clearAll() {
  for (const collection of COLLECTIONS) {
    cache.set(collection, {});
    write(collection);
  }
  ensureProfile();
}

// --- profile ----------------------------------------------------------------

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function newUserId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ensureProfile() {
  let profile = get('profile', 'me');
  if (!profile) {
    profile = {
      userId: newUserId(),
      displayName: 'Learner',
      targetLevel: 'B1',
      createdAt: Date.now(),
      streakDays: 0,
      lastActiveDay: '',
      xp: 0,
    };
    put('profile', 'me', profile);
  }
  return profile;
}

export const getProfile = () => ensureProfile();
export const setTargetLevel = (level) =>
  update('profile', 'me', { targetLevel: LEVELS.includes(level) ? level : 'B1' });

const today = () => new Date().toISOString().slice(0, 10);

/** Called when the learner completes activity; keeps the streak honest. */
export function recordActivity(xpGained = 0) {
  const profile = ensureProfile();
  const day = today();
  if (profile.lastActiveDay === day) {
    return update('profile', 'me', { xp: profile.xp + xpGained });
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streakDays = profile.lastActiveDay === yesterday ? profile.streakDays + 1 : 1;
  return update('profile', 'me', { xp: profile.xp + xpGained, lastActiveDay: day, streakDays });
}

// --- progress records -------------------------------------------------------

export function vocabProgress(itemId) {
  const stored = get('vocabProgress', itemId);
  if (stored) return ensureFsrs(stored);
  return {
    userId: ensureProfile().userId,
    vocabularyItemId: itemId,
    status: 'new',
    seen: false,
    correctCount: 0,
    incorrectCount: 0,
    repetitionCount: 0,
    lastSeen: 0,
    nextReview: 0,
    difficulty: 5,
    stability: 0,
  };
}

export const putVocabProgress = (record) =>
  put('vocabProgress', record.vocabularyItemId, record);

export function grammarProgress(topicId) {
  return get('grammarProgress', topicId) || {
    userId: ensureProfile().userId,
    grammarTopicId: topicId,
    completion: 0,
    correctCount: 0,
    incorrectCount: 0,
    masteryScore: 0,
    lastPracticed: 0,
    nextReview: 0,
  };
}

export const putGrammarProgress = (record) =>
  put('grammarProgress', record.grammarTopicId, record);

// --- events and sessions ----------------------------------------------------

function trim(collection, limit) {
  const store = read(collection);
  const ids = Object.keys(store);
  if (ids.length <= limit) return;
  ids.sort((a, b) => (store[a].at || store[a].startedAt || 0) - (store[b].at || store[b].startedAt || 0));
  for (const id of ids.slice(0, ids.length - limit)) delete store[id];
}

export function logEvent(event) {
  const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  put('events', id, { id, userId: ensureProfile().userId, at: Date.now(), ...event });
  trim('events', EVENT_LIMIT);
  write('events');
  return id;
}

export const recentEvents = (limit = 50) =>
  all('events').sort((a, b) => b.at - a.at).slice(0, limit);

export function saveSession(session) {
  const id = session.id || `s${Date.now().toString(36)}`;
  put('sessions', id, { id, userId: ensureProfile().userId, ...session });
  trim('sessions', SESSION_LIMIT);
  write('sessions');
  return id;
}

export const recentSessions = (limit = 20) =>
  all('sessions').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit);

// --- start-up ---------------------------------------------------------------

/**
 * Bring across progress saved by the pre-database version of the app, so an
 * existing learner does not lose what they had already marked.
 */
function migrateLegacyProgress() {
  if (Object.keys(read('vocabProgress')).length > 0) return 0;
  let legacy = null;
  try {
    const raw = localStorage.getItem(LEGACY_PROGRESS_KEY);
    if (raw) legacy = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!legacy) return 0;
  const now = Date.now();
  const DAY = 86400000;
  let migrated = 0;
  for (const [itemId, entry] of Object.entries(legacy)) {
    if (!entry || !entry.status) continue;
    const record = vocabProgress(itemId);
    record.status = entry.status;
    record.seen = true;
    record.lastSeen = entry.updatedAt || now;
    // Give the migrated words a real place in the review schedule, or they
    // would count as learned and then never come round again.
    if (entry.status === 'learned') {
      record.correctCount = 1;
      record.repetitionCount = 2;
      record.nextReview = now + 3 * DAY;
    }
    if (entry.status === 'learning') {
      record.incorrectCount = 1;
      record.nextReview = now + 10 * 60000;
    }
    putVocabProgress(record);
    migrated += 1;
  }
  return migrated;
}

export function initDb() {
  for (const collection of COLLECTIONS) read(collection);
  ensureProfile();
  const migrated = migrateLegacyProgress();
  return { available, migrated };
}
