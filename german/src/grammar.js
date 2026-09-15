/**
 * Grammar data layer — loading and indexing data/grammar.json.
 * The mirror of data.js for the grammar side; nothing else reads the JSON.
 */

let grammarDb = null;
const byId = new Map();
const byLevel = new Map();
const exerciseById = new Map();

export async function loadGrammar() {
  if (grammarDb) return grammarDb;
  const response = await fetch(new URL('../data/grammar.json', import.meta.url));
  if (!response.ok) throw new Error(`Could not load grammar (${response.status})`);
  grammarDb = await response.json();
  indexGrammar();
  return grammarDb;
}

/** Used by the single-file bundle, which embeds the JSON instead of fetching. */
export function setGrammarData(data) {
  grammarDb = data;
  indexGrammar();
  return grammarDb;
}

function indexGrammar() {
  byId.clear();
  byLevel.clear();
  exerciseById.clear();
  for (const topic of grammarDb.topics) {
    byId.set(topic.id, topic);
    if (!byLevel.has(topic.level)) byLevel.set(topic.level, []);
    byLevel.get(topic.level).push(topic);
    for (const exercise of topic.exercises) exerciseById.set(exercise.id, exercise);
  }
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** Where a level sits in the CEFR order; -1 for anything unknown. */
export const levelIndex = (level) => CEFR_ORDER.indexOf(level);

export const grammarLoaded = () => grammarDb !== null;
export const getGrammarMeta = () => grammarDb.meta;
export const getTopics = () => grammarDb.topics;
export const getTopic = (id) => byId.get(id) || null;
export const getExercise = (id) => exerciseById.get(id) || null;
/** The levels that actually hold grammar, in CEFR order, with their groups. */
export const getGrammarLevels = () => grammarDb.levels;
export const topicsAtLevel = (level) => byLevel.get(level) || [];
/** The groups of one level, each with its topic objects resolved. */
export const groupsAtLevel = (level) => {
  const entry = grammarDb.levels.find((item) => item.level === level);
  if (!entry) return [];
  return entry.groups.map((group) => ({
    name: group.name,
    topics: group.topics.map((id) => byId.get(id)).filter(Boolean),
  }));
};

export const getGrammarCategories = () => {
  const counts = new Map();
  for (const topic of grammarDb.topics) counts.set(topic.category, (counts.get(topic.category) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export const topicsInCategory = (category) =>
  grammarDb.topics.filter((topic) => topic.category === category);

/** Topics this one builds on that the learner has not practised yet. */
export function unmetPrerequisites(topic, masteryOf) {
  return topic.prerequisites
    .map((id) => byId.get(id))
    .filter((prerequisite) => prerequisite && masteryOf(prerequisite.id) < 0.4);
}

export function searchTopics(query) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return grammarDb.topics.filter((topic) =>
    topic.title.toLowerCase().includes(needle) ||
    topic.titleEn.toLowerCase().includes(needle) ||
    topic.summary.toLowerCase().includes(needle) ||
    topic.category.toLowerCase().includes(needle) ||
    topic.tags.some((tag) => tag.toLowerCase().includes(needle)));
}
