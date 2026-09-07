/**
 * Practice session logic — pure data, no DOM.
 *
 * A session is a small queue of questions built from words the learner needs
 * most: words marked "practise" first, then words never seen, then learned ones
 * for revision. Nouns get an article question, everything else a meaning
 * question. This is the seam where spaced repetition would later plug in.
 */

import { getStatus, STATUS } from './progress.js';

export const SESSION_SIZE = 10;

const PRIORITY = {
  [STATUS.LEARNING]: 0,
  [STATUS.NEW]: 1,
  [STATUS.LEARNED]: 2,
};

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Order a pool so the words that need practice come first. */
export function selectWords(pool, size = SESSION_SIZE) {
  const buckets = [[], [], []];
  for (const word of pool) buckets[PRIORITY[getStatus(word.id)]].push(word);
  return buckets.flatMap(shuffle).slice(0, size);
}

export function buildSession(pool, size = SESSION_SIZE) {
  const words = selectWords(pool, size);
  return {
    questions: words.map((word) => ({
      word,
      kind: word.article && !word.plural ? 'article' : 'meaning',
      answered: false,
      correct: null,
    })),
    position: 0,
    correct: 0,
  };
}

export const currentQuestion = (session) => session.questions[session.position] || null;
export const isFinished = (session) => session.position >= session.questions.length;

/**
 * Record an answer.
 * `correct` is the checked result for article questions and the learner's own
 * "did I know it?" for meaning questions.
 */
export function answer(session, correct) {
  const question = currentQuestion(session);
  if (!question || question.answered) return question;
  question.answered = true;
  question.correct = correct;
  if (correct) session.correct += 1;
  return question;
}

export function advance(session) {
  session.position += 1;
  return currentQuestion(session);
}

export const ARTICLES = ['der', 'die', 'das'];
