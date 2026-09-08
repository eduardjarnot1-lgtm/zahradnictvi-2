// The school, and only the school.
//
// Two things are being defended here. One is that the new mechanics work: that
// noise costs more near Mr. Vrána, that standing still brings it down, that he
// gets up at 80, walks to where the noise was rather than to where you are,
// and goes back to bed under 50. The other is that none of it leaks — every
// other location in the game must behave exactly as it did before any of this
// existed, and that is checked here rather than hoped for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { createSim, stepSim, playerOf, STEP_SECONDS } from '../src/sim.js';
import {
  locationRules, proximityScale, itemStats, lootOf, starThresholds
} from '../src/rules.js';
import { navGrid, flowField, cellOf } from '../src/nav.js';
import { blocked } from '../src/physics.js';
import { createRun, tick, walkTo, escape, waitOut, playEfficiently, slipAway } from './harness.mjs';

const FLOORPLANS = LEVELS;
const SCHOOL = LEVELS.filter((l) => l.location === 'School');
const ELSEWHERE = LEVELS.filter((l) => l.location !== 'School');
const RULES = TUNING.locations.School;

const openSchool = (id = 21) => {
  const run = createRun(id);
  run.sim.timeLeft = 9999;      // these tests are about him, not about the clock
  return run;
};

// Tick until he has finished getting off the couch, holding the meter up so he
// does not give up mid-rise. Waits on the state rather than on a frame count,
// so re-timing the wake-up animation cannot silently break these tests.
function untilWalking(run, hold = 85, limit = 60 * 10) {
  const w = run.sim.investigator;
  for (let i = 0; i < limit && run.sim.status === 'running'; i++) {
    if (w.state === 'investigating') return true;
    run.sim.noise = Math.max(run.sim.noise, hold);
    tick(run);
  }
  return false;
}

const ALERT = TUNING.locations.School.alertness;

// How far out his guess at a noise is allowed to be, at a given meter reading.
// He does not know where you are — he knows roughly where the sound came from,
// and "roughly" is a number that shrinks as the meter rises.
function guessError(noise) {
  const t = Math.max(0, Math.min(1, (noise - ALERT.from) / (ALERT.to - ALERT.from)));
  const alert = t * t * (3 - 2 * t);
  return ALERT.blur + (ALERT.sharp - ALERT.blur) * alert;
}

// The fastest he is allowed to move, which now depends on how alert he is.
function topSpeed() {
  return RULES.investigate.speed * ALERT.speedHigh;
}

// Put the player somewhere, without walking there — and somewhere he could
// actually be standing. The school's rooms are packed tightly enough that an
// arbitrary point is often inside a desk, and a test that sets up its situation
// inside a cupboard is not testing the thing it says it is. Snaps outwards to
// the nearest spot the player box fits, and returns where that turned out to be
// so a caller that cares about the distance can measure it rather than assume.
function place(sim, x, y) {
  const p = playerOf(sim);
  const w = TUNING.player.boxWidth;
  const h = TUNING.player.boxHeight;
  let best = null;
  for (let r = 0; r <= 220 && !best; r += 4) {
    for (let a = 0; a < 32 && !best; a++) {
      const t = (a / 32) * Math.PI * 2;
      const px = x + Math.cos(t) * r;
      const py = y + Math.sin(t) * r;
      if (!blocked(px, py, w, h, sim.level.colliders)) best = { x: px, y: py };
    }
  }
  assert.ok(best, `nowhere to stand near ${Math.round(x)},${Math.round(y)}`);
  p.x = best.x; p.y = best.y; p.prevX = best.x; p.prevY = best.y; p.vx = 0; p.vy = 0;
  return best;
}

// Somewhere the player can stand, as close to `want` units from a point as the
// building allows. Tests that used to write `w.x + 60` and teleport there were
// relying on the school being mostly empty floor; now that it is furnished, a
// point picked that way is usually inside a desk, and snapping out of one can
// land you nearer the man you were trying to be far away from. Measured and
// returned, so a caller asserts against the distance it actually got.
function placeAway(sim, from, want) {
  const bw = TUNING.player.boxWidth;
  const bh = TUNING.player.boxHeight;
  const level = sim.level;
  let best = null;
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    for (let r = want; r <= want + 90; r += 5) {
      const px = from.x + Math.cos(t) * r;
      const py = from.y + Math.sin(t) * r;
      if (px < 24 || py < 24 || px > level.width - 24 || py > level.height - 24) continue;
      if (blocked(px, py, bw, bh, level.colliders)) continue;
      const d = Math.hypot(px - from.x, py - from.y);
      if (!best || Math.abs(d - want) < Math.abs(best.d - want)) best = { x: px, y: py, d };
      break;
    }
  }
  if (!best) return null;
  const p = playerOf(sim);
  p.x = best.x; p.y = best.y; p.prevX = best.x; p.prevY = best.y; p.vx = 0; p.vy = 0;
  return best;
}

// The longest unbroken stretch of floor on the level along one axis, as
// (from, to) along it. `openRunOfFloor` answers "somewhere with this much room
// either side", which is the wrong question when the test needs to *run*: it
// can hand back the middle of a stretch whose far end is a wall forty units on.
function longestLane(level, axis = 'x') {
  const grid = navGrid(level, TUNING.player.boxWidth, TUNING.player.boxHeight);
  const cell = grid.cell;
  let best = null;
  const outer = axis === 'x' ? grid.rows : grid.cols;
  const inner = axis === 'x' ? grid.cols : grid.rows;
  for (let a = 0; a < outer; a++) {
    let start = null;
    for (let b = 0; b <= inner; b++) {
      const i = axis === 'x' ? a * grid.cols + b : b * grid.cols + a;
      const open = b < inner && !grid.blocked[i];
      if (open && start === null) start = b;
      if (!open && start !== null) {
        const span = (b - start) * cell;
        if (!best || span > best.span) {
          best = {
            span,
            from: start * cell + cell / 2,
            to: (b - 1) * cell + cell / 2,
            across: a * cell + cell / 2
          };
        }
        start = null;
      }
    }
  }
  assert.ok(best, 'the map should have an open stretch somewhere');
  return best;
}

// Somewhere he can walk a straight line of `length` units without hitting
// anything, as close to `preferred` distance from the caretaker as the map
// allows. Found from the level rather than written down, so these tests keep
// working when a map is redrawn.
function openRunOfFloor(level, preferred, length = 80, axis = 'y') {
  const grid = navGrid(level, TUNING.player.boxWidth, TUNING.player.boxHeight);
  let best = null;
  for (let i = 0; i < grid.blocked.length; i++) {
    if (grid.blocked[i]) continue;
    const cx = i % grid.cols;
    const x = cx * grid.cell + grid.cell / 2;
    const y = ((i - cx) / grid.cols) * grid.cell + grid.cell / 2;
    let clear = true;
    for (let step = -length / 2; step <= length / 2; step += 4) {
      const px = axis === 'x' ? x + step : x;
      const py = axis === 'x' ? y : y + step;
      if (blocked(px, py, TUNING.player.boxWidth, TUNING.player.boxHeight, level.colliders)) {
        clear = false; break;
      }
    }
    if (!clear) continue;
    const error = Math.abs(Math.hypot(x - level.watcher.x, y - level.watcher.y) - preferred);
    if (!best || error < best.error) best = { x, y, error };
  }
  assert.ok(best, 'the map should have an open stretch somewhere');
  return best;
}

// --- the mechanics are the school's alone -----------------------------------

test('every location has rules of its own, and the school is one of eleven', () => {
  // This was the isolation test, back when the school was the only building in
  // the game that behaved this way. It is now the coverage test: the machinery
  // is the game's, and a location that is missing from here is a location that
  // quietly kept the old fuse.
  const names = Object.keys(TUNING.locations);
  assert.equal(names.length, 11, `eleven locations, found ${names.length}`);
  for (const level of FLOORPLANS) {
    const rules = locationRules(level);
    assert.ok(rules.investigate, `L${level.id} (${level.location}) has nobody in it`);
    assert.ok(rules.alertness, `L${level.id} (${level.location}) has no alertness curve`);
    assert.ok(rules.proximity, `L${level.id} (${level.location}) has no proximity curve`);
    assert.ok(rules.recovery, `L${level.id} (${level.location}) has no recovery rate`);
  }
});

test('the drawn figures are the whole game\'s now', () => {
  // A visual switch rather than a rewrite: the renderer asks the location
  // whether it wants the new characters. That one line has now been moved to
  // every location, which is what §20 asks for — one game, not one polished
  // building surrounded by an older one.
  for (const level of FLOORPLANS) {
    assert.equal(locationRules(level).figures, true,
      `L${level.id} (${level.location}) is still drawing the old walker`);
  }
});

test('every location gets an investigator and a proximity curve', () => {
  for (const level of ELSEWHERE) {
    const sim = createSim({ level });
    assert.ok(sim.investigator, `L${level.id} (${level.location}) has nobody walking about`);
    assert.ok(sim.investigateRules, `L${level.id} has no investigation rules`);
    assert.equal(sim.entities.length, 2, `L${level.id} has the wrong number of people in it`);
    stepSim(sim, { x: 1, y: 0, take: false });
    assert.notEqual(sim.proximity, 1,
      `L${level.id} (${level.location}) is not scaling its noise by distance`);
  }
});

test('noise costs what it says on the tin times how near he is, everywhere', () => {
  // The printed value is the floor price. What you actually pay is that times
  // the proximity curve, which is between 0.85 and 3 — and that is now true in
  // all eleven buildings rather than in one of them.
  for (const level of ELSEWHERE.slice(0, 8)) {
    const sim = createSim({ level });
    const item = sim.items[0];
    place(sim, item.x, item.y);
    stepSim(sim, { x: 0, y: 0, take: true });
    const rules = locationRules(level);
    const scale = proximityScale(rules,
      Math.hypot(item.x - level.watcher.x, item.y - level.watcher.y));
    assert.ok(Math.abs(sim.noise - item.noise * scale) < 0.6,
      `L${level.id} (${level.location}) charged ${sim.noise.toFixed(1)} for a ${item.noise} item at x${scale.toFixed(2)}`);
    assert.ok(scale >= rules.proximity.farScale && scale <= rules.proximity.nearScale);
  }
});

test('every location settles at its own pace, and none of them is a reset button', () => {
  // Standing still is now a tactic in all eleven buildings, and how fast it
  // works is part of who lives there: a grandfather in an armchair settles
  // twice as readily as a vault guard.
  const rates = new Set();
  for (const name of Object.keys(TUNING.locations)) {
    const level = FLOORPLANS.find((l) => l.location === name);
    const rules = locationRules(level);
    const sim = createSim({ level });
    sim.noise = 50;
    for (let i = 0; i < 60 * 2; i++) stepSim(sim);
    const spent = 2 - rules.recovery.delay;
    assert.ok(Math.abs((50 - sim.noise) - spent * rules.recovery.rate) < 0.2,
      `${name} decayed ${(50 - sim.noise).toFixed(2)}, expected ${(spent * rules.recovery.rate).toFixed(2)}`);
    // Slow enough that it is a decision against the clock rather than a button.
    assert.ok(rules.recovery.rate <= 9 && rules.recovery.delay >= 0.85, `${name} settles too easily`);
    rates.add(`${rules.recovery.delay}/${rules.recovery.rate}`);
  }
  assert.ok(rates.size >= 6, `only ${rates.size} distinct settling rates across eleven locations`);
});

// --- distance decides how much a noise costs --------------------------------

test('the same item is far louder taken next to him than across the school', () => {
  const level = SCHOOL[0];
  const cost = (distance) => {
    const sim = createSim({ level });
    const item = sim.items[0];
    // Move the item, not the man: this isolates distance from everything else.
    // Straight up the map, so a long distance stays inside the building.
    item.x = level.watcher.x;
    item.y = Math.max(30, level.watcher.y - distance);
    place(sim, item.x, item.y);
    stepSim(sim, { x: 0, y: 0, take: true });
    return sim.noise;
  };
  // Compared against the sensitivity the map can actually reach: level 21 is
  // 600 units tall, so an item cannot be put far enough away to reach the
  // bottom of the curve. What matters is that the cost tracks the curve.
  const rules = locationRules(level);
  const at = (d) => Math.min(d, level.watcher.y - 30);
  const nearAt = at(RULES.proximity.near - 30);
  const farAt = at(RULES.proximity.far + 40);
  const near = cost(RULES.proximity.near - 30);
  const middle = cost((RULES.proximity.near + RULES.proximity.far) / 2);
  const far = cost(RULES.proximity.far + 40);
  assert.ok(near > middle && middle > far, `${near} / ${middle} / ${far} should fall away`);
  const expected = proximityScale(rules, nearAt) / proximityScale(rules, farAt);
  assert.ok(expected > 1.6, 'the probe should span a real part of the curve');
  assert.ok(Math.abs(near / far - expected) < 0.08,
    `the ratio ${(near / far).toFixed(2)} should track the curve's ${expected.toFixed(2)}`);
});

test('the sensitivity curve is smooth, so there is no line to be caught out by', () => {
  const rules = locationRules(SCHOOL[0]);
  let previous = proximityScale(rules, 0);
  for (let d = 1; d <= 500; d++) {
    const here = proximityScale(rules, d);
    assert.ok(here <= previous + 1e-9, `sensitivity rose again at ${d}`);
    assert.ok(previous - here < 0.02, `a step of ${(previous - here).toFixed(3)} at ${d} is a cliff`);
    previous = here;
  }
  assert.equal(proximityScale(rules, 0), RULES.proximity.nearScale);
  assert.equal(proximityScale(rules, 9999), RULES.proximity.farScale);
});

test('footsteps are scaled by distance too, not just what you pick up', () => {
  const level = SCHOOL[0];
  // Measure only the frames where walking is the only thing making noise: a
  // creaky board or a knock in the middle of the probe would drown out the
  // very effect being measured.
  const perUnit = (from) => {
    const sim = createSim({ level });
    place(sim, from.x, from.y);
    const p = playerOf(sim);
    for (let i = 0; i < 20; i++) stepSim(sim, { x: 1, y: 0, take: false });  // up to speed
    let noise = 0;
    let travelled = 0;
    for (let i = 0; i < 60; i++) {
      const was = { x: p.x, n: sim.noise };
      stepSim(sim, { x: i % 30 < 15 ? 1 : -1, y: 0, take: false });
      if (sim.events.some((e) => e.type === 'creak' || e.type === 'bump')) continue;
      noise += sim.noise - was.n;
      travelled += Math.abs(p.x - was.x);
    }
    assert.ok(travelled > 40, `the probe should walk, not wedge (${travelled.toFixed(0)}u)`);
    return { rate: noise / travelled, proximity: sim.proximity };
  };

  const near = perUnit(openRunOfFloor(level, RULES.proximity.near - 30, 70, 'x'));
  const far = perUnit(openRunOfFloor(level, RULES.proximity.far + 40, 70, 'x'));
  assert.ok(near.proximity > 2.4, `the near probe only reached ${near.proximity}`);
  assert.ok(far.proximity < near.proximity * 0.7,
    `the probes are too close together: ${near.proximity} and ${far.proximity}`);
  assert.ok(near.rate > far.rate * 1.6,
    `each step near him (${near.rate.toFixed(5)}/unit) should cost far more than far off (${far.rate.toFixed(5)}/unit)`);
  // ...and the far end is still most of the price. Being at the other end of
  // the school is quieter, never free.
  assert.ok(far.proximity >= 0.8, `the far end fell to ${far.proximity}`);
  // ...and by the amount the curve says, not merely more.
  assert.ok(Math.abs(near.rate / far.rate - near.proximity / far.proximity) < 0.6,
    `the ratio ${(near.rate / far.rate).toFixed(2)} should track the curve ${(near.proximity / far.proximity).toFixed(2)}`);
});

test('a knock into furniture costs more near him as well', () => {
  const level = SCHOOL[0];
  // A piece of furniture with a clear run-up from above, found rather than
  // assumed, so the same collision can be staged twice.
  const runUp = 30;
  const SIDES = [
    { dx: 0, dy: -1, push: { x: 0, y: 1 } }, { dx: 0, dy: 1, push: { x: 0, y: -1 } },
    { dx: -1, dy: 0, push: { x: 1, y: 0 } }, { dx: 1, dy: 0, push: { x: -1, y: 0 } }
  ];
  let target = null;
  for (const c of level.colliders) {
    if (c.type !== 'furniture' || target) continue;
    for (const side of SIDES) {
      const from = {
        x: c.x + c.w / 2 + side.dx * (side.dx ? c.w / 2 + runUp : 0),
        y: c.y + c.h / 2 + side.dy * (side.dy ? c.h / 2 + runUp : 0)
      };
      let clear = true;
      // Only the run-up itself: the last few units are the collision, and are
      // supposed to be blocked.
      for (let d = 0; d <= runUp - 14; d += 3) {
        const x = from.x - side.dx * d * (side.dx ? 1 : 0);
        const y = from.y - side.dy * d * (side.dy ? 1 : 0);
        if (blocked(x, y, TUNING.player.boxWidth, TUNING.player.boxHeight, level.colliders)) { clear = false; break; }
      }
      if (clear) { target = { c, from, push: side.push }; break; }
    }
  }
  assert.ok(target, 'the school should have something with space in front of it');

  // The only difference between the two runs is where the caretaker is
  // standing — the collision itself is identical.
  const knock = (distance) => {
    const sim = createSim({ level });
    const park = () => {
      sim.investigator.x = target.from.x;
      sim.investigator.y = target.from.y + distance;
    };
    park();
    place(sim, target.from.x, target.from.y);
    for (let i = 0; i < 90; i++) {
      stepSim(sim, { ...target.push, take: false });
      park();   // hold the distance while the player closes on the furniture
      const bump = sim.events.find((e) => e.type === 'bump');
      if (bump) return bump;
    }
    return null;
  };

  const near = knock(20);                              // standing right there
  const far = knock(RULES.proximity.far + 60);         // a corridor away
  assert.ok(near && far, 'both probes should have hit something');
  assert.ok(near.noise > far.noise * 2,
    `a knock costs ${near.noise} beside him and ${far.noise} down the corridor`);
});

// --- standing still brings it back down -------------------------------------

test('the school settles faster than the rest of the game, but not instantly', () => {
  assert.ok(RULES.recovery.rate > TUNING.recovery.rate, 'the school should come down faster');
  assert.ok(RULES.recovery.delay > TUNING.recovery.delay, '...and make you wait longer to start');
  const run = openSchool();
  // Below the line he gets up at, so this measures the meter and nothing else.
  // Start it above and he is on his feet and walking at a player who is holding
  // perfectly still, which tests something quite different and rather final.
  const before = RULES.investigate.wakeAt - 4;
  run.sim.noise = before;
  for (let i = 0; i < Math.floor(RULES.recovery.delay * 60) - 2; i++) tick(run);
  assert.equal(run.sim.noise, before, 'nothing should happen during the delay');
  for (let i = 0; i < 60 * 3; i++) tick(run);
  assert.ok(run.sim.noise < before - 3 * RULES.recovery.rate + 2,
    'it should be coming down by now');
  assert.ok(run.sim.noise > 12, 'but nowhere near a reset');
});

test('moving stops it settling', () => {
  const run = openSchool();
  const spot = openRunOfFloor(run.level, RULES.proximity.far + 40, 70, 'x');
  place(run.sim, spot.x, spot.y);
  run.sim.noise = 60;
  // Pace up and down a clear stretch: genuinely moving, so nothing settles.
  for (let i = 0; i < 60 * 3; i++) tick(run, { x: i % 40 < 20 ? -1 : 1, y: 0, take: false });
  assert.ok(run.sim.noise >= 60, `noise fell to ${run.sim.noise.toFixed(1)} while moving`);
});

// --- he gets up, and he goes where the noise was ----------------------------

test('crossing 80 wakes him and stores where you were, not where you go', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  assert.equal(w.state, 'asleep');
  // On a clear run rather than at the spawn: the point of the test is to walk
  // away from where the meter was crossed, which needs somewhere to walk to.
  const lane = openRunOfFloor(sim.level, 260, 150, 'x');
  const at = place(sim, lane.x, lane.y);

  sim.noise = RULES.investigate.wakeAt - 1;
  tick(run);
  assert.equal(w.state, 'asleep', 'he should sleep through anything at or under 80');

  sim.noise = RULES.investigate.wakeAt + 1;
  tick(run);
  assert.equal(w.state, 'rising');
  // Not the exact spot any more — he heard something through a wall, and his
  // guess is off by an amount that shrinks as the meter rises. What must hold
  // is that it is a guess at where the noise *was*, and that it is inside the
  // error the tuning says he is capable of.
  assert.ok(Math.hypot(w.target.x - at.x, w.target.y - at.y) <= ALERT.blur + 30,
    'his guess should at least be in the right part of the building');

  // Now leave, along the lane we were put on. The target must not follow.
  // The meter is *pinned* rather than floored: a rising meter is a fresh noise,
  // and a fresh noise is allowed to narrow his guess. What must never happen is
  // his guess tracking a player who is not making any.
  let stored = { ...w.target };
  const away = lane.x > sim.level.width / 2 ? -1 : 1;
  for (let i = 0; i < 60 * 3; i++) {
    sim.noise = RULES.investigate.wakeAt + 1;
    tick(run, { x: away, y: 0, take: false });
    // Treading on something is a fresh noise, and a fresh noise is allowed to
    // move his guess — that is the mechanic working, not it failing. What must
    // never happen is the guess drifting after a player who is walking quietly.
    if (sim.events.some((e) => e.type === 'creak' || e.type === 'bump')) {
      stored = { ...w.target };
      continue;
    }
    assert.deepEqual(w.target, stored, 'he must investigate the place, not track the person');
  }
  assert.ok(Math.hypot(playerOf(sim).x - stored.x, playerOf(sim).y - stored.y) > 60,
    'the player really did move away');
});

test('getting up takes long enough to be a warning rather than a cut', () => {
  // Four beats — stirs, lifts his head, stands, looks round — need room to
  // read. How much room now depends on what woke him: a distant clatter gets a
  // slow, confused start, a bookcase going over gets him up sharply. Both ends
  // are asserted, because the slow end is the warning and the quick end is the
  // thing that makes a loud mistake feel loud.
  assert.ok(ALERT.riseLow >= 1.6, `${ALERT.riseLow}s is not a confused start`);
  assert.ok(ALERT.riseHigh >= 0.6, `${ALERT.riseHigh}s is a cut, not a wake-up`);
  assert.ok(ALERT.riseHigh < ALERT.riseLow, 'a louder noise should get him up quicker');

  const upIn = (noise) => {
    const run = openSchool();
    const { sim } = run;
    const w = sim.investigator;
    place(sim, sim.level.spawn.x, sim.level.spawn.y);
    sim.noise = noise;
    tick(run);
    // He must not move an inch until he is on his feet: a man still in the
    // chair sliding towards you is the exact bug this sequence prevents.
    const from = { x: w.x, y: w.y };
    let frames = 0;
    while (w.state === 'rising' && frames < 60 * 6) {
      place(sim, 5000, 5000);
      sim.noise = noise;
      tick(run);
      frames++;
      assert.ok(Math.hypot(w.x - from.x, w.y - from.y) < 40,
        'he should get out of the chair, not set off from it');
    }
    assert.equal(w.state, 'investigating');
    return frames / 60;
  };

  const quiet = upIn(RULES.investigate.wakeAt + 1);
  const loud = upIn(99);
  assert.ok(quiet >= 1.6, `barely disturbed, he was up after ${quiet.toFixed(2)}s`);
  assert.ok(loud >= 0.6, `even at full alert, ${loud.toFixed(2)}s is a cut`);
  assert.ok(loud < quiet - 0.4,
    `${loud.toFixed(2)}s against ${quiet.toFixed(2)}s is not a reaction to how loud it was`);
});

test('he walks there — through the doorways, never through the walls', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  let arrivedAt = null;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);

  let peak = 0;
  for (let i = 0; i < 60 * 20 && sim.status === 'running'; i++) {
    if (w.state !== 'searching' && w.state !== 'returning') sim.noise = Math.max(sim.noise, 85);
    // Keep the player out of his way so this tests walking, not catching.
    place(sim, 5000, 5000);
    tick(run);
    peak = Math.max(peak, w.speed);
    // The only claim that matters: once he is walking, he is never inside the
    // building. (He is inside his own couch while he is still getting off it,
    // which is what a couch is.)
    if (w.state === 'investigating' || w.state === 'returning' || w.state === 'searching') {
      assert.ok(!blocked(w.x, w.y, w.w, w.h, sim.level.colliders),
        `he is inside geometry at ${w.x.toFixed(0)},${w.y.toFixed(0)} (${w.state})`);
    }
    if (w.state === 'searching') { arrivedAt = Math.hypot(w.x - w.target.x, w.y - w.target.y); break; }
  }
  assert.equal(w.state, 'searching', 'he should have arrived');
  // Measured the instant he arrives, not afterwards: a fresh noise while he is
  // standing there moves his target, which is the refix doing its job.
  assert.ok(arrivedAt !== null && arrivedAt <= RULES.investigate.arriveAt + 4,
    `he stopped ${arrivedAt === null ? '?' : arrivedAt.toFixed(0)} from the spot he was heading for`);
  assert.ok(peak > 0 && peak <= topSpeed() + 1, `he moved at ${peak.toFixed(0)}, a walk`);
});

test('he accelerates and decelerates rather than snapping to speed', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);
  const speeds = [];
  for (let i = 0; i < 60 * 3 && w.state !== 'searching'; i++) {
    sim.noise = Math.max(sim.noise, 85);
    place(sim, 5000, 5000);
    tick(run);
    if (w.state === 'investigating') speeds.push(w.speed);
  }
  assert.ok(speeds.length > 20);
  assert.ok(speeds[0] < RULES.investigate.speed * 0.7, 'his first step is not full speed');
  const top = Math.max(...speeds);
  assert.ok(top > RULES.investigate.speed * 0.9, 'he does get up to speed');
  // No teleporting: no single frame moves him further than his top speed allows.
  for (const s of speeds) assert.ok(s <= topSpeed() + 1, `${s} is faster than he can walk`);
});

// --- and he gives up ---------------------------------------------------------

test('under 50 he abandons it, walks home and goes back to sleep', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);
  place(sim, 5000, 5000);

  // Let him get properly under way, then go quiet.
  assert.ok(untilWalking(run), 'he should have got to his feet');
  for (let i = 0; i < 30; i++) { sim.noise = Math.max(sim.noise, 85); tick(run); }
  assert.equal(w.state, 'investigating');
  sim.noise = RULES.investigate.calmAt - 1;
  tick(run);
  assert.equal(w.state, 'returning', 'under 50 he should turn round');

  for (let i = 0; i < 60 * 40 && w.state !== 'asleep'; i++) tick(run);
  assert.equal(w.state, 'asleep');
  assert.equal(w.x, w.home.x, 'he goes back to exactly where he sleeps');
  assert.equal(w.y, w.home.y);
  assert.equal(w.target, null, 'and forgets about it');
});

test('he keeps investigating between 50 and 80 — the meter has to fall properly', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);
  place(sim, 5000, 5000);
  assert.ok(untilWalking(run), 'he should have got to his feet');
  for (let i = 0; i < 30; i++) { sim.noise = 65; tick(run); }
  assert.ok(w.state === 'investigating' || w.state === 'searching',
    `at 65 he should still be looking, not ${w.state}`);
});

test('noise going back over 80 sends him out again, to the new spot', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);
  const first = { ...w.target };
  place(sim, 5000, 5000);
  assert.ok(untilWalking(run), 'he should have got to his feet');
  for (let i = 0; i < 30; i++) { sim.noise = Math.max(sim.noise, 85); tick(run); }
  sim.noise = 10;
  for (let i = 0; i < 30; i++) tick(run);
  assert.ok(w.state === 'returning' || w.state === 'settling', `he should be on his way back, not ${w.state}`);

  // A second crash, somewhere else entirely.
  // Wherever in that corner he can actually stand — the corner itself is a
  // stack of lockers now, and what matters is that the target follows the
  // player's real position rather than a point picked on paper.
  const elsewhere = place(sim, sim.level.width - 60, 60);
  sim.noise = 90;
  tick(run);
  // Within the error he is capable of at this reading, not on the nose: he
  // heard it, he did not see it. What matters is that the *new* noise is what
  // he is working from now.
  // He works from the new noise now, but his estimate is blended from the old
  // one rather than replacing it — so what must be true is that it *moved
  // towards* the new spot, not that it landed on it.
  const off = Math.hypot(w.target.x - elsewhere.x, w.target.y - elsewhere.y);
  const was = Math.hypot(first.x - elsewhere.x, first.y - elsewhere.y);
  assert.ok(off < was, `the new noise should pull him towards it: ${was.toFixed(0)} -> ${off.toFixed(0)}`);
  assert.notDeepEqual(w.target, first);
  assert.ok(w.state === 'investigating' || w.state === 'rising',
    `a second noise must put him back to work, not leave him ${w.state}`);
});

test('walking into you ends the level through the ordinary door', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  sim.noise = 81;
  tick(run);
  // Stand exactly where the noise came from and wait for him.
  for (let i = 0; i < 60 * 25 && sim.status === 'running'; i++) {
    sim.noise = Math.max(sim.noise, 85);
    tick(run);
  }
  assert.equal(sim.status, 'lost');
  assert.equal(sim.failReason, 'caught');
  const ended = sim.events.find((e) => e.type === 'lost');
  assert.ok(ended, 'it should end through the same event every other loss uses');
});

test('he cannot catch you while he is getting up or lying down', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  // Standing right over him as he stirs is a fright, not a loss.
  place(sim, sim.level.watcher.x, sim.level.watcher.y - 26);
  sim.noise = 81;
  tick(run);
  assert.equal(w.state, 'rising');
  // How long *this* get-up takes. It is decided by how loud the thing that woke
  // him was and published on him for the renderer to draw to, so the guarantee
  // is "the length of his get-up" rather than the length of some other man's:
  // a bang beside his desk gets him up quicker than a clatter down the hall,
  // and the beat you have to back away in shortens with it.
  assert.ok(w.riseFor > 0.5, `a get-up of ${w.riseFor}s is not a beat`);
  for (let i = 0; i < Math.floor(w.riseFor * 60) - 2; i++) {
    place(sim, sim.level.watcher.x, sim.level.watcher.y - 26);
    tick(run);
  }
  assert.equal(sim.status, 'running', 'you get the length of his get-up to back away');
});

// --- the whole loop, on every school level ----------------------------------

test('every school level supports the full loop, from anywhere on the map', () => {
  for (const level of SCHOOL) {
    // Sample the map rather than testing one lucky spot: he has to be able to
    // reach, and come back from, everywhere a thief can stand.
    const grid = navGrid(level, TUNING.player.boxWidth, TUNING.player.boxHeight);
    const reachable = flowField(grid, level.spawn.x, level.spawn.y);
    const spots = [];
    for (let i = 0; i < reachable.length; i += 53) {
      if (reachable[i] < 0) continue;
      const cx = i % grid.cols;
      spots.push({ x: cx * grid.cell + grid.cell / 2,
        y: ((i - cx) / grid.cols) * grid.cell + grid.cell / 2 });
    }
    assert.ok(spots.length > 8, `L${level.id} sampled too few spots`);

    for (const spot of spots) {
      const sim = createSim({ level });
      sim.timeLeft = 9999;
      const w = sim.investigator;
      place(sim, spot.x, spot.y);
      sim.noise = 81;
      stepSim(sim);
      if (sim.status !== 'running') continue;   // the sample landed on the exit

      // Park the thief in whichever corner is furthest from where the guard is
      // headed, and keep him there. Clamping means there is no "off the map"
      // any more — and now that Mr. Vrána follows anyone who gets close, a
      // thief left standing beside the target simply gets caught, which would
      // prove nothing about whether he can walk a route.
      // The furthest reachable cell from where the guard is heading, taken off
      // the same nav grid rather than guessed at as a corner: the corners of a
      // furnished school are lockers, and a thief snapped out of one can land
      // right beside the man walking towards him.
      let away = null;
      let far = -1;
      const door = { x: level.exit.x + level.exit.w / 2, y: level.exit.y + level.exit.h / 2 };
      for (let i = 0; i < reachable.length; i += 7) {
        if (reachable[i] < 0) continue;
        const cx = i % grid.cols;
        const px = cx * grid.cell + grid.cell / 2;
        const py = ((i - cx) / grid.cols) * grid.cell + grid.cell / 2;
        // Not the way out. On an L-shaped floor the point furthest from him is
        // very often the exit, and parking the thief on it wins the level
        // instantly — which proves nothing about whether he can walk a route.
        if (Math.hypot(px - door.x, py - door.y) < 110) continue;
        const d = Math.hypot(px - w.target.x, py - w.target.y);
        if (d > far) { far = d; away = { x: px, y: py }; }
      }
      assert.ok(away, `L${level.id}: nowhere to park the thief`);
      // Somewhere reachable and, at any given moment, as far from the man as
      // this map allows. Now that he has eyes rather than a collision radius,
      // a thief parked on one fixed spot gets seen from most of a classroom
      // away and walked into — which tests his eyesight, not his routing, and
      // this test is about routing.
      const flee = (from) => {
        let best = away;
        let mostly = -1;
        for (let i = 0; i < reachable.length; i += 7) {
          if (reachable[i] < 0) continue;
          const cx = i % grid.cols;
          const px = cx * grid.cell + grid.cell / 2;
          const py = ((i - cx) / grid.cols) * grid.cell + grid.cell / 2;
          if (Math.hypot(px - door.x, py - door.y) < 110) continue;
          const d = Math.hypot(px - from.x, py - from.y);
          if (d > mostly) { mostly = d; best = { x: px, y: py }; }
        }
        return best;
      };
      let arrived = false;
      for (let i = 0; i < 60 * 140; i++) {
        if (sim.vision && Math.hypot(w.x - away.x, w.y - away.y) < sim.vision.range + 80) {
          away = flee(w);
        }
        place(sim, away.x, away.y);
        if (!arrived) sim.noise = Math.max(sim.noise, 85);
        stepSim(sim);
        if (!arrived && (w.state === 'searching' || w.state === 'returning')) arrived = true;
        if (arrived && w.state === 'asleep') break;
        if (sim.status !== 'running') break;
      }
      assert.ok(arrived, `L${level.id}: he never reached ${spot.x},${spot.y}`);
      assert.equal(w.state, 'asleep', `L${level.id}: he never got home from ${spot.x},${spot.y}`);
    }
  }
});

// --- the map he walks on agrees with the one he collides with ---------------

test('the navigation grid never claims a spot the physics would refuse', () => {
  for (const level of SCHOOL) {
    const grid = navGrid(level, TUNING.player.boxWidth + 2, TUNING.player.boxHeight);
    let checked = 0;
    for (let i = 0; i < grid.blocked.length; i++) {
      if (grid.blocked[i]) continue;
      const cx = i % grid.cols;
      const x = cx * grid.cell + grid.cell / 2;
      const y = ((i - cx) / grid.cols) * grid.cell + grid.cell / 2;
      assert.ok(!blocked(x, y, TUNING.player.boxWidth + 2, TUNING.player.boxHeight, level.colliders),
        `L${level.id}: the grid says ${x},${y} is walkable and the physics says otherwise`);
      checked++;
    }
    assert.ok(checked > 500, `L${level.id}: only ${checked} free cells`);
  }
});

// --- looking inside the furniture -------------------------------------------

const SEARCH = RULES.search;

// Stand next to a piece and open it, returning what happened.
function openStash(run, stash) {
  const p = playerOf(run.sim);
  // From whichever side the game actually offers to open it. One button serves
  // both mechanics now, and the spot below a bank of lockers is quite often the
  // gap you would hide in — where the button says HIDE, on purpose. Standing
  // there and pressing it is a test of the hiding place, not of the cupboard.
  const sides = [
    { x: stash.x + stash.w / 2, y: stash.y + stash.h + 16 },
    { x: stash.x + stash.w / 2, y: stash.y - 16 },
    { x: stash.x + stash.w + 16, y: stash.y + stash.h / 2 },
    { x: stash.x - 16, y: stash.y + stash.h / 2 }
  ];
  for (const at of sides) {
    p.x = at.x;
    p.y = at.y;
    p.prevX = p.x;
    p.prevY = p.y;
    tick(run);
    if (run.sim.searchTargetId === stash.id) break;
  }
  tick(run);
  const before = { noise: run.sim.noise, money: run.sim.money };
  tick(run, { x: 0, y: 0, take: false, search: true });
  const opened = !!run.sim.searching;
  let frames = 0;
  while (run.sim.searching && run.sim.status === 'running' && frames < 600) {
    tick(run, { x: 0, y: 0, take: false, search: false });
    frames++;
  }
  return {
    opened,
    seconds: frames / 60,
    noise: run.sim.noise - before.noise,
    money: run.sim.money - before.money,
    event: run.sim.events.find((e) => e.type === 'found')
  };
}

test('every building in the game has furniture worth opening', () => {
  for (const level of FLOORPLANS) {
    assert.ok(level.stashes.length >= 3,
      `L${level.id} (${level.location}) has ${level.stashes.length} searchable pieces`);
  }
});

test('...and plenty that is not worth opening', () => {
  // "Do not make every piece of furniture searchable." A cabinet you can look
  // inside has to be a thing you notice, and it is only a thing you notice if
  // most of the room is not one.
  for (const level of FLOORPLANS) {
    const furniture = level.colliders.filter((c) => c.type === 'furniture');
    const openable = furniture.filter((c) => c.searchable).length;
    assert.ok(openable < furniture.length,
      `L${level.id} (${level.location}) made every stick of furniture searchable`);
    assert.ok(openable / furniture.length <= 0.75,
      `L${level.id} (${level.location}) is ${Math.round(openable / furniture.length * 100)}% cupboards`);
  }
});

test('the vocabulary of what you can open is the building\'s own', () => {
  // A hotel hides things in wardrobes and an office in filing cabinets; the
  // style comes from the character the room grammar already used, so this is a
  // property of the buildings rather than a table somebody has to maintain.
  const styles = {};
  for (const level of FLOORPLANS) {
    for (const s of level.stashes) {
      (styles[level.location] = styles[level.location] || new Set()).add(s.style);
    }
  }
  const hotel = styles.Hotel || new Set();
  const office = styles.Office || new Set();
  assert.ok(hotel.has('wardrobe'), 'a hotel room has a wardrobe in it');
  assert.ok(office.has('table'), 'an office is desks');
  assert.ok(new Set(Object.values(styles).map((v) => [...v].sort().join(','))).size >= 5,
    'the eleven locations should not all open the same kind of furniture');
});

test('every school level has some empty furniture, or there is no decision', () => {
  for (const level of SCHOOL) {
    const empty = level.stashes.filter((s) => !s.item).length;
    const full = level.stashes.filter((s) => s.item).length;
    assert.ok(empty > 0, `L${level.id}: every cabinet pays out, so opening them is a chore`);
    assert.ok(full > 0, `L${level.id}: nothing to find`);
    assert.ok(full < level.stashes.length,
      `L${level.id}: ${full}/${level.stashes.length} is not a gamble`);
  }
});

test('the mechanic grows across the five levels', () => {
  const counts = SCHOOL.map((l) => l.stashes.length);
  const filled = SCHOOL.map((l) => l.stashes.filter((s) => s.item).length);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] > counts[i - 1], `searchable count fell at tier ${i + 1}: ${counts}`);
    assert.ok(filled[i] > filled[i - 1], `loot count fell at tier ${i + 1}: ${filled}`);
  }
  // ...and so does what is hidden in it.
  const worth = SCHOOL.map((l) => l.stashes.reduce(
    (sum, s) => sum + (s.item ? itemStats(s.item).value : 0), 0));
  for (let i = 1; i < worth.length; i++) {
    assert.ok(worth[i] > worth[i - 1], `hidden value fell at tier ${i + 1}: ${worth}`);
  }
});

test('opening something costs noise, time, and your ability to walk', () => {
  const run = openSchool();
  const { sim } = run;
  const stash = sim.stashes[sim.stashes.length - 1];   // furthest from him
  const p = playerOf(sim);
  p.x = stash.x + stash.w / 2;
  p.y = stash.y + stash.h + 16;
  p.prevX = p.x;
  p.prevY = p.y;
  tick(run);
  assert.equal(sim.searchTargetId, stash.id, 'it should offer itself when you are beside it');

  const before = { noise: sim.noise, clock: sim.timeLeft, x: p.x };
  tick(run, { x: 0, y: 0, take: false, search: true });
  assert.ok(sim.searching, 'the press should open it');
  assert.ok(sim.noise > before.noise, 'opening a drawer is not silent');
  assert.equal(sim.searchTargetId, null, 'nothing else is offered while his hands are busy');

  // Trying to run away mid-search barely moves him.
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0, take: false, search: false });
  assert.ok(Math.abs(p.x - before.x) < 14,
    `he covered ${Math.abs(p.x - before.x).toFixed(0)} units while rummaging`);

  let frames = 30;
  while (sim.searching && frames < 600) { tick(run); frames++; }
  assert.ok(Math.abs(frames / 60 - SEARCH.duration) < 0.1,
    `the search took ${(frames / 60).toFixed(2)}s, not ${SEARCH.duration}s`);
  assert.ok(before.clock - sim.timeLeft > SEARCH.duration, 'and it came off the clock');

  // ...and afterwards he moves normally again.
  const resumed = p.x;
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0, take: false, search: false });
  assert.ok(p.x - resumed > 20, 'normal movement should resume the moment it is over');
});

test('the same cupboard cannot be opened twice', () => {
  const run = openSchool();
  const stash = run.sim.stashes.find((s) => s.item);
  const first = openStash(run, stash);
  assert.ok(first.opened);
  assert.ok(first.money > 0);
  assert.ok(stash.searched);
  const again = openStash(run, stash);
  assert.equal(again.opened, false, 'it should not open again');
  assert.equal(again.money, 0);
  assert.equal(run.sim.searchTargetId, null, 'and it should stop offering itself');
});

test('an empty cupboard says so and costs you the noise anyway', () => {
  const run = openSchool();
  const stash = run.sim.stashes.find((s) => !s.item);
  const result = openStash(run, stash);
  assert.ok(result.opened);
  assert.equal(result.money, 0, 'nothing in it');
  assert.ok(result.noise > 0, 'you still opened it — that is the gamble');
  assert.ok(result.event && result.event.empty, 'the player has to be told it was empty');
  assert.ok(stash.searched, 'and it stays open');
});

test('finding something pays exactly what the same item pays off a shelf', () => {
  const run = openSchool();
  const stash = run.sim.stashes.find((s) => s.item);
  const result = openStash(run, stash);
  assert.equal(result.money, itemStats(stash.item).value);
  assert.equal(result.event.itemType, stash.item);
  assert.equal(result.event.empty, false);
});

test('opening something near Mr. Vrána is far louder than opening it across the school', () => {
  // The same cupboard, twice, with only the caretaker's position changed.
  const level = SCHOOL[0];
  const cost = (distance) => {
    const sim = createSim({ level });
    sim.timeLeft = 9999;
    const stash = sim.stashes[0];
    const p = playerOf(sim);
    p.x = stash.x + stash.w / 2;
    p.y = stash.y + stash.h + 16;
    p.prevX = p.x;
    p.prevY = p.y;
    const park = () => {
      sim.investigator.x = p.x;
      sim.investigator.y = p.y + distance;
    };
    park();
    stepSim(sim);
    park();
    stepSim(sim, { x: 0, y: 0, take: false, search: true });
    return sim.noise;
  };
  const near = cost(RULES.proximity.near - 30);
  const far = cost(RULES.proximity.far + 60);
  assert.ok(near > far * 2.5, `opening it beside him costs ${near}, across the school ${far}`);
  assert.ok(far > 2, `opening it across the school costs ${far} — that is silent, not safer`);
});

// What opening a given cupboard actually costs, in meter, at its own distance
// from the caretaker: the search plus whatever has to be lifted out of it.
function costOfOpening(level, stash) {
  const rules = locationRules(level);
  const distance = Math.hypot(
    stash.x + stash.w / 2 - level.watcher.x,
    stash.y + stash.h / 2 - level.watcher.y);
  const base = rules.search.noise[stash.style] + (stash.item ? itemStats(stash.item).noise : 0);
  return base * proximityScale(rules, distance);
}

const dearest = (level) => level.stashes
  .reduce((a, b) => (costOfOpening(level, a) >= costOfOpening(level, b) ? a : b));

test('no single cupboard can cost more meter than the player can absorb', () => {
  // The ceiling is the whole balance of the mechanic. A search that can run to
  // eighty on its own is not a risk, it is a trap: you cannot arrive with any
  // noise, and you cannot walk away afterwards. The generator places loot
  // against this same number, so this test is also what keeps the two in step.
  for (const level of SCHOOL) {
    for (const stash of level.stashes) {
      const cost = costOfOpening(level, stash);
      assert.ok(cost <= 60,
        `L${level.id}: opening the ${stash.style} for ${stash.item || 'nothing'} ` +
        `costs ${cost.toFixed(0)} — nothing survives that`);
    }
  }
});

test('the school hides its best things where they are worth thinking about', () => {
  // Not next to the exit, and not in the one cupboard beside his couch either.
  // Somewhere the meter notices.
  for (const level of SCHOOL) {
    const best = level.stashes.filter((s) => s.item)
      .reduce((a, b) => (itemStats(a.item).value >= itemStats(b.item).value ? a : b));
    const cost = costOfOpening(level, best);
    assert.ok(cost > level.tier * 4,
      `L${level.id}: the best hidden thing costs ${cost.toFixed(0)} — no decision in that`);
  }
  // ...and the top two levels have at least one that is genuinely expensive.
  for (const level of SCHOOL.slice(3)) {
    // A third of the meter in one press is a decision worth making twice.
    assert.ok(costOfOpening(level, dearest(level)) > 30,
      `L${level.id} has nothing worth hesitating over`);
  }
});

test('a search that crosses 80 wakes him through the ordinary door', () => {
  // No separate guard reaction: the same threshold, the same stored spot, the
  // same walk. A search is just another way to make noise.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const stash = dearest(sim.level);
  const cost = costOfOpening(sim.level, stash);
  // Start where opening it lands him over eighty but under a hundred: this is
  // about who reacts, not about losing the level to the meter.
  sim.noise = RULES.investigate.wakeAt - cost + 8;
  const p = playerOf(sim);
  p.x = stash.x + stash.w / 2;
  p.y = stash.y + stash.h + 16;
  p.prevX = p.x;
  p.prevY = p.y;
  tick(run);
  assert.equal(w.state, 'asleep');
  tick(run, { x: 0, y: 0, take: false, search: true });
  while (sim.searching && sim.status === 'running') tick(run);
  assert.ok(sim.noise > RULES.investigate.wakeAt,
    `opening it only reached ${sim.noise.toFixed(0)}`);
  assert.notEqual(w.state, 'asleep', 'he should be getting up');
  assert.ok(w.target, 'and he should have somewhere to go');
  const off = Math.hypot(w.target.x - p.x, w.target.y - p.y);
  assert.ok(off <= guessError(sim.noise) + 40,
    `he should be heading for roughly the cupboard, not ${off.toFixed(0)} away`);
});

test('the dearest cupboard on the map is worth it, and survivable', () => {
  // Level five keeps something expensive well inside his hearing. That has to
  // be a decision rather than a trap: taking it costs real meter, and it must
  // still be possible to get out afterwards by playing the loop properly.
  const run = createRun(25);
  const { sim } = run;
  const stash = dearest(sim.level);
  assert.ok(stash.item, 'the dearest thing to open should have something in it');
  const cost = costOfOpening(sim.level, stash);
  assert.ok(cost > 30, `the riskiest cupboard only costs ${cost.toFixed(0)}`);

  walkTo(run, { x: stash.x + stash.w / 2, y: stash.y + stash.h + 20 }, 60 * 30);
  tick(run, { x: 0, y: 0, take: false, search: true });
  while (sim.searching && sim.status === 'running') tick(run);
  assert.equal(sim.status, 'running', 'taking it must not simply lose the level');
  assert.equal(sim.money, itemStats(stash.item).value);

  // Whether or not that woke him, the loop has to close — but in that order.
  // Get off the spot he has a fix on, go quiet, let him lose it, *then* leave.
  // Marching across the building to the far side while he is up and hunting is
  // how you get walked into, and it is supposed to be.
  assert.ok(slipAway(run, 60 * 10), 'getting off the spot and going quiet should settle it');
  const result = escape(run);
  assert.equal(result.status, 'won', `could not get out: ${result.reason}`);
  assert.ok(result.money >= itemStats(stash.item).value);
});

test('you can still ignore every cupboard and win', () => {
  // Option A has to stay open, or the mechanic is a tax rather than a choice.
  for (const level of SCHOOL) {
    const { run, result } = playEfficiently(level.id);
    assert.equal(result.status, 'won', `L${level.id} not winnable without searching`);
    assert.ok(run.sim.stashes.every((s) => !s.searched),
      `L${level.id}: the efficient run searched something, so this proves nothing`);
  }
});

// --- most of the loot is hidden (section 1) ---------------------------------

test('most of what a school level is worth is inside the furniture', () => {
  for (const level of SCHOOL) {
    const onFloor = level.items.reduce((sum, i) => sum + itemStats(i.type).value, 0);
    const hidden = level.stashes.reduce(
      (sum, s) => sum + (s.item ? itemStats(s.item).value : 0), 0);
    const share = hidden / (hidden + onFloor);
    assert.ok(share >= 0.70 && share <= 0.85,
      `L${level.id}: ${(share * 100).toFixed(0)}% hidden ($${hidden} of $${hidden + onFloor})`);
    // ...and there is still something on the floor to get you moving.
    assert.ok(level.items.length >= 3, `L${level.id} has nothing visible at all`);
    assert.ok(level.items.length <= 6,
      `L${level.id} still has ${level.items.length} things lying about`);
  }
});

test('most of what any level is worth is inside the furniture', () => {
  // The same promise, everywhere. Two locations deliberately sit lower than the
  // rest: a museum puts its value on plinths in the middle of the hall and a
  // shop puts it on the shelves, and hiding all of that in the staff-room
  // cupboards would be turning them into the school.
  // A museum puts its value on plinths in the middle of the hall; a vault puts
  // it in the deposit boxes, and its guard is close enough to everything that
  // the noise ceiling refuses to let anything expensive be hidden in a drawer
  // near him. Both are the location being itself rather than the mechanic
  // being missing.
  const OPEN_HANDED = new Set(['Museum', 'Vault']);
  for (const level of FLOORPLANS) {
    const onFloor = level.items.reduce((sum, i) => sum + itemStats(i.type).value, 0);
    const hidden = level.stashes.reduce(
      (sum, s) => sum + (s.item ? itemStats(s.item).value : 0), 0);
    const share = hidden / (hidden + onFloor);
    const least = OPEN_HANDED.has(level.location) ? 0.30 : 0.60;
    assert.ok(share >= least && share <= 0.88,
      `L${level.id} (${level.location}): ${(share * 100).toFixed(0)}% hidden`);
    assert.ok(level.items.length >= 3, `L${level.id} has nothing visible at all`);
  }
  // ...and the game as a whole lands inside the band the brief actually asks
  // for, which no single level has to hit on its own.
  let hidden = 0;
  let onFloor = 0;
  for (const level of FLOORPLANS) {
    onFloor += level.items.reduce((sum, i) => sum + itemStats(i.type).value, 0);
    hidden += level.stashes.reduce((sum, s) => sum + (s.item ? itemStats(s.item).value : 0), 0);
  }
  const share = hidden / (hidden + onFloor);
  assert.ok(share >= 0.70 && share <= 0.85,
    `the game is ${(share * 100).toFixed(0)}% hidden overall`);
});

test('the star targets count what is hidden, or a school level looks empty', () => {
  for (const level of SCHOOL) {
    assert.ok(lootOf(level).length > level.items.length,
      `L${level.id}: the totals are ignoring the cupboards`);
    // Three stars must be out of reach of the floor alone — otherwise the
    // mechanic is optional decoration.
    const onFloor = level.items.reduce((sum, i) => sum + itemStats(i.type).value, 0);
    assert.ok(starThresholds(level).three > onFloor,
      `L${level.id}: three stars without opening anything`);
  }
});

// --- the sensitivity curve (sections 4 and 5, tests A and B) ----------------

test('A and B: the same noise costs much more near him, and never nothing far off', () => {
  const rules = locationRules(SCHOOL[0]);
  const at = (d) => proximityScale(rules, d);
  // Continuous, monotonic, and never collapsing to zero — five conceptual
  // bands rather than three switched zones.
  const bands = [0, 60, 140, 260, 420, 700].map(at);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i] <= bands[i - 1] + 1e-9, `sensitivity rose again: ${bands}`);
  }
  assert.ok(bands[0] >= 2.5, `standing over him is only ${bands[0]}x`);
  assert.ok(bands[bands.length - 1] >= 0.8,
    `the far corner is ${bands[bands.length - 1]}x — that is silence, not distance`);
  assert.ok(bands[0] / bands[bands.length - 1] >= 2.5, 'the two ends are too close together');
  // Middle distance still hurts.
  assert.ok(at(260) >= 1.4, `a corridor away is only ${at(260)}x`);
});

test('most of a school map sits on the slope, not at the bottom of the curve', () => {
  // The claim worth testing is not how big the number is, it is that the
  // building is inside the part of the curve that still changes. If half the
  // cupboards sat at the floor value, distance would have stopped being a
  // decision everywhere except beside his couch.
  for (const level of SCHOOL) {
    const rules = locationRules(level);
    const scales = level.stashes.map((s) => proximityScale(rules, Math.hypot(
      s.x + s.w / 2 - level.watcher.x, s.y + s.h / 2 - level.watcher.y)));
    const sloping = scales.filter((v) => v > rules.proximity.farScale + 0.05).length;
    assert.ok(sloping >= scales.length * 0.5,
      `L${level.id}: only ${sloping} of ${scales.length} cupboards are on the slope`);
  }
});

// --- the moving zone (sections 7 and 8, tests C and D) ----------------------

test('C and D: waking him makes the ground around him louder, and it moves with him', () => {
  const rules = locationRules(SCHOOL[0]);
  const beside = 40;
  assert.ok(proximityScale(rules, beside, true) > proximityScale(rules, beside, false) * 1.5,
    'being awake should sharpen his hearing considerably');
  // The boost eases off across his radius rather than switching at its edge.
  const inside = [20, 70, 130, 190].map((d) =>
    proximityScale(rules, d, true) / proximityScale(rules, d, false));
  for (let i = 1; i < inside.length; i++) {
    assert.ok(inside[i] < inside[i - 1], `the awake boost is not continuous: ${inside}`);
  }
  assert.ok(inside[0] > 1.5 && inside[inside.length - 1] < 1.15,
    `the boost should fall from strong to nothing: ${inside}`);
  // ...and past his attention it is exactly the sleeping curve again.
  const out = rules.awake.radius + 60;
  assert.equal(proximityScale(rules, out, true), proximityScale(rules, out, false));
});

test('C: the meter really does read louder once he is up, at the same spot', () => {
  const level = SCHOOL[0];
  const cost = (wake) => {
    const sim = createSim({ level });
    sim.timeLeft = 9999;
    const p = playerOf(sim);
    // Two tiles from wherever he is, asleep or up.
    p.x = sim.investigator.x + 44;
    p.y = sim.investigator.y;
    p.prevX = p.x;
    p.prevY = p.y;
    if (wake) sim.investigator.state = 'searching';
    stepSim(sim);
    return sim.proximity;
  };
  assert.ok(cost(true) > cost(false) * 1.5,
    `asleep ${cost(false).toFixed(2)} vs awake ${cost(true).toFixed(2)}`);
});

// --- following (sections 9 to 13, tests E and F) ----------------------------

// Wake him and get him on his feet, with the thief parked out of reach.
function rouse(run, parkAt) {
  const { sim } = run;
  const w = sim.investigator;
  place(sim, parkAt.x, parkAt.y);
  sim.noise = 85;
  for (let i = 0; i < 60 * 8 && w.state !== 'investigating'; i++) {
    place(sim, parkAt.x, parkAt.y);
    sim.noise = Math.max(sim.noise, 85);
    tick(run);
  }
  return w.state === 'investigating';
}

test('E: he stops guessing and comes after you once you are close enough', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  const far = { x: sim.level.width - 60, y: 60 };
  assert.ok(rouse(run, far), 'he should be up and investigating');
  assert.equal(w.state, 'investigating');
  const memory = { ...w.target };

  // Stand where he cannot miss you: near enough that his certainty climbs
  // quickly, far enough that he has not simply walked into you. Give it a
  // couple of seconds, because being picked out is no longer a line you step
  // over — it is a certainty that fills.
  const close = RULES.investigate.catchAt + 22;
  for (let i = 0; i < 60 * 3; i++) {
    place(sim, w.x + close, w.y);
    sim.noise = Math.max(sim.noise, 85);
    tick(run);
    if (w.state === 'following') break;
  }
  assert.equal(w.state, 'following', 'he should have picked you out');
  // Following is not investigating: his goal is you, not the old noise.
  const p = playerOf(sim);
  assert.ok(Math.hypot(w.goal.x - p.x, w.goal.y - p.y)
    < Math.hypot(w.goal.x - memory.x, w.goal.y - memory.y),
    'he should be walking at you, not at where the noise was');
});

test('E: he does not pick you out from across the room — only up close', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  assert.ok(rouse(run, { x: sim.level.width - 60, y: 60 }));
  // Beyond what he can make out at all, for a long time, with the meter high.
  let held = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const at = placeAway(sim, w, sim.vision.range + 80);
    sim.noise = Math.max(sim.noise, 85);
    tick(run);
    if (!at || at.d <= sim.vision.range) continue;   // the room put us in range
    held++;
    assert.notEqual(w.state, 'following',
      `he started following from ${at.d.toFixed(0)} away`);
  }
  assert.ok(held > 60, `only ${held} frames were actually spent out of range`);
});

test('F: he loses you again, but only after real distance held for real time', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  assert.ok(rouse(run, { x: sim.level.width - 60, y: 60 }));
  for (let i = 0; i < 60 * 4 && w.state !== 'following'; i++) {
    place(sim, w.x + RULES.investigate.catchAt + 22, w.y);
    tick(run);
  }
  assert.equal(w.state, 'following');

  // Stepping back a little must not shake him off: that is the hysteresis, and
  // it is measured against the distance he gives up at rather than the distance
  // he first saw you at — the two are far apart on purpose.
  for (let i = 0; i < 60 * 3; i++) {
    // In whichever direction the room actually has that much space. Asking for
    // a spot due east of him on a six-hundred-unit map walks off the end of it,
    // and `place` answers by snapping to the nearest standable tile — which
    // can be the one he is standing on.
    const at = placeAway(sim, w, RULES.investigate.unfollowAt - 60);
    if (!at) continue;
    tick(run);
    assert.equal(w.state, 'following',
      `a step back to ${at.d.toFixed(0)} should not lose him`);
  }

  // Real distance, held. He should give up — but not instantly.
  //
  // Held, not parked: a thief who stands in a corner while a man walks at him
  // gets walked into, and always should. What this is about is whether keeping
  // the distance sheds him, so the thief keeps the distance — put back to
  // whichever standable spot is furthest from the man, every frame.
  const away = () => {
    let best = { x: 40, y: 40 };
    let far = -1;
    for (let ty = 1; ty < sim.level.tiles.rows - 1; ty += 2) {
      for (let tx = 1; tx < sim.level.tiles.cols - 1; tx += 2) {
        const px = tx * 20 + 10;
        const py = ty * 20 + 10;
        const d = Math.hypot(px - w.x, py - w.y);
        if (d > far) { far = d; best = { x: px, y: py }; }
      }
    }
    return best;
  };
  let gaveUpAfter = null;
  for (let i = 0; i < 60 * 12; i++) {
    const spot = away();
    place(sim, spot.x, spot.y);
    tick(run);
    if (w.state !== 'following') { gaveUpAfter = i / 60; break; }
  }
  assert.ok(gaveUpAfter !== null, 'he should eventually give up');
  assert.ok(gaveUpAfter >= RULES.investigate.unfollowFor - 0.1,
    `he gave up after ${gaveUpAfter}s, sooner than the ${RULES.investigate.unfollowFor}s configured`);
  assert.ok(['searching', 'returning', 'settling', 'asleep'].includes(w.state),
    `he ended up ${w.state}`);
});

test('F: losing you sends him back through the ordinary states, not to a dead end', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
  assert.ok(rouse(run, { x: sim.level.width - 60, y: 60 }));
  for (let i = 0; i < 60 * 4 && w.state !== 'following'; i++) {
    place(sim, w.x + 40, w.y);
    tick(run);
  }
  assert.equal(w.state, 'following');
  sim.noise = 10;
  for (let i = 0; i < 60 * 60 && w.state !== 'asleep'; i++) {
    place(sim, 40, 40);
    tick(run);
  }
  assert.equal(w.state, 'asleep', 'he should end up back on his couch');
  assert.equal(w.x, w.home.x);
  assert.equal(w.y, w.home.y);
});

test('following never walks him through the building', () => {
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  assert.ok(rouse(run, { x: sim.level.width - 60, y: 60 }));
  // Lead him a dance around the map and check every frame of it.
  const laps = [{ x: 80, y: 80 }, { x: sim.level.width - 80, y: 80 },
    { x: sim.level.width - 80, y: sim.level.height - 80 }, { x: 80, y: sim.level.height - 80 }];
  for (const corner of laps) {
    for (let i = 0; i < 60 * 6; i++) {
      // Stay just close enough to keep him interested.
      const p = playerOf(sim);
      const dx = corner.x - p.x;
      const dy = corner.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      tick(run, { x: dx / d, y: dy / d, take: false, search: false });
      sim.noise = Math.min(90, Math.max(sim.noise, 60));
      if (w.state === 'investigating' || w.state === 'following') {
        assert.ok(!blocked(w.x, w.y, w.w, w.h, sim.level.colliders),
          `he is inside the building at ${w.x.toFixed(0)},${w.y.toFixed(0)} (${w.state})`);
      }
      assert.ok(w.speed <= topSpeed() + 1,
        `he moved at ${w.speed.toFixed(0)} — that is not a walk`);
      if (sim.status !== 'running') break;
    }
    if (sim.status !== 'running') break;
  }
});

// --- searching under the new curve (tests G and H) --------------------------

test('G and H: searching near him is far riskier, and searching far off is not free', () => {
  const level = SCHOOL[4];
  const cost = (distance) => {
    const sim = createSim({ level });
    sim.timeLeft = 9999;
    const stash = sim.stashes[0];
    const p = playerOf(sim);
    p.x = stash.x + stash.w / 2;
    p.y = stash.y + stash.h + 16;
    p.prevX = p.x;
    p.prevY = p.y;
    const park = () => {
      sim.investigator.x = p.x;
      sim.investigator.y = p.y + distance;
    };
    park();
    stepSim(sim);
    park();
    stepSim(sim, { x: 0, y: 0, take: false, search: true });
    return sim.noise;
  };
  const near = cost(RULES.proximity.near - 30);
  const far = cost(RULES.proximity.far + 100);
  assert.ok(near > far * 2.5, `beside him ${near}, across the school ${far}`);
  assert.ok(far >= 2, `${far} is silent — searching should never be free`);
});

test('F: running opens a gap, and holding it loses him', () => {
  // Tested on a stretch of clear floor rather than on a particular route
  // through a particular map: what has to be true is that he is the slower
  // one and that distance held is what sheds him. Whether a given corner of a
  // given school gives you room to do it is level design, not this mechanic.
  const run = openSchool(23);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  sim.timeLeft = 9999;
  // The longest straight on the map, run from one end towards the other. Asking
  // only for clearance either side of a point can hand back the middle of a
  // stretch that ends in a wall, and being cornered is not the same thing as
  // being outrun.
  const lane = longestLane(sim.level, 'x');
  assert.ok(lane.span > 300, `the longest straight is only ${lane.span} units`);
  place(sim, lane.from + 90, lane.across);
  w.state = 'investigating';
  w.stand = { x: lane.from + 50, y: lane.across };
  w.x = lane.from + 50;
  w.y = lane.across;
  w.prevX = w.x;
  w.prevY = w.y;
  w.target = { x: p.x, y: p.y };
  sim.noise = 85;
  // Forty units away is well inside what he can see, but seeing is no longer
  // instantaneous: his certainty fills over about a second at this range, and
  // that second is the point of the mechanic.
  for (let i = 0; i < 60 * 3 && w.state !== 'following'; i++) {
    // Keeping the distance while it fills. Standing there would simply let him
    // walk the forty units and take you, which is a different mechanic.
    place(sim, w.x + 90, w.y);
    tick(run);
  }
  assert.equal(w.state, 'following', 'ninety units away is well inside his range');

  const gaps = [];
  let shaken = null;
  for (let i = 0; i < 60 * 14 && sim.status === 'running'; i++) {
    sim.noise = Math.max(sim.noise, 70);   // he must not simply calm down
    tick(run, { x: 1, y: 0, take: false, search: false });
    gaps.push(Math.hypot(p.x - w.x, p.y - w.y));
    if (w.state !== 'following') { shaken = i / 60; break; }
  }
  assert.equal(sim.status, 'running', `he caught you on open floor: ${sim.failReason}`);
  assert.ok(Math.max(...gaps) > RULES.investigate.unfollowAt,
    `running only ever opened ${Math.max(...gaps).toFixed(0)} — he is not slow enough`);
  assert.ok(shaken !== null, 'holding the gap should lose him');
  assert.ok(shaken >= RULES.investigate.unfollowFor,
    `he gave up after ${shaken}s, faster than the ${RULES.investigate.unfollowFor}s configured`);
  assert.ok(shaken < 10, `it took ${shaken}s to shake him off`);
  assert.ok(RULES.investigate.speed < TUNING.player.speed,
    'he must be slower than you, or none of this is escapable');
});

// --- section 1 to 8: eyes, and what he does with them ------------------------

// How long it takes him to become certain, standing at a given distance.
function noticeAt(run, distance, { moving = true } = {}) {
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  // Back to the top of the mechanic. Left in `following` he is already certain
  // by definition — the state pins it — and every reading after the first would
  // come back as nought seconds.
  if (w.state === 'following') w.state = 'investigating';
  w.notice = 0;
  w.lostFor = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const at = placeAway(sim, w, distance);
    if (!at) return null;
    // A thief who is walking is a thief he can pick out; one holding still
    // against the lockers is most of the way to being furniture. Put back on
    // the spot every frame, so the *speed* is what differs and not the
    // distance — and it has to be the speed the simulation reads off the
    // entity, because setting `moving` by hand is overwritten before the eyes
    // are consulted.
    p.speed = moving ? TUNING.player.speed : 0;
    p.vx = moving ? TUNING.player.speed : 0;
    p.vy = 0;
    sim.noise = Math.max(sim.noise, 85);
    tick(run);
    if (w.notice >= 1) return i / 60;
    if (sim.status !== 'running') return null;
  }
  return Infinity;
}

test('being seen is a matter of degree, and the degree is distance', () => {
  const run = openSchool(25);
  const { sim } = run;
  assert.ok(rouse(run, { x: sim.level.width - 80, y: 80 }));
  const eye = sim.vision;
  const near = noticeAt(run, eye.sure + 30);
  const mid = noticeAt(run, eye.sure + (eye.range - eye.sure) * 0.55);
  assert.ok(near !== null && mid !== null, 'the map should have room for both');
  assert.ok(near < mid,
    `close took ${near}s and mid-range ${mid}s — closer has to be quicker`);
  // ...and past the edge of what he can make out, never.
  const beyond = noticeAt(run, eye.range + 70);
  assert.ok(beyond === null || beyond === Infinity,
    `he became certain from ${eye.range + 70} away in ${beyond}s`);
});

test('holding still is most of what hides you from him', () => {
  const run = openSchool(25);
  const { sim } = run;
  assert.ok(rouse(run, { x: sim.level.width - 80, y: 80 }));
  const at = sim.vision.sure + (sim.vision.range - sim.vision.sure) * 0.4;
  const walking = noticeAt(run, at, { moving: true });
  const frozen = noticeAt(run, at, { moving: false });
  assert.ok(walking !== null && frozen !== null);
  assert.ok(frozen > walking * 2,
    `moving took ${walking}s and standing still ${frozen}s — freezing should buy far more than that`);
});

test('he reacts to what he can see even while walking towards what he heard', () => {
  // Section three, and the whole point of the pass: a noise at one end of the
  // building must not blind him to a thief at the other. He is walking to A;
  // the thief appears at B, nowhere near it; he must come to B.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  assert.ok(rouse(run, { x: sim.level.width - 80, y: 80 }));
  assert.equal(w.state, 'investigating');
  const heard = { ...w.target };

  // Step into view, well away from the place he is walking to.
  let stepped = null;
  for (let i = 0; i < 60 * 6; i++) {
    const at = placeAway(sim, w, sim.vision.sure + 25);
    if (at) stepped = at;
    p.moving = true;
    tick(run);
    p.moving = true;
    if (w.state === 'following') break;
    if (sim.status !== 'running') break;
  }
  assert.ok(stepped, 'nowhere to stand in front of him');
  assert.equal(w.state, 'following', 'he should have abandoned the noise for the thief');
  assert.ok(Math.hypot(p.x - heard.x, p.y - heard.y) > 120,
    'the test is only worth anything if the thief is nowhere near the noise');
  assert.ok(Math.hypot(w.goal.x - p.x, w.goal.y - p.y)
    < Math.hypot(w.goal.x - heard.x, w.goal.y - heard.y),
    'he is still walking to the noise rather than to the thief he can see');
});

test('what he is walking towards keeps up with where the thief actually is', () => {
  // Section six: the follow target updates. He must never be walking at a spot
  // the thief left four seconds ago.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  assert.ok(rouse(run, { x: sim.level.width - 80, y: 80 }));
  for (let i = 0; i < 60 * 6 && w.state !== 'following'; i++) {
    placeAway(sim, w, sim.vision.sure + 25);
    p.moving = true;
    tick(run);
    p.moving = true;
  }
  assert.equal(w.state, 'following');
  let worst = 0;
  for (let i = 0; i < 60 * 4 && sim.status === 'running'; i++) {
    const at = placeAway(sim, w, 120 + (i % 40));
    tick(run);
    if (!at || w.state !== 'following') continue;
    worst = Math.max(worst, Math.hypot(w.goal.x - p.x, w.goal.y - p.y));
  }
  assert.ok(worst < RULES.investigate.repathAfter + 60,
    `his goal drifted ${worst.toFixed(0)} units behind the thief`);
});

// --- sections 14 to 17: somewhere to hide -----------------------------------

test('every school level offers a few places to be out of sight, and only the school does', () => {
  for (const level of SCHOOL) {
    // Two. Not three, and never one: two is enough to be a choice — a corner
    // to duck into on each half of the building — and few enough that finding
    // them is part of learning the level rather than a thing you fall over.
    assert.equal(level.hides.length, 2,
      `L${level.id} has ${level.hides.length} hiding places`);
    for (const spot of level.hides) {
      // Somewhere a person can actually stand, and somewhere they have to go to
      // rather than fall into: a hiding place on the doorstep is not a decision.
      const cx = spot.x + spot.w / 2;
      const cy = spot.y + spot.h / 2;
      assert.ok(!blocked(cx, cy, TUNING.player.boxWidth, TUNING.player.boxHeight,
        level.colliders), `L${level.id}: nobody can stand in the hiding place at ${cx},${cy}`);
      assert.ok(Math.hypot(cx - level.spawn.x, cy - level.spawn.y) > 90,
        `L${level.id}: a hiding place on the spawn`);
    }
  }
  for (const level of LEVELS) {
    if (level.location === 'School') continue;
    assert.equal(level.hides.length, 0,
      `L${level.id} (${level.location}) has hiding places, and hiding is a school beta`);
    // Belt and braces: no maps *and* no rules. Either one alone would keep the
    // button off the screen, and the mechanic is meant to be off in these
    // buildings rather than merely unreachable in them.
    const sim = createSim({ level });
    assert.equal(sim.rules.hide, undefined,
      `L${level.id} (${level.location}) has the hiding rules loaded`);
    const p = playerOf(sim);
    // Stand him everywhere a stash is and confirm the button never offers it.
    for (const stash of sim.stashes.slice(0, 6)) {
      p.x = stash.x + stash.w / 2;
      p.y = stash.y + stash.h + 16;
      p.prevX = p.x;
      p.prevY = p.y;
      stepSim(sim);
      assert.notEqual(sim.action, 'hide',
        `L${level.id} (${level.location}) offered HIDE`);
      assert.ok(!sim.hidden, `L${level.id} (${level.location}) let him hide`);
    }
  }
});

// Walk him to a hiding place and press the button. Returns once he is tucked
// in, which takes a few tenths — going behind something is an animation now,
// not a tile you stand on.
function tuckInto(run, spot) {
  const { sim } = run;
  const p = playerOf(sim);
  p.x = spot.x + spot.w / 2;
  p.y = spot.y + spot.h / 2;
  p.prevX = p.x;
  p.prevY = p.y;
  tick(run);
  assert.equal(sim.action, 'hide', 'the button should be offering HIDE');
  for (let i = 0; i < 60 * 3 && !sim.hidden; i++) {
    tick(run, { x: 0, y: 0, take: false, search: i === 0 });
  }
  assert.ok(sim.hidden, 'he should end up hidden');
}

// One piece on level 22 sits a tile proud of the wall behind it and stays
// there: the tile between them is a doorway's landing, so pushing it flush
// blocks the door, and stepping it back the other way strands the furniture
// behind it. The generator tries both, twice, and keeps the map walkable
// instead — the right trade. Any *second* one is a regression.
const GAPS_ALLOWED = 1;

test('nothing in the school stands one tile off a wall', () => {
  // The gap that is not a gap. A tile is 20 units and the player is 22 wide, so
  // a locker parked one tile off the wall behind it leaves a channel nobody can
  // walk down — it reads as a mistake from above and plays as a dead end. Zero
  // tiles (flush) is right and two is a corridor; one is neither.
  const TILE = TUNING.world.tile;
  let total = 0;
  const found = [];
  for (const level of SCHOOL) {
    const solid = level.colliders.filter(
      (c) => c.type === 'wall' || c.type === 'partition' || c.type === 'furniture');
    const walls = level.colliders.filter(
      (c) => (c.type === 'wall' && !c.fence) || c.type === 'partition');
    const offenders = [];
    // Indoors only: a tree a tile from the fence is a tree on a lawn.
    const outdoor = new Set(['tree', 'hedge', 'shed']);
    for (const piece of level.colliders) {
      if (piece.type !== 'furniture' || outdoor.has(piece.style)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // The strip exactly one tile beyond this face, and the same strip two
        // tiles beyond. Something in the first is flush; something in the
        // second with the first clear is the gap nobody fits through.
        const at = (n) => ({
          x: piece.x + (dx > 0 ? piece.w + (n - 1) * TILE : dx < 0 ? -n * TILE : 0),
          y: piece.y + (dy > 0 ? piece.h + (n - 1) * TILE : dy < 0 ? -n * TILE : 0),
          w: dx ? TILE : piece.w,
          h: dy ? TILE : piece.h
        });
        const overlaps = (box, list) => list.some((c) => c !== piece
          && c.x < box.x + box.w - 0.5 && c.x + c.w > box.x + 0.5
          && c.y < box.y + box.h - 0.5 && c.y + c.h > box.y + 0.5);
        // Against the *building*. Two desks with a tile between them is a
        // classroom; a bank of lockers with a tile between it and the wall
        // behind it is a mistake, and only the second one is what this is for.
        if (!overlaps(at(1), solid) && overlaps(at(2), walls)) {
          offenders.push(`${piece.style || piece.type} at ${piece.x},${piece.y}`);
          break;
        }
      }
    }
    total += offenders.length;
    found.push(...offenders.map((o) => `L${level.id} ${o}`));
  }
  assert.ok(total <= GAPS_ALLOWED,
    `${total} pieces stand one tile off a wall: ${found.slice(0, 6).join('; ')}`);
});

test('HIDE appears on the way in and goes away again when you leave', () => {
  // Section 9: the button is not a permanent fixture. It has to be offered on
  // approach — early enough to be found by walking about — and withdrawn the
  // moment you are out of range of anywhere to hide.
  const run = openSchool(25);
  const { sim } = run;
  const p = playerOf(sim);
  const reach = sim.rules.hide.reach;
  const edge = (r, x, y) => Math.hypot(
    Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));

  let offered = 0;
  let wrong = 0;
  // Every standable tile on the level, so this is the whole contract rather
  // than one lucky approach.
  for (let ty = 1; ty < sim.level.tiles.rows - 1; ty++) {
    for (let tx = 1; tx < sim.level.tiles.cols - 1; tx++) {
      const cx = tx * 20 + 10;
      const cy = ty * 20 + 10;
      if (blocked(cx, cy, TUNING.player.boxWidth, TUNING.player.boxHeight,
        sim.level.colliders)) continue;
      p.x = cx; p.y = cy; p.prevX = cx; p.prevY = cy;
      p.speed = 0;
      // Keep the level alive. A thief teleported across the map tile by tile
      // walks into the caretaker sooner or later, and once the level is over
      // the simulation stops stepping — which makes every remaining reading a
      // stale one, and quietly turns most of this sweep into nothing.
      sim.status = 'running';
      sim.noise = 0;
      sim.hidden = false;
      sim.hiding = null;
      tick(run);
      const near = sim.level.hides.some((h) => edge(h, cx, cy) <= reach);
      if (sim.action === 'hide') {
        offered++;
        if (!near) wrong++;
      } else if (near && sim.action !== 'search') {
        // Inside reach of a hiding place, and no cupboard nearer: it has to be
        // on offer.
        wrong++;
      }
    }
  }
  assert.equal(wrong, 0, `${wrong} tiles disagreed about whether HIDE is on offer`);
  assert.ok(offered > 6, `HIDE was only on offer from ${offered} tiles — too hard to find`);

  // ...and standing well away from all of them, it is gone.
  p.x = sim.level.spawn.x; p.y = sim.level.spawn.y;
  p.prevX = p.x; p.prevY = p.y;
  tick(run);
  assert.ok(sim.level.hides.every((h) => edge(h, p.x, p.y) > reach), 'the spawn is clear of them');
  assert.notEqual(sim.action, 'hide', 'still offering HIDE from across the school');
});

test('the button offers what is to hand, and nothing when nothing is', () => {
  const run = openSchool(25);
  const { sim } = run;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];

  // Out in the middle of the floor, well clear of anything to open or hide
  // behind — the spawn will not do, it is frequently right beside a cupboard.
  let clear = null;
  for (let ty = 2; ty < sim.level.tiles.rows - 2 && !clear; ty++) {
    for (let tx = 2; tx < sim.level.tiles.cols - 2 && !clear; tx++) {
      const cx = tx * 20 + 10;
      const cy = ty * 20 + 10;
      if (blocked(cx, cy, TUNING.player.boxWidth, TUNING.player.boxHeight,
        sim.level.colliders)) continue;
      const far = (r) => Math.hypot(Math.max(r.x - cx, 0, cx - (r.x + r.w)),
        Math.max(r.y - cy, 0, cy - (r.y + r.h))) > 70;
      if (sim.stashes.every(far) && sim.level.hides.every(far)) clear = { x: cx, y: cy };
    }
  }
  assert.ok(clear, 'the level should have some open floor in it');
  p.x = clear.x;
  p.y = clear.y;
  p.prevX = p.x; p.prevY = p.y;
  tick(run);
  assert.equal(sim.action, null, 'the button should not be offering anything on open floor');

  // In the gap behind the furniture: HIDE.
  p.x = spot.x + spot.w / 2;
  p.y = spot.y + spot.h / 2;
  p.prevX = p.x; p.prevY = p.y;
  tick(run);
  assert.equal(sim.action, 'hide');

  // ...and once tucked in: LEAVE, which the HUD writes as EXIT.
  tick(run, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60 * 3 && !sim.hidden; i++) tick(run);
  assert.ok(sim.hidden);
  assert.equal(sim.action, 'leave');
});

test('getting in and out is a move, not a teleport', () => {
  const run = openSchool(25);
  const { sim } = run;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  // Start a stride away, so there is ground to cover.
  p.x = spot.x + spot.w / 2 + 26;
  p.y = spot.y + spot.h / 2;
  p.prevX = p.x; p.prevY = p.y;
  tick(run);
  assert.equal(sim.action, 'hide', 'it should offer itself from a stride away');

  const path = [];
  tick(run, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60 * 3 && !sim.hidden; i++) {
    path.push({ x: p.x, y: p.y });
    tick(run);
  }
  assert.ok(sim.hidden);
  assert.ok(path.length >= 8, `he was in there in ${path.length} frames — that is a teleport`);
  // ...and every step of it is a step: no frame moves him more than a walk would.
  for (let i = 1; i < path.length; i++) {
    const step = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    assert.ok(step < TUNING.player.speed * (1 / 60) * 2.5,
      `he jumped ${step.toFixed(1)} units in one frame`);
  }
});

test('you can always get out of a locker, and only on purpose', () => {
  for (const level of SCHOOL) {
    for (const spot of level.hides) {
      // By the button...
      let run = createRun(level.id);
      let p = playerOf(run.sim);
      const at = { x: spot.stand.x, y: spot.stand.y };
      p.x = at.x; p.y = at.y; p.prevX = p.x; p.prevY = p.y;
      tick(run, { x: 0, y: 0, take: false, search: true });
      for (let i = 0; i < 60 * 3 && !run.sim.hidden; i++) tick(run);
      assert.ok(run.sim.hidden, `L${level.id}: could not get into ${spot.id}`);
      tick(run, { x: 0, y: 0, take: false, search: true });
      for (let i = 0; i < 60 * 3 && run.sim.hideState !== 'out'; i++) tick(run);
      assert.ok(!run.sim.hidden, `L${level.id}: the button did not get him out of ${spot.id}`);
      // ...and back onto the marked spot, which is the tile the map already
      // proved a person fits on. Not a step off whatever normal the corner of
      // the cabinet happened to point along.
      assert.ok(Math.hypot(p.x - at.x, p.y - at.y) < 1,
        `L${level.id}: he came out of ${spot.id} at ${p.x},${p.y}, not at ${at.x},${at.y}`);
      assert.ok(!blocked(p.x, p.y, TUNING.player.boxWidth, TUNING.player.boxHeight,
        level.colliders), `L${level.id}: he came out of ${spot.id} inside something`);

      // ...and *not* by leaning on the stick, which is the whole point of a
      // door. Section 11: a thumb resting on the pad while Mr. Vrána walks past
      // must not be able to shove him out into the corridor.
      run = createRun(level.id);
      p = playerOf(run.sim);
      p.x = at.x; p.y = at.y; p.prevX = p.x; p.prevY = p.y;
      tick(run, { x: 0, y: 0, take: false, search: true });
      for (let i = 0; i < 60 * 3 && !run.sim.hidden; i++) tick(run);
      const inside = { x: p.x, y: p.y };
      for (let i = 0; i < 60 * 4; i++) {
        tick(run, { x: 1, y: i % 2 ? 1 : -1, take: false, search: false });
      }
      assert.ok(run.sim.hidden, `L${level.id}: the stick pushed him out of ${spot.id}`);
      assert.ok(Math.hypot(p.x - inside.x, p.y - inside.y) < 0.001,
        `L${level.id}: the stick moved him about inside ${spot.id}`);
    }
  }
});

// --- the hiding places are lockers, and only a couple of them ---------------

test('every hiding place is a locker you stand squarely in front of', () => {
  // Sections 1 and 4: the spot is not a patch of shadow, it is a doorstep. A
  // cabinet with a door, square on, close enough to open — and the two
  // positions the animation runs between written down on the map rather than
  // worked out from wherever the player happened to be standing.
  for (const level of SCHOOL) {
    for (const spot of level.hides) {
      const a = spot.anchor;
      assert.ok(a, `L${level.id}: ${spot.id} has nothing to climb into`);
      assert.equal(a.style, 'chest',
        `L${level.id}: ${spot.id} is in front of a ${a.style}, not a locker`);
      assert.ok(spot.stand && spot.inside, `L${level.id}: ${spot.id} has no way in`);

      // Square on: the gap to the cabinet is along one axis and nothing along
      // the other, so he opens the door and walks straight through it.
      const gx = Math.max(a.x - spot.stand.x, 0, spot.stand.x - (a.x + a.w));
      const gy = Math.max(a.y - spot.stand.y, 0, spot.stand.y - (a.y + a.h));
      assert.ok(Math.min(gx, gy) === 0 && Math.max(gx, gy) <= 32,
        `L${level.id}: ${spot.id} is ${gx},${gy} off the cabinet — not square on`);
      // Within arm's reach, so the button is on offer from the marked tile.
      assert.ok(Math.hypot(gx, gy) <= TUNING.locations.School.hide.reach,
        `L${level.id}: ${spot.id} is out of reach of the thing it opens`);

      // Inside is inside: the target of the walk-in is within the cabinet's own
      // box, which is what makes the door he opened the door he went through.
      assert.ok(spot.inside.x > a.x && spot.inside.x < a.x + a.w
        && spot.inside.y > a.y && spot.inside.y < a.y + a.h,
        `L${level.id}: ${spot.id} puts him at ${spot.inside.x},${spot.inside.y}, `
        + `which is outside the cabinet`);
    }
  }
});

test('two lockers open, and the rest of the school is scenery', () => {
  // Section 19: a corridor where every locker is a hiding place is a corridor
  // with no decision in it. The marked ones have to be a small fraction of the
  // banks on the floor, and they have to be at opposite ends of it.
  let banks = 0;
  let opened = 0;
  for (const level of SCHOOL) {
    const lockers = level.colliders.filter((c) => c.style === 'chest');
    const open = new Set(level.hides.map((h) => h.anchor));
    assert.equal(open.size, level.hides.length,
      `L${level.id}: both hiding places are the same cabinet`);
    banks += lockers.length;
    opened += open.size;
    // Where the level is big enough to have a choice of banks, the ones that
    // open have to be a minority of them. The two smallest levels have barely
    // more banks than hiding places — that is those levels being two rooms and
    // a corridor, not the mechanic being carpeted over the school.
    if (lockers.length >= 6) {
      assert.ok(open.size / lockers.length < 0.4,
        `L${level.id}: ${open.size} of ${lockers.length} banks open — too many`);
    }

    // Sections 15 and 16: distinct, and far enough apart that reaching one is
    // not the same as reaching the other.
    const [a, b] = level.hides;
    assert.ok(Math.hypot(a.stand.x - b.stand.x, a.stand.y - b.stand.y) > 200,
      `L${level.id}: the two hiding places are ${Math.hypot(a.stand.x - b.stand.x, a.stand.y - b.stand.y).toFixed(0)} apart`);
  }
  // ...and over the location as a whole, most of the lockers are furniture.
  assert.ok(opened / banks < 0.3,
    `${opened} of the school's ${banks} banks of lockers open — the corridor is all doors`);
});

test('there is no thief to draw for the whole time he is in the locker', () => {
  // Sections 3 and 21, at the seam the renderer actually reads. `hideShown` is
  // the only thing the drawing is told about hiding, and it is a boolean: there
  // is a figure at full size or there is no figure. Nothing shrinks, nothing
  // fades, and no part of him is left showing — because there is nothing to
  // leave showing.
  const run = openSchool(23);
  const { sim } = run;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  p.x = spot.stand.x; p.y = spot.stand.y; p.prevX = p.x; p.prevY = p.y;
  tick(run);
  assert.equal(sim.hideShown, true, 'he is standing in the corridor');

  const shown = [];
  tick(run, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60 * 3 && !sim.hidden; i++) { shown.push(sim.hideShown); tick(run); }
  assert.ok(sim.hidden);
  // Going in: drawn while he walks up and steps through, gone before the door
  // has finished shutting. Once he is gone he stays gone — no flicker back.
  assert.ok(shown[0] === true, 'he should be drawn walking up to the locker');
  assert.ok(shown.includes(false), 'he should be gone before the door shuts');
  assert.equal(shown.lastIndexOf(true) < shown.indexOf(false), true,
    'he came back after disappearing');

  // ...and while he is in there, every single frame.
  for (let i = 0; i < 60 * 5; i++) {
    tick(run);
    assert.equal(sim.hideShown, false, `he was drawn ${i} frames into hiding`);
  }

  // Coming out: nothing for the beat the door swings open, then a figure again.
  const back = [];
  tick(run, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60 * 3 && sim.hideState !== 'out'; i++) { back.push(sim.hideShown); tick(run); }
  assert.equal(back[0], false, 'the door opens on an empty corridor first');
  assert.ok(back.includes(true), 'he should step back out of it');
  assert.equal(sim.hideShown, true, 'and be a thief again once he is out');
});

test('the clock, the money and the noise all keep running inside a locker', () => {
  // Section 11: movement stops and nothing else does. A hiding place that
  // pauses the level is a pause button.
  const run = openSchool(24);
  const { sim } = run;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  p.x = spot.stand.x; p.y = spot.stand.y; p.prevX = p.x; p.prevY = p.y;
  tick(run, { x: 0, y: 0, take: false, search: true });
  for (let i = 0; i < 60 * 3 && !sim.hidden; i++) tick(run);
  assert.ok(sim.hidden);

  const money = sim.money;
  const clock = sim.timeLeft;
  sim.noise = 60;
  for (let i = 0; i < 60 * 3; i++) tick(run);
  assert.ok(sim.timeLeft < clock - 2.5, 'the clock stopped while he was hidden');
  assert.ok(sim.noise < 60, 'the noise meter stopped draining while he was hidden');
  assert.equal(sim.money, money, 'and hiding is not worth money');
});

test('every hiding place is behind something you can see', () => {
  for (const level of SCHOOL) {
    for (const spot of level.hides) {
      assert.ok(spot.anchor,
        `L${level.id}: ${spot.id} is a patch of floor with nothing to hide behind`);
      // Close enough to be the thing you are behind rather than scenery.
      const cx = spot.x + spot.w / 2;
      const cy = spot.y + spot.h / 2;
      const a = spot.anchor;
      const dx = Math.max(a.x - cx, 0, cx - (a.x + a.w));
      const dy = Math.max(a.y - cy, 0, cy - (a.y + a.h));
      assert.ok(Math.hypot(dx, dy) <= 52,
        `L${level.id}: ${spot.id} is ${Math.hypot(dx, dy).toFixed(0)} from the thing it is behind`);
    }
  }
});

test('standing in a hiding place makes him far slower to pick you out', () => {
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  const at = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 };
  // Put him a fixed, generous distance away and hold him there, so the only
  // thing that differs between the two readings is whether the thief is tucked
  // in behind the furniture or standing a stride outside it.
  const readFrom = (px, py) => {
    w.state = 'investigating';
    w.notice = 0;
    w.lostFor = 0;
    w.x = at.x + 70;
    w.y = at.y;
    w.prevX = w.x;
    w.prevY = w.y;
    let seconds = null;
    for (let i = 0; i < 60 * 12 && seconds === null; i++) {
      p.x = px; p.y = py; p.prevX = px; p.prevY = py;
      p.speed = TUNING.player.speed;
      w.x = at.x + 70; w.y = at.y; w.prevX = w.x; w.prevY = w.y;
      sim.noise = Math.max(sim.noise, 85);
      tick(run);
      if (w.notice >= 1) seconds = i / 60;
    }
    return seconds;
  };
  const exposed = readFrom(at.x + 30, at.y);
  tuckInto(run, spot);
  const hidden = readFrom(at.x, at.y);
  assert.ok(exposed !== null, 'he should pick out a thief standing in the open');
  assert.ok(hidden === null || hidden > exposed * 4,
    `out in the open took ${exposed}s and hidden ${hidden}s — hiding should be worth far more`);
});

test('hidden is hidden: nothing finds him, including walking into him', () => {
  // The state is absolute on purpose. Not a smaller number in the sight
  // calculation — no sight, no threshold, no pursuit, and no being blundered
  // into either, because the crudest detector of the lot would otherwise make
  // the state count for nothing.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  tuckInto(run, spot);
  assert.equal(sim.hideState, 'hidden');
  assert.ok(sim.undetectable);

  // Stand him on top of the thief, wide awake, for a long time.
  w.state = 'following';
  w.notice = 1;
  w.grace = 0;
  for (let i = 0; i < 60 * 8; i++) {
    w.x = p.x + 2;
    w.y = p.y;
    w.prevX = w.x;
    w.prevY = w.y;
    sim.noise = 99;
    tick(run);
    assert.equal(sim.status, 'running',
      `he found the thief in a hiding place after ${(i / 60).toFixed(1)}s: ${sim.failReason}`);
    assert.ok(sim.hidden, 'and the thief should still be hidden');
  }
  assert.notEqual(w.state, 'following', 'he should have given up on a thief he cannot detect');
  assert.equal(w.notice, 0, 'and be certain of nothing');
});

test('hiding costs the clock, which is what stops it being free', () => {
  const run = openSchool(25);
  const { sim } = run;
  const spot = sim.level.hides[0];
  const before = sim.timeLeft;
  tuckInto(run, spot);
  for (let i = 0; i < 60 * 3; i++) tick(run);
  assert.ok(sim.timeLeft < before - 2.5,
    'the clock should run while he is behind the lockers');
  // ...and what he did before he got there still stands.
  assert.ok(sim.noise >= 0);
});

test('detection comes back only once he is all the way out', () => {
  // Section 1: restore the normal system *after* the emergence animation, not
  // when the button is pressed. Half out from behind a cabinet is not out.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  tuckInto(run, sim.level.hides[0]);
  w.state = 'investigating';
  w.notice = 0;
  w.x = p.x + 30;
  w.y = p.y;
  w.prevX = w.x;
  w.prevY = w.y;

  // Press LEAVE, then watch every frame of coming out.
  tick(run, { x: 0, y: 0, take: false, search: true });
  assert.equal(sim.hideState, 'leaving');
  let frames = 0;
  while (sim.hideState === 'leaving' && frames < 120) {
    assert.ok(sim.undetectable, 'he is still coming out and should still be safe');
    w.x = p.x + 30;
    w.y = p.y;
    w.prevX = w.x;
    w.prevY = w.y;
    tick(run);
    frames++;
  }
  assert.ok(frames > 8, `coming out took ${frames} frames — that is a teleport`);
  assert.equal(sim.hideState, 'out');
  assert.ok(!sim.undetectable, 'and now he can be seen again');
});

test('he does not know which hiding place you went into', () => {
  // Section seventeen. Losing sight of the thief near a hiding place sends him
  // to the last place he actually saw him, and then to look around — it must
  // not send him to the hiding place, which he has no way of knowing about.
  const run = openSchool(25);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  const spot = sim.level.hides[0];
  const at = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 };
  // Seen, out in the open, a good way from the hiding place.
  w.state = 'following';
  w.notice = 1;
  w.x = at.x + 260;
  w.y = at.y;
  w.prevX = w.x; w.prevY = w.y;
  p.x = at.x + 150; p.y = at.y; p.prevX = p.x; p.prevY = p.y;
  tick(run);
  // ...and then behind the lockers, and gone.
  tuckInto(run, spot);
  // Out of sight is out of mind: from here his idea of where the thief is must
  // stop moving with the thief. Watching him climb in is fair — he can see that
  // — but once he cannot, following a live position for two more seconds is him
  // knowing something he has no way of knowing.
  const goal = w.goal ? { ...w.goal } : null;
  assert.ok(goal, 'he should be walking somewhere');
  for (let i = 0; i < 30; i++) {
    p.x = at.x - 140;
    p.y = at.y;
    p.prevX = p.x;
    p.prevY = p.y;
    tick(run);
  }
  assert.ok(sim.hidden, 'still hidden');
  assert.ok(Math.hypot(w.goal.x - goal.x, w.goal.y - goal.y) < 1,
    'his goal followed the thief he cannot see');

  for (let i = 0; i < 60 * 10 && w.state === 'following'; i++) {
    sim.noise = Math.max(sim.noise, 70);
    tick(run);
  }
  assert.notEqual(w.state, 'following', 'he should have lost the thief in the hiding place');
  assert.ok(['searching', 'investigating', 'returning'].includes(w.state),
    `he ended up ${w.state}`);
  assert.ok(w.target, 'he should still have somewhere he means to look');
});

test('the follow range and the give-up range are far enough apart to be stable', () => {
  const f = RULES.investigate;
  // The school sees rather than collides, so the ordering that matters is
  // between what he can make out and what it takes to shake him: give up
  // sooner than he can see and he would drop you while watching you, which is
  // the flicker this pair of numbers exists to prevent.
  const eye = RULES.vision;
  assert.ok(eye, 'the school is the location with eyes');
  assert.ok(f.unfollowAt > eye.range,
    `he gives up at ${f.unfollowAt} but can still see you at ${eye.range}`);
  assert.ok(eye.sure < eye.range / 2, 'certainty should have room to fall off');
  assert.ok(eye.range > f.followAt * 2,
    `${eye.range} is not noticeably further than the ${f.followAt} it replaced`);
  assert.ok(f.unfollowAt > f.followAt * 2.5,
    `${f.followAt} to ${f.unfollowAt} is not enough hysteresis to stop him flickering`);
  assert.ok(f.unfollowFor >= 1.5, 'losing him should take seconds, not a frame');
  assert.ok(f.followAt > f.catchAt * 2,
    'you should get a moment between being spotted and being caught');
});
