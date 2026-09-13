/**
 * Spaced repetition.
 *
 * An SM-2 style scheduler: each item carries a difficulty factor and a
 * repetition count, and every answer moves both. A word answered wrong comes
 * back almost immediately and its difficulty rises, so the selection code in
 * lessons.js puts it in front of the learner more often. A word answered right
 * repeatedly gets an interval that grows, so it is still reviewed but rarely.
 *
 * Pure functions — no storage, no DOM — so the behaviour is easy to reason
 * about and to test.
 */

export const DAY = 86400000;

const MIN_DIFFICULTY = 1.3;
const MAX_DIFFICULTY = 3.2;
const FIRST_INTERVALS = [10 * 60000, DAY, 3 * DAY];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Apply an answer to a progress record.
 * `quality` is 0–5 in SM-2 terms; the app passes 5 for a confident correct
 * answer, 3 for a correct-but-hesitant one and 1 for a wrong answer.
 */
export function review(record, quality, now = Date.now()) {
  const correct = quality >= 3;
  const next = { ...record, seen: true, lastSeen: now };

  next.correctCount = record.correctCount + (correct ? 1 : 0);
  next.incorrectCount = record.incorrectCount + (correct ? 0 : 1);

  // SM-2 difficulty (ease) update, inverted so that a *higher* number means a
  // harder item — that reads more naturally everywhere else in the app.
  const ease = 5 - clamp(record.difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY);
  const nextEase = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  next.difficulty = clamp(5 - clamp(nextEase, 1.3, 2.8), MIN_DIFFICULTY, MAX_DIFFICULTY);

  if (!correct) {
    next.repetitionCount = 0;
    next.nextReview = now + FIRST_INTERVALS[0];
    next.status = 'learning';
    return next;
  }

  next.repetitionCount = record.repetitionCount + 1;
  const step = next.repetitionCount - 1;
  if (step < FIRST_INTERVALS.length) {
    next.nextReview = now + FIRST_INTERVALS[step];
  } else {
    const previous = Math.max(record.nextReview - record.lastSeen, 3 * DAY);
    const factor = clamp(5 - next.difficulty, 1.3, 2.8);
    next.nextReview = now + Math.min(previous * factor, 180 * DAY);
  }

  // Two clean answers in a row is what promotes a word to "learned"; a single
  // lucky guess is not enough.
  next.status = next.repetitionCount >= 2 ? 'learned' : 'learning';
  return next;
}

/** How overdue an item is, in days. Negative means it is not due yet. */
export function overdueDays(record, now = Date.now()) {
  if (!record.nextReview) return record.seen ? 0 : -1;
  return (now - record.nextReview) / DAY;
}

export const isDue = (record, now = Date.now()) =>
  Boolean(record.seen) && record.nextReview > 0 && record.nextReview <= now;

/**
 * Priority for lesson selection — higher comes first.
 * Weak items outrank overdue ones, which outrank freshly introduced ones,
 * which outrank unseen ones, which outrank mastered ones.
 */
export function priority(record, now = Date.now()) {
  const attempts = record.correctCount + record.incorrectCount;
  const accuracy = attempts ? record.correctCount / attempts : 1;

  if (record.status === 'learning' && record.incorrectCount > 0) {
    return 1000 + record.incorrectCount * 10 + (1 - accuracy) * 50;
  }
  if (isDue(record, now)) return 800 + Math.min(overdueDays(record, now), 30);
  if (record.status === 'learning') return 600;
  if (!record.seen) return 400;
  return 100 - Math.min(record.repetitionCount, 20);
}

/** A 0–1 mastery score for a grammar topic, from its answer counts. */
export function masteryScore(correctCount, incorrectCount) {
  const attempts = correctCount + incorrectCount;
  if (!attempts) return 0;
  // Laplace-smoothed accuracy, scaled by how much evidence there is, so three
  // right answers do not read as total mastery.
  const accuracy = (correctCount + 1) / (attempts + 2);
  const confidence = Math.min(attempts / 8, 1);
  return Math.round(accuracy * confidence * 100) / 100;
}

/** Schedule for a grammar topic after a practice round. */
export function reviewTopic(record, correct, total, now = Date.now()) {
  const next = { ...record, lastPracticed: now };
  next.correctCount = record.correctCount + correct;
  next.incorrectCount = record.incorrectCount + (total - correct);
  next.masteryScore = masteryScore(next.correctCount, next.incorrectCount);
  next.completion = Math.min(1, Math.round((next.correctCount / Math.max(total, 1)) * 100) / 100);
  const ratio = total ? correct / total : 0;
  const days = ratio >= 0.8 ? 7 : ratio >= 0.5 ? 3 : 1;
  next.nextReview = now + days * DAY;
  return next;
}
