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
import { locationRules, proximityScale } from '../src/rules.js';
import { navGrid, flowField, cellOf } from '../src/nav.js';
import { blocked } from '../src/physics.js';
import { createRun, tick, walkTo } from './harness.mjs';

const SCHOOL = LEVELS.filter((l) => l.location === 'School');
const ELSEWHERE = LEVELS.filter((l) => l.location !== 'School');
const RULES = TUNING.locations.School;

const openSchool = (id = 21) => {
  const run = createRun(id);
  run.sim.timeLeft = 9999;      // these tests are about him, not about the clock
  return run;
};

// Put the player somewhere exactly, without walking there.
function place(sim, x, y) {
  const p = playerOf(sim);
  p.x = x; p.y = y; p.prevX = x; p.prevY = y; p.vx = 0; p.vy = 0;
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

test('only the school has location rules at all', () => {
  assert.deepEqual(Object.keys(TUNING.locations), ['School'],
    'a second location here means a second location has changed behaviour');
  for (const level of SCHOOL) assert.ok(locationRules(level).investigate, `L${level.id} missing rules`);
  for (const level of ELSEWHERE) {
    assert.deepEqual(locationRules(level), {}, `L${level.id} (${level.location}) picked up rules`);
  }
});

test('no other location gets an investigator, a proximity curve or a new decay rate', () => {
  for (const level of ELSEWHERE) {
    const sim = createSim({ level });
    assert.equal(sim.investigator, null, `L${level.id} (${level.location}) has someone walking about`);
    assert.equal(sim.investigateRules, null);
    assert.equal(sim.entities.length, 1, `L${level.id} gained an entity`);
    stepSim(sim, { x: 1, y: 0, take: false });
    assert.equal(sim.proximity, 1, `L${level.id} scaled its noise by distance`);
  }
});

test('elsewhere, noise still costs exactly what it says on the tin', () => {
  // The same item, taken on a level with no proximity rule, must move the
  // meter by its printed value — near the sleeper or far from them.
  for (const level of ELSEWHERE.slice(0, 8)) {
    const sim = createSim({ level });
    const item = sim.items[0];
    place(sim, item.x, item.y);
    stepSim(sim, { x: 0, y: 0, take: true });
    assert.equal(Math.round(sim.noise), item.noise,
      `L${level.id} (${level.location}) charged ${sim.noise} for a ${item.noise} item`);
  }
});

test('the settling rate elsewhere is untouched', () => {
  const level = ELSEWHERE.find((l) => l.location === 'Apartment');
  const sim = createSim({ level });
  sim.noise = 50;
  for (let i = 0; i < 60 * 2; i++) stepSim(sim);
  const spent = 2 - TUNING.recovery.delay;
  assert.ok(Math.abs((50 - sim.noise) - spent * TUNING.recovery.rate) < 0.1,
    `apartment decay moved ${(50 - sim.noise).toFixed(2)}, expected ${(spent * TUNING.recovery.rate).toFixed(2)}`);
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
  const near = cost(RULES.proximity.near - 30);
  const middle = cost((RULES.proximity.near + RULES.proximity.far) / 2);
  const far = cost(RULES.proximity.far + 40);
  assert.ok(near > middle && middle > far, `${near} / ${middle} / ${far} should fall away`);
  assert.ok(near > far * 4, `near ${near.toFixed(1)} should dwarf far ${far.toFixed(1)}`);
  assert.ok(Math.abs(near / far - RULES.proximity.nearScale / RULES.proximity.farScale) < 0.05,
    `the ratio ${(near / far).toFixed(2)} should be the one the tuning declares`);
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
  assert.ok(near.proximity > 2 && far.proximity < 0.6, 'the probes should sit at the two ends');
  assert.ok(near.rate > far.rate * 2,
    `each step near him (${near.rate.toFixed(5)}/unit) should cost far more than far off (${far.rate.toFixed(5)}/unit)`);
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
  run.sim.noise = 90;
  const before = run.sim.noise;
  for (let i = 0; i < Math.floor(RULES.recovery.delay * 60) - 2; i++) tick(run);
  assert.equal(run.sim.noise, before, 'nothing should happen during the delay');
  for (let i = 0; i < 60 * 3; i++) tick(run);
  assert.ok(run.sim.noise < 90 - 3 * RULES.recovery.rate + 2, 'it should be coming down by now');
  assert.ok(run.sim.noise > 40, 'but nowhere near a reset');
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
  place(sim, sim.level.spawn.x, sim.level.spawn.y);
  const at = { x: sim.level.spawn.x, y: sim.level.spawn.y };

  sim.noise = RULES.investigate.wakeAt - 1;
  tick(run);
  assert.equal(w.state, 'asleep', 'he should sleep through anything at or under 80');

  sim.noise = RULES.investigate.wakeAt + 1;
  tick(run);
  assert.equal(w.state, 'rising');
  assert.ok(Math.hypot(w.target.x - at.x, w.target.y - at.y) < 3,
    'the stored spot must be where the meter was crossed');

  // Now leave. The target must not follow.
  const stored = { ...w.target };
  for (let i = 0; i < 60 * 3; i++) {
    sim.noise = Math.max(sim.noise, 85);
    tick(run, { x: -1, y: 0, take: false });
  }
  assert.deepEqual(w.target, stored, 'he must investigate the place, not track the person');
  assert.ok(Math.hypot(playerOf(sim).x - stored.x, playerOf(sim).y - stored.y) > 60,
    'the player really did move away');
});

test('he walks there — through the doorways, never through the walls', () => {
  const run = openSchool();
  const { sim } = run;
  const w = sim.investigator;
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
    if (w.state === 'searching') break;
  }
  assert.equal(w.state, 'searching', 'he should have arrived');
  assert.ok(Math.hypot(w.x - w.target.x, w.y - w.target.y) <= RULES.investigate.arriveAt + 4,
    'and arrived at the spot, not near it');
  assert.ok(peak > 0 && peak <= RULES.investigate.speed + 1, `he moved at ${peak.toFixed(0)}, a walk`);
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
  for (const s of speeds) assert.ok(s <= RULES.investigate.speed + 1, `${s} is faster than he can walk`);
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
  for (let i = 0; i < 60; i++) { sim.noise = Math.max(sim.noise, 85); tick(run); }
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
  for (let i = 0; i < 30; i++) { sim.noise = 85; tick(run); }
  sim.noise = 65;
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
  for (let i = 0; i < 60; i++) { sim.noise = Math.max(sim.noise, 85); tick(run); }
  sim.noise = 10;
  for (let i = 0; i < 30; i++) tick(run);
  assert.ok(w.state === 'returning' || w.state === 'settling', `he should be on his way back, not ${w.state}`);

  // A second crash, somewhere else entirely.
  const elsewhere = { x: sim.level.width - 60, y: 60 };
  place(sim, elsewhere.x, elsewhere.y);
  sim.noise = 90;
  tick(run);
  assert.ok(Math.hypot(w.target.x - elsewhere.x, w.target.y - elsewhere.y) < 3,
    'the new noise should replace the old one');
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
  for (let i = 0; i < Math.floor(RULES.investigate.rising * 60) - 2; i++) {
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
      place(sim, 5000, 5000);                   // and then the thief is gone

      let arrived = false;
      for (let i = 0; i < 60 * 90; i++) {
        if (!arrived) sim.noise = Math.max(sim.noise, 85);
        stepSim(sim);
        if (!arrived && (w.state === 'searching' || w.state === 'returning')) arrived = true;
        if (arrived && w.state === 'asleep') break;
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
