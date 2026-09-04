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

    // Reaching for an item is a hesitation, not a stop: you keep steering.
    const slowed = sim.reach ? TUNING.pickup.reachSlow : 1;
    const targetVx = ix * TUNING.player.speed * slowed;
    const targetVy = iy * TUNING.player.speed * slowed;

    // Approach the target velocity as a vector, so turning is a curve rather
    // than a snap and there is no direction the character accelerates faster in.
    const rate = (length > 0.01 ? TUNING.player.accel : TUNING.player.decel) * STEP_SECONDS;
    const dvx = targetVx - entity.vx;
    const dvy = targetVy - entity.vy;
    const delta = Math.hypot(dvx, dvy);
    if (delta <= rate || delta === 0) {
      entity.vx = targetVx;
      entity.vy = targetVy;
    } else {
      entity.vx += (dvx / delta) * rate;
      entity.vy += (dvy / delta) * rate;
    }

    const moved = solveMove(
      entity,
      entity.vx * STEP_SECONDS,
      entity.vy * STEP_SECONDS,
      sim.level.colliders
    );
    // Walking into a wall must not bank up velocity to spend later.
    if (moved.hitX) entity.vx = 0;
    if (moved.hitY) entity.vy = 0;

    const clamped = clampToWorld(moved.x, moved.y, entity.w, entity.h);
    entity.x = clamped.x;
    entity.y = clamped.y;

    const travelled = Math.hypot(entity.x - entity.prevX, entity.y - entity.prevY);
    entity.speed = travelled / STEP_SECONDS;
    entity.moving = entity.speed > 4;

    // Facing eases toward the heading so the character never spins on the spot.
    if (entity.moving) {
      const heading = Math.atan2(entity.vy, entity.vx);
      let turn = heading - entity.facing;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      entity.facing += turn * Math.min(1, TUNING.player.turnRate * STEP_SECONDS);
    }
    // The walk cycle is driven by distance travelled, so feet never skate.
    entity.walkPhase += travelled * TUNING.player.strideRate;
    entity.idleSeconds = entity.moving ? 0 : entity.idleSeconds + STEP_SECONDS;
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
    moving: false,
    speed: 0,
    facing: Math.PI / 2,   // facing "down" into the room
    walkPhase: 0,
    idleSeconds: 0
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
    reach: null,      // the in-progress grab animation, if any
    shake: 0,
    shakePhase: 0,
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
  // Drives the reach-and-grab animation. Money and noise are already credited,
  // so the animation is presentation only and can never affect the outcome.
  sim.reach = { t: 0, duration: TUNING.pickup.reachSeconds, x: item.x, y: item.y, type: item.type };
  sim.shake = Math.min(TUNING.feedback.shakeMax, item.noise * TUNING.feedback.shakePerNoise);
  sim.shakePhase = 0;
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

  if (sim.reach) {
    sim.reach.t += STEP_SECONDS;
    if (sim.reach.t >= sim.reach.duration) sim.reach = null;
  }

  // A damped thud, not random jitter: one soft oscillation that settles.
  if (sim.shake > 0.01) {
    sim.shakePhase += STEP_SECONDS;
    const wobble = Math.sin(sim.shakePhase * TUNING.feedback.shakeHz * Math.PI * 2);
    sim.shakeX = wobble * sim.shake * 0.35;
    sim.shakeY = wobble * sim.shake;
    sim.shake = Math.max(0, sim.shake - TUNING.feedback.shakeDecay * STEP_SECONDS);
  } else {
    sim.shake = 0;
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
