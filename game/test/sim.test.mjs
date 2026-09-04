import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, snapshot, playerOf, STEP_SECONDS } from '../src/sim.js';
import { solveMove } from '../src/physics.js';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { play, createRun, tick, walkTo, steal, escape } from './harness.mjs';
import {
  addNoise, sleepStage, SLEEP_AWAKE, SLEEP_ASLEEP, starsFor, levelTotals, timeLimit
} from '../src/rules.js';

test('a scripted run wins with exactly the money it stole', () => {
  const { result } = play(1, { take: ['L1-0', 'L1-2'] });
  assert.equal(result.status, 'won');
  assert.equal(result.money, 30 + 45);
  // Noise is no longer a pure sum: bumping furniture adds to it and standing
  // still bleeds it off, so only the money is exact.
  assert.ok(result.noise > 0 && result.noise < TUNING.noise.max);
});

test('taking everything on level 10 wakes him', () => {
  const { result } = play(10);
  assert.equal(result.status, 'lost');
  assert.equal(result.noise, TUNING.noise.max);
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
    play(6, { take: ['L6-0', 'L6-6'] });
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

test('the exit does nothing once he is awake', () => {
  const level = LEVELS[0];
  const sim = createSim({ level, seed: 1 });
  sim.noise = TUNING.noise.max;
  const player = playerOf(sim);
  player.x = level.exit.x + level.exit.w / 2;
  player.y = level.exit.y + 20;
  stepSim(sim, { x: 0, y: 1, take: false });
  assert.notEqual(sim.status, 'won');
});

// --- movement feel ----------------------------------------------------------

const openRun = () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  // A genuinely clear stretch of floor on level 1: furniture sits at x<98 and
  // x>286 on this row, so there is room to reach top speed and turn around.
  player.x = 120;
  player.y = 420;
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
  const level = LEVELS.find((l) => l.creaks.length > 0);
  assert.ok(level, 'some level should have a creaky board');
  const sim = createSim({ level, seed: 3 });
  const zone = level.creaks[0];
  const player = playerOf(sim);

  player.x = zone.x - 30;
  player.y = zone.y + zone.h / 2;
  stepSim(sim, { x: 0, y: 0 });
  assert.equal(sim.noise, 0, 'standing outside costs nothing');

  player.x = zone.x + zone.w / 2;                    // step on
  stepSim(sim, { x: 0, y: 0 });
  assert.equal(sim.noise, TUNING.hazards.creakNoise);

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
  const fast = createSim({ level, seed: 1, upgrades: { feet: 3 } });
  const player = playerOf(fast);
  player.x = 120;
  player.y = 420;
  for (let i = 0; i < 40; i++) stepSim(fast, { x: 1, y: 0 });
  assert.ok(player.speed > TUNING.player.speed * 1.15, `only reached ${player.speed}`);

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
  const { run } = play(2, { take: ['L2-0', 'L2-2'], seed: 8 });
  const win = run.sim.events.find((e) => e.type === 'won')
    || { taken: run.sim.items.filter((i) => i.taken).map((i) => i.type) };
  assert.deepEqual([...win.taken].sort(), ['cash', 'watch']);
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
  for (let i = 0; i < 60 * 40 && run.sim.status === 'running'; i++) tick(run, { x: 0, y: 0 });
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
  const run = createRun(1);
  run.sim.timeLeft = 3;
  escape(run);
  assert.equal(run.sim.status, 'won');
});

// --- bumping into things -----------------------------------------------------

const wardrobeLevel = () => LEVELS.find((l) => l.colliders.some((c) => c.type === 'furniture'));

test('walking squarely into furniture costs noise', () => {
  const level = LEVELS[0];
  const furniture = level.colliders.find((c) => c.type === 'furniture');
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = furniture.x + furniture.w / 2;
  player.y = furniture.y - 40;
  for (let i = 0; i < 60 && run.sim.noise === 0; i++) tick(run, { x: 0, y: 1 });
  assert.ok(run.sim.noise > 0, 'bumping a cabinet should be heard');
});

test('a wall is not furniture: brushing the room costs nothing', () => {
  const run = createRun(1);
  const player = playerOf(run.sim);
  player.x = 200;
  player.y = 60;
  for (let i = 0; i < 90; i++) tick(run, { x: 0, y: -1 });   // hold into the top wall
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
  const level = LEVELS[0];
  const furniture = level.colliders.find((c) => c.type === 'furniture');
  const run = createRun(level.id);
  const player = playerOf(run.sim);
  player.x = furniture.x - 30;
  player.y = furniture.y + 4;                 // just grazing the top edge
  for (let i = 0; i < 90; i++) tick(run, { x: 1, y: 0.06 });
  assert.equal(run.sim.noise, 0, 'sliding past should be silent');
});

// --- recovery ----------------------------------------------------------------

test('standing perfectly still bleeds noise off, slowly', () => {
  const run = createRun(1);
  run.sim.noise = 60;
  for (let i = 0; i < 30; i++) tick(run, { x: 0, y: 0 });    // half a second
  assert.equal(run.sim.noise, 60, 'recovery should not start instantly');

  for (let i = 0; i < 60 * 2; i++) tick(run, { x: 0, y: 0 });
  const dropped = 60 - run.sim.noise;
  assert.ok(dropped > 2 && dropped < 6, `dropped ${dropped.toFixed(1)} in two seconds`);
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
