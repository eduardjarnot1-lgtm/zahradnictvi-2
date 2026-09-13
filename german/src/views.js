/**
 * Screens. Each view returns HTML for the main area; interactive behaviour is
 * wired up by app.js after the HTML is inserted.
 */

import {
  getCategories, getCategory, getSubcategory, getWordType, getAllWords, getMeta,
  wordsInCategory, wordsInSubcategory, wordsOfType, typesInSubcategory,
} from './data.js';
import { summarise } from './progress.js';
import { fukaBubble } from './fuka.js';
import { circleButton, crumbs, escapeHtml, progressBar, progressRing, wordCard, percent } from './ui.js';

// --- home -------------------------------------------------------------------

export function vocabIndexView() {
  const all = getAllWords();
  const stats = summarise(all);
  const started = stats.learned + stats.learning > 0;

  const circles = getCategories()
    .map((category) => circleButton({
      href: `#/c/${category.id}`,
      emoji: category.emoji,
      title: category.name,
      stats: summarise(wordsInCategory(category.id)),
    }))
    .join('');

  return `
    ${crumbs([{ label: 'German Learning', href: '#/' }, { label: 'Vocabulary' }])}
    ${fukaBubble(started ? 'homeStarted' : 'home')}

    <section class="overall">
      <div class="overall__ring">
        ${progressRing(stats, 132)}
        <span class="overall__percent">${percent(stats.learned, stats.total)}%</span>
      </div>
      <div class="overall__text">
        <h2>${escapeHtml(getMeta().source.replace(/ \(.*\)$/, ''))}</h2>
        <p class="overall__count"><strong>${stats.learned}</strong> / ${stats.total} words learned</p>
        <p class="overall__sub">${stats.learning} in practice · ${stats.new} not started${stats.due ? ` · <a href="#/learn/review">${stats.due} due</a>` : ''}</p>
        ${progressBar(stats)}
      </div>
      <a class="cta" href="#/learn/lesson">Practise now</a>
    </section>

    <h2 class="section-title">Topics</h2>
    <div class="circles">${circles}</div>`;
}

// --- category ---------------------------------------------------------------

export function categoryView(catId) {
  const category = getCategory(catId);
  if (!category) return notFoundView();
  const stats = summarise(wordsInCategory(catId));

  const circles = category.subcategories
    .map((sub) => circleButton({
      href: `#/c/${catId}/${sub.id}`,
      emoji: sub.emoji,
      title: sub.name,
      stats: summarise(wordsInSubcategory(catId, sub.id)),
    }))
    .join('');

  return `
    ${crumbs([{ label: 'Vocabulary', href: '#/vocab' }, { label: category.name }])}
    ${fukaBubble('category')}
    <header class="page-head">
      <h1>${category.emoji} ${escapeHtml(category.name)}</h1>
      <p class="page-head__meta">${stats.learned} / ${stats.total} words learned${stats.due ? ` · ${stats.due} due` : ''}</p>
      ${progressBar(stats)}
      <a class="cta cta--small" href="#/learn/lesson/${catId}">Practise this topic</a>
    </header>
    <div class="circles">${circles}</div>`;
}

// --- sub-topic (word types) -------------------------------------------------

export function subcategoryView(catId, subId) {
  const category = getCategory(catId);
  const sub = getSubcategory(catId, subId);
  if (!category || !sub) return notFoundView();
  const stats = summarise(wordsInSubcategory(catId, subId));

  const circles = typesInSubcategory(catId, subId)
    .map((type) => circleButton({
      href: `#/c/${catId}/${subId}/${type.id}`,
      emoji: type.emoji,
      title: type.name,
      stats: summarise(wordsOfType(catId, subId, type.id)),
    }))
    .join('');

  return `
    ${crumbs([
      { label: 'Vocabulary', href: '#/vocab' },
      { label: category.name, href: `#/c/${catId}` },
      { label: sub.name },
    ])}
    ${fukaBubble('subcategory')}
    <header class="page-head">
      <h1>${sub.emoji} ${escapeHtml(sub.name)}</h1>
      <p class="page-head__meta">${stats.learned} / ${stats.total} words learned${stats.due ? ` · ${stats.due} due` : ''}</p>
      ${progressBar(stats)}
      <p class="page-head__source">In the source list: “${escapeHtml(sub.documentName)}”</p>
    </header>
    <div class="circles">${circles}</div>`;
}

// --- word list --------------------------------------------------------------

export function wordListView(catId, subId, typeId) {
  const category = getCategory(catId);
  const sub = getSubcategory(catId, subId);
  const type = getWordType(typeId);
  const words = wordsOfType(catId, subId, typeId);
  if (!category || !sub || !type || words.length === 0) return notFoundView();

  const stats = summarise(words);
  const situation = typeId === 'noun' ? 'listNouns' : stats.learned === stats.total ? 'allLearned' : 'list';

  return `
    ${crumbs([
      { label: 'Vocabulary', href: '#/vocab' },
      { label: category.name, href: `#/c/${catId}` },
      { label: sub.name, href: `#/c/${catId}/${subId}` },
      { label: type.name },
    ])}
    ${fukaBubble(situation)}
    <header class="page-head">
      <h1>${type.emoji} ${escapeHtml(type.name)}</h1>
      <p class="page-head__meta">${stats.learned} / ${stats.total} learned · ${stats.learning} in practice</p>
      ${progressBar(stats)}
      <div class="page-head__tools">
        <button class="btn btn--ghost" type="button" data-action="reveal-all">Show all meanings</button>
        <a class="cta cta--small" href="#/practice/${catId}/${subId}/${typeId}">Practise these</a>
      </div>
    </header>
    <div class="cards">${words.map((word) => wordCard(word)).join('')}</div>`;
}

// --- search -----------------------------------------------------------------

export function searchResultsView(query, results) {
  if (!query || query.trim().length < 2) {
    return `<p class="empty">Type at least two letters to search the vocabulary.</p>`;
  }
  if (results.length === 0) {
    return `<p class="empty">No word in the list matches “${escapeHtml(query)}”.</p>`;
  }
  return `
    <p class="results-count">${results.length} result${results.length === 1 ? '' : 's'} for “${escapeHtml(query)}”</p>
    <div class="cards">${results.map((word) => wordCard(word, { revealed: true })).join('')}</div>`;
}

// --- misc -------------------------------------------------------------------

export function notFoundView() {
  return `<p class="empty">That page doesn’t exist. <a href="#/">Back to the topics</a>.</p>`;
}

export function aboutView() {
  const meta = getMeta();
  const all = getAllWords();
  const stats = summarise(all);
  const flagged = all.filter((w) => w.needsReview);
  return `
    ${crumbs([{ label: 'Vocabulary', href: '#/vocab' }, { label: 'About the data' }])}
    <header class="page-head">
      <h1>About this vocabulary</h1>
    </header>
    <div class="prose">
      <p><strong>Vocabulary source:</strong> ${escapeHtml(meta.source)}</p>
      <p>${escapeHtml(meta.sourceNote)}</p>
      <p><strong>Level:</strong> the document grades entries by Foundation/Higher tier, not by CEFR.
         ${escapeHtml(meta.cefrNote)}</p>
      <ul>
        <li>${meta.sourceEntryCount} entries read from the document</li>
        <li>${meta.wordCount} vocabulary cards after merging repeated entries</li>
        <li>${stats.learned} learned · ${stats.learning} in practice · ${stats.new} not started</li>
        <li>${flagged.length} article${flagged.length === 1 ? '' : 's'} flagged for review</li>
      </ul>
      <h2>Flagged for review</h2>
      <p>These entries could not be given one certain article — the note on each card explains why.</p>
      <ul class="flagged">
        ${flagged.map((w) => `<li><strong>${escapeHtml(w.article)} ${escapeHtml(w.word)}</strong> — ${escapeHtml(w.note)}</li>`).join('')}
      </ul>
      <h2>Your progress</h2>
      <p>Progress is stored in this browser only. There are no accounts and nothing is uploaded.</p>
      <button class="btn btn--ghost" type="button" data-action="reset-progress">Reset all progress</button>
    </div>`;
}
