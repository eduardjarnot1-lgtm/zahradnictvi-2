/**
 * Bootstrap + hash router + event wiring.
 */

import {
  loadVocabulary, getAllWords, getCategory, getSubcategory, getWordType,
  wordsInCategory, wordsInSubcategory, wordsOfType, getWordById, articleLabel,
} from './data.js';
import { initProgress, setStatus, toggleStatus, getStatus, resetAllProgress, STATUS } from './progress.js';
import { searchWords } from './search.js';
import { buildSession, currentQuestion, isFinished, answer, advance } from './practice.js';
import { fukaSays } from './fuka.js';
import { escapeHtml, wordCard } from './ui.js';
import {
  homeView, categoryView, subcategoryView, wordListView, searchResultsView,
  practiceIntroView, practiceQuestionView, practiceSummaryView, practiceEmptyView,
  notFoundView, aboutView,
} from './views.js';

const main = document.getElementById('main');
const searchInput = document.getElementById('search');
let searchDebounce = null;

// --- routing ----------------------------------------------------------------

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path, queryString] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(queryString || '');
  return { parts, params };
}

function render() {
  const { parts, params } = parseRoute();
  const [section, a, b, c] = parts;

  if (searchInput && section !== 'search') searchInput.value = '';

  switch (section) {
    case undefined:
      main.innerHTML = homeView();
      break;
    case 'c':
      if (c) main.innerHTML = wordListView(a, b, c);
      else if (b) main.innerHTML = subcategoryView(a, b);
      else if (a) main.innerHTML = categoryView(a);
      else main.innerHTML = notFoundView();
      break;
    case 'search': {
      const query = params.get('q') || '';
      if (searchInput) searchInput.value = query;
      main.innerHTML = searchResultsView(query, searchWords(query));
      break;
    }
    case 'practice':
      startPractice(a, b, c);
      break;
    case 'about':
      main.innerHTML = aboutView();
      break;
    default:
      main.innerHTML = notFoundView();
  }

  main.scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

// --- practice ---------------------------------------------------------------

let session = null;
let scope = null;

function practiceScope(catId, subId, typeId) {
  if (catId && subId && typeId) {
    const type = getWordType(typeId);
    const sub = getSubcategory(catId, subId);
    if (type && sub) {
      return {
        pool: wordsOfType(catId, subId, typeId),
        label: `${sub.name} · ${type.name}`,
        backHref: `#/c/${catId}/${subId}/${typeId}`,
      };
    }
  }
  if (catId && subId) {
    const sub = getSubcategory(catId, subId);
    if (sub) {
      return { pool: wordsInSubcategory(catId, subId), label: sub.name, backHref: `#/c/${catId}/${subId}` };
    }
  }
  if (catId) {
    const category = getCategory(catId);
    if (category) {
      return { pool: wordsInCategory(catId), label: category.name, backHref: `#/c/${catId}` };
    }
  }
  return { pool: getAllWords(), label: 'All topics', backHref: '#/' };
}

function startPractice(catId, subId, typeId) {
  scope = practiceScope(catId, subId, typeId);
  main.innerHTML = practiceIntroView(scope);
  if (scope.pool.length === 0) {
    document.getElementById('practice').innerHTML = practiceEmptyView(scope);
    return;
  }
  session = buildSession(scope.pool);
  renderQuestion();
}

function renderQuestion() {
  const host = document.getElementById('practice');
  if (!host) return;
  if (isFinished(session)) {
    host.innerHTML = practiceSummaryView(session, scope);
    return;
  }
  host.innerHTML = practiceQuestionView(session, currentQuestion(session));
}

function revealAnswer(question, { correct, headline }) {
  const host = document.getElementById('practice');
  const feedback = host.querySelector('.quiz__feedback');
  host.querySelector('.quiz__controls').innerHTML = '';
  feedback.hidden = false;
  feedback.innerHTML = `
    <p class="quiz__verdict quiz__verdict--${correct ? 'ok' : 'no'}">${headline}</p>
    ${wordCard(question.word, { revealed: true })}
    <div class="quiz__next">
      <button class="cta" type="button" data-action="next">Next word</button>
    </div>`;
}

function handleArticleAnswer(chosen) {
  const question = currentQuestion(session);
  const correct = chosen === question.word.article;
  answer(session, correct);
  setStatus(question.word.id, correct ? STATUS.LEARNED : STATUS.LEARNING);
  revealAnswer(question, {
    correct,
    headline: correct
      ? `✅ ${fukaSays('correct')} ${articleLabel(question.word)} ${escapeHtml(question.word.word)}`
      : `❌ It is <strong>${escapeHtml(question.word.article)} ${escapeHtml(question.word.word)}</strong>. ${fukaSays('wrong')}`,
  });
}

function handleSelfAssessment(knewIt) {
  const question = currentQuestion(session);
  answer(session, knewIt);
  setStatus(question.word.id, knewIt ? STATUS.LEARNED : STATUS.LEARNING);
  advance(session);
  renderQuestion();
}

function showMeaningAnswer() {
  const question = currentQuestion(session);
  const host = document.getElementById('practice');
  host.querySelector('.quiz__controls').innerHTML = '';
  const feedback = host.querySelector('.quiz__feedback');
  feedback.hidden = false;
  feedback.innerHTML = `
    ${wordCard(question.word, { revealed: true })}
    <div class="quiz__next">
      <button class="btn btn--know" type="button" data-action="knew-it">I knew it ✅</button>
      <button class="btn btn--practise" type="button" data-action="practise-it">Practise 🔄</button>
    </div>`;
}

// --- events -----------------------------------------------------------------

function updateCardButtons(cardEl, wordId) {
  const status = getStatus(wordId);
  cardEl.querySelector('[data-action="learned"]').classList.toggle('is-active', status === STATUS.LEARNED);
  cardEl.querySelector('[data-action="learning"]').classList.toggle('is-active', status === STATUS.LEARNING);
}

main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;

  if (button.dataset.article) {
    handleArticleAnswer(button.dataset.article);
    return;
  }

  switch (action) {
    case 'reveal': {
      button.closest('.card').classList.add('is-revealed');
      break;
    }
    case 'reveal-all': {
      const cards = main.querySelectorAll('.card');
      const showAll = button.textContent.startsWith('Show');
      cards.forEach((card) => card.classList.toggle('is-revealed', showAll));
      button.textContent = showAll ? 'Hide all meanings' : 'Show all meanings';
      break;
    }
    case 'learned':
    case 'learning': {
      const card = button.closest('.card');
      const wordId = card.dataset.word;
      toggleStatus(wordId, action === 'learned' ? STATUS.LEARNED : STATUS.LEARNING);
      updateCardButtons(card, wordId);
      card.classList.add('is-revealed');
      break;
    }
    case 'show-answer':
      showMeaningAnswer();
      break;
    case 'knew-it':
      handleSelfAssessment(true);
      break;
    case 'practise-it':
      handleSelfAssessment(false);
      break;
    case 'next':
      advance(session);
      renderQuestion();
      break;
    case 'practice-again':
      startPractice(...parseRoute().parts.slice(1));
      break;
    case 'reset-progress':
      if (window.confirm('Reset the learning status of every word?')) {
        resetAllProgress();
        render();
      }
      break;
    default:
      break;
  }
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const query = searchInput.value.trim();
    searchDebounce = setTimeout(() => {
      window.location.hash = query ? `#/search?q=${encodeURIComponent(query)}` : '#/';
    }, 220);
  });
}

window.addEventListener('hashchange', render);

// --- start ------------------------------------------------------------------

(async function start() {
  try {
    initProgress();
    await loadVocabulary();
    document.body.classList.remove('is-loading');
    render();
  } catch (error) {
    main.innerHTML = `<p class="empty">The vocabulary could not be loaded (${escapeHtml(error.message)}).
      Open the app through a web server rather than from the file system.</p>`;
    document.body.classList.remove('is-loading');
  }
})();

// Exposed for quick debugging in the console; not used by the app itself.
window.fukaGerman = { getWordById, getAllWords };
