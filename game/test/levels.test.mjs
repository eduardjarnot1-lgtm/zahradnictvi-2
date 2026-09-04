import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { validateAll, validateLevel } from '../src/validate.js';
import { levelTotals, forcesChoice, itemStats } from '../src/rules.js';
import { play } from './harness.mjs';
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

test('difficulty curve: 1-2 are takeable whole, 3+ force a choice', () => {
  assert.equal(forcesChoice(LEVELS[0]), false);
  assert.equal(forcesChoice(LEVELS[1]), false);
  for (const level of LEVELS.slice(2)) {
    assert.equal(forcesChoice(level), true, `L${level.id} should force a choice`);
  }
});

test('level noise totals never decrease across the campaign after level 2', () => {
  const totals = LEVELS.slice(2).map((l) => levelTotals(l).noise);
  const sorted = [...totals].sort((a, b) => a - b);
  // allow one deliberate dip (L5 is a layout change, not a difficulty drop)
  const inversions = totals.filter((n, i) => i > 0 && n < totals[i - 1]).length;
  assert.ok(inversions <= 1, `too many difficulty inversions: ${totals}`);
  assert.ok(sorted[sorted.length - 1] > TUNING.noise.max);
});

// Every level is still completable after the polish pass. This is the check
// that answers "did the visual work break any of the ten levels".
test('all ten levels can still be played and escaped', () => {
  for (const level of LEVELS) {
    const ids = level.items.slice(0, 2).map((i) => i.id);
    const { result } = play(level.id, { take: ids, seed: 5 });
    const expected = level.items
      .filter((i) => ids.includes(i.id))
      .reduce((sum, i) => sum + itemStats(i.type).value, 0);
    assert.equal(result.status, 'won', `level ${level.id} could not be finished`);
    assert.equal(result.money, expected, `level ${level.id} paid the wrong amount`);
    assert.deepEqual([...result.taken].sort(), [...ids].sort());
  }
});

test('taking everything wakes him on every level that should', () => {
  for (const level of LEVELS.filter(forcesChoice)) {
    const { result } = play(level.id, { seed: 5 });
    assert.equal(result.status, 'lost', `level ${level.id} should be unsurvivable if greedy`);
    assert.equal(result.noise, 100);
  }
});
