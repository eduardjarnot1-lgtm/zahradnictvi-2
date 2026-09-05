import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { validateAll, validateLevel } from '../src/validate.js';
import { levelTotals, forcesChoice, itemStats, timeLimit, furnitureStyle } from '../src/rules.js';
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
  // The generated chapters only. The seven hand-drawn floorplans are one-off
  // showcase maps rather than a ramp, and each is its own location — grouping
  // them by theme would give seven chapters of one level and assert nothing.
  const chapters = Object.values(byTheme()).filter((c) => !c[0].tiles);
  for (let i = 1; i < chapters.length; i++) {
    const previousEnd = levelTotals(chapters[i - 1][chapters[i - 1].length - 1]).noise;
    const opening = levelTotals(chapters[i][0]).noise;
    assert.ok(opening < previousEnd, 'a new room should ease the player back in');
  }
});

test('the campaign ends harder than it starts', () => {
  const generated = LEVELS.filter((l) => !l.tiles);
  const first = levelTotals(generated[0]);
  const last = levelTotals(generated[generated.length - 1]);
  assert.ok(last.noise > first.noise * 3);
  assert.ok(last.value > first.value * 5);
});

// The floorplan levels are a different promise: not a ramp, but seven buildings
// that each have to be worth walking around.
test('every hand-drawn floorplan is a real building, not one big room', () => {
  const plans = LEVELS.filter((l) => l.tiles);
  assert.equal(plans.length, 7, 'expected the seven floorplans');
  for (const level of plans) {
    // Bigger than the screen, or the camera has nothing to do.
    assert.ok(level.width > TUNING.world.width || level.height > TUNING.world.height,
      `level ${level.id} fits on one screen`);
    // Rooms, not one open hall.
    const partitions = level.colliders.filter((c) => c.type === 'partition').length;
    assert.ok(partitions >= 4, `level ${level.id} has only ${partitions} interior walls`);
    assert.ok(level.doors.length >= 2, `level ${level.id} has ${level.doors.length} doorways`);
    // And it has to force the decision the game is about.
    assert.ok(levelTotals(level).noise > TUNING.noise.max,
      `level ${level.id} can be cleared out without waking anyone`);
  }
});

// The exact proportions asked for, checked rather than trusted: a map drawn at
// 36x57 must be 36x57 in the game, not 36x55 because a wall moved.
test('each floorplan is exactly the size it was drawn at', () => {
  const SIZES = {
    57: [43, 40], 58: [44, 33], 59: [36, 57], 60: [45, 32],
    61: [49, 34], 62: [49, 36], 63: [43, 36]
  };
  for (const [id, [cols, rows]] of Object.entries(SIZES)) {
    const level = LEVELS.find((l) => l.id === Number(id));
    assert.ok(level && level.tiles, `level ${id} is not a tile map`);
    assert.deepEqual([level.tiles.cols, level.tiles.rows], [cols, rows],
      `level ${id} is ${level.tiles.cols}x${level.tiles.rows}, drawn as ${cols}x${rows}`);
    assert.equal(level.width, cols * TUNING.world.tile);
    assert.equal(level.height, rows * TUNING.world.tile);
  }
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
  // The base clock shrinks monotonically; a level may then add an allowance
  // for being physically bigger to cross.
  const base = LEVELS.map((l) => timeLimit(l) - (l.extraTime || 0));
  for (let i = 1; i < base.length; i++) {
    assert.ok(base[i] <= base[i - 1], 'the base clock must never get more generous');
  }
  // "Leisurely" has to be measured against how far you have to walk, not in
  // flat seconds: a 36x57 flat is nearly twice the window's diagonal, and
  // holding it to a one-screen bedroom's clock would make it unplayable rather
  // than tense. The allowance scales with distance, so no level is ever more
  // generous per step than the tightest single-screen room.
  const windowSpan = Math.hypot(TUNING.world.width, TUNING.world.height);
  for (const level of LEVELS) {
    assert.ok(timeLimit(level) >= TUNING.time.floor);
    const span = Math.hypot(level.width, level.height);
    const cap = (TUNING.time.base + 12) * (span / windowSpan);
    assert.ok(timeLimit(level) <= cap,
      `level ${level.id} has ${timeLimit(level)}s for a ${level.width}x${level.height} map (cap ${cap.toFixed(0)}s)`);
  }
  assert.ok(base[base.length - 1] < TUNING.time.base, 'later levels must be tighter');
});

test('only the big partitioned maps carry a time allowance', () => {
  for (const level of LEVELS) {
    const partitions = level.colliders.filter((c) => c.type === 'partition').length;
    if (level.extraTime > 0) {
      assert.ok(partitions > 0, `level ${level.id} takes extra time without being bigger`);
    }
    if (partitions > 0) {
      assert.ok(level.extraTime > 0,
        `level ${level.id} is partitioned but gets no extra clock to cross it`);
    }
  }
});

test('the campaign grows from one room into connected areas', () => {
  const early = LEVELS.slice(0, 10);
  const late = LEVELS.slice(-8);
  for (const level of early) {
    assert.equal(level.colliders.filter((c) => c.type === 'partition').length, 0,
      `level ${level.id} should stay a simple single room`);
  }
  for (const level of late) {
    assert.ok(level.colliders.filter((c) => c.type === 'partition').length >= 3,
      `level ${level.id} should be a multi-area map`);
  }
  // ...and the late rooms are worth more and busier than the early ones.
  const earlyItems = early.reduce((n, l) => n + l.items.length, 0) / early.length;
  const lateItems = late.reduce((n, l) => n + l.items.length, 0) / late.length;
  assert.ok(lateItems > earlyItems);
});

test('the two-doorway house really does offer independent routes', () => {
  // Seal either doorway and the level is still completable through the other.
  // That is the whole point of the layout, and it is easy to lose by accident.
  const level = LEVELS.find((l) => l.layout === 'G');
  assert.ok(level, 'expected a two-doorway layout');

  const doorways = level.doors;
  assert.equal(doorways.length, 2, 'expected exactly two doorways');

  // Bricking a doorway up means it stops being a doorway, so it comes out of
  // the door list too — otherwise the validator flags it as a blocked door,
  // which is beside the point being tested here.
  const brickUp = (indices) => {
    const sealed = structuredClone(level);
    for (const index of indices) sealed.colliders.push({ type: 'partition', ...doorways[index] });
    sealed.doors = sealed.doors.filter((_, index) => !indices.includes(index));
    return validateLevel(sealed);
  };

  for (const index of [0, 1]) {
    const result = brickUp([index]);
    assert.equal(result.ok, true,
      `sealing doorway ${index} breaks the level: ${result.errors.join('; ')}`);
  }

  // And sealing both must break it — otherwise the partition is not dividing
  // anything and the test above proves nothing.
  assert.equal(brickUp([0, 1]).ok, false, 'sealing both doorways should cut the room in two');
});

test('greed never pays: taking everything loses, one way or another', () => {
  for (const level of LEVELS.filter(forcesChoice)) {
    const { result } = play(level.id, { seed: 5 });
    assert.equal(result.status, 'lost', `level ${level.id} should be unsurvivable if greedy`);
    // On the bigger rooms the clock can run out before the meter fills — both
    // are legitimate ways for greed to fail.
    if (result.reason !== 'time') {
      assert.equal(result.noise, 100, `level ${level.id} lost for '${result.reason}' at ${result.noise}`);
    }
  }
});

test('every declared doorway is wide enough to walk through', () => {
  for (const level of LEVELS) {
    for (const door of level.doors) {
      const span = door.w > door.h ? door.w : door.h;
      const needed = (door.w > door.h ? TUNING.player.boxWidth : TUNING.player.boxHeight) + 12;
      assert.ok(span >= needed,
        `level ${level.id} has a ${span}px doorway, needs ${needed}`);
    }
  }
});

test('the validator rejects a doorway too narrow to pass', () => {
  const level = LEVELS.find((l) => l.doors.length > 0);
  const pinched = structuredClone(level);
  pinched.doors[0] = { ...pinched.doors[0], w: 18, h: 14 };
  assert.match(validateLevel(pinched).errors.join(' '), /too narrow/);
});

test('a partitioned level declares the doors its walls leave open', () => {
  for (const level of LEVELS) {
    const partitions = level.colliders.filter((c) => c.type === 'partition').length;
    if (partitions > 0) {
      assert.ok(level.doors.length > 0,
        `level ${level.id} has interior walls but declares no way through them`);
    }
  }
});

test('gallery rooms put their value on plinths, out in the open', () => {
  const gallery = LEVELS.filter((l) => l.theme === 'gallery');
  assert.ok(gallery.length > 0);
  for (const level of gallery) {
    const plinths = level.colliders.filter(
      (c) => c.type === 'furniture' && furnitureStyle(c) === 'plinth');
    assert.ok(plinths.length >= 6, `level ${level.id} has only ${plinths.length} plinths`);
    // Each plinth should have something worth taking beside it.
    const guarded = plinths.filter((p) => level.items.some((item) =>
      Math.abs(item.x - (p.x + p.w / 2)) < 40 && Math.abs(item.y - (p.y + p.h / 2)) < 40));
    assert.ok(guarded.length >= 5, `only ${guarded.length} plinths are worth visiting`);
  }
});
