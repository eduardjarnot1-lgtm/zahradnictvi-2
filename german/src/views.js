/**
 * Screens. Each view returns HTML for the main area; interactive behaviour is
 * wired up by app.js after the HTML is inserted.
 */

import {
  getCategories, getCategory, getSubcategory, getWordType, getAllWords, getMeta,
  wordsInCategory, wordsInSubcategory, wordsOfType, typesInSubcategory,
  rankedWords, frequencyMeta, displayForm,
} from './data.js';
import { summarise, getStatus, STATUS_LABEL } from './progress.js';
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
      <p><strong>Level:</strong> the GCSE document grades entries by Foundation/Higher tier, not by
         CEFR. ${escapeHtml(meta.cefrNote)}</p>
      ${meta.cefr ? `
        <h2>CEFR levels</h2>
        <p>${escapeHtml(meta.cefr.note)}</p>
        <ul>
          ${meta.cefr.sources.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}
        </ul>
        <ul>
          <li>${Object.entries(meta.cefr.levelCounts).map(([level, count]) =>
                `${level} ${count}`).join(' · ')}</li>
          <li>${meta.cefr.importedWords} cards come from those word lists rather than from the GCSE
              document</li>
          <li>${meta.cefr.approximatedWords} cards appear in no list and keep the tier
              approximation, labelled as approximate</li>
        </ul>` : ''}
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
      <h2>Word frequency</h2>
      ${frequencyMeta() ? `
        <p><strong>Frequency source:</strong> ${escapeHtml(frequencyMeta().source)}</p>
        <p>${escapeHtml(frequencyMeta().note)}</p>
        <ul>
          <li>${frequencyMeta().formCount} word forms in the list</li>
          <li>${frequencyMeta().rankedWords} of ${all.length} vocabulary cards carry a rank</li>
          <li>${frequencyMeta().formCount - frequencyMeta().rankedWords} listed forms are not vocabulary
              headwords — mostly function words the GCSE list does not teach as entries, and inflected
              forms such as <em>ist</em> or <em>sind</em>, which the corpus lists separately from
              <em>sein</em></li>
        </ul>
        <p>A rank is attached only where the card's printed headword is itself a listed form. No lemma
           matching is attempted, because the corpus does not contain lemmas and guessing at them would
           put a number on a card the corpus never measured.</p>
        <p><a href="#/core">See the core words in frequency order</a></p>`
        : '<p>No frequency list has been imported.</p>'}

      <h2>Your progress</h2>
      <p>Progress is stored in this browser only. There are no accounts and nothing is uploaded.</p>
      <button class="btn btn--ghost" type="button" data-action="reset-progress">Reset all progress</button>
    </div>`;
}

/**
 * The core-vocabulary screen: cards that carry a subtitle-frequency rank,
 * most frequent first, with their learning status.
 *
 * This is the "core 2000 words" idea from the research note, built from what
 * the data actually supports. It is not a separate word list — every card here
 * is one of the existing vocabulary cards, shown in a different order.
 */
export function coreWordsView(limit = 300) {
  const meta = frequencyMeta();
  const ranked = rankedWords();
  if (!ranked.length) {
    return `<p class="empty">No frequency data has been imported.
      <a href="#/vocab">Back to the vocabulary</a>.</p>`;
  }
  const shown = ranked.slice(0, limit);
  const stats = summarise(ranked);

  const rows = shown.map((word) => {
    const status = getStatus(word.id);
    return `
      <tr>
        <td class="num">${word.frequencyRank}</td>
        <th scope="row">${escapeHtml(displayForm(word))}</th>
        <td>${escapeHtml(word.translation)}</td>
        <td><span class="chip chip--${status}">${escapeHtml(STATUS_LABEL[status])}</span></td>
      </tr>`;
  }).join('');

  return `
    ${crumbs([{ label: 'Vocabulary', href: '#/vocab' }, { label: 'Core words' }])}
    ${fukaBubble('subcategory', 'These are the words you will run into most often. Start here.')}
    <header class="page-head">
      <h1>⭐ Core words</h1>
      <p class="page-head__meta">${ranked.length} of ${getAllWords().length} vocabulary cards appear in the
        frequency list · ${stats.learned} learned · ${stats.learning} in progress</p>
      <p class="page-head__source">${escapeHtml(meta ? meta.source : '')}</p>
    </header>

    <p class="lead">${escapeHtml(meta ? meta.note : '')}</p>

    <h2 class="section-title">Top ${shown.length} by frequency</h2>
    <div class="tablewrap">
      <table class="table">
        <thead><tr><th class="num">Rank</th><th>German</th><th>Meaning</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${ranked.length > shown.length
      ? `<p class="page-head__source">${ranked.length - shown.length} further ranked cards are not listed here;
         all of them appear under their own topic in the vocabulary section.</p>`
      : ''}`;
}
