/**
 * Small shared UI pieces: escaping, progress rings and the vocabulary card.
 * Views compose these; nothing here knows about routing.
 */

import { articleLabel, getWordType } from './data.js';
import { getStatus, STATUS, STATUS_LABEL } from './progress.js';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);

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
        </p>
        <span class="card__type">${type ? `${type.emoji} ${escapeHtml(type.name.replace(/s$/, ''))}` : ''}</span>
      </header>
      ${word.variants ? `<p class="card__variants">as listed: ${escapeHtml(word.variants)}</p>` : ''}

      <button class="card__reveal" type="button" data-action="reveal">Show meaning</button>

      <div class="card__body">
        <p class="card__translation">${escapeHtml(word.translation)}</p>
        <p class="card__example">${escapeHtml(word.example)}</p>
        <p class="card__example-en">${escapeHtml(word.exampleTranslation)}</p>
        ${word.note ? `<p class="card__note">${escapeHtml(word.note)}</p>` : ''}
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
