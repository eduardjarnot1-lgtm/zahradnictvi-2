/**
 * Screens. Each view returns HTML for the main area; interactive behaviour is
 * wired up by app.js after the HTML is inserted.
 */

import {
  getCategories, getCategory, getSubcategory, getWordType, getAllWords, getMeta,
  wordsInCategory, wordsInSubcategory, wordsOfType, typesInSubcategory,
} from './data.js';
import { summarise, getStatus, STATUS } from './progress.js';
import { fukaBubble } from './fuka.js';
import { circleButton, escapeHtml, progressBar, progressRing, wordCard, percent } from './ui.js';

const crumbs = (items) => `
  <nav class="crumbs">
    ${items
      .map((item, i) =>
        i === items.length - 1
          ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
          : `<a href="${item.href}">${escapeHtml(item.label)}</a><span class="crumbs__sep">›</span>`)
      .join('')}
  </nav>`;

// --- home -------------------------------------------------------------------

export function homeView() {
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
    ${fukaBubble(started ? 'homeStarted' : 'home')}

    <section class="overall">
      <div class="overall__ring">
        ${progressRing(stats, 132)}
        <span class="overall__percent">${percent(stats.learned, stats.total)}%</span>
      </div>
      <div class="overall__text">
        <h2>${escapeHtml(getMeta().source.replace(/ \(.*\)$/, ''))}</h2>
        <p class="overall__count"><strong>${stats.learned}</strong> / ${stats.total} words learned</p>
        <p class="overall__sub">${stats.learning} in practice · ${stats.new} not started</p>
        ${progressBar(stats)}
      </div>
      <a class="cta" href="#/practice">Practise now</a>
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
    ${crumbs([{ label: 'Topics', href: '#/' }, { label: category.name }])}
    ${fukaBubble('category')}
    <header class="page-head">
      <h1>${category.emoji} ${escapeHtml(category.name)}</h1>
      <p class="page-head__meta">${stats.learned} / ${stats.total} words learned</p>
      ${progressBar(stats)}
      <a class="cta cta--small" href="#/practice/${catId}">Practise this topic</a>
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
      { label: 'Topics', href: '#/' },
      { label: category.name, href: `#/c/${catId}` },
      { label: sub.name },
    ])}
    ${fukaBubble('subcategory')}
    <header class="page-head">
      <h1>${sub.emoji} ${escapeHtml(sub.name)}</h1>
      <p class="page-head__meta">${stats.learned} / ${stats.total} words learned</p>
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
      { label: 'Topics', href: '#/' },
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

// --- practice ---------------------------------------------------------------

export function practiceIntroView(scope) {
  return `
    ${crumbs([{ label: 'Topics', href: '#/' }, { label: 'Practice' }])}
    ${fukaBubble(scope.pool.length ? 'practiceStart' : 'practiceEmpty')}
    <header class="page-head">
      <h1>🔄 Practice</h1>
      <p class="page-head__meta">${escapeHtml(scope.label)} · ${scope.pool.length} words available</p>
    </header>
    <div class="practice" id="practice"></div>`;
}

export function practiceQuestionView(session, question) {
  const total = session.questions.length;
  const number = session.position + 1;
  const word = question.word;
  const prompt = question.kind === 'article'
    ? `<p class="quiz__word"><span class="quiz__blank">_____</span> ${escapeHtml(word.word)}</p>
       <p class="quiz__ask">What is the correct article?</p>`
    : `<p class="quiz__word">${escapeHtml(word.word)}</p>
       <p class="quiz__ask">What does this word mean?</p>`;

  const controls = question.kind === 'article'
    ? `<div class="quiz__articles">
         ${['der', 'die', 'das'].map((a) => `<button class="btn btn--article" type="button" data-article="${a}">${a}</button>`).join('')}
       </div>`
    : `<button class="btn btn--ghost" type="button" data-action="show-answer">Show the answer</button>`;

  return `
    <div class="quiz">
      <p class="quiz__count">Question ${number} of ${total}</p>
      <div class="quiz__prompt">${prompt}</div>
      <div class="quiz__controls">${controls}</div>
      <div class="quiz__feedback" hidden></div>
    </div>`;
}

export function practiceSummaryView(session, scope) {
  const total = session.questions.length;
  const good = session.correct;
  return `
    <div class="summary">
      ${fukaBubble(good >= Math.ceil(total * 0.7) ? 'practiceGood' : 'practiceMixed')}
      <p class="summary__score">${good} / ${total}</p>
      <p class="summary__text">You marked ${good} of ${total} words as known.</p>
      <div class="summary__actions">
        <button class="cta" type="button" data-action="practice-again">Practise again</button>
        <a class="btn btn--ghost" href="${scope.backHref}">Back</a>
      </div>
    </div>`;
}

export function practiceEmptyView(scope) {
  return `<p class="empty">There are no words to practise here yet. <a href="${scope.backHref}">Go back</a> and open a topic first.</p>`;
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
    ${crumbs([{ label: 'Topics', href: '#/' }, { label: 'About the data' }])}
    <header class="page-head">
      <h1>About this vocabulary</h1>
    </header>
    <div class="prose">
      <p><strong>Source:</strong> ${escapeHtml(meta.source)}</p>
      <p>${escapeHtml(meta.sourceNote)}</p>
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

export const statusOf = getStatus;
export { STATUS };
