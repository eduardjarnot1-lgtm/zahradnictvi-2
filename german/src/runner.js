/**
 * The exercise runner.
 *
 * One state machine drives every activity in the app — a personalised lesson,
 * a review round and a grammar practice round all produce the same shape of
 * item, so they all run through here. An item is:
 *
 *   { mode, prompt, text, options?, tokens?, answers, hint?, explain?,
 *     itemKind: 'vocab' | 'grammar', itemId, exerciseId? }
 *
 * mode is one of:
 *   options  — pick one of several buttons
 *   typing   — type the answer; checked leniently by exercises.js
 *   reorder  — click the words into the right order
 *   reveal   — look, then say whether you knew it
 *   speech   — say it out loud; the browser transcribes and it is scored
 *
 * An item may also carry `speak`: German the learner can play back. Items with
 * a `speak` and no `text` are dictation — the sentence exists only as audio.
 */

import { escapeHtml, speakButton } from './ui.js';
import { checkAnswer } from './exercises.js';
import { recordAnswer } from './progress.js';
import { grammarProgress, putGrammarProgress, logEvent, recordActivity, saveSession } from './db.js';
import { reviewTopic, GRADE } from './srs.js';
import { displayForm } from './data.js';

export function createRun(lesson, { title, backHref }) {
  return {
    lesson,
    title,
    backHref,
    position: 0,
    correct: 0,
    answered: [],
    grammarTally: new Map(),
    finished: lesson.items.length === 0,
  };
}

export const currentItem = (run) => run.lesson.items[run.position] || null;

// --- scoring ----------------------------------------------------------------

function tallyGrammar(run, topicId, correct) {
  const entry = run.grammarTally.get(topicId) || { correct: 0, total: 0 };
  entry.total += 1;
  if (correct) entry.correct += 1;
  run.grammarTally.set(topicId, entry);
}

/**
 * Turn what we know about an answer into an FSRS grade.
 *
 * The app never asks the learner to rate their own recall, so the grade is
 * inferred from the answer itself:
 *
 *   Again (1)  wrong
 *   Hard (2)   a near miss — right word, one typo, by edit distance
 *   Good (3)   correct
 *   Easy (4)   correct, produced by typing German, with no hint on screen
 *
 * Easy is reserved for production because recognising the right button is
 * weaker evidence than writing the word out unaided, and the scheduler should
 * not treat them as the same event.
 */
export function gradeFor(item, verdict) {
  if (!verdict.correct) return verdict.close ? GRADE.HARD : GRADE.AGAIN;
  const produced = item.mode === 'typing' || item.mode === 'speech';
  const unaided = !item.hint;
  return produced && unaided && item.producesGerman ? GRADE.EASY : GRADE.GOOD;
}

/** Record an answer against the learner's progress and move the score on. */
export function submit(run, correct, given = '', grade = 0) {
  const item = currentItem(run);
  if (!item || item.done) return item;
  item.done = true;
  item.wasCorrect = correct;
  if (correct) run.correct += 1;
  run.answered.push({ itemId: item.itemId, kind: item.itemKind, correct });

  if (item.itemKind === 'vocab') {
    recordAnswer(item.itemId, correct, { given, expected: item.answers[0] || '', grade });
  } else {
    tallyGrammar(run, item.itemId, correct);
    logEvent({
      kind: 'answer', itemKind: 'grammar', itemId: item.itemId,
      exerciseId: item.exerciseId, correct, given, expected: item.answers[0] || '',
    });
    recordActivity(correct ? 10 : 2);
  }
  return item;
}

export function advanceRun(run) {
  run.position += 1;
  if (run.position >= run.lesson.items.length) finish(run);
  return currentItem(run);
}

function finish(run) {
  if (run.finished) return;
  run.finished = true;
  for (const [topicId, tally] of run.grammarTally) {
    putGrammarProgress(reviewTopic(grammarProgress(topicId), tally.correct, tally.total));
  }
  saveSession({
    id: run.lesson.id,
    startedAt: run.lesson.startedAt,
    finishedAt: Date.now(),
    kind: run.title,
    items: run.lesson.items.length,
    correct: run.correct,
    total: run.lesson.items.length,
  });
}

// --- answer handling --------------------------------------------------------

export function answerWithText(run, text) {
  const item = currentItem(run);
  const verdict = checkAnswer(text, item.answers);
  submit(run, verdict.correct, text, gradeFor(item, verdict));
  return verdict;
}

export function answerWithOption(run, option) {
  const item = currentItem(run);
  const correct = item.answers.some((answer) => answer === option);
  const verdict = { correct, close: false, matched: item.answers[0] || '' };
  submit(run, correct, option, gradeFor(item, verdict));
  return verdict;
}

// --- rendering --------------------------------------------------------------

function controls(item) {
  switch (item.mode) {
    case 'options':
      return `<div class="quiz__articles">${item.options
        .map((option) => `<button class="btn btn--option" type="button" data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`)
        .join('')}</div>`;

    case 'typing':
      return `
        <form class="quiz__form" data-action="answer-form">
          <input class="quiz__input" type="text" name="answer" autocomplete="off"
                 autocapitalize="off" spellcheck="false" placeholder="Your answer…"
                 aria-label="Your answer">
          <button class="cta" type="submit">Check</button>
        </form>
        ${item.hint ? `<p class="quiz__hint">Hint: ${escapeHtml(item.hint)}</p>` : ''}`;

    case 'reorder':
      return `
        <div class="reorder">
          <div class="reorder__line" data-role="reorder-line" aria-live="polite"></div>
          <div class="reorder__bank">${item.tokens
            .map((token, index) => `<button class="btn btn--token" type="button" data-token="${index}">${escapeHtml(token)}</button>`)
            .join('')}</div>
          <div class="reorder__actions">
            <button class="btn btn--ghost" type="button" data-action="reorder-undo">Undo</button>
            <button class="cta" type="button" data-action="reorder-check">Check</button>
          </div>
        </div>`;

    case 'speech':
      return `
        <div class="speech">
          <button class="cta" type="button" data-action="record">🎙️ Record</button>
          <p class="speech__state" data-role="speech-state" aria-live="polite"></p>
          <button class="btn btn--ghost" type="button" data-action="skip-speech">Skip</button>
        </div>`;

    case 'reveal':
    default:
      return `<button class="btn btn--ghost" type="button" data-action="show-answer">Show the answer</button>`;
  }
}

export function renderQuestion(run) {
  const item = currentItem(run);
  if (!item) return '';
  const number = run.position + 1;
  const total = run.lesson.items.length;
  const badge = item.itemKind === 'grammar'
    ? `<span class="quiz__badge quiz__badge--grammar">Grammar · ${escapeHtml(item.topic.title)}</span>`
    : `<span class="quiz__badge">Vocabulary</span>`;

  return `
    <div class="quiz">
      <div class="quiz__top">
        <p class="quiz__count">Question ${number} of ${total}</p>
        ${badge}
      </div>
      <div class="quiz__progress"><span style="width:${Math.round((run.position / total) * 100)}%"></span></div>
      <p class="quiz__ask">${escapeHtml(item.prompt)}</p>
      ${item.text ? `<p class="quiz__word">${escapeHtml(item.text)}</p>` : ''}
      ${item.speak ? `<p class="quiz__audio">${speakButton(item.speak, { label: 'Play the German' })}
        <span class="quiz__audio-label">Play${item.text ? ' it' : ' — then type what you hear'}</span></p>` : ''}
      <div class="quiz__controls">${controls(item)}</div>
      <div class="quiz__feedback" hidden></div>
    </div>`;
}

/** The panel shown after an answer, including the correct answer and why. */
export function renderFeedback(run, verdict, { selfAssess = false } = {}) {
  const item = currentItem(run);
  const word = item.itemKind === 'vocab' ? item.word : null;
  const expected = item.answers[0] || '';

  const verdictLine = selfAssess
    ? ''
    : verdict.correct
      ? `<p class="quiz__verdict quiz__verdict--ok">✅ Correct</p>`
      : verdict.close
        ? `<p class="quiz__verdict quiz__verdict--close">Almost — the expected answer is <strong>${escapeHtml(expected)}</strong></p>`
        : `<p class="quiz__verdict quiz__verdict--no">❌ The answer is <strong>${escapeHtml(expected)}</strong></p>`;

  const detail = word
    ? `<div class="answer-card">
         <p class="answer-card__term">${escapeHtml(displayForm(word))}
           ${speakButton(displayForm(word), { label: 'Hear the word', small: true })}</p>
         <p class="answer-card__translation">${escapeHtml(word.translation)}</p>
         ${word.example ? `<p class="answer-card__example">${escapeHtml(word.example)}
           ${speakButton(word.example, { label: 'Hear the sentence', small: true })}</p>
           <p class="answer-card__example-en">${escapeHtml(word.exampleTranslation)}</p>` : ''}
         ${word.note ? `<p class="answer-card__note">${escapeHtml(word.note)}</p>` : ''}
       </div>`
    : `<div class="answer-card">
         <p class="answer-card__term">${escapeHtml(expected)}</p>
         ${item.explain ? `<p class="answer-card__translation">${escapeHtml(item.explain)}</p>` : ''}
         <p class="answer-card__source">${escapeHtml(item.topic.title)} · ${escapeHtml(item.topic.source)}, p.&nbsp;${item.topic.sourcePage}${item.fromSource ? ' · example from the source' : ''}</p>
       </div>`;

  const actions = selfAssess
    ? `<button class="btn btn--know" type="button" data-action="knew-it">I knew it ✅</button>
       <button class="btn btn--practise" type="button" data-action="practise-it">Practise 🔄</button>`
    : `<button class="cta" type="button" data-action="next">${run.position + 1 >= run.lesson.items.length ? 'Finish' : 'Next'}</button>`;

  return `${verdictLine}${detail}${word && item.explain && !word.example ? `<p class="quiz__explain">${escapeHtml(item.explain)}</p>` : ''}
    ${!word && item.explain ? '' : ''}
    <div class="quiz__next">${actions}</div>`;
}

export function renderSummary(run) {
  const total = run.lesson.items.length;
  const percent = total ? Math.round((run.correct / total) * 100) : 0;
  const composition = run.lesson.composition || {};
  const parts = [];
  if (composition.new) parts.push(`${composition.new} new`);
  if (composition.review) parts.push(`${composition.review} review`);
  if (composition.grammar) parts.push(`${composition.grammar} grammar`);

  return `
    <div class="summary">
      <p class="summary__score">${run.correct} / ${total}</p>
      <p class="summary__text">${percent}% correct${parts.length ? ` · ${parts.join(' · ')}` : ''}.
        Your answers have been saved to your progress.</p>
      <div class="summary__actions">
        <button class="cta" type="button" data-action="run-again">Another round</button>
        <a class="btn btn--ghost" href="${run.backHref}">Back</a>
        <a class="btn btn--ghost" href="#/progress">See progress</a>
      </div>
    </div>`;
}
