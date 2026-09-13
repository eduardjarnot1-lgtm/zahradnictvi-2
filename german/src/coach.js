/**
 * The Learning Coach.
 *
 * Every statement it makes is computed from records in db.js — counts of
 * answers, mastery scores, review dates, the streak. It never asserts that the
 * learner has done something the database does not show, and when there is no
 * data yet it says exactly that instead of guessing.
 *
 * There is no language model at runtime: the app is a static page with no
 * server, so the coach is deterministic. That is a deliberate trade — a
 * fabricated "I see you've mastered travel vocabulary" would be worse than a
 * plain one that is true.
 */

import { getAllWords, getCategories, wordsInCategory, getWordById, displayForm } from './data.js';
import { getTopics, getTopic } from './grammar.js';
import { vocabProgress, grammarProgress, getProfile, recentEvents, recentSessions } from './db.js';
import { isDue, overdueDays } from './srs.js';

/** The numbers everything else in this module is derived from. */
export function snapshot(now = Date.now()) {
  const words = getAllWords();
  const vocab = { total: words.length, seen: 0, learned: 0, learning: 0, due: 0, weak: 0 };
  const perCategory = new Map();

  for (const category of getCategories()) {
    perCategory.set(category.id, {
      id: category.id, name: category.name, emoji: category.emoji,
      total: 0, learned: 0, learning: 0, weak: 0, seen: 0,
    });
  }

  for (const word of words) {
    const record = vocabProgress(word.id);
    const weak = record.incorrectCount > record.correctCount && record.seen;
    if (record.seen) vocab.seen += 1;
    if (record.status === 'learned') vocab.learned += 1;
    if (record.status === 'learning') vocab.learning += 1;
    if (isDue(record, now)) vocab.due += 1;
    if (weak) vocab.weak += 1;

    for (const placement of word.categories) {
      const bucket = perCategory.get(placement.category);
      if (!bucket) continue;
      bucket.total += 1;
      if (record.seen) bucket.seen += 1;
      if (record.status === 'learned') bucket.learned += 1;
      if (record.status === 'learning') bucket.learning += 1;
      if (weak) bucket.weak += 1;
    }
  }

  const topics = getTopics();
  const grammar = { total: topics.length, practised: 0, mastered: 0, weak: 0, due: 0 };
  const topicStats = topics.map((topic) => {
    const record = grammarProgress(topic.id);
    const attempts = record.correctCount + record.incorrectCount;
    if (attempts > 0) grammar.practised += 1;
    if (record.masteryScore >= 0.7) grammar.mastered += 1;
    if (attempts >= 2 && record.masteryScore < 0.5) grammar.weak += 1;
    if (record.nextReview && record.nextReview <= now) grammar.due += 1;
    return { topic, record, attempts };
  });

  return {
    profile: getProfile(),
    vocab,
    grammar,
    categories: [...perCategory.values()],
    topicStats,
    sessions: recentSessions(10),
  };
}

/** Categories the learner is doing well in / struggling with — data only. */
export function strengthsAndWeaknesses(data = snapshot()) {
  const started = data.categories.filter((c) => c.seen >= 5);
  const withRate = started.map((c) => ({ ...c, rate: c.learned / Math.max(c.seen, 1) }));
  const strong = withRate.filter((c) => c.rate >= 0.6).sort((a, b) => b.rate - a.rate);
  const weak = withRate.filter((c) => c.rate < 0.4 || c.weak >= 3)
    .sort((a, b) => b.weak - a.weak || a.rate - b.rate);
  const weakTopics = data.topicStats
    .filter((t) => t.attempts >= 2 && t.record.masteryScore < 0.5)
    .sort((a, b) => a.record.masteryScore - b.record.masteryScore);
  return { strong, weak, weakTopics };
}

/** The words most in need of work right now, with the reason why. */
export function problemWords(limit = 6, now = Date.now()) {
  return getAllWords()
    .map((word) => ({ word, record: vocabProgress(word.id) }))
    .filter((entry) => entry.record.seen && entry.record.incorrectCount > 0)
    .sort((a, b) => (b.record.incorrectCount - b.record.correctCount)
      - (a.record.incorrectCount - a.record.correctCount))
    .slice(0, limit)
    .map(({ word, record }) => ({
      word,
      display: displayForm(word),
      wrong: record.incorrectCount,
      right: record.correctCount,
      overdue: Math.max(0, Math.round(overdueDays(record, now))),
    }));
}

export function recentMistakes(limit = 8) {
  return recentEvents(80)
    .filter((event) => event.correct === false)
    .slice(0, limit)
    .map((event) => {
      const word = event.itemKind === 'vocab' ? getWordById(event.itemId) : null;
      const topic = event.itemKind === 'grammar' ? getTopic(event.itemId) : null;
      return {
        at: event.at,
        label: word ? displayForm(word) : topic ? topic.title : event.itemId,
        kind: event.itemKind,
        given: event.given || '',
        expected: event.expected || '',
      };
    });
}

/**
 * What to do next. Each recommendation names the numbers it rests on, so the
 * learner can check the claim against the Progress screen.
 */
export function recommendations(now = Date.now()) {
  const data = snapshot(now);
  const { strong, weak, weakTopics } = strengthsAndWeaknesses(data);
  const out = [];

  if (data.vocab.seen === 0 && data.grammar.practised === 0) {
    out.push({
      tone: 'start',
      headline: 'Nothing recorded yet — let’s make a start.',
      detail: `Your target level is ${data.profile.targetLevel}. A first lesson introduces a handful of words and one grammar point.`,
      action: { label: 'Start a lesson', href: '#/learn/lesson' },
    });
    return { data, recommendations: out };
  }

  if (data.vocab.due > 0) {
    out.push({
      tone: 'due',
      headline: `${data.vocab.due} word${data.vocab.due === 1 ? '' : 's'} due for review.`,
      detail: 'Reviewing on schedule is what moves words into long-term memory.',
      action: { label: 'Review now', href: '#/learn/review' },
    });
  }

  if (weakTopics.length) {
    const worst = weakTopics[0];
    const percent = Math.round(worst.record.masteryScore * 100);
    out.push({
      tone: 'weak-grammar',
      headline: `Grammar to work on: ${worst.topic.title}.`,
      detail: `You have answered ${worst.record.correctCount} of ${worst.attempts} questions on this topic correctly (${percent} % mastery).`,
      action: { label: 'Practise this topic', href: `#/grammar/${worst.topic.id}/practice` },
    });
  }

  if (weak.length) {
    const area = weak[0];
    out.push({
      tone: 'weak-vocab',
      headline: `${area.name} needs another pass.`,
      detail: `${area.learned} of the ${area.seen} words you have seen there are learned${area.weak ? `, and ${area.weak} keep coming out wrong` : ''}.`,
      action: { label: `Practise ${area.name}`, href: `#/learn/lesson/${area.id}` },
    });
  }

  if (strong.length && (weak.length || weakTopics.length)) {
    const area = strong[0];
    out.push({
      tone: 'strong',
      headline: `${area.name} is going well.`,
      detail: `${area.learned} of ${area.seen} words learned — those are on a long review interval now.`,
      action: null,
    });
  }

  if (out.length === 0) {
    out.push({
      tone: 'steady',
      headline: 'Nothing overdue — good place to take on something new.',
      detail: `${data.vocab.learned} of ${data.vocab.total} words learned, ${data.grammar.mastered} of ${data.grammar.total} grammar topics at 70 % mastery or better.`,
      action: { label: 'Start a lesson', href: '#/learn/lesson' },
    });
  }

  return { data, recommendations: out };
}

/** One short line for Master Fuka, grounded in the same numbers. */
export function coachLine(now = Date.now()) {
  const { data, recommendations: list } = recommendations(now);
  if (data.profile.streakDays >= 3) {
    return `${data.profile.streakDays} days in a row — that is exactly how vocabulary sticks.`;
  }
  return list[0] ? list[0].headline : 'Let’s learn some German today!';
}
