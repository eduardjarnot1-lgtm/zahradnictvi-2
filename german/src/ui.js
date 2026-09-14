/**
 * Small shared UI pieces: escaping, progress rings and the vocabulary card.
 * Views compose these; nothing here knows about routing.
 */

import { canSpeak } from './audio.js';

import { articleLabel, getWordType, displayForm } from './data.js';
import { getStatus, STATUS, STATUS_LABEL } from './progress.js';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);

/** Breadcrumb trail; the last item is the current page. */
export const crumbs = (items) => `
  <nav class="crumbs">
    ${items.map((item, i) => (i === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
      : `<a href="${item.href}">${escapeHtml(item.label)}</a><span class="crumbs__sep">›</span>`)).join('')}
  </nav>`;

/** An SVG progress ring. `size` is the outer diameter in px. */
export function progressRing(stats, size = 96) {
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const learnedFraction = stats.total ? stats.learned / stats.total : 0;
  const activeFraction = stats.total ? (stats.learned + stats.learning) / stats.total : 0;
  return `
    <svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${radius}"></circle>
      <circle class="ring__learning" cx="${size / 2}" cy="${size / 2}" r="${radius}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference * (1 - activeFraction)}"></circle>
      <circle class="ring__learned" cx="${size / 2}" cy="${size / 2}" r="${radius}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference * (1 - learnedFraction)}"></circle>
    </svg>`;
}

export function progressBar(stats) {
  return `
    <div class="bar" role="img"
         aria-label="${stats.learned} of ${stats.total} words learned">
      <span class="bar__learned" style="width:${percent(stats.learned, stats.total)}%"></span>
      <span class="bar__learning" style="width:${percent(stats.learned + stats.learning, stats.total)}%"></span>
    </div>`;
}

/** A big circular navigation button with a progress ring around it. */
export function circleButton({ href, emoji, title, subtitle, stats }) {
  return `
    <a class="circle" href="${href}">
      <span class="circle__disc">
        ${progressRing(stats, 118)}
        <span class="circle__emoji">${emoji}</span>
      </span>
      <span class="circle__title">${escapeHtml(title)}</span>
      <span class="circle__meta">${stats.learned} / ${stats.total} learned</span>
      ${subtitle ? `<span class="circle__sub">${escapeHtml(subtitle)}</span>` : ''}
    </a>`;
}

export function statusChip(wordId) {
  const status = getStatus(wordId);
  return `<span class="chip chip--${status}">${STATUS_LABEL[status]}</span>`;
}

/**
 * The vocabulary card.
 * `revealed` controls whether the English side is visible — the card starts
 * closed so browsing doubles as active recall.
 */
export function wordCard(word, { revealed = false } = {}) {
  const type = getWordType(word.type);
  const article = articleLabel(word);
  const status = getStatus(word.id);
  return `
    <article class="card${revealed ? ' is-revealed' : ''}" data-word="${word.id}">
      <header class="card__head">
        <p class="card__term">
          ${article ? `<span class="card__article card__article--${word.article}">${article}</span>` : ''}
          <span class="card__word">${escapeHtml(word.word)}</span>
          ${speakButton(displayForm(word), { label: 'Hear the word', small: true })}
        </p>
        <span class="card__type">${type ? `${type.emoji} ${escapeHtml(type.name.replace(/s$/, ''))}` : ''}</span>
      </header>
      ${word.variants ? `<p class="card__variants">as listed: ${escapeHtml(word.variants)}</p>` : ''}
      ${levelBadge(word)}
      ${frequencyBadge(word)}

      <button class="card__reveal" type="button" data-action="reveal">Show meaning</button>

      <div class="card__body">
        <p class="card__translation">${escapeHtml(word.translation)}</p>
        ${word.example ? `<p class="card__example">${escapeHtml(word.example)}
          ${speakButton(word.example, { label: 'Hear the sentence', small: true })}</p>` : ''}
        ${word.exampleTranslation ? `<p class="card__example-en">${escapeHtml(word.exampleTranslation)}</p>` : ''}
        ${word.note ? `<p class="card__note">${escapeHtml(word.note)}</p>` : ''}
        ${word.translationSource === 'ding'
          ? '<p class="card__note">Meaning from the Ding German–English dictionary, not from a course word list.</p>'
          : ''}
        ${word.needsReview ? '<p class="card__review">⚑ Article flagged for review — see the note above.</p>' : ''}
      </div>

      <footer class="card__actions">
        <button class="btn btn--know${status === STATUS.LEARNED ? ' is-active' : ''}"
                type="button" data-action="learned">I know this ✅</button>
        <button class="btn btn--practise${status === STATUS.LEARNING ? ' is-active' : ''}"
                type="button" data-action="learning">Practise 🔄</button>
      </footer>
    </article>`;
}

/**
 * A button that reads German aloud. Renders nothing at all when the browser
 * has no speech synthesis, so there is never a button that does nothing.
 */
export function speakButton(text, { label = 'Listen', small = false } = {}) {
  if (!canSpeak() || !text) return '';
  return `<button class="speak${small ? ' speak--small' : ''}" type="button"
    data-action="speak" data-speak="${escapeHtml(text)}"
    title="${escapeHtml(label)}" aria-label="${escapeHtml(`${label}: ${text}`)}">🔊</button>`;
}

/**
 * The word's rank in the subtitle frequency list, when it has one.
 *
 * Only cards whose printed headword is itself a listed form carry a rank, and
 * the label says which corpus it comes from, because "#312" on its own would
 * read as a claim about German in general rather than about film subtitles.
 */
export function frequencyBadge(word) {
  if (!word.frequencyRank) return '';
  const shared = word.frequencyShared
    ? ' <span class="card__freq-note">(rank shared with another word spelled the same)</span>'
    : '';
  return `<p class="card__freq" title="Rank in a frequency list built from film and TV subtitles">
    #${word.frequencyRank} most frequent in subtitles${shared}</p>`;
}

/**
 * The card's CEFR level.
 *
 * Marked "approx." where it came from mapping the GCSE document's
 * Foundation/Higher tier rather than from a word list that states a level, so
 * a sourced A2 and a guessed A2 never look the same on screen.
 */
export function levelBadge(word) {
  if (!word.cefr) return '';
  const approximate = word.cefrSource === 'tier-approximation';
  return `<p class="card__level">
    <span class="tag tag--level">${escapeHtml(word.cefr)}${approximate ? ' approx.' : ''}</span>
    ${approximate
      ? '<span class="card__level-note">from the Foundation/Higher tier, not from a word list</span>'
      : `<span class="card__level-note">${escapeHtml(word.cefrSource)}</span>`}</p>`;
}
