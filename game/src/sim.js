// The simulation. Pure in the sense that matters: no document, no ctx, no Date,
// no Math.random. One fixed tick in, new state out. Everything the host needs to
// know about a tick comes back as events.
import { TUNING } from './tuning.js';
import { createRng } from './rng.js';
import { solveMove, clampToWorld } from './physics.js';
import { navGrid, flowField, steer, nearestStand } from './nav.js';
import {
  addNoise, isAwake, itemStats, canBank, sleepStage, resolveUpgrades, bumpNoise, timeLimit,
  rarityOf, comboBonus, gradeEscape, isBigScore, detectionRate, watcherConfig,
  locationRules, proximityScale, stridePerUnit
} from './rules.js';

export const STEP_SECONDS = 1 / TUNING.sim.hz;

export const EMPTY_INPUT = Object.freeze({ x: 0, y: 0, take: false, search: false });

// Per-kind update functions. A guard, a dog or a rolling can is a new entry
// here plus a spawn — it does not touch the loop.
const UPDATERS = {
  player(entity, sim, input) {
    let { x: ix, y: iy } = input;
    const length = Math.hypot(ix, iy);
    if (length > 1) { ix /= length; iy /= length; }

    // Reaching for an item is a hesitation, not a stop: you keep steering.
    // Having both hands in a cupboard is closer to a stop.
    const slowed = sim.searching ? sim.rules.search.moveScale
      : sim.reach ? TUNING.pickup.reachSlow : 1;
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
    let normalX = 0;
    let normalY = 0;
    if (moved.hitX) {
      impact = Math.max(impact, Math.abs(entity.vx));
      normalX = entity.vx > 0 ? -1 : 1;
    }
    if (moved.hitY) {
      impact = Math.max(impact, Math.abs(entity.vy));
      normalY = entity.vy > 0 ? -1 : 1;
    }

    // Walking into a wall must not bank up velocity to spend later.
    if (moved.hitX) entity.vx = 0;
    if (moved.hitY) entity.vy = 0;
    entity.bumped = moved.hit;
    entity.bumpImpact = impact;
    entity.bumpNormalX = normalX;
    entity.bumpNormalY = normalY;

    const clamped = clampToWorld(moved.x, moved.y, entity.w, entity.h, sim.level);
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
    // The walk cycle is driven by distance travelled, so feet never skate —
    // and how much phase a unit of ground is worth depends on how long his
    // stride is at this speed, so a creep is short quick steps and a run is
    // long ones rather than the same stride at two rates.
    entity.walkPhase += travelled * stridePerUnit(entity.speed / TUNING.player.speed);
    entity.idleSeconds = entity.moving ? 0 : entity.idleSeconds + STEP_SECONDS;
  },

  // Someone walking a route of their own. Same movement model as the player —
  // accelerate towards a target velocity, sweep, resolve, ease the facing round
  // — because a person crossing a room should move like a person crossing a
  // room whoever is steering. What differs is only where the direction comes
  // from: a flow field over the building instead of a thumb.
  watcher(entity, sim) {
    const rules = sim.investigateRules;
    const walking = entity.state === 'investigating' || entity.state === 'returning';
    const scripted = entity.state === 'rising' || entity.state === 'settling';

    if (!walking) {
      entity.vx = 0;
      entity.vy = 0;
      entity.speed = 0;
      entity.moving = false;
      // Getting up and lying down are scripted, not driven: he is inside his
      // own couch while he sleeps on it, and no amount of pushing gets a body
      // out of a solid rectangle. So he swings his legs off to the nearest
      // place a person can stand, and the physics takes over from there.
      if (scripted && entity.stand) {
        const duration = entity.state === 'rising' ? rules.rising : rules.settling;
        const raw = Math.max(0, Math.min(1, entity.stateFor / duration));
        const t = raw * raw * (3 - 2 * raw);
        const share = entity.state === 'rising' ? t : 1 - t;
        entity.x = entity.home.x + (entity.stand.x - entity.home.x) * share;
        entity.y = entity.home.y + (entity.stand.y - entity.home.y) * share;
      }
      // Standing at the spot he came to look at, turning on the spot. He is
      // searching, so he has to look somewhere other than straight ahead.
      if (entity.state === 'searching') {
        entity.facing += Math.sin(entity.stateFor * 2.4) * 2.6 * STEP_SECONDS;
      }
      return;
    }

    let dirX = 0;
    let dirY = 0;

    if (entity.field) {
      const direction = steer(entity.nav, entity.field, entity.x, entity.y);
      if (direction) { dirX = direction.x; dirY = direction.y; }
    }

    const top = rules.speed;
    const wanted = Math.hypot(dirX, dirY) > 0.01;
    const rate = (wanted ? rules.accel : rules.decel) * STEP_SECONDS;
    const dvx = dirX * top - entity.vx;
    const dvy = dirY * top - entity.vy;
    const delta = Math.hypot(dvx, dvy);
    if (delta <= rate || delta === 0) {
      entity.vx = dirX * top;
      entity.vy = dirY * top;
    } else {
      entity.vx += (dvx / delta) * rate;
      entity.vy += (dvy / delta) * rate;
    }

    const moved = solveMove(
      entity, entity.vx * STEP_SECONDS, entity.vy * STEP_SECONDS, sim.level.colliders
    );
    if (moved.hitX) entity.vx = 0;
    if (moved.hitY) entity.vy = 0;
    const clamped = clampToWorld(moved.x, moved.y, entity.w, entity.h, sim.level);
    entity.x = clamped.x;
    entity.y = clamped.y;

    const travelled = Math.hypot(entity.x - entity.prevX, entity.y - entity.prevY);
    entity.speed = travelled / STEP_SECONDS;
    entity.moving = entity.speed > 4;
    if (entity.moving) {
      const heading = Math.atan2(entity.vy, entity.vx);
      let turn = heading - entity.facing;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      entity.facing += turn * Math.min(1, TUNING.player.turnRate * STEP_SECONDS);
    }
    entity.walkPhase += travelled * stridePerUnit(entity.speed / rules.speed);
  }
};

// Mr. Vrána, and anyone the design later gives the same job: a person who is
// asleep until the room gets loud, then gets up and goes to look.
//
// He investigates the place the noise came from, not the person who made it.
// That is the whole mechanic — he is walking towards a memory, so moving away
// quietly works, and it is the one thing here that must not be "improved" into
// tracking the player.
const WATCHER_STATES = ['asleep', 'rising', 'investigating', 'searching', 'returning', 'settling'];

function makeInvestigator(level, rules) {
  return {
    kind: 'watcher',
    x: level.watcher.x,
    y: level.watcher.y,
    prevX: level.watcher.x,
    prevY: level.watcher.y,
    vx: 0,
    vy: 0,
    w: TUNING.player.boxWidth + 2,   // a broader man than the thief
    h: TUNING.player.boxHeight,
    state: 'asleep',
    stateFor: 0,
    // Where he sleeps, and therefore where he walks back to.
    home: { x: level.watcher.x, y: level.watcher.y },
    // The place the noise came from. Set once, when the meter crosses the
    // line, and never updated to follow you.
    target: null,
    nav: null,       // built on the first wake, not at level load
    field: null,     // ...and re-flooded only when the goal changes
    goal: null,
    speed: 0,
    moving: false,
    facing: Math.PI / 2,
    walkPhase: 0
  };
}

// Send him somewhere. The flood is a few hundred microseconds on the largest
// school map and happens at most twice per investigation, so it is cheaper to
// recompute than to maintain.
function routeTo(entity, level, x, y) {
  if (!entity.nav) entity.nav = navGrid(level, entity.w, entity.h);
  if (entity.goal && entity.goal.x === x && entity.goal.y === y) return;
  entity.goal = { x, y };
  entity.field = flowField(entity.nav, x, y);
}

function setState(sim, entity, state) {
  if (entity.state === state) return;
  entity.state = state;
  entity.stateFor = 0;
  sim.events.push({ type: 'watcher', state, x: entity.x, y: entity.y });
}

// Has he got where he was going? Measured on the flow field as well as on the
// straight-line distance, because his own couch is furniture: he can stand
// beside it and never be within arm's reach of its centre.
function arrived(entity, rules) {
  if (!entity.goal) return true;
  if (Math.hypot(entity.goal.x - entity.x, entity.goal.y - entity.y) <= rules.arriveAt) return true;
  if (!entity.field) return true;
  const grid = entity.nav;
  const cx = Math.max(0, Math.min(grid.cols - 1, Math.floor(entity.x / grid.cell)));
  const cy = Math.max(0, Math.min(grid.rows - 1, Math.floor(entity.y / grid.cell)));
  const distance = entity.field[cx + cy * grid.cols];
  return distance >= 0 && distance <= 1;
}

function updateInvestigation(sim, player) {
  const entity = sim.investigator;
  const rules = sim.investigateRules;
  if (!entity || !rules) return;

  entity.stateFor += STEP_SECONDS;

  // Crossing the line wakes him — and where you were standing when you crossed
  // it is the only thing he will ever know about you.
  if (sim.noise > rules.wakeAt && sim.status === 'running'
      && (entity.state === 'asleep' || entity.state === 'returning' || entity.state === 'settling')) {
    entity.target = { x: player.x, y: player.y };
    if (!entity.nav) entity.nav = navGrid(sim.level, entity.w, entity.h);
    if (!entity.stand) entity.stand = nearestStand(entity.nav, entity.home.x, entity.home.y);
    // Already on his feet? Then he simply turns round; only a man lying down
    // has to get up first.
    setState(sim, entity, entity.state === 'returning' ? 'investigating' : 'rising');
    if (entity.state === 'investigating') routeTo(entity, sim.level, entity.target.x, entity.target.y);
  }

  switch (entity.state) {
    case 'rising':
      if (entity.stateFor >= rules.rising) {
        entity.x = entity.stand.x;
        entity.y = entity.stand.y;
        setState(sim, entity, 'investigating');
        routeTo(entity, sim.level, entity.target.x, entity.target.y);
      }
      break;
    case 'investigating':
      // Quiet again before he gets there and he stops bothering.
      if (sim.noise < rules.calmAt) setState(sim, entity, 'returning');
      else if (arrived(entity, rules)) setState(sim, entity, 'searching');
      break;
    case 'searching':
      if (sim.noise < rules.calmAt || entity.stateFor >= rules.searchFor) {
        setState(sim, entity, 'returning');
      }
      break;
    case 'returning':
      if (arrived(entity, rules)) setState(sim, entity, 'settling');
      break;
    case 'settling':
      if (entity.stateFor >= rules.settling) {
        setState(sim, entity, 'asleep');
        entity.target = null;
        entity.goal = null;
        entity.field = null;
        entity.x = entity.home.x;
        entity.y = entity.home.y;
        // The renderer draws between prevX and x; leaving the old value here
        // would slide him back to the couch over one visible frame.
        entity.prevX = entity.x;
        entity.prevY = entity.y;
        entity.vx = 0;
        entity.vy = 0;
      }
      break;
    default:
      break;
  }

  if (entity.state === 'returning' && entity.stand
      && (!entity.goal || entity.goal.x !== entity.stand.x || entity.goal.y !== entity.stand.y)) {
    routeTo(entity, sim.level, entity.stand.x, entity.stand.y);
  }

  // Walking into you ends the level through the same door everything else
  // does. Not while he is getting up or lying down: standing over him as he
  // stirs deserves a moment to back away, not an instant loss.
  const onFoot = entity.state === 'investigating' || entity.state === 'searching'
    || entity.state === 'returning';
  if (onFoot && sim.status === 'running'
      && Math.hypot(player.x - entity.x, player.y - entity.y) <= rules.catchAt) {
    finish(sim, 'lost', 'caught');
  }
}

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
  // What, if anything, this location asks for beyond the ordinary rules.
  // Everywhere but the school this is empty and nothing below it happens.
  const rules = locationRules(level);
  const investigator = rules.investigate ? makeInvestigator(level, rules.investigate) : null;

  return {
    level,
    seed,
    mods,
    // Location-specific mechanics, resolved once so the tick does not have to
    // ask again sixty times a second.
    rules,
    investigateRules: rules.investigate || null,
    investigator,
    // How loud this spot is, as a multiplier on everything you do. Always 1
    // where a location has no proximity rule, which is everywhere but here.
    proximity: 1,
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
    entities: investigator ? [player, investigator] : [player],
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
    // Furniture you can look inside. Empty everywhere but the school, where
    // the map says which pieces are searchable and what is in them.
    stashes: (level.stashes || []).map((stash) => ({ ...stash, searched: false })),
    searchTargetId: null,  // the nearest unsearched piece within reach
    searching: null,       // { id, t, duration } while his hands are in it
    prevSearch: false,
    streak: 0,        // steals in quick succession
    streakTimer: 0,   // ...and how long is left to keep it
    onSoftFloor: false,
    // Whether this room's watcher can see at all, and how strongly they are
    // registering you right now (presentation only — the meter is the truth).
    watches: watcherConfig(level.watcher.kind).sees > 0,
    seen: 0,
    // Creaky boards: plain trigger zones, each with its own cooldown so
    // standing on one does not drain the meter.
    creaks: level.creaks.map((zone) => ({ ...zone, cooldown: 0, active: false })),
    wakeSeconds: 0,   // drives the wake-up animation only
    startle: 0,       // a visible flinch from a bang, separate from the meter
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

  const lifted = item.noise * sim.proximity;
  sim.money += paid;
  sim.haul += item.rawValue;
  sim.noise = addNoise(sim.noise, lifted);
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
    noise: Math.round(lifted),
    fragile: item.fragile,
    x: item.x,
    y: item.y,
    stage: sleepStage(sim.noise)
  });
  if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
}

// Which piece of furniture a SEARCH would open: the nearest unsearched one
// within reach, measured to the edge of the box rather than its centre, so a
// long bank of lockers offers itself along its whole length.
function nearestStash(sim, player, reach) {
  let best = null;
  let bestDistance = Infinity;
  for (const stash of sim.stashes) {
    if (stash.searched) continue;
    const dx = Math.max(stash.x - player.x, 0, player.x - (stash.x + stash.w));
    const dy = Math.max(stash.y - player.y, 0, player.y - (stash.y + stash.h));
    const distance = Math.hypot(dx, dy);
    if (distance <= reach && distance < bestDistance) {
      best = stash;
      bestDistance = distance;
    }
  }
  return best;
}

// Opening it. The noise lands here, at the start, not when you find out what is
// inside: the drawer rattles whether or not there is anything in it, and
// charging on the result would let you learn a cabinet was empty for free.
function beginSearch(sim, stash, rules) {
  const amount = Math.max(1, Math.round(
    (rules.noise[stash.style] || 3) * sim.mods.hazardNoise * sim.proximity));
  sim.noise = addNoise(sim.noise, amount);
  // Nothing else is on offer from the moment his hands are in this one, not
  // from the frame after: a button that lingers for a tick is a button that
  // can be pressed twice.
  sim.searchTargetId = null;
  sim.searching = {
    id: stash.id, t: 0, duration: rules.duration,
    x: stash.x + stash.w / 2, y: stash.y + stash.h / 2, style: stash.style
  };
  sim.events.push({
    type: 'searching', id: stash.id, noise: amount, style: stash.style,
    x: sim.searching.x, y: sim.searching.y
  });
  if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
}

// ...and finding out. An item lifted out of a cupboard costs exactly what the
// same item costs off a shelf, because it is the same item and the same arm.
function finishSearch(sim) {
  const stash = sim.stashes.find((entry) => entry.id === sim.searching.id);
  const { x, y } = sim.searching;
  sim.searching = null;
  if (!stash || stash.searched) return;
  stash.searched = true;

  if (!stash.item) {
    sim.events.push({ type: 'found', id: stash.id, empty: true, x, y });
    return;
  }
  const stats = itemStats(stash.item);
  const paid = Math.round(stats.value * sim.mods.payout);
  sim.money += paid;
  sim.haul += stats.value;
  const lifted = stats.noise * sim.proximity;
  sim.noise = addNoise(sim.noise, lifted);
  sim.shake = Math.min(TUNING.feedback.shakeMax, stats.noise * TUNING.feedback.shakePerNoise);
  sim.shakePhase = 0;
  sim.events.push({
    type: 'found', id: stash.id, empty: false, itemType: stash.item,
    value: paid, noise: Math.round(lifted), rarity: rarityOf(stash.item).name,
    big: isBigScore(stats.value), x, y
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

  // How sensitive this spot is. Distance is measured to where the person
  // actually is, so once Mr. Vrána is up and walking the quiet end of the
  // corridor moves with him — which is the point.
  if (sim.rules.proximity) {
    const listener = sim.investigator || sim.level.watcher;
    sim.proximity = proximityScale(
      sim.rules, Math.hypot(player.x - listener.x, player.y - listener.y)
    );
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
      const amount = Math.round(
        TUNING.hazards.creakNoise * sim.mods.hazardNoise * sim.proximity);
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
    const amount = TUNING.hazards.walkNoise * surface * share * STEP_SECONDS
      * sim.mods.hazardNoise * sim.proximity;
    if (amount > 0) {
      sim.noise = addNoise(sim.noise, amount);
      if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
    }
  }

  // Being seen. A watcher who can see raises the meter when you move inside
  // their range — in complete silence. Standing still inside it costs nothing,
  // so freezing is a real answer, and it plays against the clock.
  if (sim.watches && sim.status === 'running') {
    const speedShare = player.speed / TUNING.player.speed;
    const rate = detectionRate(sim.level.watcher, player, speedShare);
    if (rate > 0) {
      sim.seen = Math.min(1, sim.seen + STEP_SECONDS * 3);
      sim.noise = addNoise(sim.noise, rate * STEP_SECONDS);
      if (isAwake(sim.noise)) finish(sim, 'lost', 'seen');
    } else {
      sim.seen = Math.max(0, sim.seen - STEP_SECONDS * 2);
    }
  }

  if (sim.streakTimer > 0) {
    sim.streakTimer = Math.max(0, sim.streakTimer - STEP_SECONDS);
    if (sim.streakTimer === 0) sim.streak = 0;
  }

  // Walking into furniture. One event per collision, never one per frame: a
  // cooldown means leaning on a cabinet cannot drain the meter to zero.
  if (sim.bumpCooldown > 0) sim.bumpCooldown = Math.max(0, sim.bumpCooldown - STEP_SECONDS);
  const { bumpThreshold, bumpSoftest, bumpHardest, recoil } = TUNING.hazards;
  const share = player.bumpImpact / TUNING.player.speed;
  const hardEnough = share > bumpThreshold;
  if (player.bumped && hardEnough && sim.bumpCooldown === 0 && sim.status === 'running') {
    // How hard you hit it, from a brush at the threshold to a full-speed run.
    const force = Math.min(1, (share - bumpThreshold) / (1 - bumpThreshold));
    const scale = bumpSoftest + (bumpHardest - bumpSoftest) * force;
    const amount = Math.max(1, Math.round(
      bumpNoise(player.bumped) * scale * sim.mods.hazardNoise * sim.proximity));

    sim.noise = addNoise(sim.noise, amount);
    // He flinches at a bang, over and above what it did to the meter.
    sim.startle = Math.min(1, sim.startle + force * TUNING.startle.fromImpact);
    sim.shake = Math.min(TUNING.feedback.shakeMax, TUNING.feedback.shakeMax * force);
    sim.shakePhase = 0;

    // A small bounce back, so a hard collision reads as one.
    if (force > 0.3) {
      const bounced = solveMove(
        player,
        player.bumpNormalX * recoil * force,
        player.bumpNormalY * recoil * force,
        sim.level.colliders
      );
      player.x = bounced.x;
      player.y = bounced.y;
    }

    sim.events.push({
      type: 'bump',
      x: player.x,
      y: player.y,
      noise: amount,
      force,
      what: player.bumped.type
    });
    if (isAwake(sim.noise)) finish(sim, 'lost', 'awake');
    sim.bumpCooldown = TUNING.hazards.bumpCooldown;
  }

  // The flinch fades on its own.
  if (sim.startle > 0) sim.startle = Math.max(0, sim.startle - TUNING.startle.decay * STEP_SECONDS);

  // Standing perfectly still lets the room settle — slowly, and only after a
  // beat, so it is a decision against the clock rather than a reset button.
  // Rummaging in a drawer is not standing still holding your breath, so it does
  // not settle the room. Without this the meter falls back through the whole
  // cost of opening the thing while you are still opening it, and searching is
  // free — which is the one outcome the mechanic cannot survive.
  if (!player.moving && !sim.reach && !sim.searching && sim.status === 'running') {
    // A location may settle at its own pace. The school comes down fast enough
    // that standing still is a tactic — it is how you send Mr. Vrána back to
    // bed — and waits longer before it starts, so it is never a reflex.
    const settle = sim.rules.recovery || TUNING.recovery;
    sim.stillFor += STEP_SECONDS;
    if (sim.stillFor > settle.delay && sim.noise > 0) {
      sim.noise = Math.max(0, sim.noise - settle.rate * STEP_SECONDS);
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

  // Looking inside the furniture. Only where a location asks for it, which is
  // the school and nowhere else — everywhere else `sim.stashes` is empty and
  // none of this runs.
  const searchRules = sim.rules.search;
  if (searchRules && sim.status === 'running') {
    if (sim.searching) {
      sim.searchTargetId = null;
      sim.searching.t += STEP_SECONDS;
      if (sim.searching.t >= sim.searching.duration) finishSearch(sim);
    } else {
      const stash = nearestStash(sim, player, searchRules.reach);
      sim.searchTargetId = stash ? stash.id : null;
      const pressed = input.search && !sim.prevSearch;
      if (stash && pressed) beginSearch(sim, stash, searchRules);
    }
  }
  sim.prevSearch = !!input.search;

  // Last, so that the meter he reacts to is this tick's meter: lifting
  // something off a shelf and crossing the line by doing it should send him to
  // the shelf, not to wherever you were a frame earlier.
  updateInvestigation(sim, player);

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
    // A plain box overlap, so the same check works for a doorway in the bottom
    // wall or in either side wall.
    const atExit =
      player.x + player.w / 2 > exit.x &&
      player.x - player.w / 2 < exit.x + exit.w &&
      player.y + player.h / 2 > exit.y &&
      player.y - player.h / 2 < exit.y + exit.h;
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
