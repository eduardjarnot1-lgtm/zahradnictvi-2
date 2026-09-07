/**
 * Search over the imported vocabulary — German terms and English meanings.
 * Only words from the source document can ever be returned.
 */

import { getAllWords } from './data.js';

const fold = (text) =>
  text
    .toLowerCase()
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ß', 'ss');

export function searchWords(query, limit = 60) {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];

  const results = [];
  for (const word of getAllWords()) {
    const german = fold(`${word.term} ${word.word}`);
    const english = fold(word.translation);
    // "table" should find "der Tisch" before "das Tablett", so an exact meaning
    // (or an exact part of a "a / b" gloss) outranks a mere prefix match.
    const englishParts = english.split(/\s*[/,]\s*/).map((p) => p.replace(/\s*\(.*?\)\s*/g, '').trim());

    let score = 0;
    if (fold(word.word) === needle) score = 6;
    else if (englishParts.includes(needle)) score = 5;
    else if (german.startsWith(needle)) score = 4;
    else if (english.startsWith(needle)) score = 3;
    else if (german.includes(needle)) score = 2;
    else if (english.includes(needle)) score = 1;
    if (score) results.push({ word, score });
  }

  results.sort((a, b) => b.score - a.score || a.word.word.localeCompare(b.word.word, 'de'));
  return results.slice(0, limit).map((r) => r.word);
}
