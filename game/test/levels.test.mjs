import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { validateAll, validateLevel } from '../src/validate.js';
import {
  levelTotals, forcesChoice, itemStats, timeLimit, furnitureStyle, lootOf, locationRules
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
    // Seconds *per step of map*, not raw seconds. Levels three and up carry
    // their own grounds now, so the plot doubles part-way through a location
    // and raw seconds have to rise with it — what tightens is how much of the
    // clock is spare once you have actually worked the place, which is what
    // the calibrator's slack curve sets and what a player feels.
    const clocks = levels.map((l) => timeLimit(l) / Math.hypot(l.width, l.height));
    for (let i = 1; i < 4; i++) {
      assert.ok(clocks[i] < clocks[i - 1],
        `${location} level ${i + 1} has ${clocks[i].toFixed(3)}s a step, no tighter than ${clocks[i - 1].toFixed(3)}`);
    }
    assert.ok(clocks[4] <= clocks[0], `${location} ends looser than it began: ${clocks}`);
  }
});

// The floorplan levels are a different promise: not a ramp, but seven buildings
// that each have to be worth walking around.
// The seven recreations of reference drawings, now the hardest level of the
// first seven locations.
const HAND_DRAWN = [5, 10, 15, 20, 25, 30, 35];

test('no two locations climb through the same five silhouettes', () => {
  // Section 17. Read off the walls alone — every stick of furniture removed —
  // the five levels of a location should be five buildings, and the five of one
  // location should not be the five of another. The table that decides this
  // carried a comment saying exactly that while the hotel, the hospital and the
  // mansion all climbed through bar, ell, tee, wings, you: their top three
  // floors were the same building three times over with different furniture in
  // it, and nothing in the suite said so. This is what says so now.
  //
  // The silhouette is measured rather than read off the generator's table,
  // because the table is not shipped — what ships is the grid, so that is what
  // gets asked. A building's shape is which cells of a lattice over the whole
  // plot any of its masonry falls in: windows and fences left out, because a
  // window is a hole in a wall that is still a wall and a fence is the garden.
  const shapeOf = (level) => {
    const solid = level.colliders.filter(
      (c) => c.type === 'wall' && !c.fence && !c.window);
    // Fourteen a side. Coarser than that and a wing on a plot with no grounds
    // round it falls inside one cell, so a C, a T and a U all come out as the
    // same eight-by-eight block — which says the measure is too blunt, not that
    // the buildings are the same.
    const N = 14;
    const out = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const x0 = (gx * level.width) / N;
        const x1 = ((gx + 1) * level.width) / N;
        const y0 = (gy * level.height) / N;
        const y1 = ((gy + 1) * level.height) / N;
        out.push(solid.some((c) => c.x < x1 && c.x + c.w > x0
          && c.y < y1 && c.y + c.h > y0) ? '#' : '.');
      }
    }
    return out.join('');
  };
  const climbs = new Map();
  for (const [location, levels] of Object.entries(byLocation())) {
    climbs.set(location, levels.map(shapeOf).join('/'));
  }
  const seen = new Map();
  for (const [location, climb] of climbs) {
    const twin = seen.get(climb);
    assert.ok(!twin, `${location} is ${twin} with different furniture in it`);
    seen.set(climb, location);
  }
  // ...and within a location, the five are five buildings rather than one at
  // five sizes. The first is a plain rectangle everywhere on purpose — the
  // level that teaches the building should be one you can hold in your head —
  // so it is the other four that have to differ.
  for (const [location, levels] of Object.entries(byLocation())) {
    const shapes = levels.slice(1).map(shapeOf);
    assert.ok(new Set(shapes).size >= 3,
      `${location} has only ${new Set(shapes).size} shapes across levels 2 to 5`);
  }
});

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
//
// Six of these are now a drawn building standing in its own grounds, and the
// size below is the plot: the building inside it is still the drawing, tile for
// tile, and `surround` is the only thing that touched it. Only the hospital,
// which is a ward at night and has no outside worth walking into, is still the
// bare drawing.
test('each floorplan is exactly the size it was drawn at', () => {
  // Apartment 5, House 5, Hotel 5, Office 5, School 5, Hospital 5, Museum 5.
  // The drawn plan and the plot round it. Every one of these grew when its
  // location's grounds were brought up to the school's — the school reaches
  // all four sides of its plot by its top floor, and the other ten stopped
  // short and left a slab of masonry where the yard should have been. The
  // plans themselves are untouched; what changed is how much garden is round
  // them.
  const SIZES = {
    5: [48, 69], 10: [55, 48], 15: [61, 46], 20: [56, 45],
    25: [61, 48], 30: [57, 44], 35: [55, 52]
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
    // gets 24 seconds per window of map, times its slack — 2.15 for level one.
    // Nothing may exceed what level 1 of its own size would be given, lifted by
    // the most the calibrator is allowed to lift a location whose slowest level
    // measured long (1.30). Every building in the game is now played against
    // somebody who gets up and comes looking, and waiting for them to sit back
    // down is time a run genuinely spends — but 2.15 x 1.30 is the whole of the
    // allowance, and past it a level stops being a level.
    const cap = 24 * 2.15 * 1.30 * (Math.hypot(level.width, level.height) / windowSpan);
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

test('greed never pays: taking everything is caught, timed out, or unrewarded', () => {
  // This used to read "taking everything loses", full stop, because filling the
  // meter ended the level. It does not any more — in any of the eleven
  // buildings — so the promise has to be stated as what it actually is: a
  // greedy run is caught, or runs out of clock, or gets out with the building
  // awake behind it and no bonus for it. What it is never is free.
  let lost = 0;
  const greedy = LEVELS.filter(forcesChoice);
  for (const level of greedy) {
    const { run, result } = play(level.id, { seed: 5, everything: true });
    if (result.status === 'lost') {
      lost++;
      assert.ok(['time', 'caught', 'awake', 'seen'].includes(result.reason),
        `level ${level.id} lost for '${result.reason}'`);
      continue;
    }
    // Got out. Then it was loud enough to have the person up, and the escape
    // grade says so: nothing is paid for a run made with the building awake.
    assert.ok(run.sim.noise > locationRules(level).investigate.wakeAt,
      `level ${level.id} cleared itself out quietly, which is not greed, it is a walkover`);
    assert.equal(run.sim.escapeGrade.bonus, 0,
      `level ${level.id} paid a bonus for a greedy run`);
  }
  // ...and most of the time it simply does not work.
  assert.ok(lost > greedy.length * 0.5,
    `only ${lost} of ${greedy.length} greedy runs actually failed`);
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
    // Within the aisle beside it. A three-tile plinth in a three-tile aisle
    // puts the nearest spot a person can actually stand exactly sixty units
    // from its middle — the player is wider than a tile — so "beside it" is
    // the aisle, not a tile that nobody can occupy.
    const guarded = plinths.filter((p) => level.items.some((item) =>
      Math.abs(item.x - (p.x + p.w / 2)) <= 70 && Math.abs(item.y - (p.y + p.h / 2)) <= 70));
    assert.ok(guarded.length >= Math.ceil(plinths.length / 2),
      `only ${guarded.length} of ${plinths.length} plinths are worth visiting`);
  }
});
