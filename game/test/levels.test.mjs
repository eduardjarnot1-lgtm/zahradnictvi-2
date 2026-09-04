import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { validateAll, validateLevel } from '../src/validate.js';
import { levelTotals, forcesChoice, itemStats, timeLimit } from '../src/rules.js';
import { play, playEfficiently } from './harness.mjs';

// Levels are grouped into themed chapters; each opens easier and then climbs.
function byTheme() {
  const groups = {};
  for (const level of LEVELS) (groups[level.theme] ||= []).push(level);
  return groups;
}
import { TUNING } from '../src/tuning.js';

test('every shipped level passes the validator', () => {
  const report = validateAll(LEVELS);
  const failures = report.results
    .filter((r) => !r.ok)
    .map((r) => `L${r.id}: ${r.errors.join('; ')}`);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('validator catches an item buried in furniture', () => {
  const broken = structuredClone(LEVELS[0]);
  const sofa = broken.colliders.find((c) => c.type === 'furniture');
  broken.items[0].x = sofa.x + sofa.w / 2;
  broken.items[0].y = sofa.y + sofa.h / 2;
  const result = validateLevel(broken);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /inside or touching a collider/);
});

test('validator catches a walled-off exit', () => {
  const broken = structuredClone(LEVELS[0]);
  broken.colliders.push({
    type: 'furniture',
    x: broken.exit.x - 20,
    y: broken.exit.y - 60,
    w: broken.exit.w + 40,
    h: 60
  });
  const result = validateLevel(broken);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /exit is unreachable/);
});

test('validator catches a spawn inside a wall', () => {
  const broken = structuredClone(LEVELS[0]);
  broken.spawn = { x: 5, y: 5 };
  assert.match(validateLevel(broken).errors.join(' '), /spawn/);
});

test('the first two levels are takeable whole, as a tutorial', () => {
  assert.equal(forcesChoice(LEVELS[0]), false);
  assert.equal(forcesChoice(LEVELS[1]), false);
});

test('every chapter ends on levels that force the core decision', () => {
  for (const [theme, levels] of Object.entries(byTheme())) {
    const last = levels[levels.length - 1];
    assert.equal(forcesChoice(last), true, `${theme} should end on a real decision`);
  }
});

test('difficulty rises within each chapter', () => {
  for (const [theme, levels] of Object.entries(byTheme())) {
    if (levels.length < 2) continue;
    const totals = levels.map((l) => levelTotals(l).noise);
    const inversions = totals.filter((n, i) => i > 0 && n < totals[i - 1]).length;
    assert.ok(inversions <= 1, `${theme} difficulty wanders: ${totals}`);
    assert.ok(
      totals[totals.length - 1] > totals[0],
      `${theme} does not get harder: ${totals}`
    );
  }
});

test('each new chapter opens easier than the previous one ended', () => {
  const chapters = Object.values(byTheme());
  for (let i = 1; i < chapters.length; i++) {
    const previousEnd = levelTotals(chapters[i - 1][chapters[i - 1].length - 1]).noise;
    const opening = levelTotals(chapters[i][0]).noise;
    assert.ok(opening < previousEnd, 'a new room should ease the player back in');
  }
});

test('the campaign ends harder than it starts', () => {
  const first = levelTotals(LEVELS[0]);
  const last = levelTotals(LEVELS[LEVELS.length - 1]);
  assert.ok(last.noise > first.noise * 3);
  assert.ok(last.value > first.value * 5);
});

// The promise the game makes: play efficiently and every level is winnable,
// with time to spare and a haul worth having. This is rule 26 made executable.
test('every level is winnable by playing efficiently, inside its time limit', () => {
  for (const level of LEVELS) {
    const { run, result } = playEfficiently(level.id, { budget: 70, seed: 5 });
    const seconds = run.sim.frame / 60;
    const limit = timeLimit(level);
    assert.equal(result.status, 'won',
      `level ${level.id} could not be finished efficiently (${result.reason || ''})`);
    assert.ok(result.money > 0, `level ${level.id} paid nothing`);
    assert.ok(seconds < limit, `level ${level.id} took ${seconds.toFixed(1)}s of ${limit}s`);
    assert.ok(run.sim.timeLeft > 0, `level ${level.id} finished on empty`);
  }
});

test('taking two named items pays exactly what they are worth', () => {
  for (const level of LEVELS.slice(0, 12)) {
    const ids = level.items.slice(0, 2).map((i) => i.id);
    const { result } = play(level.id, { take: ids, seed: 5 });
    if (result.status !== 'won') continue;   // some late rooms are that unforgiving
    const expected = level.items
      .filter((i) => ids.includes(i.id))
      .reduce((sum, i) => sum + itemStats(i.type).value, 0);
    // `haul` is the raw worth of what was lifted; `money` is what you are paid,
    // which now includes streak and escape bonuses on top.
    assert.equal(result.haul, expected, `level ${level.id} hauled the wrong amount`);
    assert.ok(result.money >= expected, `level ${level.id} paid less than the haul`);
  }
});

test('the clock shrinks with the campaign but never below the floor', () => {
  assert.equal(timeLimit(LEVELS[0]), TUNING.time.base);
  const limits = LEVELS.map(timeLimit);
  for (let i = 1; i < limits.length; i++) {
    assert.ok(limits[i] <= limits[i - 1], 'the clock must never get more generous');
  }
  assert.ok(limits[limits.length - 1] >= TUNING.time.floor);
  assert.ok(limits[limits.length - 1] < TUNING.time.base, 'later levels must be tighter');
});

test('taking everything wakes him on every level that should', () => {
  for (const level of LEVELS.filter(forcesChoice)) {
    const { result } = play(level.id, { seed: 5 });
    assert.equal(result.status, 'lost', `level ${level.id} should be unsurvivable if greedy`);
    assert.equal(result.noise, 100);
  }
});
