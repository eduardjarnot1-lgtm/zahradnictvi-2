/**
 * Vocabulary data layer.
 *
 * Owns loading and indexing of data/vocabulary.json. Nothing else in the app
 * reads the JSON directly, so the source can later move to an API without
 * touching the UI.
 */

let db = null;
const index = {
  byId: new Map(),
  byCategory: new Map(),      // catId -> word[]
  bySubcategory: new Map(),   // `${catId}/${subId}` -> word[]
  byTypeInSub: new Map(),     // `${catId}/${subId}/${type}` -> word[]
};

function push(map, key, value) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
}

function buildIndex() {
  index.byId.clear();
  index.byCategory.clear();
  index.bySubcategory.clear();
  index.byTypeInSub.clear();

  for (const word of db.words) {
    index.byId.set(word.id, word);
    const seenCats = new Set();
    for (const place of word.categories) {
      if (!seenCats.has(place.category)) {
        seenCats.add(place.category);
        push(index.byCategory, place.category, word);
      }
      push(index.bySubcategory, `${place.category}/${place.subcategory}`, word);
      push(index.byTypeInSub, `${place.category}/${place.subcategory}/${word.type}`, word);
    }
  }
}

export async function loadVocabulary() {
  if (db) return db;
  const response = await fetch(new URL('../data/vocabulary.json', import.meta.url));
  if (!response.ok) throw new Error(`Could not load vocabulary (${response.status})`);
  db = await response.json();
  buildIndex();
  return db;
}

export const getMeta = () => db.meta;
export const getCategories = () => db.categories;
export const getWordTypes = () => db.wordTypes;
export const getAllWords = () => db.words;

export const getCategory = (catId) => db.categories.find((c) => c.id === catId) || null;

export function getSubcategory(catId, subId) {
  const category = getCategory(catId);
  return category ? category.subcategories.find((s) => s.id === subId) || null : null;
}

export const getWordType = (typeId) => db.wordTypes.find((t) => t.id === typeId) || null;

export const getWordById = (id) => index.byId.get(id) || null;
export const wordsInCategory = (catId) => index.byCategory.get(catId) || [];
export const wordsInSubcategory = (catId, subId) => index.bySubcategory.get(`${catId}/${subId}`) || [];
export const wordsOfType = (catId, subId, type) =>
  index.byTypeInSub.get(`${catId}/${subId}/${type}`) || [];

/** Word types that actually occur in a sub-topic, in the canonical order. */
export function typesInSubcategory(catId, subId) {
  const words = wordsInSubcategory(catId, subId);
  const counts = new Map();
  for (const word of words) counts.set(word.type, (counts.get(word.type) || 0) + 1);
  return db.wordTypes
    .filter((t) => counts.has(t.id))
    .map((t) => ({ ...t, count: counts.get(t.id) }));
}

/** The display form of a word: "der Tisch", "abtrocknen", … */
export function displayForm(word) {
  return word.article && !word.plural ? `${word.article} ${word.word}` : word.word;
}

/** The article shown on a card, including the plural caveat. */
export function articleLabel(word) {
  if (!word.article) return '';
  return word.plural ? `${word.article} (pl.)` : word.article;
}
