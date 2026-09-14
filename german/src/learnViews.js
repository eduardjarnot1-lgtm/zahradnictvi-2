/**
 * Screens for the German Learning section: the hub, progress, the level
 * picker, and the grammar screens. The lesson and practice screens are hosted
 * here but driven by runner.js.
 */

import { getAllWords, getCategories, wordsInCategory } from './data.js';
import { getTopics, getTopic, getGrammarLevels, groupsAtLevel, topicsAtLevel, getGrammarMeta } from './grammar.js';
import { summarise, countDue } from './progress.js';
import { getProfile, setTargetLevel, LEVELS, grammarProgress, recentSessions, storageAvailable } from './db.js';
import { recommendations, problemWords, recentMistakes, snapshot } from './coach.js';
import { crumbs, escapeHtml, progressRing, progressBar, percent, circleButton } from './ui.js';
import { fukaBubble } from './fuka.js';

// --- hub --------------------------------------------------------------------

export function hubView() {
  const profile = getProfile();
  const words = getAllWords();
  const vocabStats = summarise(words);
  const topics = getTopics();
  const data = snapshot();
  const { recommendations: tips } = recommendations();
  const due = countDue();

  const grammarStats = {
    total: topics.length,
    learned: data.grammar.mastered,
    learning: Math.max(0, data.grammar.practised - data.grammar.mastered),
    new: topics.length - data.grammar.practised,
  };

  const tiles = [
    circleButton({ href: '#/vocab', emoji: '🧩', title: 'Vocabulary', stats: vocabStats }),
    circleButton({ href: '#/grammar', emoji: '🧠', title: 'Grammar', stats: grammarStats }),
    circleButton({
      href: '#/learn/review', emoji: '🔄', title: 'Review',
      stats: { total: Math.max(due, 1), learned: 0, learning: due, new: 0 },
      subtitle: due ? `${due} due now` : 'nothing due',
    }),
    circleButton({
      href: '#/progress', emoji: '📈', title: 'Progress',
      stats: vocabStats, subtitle: `${profile.xp} XP · ${profile.streakDays}-day streak`,
    }),
  ].join('');

  return `
    ${fukaBubble('home', tips[0] ? escapeHtml(tips[0].headline) : null)}

    <section class="hub-start">
      <div class="hub-start__text">
        <h1>German Learning</h1>
        <p class="hub-start__meta">Target level <strong>${escapeHtml(profile.targetLevel)}</strong>
          · ${vocabStats.learned} of ${vocabStats.total} words learned
          · ${data.grammar.practised} of ${topics.length} grammar topics started</p>
      </div>
      <a class="cta cta--big" href="#/learn/lesson">Start a lesson</a>
    </section>

    ${tips.length ? `
      <section class="coach">
        <h2 class="coach__title">Learning Coach</h2>
        <ul class="coach__list">
          ${tips.map((tip) => `
            <li class="coach__item coach__item--${tip.tone}">
              <p class="coach__headline">${escapeHtml(tip.headline)}</p>
              <p class="coach__detail">${escapeHtml(tip.detail)}</p>
              ${tip.action ? `<a class="btn btn--ghost" href="${tip.action.href}">${escapeHtml(tip.action.label)}</a>` : ''}
            </li>`).join('')}
        </ul>
        <p class="coach__note">Every line above is counted from your own saved answers.</p>
      </section>` : ''}

    <h2 class="section-title">Sections</h2>
    <div class="circles">${tiles}</div>

    ${levelPicker(profile)}
    ${storageAvailable() ? '' : '<p class="warn">This browser is blocking local storage, so progress will not be kept after you close the page.</p>'}`;
}

/** What each level actually holds, counted from the databases. */
function levelContents() {
  const contents = Object.fromEntries(LEVELS.map((level) => [level, []]));
  // Count the sourced levels apart from the approximated ones, so the picker
  // does not present a word list's statement and a tier mapping as the same
  // kind of fact.
  const sourced = new Map();
  const approximated = new Map();
  for (const word of getAllWords()) {
    if (!word.cefr) continue;
    const bucket = word.cefrSource === 'tier-approximation' ? approximated : sourced;
    bucket.set(word.cefr, (bucket.get(word.cefr) || 0) + 1);
  }
  for (const level of LEVELS) {
    if (!contents[level]) continue;
    const exact = sourced.get(level) || 0;
    const approximate = approximated.get(level) || 0;
    if (exact) contents[level].push(`${exact} words`);
    if (approximate) contents[level].push(`${approximate} approx.`);
  }
  for (const entry of getGrammarLevels()) {
    if (contents[entry.level]) contents[entry.level].push(`${entry.topicCount} grammar topics`);
  }
  return contents;
}

function levelPicker(profile) {
  const contents = levelContents();
  return `
    <section class="levels">
      <h2 class="section-title">Target level</h2>
      <div class="levels__row">
        ${LEVELS.map((level) => `
          <button class="level${level === profile.targetLevel ? ' is-active' : ''}"
                  type="button" data-action="set-level" data-level="${level}">
            <span class="level__name">${level}</span>
            <span class="level__state">${contents[level].length
              ? escapeHtml(contents[level].join(' · ')) : 'no content yet'}</span>
          </button>`).join('')}
      </div>
      <p class="levels__note">Levels are the sources' own, not guesses. Grammar comes from DaF kompakt
        neu, which prints an A1/A2/B1 level beside every block, and the Sicher!&nbsp;C1
        Grammatikübersicht. Vocabulary levels come from the official Goethe-Institut word lists for
        A1, A2 and B1 and from the Lingster Academy A1–B2 list, which is the only one of them that
        reaches B2. Cards no list carries keep the GCSE document's Foundation/Higher tier
        approximation and are labelled as approximate. C2 is part of the structure and holds no
        content; the app does not claim an A1–C2 curriculum.</p>
    </section>`;
}

// --- progress ---------------------------------------------------------------

export function progressView() {
  const data = snapshot();
  const words = getAllWords();
  const overall = summarise(words);
  const profile = data.profile;
  const problems = problemWords(6);
  const mistakes = recentMistakes(6);
  const sessions = recentSessions(8);

  const categoryRows = getCategories().map((category) => {
    const stats = summarise(wordsInCategory(category.id));
    return `
      <tr>
        <th scope="row">${category.emoji} ${escapeHtml(category.name)}</th>
        <td class="num">${stats.learned} / ${stats.total}</td>
        <td class="num">${stats.learning}</td>
        <td class="num">${stats.due}</td>
        <td class="barcell">${progressBar(stats)}</td>
      </tr>`;
  }).join('');

  const grammarRows = data.topicStats
    .filter((entry) => entry.attempts > 0)
    .sort((a, b) => a.record.masteryScore - b.record.masteryScore)
    .slice(0, 10)
    .map((entry) => `
      <tr>
        <th scope="row"><a href="#/grammar/${entry.topic.id}">${escapeHtml(entry.topic.title)}</a></th>
        <td class="num">${entry.record.correctCount} / ${entry.attempts}</td>
        <td class="num">${Math.round(entry.record.masteryScore * 100)}%</td>
      </tr>`).join('');

  return `
    ${crumbs([{ label: 'German Learning', href: '#/' }, { label: 'Progress' }])}
    <header class="page-head">
      <h1>📈 Progress</h1>
      <p class="page-head__meta">Everything here is counted from your saved answers.</p>
    </header>

    <section class="stat-row">
      <div class="stat">
        <div class="stat__ring">${progressRing(overall, 108)}<span class="stat__percent">${percent(overall.learned, overall.total)}%</span></div>
        <p class="stat__label">Vocabulary learned</p>
        <p class="stat__value">${overall.learned} / ${overall.total}
          ${overall.learning ? `· ${overall.learning} in progress` : ''}</p>
      </div>
      <div class="stat">
        <p class="stat__big">${data.grammar.mastered}</p>
        <p class="stat__label">Grammar topics at 70%+ mastery</p>
        <p class="stat__value">${data.grammar.practised} of ${data.grammar.total} started</p>
      </div>
      <div class="stat">
        <p class="stat__big">${profile.streakDays}</p>
        <p class="stat__label">Day streak</p>
        <p class="stat__value">${profile.xp} XP</p>
      </div>
      <div class="stat">
        <p class="stat__big">${overall.due}</p>
        <p class="stat__label">Words due for review</p>
        <p class="stat__value"><a href="#/learn/review">Review now</a></p>
      </div>
    </section>

    <h2 class="section-title">By topic</h2>
    <div class="tablewrap">
      <table class="table">
        <thead><tr><th>Topic</th><th class="num">Learned</th><th class="num">Practising</th><th class="num">Due</th><th></th></tr></thead>
        <tbody>${categoryRows}</tbody>
      </table>
    </div>

    <h2 class="section-title">Grammar topics practised</h2>
    ${grammarRows ? `<div class="tablewrap"><table class="table">
      <thead><tr><th>Topic</th><th class="num">Correct</th><th class="num">Mastery</th></tr></thead>
      <tbody>${grammarRows}</tbody></table></div>`
      : '<p class="empty">No grammar practised yet. <a href="#/grammar">Open the grammar section</a>.</p>'}

    <h2 class="section-title">Words that need work</h2>
    ${problems.length ? `<ul class="problems">
      ${problems.map((p) => `<li><strong>${escapeHtml(p.display)}</strong> — ${escapeHtml(p.word.translation)}
        <span class="problems__count">${p.wrong} wrong / ${p.right} right</span></li>`).join('')}
    </ul>` : '<p class="empty">Nothing is going badly — there are no repeated mistakes recorded.</p>'}

    ${mistakes.length ? `<h2 class="section-title">Recent mistakes</h2>
      <ul class="problems">
        ${mistakes.map((m) => `<li><strong>${escapeHtml(m.label)}</strong>
          ${m.given ? `<span class="problems__count">you wrote “${escapeHtml(m.given)}”, expected “${escapeHtml(m.expected)}”</span>` : ''}</li>`).join('')}
      </ul>` : ''}

    ${sessions.length ? `<h2 class="section-title">Recent sessions</h2>
      <ul class="problems">
        ${sessions.map((s) => `<li><strong>${escapeHtml(s.kind || 'Lesson')}</strong>
          <span class="problems__count">${s.correct} / ${s.total} correct</span></li>`).join('')}
      </ul>` : ''}`;
}

// --- grammar ----------------------------------------------------------------

export function grammarIndexView() {
  const meta = getGrammarMeta();
  const profile = getProfile();
  const data = snapshot();
  const started = data.grammar.practised;

  const weak = data.topicStats
    .filter((entry) => entry.attempts >= 2 && entry.record.masteryScore < 0.5)
    .sort((a, b) => a.record.masteryScore - b.record.masteryScore)
    .slice(0, 3);

  const topicCard = (topic) => {
    const record = grammarProgress(topic.id);
    const attempts = record.correctCount + record.incorrectCount;
    const mastery = Math.round(record.masteryScore * 100);
    return `
      <a class="topic" href="#/grammar/${topic.id}">
        <span class="topic__head">
          <span class="topic__title">${escapeHtml(topic.title)}</span>
          <span class="topic__diff" title="Difficulty ${topic.difficulty} of 5">${'●'.repeat(topic.difficulty)}${'○'.repeat(5 - topic.difficulty)}</span>
        </span>
        <span class="topic__en">${escapeHtml(topic.titleEn)}</span>
        <span class="topic__meta">
          <span class="tag">${escapeHtml(topic.category)}</span>
          ${attempts ? `<span class="topic__mastery${mastery >= 70 ? ' is-good' : mastery < 50 ? ' is-weak' : ''}">${mastery}% mastery</span>`
            : `<span class="topic__mastery is-new">not started</span>`}
          <span class="topic__count">${topic.exercises.length} exercises</span>
        </span>
      </a>`;
  };

  const levels = getGrammarLevels();
  const rail = levels.map((entry) => `
    <a class="level-chip${entry.level === profile.targetLevel ? ' is-active' : ''}" href="#level-${entry.level}">
      ${entry.level}<span class="level-chip__count">${entry.topicCount}</span></a>`).join('');

  const blocks = levels.map((entry) => {
    const topics = topicsAtLevel(entry.level);
    const practised = topics.filter((topic) => {
      const record = grammarProgress(topic.id);
      return record.correctCount + record.incorrectCount > 0;
    }).length;
    const groups = groupsAtLevel(entry.level).map((group) => `
      <section class="lektion">
        <h3 class="lektion__title">${escapeHtml(group.name)}</h3>
        <div class="topics">${group.topics.map(topicCard).join('')}</div>
      </section>`).join('');
    return `
      <section class="level-block" id="level-${entry.level}">
        <h2 class="section-title">${entry.level}
          ${entry.level === profile.targetLevel ? '<span class="tag">your target level</span>' : ''}
          <span class="muted">${entry.topicCount} topics · ${practised} started</span></h2>
        <p class="level-block__source">${entry.sources.map(escapeHtml).join(' · ')}</p>
        ${groups}
      </section>`;
  }).join('');

  return `
    ${crumbs([{ label: 'German Learning', href: '#/' }, { label: 'Grammar' }])}
    ${fukaBubble('subcategory', 'Grammar from A1 to C1 — pick a topic, read the rules, then practise.')}
    <header class="page-head">
      <h1>🧠 Grammar</h1>
      <p class="page-head__meta">${meta.topicCount} topics · ${meta.exerciseCount} exercises ·
        ${started} started</p>
      <p class="page-head__source">Sources: ${meta.sources.map((source) =>
        `${escapeHtml(source.title)} (${source.topicCount})`).join(' · ')}</p>
    </header>

    <nav class="level-rail" aria-label="Grammar levels">${rail}</nav>

    ${weak.length ? `<section class="weakspots">
      <h2 class="section-title">Your weak areas</h2>
      <div class="topics">
        ${weak.map((entry) => `<a class="topic topic--weak" href="#/grammar/${entry.topic.id}/practice">
          <span class="topic__title">${escapeHtml(entry.topic.title)}</span>
          <span class="topic__meta"><span class="topic__mastery is-weak">${Math.round(entry.record.masteryScore * 100)}% mastery</span>
          <span class="topic__count">${entry.record.correctCount} of ${entry.attempts} correct</span></span>
        </a>`).join('')}
      </div>
    </section>` : ''}

    ${blocks}`;
}

export function grammarTopicView(topicId) {
  const topic = getTopic(topicId);
  if (!topic) return `<p class="empty">No such grammar topic. <a href="#/grammar">Back to grammar</a>.</p>`;
  const record = grammarProgress(topic.id);
  const attempts = record.correctCount + record.incorrectCount;
  const prerequisites = topic.prerequisites.map((id) => getTopic(id)).filter(Boolean);

  return `
    ${crumbs([
      { label: 'German Learning', href: '#/' },
      { label: 'Grammar', href: '#/grammar' },
      { label: topic.title },
    ])}
    <header class="page-head">
      <h1>${escapeHtml(topic.title)}</h1>
      <p class="page-head__meta">${escapeHtml(topic.titleEn)}</p>
      <p class="topic__meta">
        <span class="tag tag--level">${escapeHtml(topic.level)}</span>
        <span class="tag">${escapeHtml(topic.category)}</span>
        ${topic.tags.map((tag) => `<span class="tag tag--soft">${escapeHtml(tag)}</span>`).join('')}
        <span class="topic__diff">Difficulty ${topic.difficulty}/5</span>
        ${attempts ? `<span class="topic__mastery">${Math.round(record.masteryScore * 100)}% mastery · ${record.correctCount}/${attempts} correct</span>` : ''}
      </p>
      ${prerequisites.length ? `<p class="page-head__source">Builds on:
        ${prerequisites.map((p) => `<a href="#/grammar/${p.id}">${escapeHtml(p.title)}</a>`).join(', ')}</p>` : ''}
      <div class="page-head__tools">
        <a class="cta" href="#/grammar/${topic.id}/practice">Practise this topic</a>
      </div>
    </header>

    <p class="lead">${escapeHtml(topic.summary)}</p>

    ${topic.explanation.map((block) => `
      <section class="explain">
        <h2>${escapeHtml(block.heading)}</h2>
        <p>${escapeHtml(block.text)}</p>
      </section>`).join('')}

    <section class="explain">
      <h2>Rules</h2>
      <ul class="rules">${topic.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>
    </section>

    <section class="explain">
      <h2>Examples from the source</h2>
      <ul class="examples">
        ${topic.examples.map((example) => `
          <li>
            <p class="examples__de">${escapeHtml(example.de)}</p>
            ${example.note ? `<p class="examples__note">${escapeHtml(example.note)}</p>` : ''}
          </li>`).join('')}
      </ul>
    </section>

    ${topic.subtopics.length ? `<section class="explain">
      <h2>In the source</h2>
      <ul class="rules">${topic.subtopics.map((sub) =>
        `<li><strong>${escapeHtml(sub.letter)}</strong> ${escapeHtml(sub.title)}${sub.kursbuch ? ` <span class="muted">(${escapeHtml(sub.kursbuch)})</span>` : ''}</li>`).join('')}</ul>
    </section>` : ''}

    <p class="source-line">${escapeHtml(topic.source)}, p.&nbsp;${topic.sourcePage} ·
      ${escapeHtml(topic.group)}${topic.subsection ? ` · ${escapeHtml(topic.subsection)}` : ''}${topic.kursbuch ? ` · Kursbuch ${escapeHtml(topic.kursbuch)}` : ''}</p>`;
}

export function grammarSearchSection(topics) {
  if (!topics.length) return '';
  return `
    <h2 class="section-title">Grammar topics</h2>
    <div class="topics">
      ${topics.map((topic) => `
        <a class="topic" href="#/grammar/${topic.id}">
          <span class="topic__title">${escapeHtml(topic.title)}</span>
          <span class="topic__en">${escapeHtml(topic.titleEn)}</span>
          <span class="topic__meta"><span class="tag">${escapeHtml(topic.category)}</span>
            <span class="topic__count">${escapeHtml(topic.level)} · ${escapeHtml(topic.group)}</span></span>
        </a>`).join('')}
    </div>`;
}

// --- activity shells --------------------------------------------------------

export function activityView({ title, emoji, meta, backHref, backLabel }) {
  return `
    ${crumbs([{ label: 'German Learning', href: '#/' }, { label: backLabel, href: backHref }, { label: title }])}
    <header class="page-head">
      <h1>${emoji} ${escapeHtml(title)}</h1>
      ${meta ? `<p class="page-head__meta">${escapeHtml(meta)}</p>` : ''}
    </header>
    <div class="practice" id="practice"></div>`;
}

export const emptyActivityView = (message, href) =>
  `<p class="empty">${escapeHtml(message)} <a href="${href}">Go back</a>.</p>`;
