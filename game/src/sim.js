// The simulation. Pure in the sense that matters: no document, no ctx, no Date,
// no Math.random. One fixed tick in, new state out. Everything the host needs to
// know about a tick comes back as events.
import { TUNING } from './tuning.js';
import { createRng } from './rng.js';
import { solveMove, clampToWorld } from './physics.js';
import {
  addNoise, isAwake, itemStats, canBank, sleepStage, resolveUpgrades, bumpNoise, timeLimit,
  rarityOf, comboBonus, gradeEscape, isBigScore
} from './rules.js';

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
    const top = TUNING.player.speed * sim.mods.speed;
    const targetVx = ix * top * slowed;
    const targetVy = iy * top * slowed;

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
    // How hard the collision was, measured on the blocked axis only. A head-on
    // walk into a cabinet registers; sliding along its edge does not. (Reading
    // entity.speed after the move would be exactly backwards: a head-on hit
    // stops you dead, so it would look like the gentlest collision of all.)
    let impact = 0;
    if (moved.hitX) impact = Math.max(impact, Math.abs(entity.vx));
    if (moved.hitY) impact = Math.max(impact, Math.abs(entity.vy));

    // Walking into a wall must not bank up velocity to spend later.
    if (moved.hitX) entity.vx = 0;
    if (moved.hitY) entity.vy = 0;
    entity.bumped = moved.hit;
    entity.bumpImpact = impact;

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

export function createSim({ level, seed = 1, upgrades = {} }) {
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
    bumped: null,
    bumpImpact: 0,
    speed: 0,
    facing: Math.PI / 2,   // facing "down" into the room
    walkPhase: 0,
    idleSeconds: 0
  };

  const mods = resolveUpgrades(upgrades);

  return {
    level,
    seed,
    mods,
    rng: createRng(seed),
    frame: 0,
    status: 'running', // running | won | lost
    failReason: null,  // 'awake' | 'time'
    timeLeft: timeLimit(level),
    timeLimit: timeLimit(level),
    escapeGrade: null,
    stillFor: 0,       // seconds spent perfectly still, for noise recovery
    bumpCooldown: 0,
    money: 0,          // what you get paid (haul plus any bag bonus)
    haul: 0,           // raw value of what you took — stars are judged on this
    noise: 0,
    entities: [player],
    items: level.items.map((item) => {
      const stats = itemStats(item.type);
      return {
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        value: Math.round(stats.value * mods.payout),
        rawValue: stats.value,
        noise: stats.noise,
        fragile: !!stats.fragile,
        bonus: !!item.bonus,
        rarity: rarityOf(item.type).name,
        // Bigger, more valuable things take longer to lift.
        pickupTime: rarityOf(item.type).pickup,
        taken: false,
        inRange: false,
        takenAtFrame: -1
      };
    }),
    targetId: null,   // the in-range item a TAKE would consume
    reach: null,      // the in-progress grab animation, if any
    streak: 0,        // steals in quick succession
    streakTimer: 0,   // ...and how long is left to keep it
    onSoftFloor: false,
    // Creaky boards: plain trigger zones, each with its own cooldown so
    // standing on one does not drain the meter.
    creaks: level.creaks.map((zone) => ({ ...zone, cooldown: 0, active: false })),
    wakeSeconds: 0,   // drives the wake-up animation only
    shake: 0,
    shakePhase: 0,
    shakeX: 0,
    shakeY: 0,
    prevTake: false,
    events: []
  };
}

export const playerOf = (sim) => sim.entities.find((e) => e.kind === 'player');

function finish(sim, status, reason = null) {
  if (sim.status !== 'running') return; // a level can only end once
  sim.status = status;
  sim.failReason = reason;
  sim.events.push({
    type: status,
    reason,
    money: sim.money,
    haul: sim.haul,
    noise: sim.noise,
    timeLeft: Math.max(0, sim.timeLeft),
    grade: sim.escapeGrade,
    frame: sim.frame,
    taken: sim.items.filter((i) => i.taken).map((i) => i.type)
  });
}

function takeItem(sim, item) {
  item.taken = true;
  item.inRange = false;
  item.takenAtFrame = sim.frame;

  // A streak only survives if you keep moving between prizes.
  sim.streak = sim.streakTimer > 0 ? sim.streak + 1 : 1;
  sim.streakTimer = TUNING.combo.window;
  const bonusRate = comboBonus(sim.streak);
  const paid = Math.round(item.value * (1 + bonusRate));

  sim.money += paid;
  sim.haul += item.rawValue;
  sim.noise = addNoise(sim.noise, item.noise);
  // Drives the reach-and-grab animation. Money and noise are already credited,
  // so the animation is presentation only and can never affect the outcome.
  sim.reach = { t: 0, duration: item.pickupTime, x: item.x, y: item.y, type: item.type };
  sim.shake = Math.min(TUNING.feedback.shakeMax, item.noise * TUNING.feedback.shakePerNoise);
  sim.shakePhase = 0;
  sim.events.push({
    type: 'took',
    id: item.id,
    itemType: item.type,
    value: paid,
    baseValue: item.value,
    bonusRate,
    streak: sim.streak,
    big: isBigScore(item.rawValue),
    rarity: item.rarity,
    noise: item.noise,
    fragile: item.fragile,
    x: item.x,
    y: item.y,
    stage: sleepStage(sim.noise)
  });
  if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
}

// Exactly one fixed simulation tick.
export function stepSim(sim, input = EMPTY_INPUT) {
  sim.events.length = 0;
  if (sim.status !== 'running') {
    // The level is over, but he is still sitting up: let the animation finish.
    if (isAwake(sim.noise)) sim.wakeSeconds += STEP_SECONDS;
    return sim;
  }

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

  // Creaky boards. Entering one costs noise; it then goes quiet for a while,
  // so a board cannot be milked and cannot drain you while you stand on it.
  for (const zone of sim.creaks) {
    if (zone.cooldown > 0) zone.cooldown = Math.max(0, zone.cooldown - STEP_SECONDS);
    const inside =
      player.x > zone.x && player.x < zone.x + zone.w &&
      player.y > zone.y && player.y < zone.y + zone.h;
    if (inside && !zone.active && zone.cooldown === 0 && sim.status === 'running') {
      const amount = Math.round(TUNING.hazards.creakNoise * sim.mods.hazardNoise);
      if (amount > 0) {
        sim.noise = addNoise(sim.noise, amount);
        sim.events.push({ type: 'creak', x: player.x, y: player.y, noise: amount });
        if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
      }
      zone.cooldown = TUNING.hazards.creakCooldown;
    }
    zone.active = inside;
  }

  // Which surface is underfoot. A rug swallows footsteps; bare boards do not.
  sim.onSoftFloor = sim.level.rugs.some(
    (rug) => player.x > rug.x && player.x < rug.x + rug.w &&
             player.y > rug.y && player.y < rug.y + rug.h
  );
  if (player.moving && sim.status === 'running') {
    const surface = sim.onSoftFloor ? TUNING.hazards.softFloorScale : 1;
    const share = Math.min(1, player.speed / TUNING.player.speed);
    const amount = TUNING.hazards.walkNoise * surface * share * STEP_SECONDS * sim.mods.hazardNoise;
    if (amount > 0) {
      sim.noise = addNoise(sim.noise, amount);
      if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
    }
  }

  if (sim.streakTimer > 0) {
    sim.streakTimer = Math.max(0, sim.streakTimer - STEP_SECONDS);
    if (sim.streakTimer === 0) sim.streak = 0;
  }

  // Walking into furniture. One event per collision, never one per frame: a
  // cooldown means leaning on a cabinet cannot drain the meter to zero.
  if (sim.bumpCooldown > 0) sim.bumpCooldown = Math.max(0, sim.bumpCooldown - STEP_SECONDS);
  const hardEnough = player.bumpImpact > TUNING.player.speed * TUNING.hazards.bumpThreshold;
  if (player.bumped && hardEnough && sim.bumpCooldown === 0 && sim.status === 'running') {
    const amount = Math.round(bumpNoise(player.bumped) * sim.mods.hazardNoise);
    if (amount > 0) {
      sim.noise = addNoise(sim.noise, amount);
      sim.events.push({
        type: 'bump',
        x: player.x,
        y: player.y,
        noise: amount,
        what: player.bumped.type
      });
      if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
    }
    sim.bumpCooldown = TUNING.hazards.bumpCooldown;
  }

  // Standing perfectly still lets the room settle — slowly, and only after a
  // beat, so it is a decision against the clock rather than a reset button.
  if (!player.moving && !sim.reach && sim.status === 'running') {
    sim.stillFor += STEP_SECONDS;
    if (sim.stillFor > TUNING.recovery.delay && sim.noise > 0) {
      sim.noise = Math.max(0, sim.noise - TUNING.recovery.rate * STEP_SECONDS);
    }
  } else {
    sim.stillFor = 0;
  }

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

  // The clock. It only runs while the level does.
  if (sim.status === 'running') {
    sim.timeLeft -= STEP_SECONDS;
    if (sim.timeLeft <= 0) {
      sim.timeLeft = 0;
      finish(sim, 'lost', 'time');
    }
  }

  if (sim.status === 'running') {
    const exit = sim.level.exit;
    const atExit =
      player.x + player.w / 2 > exit.x &&
      player.x - player.w / 2 < exit.x + exit.w &&
      player.y + player.h / 2 > exit.y;
    if (atExit && canBank(sim.noise)) {
      const grade = gradeEscape({
        noise: sim.noise,
        timeLeft: sim.timeLeft,
        limit: sim.timeLimit
      });
      sim.money += grade.bonus;
      sim.escapeGrade = grade;
      finish(sim, 'won');
    }
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
    haul: sim.haul,
    noise: Math.round(sim.noise),
    reason: sim.failReason,
    taken: sim.items.filter((i) => i.taken).map((i) => i.id),
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100
  };
}
