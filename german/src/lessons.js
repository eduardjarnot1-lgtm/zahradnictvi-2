/**
 * The personalised lesson engine.
 *
 * Builds a lesson from what the learner actually needs, in this order:
 *   1. weak items        — answered wrong before
 *   2. overdue reviews   — due according to the spaced-repetition schedule
 *   3. recently introduced items
 *   4. new items
 *   5. the occasional mastered item, for maintenance
 *
 * The mix is a target, not a quota: if there is nothing overdue, those slots
 * go to the next priority down rather than being padded out.
 */

import { getAllWords, wordsInCategory, getWordById } from './data.js';
import { getTopics, getTopic, levelIndex } from './grammar.js';
import { vocabProgress, grammarProgress, getProfile } from './db.js';
import { priority, isDue } from './srs.js';
import { chooseVocabType, buildVocabExercise, grammarExercisesFor } from './exercises.js';

export const DEFAULT_MIX = { newVocab: 4, reviewVocab: 3, articles: 2, context: 2, grammar: 1 };

/**
 * Order candidates for a lesson.
 *
 * Priority from the scheduler decides first. Frequency breaks the tie, so that
 * among words the scheduler cares about equally — most obviously the unseen
 * ones, which all score the same — the ones a learner will actually meet get
 * taught first. Unranked words sort last within their tier rather than being
 * excluded: not being in a subtitle corpus is not a reason never to learn a
 * word.
 */
function scored(words, now) {
  return words
    .map((word) => ({ word, record: vocabProgress(word.id) }))
    .map((entry) => ({ ...entry, score: priority(entry.record, now) }))
    .sort((a, b) => b.score - a.score
      || (a.word.frequencyRank || Infinity) - (b.word.frequencyRank || Infinity));
}

/** Split a scored list into the buckets the mix is expressed in. */
function buckets(entries, now) {
  return {
    weak: entries.filter((e) => e.record.status === 'learning' && e.record.incorrectCount > 0),
    due: entries.filter((e) => isDue(e.record, now) && e.record.incorrectCount === 0),
    started: entries.filter((e) => e.record.seen && e.record.status === 'learning'
      && e.record.incorrectCount === 0 && !isDue(e.record, now)),
    fresh: entries.filter((e) => !e.record.seen),
    mastered: entries.filter((e) => e.record.status === 'learned' && !isDue(e.record, now)),
  };
}

function take(list, count, used) {
  const out = [];
  for (const entry of list) {
    if (out.length >= count) break;
    if (used.has(entry.word.id)) continue;
    used.add(entry.word.id);
    out.push(entry);
  }
  return out;
}

/**
 * Which grammar topic deserves attention next: the weakest practised topic,
 * otherwise the easiest unstarted topic whose prerequisites are already met.
 *
 * New topics are drawn at or below the learner's target level, so someone
 * aiming at B1 is not handed a C1 unit. If everything at or below that level
 * is already practised, the search widens rather than returning nothing.
 */
export function nextGrammarTopic(now = Date.now()) {
  const topics = getTopics();
  if (!topics.length) return null;
  const ceiling = levelIndex(getProfile().targetLevel);

  const withProgress = topics.map((topic) => ({ topic, record: grammarProgress(topic.id) }));
  const practised = withProgress.filter((t) => t.record.correctCount + t.record.incorrectCount > 0);

  const weak = practised
    .filter((t) => t.record.masteryScore < 0.6)
    .sort((a, b) => a.record.masteryScore - b.record.masteryScore);
  if (weak.length) return weak[0].topic;

  const overdue = practised
    .filter((t) => t.record.nextReview && t.record.nextReview <= now)
    .sort((a, b) => a.record.nextReview - b.record.nextReview);
  if (overdue.length) return overdue[0].topic;

  const masteryOf = (id) => grammarProgress(id).masteryScore;
  const inOrder = (a, b) => levelIndex(a.topic.level) - levelIndex(b.topic.level)
    || a.topic.difficulty - b.topic.difficulty
    || a.topic.groupOrder - b.topic.groupOrder
    || a.topic.order - b.topic.order;
  const unstarted = withProgress
    .filter((t) => t.record.correctCount + t.record.incorrectCount === 0)
    .filter((t) => t.topic.prerequisites.every((p) => masteryOf(p) >= 0.4 || !getTopic(p)))
    .sort(inOrder);

  const atLevel = ceiling < 0 ? unstarted
    : unstarted.filter((t) => levelIndex(t.topic.level) <= ceiling);
  const ready = atLevel.length ? atLevel : unstarted;
  return ready.length ? ready[0].topic : withProgress[0].topic;
}

/**
 * Build a lesson.
 * `scope` may name a vocabulary category; otherwise the whole list is used.
 */
export function buildLesson({ scope = null, mix = DEFAULT_MIX, now = Date.now() } = {}) {
  const profile = getProfile();
  const pool = scope ? wordsInCategory(scope) : getAllWords();
  const entries = scored(pool, now);
  const group = buckets(entries, now);
  const used = new Set();

  const reviewTarget = mix.reviewVocab + mix.articles + mix.context;
  const reviewPicks = [
    ...take(group.weak, reviewTarget, used),
    ...take(group.due, reviewTarget, used),
    ...take(group.started, reviewTarget, used),
    ...take(group.mastered, 1, used),
  ].slice(0, reviewTarget);

  const newPicks = take(group.fresh, mix.newVocab, used);

  // If one side came up short, let the other fill the gap rather than
  // shipping a lesson that is half empty.
  const shortfall = mix.newVocab + reviewTarget - (reviewPicks.length + newPicks.length);
  const filler = shortfall > 0
    ? take([...group.fresh, ...group.started, ...group.mastered], shortfall, used)
    : [];

  const vocabItems = [...newPicks, ...reviewPicks, ...filler].map(({ word, record }) => {
    const type = chooseVocabType(word, record);
    return buildVocabExercise(word, type);
  });

  const topic = mix.grammar > 0 ? nextGrammarTopic(now) : null;
  const grammarItems = topic ? grammarExercisesFor(topic, mix.grammar) : [];

  const items = [...vocabItems];
  // Put the grammar item near the end, where it works as a change of pace.
  const insertAt = Math.max(0, items.length - 1);
  items.splice(insertAt, 0, ...grammarItems);

  return {
    id: `lesson-${now.toString(36)}`,
    startedAt: now,
    targetLevel: profile.targetLevel,
    scope,
    grammarTopicId: topic ? topic.id : null,
    composition: {
      new: newPicks.length,
      review: reviewPicks.length,
      filler: filler.length,
      grammar: grammarItems.length,
    },
    items,
  };
}

/** A lesson built from an explicit list of words — used by "Practise these". */
export function scopedLesson(words, size = 10, now = Date.now()) {
  const chosen = scored(words, now).slice(0, size);
  const items = chosen.map(({ word, record }) =>
    buildVocabExercise(word, chooseVocabType(word, record)));
  return {
    id: `scoped-${now.toString(36)}`,
    startedAt: now,
    scope: null,
    grammarTopicId: null,
    composition: { new: chosen.filter((e) => !e.record.seen).length,
      review: chosen.filter((e) => e.record.seen).length, filler: 0, grammar: 0 },
    items,
  };
}

/** Everything currently due for review, most urgent first. */
export function dueForReview(now = Date.now(), limit = 50) {
  return scored(getAllWords(), now)
    .filter((entry) => entry.record.seen
      && (isDue(entry.record, now) || entry.record.incorrectCount > entry.record.correctCount))
    .slice(0, limit)
    .map((entry) => entry.word);
}

export function reviewLesson(now = Date.now(), size = 10) {
  const words = dueForReview(now, size);
  const items = words.map((word) => {
    const record = vocabProgress(word.id);
    return buildVocabExercise(word, chooseVocabType(word, record));
  });
  return {
    id: `review-${now.toString(36)}`,
    startedAt: now,
    scope: null,
    grammarTopicId: null,
    composition: { new: 0, review: items.length, filler: 0, grammar: 0 },
    items,
  };
}

export const wordOf = (item) => (item.itemKind === 'vocab' ? getWordById(item.itemId) : null);
