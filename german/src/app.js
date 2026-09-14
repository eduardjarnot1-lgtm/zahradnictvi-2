/**
 * Bootstrap + hash router + event wiring.
 */

import {
  loadVocabulary, getAllWords, getCategory, getSubcategory, getWordType,
  wordsInCategory, wordsInSubcategory, wordsOfType, getWordById,
} from './data.js';
import { loadGrammar, getTopic, searchTopics } from './grammar.js';
import { initProgress, setStatus, toggleStatus, getStatus, resetAllProgress, STATUS } from './progress.js';
import { setTargetLevel, getProfile } from './db.js';
import { searchWords } from './search.js';
import { GRADE } from './srs.js';
import { initAudio, speak, listenOnce, listenProblem } from './audio.js';
import { buildLesson, reviewLesson, dueForReview, scopedLesson } from './lessons.js';
import { buildGrammarExercise, grammarExercisesFor, checkAnswer } from './exercises.js';
import {
  createRun, currentItem, submit, advanceRun,
  answerWithText, answerWithOption, renderQuestion, renderFeedback, renderSummary,
} from './runner.js';
import { escapeHtml } from './ui.js';
import {
  vocabIndexView, categoryView, subcategoryView, wordListView, searchResultsView,
  notFoundView, aboutView, coreWordsView,
} from './views.js';
import {
  hubView, progressView, grammarIndexView, grammarTopicView, grammarSearchSection,
  activityView, emptyActivityView,
} from './learnViews.js';

const main = document.getElementById('main');
const searchInput = document.getElementById('search');
let searchDebounce = null;

// The shared runner drives every activity: lessons, review, grammar practice
// and the "Practise these" button on a word list.
let run = null;

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
  run = null;

  switch (section) {
    case undefined:
      main.innerHTML = hubView();
      break;
    case 'vocab':
      main.innerHTML = vocabIndexView();
      break;
    case 'c':
      if (c) main.innerHTML = wordListView(a, b, c);
      else if (b) main.innerHTML = subcategoryView(a, b);
      else if (a) main.innerHTML = categoryView(a);
      else main.innerHTML = notFoundView();
      break;
    case 'grammar':
      if (a && b === 'practice') startGrammarPractice(a);
      else if (a) main.innerHTML = grammarTopicView(a);
      else main.innerHTML = grammarIndexView();
      break;
    case 'learn':
      if (a === 'review') startReview();
      else if (a === 'lesson') startLesson(b || null);
      else main.innerHTML = hubView();
      break;
    case 'progress':
      main.innerHTML = progressView();
      break;
    case 'search': {
      const query = params.get('q') || '';
      if (searchInput) searchInput.value = query;
      main.innerHTML = searchResultsView(query, searchWords(query))
        + (query.trim().length >= 2 ? grammarSearchSection(searchTopics(query)) : '');
      break;
    }
    case 'practice':
      startPractice(a, b, c);
      break;
    case 'core':
      main.innerHTML = coreWordsView();
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

// --- the runner (lessons, review, grammar practice) -------------------------

let restart = null;
let reorderPicks = [];

function mountRun() {
  const host = document.getElementById('practice');
  if (!host || !run) return;
  if (run.finished) {
    host.innerHTML = renderSummary(run);
    return;
  }
  reorderPicks = [];
  host.innerHTML = renderQuestion(run);
  const input = host.querySelector('.quiz__input');
  if (input) input.focus();
}

function showFeedback(verdict, options = {}) {
  const host = document.getElementById('practice');
  const controls = host.querySelector('.quiz__controls');
  const feedback = host.querySelector('.quiz__feedback');
  if (!feedback) return;
  if (controls) controls.innerHTML = '';
  feedback.hidden = false;
  feedback.innerHTML = renderFeedback(run, verdict, options);
}

function startLesson(scope) {
  const lesson = buildLesson({ scope: scope || null });
  const category = scope ? getCategory(scope) : null;
  const label = category ? category.name : 'All topics';
  main.innerHTML = activityView({
    title: 'Lesson', emoji: '🎓',
    meta: `${label} · ${lesson.composition.new} new · ${lesson.composition.review} review · ${lesson.composition.grammar} grammar`,
    backHref: '#/', backLabel: 'German Learning',
  });
  if (lesson.items.length === 0) {
    document.getElementById('practice').innerHTML =
      emptyActivityView('There is nothing to put in a lesson here yet.', '#/');
    return;
  }
  run = createRun(lesson, { title: 'Lesson', backHref: '#/' });
  restart = () => startLesson(scope);
  mountRun();
}

function startReview() {
  const due = dueForReview();
  main.innerHTML = activityView({
    title: 'Review', emoji: '🔄',
    meta: due.length ? `${due.length} word${due.length === 1 ? '' : 's'} ready for review` : 'Nothing is due',
    backHref: '#/', backLabel: 'German Learning',
  });
  if (due.length === 0) {
    document.getElementById('practice').innerHTML = emptyActivityView(
      'Nothing is due for review right now — that is a good sign. New words become due after you have met them in a lesson.',
      '#/learn/lesson');
    return;
  }
  run = createRun(reviewLesson(), { title: 'Review', backHref: '#/' });
  restart = startReview;
  mountRun();
}

function startGrammarPractice(topicId) {
  const topic = getTopic(topicId);
  if (!topic) {
    main.innerHTML = notFoundView();
    return;
  }
  main.innerHTML = activityView({
    title: topic.title, emoji: '🧠',
    meta: `${topic.exercises.length} exercises available · ${topic.source}, p. ${topic.sourcePage}`,
    backHref: `#/grammar/${topic.id}`, backLabel: 'Grammar',
  });
  const items = grammarExercisesFor(topic, Math.min(6, topic.exercises.length));
  run = createRun(
    { id: `grammar-${topic.id}-${Date.now().toString(36)}`, startedAt: Date.now(), items,
      composition: { new: 0, review: 0, filler: 0, grammar: items.length } },
    { title: `Grammar: ${topic.title}`, backHref: `#/grammar/${topic.id}` },
  );
  restart = () => startGrammarPractice(topicId);
  mountRun();
}

// --- practising one word list -----------------------------------------------

function practiceScope(catId, subId, typeId) {
  if (catId && subId && typeId) {
    const type = getWordType(typeId);
    const sub = getSubcategory(catId, subId);
    if (type && sub) {
      return { pool: wordsOfType(catId, subId, typeId), label: `${sub.name} · ${type.name}`,
        backHref: `#/c/${catId}/${subId}/${typeId}` };
    }
  }
  if (catId && subId) {
    const sub = getSubcategory(catId, subId);
    if (sub) return { pool: wordsInSubcategory(catId, subId), label: sub.name, backHref: `#/c/${catId}/${subId}` };
  }
  if (catId) {
    const category = getCategory(catId);
    if (category) return { pool: wordsInCategory(catId), label: category.name, backHref: `#/c/${catId}` };
  }
  return { pool: getAllWords(), label: 'All topics', backHref: '#/vocab' };
}

function startPractice(catId, subId, typeId) {
  const scope = practiceScope(catId, subId, typeId);
  main.innerHTML = activityView({
    title: 'Practice', emoji: '🔄',
    meta: `${scope.label} · ${scope.pool.length} words available`,
    backHref: scope.backHref, backLabel: 'Vocabulary',
  });
  if (scope.pool.length === 0) {
    document.getElementById('practice').innerHTML =
      emptyActivityView('There are no words to practise here.', scope.backHref);
    return;
  }
  run = createRun(scopedLesson(scope.pool), { title: 'Practice', backHref: scope.backHref });
  restart = () => startPractice(catId, subId, typeId);
  mountRun();
}

// --- events -----------------------------------------------------------------

function updateCardButtons(cardEl, wordId) {
  const status = getStatus(wordId);
  cardEl.querySelector('[data-action="learned"]').classList.toggle('is-active', status === STATUS.LEARNED);
  cardEl.querySelector('[data-action="learning"]').classList.toggle('is-active', status === STATUS.LEARNING);
}

function renderReorderLine() {
  const line = main.querySelector('[data-role="reorder-line"]');
  if (!line) return;
  const item = currentItem(run);
  line.textContent = reorderPicks.map((index) => item.tokens[index]).join(' ');
}

/**
 * Record one spoken answer and score the transcript.
 *
 * The button is disabled while the microphone is open so a second click cannot
 * start an overlapping recognition session, and a failure — no microphone, a
 * refused permission, silence — reports itself in the panel and leaves the
 * question unanswered rather than marking it wrong.
 */
async function recordSpokenAnswer(button) {
  const state = main.querySelector('[data-role="speech-state"]');
  const say = (message) => { if (state) state.textContent = message; };
  button.disabled = true;
  say('Listening…');

  const heard = await listenOnce();
  button.disabled = false;

  if (!heard.ok) {
    say(listenProblem(heard.reason));
    return;
  }
  say(`Heard: “${heard.transcript}”`);
  const item = currentItem(run);
  const spoken = (heard.alternatives || [heard.transcript])
    .find((alternative) => checkAnswer(alternative, item.answers).correct) || heard.transcript;
  showFeedback(answerWithText(run, spoken));
}

main.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-action="answer-form"]');
  if (!form || !run) return;
  event.preventDefault();
  const value = form.querySelector('input[name="answer"]').value;
  if (!value.trim()) return;
  showFeedback(answerWithText(run, value));
});

main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;

  // Speaker buttons appear on cards, in questions and in feedback; they are
  // never part of an answer, so they are handled before anything else and do
  // not fall through to the runner.
  if (action === 'speak') {
    speak(button.dataset.speak);
    return;
  }

  // the shared runner
  if (run && button.dataset.option !== undefined) {
    showFeedback(answerWithOption(run, button.dataset.option));
    return;
  }
  if (run && button.dataset.token !== undefined) {
    reorderPicks.push(Number(button.dataset.token));
    button.disabled = true;
    renderReorderLine();
    return;
  }
  if (run && action === 'reorder-undo') {
    const last = reorderPicks.pop();
    if (last !== undefined) {
      const token = main.querySelector(`[data-token="${last}"]`);
      if (token) token.disabled = false;
    }
    renderReorderLine();
    return;
  }
  if (run && action === 'reorder-check') {
    const item = currentItem(run);
    showFeedback(answerWithText(run, reorderPicks.map((i) => item.tokens[i]).join(' ')));
    return;
  }
  if (run && action === 'record') {
    recordSpokenAnswer(button);
    return;
  }
  if (run && action === 'skip-speech') {
    showFeedback(answerWithText(run, ''));
    return;
  }
  if (run && action === 'show-answer') {
    showFeedback({ correct: false, close: false, matched: '' }, { selfAssess: true });
    return;
  }
  if (run && (action === 'knew-it' || action === 'practise-it')) {
    submit(run, action === 'knew-it', '', action === 'knew-it' ? GRADE.GOOD : GRADE.AGAIN);
    advanceRun(run);
    mountRun();
    return;
  }
  if (run && action === 'next') {
    advanceRun(run);
    mountRun();
    return;
  }
  if (run && action === 'run-again') {
    if (restart) restart();
    return;
  }

  switch (action) {
    case 'set-level':
      setTargetLevel(button.dataset.level);
      render();
      break;
    case 'reveal':
      button.closest('.card').classList.add('is-revealed');
      break;
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
      if (!card) break;
      const wordId = card.dataset.word;
      toggleStatus(wordId, action === 'learned' ? STATUS.LEARNED : STATUS.LEARNING);
      updateCardButtons(card, wordId);
      card.classList.add('is-revealed');
      break;
    }
    case 'reset-progress':
      if (window.confirm('Reset the learning status of every word and all grammar progress?')) {
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
    // Voice lists load asynchronously; ask for them before the first render so
    // that speaker buttons are available on the very first screen.
    initAudio();
    await Promise.all([loadVocabulary(), loadGrammar()]);
    document.body.classList.remove('is-loading');
    render();
  } catch (error) {
    main.innerHTML = `<p class="empty">The content could not be loaded (${escapeHtml(error.message)}).
      Open the app through a web server rather than from the file system.</p>`;
    document.body.classList.remove('is-loading');
  }
})();

// Exposed for quick debugging in the console; not used by the app itself.
window.fukaGerman = { getWordById, getAllWords, getTopic, getProfile, buildLesson, buildGrammarExercise };
