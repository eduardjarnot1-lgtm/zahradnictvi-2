// The simulation. Pure in the sense that matters: no document, no ctx, no Date,
// no Math.random. One fixed tick in, new state out. Everything the host needs to
// know about a tick comes back as events.
import { TUNING } from './tuning.js';
import { createRng } from './rng.js';
import { solveMove, clampToWorld } from './physics.js';
import { addNoise, isAwake, itemStats, canBank, sleepStage } from './rules.js';

export const STEP_SECONDS = 1 / TUNING.sim.hz;

export const EMPTY_INPUT = Object.freeze({ x: 0, y: 0, take: false });

// Per-kind update functions. A guard, a dog or a rolling can is a new entry
// here plus a spawn — it does not touch the loop.
const UPDATERS = {
  player(entity, sim, input) {
    let { x: ix, y: iy } = input;
    const length = Math.hypot(ix, iy);
    if (length > 1) { ix /= length; iy /= length; }

    entity.vx = ix * TUNING.player.speed;
    entity.vy = iy * TUNING.player.speed;

    const moved = solveMove(
      entity,
      entity.vx * STEP_SECONDS,
      entity.vy * STEP_SECONDS,
      sim.level.colliders
    );
    const clamped = clampToWorld(moved.x, moved.y, entity.w, entity.h);
    entity.x = clamped.x;
    entity.y = clamped.y;
    entity.moving = length > 0.01 && (moved.x !== entity.prevX || moved.y !== entity.prevY);
  }
};

export function createSim({ level, seed = 1 }) {
  const player = {
    kind: 'player',
    x: level.spawn.x,
    y: level.spawn.y,
    prevX: level.spawn.x,
    prevY: level.spawn.y,
    vx: 0,
    vy: 0,
    w: TUNING.player.boxWidth,
    h: TUNING.player.boxHeight,
    moving: false
  };

  return {
    level,
    seed,
    rng: createRng(seed),
    frame: 0,
    status: 'running', // running | won | lost
    money: 0,
    noise: 0,
    entities: [player],
    items: level.items.map((item) => {
      const stats = itemStats(item.type);
      return {
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        value: stats.value,
        noise: stats.noise,
        taken: false,
        inRange: false,
        takenAtFrame: -1
      };
    }),
    targetId: null,   // the in-range item a TAKE would consume
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    prevTake: false,
    events: []
  };
}

export const playerOf = (sim) => sim.entities.find((e) => e.kind === 'player');

function finish(sim, status) {
  if (sim.status !== 'running') return; // a level can only end once
  sim.status = status;
  sim.events.push({ type: status, money: sim.money, noise: sim.noise, frame: sim.frame });
}

function takeItem(sim, item) {
  item.taken = true;
  item.inRange = false;
  item.takenAtFrame = sim.frame;
  sim.money += item.value;
  sim.noise = addNoise(sim.noise, item.noise);
  sim.shake = Math.min(TUNING.feedback.shakeMax, item.noise * TUNING.feedback.shakePerNoise);
  sim.events.push({
    type: 'took',
    id: item.id,
    itemType: item.type,
    value: item.value,
    noise: item.noise,
    x: item.x,
    y: item.y,
    stage: sleepStage(sim.noise)
  });
  if (isAwake(sim.noise)) finish(sim, 'lost');
}

// Exactly one fixed simulation tick.
export function stepSim(sim, input = EMPTY_INPUT) {
  sim.events.length = 0;
  if (sim.status !== 'running') return sim;

  for (const entity of sim.entities) {
    entity.prevX = entity.x;
    entity.prevY = entity.y;
  }

  const player = playerOf(sim);
  for (const entity of sim.entities) {
    const update = UPDATERS[entity.kind];
    if (update) update(entity, sim, entity.kind === 'player' ? input : EMPTY_INPUT);
  }

  // "In range" and "taken" are separate facts. Range is circular, so an item is
  // exactly as reachable diagonally as head-on.
  let nearest = null;
  let nearestDistance = Infinity;
  for (const item of sim.items) {
    if (item.taken) { item.inRange = false; continue; }
    const distance = Math.hypot(item.x - player.x, item.y - player.y);
    item.inRange = distance <= TUNING.pickup.radius;
    if (item.inRange && distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  sim.targetId = nearest ? nearest.id : null;

  const pressedTake = input.take && !sim.prevTake;
  sim.prevTake = input.take;
  if (nearest && (TUNING.pickup.mode === 'auto' || pressedTake)) takeItem(sim, nearest);

  // Screen shake is seeded, so a replay shakes identically.
  if (sim.shake > 0) {
    sim.shakeX = (sim.rng.next() - 0.5) * sim.shake;
    sim.shakeY = (sim.rng.next() - 0.5) * sim.shake;
    sim.shake = Math.max(0, sim.shake - TUNING.feedback.shakeDecay * STEP_SECONDS);
  } else {
    sim.shakeX = 0;
    sim.shakeY = 0;
  }

  if (sim.status === 'running') {
    const exit = sim.level.exit;
    const atExit =
      player.x + player.w / 2 > exit.x &&
      player.x - player.w / 2 < exit.x + exit.w &&
      player.y + player.h / 2 > exit.y;
    if (atExit && canBank(sim.noise)) finish(sim, 'won');
  }

  sim.frame++;
  return sim;
}

// Compact snapshot for tests and golden replays.
export function snapshot(sim) {
  const player = playerOf(sim);
  return {
    frame: sim.frame,
    status: sim.status,
    money: sim.money,
    noise: sim.noise,
    taken: sim.items.filter((i) => i.taken).map((i) => i.id),
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100
  };
}
