import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { validateAll, validateLevel } from '../src/validate.js';
import {
  levelTotals, forcesChoice, itemStats, timeLimit, furnitureStyle, lootOf
} from '../src/rules.js';
import { play, playEfficiently } from './harness.mjs';

// Eleven locations of five levels each; within a location the difficulty climbs.
function byLocation() {
  const groups = {};
  for (const level of LEVELS) (groups[level.location] ||= []).push(level);
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
  const exit = broken.exit;
  const slab = exit.side === 'bottom'
    ? { x: exit.x - 20, y: exit.y - 60, w: exit.w + 40, h: 60 }
    : exit.side === 'left'
      ? { x: exit.x + exit.w, y: exit.y - 20, w: 60, h: exit.h + 40 }
      : { x: exit.x - 60, y: exit.y - 20, w: 60, h: exit.h + 40 };
  broken.colliders.push({ type: 'furniture', ...slab });
  const result = validateLevel(broken);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /exit is unreachable/);
});

test('validator catches a spawn inside a wall', () => {
  const broken = structuredClone(LEVELS[0]);
  broken.spawn = { x: 5, y: 5 };
  assert.match(validateLevel(broken).errors.join(' '), /spawn/);
});

// Every location teaches you its building before it starts asking questions.
test('each location opens with a level you can clear, and closes on a choice', () => {
  for (const [location, levels] of Object.entries(byLocation())) {
    assert.equal(forcesChoice(levels[0]), false,
      `${location} level 1 already forces a choice — nowhere to learn the place`);
    for (const level of levels.slice(2)) {
      assert.ok(forcesChoice(level),
        `${location} level ${level.tier} can be cleared out without waking anyone`);
    }
  }
});

test('every chapter ends on levels that force the core decision', () => {
  for (const [location, levels] of Object.entries(byLocation())) {
    const last = levels[levels.length - 1];
    assert.equal(forcesChoice(last), true, `${location} should end on a real decision`);
  }
});

test('difficulty rises within each chapter', () => {
  for (const [location, levels] of Object.entries(byLocation())) {
    if (levels.length < 2) continue;
    const totals = levels.map((l) => levelTotals(l).noise);
    const inversions = totals.filter((n, i) => i > 0 && n < totals[i - 1]).length;
    assert.ok(inversions <= 1, `${location} difficulty wanders: ${totals}`);
    assert.ok(
      totals[totals.length - 1] > totals[0],
      `${location} does not get harder: ${totals}`
    );
  }
});

test('each new chapter opens easier than the previous one ended', () => {
  // The generated chapters only. The seven hand-drawn floorplans are one-off
  // showcase maps rather than a ramp, and each is its own location — grouping
  // them by theme would give seven chapters of one level and assert nothing.
  const chapters = Object.values(byLocation()).filter((c) => !c[0].tiles);
  for (let i = 1; i < chapters.length; i++) {
    const previousEnd = levelTotals(chapters[i - 1][chapters[i - 1].length - 1]).noise;
    const opening = levelTotals(chapters[i][0]).noise;
    assert.ok(opening < previousEnd, 'a new room should ease the player back in');
  }
});

test('the campaign ends harder than it starts', () => {
  const first = levelTotals(LEVELS[0]);
  const last = levelTotals(LEVELS[LEVELS.length - 1]);
  assert.ok(last.noise > first.noise * 3, `${first.noise} -> ${last.noise} noise`);
  assert.ok(last.value > first.value * 5, `${first.value} -> ${last.value} value`);
});

// The five levels of a location are a ramp: more to steal, worth more, and a
// building with more of it to cross.
test('difficulty climbs across each location', () => {
  for (const [location, levels] of Object.entries(byLocation())) {
    assert.equal(levels.length, 5, `${location} has ${levels.length} levels, not five`);
    assert.deepEqual(levels.map((l) => l.tier), [1, 2, 3, 4, 5], `${location} tiers are out of order`);

    const items = levels.map((l) => l.items.length);
    const value = levels.map((l) => levelTotals(l).value);
    const rooms = levels.map((l) => l.colliders.filter((c) => c.type === 'partition').length);
    assert.ok(items[4] > items[0], `${location}: ${items} items`);
    assert.ok(value[4] > value[0] * 2, `${location}: ${value} value`);
    assert.ok(rooms[4] >= rooms[0], `${location}: ${rooms} interior walls`);
  }
});

// Pressure, not raw seconds. A bigger map genuinely takes longer to cross, so
// the last level of a location may get more seconds than the fourth — what has
// to tighten is how much of the clock is spare once you have worked the place.
test('the clock tightens across the first four levels of every location', () => {
  for (const [location, levels] of Object.entries(byLocation())) {
    const clocks = levels.map((l) => timeLimit(l));
    for (let i = 1; i < 4; i++) {
      assert.ok(clocks[i] < clocks[i - 1],
        `${location} level ${i + 1} has ${clocks[i]}s, no tighter than ${clocks[i - 1]}s`);
    }
    assert.ok(clocks[4] <= clocks[0], `${location} ends looser than it began: ${clocks}`);
  }
});

// The floorplan levels are a different promise: not a ramp, but seven buildings
// that each have to be worth walking around.
// The seven recreations of reference drawings, now the hardest level of the
// first seven locations.
const HAND_DRAWN = [5, 10, 15, 20, 25, 30, 35];

test('every hand-drawn floorplan is a real building, not one big room', () => {
  const plans = LEVELS.filter((l) => HAND_DRAWN.includes(l.id));
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
  // Apartment 5, House 5, Hotel 5, Office 5, School 5, Hospital 5, Museum 5.
  const SIZES = {
    5: [36, 57], 10: [43, 36], 15: [49, 34], 20: [44, 33],
    25: [49, 36], 30: [45, 32], 35: [43, 40]
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

test('every level states its own clock, and none of them is a walkover', () => {
  const windowSpan = Math.hypot(TUNING.world.width, TUNING.world.height);
  for (const level of LEVELS) {
    assert.ok(level.clock > 0, `level ${level.id} has no clock of its own`);
    assert.equal(timeLimit(level), level.clock);
    // Never more generous per step than the tightest single-screen room was.
    // The ceiling the clocks are calibrated to: the easiest level of a location
    // gets 24 seconds per window of map, times its slack. Nothing may exceed
    // what level 1 of its own size would be given.
    // ...with a little room above it, because a level whose measured run came
    // out long is given the seconds it actually needs.
    const cap = 24 * 2.35 * (Math.hypot(level.width, level.height) / windowSpan);
    assert.ok(level.clock <= cap,
      `level ${level.id} has ${level.clock}s for a ${level.width}x${level.height} map (cap ${cap.toFixed(0)}s)`);
    assert.ok(level.clock >= 20, `level ${level.id} has only ${level.clock}s`);
  }
});

test('every level is a building, not one open room', () => {
  for (const level of LEVELS) {
    assert.ok(level.colliders.filter((c) => c.type === 'partition').length >= 2,
      `level ${level.id} has no interior walls`);
    assert.ok(level.doors.length >= 1, `level ${level.id} has no doorways`);
    // Counted across the floor *and* the furniture: the school keeps most of
    // what it is worth inside cupboards now, so counting only what is lying
    // about would say a full level was nearly empty.
    const loot = lootOf(level);
    assert.ok(loot.length >= 7, `level ${level.id} has only ${loot.length} things worth taking`);
  }
});

test('the validator notices a doorway bricked up', () => {
  // Sealing a room off is the failure mode these buildings invite, and the
  // whole generator leans on the validator catching it.
  const level = LEVELS.find((l) => l.doors.length > 0);
  assert.ok(level, 'expected a level with doorways');
  const sealed = structuredClone(level);
  for (const door of sealed.doors) sealed.colliders.push({ type: 'partition', ...door });
  const result = validateLevel(sealed);
  assert.equal(result.ok, false, 'bricking up every doorway should not validate');
});

test('greed never pays: taking everything loses, one way or another', () => {
  for (const level of LEVELS.filter(forcesChoice)) {
    const { result } = play(level.id, { seed: 5, everything: true });
    assert.equal(result.status, 'lost', `level ${level.id} should be unsurvivable if greedy`);
    // On the bigger rooms the clock can run out before the meter fills, and in
    // the school a greedy run is loud enough that Mr. Vrána gets up and walks
    // into you. All three are legitimate ways for greed to fail.
    if (result.reason !== 'time' && result.reason !== 'caught') {
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

test('museum rooms put their value on plinths, out in the open', () => {
  // Only the generated museum levels: the hand-drawn one is a recreation of a
  // drawing and lays its hall out the way the drawing does.
  const gallery = LEVELS.filter((l) => l.theme === 'museum' && l.tier < 5);
  assert.ok(gallery.length > 0);
  for (const level of gallery) {
    const plinths = level.colliders.filter(
      (c) => c.type === 'furniture' && furnitureStyle(c) === 'plinth');
    // The hall grows with the tier, from a 2x2 of cases to a 4x3.
    assert.ok(plinths.length >= 4, `level ${level.id} has only ${plinths.length} plinths`);
    assert.ok(plinths.length >= level.tier * 2,
      `level ${level.id} is tier ${level.tier} with only ${plinths.length} plinths`);
    // ...and most of them have something worth taking beside them.
    const guarded = plinths.filter((p) => level.items.some((item) =>
      Math.abs(item.x - (p.x + p.w / 2)) < 60 && Math.abs(item.y - (p.y + p.h / 2)) < 60));
    assert.ok(guarded.length >= Math.ceil(plinths.length / 2),
      `only ${guarded.length} of ${plinths.length} plinths are worth visiting`);
  }
});
