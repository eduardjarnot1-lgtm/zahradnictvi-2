// Noise as a threat rather than a fuse.
//
// The old contract was one line: a hundred on the meter and the level is over.
// The new one is a curve — how well he places you, how fast he gets up, how
// fast he walks and how long he casts about are all functions of the meter, and
// filling it ends nothing. That is a lot of behaviour to get subtly wrong, and
// nearly all of it is arithmetic, so nearly all of it is checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../src/tuning.js';
import { FLOORPLANS } from '../src/maps.js';
import { createSim, stepSim, alertnessOf } from '../src/sim.js';
import { createRun, tick, walkTo, escape, slipAway } from './harness.mjs';

const SCHOOL = FLOORPLANS.filter((l) => l.location === 'School');
const RULES = TUNING.locations.School;
const ALERT = RULES.alertness;
const playerOf = (sim) => sim.entities[0];
const fake = (noise) => ({ noise, rules: RULES });

// --- section 1: the meter is not a fail bar ---------------------------------

test('filling the meter does not end a school level', () => {
  for (const level of SCHOOL) {
    const sim = createSim({ level });
    sim.timeLeft = 9999;
    sim.noise = 100;
    for (let i = 0; i < 60 * 3; i++) {
      sim.noise = 100;
      stepSim(sim, { x: 0, y: 0, take: false, search: false });
      if (sim.status !== 'running') break;
    }
    // He may of course walk into you — that is a loss, and the right one. What
    // must not happen is the level ending *because the number reached a
    // hundred*, which is what used to happen on the very first frame.
    assert.notEqual(sim.failReason, 'awake',
      `L${level.id} still ends the level on a full meter`);
  }
});

test('nowhere in the game does a full meter end a level any more', () => {
  // This used to be the isolation test: the school stopped losing on a full
  // meter and everywhere else still did. Both halves of that are gone. Every
  // building in the game is now one person listening, so filling the meter
  // makes them fast and right and ends nothing — being walked into, or running
  // out of clock, is what loses you a level.
  const somewhere = ['Apartment', 'Hotel', 'Museum', 'Vault']
    .map((name) => FLOORPLANS.find((l) => l.location === name));
  for (const level of somewhere) {
    const run = createRun(level.id);
    const { sim } = run;
    sim.timeLeft = 9999;
    // Driven by an actual noise rather than by assigning the meter: the check
    // lived where noise is *made*, so this is where it would still be.
    const item = sim.items.reduce((a, b) => (a && a.value >= b.value ? a : b));
    walkTo(run, item, 60 * 40);
    sim.noise = 99;
    for (let i = 0; i < 40 && sim.status === 'running'; i++) {
      tick(run, { x: 0, y: 0, take: true, search: false });
      tick(run, { x: 0, y: 0, take: false, search: false });
    }
    assert.notEqual(sim.failReason, 'awake',
      `${level.name} L${level.id} still ends the level on a full meter`);
  }
});

test('you can still get out with the meter full', () => {
  // The point of the redesign: a bad moment is recoverable. Walk to the door
  // with the meter pinned at a hundred and the haul still banks.
  const run = createRun(21);
  const { sim } = run;
  sim.timeLeft = 9999;
  // Pin the meter at the top for a while — under the old rule the level was
  // over on the first of these frames — then walk out.
  for (let i = 0; i < 60 * 2 && sim.status === 'running'; i++) {
    sim.noise = 100;
    tick(run);
  }
  assert.equal(sim.status, 'running', `two seconds at a hundred ended it: ${sim.failReason}`);
  const result = escape(run);
  assert.notEqual(result.reason, 'awake', 'a full meter must not be why you failed');
});

// --- section 2: continuous, not banded --------------------------------------

test('alertness rises with the meter and never steps', () => {
  let last = -1;
  let biggest = 0;
  for (let n = 0; n <= 100; n += 0.25) {
    const a = alertnessOf(fake(n));
    assert.ok(a >= last - 1e-12, `alertness fell at ${n}`);
    if (last >= 0) biggest = Math.max(biggest, a - last);
    last = a;
  }
  assert.equal(alertnessOf(fake(0)), 0);
  assert.equal(alertnessOf(fake(100)), 1);
  // No band edges: a quarter of a point of meter never moves him much.
  assert.ok(biggest < 0.02, `alertness jumps by ${biggest.toFixed(3)} somewhere`);
});

test('the curve actually spends its range where he is awake', () => {
  // The bug this exists to prevent: mapping alertness across the whole meter
  // while he only ever wakes near the top of it, so every waking moment sits at
  // the sharp end and he is always at his best.
  const wake = alertnessOf(fake(RULES.investigate.wakeAt));
  const full = alertnessOf(fake(100));
  assert.ok(wake < 0.25, `he is already ${wake.toFixed(2)} alert the moment he stands up`);
  assert.ok(full - wake > 0.7, 'there is nothing left of the curve once he is up');
});

test('louder means a better guess, a quicker start and a faster walk', () => {
  const at = (n) => {
    const a = alertnessOf(fake(n));
    return {
      error: ALERT.blur + (ALERT.sharp - ALERT.blur) * a,
      speed: RULES.investigate.speed * (ALERT.speedLow + (ALERT.speedHigh - ALERT.speedLow) * a),
      rise: ALERT.riseLow + (ALERT.riseHigh - ALERT.riseLow) * a,
      sweep: ALERT.sweepLow + (ALERT.sweepHigh - ALERT.sweepLow) * a
    };
  };
  let last = null;
  for (const n of [62, 70, 80, 90, 95, 100]) {
    const now = at(n);
    if (last) {
      assert.ok(now.error < last.error, `his guess got worse between ${n - 10} and ${n}`);
      assert.ok(now.speed > last.speed, `he got slower between ${n - 10} and ${n}`);
      assert.ok(now.rise < last.rise, `he got slower off the mark between ${n - 10} and ${n}`);
      assert.ok(now.sweep < last.sweep, `his search got vaguer between ${n - 10} and ${n}`);
    }
    last = now;
  }
  // ...and the ends are far enough apart to be a mechanic rather than a nuance.
  assert.ok(at(62).error > at(100).error * 8, 'the guess barely improves with the meter');
  assert.ok(at(100).speed > at(62).speed * 1.4, 'his pace barely changes with the meter');
});

// --- section 6: he guesses, and the guess narrows ---------------------------

function wake(levelId, noise, at) {
  const run = createRun(levelId);
  const { sim } = run;
  sim.timeLeft = 9999;
  const p = playerOf(sim);
  if (at) { p.x = at.x; p.y = at.y; p.prevX = p.x; p.prevY = p.y; }
  sim.noise = noise;
  tick(run);
  return run;
}

test('he goes to where he thinks the noise was, not to where it was', () => {
  // Over many wakes at a low meter his guesses must actually scatter. A single
  // sample proves nothing: the error is random, so it is the spread that says
  // whether he is guessing or reading your position off the simulation.
  let worst = 0;
  let hits = 0;
  for (let i = 0; i < 40; i++) {
    const run = createRun(23, 100 + i);
    const { sim } = run;
    sim.timeLeft = 9999;
    const p = playerOf(sim);
    sim.noise = RULES.investigate.wakeAt + 1;
    tick(run);
    const w = sim.investigator;
    if (!w.target) continue;
    hits++;
    worst = Math.max(worst, Math.hypot(w.target.x - p.x, w.target.y - p.y));
  }
  assert.ok(hits > 30, 'he should have woken most of the time');
  assert.ok(worst > 60, `his worst guess was only ${worst.toFixed(0)} out — that is not a guess`);
});

test('a louder noise is placed more accurately than a quiet one', () => {
  const spread = (noise) => {
    let total = 0;
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const run = createRun(23, 500 + i);
      const { sim } = run;
      sim.timeLeft = 9999;
      const p = playerOf(sim);
      sim.noise = noise;
      tick(run);
      const w = sim.investigator;
      if (!w.target) continue;
      total += Math.hypot(w.target.x - p.x, w.target.y - p.y);
      n++;
    }
    return total / Math.max(1, n);
  };
  const quiet = spread(RULES.investigate.wakeAt + 1);
  const loud = spread(100);
  assert.ok(loud < quiet * 0.6,
    `at full alert he is ${loud.toFixed(0)} out against ${quiet.toFixed(0)} when barely disturbed`);
});

test('keeping it up narrows him down; going quiet does not', () => {
  // Section 6, and the thing that makes the meter frightening rather than
  // merely expensive: each fresh noise pulls his idea of where you are closer.
  const run = wake(23, RULES.investigate.wakeAt + 1);
  const { sim } = run;
  const w = sim.investigator;
  const p = playerOf(sim);
  const errorNow = () => Math.hypot(w.target.x - p.x, w.target.y - p.y);
  const first = errorNow();

  // Keep making it worse, without moving.
  for (let round = 0; round < 6; round++) {
    sim.noise = Math.min(100, sim.noise + 12);
    for (let i = 0; i < 6; i++) tick(run);
  }
  const after = errorNow();
  assert.ok(after < first * 0.7,
    `he was ${first.toFixed(0)} out and is now ${after.toFixed(0)} — that is not narrowing down`);

  // ...and now go quiet. His idea of where you are must stop improving.
  const held = { ...w.target };
  for (let i = 0; i < 60 * 2; i++) {
    sim.noise = sim.noise;      // no fresh noise, and he is not moving towards one
    tick(run);
    if (w.state === 'following') break;
  }
  if (w.state !== 'following') {
    assert.deepEqual(w.target, held, 'his guess improved while you made no noise at all');
  }
});

// --- section 3: it comes back down ------------------------------------------

test('getting clear and going quiet brings the meter down and takes him with it', () => {
  // The loop the whole redesign exists to create. Note that it is *getting
  // clear* and then going quiet: standing still on the spot he has a fix on is
  // not hiding, it is waiting to be found, and the test that tried it got
  // caught in two seconds flat.
  // Level one: a plain rectangle with room to back off in. The T and the U have
  // dead ends in them by design, and whether a given corner of a given school
  // gives you somewhere to go is level design rather than this mechanic.
  const run = wake(21, 90);
  const { sim } = run;
  const w = sim.investigator;
  const peak = alertnessOf(sim);
  assert.ok(slipAway(run, 60 * 16), `he never settled — ${w.state} at ${sim.noise.toFixed(0)}`);
  assert.equal(sim.status, 'running');
  assert.ok(sim.noise < 90, 'the meter should have come down');
  assert.ok(alertnessOf(sim) < peak, 'and he should be less alert for it');
  assert.equal(w.state, 'asleep');
});

test('he actually walks faster when the meter is higher', () => {
  // Section 13, measured rather than asserted about the tuning: the same man,
  // on the same map, covering ground at two different meter readings.
  const topSpeedAt = (noise) => {
    const run = createRun(23, 11);
    const { sim } = run;
    sim.timeLeft = 9999;
    const w = sim.investigator;
    const p = playerOf(sim);
    sim.noise = noise;
    let peak = 0;
    for (let i = 0; i < 60 * 12 && sim.status === 'running'; i++) {
      sim.noise = noise;                       // hold the reading steady
      // Keep out of his way, so this measures his walk and not his pounce.
      const dx = p.x - w.x;
      const dy = p.y - w.y;
      const d = Math.hypot(dx, dy) || 1;
      tick(run, d < 240 ? { x: dx / d, y: dy / d, take: false, search: false } : undefined);
      if (w.state === 'investigating') peak = Math.max(peak, w.speed);
    }
    return peak;
  };
  const quiet = topSpeedAt(RULES.investigate.wakeAt + 1);
  const loud = topSpeedAt(100);
  assert.ok(quiet > 10, `he never got going at all when barely disturbed (${quiet.toFixed(0)})`);
  assert.ok(loud > quiet * 1.25,
    `he walks at ${quiet.toFixed(0)} barely disturbed and ${loud.toFixed(0)} at full alert`);
  assert.ok(loud <= RULES.investigate.speed * ALERT.speedHigh + 1,
    `${loud.toFixed(0)} is faster than the tuning allows`);
});

// --- and the rest of the game is untouched ----------------------------------

test('every location has an alertness curve, and no two are the same person', () => {
  const names = Object.keys(TUNING.locations);
  assert.equal(names.length, 11, 'eleven locations, eleven people');
  const seen = new Set();
  for (const [name, rules] of Object.entries(TUNING.locations)) {
    assert.ok(rules.alertness, `${name} has no alertness curve`);
    assert.ok(rules.investigate, `${name} has nobody who comes looking`);
    // The curve has to have room in it: mapping the whole meter onto nought to
    // one puts every waking moment at the top of it, which is the bug the
    // school's `from` was added to fix.
    assert.ok(rules.alertness.from < rules.investigate.wakeAt,
      `${name} only wakes above the top of its own curve`);
    // Nobody may be faster than the thief. A threat you cannot outrun is not a
    // chase, it is a countdown — `unfollowAt` is unreachable and being seen
    // becomes the same thing as being caught.
    const top = rules.investigate.speed * rules.alertness.speedHigh;
    assert.ok(top < TUNING.player.speed,
      `${name} tops out at ${top.toFixed(0)} against the thief's ${TUNING.player.speed}`);
    const finger = [rules.investigate.speed, rules.alertness.blur, rules.investigate.wakeAt].join('/');
    assert.ok(!seen.has(finger), `${name} is the same person as somebody else (${finger})`);
    seen.add(finger);
  }
  assert.equal(alertnessOf({ noise: 100, rules: {} }), 0);
});
