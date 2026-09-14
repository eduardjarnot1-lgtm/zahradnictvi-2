/**
 * Spaced repetition — FSRS-5.
 *
 * This replaces the SM-2 style scheduler the app shipped with. FSRS models a
 * card with two numbers instead of one ease factor:
 *
 *   stability  S — how many days until recall probability falls to 90 %
 *   difficulty D — 1 (easy) to 10 (hard), how much a review moves stability
 *
 * Retrievability R is not stored: it is computed from how long ago the card was
 * last seen, so a card left alone for a month is correctly treated as shakier
 * than the same card seen yesterday. That is the whole reason for the change —
 * SM-2 multiplies a fixed interval and has no notion of how faded a memory is
 * when you finally come back to it.
 *
 * The published FSRS-5 default parameters are used as-is. They were fitted on a
 * very large review log; a single learner's history here is nowhere near enough
 * data to refit them, so nothing pretends to.
 *
 * Reference: Ye et al., "Optimizing Spaced Repetition Schedule by Capturing
 * Forgetting Dynamics" (the FSRS papers) and the reference implementations at
 * github.com/open-spaced-repetition. Reimplemented here in plain JavaScript
 * because the app has no build step and cannot consume the npm package.
 *
 * Pure functions — no storage, no DOM.
 */

export const DAY = 86400000;

/** FSRS-5 default weights, w[0]..w[18]. */
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;   // = 19/81
const DESIRED_RETENTION = 0.9;

const MIN_STABILITY = 0.01;
const MAX_STABILITY = 36500;
const MAX_INTERVAL = 365 * DAY;

/**
 * Steps for the minutes after a lapse. FSRS schedules the long tail; it does
 * not claim to schedule the next ten minutes, so — exactly as Anki does — the
 * immediate recovery is handled by fixed learning steps while the model keeps
 * updating stability underneath.
 */
const AGAIN_STEP = 10 * 60000;
const HARD_STEP = 60 * 60000;

/** Stability at which a word is called "learned" — the scheduler trusts it a week out. */
const LEARNED_STABILITY = 7;

/** Grades, in FSRS terms. */
export const GRADE = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// --- the model ---------------------------------------------------------------

/** Recall probability after `days` days with this stability. */
export function retrievability(stability, days) {
  if (!(stability > 0) || days <= 0) return 1;
  return Math.pow(1 + FACTOR * (days / stability), DECAY);
}

/** Days until recall probability falls to the desired retention. */
function intervalDays(stability) {
  return (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
}

const initialStability = (grade) => clamp(W[grade - 1], MIN_STABILITY, MAX_STABILITY);
const initialDifficulty = (grade) => clamp(W[4] - Math.exp(W[5] * (grade - 1)) + 1, 1, 10);

function nextDifficulty(difficulty, grade) {
  const delta = -W[6] * (grade - 3);
  const damped = difficulty + delta * ((10 - difficulty) / 9);
  const reverted = W[7] * initialDifficulty(GRADE.EASY) + (1 - W[7]) * damped;
  return clamp(reverted, 1, 10);
}

function stabilityOnRecall(difficulty, stability, recall, grade) {
  const hard = grade === GRADE.HARD ? W[15] : 1;
  const easy = grade === GRADE.EASY ? W[16] : 1;
  const growth = Math.exp(W[8]) * (11 - difficulty) * Math.pow(stability, -W[9])
    * (Math.exp(W[10] * (1 - recall)) - 1) * hard * easy;
  return clamp(stability * (1 + growth), MIN_STABILITY, MAX_STABILITY);
}

function stabilityOnLapse(difficulty, stability, recall) {
  const longTerm = W[11] * Math.pow(difficulty, -W[12])
    * (Math.pow(stability + 1, W[13]) - 1) * Math.exp(W[14] * (1 - recall));
  const shortTerm = stability / Math.exp(W[17] * W[18]);
  return clamp(Math.min(longTerm, shortTerm), MIN_STABILITY, MAX_STABILITY);
}

/** Same-day repeat: the long-term formulas do not apply within a day. */
function shortTermStability(stability, grade) {
  return clamp(stability * Math.exp(W[17] * (grade - 3 + W[18])), MIN_STABILITY, MAX_STABILITY);
}

// --- record handling ---------------------------------------------------------

/**
 * Bring a record written by the old SM-2 scheduler up to the FSRS fields.
 *
 * Non-destructive and idempotent: a record that already has a stability is
 * returned untouched. The old difficulty ran 1.3–3.2 with a higher number
 * meaning harder, which is the same direction as FSRS's 1–10, so it is
 * rescaled rather than thrown away; the old schedule's own interval is used
 * as the starting stability, because that interval is exactly what the
 * previous scheduler had concluded about this card.
 */
export function ensureFsrs(record) {
  if (!record || typeof record.stability === 'number') return record;
  const next = { ...record };
  const oldDifficulty = clamp(Number(record.difficulty) || 2.5, 1.3, 3.2);
  next.difficulty = clamp(1 + ((oldDifficulty - 1.3) / 1.9) * 9, 1, 10);

  const scheduled = (record.nextReview || 0) - (record.lastSeen || 0);
  next.stability = scheduled > 0
    ? clamp(scheduled / DAY, MIN_STABILITY, MAX_STABILITY)
    : (record.seen ? initialStability(GRADE.GOOD) : 0);
  return next;
}

/**
 * Apply an answer.
 *
 * `grade` is 1 Again / 2 Hard / 3 Good / 4 Easy. The app derives it from what
 * it already knows about the answer — wrong, a near miss by edit distance, a
 * plain correct answer, or a correct answer typed in German without a hint.
 */
export function review(record, grade, now = Date.now()) {
  const base = ensureFsrs(record);
  const g = clamp(Math.round(grade), 1, 4);
  const correct = g > GRADE.AGAIN;
  const next = { ...base, seen: true, lastSeen: now };

  next.correctCount = base.correctCount + (correct ? 1 : 0);
  next.incorrectCount = base.incorrectCount + (correct ? 0 : 1);

  const elapsedDays = base.seen && base.lastSeen ? (now - base.lastSeen) / DAY : 0;

  if (!base.seen || !(base.stability > 0)) {
    next.stability = initialStability(g);
    next.difficulty = initialDifficulty(g);
  } else {
    const recall = retrievability(base.stability, elapsedDays);
    next.difficulty = nextDifficulty(base.difficulty, g);
    if (elapsedDays < 1) {
      next.stability = shortTermStability(base.stability, g);
    } else if (correct) {
      next.stability = stabilityOnRecall(base.difficulty, base.stability, recall, g);
    } else {
      next.stability = stabilityOnLapse(base.difficulty, base.stability, recall);
    }
  }

  next.repetitionCount = correct ? base.repetitionCount + 1 : 0;

  if (g === GRADE.AGAIN) {
    next.nextReview = now + AGAIN_STEP;
  } else if (g === GRADE.HARD && next.stability < 1) {
    next.nextReview = now + HARD_STEP;
  } else {
    next.nextReview = now + clamp(intervalDays(next.stability) * DAY, DAY, MAX_INTERVAL);
  }

  // Promotion is the model's own confidence, not a counter: a word is "learned"
  // once the scheduler is willing to leave it alone for a week.
  next.status = correct && next.stability >= LEARNED_STABILITY ? 'learned' : 'learning';
  return next;
}

/** Seed a record as if it had been answered well, for a hand-set status. */
export function seedLearned(record, now = Date.now()) {
  const base = ensureFsrs(record);
  return {
    ...base,
    seen: true,
    status: 'learned',
    lastSeen: now,
    stability: Math.max(base.stability || 0, LEARNED_STABILITY),
    difficulty: base.difficulty || initialDifficulty(GRADE.GOOD),
    repetitionCount: Math.max(base.repetitionCount, 2),
    nextReview: now + LEARNED_STABILITY * DAY,
  };
}

/** How overdue an item is, in days. Negative means it is not due yet. */
export function overdueDays(record, now = Date.now()) {
  if (!record.nextReview) return record.seen ? 0 : -1;
  return (now - record.nextReview) / DAY;
}

export const isDue = (record, now = Date.now()) =>
  Boolean(record.seen) && record.nextReview > 0 && record.nextReview <= now;

/** Current recall probability for a record, 0–1. */
export function recallNow(record, now = Date.now()) {
  const base = ensureFsrs(record);
  if (!base.seen || !(base.stability > 0)) return 0;
  return retrievability(base.stability, (now - (base.lastSeen || now)) / DAY);
}

/**
 * Priority for lesson selection — higher comes first.
 * The tiers are unchanged, so the lesson engine keeps its behaviour; within a
 * tier the ordering now comes from how faded the memory actually is.
 */
export function priority(record, now = Date.now()) {
  const attempts = record.correctCount + record.incorrectCount;
  const accuracy = attempts ? record.correctCount / attempts : 1;

  if (record.status === 'learning' && record.incorrectCount > 0) {
    return 1000 + record.incorrectCount * 10 + (1 - accuracy) * 50;
  }
  if (isDue(record, now)) {
    return 800 + Math.min(overdueDays(record, now), 30) + (1 - recallNow(record, now)) * 10;
  }
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
