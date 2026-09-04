import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stepSim, snapshot, playerOf, STEP_SECONDS } from '../src/sim.js';
import { solveMove } from '../src/physics.js';
import { LEVELS } from '../src/levels.js';
import { TUNING } from '../src/tuning.js';
import { play, createRun, tick, walkTo, steal, escape } from './harness.mjs';
import { addNoise, sleepStage, SLEEP_AWAKE, SLEEP_ASLEEP } from '../src/rules.js';

test('a scripted run wins with exactly the money it stole', () => {
  const { result } = play(1, { take: ['L1-0', 'L1-2'] });
  assert.equal(result.status, 'won');
  assert.equal(result.money, 30 + 45);
  assert.equal(result.noise, 8 + 10);
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
