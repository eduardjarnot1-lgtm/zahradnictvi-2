import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, snapshot, playerOf, STEP_SECONDS } from '../src/sim.js';
import { solveMove, blocked } from '../src/physics.js';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { play, createRun, tick, walkTo, steal, escape } from './harness.mjs';
import {
  addNoise, sleepStage, SLEEP_AWAKE, SLEEP_ASLEEP, starsFor, levelTotals, timeLimit,
  rarityOf, starThresholds, shapeStick, watcherConfig, detectionRate,
  gaitBlend, stridePerUnit, proximityScale, locationRules
} from '../src/rules.js';

test('a scripted run wins with exactly the money it stole', () => {
  const level = LEVELS[0];
  const pair = [level.items[0], level.items[1]];
  const expected = pair.reduce((sum, item) => sum + TUNING.items[item.type].value, 0);
  const { result } = play(1, { take: pair.map((i) => i.id) });
  assert.equal(result.status, 'won');
  assert.equal(result.haul, expected, 'the raw haul is exact');
  assert.ok(result.money >= result.haul, 'bonuses only ever add');
  // Noise is no longer a pure sum: bumping furniture adds to it and standing
  // still bleeds it off, so only the money is exact.
  assert.ok(result.noise > 0 && result.noise < TUNING.noise.max);
});

test('taking everything on level 10 fills the meter and puts him on his feet', () => {
  // It used to end the level. It now ends the quiet: Grandpa is up, he is
  // walking the cottage, and whether you get out with it is a different
  // question from whether you were allowed to try.
  const { run, result } = play(10);
  assert.equal(Math.round(run.sim.noise), TUNING.noise.max);
  assert.notEqual(run.sim.investigator.state, 'asleep',
    `he slept through a full meter (${result.status})`);
});

test('same seed and same inputs produce an identical run', () => {
  const a = play(3, { take: ['L3-0', 'L3-1'], seed: 99 });
  const b = play(3, { take: ['L3-0', 'L3-1'], seed: 99 });
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.run.recording.frames, b.run.recording.frames);
});

test('the simulation never calls Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('sim used Math.random'); };
  try {
    // Whatever level six happens to hold: naming item ids ties a test about
    // randomness to a particular generated map.
    const some = LEVELS.find((l) => l.id === 6).items.slice(0, 2).map((i) => i.id);
    play(6, { take: some });
  } finally {
    Math.random = original;
  }
});

test('a finished level cannot be finished twice', () => {
  const run = createRun(1);
  steal(run, 'L1-0');
  escape(run);
  assert.equal(run.sim.status, 'won');

  const afterWin = snapshot(run.sim);
  const wins = [];
  for (let i = 0; i < 120; i++) {
    tick(run, { x: 0, y: 1, take: true });
    wins.push(...run.sim.events.filter((e) => e.type === 'won'));
  }
  assert.equal(wins.length, 0, 'win fired again after the level ended');
  assert.deepEqual(snapshot(run.sim), afterWin, 'state changed after the level ended');
});

test('items are not taken by walking over them in action mode', () => {
  assert.equal(TUNING.pickup.mode, 'action');
  const run = createRun(1);
  const item = run.sim.items[0];
  walkTo(run, item);
  for (let i = 0; i < 120; i++) tick(run, { x: 0, y: 0, take: false });
  assert.equal(item.inRange, true, 'should be in range');
  assert.equal(item.taken, false, 'should not have been taken without pressing TAKE');
});

test('holding TAKE takes one item, not the whole room', () => {
  const run = createRun(2);
  const first = run.sim.items[0];
  walkTo(run, first);
  for (let i = 0; i < 240; i++) tick(run, { x: 0, y: 0, take: true });
  assert.equal(run.sim.items.filter((i) => i.taken).length, 1);
});

test('pickup range is circular: diagonal reaches exactly as far as head-on', () => {
  const level = LEVELS[0];
  const radius = TUNING.pickup.radius;
  const probe = (dx, dy) => {
    const sim = createSim({ level, seed: 1 });
    const item = sim.items[0];
    const player = playerOf(sim);
    player.x = item.x + dx;
    player.y = item.y + dy;
    stepSim(sim, { x: 0, y: 0, take: false });
    return sim.items[0].inRange;
  };
  const inside = radius - 1;
  const outside = radius + 1;
  const diag = (d) => d / Math.SQRT2;
  assert.equal(probe(inside, 0), true);
  assert.equal(probe(diag(inside), diag(inside)), true);
  assert.equal(probe(outside, 0), false);
  assert.equal(probe(diag(outside), diag(outside)), false);
});

test('swept movement does not tunnel through a wall at any speed', () => {
  const level = LEVELS[0];
  const box = { x: 200, y: 300, w: TUNING.player.boxWidth, h: TUNING.player.boxHeight };
  for (const speed of [132, 800, 5000, 40000]) {
    const moved = solveMove(box, 0, -speed * STEP_SECONDS, level.colliders);
    assert.ok(
      moved.y > TUNING.world.wallThickness,
      `tunnelled through the top wall at ${speed}px/s (y=${moved.y})`
    );
  }
});

test('noise clamps at the cap and the sleeper stages line up', () => {
  assert.equal(addNoise(95, 30), TUNING.noise.max);
  assert.equal(sleepStage(0), SLEEP_ASLEEP);
  assert.equal(sleepStage(TUNING.noise.max), SLEEP_AWAKE);
  assert.equal(sleepStage(TUNING.noise.max - 1) === SLEEP_AWAKE, false);
});

test('the exit works whatever the meter says, because the meter is a person', () => {
  // It used to be a fuse: fill it and the door stopped working, because he was
  // awake and the level was over. It is now how alert one person is, and being
  // hunted out of a building with a full meter and the haul still in the bag is
  // exactly the ending the game should allow — you got away with it.
  const level = LEVELS[0];
  const sim = createSim({ level, seed: 1 });
  sim.noise = TUNING.noise.max;
  const player = playerOf(sim);
  player.x = level.exit.x + level.exit.w / 2;
  player.y = level.exit.y + 20;
  stepSim(sim, { x: 0, y: 1, take: false });
  assert.equal(sim.status, 'won');
  // ...but it is graded as what it was. A run out of the door with the meter
  // full is a close call, and a close call pays no bonus.
  assert.equal(sim.escapeGrade.bonus, 0);
});

// --- movement feel ----------------------------------------------------------

// The longest unobstructed run of floor on a level, found rather than assumed:
// hard-coding "a clear stretch" ties the test to one particular map, and these
// maps change.
// Somewhere with room to walk in a straight line. `solids` rather than the
// level's own colliders because a shut door is in the way as much as a wall is,
// and a lane that crosses one is not a lane you can measure a walk along.
const clearStretch = (level, { onRug = null, solids = level.colliders } = {}) => {
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  let best = null;
  for (let y = PH; y < level.height - PH; y += 8) {
    let start = null;
    for (let x = PW; x <= level.width - PW; x += 8) {
      const free = !blocked(x, y, PW + 8, PH + 8, solids)
        && (onRug === null || onRug === level.rugs.some(
          (r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h));
      if (free) {
        if (start === null) start = x;
        const span = x - start;
        if (!best || span > best.span) best = { x: start, y, span };
      } else {
        start = null;
      }
    }
  }
  return best;
};

const openRun = () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  const lane = clearStretch(run.level, { solids: run.sim.solids });
  player.x = lane.x + TUNING.player.boxWidth;
  player.y = lane.y;
  return run;
};

test('top speed is unchanged: the polish did not make the game slower', () => {
  const run = openRun();
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0 });
  assert.ok(
    Math.abs(playerOf(run.sim).speed - TUNING.player.speed) < 2,
    `expected ~${TUNING.player.speed}, got ${playerOf(run.sim).speed}`
  );
});

test('movement accelerates instead of snapping to full speed', () => {
  const run = openRun();
  tick(run, { x: 1, y: 0 });
  const first = playerOf(run.sim).speed;
  assert.ok(first > 0, 'should start moving immediately');
  assert.ok(first < TUNING.player.speed * 0.5, `first frame jumped to ${first}`);
  // ...and still reaches full speed quickly enough to feel responsive
  for (let i = 0; i < 12; i++) tick(run, { x: 1, y: 0 });
  assert.ok(playerOf(run.sim).speed > TUNING.player.speed * 0.9, 'too slow to get going');
});

test('releasing the stick coasts to a stop, quickly', () => {
  const run = openRun();
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0 });
  for (let i = 0; i < 12; i++) tick(run, { x: 0, y: 0 });
  assert.equal(playerOf(run.sim).speed, 0);
  assert.equal(playerOf(run.sim).moving, false);
});

test('turning is eased, not instant', () => {
  const run = openRun();
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0 });
  const before = playerOf(run.sim).facing;
  tick(run, { x: -1, y: 0 });
  const after = playerOf(run.sim).facing;
  assert.notEqual(before, after, 'should begin turning');
  assert.ok(Math.abs(after - before) < Math.PI * 0.75, 'turned instantly instead of easing');
});

test('pushing into a wall does not bank up velocity', () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  player.x = 200;
  player.y = 100;
  for (let i = 0; i < 90; i++) tick(run, { x: 0, y: -1 }); // hold into the top wall
  const stuckY = playerOf(run.sim).y;
  assert.ok(playerOf(run.sim).vy === 0, 'velocity accumulated against the wall');
  tick(run, { x: 0, y: 0 });
  assert.ok(Math.abs(playerOf(run.sim).y - stuckY) < 1, 'lurched after releasing');
});

test('the pickup reach slows the player without freezing them', () => {
  const run = createRun(1);
  const item = run.sim.items[0];
  walkTo(run, item);
  for (let i = 0; i < 40 && !item.taken; i++) tick(run, { x: 0, y: 0, take: i % 2 === 0 });
  assert.equal(item.taken, true);
  assert.ok(run.sim.reach, 'a reach animation should be running');

  const start = { x: playerOf(run.sim).x, y: playerOf(run.sim).y };
  for (let i = 0; i < 10; i++) tick(run, { x: 0, y: 1 });
  const moved = Math.hypot(playerOf(run.sim).x - start.x, playerOf(run.sim).y - start.y);
  assert.ok(moved > 0.5, 'the player froze during the pickup');

  // and it ends on its own, well under a second
  let frames = 0;
  while (run.sim.reach && frames < 120) { tick(run, { x: 0, y: 0 }); frames++; }
  assert.ok(frames / 60 < 0.6, `reach ran for ${(frames / 60).toFixed(2)}s`);
});

test('screen shake settles instead of jittering forever', () => {
  const run = createRun(1);
  const item = run.sim.items[0];
  walkTo(run, item);
  for (let i = 0; i < 40 && !item.taken; i++) tick(run, { x: 0, y: 0, take: i % 2 === 0 });
  assert.ok(run.sim.shake > 0, 'taking a noisy item should register');
  for (let i = 0; i < 60; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.shake, 0);
  assert.equal(run.sim.shakeX, 0);
  assert.equal(run.sim.shakeY, 0);
});

// --- expansion: hazards, upgrades, stars ------------------------------------

test('a creaky board costs noise once, then goes quiet', () => {
  // Whatever is underfoot on the first level that has anything: a creaky board
  // where the map lays boards, a sheet of paper where it drops paper. They are
  // the same mechanic and only the price differs, so the test asks the tuning
  // what this one costs rather than assuming it found a board.
  const level = LEVELS.find((l) => l.creaks.length > 0);
  assert.ok(level, 'some level should have something underfoot');
  const sim = createSim({ level, seed: 3 });
  const zone = level.creaks[0];
  const priced = (TUNING.hazards.underfoot[zone.kind]
    || TUNING.hazards.underfoot.boards).noise;
  const player = playerOf(sim);

  player.x = zone.x - 30;
  player.y = zone.y + zone.h / 2;
  stepSim(sim, { x: 0, y: 0 });
  assert.equal(sim.noise, 0, 'standing outside costs nothing');

  player.x = zone.x + zone.w / 2;                    // step on
  stepSim(sim, { x: 0, y: 0 });
  // The printed cost, times how near the person listening is: every location
  // scales its noise by distance now, so the flat number is the floor price
  // rather than the price.
  assert.ok(Math.abs(sim.noise - priced * sim.proximity) < 0.5,
    `${zone.kind} cost ${sim.noise} at x${sim.proximity.toFixed(2)}, not ${priced}`);

  const events = [];
  for (let i = 0; i < 120; i++) {                     // stand on it
    stepSim(sim, { x: 0, y: 0 });
    events.push(...sim.events.filter((e) => e.type === 'creak'));
  }
  assert.equal(events.length, 0, 'a board must not creak again while stood on');
  assert.ok(sim.noise <= TUNING.hazards.creakNoise, 'a board must not drain you');
});

test('Soft Shoes silence the creaky boards', () => {
  const level = LEVELS.find((l) => l.creaks.length > 0);
  const zone = level.creaks[0];
  const quiet = createSim({ level, seed: 3, upgrades: { shoes: 3 } });
  const player = playerOf(quiet);
  player.x = zone.x + zone.w / 2;
  player.y = zone.y + zone.h / 2;
  stepSim(quiet, { x: 0, y: 0 });
  assert.equal(quiet.noise, 0);
});

test('no upgrade makes a stolen item quieter', () => {
  const level = LEVELS[0];
  const maxed = createSim({ level, seed: 1, upgrades: { shoes: 3, feet: 3, bag: 3 } });
  const plain = createSim({ level, seed: 1 });
  assert.deepEqual(
    maxed.items.map((i) => i.noise),
    plain.items.map((i) => i.noise),
    'the core risk/reward decision must be untouched by the shop'
  );
});

test('Quick Feet raise top speed, Velvet Bag raises the payout', () => {
  const level = LEVELS[0];
  // Whichever way out of the spawn actually has floor in it. The spawn is open
  // by construction; the room around it is furnished, so "up" is not a
  // direction you can rely on getting to full speed in.
  let best = 0;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const fast = createSim({ level, seed: 1, upgrades: { feet: 3 } });
    const player = playerOf(fast);
    for (let i = 0; i < 40; i++) stepSim(fast, { x: dx, y: dy });
    best = Math.max(best, player.speed);
  }
  assert.ok(best > TUNING.player.speed * 1.15, `only reached ${best}`);

  const rich = createSim({ level, seed: 1, upgrades: { bag: 3 } });
  assert.ok(rich.items[0].value > rich.items[0].rawValue);
  assert.equal(rich.items[0].rawValue, TUNING.items[level.items[0].type].value);
});

test('stars are judged on the raw haul, not the upgraded payout', () => {
  const level = LEVELS[0];
  const total = levelTotals(level).value;
  assert.equal(starsFor(level, total), 3);
  assert.equal(starsFor(level, Math.ceil(total * TUNING.stars.two)), 2);
  assert.equal(starsFor(level, 1), 1);

  // A maxed bag must not buy a star.
  const rich = play(1, { take: ['L1-0'], seed: 4 });
  const plain = play(1, { take: ['L1-0'], seed: 4 });
  assert.equal(starsFor(level, rich.result.haul), starsFor(level, plain.result.haul));
});

test('the win event reports what was taken, for the collection', () => {
  const level = LEVELS[1];
  const pair = [level.items[0], level.items[1]];
  const { run } = play(2, { take: pair.map((i) => i.id), seed: 8 });
  const win = run.sim.events.find((e) => e.type === 'won')
    || { taken: run.sim.items.filter((i) => i.taken).map((i) => i.type) };
  assert.deepEqual([...win.taken].sort(), pair.map((i) => i.type).sort());
});

// --- the clock ---------------------------------------------------------------

test('the clock starts full and runs down', () => {
  const run = createRun(1);
  const limit = timeLimit(run.level);
  assert.equal(run.sim.timeLeft, limit);
  for (let i = 0; i < 60; i++) tick(run, { x: 0, y: 0 });
  assert.ok(Math.abs(run.sim.timeLeft - (limit - 1)) < 0.05, `${run.sim.timeLeft}`);
});

test('running out of time fails the level, distinctly from being heard', () => {
  const run = createRun(1);
  const frames = Math.ceil(timeLimit(run.level) * 60) + 120;
  for (let i = 0; i < frames && run.sim.status === 'running'; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.status, 'lost');
  assert.equal(run.sim.failReason, 'time');
  assert.equal(run.sim.timeLeft, 0);
  assert.ok(run.sim.noise < TUNING.noise.max, 'he was never woken — the clock ran out');
});

test('the clock stops when the level ends', () => {
  const run = createRun(1);
  escape(run);
  assert.equal(run.sim.status, 'won');
  const remaining = run.sim.timeLeft;
  for (let i = 0; i < 120; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.timeLeft, remaining, 'the clock kept running after the win');
});

test('escaping in time still wins even with the clock nearly out', () => {
  // How long the walk out actually takes on this map, then barely enough of it.
  const measure = createRun(1);
  escape(measure);
  const needed = measure.sim.frame / 60;

  const run = createRun(1);
  run.sim.timeLeft = needed + 0.5;
  escape(run);
  assert.equal(run.sim.status, 'won');
  assert.ok(run.sim.timeLeft < 1, `finished with ${run.sim.timeLeft.toFixed(1)}s to spare`);
});

// --- bumping into things -----------------------------------------------------

const wardrobeLevel = () => LEVELS.find((l) => l.colliders.some((c) => c.type === 'furniture'));

test('walking squarely into furniture costs noise', () => {
  const { level, from, push } = RUN_UP;
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = from.x;
  player.y = from.y;
  for (let i = 0; i < 60 && run.sim.noise === 0; i++) tick(run, { x: push.x, y: push.y });
  assert.ok(run.sim.noise > 0, 'bumping a cabinet should be heard');
});

test('a wall is not furniture: brushing the room costs nothing', () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  // Put him against the outer wall on the spawn's own column and lean on it.
  player.x = run.level.spawn.x;
  player.y = run.level.height - TUNING.world.tile - TUNING.player.boxHeight / 2;
  for (let i = 0; i < 90; i++) tick(run, { x: 0, y: 1 });
  assert.equal(run.sim.noise, 0);
});

test('leaning on furniture does not drain the meter', () => {
  const level = LEVELS[0];
  const furniture = level.colliders.find((c) => c.type === 'furniture');
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = furniture.x + furniture.w / 2;
  player.y = furniture.y - 40;
  for (let i = 0; i < 60 * 8; i++) tick(run, { x: 0, y: 1 });  // shove for 8 seconds
  // Without a cooldown this would be hundreds of noise; with one it is a
  // handful of separate collisions.
  assert.ok(run.sim.noise < 40, `leaning cost ${run.sim.noise} noise`);
});

test('a glancing slide along furniture is not a collision', () => {
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  // The widest piece of furniture in the game with genuinely clear floor along
  // its top edge. Searching for the subject rather than naming one keeps the
  // test about the rule instead of about one particular room.
  let best = null;
  for (const level of LEVELS) {
    const others = (c) => level.colliders.filter((o) => o !== c);
    for (const c of level.colliders.filter((x) => x.type === 'furniture')) {
      let clear = true;
      for (let x = c.x - 20; x < c.x + c.w + 20; x += 6) {
        if (blocked(x, c.y - PH / 2 - 3, PW, PH, others(c))) { clear = false; break; }
      }
      if (clear && (!best || c.w > best.furniture.w)) best = { level, furniture: c };
    }
  }
  assert.ok(best && best.furniture.w > 100, 'expected a long clear edge to slide along');

  const run = createRun(best.level.id);
  const player = playerOf(run.sim);
  // Start alongside it, just clear of the top edge, and drift down onto that
  // edge while running along it. Approaching from the side and hitting the end
  // face is a collision, not a graze — that is the test above.
  player.x = best.furniture.x + PW;
  player.y = best.furniture.y - PH / 2 - 3;
  const strides = Math.floor((best.furniture.w - PW * 2) / 2.2);
  let bumps = 0;
  for (let i = 0; i < strides; i++) {
    tick(run, { x: 1, y: 0.06 });
    bumps += run.sim.events.filter((e) => e.type === 'bump').length;
  }

  // A control: the same run, the same distance, on open floor. Footsteps cost
  // noise either way — the question is whether brushing the edge adds anything
  // on top, and comparing against zero would only be testing the footsteps.
  const control = createRun(best.level.id);
  const lane = clearStretch(control.level, { solids: control.sim.solids });
  const walker = playerOf(control.sim);
  walker.x = lane.x + PW;
  walker.y = lane.y;
  for (let i = 0; i < strides; i++) tick(control, { x: 1, y: 0 });

  assert.ok(player.y + PH / 2 <= best.furniture.y + 1, 'the slide should stay on the edge');
  assert.equal(bumps, 0, 'grazing an edge is not a collision');
  assert.ok(run.sim.noise <= control.sim.noise + 0.01,
    `sliding cost ${run.sim.noise.toFixed(2)} against ${control.sim.noise.toFixed(2)} for the same walk`);
});

// --- recovery ----------------------------------------------------------------

test('standing perfectly still bleeds noise off, slowly', () => {
  const run = createRun(1);
  run.sim.noise = 60;
  for (let i = 0; i < 30; i++) tick(run, { x: 0, y: 0 });    // half a second
  assert.equal(run.sim.noise, 60, 'recovery should not start instantly');

  for (let i = 0; i < 60 * 2; i++) tick(run, { x: 0, y: 0 });
  // Against this location's own settling rate: how readily a building goes
  // quiet is part of who lives in it, and a flat number here would only be
  // testing that nobody had given anyone a personality.
  const settle = locationRules(run.level).recovery;
  const dropped = 60 - run.sim.noise;
  // Two and a half seconds of standing still by now — half a second above,
  // then two more — of which the delay is spent before anything moves.
  const want = (2.5 - settle.delay) * settle.rate;
  assert.ok(Math.abs(dropped - want) < 0.6, `dropped ${dropped.toFixed(1)}, expected ${want.toFixed(1)}`);
  // ...and slow enough, wherever you are, that it is a decision against the
  // clock rather than a button that undoes a mistake.
  assert.ok(dropped < 15, `dropped ${dropped.toFixed(1)} in two seconds`);
});

test('recovery is far too slow to be a reset button', () => {
  const run = createRun(1);
  run.sim.noise = 90;
  for (let i = 0; i < 60 * 2; i++) tick(run, { x: 0, y: 0 });
  assert.ok(run.sim.noise > 80, `90 fell to ${run.sim.noise.toFixed(1)} in two seconds`);
});

test('moving stops recovery', () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  player.x = 120;
  player.y = 420;
  run.sim.noise = 50;
  let lowest = 50;
  for (let i = 0; i < 60 * 2; i++) {
    tick(run, { x: 1, y: 0 });
    lowest = Math.min(lowest, run.sim.noise);
  }
  // It may well have gone *up* — there is furniture over there to walk into.
  assert.equal(lowest, 50, 'walking should never calm the room');
});

test('noise never goes negative and never exceeds the cap', () => {
  const run = createRun(1);
  run.sim.noise = 1;
  for (let i = 0; i < 60 * 5; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.noise, 0);

  const loud = createRun(10);
  loud.sim.noise = 99;
  const item = loud.sim.items[0];
  walkTo(loud, item);
  for (let i = 0; i < 40 && !item.taken && loud.sim.status === 'running'; i++) {
    tick(loud, { x: 0, y: 0, take: i % 2 === 0 });
  }
  assert.ok(loud.sim.noise <= TUNING.noise.max);
});

// --- expansion 2: rarity, streaks, surfaces, escape grades -------------------

test('rarity is read off the value, so no item can forget to declare its risk', () => {
  assert.equal(rarityOf('coin').name, 'Common');
  assert.equal(rarityOf('headphones').name, 'Uncommon');
  assert.equal(rarityOf('laptop').name, 'Rare');
  assert.equal(rarityOf('diamond').name, 'Very Rare');
  // ...and the more it is worth, the longer it takes to lift.
  assert.ok(rarityOf('diamond').pickup > rarityOf('coin').pickup);
});

test('star targets are always reachable without waking him', () => {
  for (const level of LEVELS) {
    const marks = starThresholds(level);
    assert.ok(marks.three <= marks.reachable,
      `level ${level.id} asks for $${marks.three} but only $${marks.reachable} is gettable`);
    assert.ok(marks.two < marks.three, `level ${level.id} star targets are not ordered`);
    // The naive alternative — a share of the room's raw total — would routinely
    // demand more than the noise cap allows.
    assert.ok(marks.reachable <= levelTotals(level).value);
  }
});

test('a streak forms from quick steals and pays a bonus', () => {
  // A level with enough lying about to make three quick lifts possible: most of
  // what a level is worth is inside the furniture now, so a level's *floor* can
  // be down to three coins spread across a building.
  const busiest = LEVELS.reduce((a, b) => (a.items.length >= b.items.length ? a : b));
  const run = createRun(busiest.id);
  // The three items closest *to each other* — not the three nearest to whichever
  // one happens to be first in the list, which is a different question and on a
  // floorplan can pick a tight pair and something two galleries away. A streak
  // is about stealing without dawdling, so the test has to find the place on the
  // map where that is possible and go there.
  const items = run.sim.items;
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let near = items.slice(0, 3);
  let widest = Infinity;
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      for (let c = b + 1; c < items.length; c++) {
        const spread = Math.max(gap(items[a], items[b]), gap(items[b], items[c]),
          gap(items[a], items[c]));
        if (spread < widest) { widest = spread; near = [items[a], items[b], items[c]]; }
      }
    }
  }
  for (const item of near) {
    if (run.sim.status !== 'running') break;
    steal(run, item.id);
  }
  assert.ok(run.sim.streak >= 3, `streak was ${run.sim.streak}`);
  assert.ok(run.sim.money > run.sim.haul, 'a streak should pay over the raw haul');
});

test('a streak lapses if you dawdle', () => {
  const run = createRun(2);
  steal(run, run.sim.items[0].id);
  assert.equal(run.sim.streak, 1);
  for (let i = 0; i < 60 * (TUNING.combo.window + 1); i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.streak, 0);
});

test('footsteps are silent on a rug and audible on bare boards', () => {
  // The roomiest rug in the game, so the walk stays on it for the whole test.
  const level = LEVELS.filter((l) => l.rugs.length > 0)
    .sort((a, b) => Math.max(...b.rugs.map((r) => r.w * r.h)) - Math.max(...a.rugs.map((r) => r.w * r.h)))[0];
  const rug = [...level.rugs].sort((a, b) => b.w * b.h - a.w * a.h)[0];

  const onRug = createRun(level.id);
  const a = playerOf(onRug.sim);
  a.x = rug.x + TUNING.player.boxWidth;
  a.y = rug.y + rug.h / 2;
  // Only as far as the rug goes: walking off it would be testing the boards.
  const strides = Math.max(10, Math.floor((rug.w - TUNING.player.boxWidth * 2) / 2));
  for (let i = 0; i < strides; i++) tick(onRug, { x: 1, y: 0 });
  assert.equal(onRug.sim.noise, 0, 'a rug should swallow footsteps');
  assert.equal(onRug.sim.onSoftFloor, true);

  const onBoards = createRun(level.id);
  const b = playerOf(onBoards.sim);
  const boards = clearStretch(level, { onRug: false });
  b.x = boards.x + TUNING.player.boxWidth;
  b.y = boards.y;
  for (let i = 0; i < 60; i++) tick(onBoards, { x: 1, y: 0 });
  assert.ok(onBoards.sim.noise > 0, 'bare boards should carry');
  assert.ok(onBoards.sim.noise < 2, `a second of walking cost ${onBoards.sim.noise}`);
});

test('a quiet, unhurried escape is graded perfect and pays a bonus', () => {
  const run = createRun(1);
  steal(run, 'L1-0');                          // one quiet item
  escape(run);
  assert.equal(run.sim.status, 'won');
  assert.equal(run.sim.escapeGrade.grade, 'perfect');
  assert.ok(run.sim.money > run.sim.haul);
});

test('a loud or last-second escape is graded a close call, with no bonus', () => {
  const run = createRun(1);
  run.sim.noise = 90;
  // Grading, not stealth. At ninety the flat's sleeper is up and coming, and
  // whether he catches this particular walk to the door is not what this test
  // is about — so there is nobody in the building for it.
  run.sim.investigator = null;
  run.sim.investigateRules = null;
  escape(run);
  assert.equal(run.sim.status, 'won');
  assert.equal(run.sim.escapeGrade.grade, 'close');
  assert.equal(run.sim.escapeGrade.bonus, 0);
});

test('a level is never graded until it is actually left', () => {
  // The counterpart to the grading tests above: money and bonuses are handed
  // out at the door and nowhere else, so a run with the meter full and the
  // haul in the bag has no grade at all until it gets out.
  const run = createRun(1);
  run.sim.noise = 99.9;
  const item = run.sim.items[0];
  walkTo(run, item);
  for (let i = 0; i < 40 && run.sim.status === 'running'; i++) {
    tick(run, { x: 0, y: 0, take: i % 2 === 0 });
  }
  assert.equal(run.sim.escapeGrade, null);
  // ...and running the clock out is a loss whatever is in the bag.
  run.sim.timeLeft = 0.2;
  for (let i = 0; i < 60 && run.sim.status === 'running'; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.status, 'lost');
  assert.equal(run.sim.failReason, 'time');
  assert.equal(run.sim.escapeGrade, null);
});

// --- movement feel: the stick is an analog control -------------------------

test('joystick magnitude maps straight through to speed', () => {
  for (const magnitude of [0.25, 0.5, 0.75, 1]) {
    const run = openRun();
    for (let i = 0; i < 40; i++) tick(run, { x: magnitude, y: 0 });
    const share = playerOf(run.sim).speed / TUNING.player.speed;
    assert.ok(Math.abs(share - magnitude) < 0.06,
      `stick at ${magnitude} produced ${(share * 100).toFixed(0)}% speed`);
  }
});

test('a resting thumb does not creep, but a gentle push still walks', () => {
  const dead = TUNING.player.deadZone;
  assert.deepEqual(shapeStick(dead * 0.6, 0), { x: 0, y: 0 }, 'inside the dead zone is still');
  assert.deepEqual(shapeStick(0, 0), { x: 0, y: 0 });

  const gentle = shapeStick(dead + 0.02, 0);
  assert.ok(gentle.x > 0 && gentle.x < 0.1, `a gentle push gave ${gentle.x.toFixed(3)}`);

  // Above the dead zone, displacement maps one-to-one onto speed — a stick
  // pushed a quarter of the way is a quarter speed, exactly.
  for (const magnitude of [0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(shapeStick(magnitude, 0).x - magnitude) < 1e-9,
      `${magnitude} did not pass through`);
  }
  assert.ok(Math.abs(Math.hypot(...Object.values(shapeStick(0.8, 0.8))) - 1) < 1e-9,
    'a diagonal at full deflection is still full speed, not faster');
});

test('the walk cycle advances with distance, never with time', () => {
  // Held at one speed, phase and distance stay in lockstep. This is the
  // promise that stops feet skating: the cycle cannot advance while the
  // character is not going anywhere, whatever the frame rate is doing.
  const run = openRun();
  for (let i = 0; i < 40; i++) tick(run, { x: 1, y: 0 });   // reach top speed
  const p = playerOf(run.sim);
  const mark = { phase: p.walkPhase, x: p.x };
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0 });
  const first = (p.walkPhase - mark.phase) / (p.x - mark.x);
  const mark2 = { phase: p.walkPhase, x: p.x };
  for (let i = 0; i < 30; i++) tick(run, { x: 1, y: 0 });
  const second = (p.walkPhase - mark2.phase) / (p.x - mark2.x);
  assert.ok(Math.abs(first - second) < 1e-9,
    `phase per unit drifted: ${first} then ${second}`);

  // Once he has actually come to rest — he still coasts a little while
  // decelerating, and those steps are real — the cycle stops dead.
  for (let i = 0; i < 60; i++) tick(run);
  assert.equal(p.speed, 0, 'he should have stopped by now');
  const held = p.walkPhase;
  for (let i = 0; i < 60; i++) tick(run);
  assert.equal(playerOf(run.sim).walkPhase, held, 'a standing character must not step');
});

test('a creep takes more, shorter steps per unit than a run', () => {
  // The gait itself changes with speed, which is the point: tiptoeing is not a
  // walk in slow motion, it is a different, shorter stride. So the same metre
  // of floor costs more steps when you cross it carefully.
  const creep = openRun();
  const sprint = openRun();
  // Ninety, not the hundred and fifty this used to walk. The lane `openRun`
  // finds is the longest stretch of floor with nothing in the way, and a shut
  // door is now something in the way — so the longest one on level 1 is shorter
  // than it was, and a run at top speed used to cross the whole of it and spend
  // its last frames pressed against the far wall with the phase standing still.
  for (let i = 0; i < 90; i++) tick(creep, { x: 0.25, y: 0 });
  for (let i = 0; i < 90; i++) tick(sprint, { x: 1, y: 0 });
  const startX = playerOf(openRun().sim).x;
  const cp = playerOf(creep.sim);
  const sp = playerOf(sprint.sim);
  const creepPerUnit = cp.walkPhase / (cp.x - startX);
  const runPerUnit = sp.walkPhase / (sp.x - startX);
  assert.ok(creepPerUnit > runPerUnit * 1.4,
    `creeping should be far more steps per unit: ${creepPerUnit.toFixed(4)} vs ${runPerUnit.toFixed(4)}`);
  // ...and yet moving faster is still more steps per second, or the animation
  // would visibly lag the movement.
  // Four times the stick, but a stride twice as long with it, so the cadence
  // only goes up by about half — which is the whole shape of the band table and
  // the reason a run reads as a run rather than as a walk on fast-forward.
  assert.ok(sp.walkPhase > cp.walkPhase * 1.35,
    `faster must still step more often: ${sp.walkPhase.toFixed(2)} vs ${cp.walkPhase.toFixed(2)}`);
});

test('the gait blend follows the actual speed, and only the speed', () => {
  const still = gaitBlend(0);
  assert.equal(still.creep, 0);
  assert.equal(still.run, 0);
  assert.equal(still.walk, 0);
  assert.equal(still.moving, 0, 'a standing character has no cycle at all');
  const creeping = gaitBlend(0.2);
  assert.equal(creeping.creep, 1, 'a quarter speed is a full tiptoe');
  assert.equal(creeping.run, 0);
  const walking = gaitBlend(0.65);
  assert.equal(walking.creep, 0, 'a normal walk has no creep left in it');
  assert.equal(walking.run, 0, '...and is not yet a run');
  const running = gaitBlend(1);
  assert.equal(running.run, 1, 'top speed is a full run');
  // Step length is the reciprocal of cadence, which is the whole reason the
  // feet stay on the floor: a run covers more ground per step than a creep.
  assert.ok(running.stride > walking.stride && walking.stride > creeping.stride,
    `stride should grow with speed: ${creeping.stride} / ${walking.stride} / ${running.stride}`);
  assert.ok(Math.abs(walking.stride - 1) < 1e-9, 'a normal walk is the unit stride');
  for (const share of [0.15, 0.3, 0.5, 0.75, 0.9, 1]) {
    const g = gaitBlend(share);
    assert.ok(Math.abs(g.stride * stridePerUnit(share) - TUNING.player.gait.strideWalk) < 1e-9,
      `stride and cadence disagree at ${share}: the feet would skate`);
  }
  // No jumps: the blend is continuous across both handover points.
  for (const at of [TUNING.player.gait.creepAt, TUNING.player.gait.walkAt, TUNING.player.runAt]) {
    const below = gaitBlend(at - 1e-4);
    const above = gaitBlend(at + 1e-4);
    assert.ok(Math.abs(below.creep - above.creep) < 0.01 && Math.abs(below.run - above.run) < 0.01,
      `the gait jumps at ${at}`);
  }
});

// --- collisions scale with how hard you hit ---------------------------------

// Somewhere in the game with room to get a run-up at a piece of furniture.
//
// Taking whichever collider happens to be first on level one ties these tests
// to one particular generated map — and the moment the rooms were properly
// furnished, the first piece on level one had Dad's bed a tile above it and
// nobody could stand there. So: search the levels for a piece with a clear
// approach from any of the four sides, and hand back where to stand and which
// way to push.
function runUp(clearance = 52) {
  const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const level of LEVELS) {
    const solid = level.colliders;
    for (const c of level.colliders) {
      if (c.type !== 'furniture') continue;
      for (const [dx, dy] of sides) {
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        const edgeX = cx + dx * (c.w / 2);
        const edgeY = cy + dy * (c.h / 2);
        let clear = true;
        for (let d = 13; d <= clearance + 13; d += 6) {
          const x = dx ? edgeX + dx * d : cx;
          const y = dy ? edgeY + dy * d : cy;
          if (x < 32 || y < 32 || x > level.width - 32 || y > level.height - 32) { clear = false; break; }
          if (solid.some((o) => o !== c
            && x + 11 > o.x && x - 11 < o.x + o.w && y + 12 > o.y && y - 12 < o.y + o.h)) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        return {
          level,
          furniture: c,
          from: { x: dx ? edgeX + dx * 46 : cx, y: dy ? edgeY + dy * 46 : cy },
          push: { x: -dx, y: -dy }
        };
      }
    }
  }
  throw new Error('no furniture in the whole game has a clear approach');
}

const RUN_UP = runUp();

function bumpInto(magnitude) {
  const { level, from, push } = RUN_UP;
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = from.x;
  player.y = from.y;
  for (let i = 0; i < 80; i++) {
    tick(run, { x: push.x * magnitude, y: push.y * magnitude });
    const bump = run.sim.events.find((e) => e.type === 'bump');
    if (bump) return bump;
  }
  return null;
}

test('the same furniture costs more noise the faster you hit it', () => {
  const gentle = bumpInto(0.4);
  const hard = bumpInto(1);
  assert.ok(gentle, 'a slow walk into furniture should still register');
  assert.ok(hard.noise > gentle.noise * 2,
    `slow ${gentle.noise} vs fast ${hard.noise} — impact should matter`);
  assert.ok(hard.force > gentle.force);
});

test('a hard collision bounces you back and shakes the room', () => {
  const { level, from, push } = RUN_UP;
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = from.x;
  player.y = from.y;
  let atImpact = null;
  for (let i = 0; i < 80; i++) {
    tick(run, { x: push.x, y: push.y });
    if (run.sim.events.some((e) => e.type === 'bump')) { atImpact = playerOf(run.sim).y; break; }
  }
  assert.ok(atImpact !== null);
  assert.ok(run.sim.shake > 0, 'a hard hit should shake');
  assert.ok(run.sim.startle > 0, 'a hard hit should make him flinch');
});

test('a bang makes him flinch, and the flinch fades on its own', () => {
  const run = createRun(1);
  run.sim.startle = 1;
  for (let i = 0; i < 60 * 2; i++) tick(run, { x: 0, y: 0 });
  assert.equal(run.sim.startle, 0);
});

test('you can always walk away from furniture — never stuck, never jittering', () => {
  const { level, from, push } = RUN_UP;
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = from.x;
  player.y = from.y;
  for (let i = 0; i < 90; i++) tick(run, { x: push.x, y: push.y });      // shove into it
  const stuckAt = { x: playerOf(run.sim).x, y: playerOf(run.sim).y };

  for (let i = 0; i < 60; i++) tick(run, { x: -push.x, y: -push.y });    // and walk away
  const back = playerOf(run.sim);
  assert.ok(Math.hypot(back.x - stuckAt.x, back.y - stuckAt.y) > 40,
    'should have escaped the furniture');
  assert.ok(!blocked(playerOf(run.sim).x, playerOf(run.sim).y,
    TUNING.player.boxWidth, TUNING.player.boxHeight, level.colliders),
    'must never end up inside a collider');
});

// --- who is in the room -----------------------------------------------------

// The most watchful level in the game — the clearest case to test sight on.
const guardLevel = () => LEVELS.filter((l) => watcherConfig(l.watcher.kind).sees > 0)
  .sort((a, b) => b.watcher.sees - a.watcher.sees)[0];

// Somewhere the player can stand, well inside a watcher's range, with room to
// move. Hunted for rather than assumed: the guard's range and the furniture
// round him differ from level to level.
const spotInSight = (level) => {
  const { boxWidth: PW, boxHeight: PH } = TUNING.player;
  const range = level.watcher.sees || watcherConfig(level.watcher.kind).sees;
  let best = null;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
    for (let d = range * 0.3; d < range * 0.8; d += 8) {
      const x = level.watcher.x + Math.cos(angle) * d;
      const y = level.watcher.y + Math.sin(angle) * d;
      if (blocked(x, y, PW + 30, PH, level.colliders)) continue;
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best;
};

test('every level declares who is in it, and a location keeps the same person', () => {
  for (const level of LEVELS) {
    assert.ok(level.watcher && level.watcher.kind, `level ${level.id} has no watcher`);
    assert.ok(TUNING.watchers[level.watcher.kind], `unknown watcher on level ${level.id}`);
  }
  // The five levels of a location are the same building and the same person:
  // that is what makes them a chapter rather than five unrelated rooms.
  const byLocation = {};
  for (const level of LEVELS) (byLocation[level.location] ||= []).push(level);
  for (const [location, levels] of Object.entries(byLocation)) {
    const kinds = new Set(levels.map((l) => l.watcher.kind));
    assert.equal(kinds.size, 1, `${location} has ${kinds.size} different people in it`);
  }
});

test('a guard pays more attention as a location goes on', () => {
  const byLocation = {};
  for (const level of LEVELS) (byLocation[level.location] ||= []).push(level);
  let checked = 0;
  for (const levels of Object.values(byLocation)) {
    if (watcherConfig(levels[0].watcher.kind).sees === 0) continue;
    const ranges = levels.map((l) => l.watcher.sees);
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i] > ranges[i - 1],
        `${levels[i].location} level ${i + 1} sees ${ranges[i]}, no further than level ${i}`);
    }
    checked++;
  }
  assert.ok(checked >= 3, `expected several watched locations, checked ${checked}`);
});

test('a guard raises ALERT, a sleeper raises NOISE — one meter, two names', () => {
  // The people who are asleep raise NOISE; the ones who are awake raise ALERT.
  for (const kind of ['sleeper', 'dad', 'grandpa', 'caretaker', 'doctor', 'worker',
    'porter', 'owner', 'shopkeeper']) {
    assert.equal(watcherConfig(kind).meter, 'NOISE', `${kind} should raise NOISE`);
    assert.equal(watcherConfig(kind).sees, 0, `${kind} should not be watching`);
  }
  for (const kind of ['nightguard', 'security', 'vaultguard']) {
    assert.equal(watcherConfig(kind).meter, 'ALERT', `${kind} should raise ALERT`);
    assert.ok(watcherConfig(kind).sees > 0, `${kind} should be watching`);
  }
});

test('the campaign actually visits every kind of watcher there is', () => {
  const used = new Set(LEVELS.map((l) => l.watcher.kind));
  for (const kind of Object.keys(TUNING.watchers)) {
    // `sleeper` is the fallback the config returns for an unknown kind, so it
    // is allowed to exist without a level of its own.
    if (kind === 'sleeper') continue;
    assert.ok(used.has(kind), `no level uses the ${kind} watcher`);
  }
  // Eleven locations, each with its own palette and furniture.
  const themes = new Set(LEVELS.map((l) => l.theme));
  assert.equal(themes.size, 11, `expected eleven locations, found ${themes.size}`);
});

test('moving in a guard’s line of sight raises the meter in silence', () => {
  const level = guardLevel();
  assert.ok(level, 'expected a level with a guard');
  const sim = createSim({ level, seed: 3 });
  const player = playerOf(sim);
  // Well inside his range, and clear of furniture. Oscillating keeps the
  // player from simply walking out of range.
  const spot = spotInSight(level);
  assert.ok(spot, 'expected somewhere to stand inside his range');
  player.x = spot.x;
  player.y = spot.y;
  const before = sim.noise;
  for (let i = 0; i < 180; i++) {
    stepSim(sim, { x: (Math.floor(i / 20) % 2 ? 1 : -1) * 0.9, y: 0 });
  }
  assert.ok(sim.noise > before + 6, `only rose to ${sim.noise.toFixed(1)}`);
  assert.equal(sim.items.filter((i) => i.taken).length, 0, 'nothing was stolen — this is pure sight');
});

test('freezing inside a guard’s sight is safe', () => {
  const level = guardLevel();
  const sim = createSim({ level, seed: 3 });
  const player = playerOf(sim);
  player.x = level.watcher.x - 40;
  player.y = level.watcher.y - 50;
  for (let i = 0; i < 180; i++) stepSim(sim, { x: 0, y: 0 });
  assert.equal(sim.noise, 0, `standing still cost ${sim.noise.toFixed(1)}`);
});

test('a guard notices you more the closer and faster you are', () => {
  const watcher = { kind: 'nightguard', x: 200, y: 200 };
  const near = detectionRate(watcher, { x: 230, y: 200 }, 1);
  const far = detectionRate(watcher, { x: 310, y: 200 }, 1);
  const creeping = detectionRate(watcher, { x: 230, y: 200 }, 0.3);
  const outside = detectionRate(watcher, { x: 400, y: 200 }, 1);
  assert.ok(near > far && far > 0);
  assert.ok(creeping < near && creeping > 0);
  assert.equal(outside, 0);
  assert.equal(detectionRate({ kind: 'sleeper', x: 200, y: 200 }, { x: 205, y: 200 }, 1), 0,
    'a sleeper never sees anything');
});

test('a side exit works exactly like a bottom one', () => {
  const level = LEVELS.find((l) => l.exit.side === 'left');
  assert.ok(level, 'expected a level with a side exit');
  const run = createRun(level.id);
  escape(run);
  assert.equal(run.sim.status, 'won');
});

test('every level has a reachable way out, whichever wall it is in', () => {
  const sides = new Set(LEVELS.map((l) => l.exit.side));
  assert.ok(sides.has('bottom') && sides.size > 1, `only found ${[...sides]}`);
  for (const level of LEVELS) {
    assert.ok(level.exit.w > 0 && level.exit.h > 0, `level ${level.id} has no exit`);
  }
});
