// The simulation. Pure in the sense that matters: no document, no ctx, no Date,
// no Math.random. One fixed tick in, new state out. Everything the host needs to
// know about a tick comes back as events.
import { TUNING } from './tuning.js';
import { createRng } from './rng.js';
import { solveMove, clampToWorld } from './physics.js';
import { navGrid, flowField, steer, nearestStand, cellOf } from './nav.js';
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
    // How fast he is going as a share of his top speed, kept on the entity so
    // the renderer reads the very same number the phase was advanced with. If
    // those two ever disagreed the feet would slide by exactly the difference,
    // so they are not allowed to be computed twice.
    entity.gaitShare = entity.speed / TUNING.player.speed;
    entity.walkPhase += travelled * stridePerUnit(entity.gaitShare, sim.rules.gait);
    entity.idleSeconds = entity.moving ? 0 : entity.idleSeconds + STEP_SECONDS;
  },

  // Someone walking a route of their own. Same movement model as the player —
  // accelerate towards a target velocity, sweep, resolve, ease the facing round
  // — because a person crossing a room should move like a person crossing a
  // room whoever is steering. What differs is only where the direction comes
  // from: a flow field over the building instead of a thumb.
  watcher(entity, sim) {
    const rules = sim.investigateRules;
    const walking = entity.state === 'investigating' || entity.state === 'returning'
      || entity.state === 'following' || entity.state === 'patrolling';
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

    // He walks faster the more alert he is. A man who half heard something
    // wanders over; a man who heard a window go covers the ground.
    const tune = sim.rules.alertness;
    const patrol = sim.patrol;
    // Walking a beat is not walking towards something. A guard on his rounds
    // strolls, whatever the meter says — the meter only starts moving him once
    // he has something to go and look at.
    const top = entity.state === 'patrolling' && patrol
      ? rules.speed * patrol.speed
      : tune
        ? rules.speed * (tune.speedLow + (tune.speedHigh - tune.speedLow) * (entity.alert || 0))
        : rules.speed;
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
    // Measured against the *player's* top speed, not his own. Against his own,
    // walking at all put him at full share and drew him sprinting — which is
    // both wrong for a man of his age and wrong for what he is doing. The state
    // adds a little on top: hurrying after someone is not the same walk as
    // going back to bed.
    const gait = sim.rules.watcherGait;
    const urgency = gait && gait.urgency ? gait.urgency[entity.state] || 0 : 0;
    // Eased rather than switched. Catching sight of you changes how he carries
    // himself, and a man does not change his stride between one frame and the
    // next — half a second of gathering himself, which is also long enough for
    // the player to read that something just changed.
    entity.urge += (urgency - entity.urge) * Math.min(1, STEP_SECONDS * 2.2);
    entity.gaitShare = Math.max(0, Math.min(1,
      entity.speed / TUNING.player.speed + (entity.moving ? entity.urge : 0)));
    entity.walkPhase += travelled * stridePerUnit(entity.gaitShare, gait);
  }
};

// Mr. Vrána, and anyone the design later gives the same job: a person who is
// asleep until the room gets loud, then gets up and goes to look.
//
// He investigates the place the noise came from, not the person who made it.
// That is the whole mechanic — he is walking towards a memory, so moving away
// quietly works, and it is the one thing here that must not be "improved" into
// tracking the player.
const WATCHER_STATES = ['asleep', 'patrolling', 'watching', 'rising',
  'investigating', 'searching', 'following', 'returning', 'settling'];

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
    walkPhase: 0,
    gaitShare: 0,
    urge: 0,           // how hurried he is, eased rather than switched
    // Following: how long you have been far enough away to be losing him, and
    // when he last re-read where you were.
    lostFor: 0,
    repathAt: 0,
    // His round, for the locations whose person has one: a ring of places he
    // can actually stand, worked out once and then walked in order.
    beats: null,
    beat: 0,
    // Seconds of "he has seen you, go" before walking into him actually ends
    // the level.
    grace: 0,
    // How sure he is that the shape over there is a person, 0..1. Only the
    // locations with a `vision` block use it; everywhere else finding you is
    // still a threshold, and this stays at nothing.
    notice: 0
  };
}

// Where a guard's round goes.
//
// Down the open axis through his own post, and no further than the walls let
// him. A ring of points around him sounds right and is not: on a hotel floor
// the ring lands inside the guest rooms, and a guard who walks into a small
// room a thief is standing in has caught them through no decision either of
// them made. What a guard actually walks is the circulation — the corridor, the
// length of the hall, the run of floor his desk is on — so the round is read
// off the building: probe outwards from the post in each direction, keep the
// two directions with the most open floor, and walk between their far ends.
//
// It also means his round *is* his room. The far side of the building stays
// genuinely far, and where his post sits is the thing the player has to plan
// around, which is what a guard is for.
// How far off the round has to stay from the way in. A round that walks over
// the spot the player starts on is not a round, it is an ambush laid before
// anyone has done anything — the level opens with a man arriving at the door
// you came through, and there is no play in that.
const KEEP_CLEAR = 150;

function reach(grid, x, y, dx, dy, radius, avoid) {
  let last = null;
  for (let d = grid.cell * 2; d <= radius; d += grid.cell) {
    const px = x + dx * d;
    const py = y + dy * d;
    if (px < 0 || py < 0 || px >= grid.cols * grid.cell || py >= grid.rows * grid.cell) break;
    const { cx, cy } = cellOf(grid, px, py);
    if (grid.blocked[cx + cy * grid.cols]) break;
    if (avoid && Math.hypot(px - avoid.x, py - avoid.y) < KEEP_CLEAR) break;
    last = { x: px, y: py, d };
  }
  return last;
}

function beatsOf(entity, level, patrol) {
  if (!entity.nav) entity.nav = navGrid(level, entity.w, entity.h);
  const grid = entity.nav;
  const from = entity.stand || entity.home;
  const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => reach(grid, from.x, from.y, dx, dy, patrol.radius, level.spawn))
    .filter((a) => a && a.d >= grid.cell * 4)
    .sort((a, b) => b.d - a.d)
    .slice(0, 2);
  if (!arms.length) return [];
  // Both ends, and a stop partway along the longer one, so a round has a middle
  // as well as two ends and does not read as pacing.
  const out = [];
  for (const arm of arms) out.push({ x: arm.x, y: arm.y });
  if (arms[0].d >= grid.cell * 8 && patrol.points > 2) {
    out.splice(1, 0, {
      x: from.x + (arms[0].x - from.x) * 0.5,
      y: from.y + (arms[0].y - from.y) * 0.5
    });
  }
  return out.slice(0, Math.max(2, patrol.points));
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

// How alert he is, from nought to one, read straight off the meter.
//
// Continuous by construction: there are no bands, no thresholds, and nothing
// that steps. Smoothstepped so the middle of the meter is where his behaviour
// changes fastest — at 10 he is barely disturbed, at 50 he is properly awake to
// it, at 95 he has your number.
//
//   meter   10    30    50    70    85    95
//   alert  0.03  0.22  0.50  0.78  0.94  0.99
export function alertnessOf(sim) {
  const a = sim.rules.alertness;
  if (!a) return 0;
  const t = Math.max(0, Math.min(1, (sim.noise - a.from) / (a.to - a.from)));
  return t * t * (3 - 2 * t);
}

const mix = (lo, hi, t) => lo + (hi - lo) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How far, and how sharply, this level's person can see — the location's own
// numbers, scaled by how far into the location you are. Resolved once per sim:
// it is a property of the building and of which night this is, and neither
// changes while the level is running.
function visionOf(rules, level) {
  const eye = rules.vision;
  if (!eye) return null;
  const scale = eye.tier ? (eye.tier[(level.tier || 1) - 1] || 1) : 1;
  return {
    ...eye,
    range: eye.range * scale,
    sure: eye.sure * scale,
    // He is not merely short-sighted on the first night, he is less interested:
    // scaling only the distance would make the near field just as deadly on
    // level one as on level five, which is the half of it players actually feel.
    near: eye.near * scale,
    far: eye.far * scale
  };
}

// Whether filling the meter ends the level there and then.
//
// Everywhere but the school it does, and always has: the meter is called NOISE,
// a hundred means he woke up, and that is the game. The school reads the same
// meter as how alert one man is, so filling it does not end anything — it makes
// him fast and accurate, and what ends the level is him walking into you or the
// clock running out. That is the whole difference between "keep the bar down"
// and being hunted.
function endsAtCap(sim) {
  return !sim.rules.alertness && isAwake(sim.noise);
}

// Where he thinks the noise came from.
//
// Not where it came from. He heard something through a wall, in a building he
// knows, half asleep — so his guess is off by an amount that shrinks as the
// meter rises, and he walks to *that*, which is what makes a quiet thief able
// to stand still twenty feet from where he is looking. Snapped onto floor he
// can actually stand on, so he never sets off towards the inside of a cupboard.
function guessAt(sim, entity, truth, alert) {
  const a = sim.rules.alertness;
  if (!a) return { x: truth.x, y: truth.y };
  const err = mix(a.blur, a.sharp, alert);
  const angle = sim.rng.next() * Math.PI * 2;
  // Square-rooted so the error is spread over the disc rather than bunched at
  // its edge: most guesses are near enough, a few are properly wrong.
  const r = Math.sqrt(sim.rng.next()) * err;
  const at = { x: truth.x + Math.cos(angle) * r, y: truth.y + Math.sin(angle) * r };
  if (!entity.nav) entity.nav = navGrid(sim.level, entity.w, entity.h);
  return nearestStand(entity.nav, at.x, at.y) || { x: truth.x, y: truth.y };
}

// A fresh fix on the noise. Each one pulls his idea of where you are towards
// this one's guess rather than replacing it, so a thief who keeps making noise
// is progressively narrowed down and one who goes quiet is not.
function takeFix(sim, entity, player, alert) {
  const a = sim.rules.alertness;
  const guess = guessAt(sim, entity, player, alert);
  if (!entity.target || !a) {
    entity.target = guess;
  } else {
    const k = a.narrow * (0.4 + 0.6 * alert);
    const blended = {
      x: entity.target.x + (guess.x - entity.target.x) * k,
      y: entity.target.y + (guess.y - entity.target.y) * k
    };
    // Snapped again after blending. Two points he could walk to have a midpoint
    // he cannot — through a wall, or inside a cupboard — and he would then walk
    // as close as the building allows and stand there, never arriving.
    entity.target = nearestStand(entity.nav, blended.x, blended.y) || guess;
  }
  entity.heard = sim.noise;
  return entity.target;
}

// Is the thief in one of the places the map says you can be out of sight?
//
// Read off his middle rather than his box: half in a doorway is not hidden, and
// a hiding place you can benefit from by standing next to it is not a place, it
// is a radius. Cheap enough to do every step — there are two or three of these
// on a level and the test is a rectangle.
function hidingIn(sim, player) {
  const spots = sim.level.hides;
  if (!spots || !spots.length) return null;
  for (const spot of spots) {
    if (player.x >= spot.x && player.x < spot.x + spot.w
      && player.y >= spot.y && player.y < spot.y + spot.h) return spot;
  }
  return null;
}

function updateInvestigation(sim, player) {
  const entity = sim.investigator;
  const rules = sim.investigateRules;
  if (!entity || !rules) return;

  entity.stateFor += STEP_SECONDS;

  // How alert he is right now. Everything below reads off this rather than off
  // a state: how well he places you, how fast he gets up, how fast he walks,
  // how long he casts about once he arrives.
  const alert = alertnessOf(sim);
  const tune = sim.rules.alertness;
  entity.alert = alert;
  // How far the meter moved in this one step. An event — something lifted,
  // knocked into or opened — moves it several points at once; walking across a
  // room moves it a fiftieth of one. That difference is what separates "he
  // heard something" from "the room is still a bit noisy".
  const jump = sim.noise - (entity.lastNoise === undefined ? sim.noise : entity.lastNoise);
  entity.lastNoise = sim.noise;

  // Crossing the line gets him up, and his idea of where you are is a guess
  // whose error depends on how loud it was.
  //
  // A man on his way back to his desk is a different case from a man asleep at
  // it. Asleep, the *level* of the noise wakes him. Already up and walking
  // home, it takes a fresh bang to turn him round — otherwise a meter still
  // sitting above the line re-fixes him on you the instant he gives up, over
  // and over, and a thief who has done everything right can never shake him.
  const turning = entity.state === 'returning' || entity.state === 'settling';
  // On his feet but not going anywhere in particular: a man walking his round,
  // or stopped on it to listen. He has nothing to get up from, so a noise turns
  // him straight round rather than waking him.
  const onBeat = entity.state === 'patrolling' || entity.state === 'watching';
  const stirred = sim.noise > rules.wakeAt
    && (!turning || !tune || jump >= tune.refix);
  if (stirred && sim.status === 'running'
      && (entity.state === 'asleep' || turning || onBeat)) {
    if (!entity.nav) entity.nav = navGrid(sim.level, entity.w, entity.h);
    if (!entity.stand) entity.stand = nearestStand(entity.nav, entity.home.x, entity.home.y);
    entity.target = null;
    takeFix(sim, entity, player, alert);
    // Already on his feet? Then he simply turns round; only a man sitting down
    // has to get up first.
    setState(sim, entity, entity.state === 'asleep' ? 'rising' : 'investigating');
    if (entity.state === 'investigating') routeTo(entity, sim.level, entity.target.x, entity.target.y);
  }

  // A second bang while he is already up. He works from the newest thing he
  // heard, and each fix narrows the last one — which is what turns "keep making
  // noise" into "he is closing in" rather than into a fixed penalty.
  //
  // A *bang*, though, not a drift: this triggers on the meter jumping in one
  // step, the way it does when something is lifted, knocked into or opened, and
  // not on the slow climb of walking. Comparing against the meter at the last
  // fix instead meant a player running for their life fed him a fresh fix every
  // few seconds — the one thing that made escaping impossible.
  if (tune && sim.status === 'running' && entity.state !== 'asleep'
      && entity.state !== 'following'
      && sim.noise >= rules.wakeAt * tune.refixAt
      && jump >= tune.refix) {
    takeFix(sim, entity, player, alert);
    if (entity.state === 'searching') setState(sim, entity, 'investigating');
    routeTo(entity, sim.level, entity.target.x, entity.target.y);
  }

  // --- picking you out, and losing you again ---------------------------------
  // Everything above this point is him walking towards a memory. This is the
  // one place he knows where you actually are, and he only earns that by
  // getting close enough to see you.
  //
  // The two distances are far apart on purpose: with one number he would
  // flicker between chasing and not chasing on every step across the line.
  // Losing him costs real ground held for real seconds.
  const onFootNow = entity.state === 'investigating' || entity.state === 'searching'
    || entity.state === 'returning' || entity.state === 'following'
    || entity.state === 'patrolling' || entity.state === 'watching';
  const gap = Math.hypot(player.x - entity.x, player.y - entity.y);
  if (onFootNow && sim.status === 'running') {
    if (entity.state !== 'following') {
      // A man walking his round is looking down a corridor, not looking for
      // you. He picks out movement — so standing still while he goes past
      // works, exactly the way freezing inside a guard's line of sight already
      // works, and it is the counter the round is there to be countered by.
      // Once something has actually sent him looking, that stops being true.
      const scanning = entity.state === 'patrolling' || entity.state === 'watching';
      // Two ways to be picked out, and a location has one or the other.
      //
      // Without eyes it is a threshold: get inside `followAt` and he has you.
      // With them it is a curve — certainty per second, steep at his elbow and
      // shallow at the edge of what he can make out — so distance buys time
      // rather than safety, holding still buys most of the rest, and a hiding
      // place buys nearly all of it. Crucially this runs in every state he is
      // on his feet in, so a man walking towards a noise at one end of the
      // building can still catch sight of you at the other and come here
      // instead: the noise is where he is going, not what he is looking at.
      const eye = sim.vision;
      let picked;
      if (eye) {
        const t = clamp01((gap - eye.sure) / Math.max(1, eye.range - eye.sure));
        let rate = gap > eye.range ? 0 : mix(eye.near, eye.far, t * t);
        if (!player.moving) rate *= eye.still;
        if (sim.hidden) rate *= eye.hidden;
        if (scanning && !player.moving) rate = 0;
        entity.notice = rate > 0
          ? Math.min(1, entity.notice + rate * STEP_SECONDS)
          : Math.max(0, entity.notice - eye.fade * STEP_SECONDS);
        picked = entity.notice >= eye.commit;
      } else {
        picked = gap <= rules.followAt && (!scanning || player.moving);
      }
      if (picked) {
        entity.lostFor = 0;
        entity.repathAt = 0;
        // The moment he picks you out is not the moment you lose. He shouts,
        // he squares up, and then he comes — and the banner that says HE HAS
        // SEEN YOU is only worth putting on the screen if there is a beat in
        // which the player can do something about it.
        entity.grace = 0.9;
        setState(sim, entity, 'following');
        routeTo(entity, sim.level, player.x, player.y);
        // Guards raise the alarm. Not a third way to lose — the game has two
        // and needs no more — but a floor under the meter: a man who has
        // actually laid eyes on you does not settle back to nothing, so the
        // rest of the level is played against someone who stays sharp. Going
        // quiet still helps; it cannot buy back the moment he saw you.
        const alarm = sim.rules.alarm;
        if (alarm) {
          if (!sim.alarmed) sim.events.push({ type: 'alarm', x: entity.x, y: entity.y });
          sim.alarmed = true;
          sim.noiseFloor = alarm.floor;
          sim.noise = Math.max(sim.noise, alarm.floor);
        }
      }
    } else {
      // He loses track of you gradually. Snapping this back to zero the
      // instant you clip the edge of his range meant one unlucky corner threw
      // away four seconds of running, and following became permanent.
      // Two ways to lose him, and they are the same way: he cannot see you.
      // Distance is one of them. Standing somewhere he cannot pick you out of
      // is the other, and it has to count or a hiding place would be a piece of
      // floor with a label on it — he would walk to the spot he last saw you,
      // which is the spot you are standing on, and take you out of it.
      //
      // It is not instant, though. The same two seconds apply, and he spends
      // them walking towards where you were: hide with him on top of you and he
      // arrives before the doubt does, which is the whole reason to break away
      // first.
      const outOfSight = sim.hidden || gap >= rules.unfollowAt;
      entity.lostFor = outOfSight
        ? entity.lostFor + STEP_SECONDS
        : Math.max(0, entity.lostFor - STEP_SECONDS * 1.6);
      // He has you, until he does not: certainty holds while you are in the
      // open and drains while you are not, so coming back out of a hiding place
      // in front of him is picked up again from part way rather than from cold.
      const eye = sim.vision;
      entity.notice = sim.hidden && eye
        ? Math.max(0, entity.notice - eye.fade * STEP_SECONDS)
        : 1;
      if (entity.lostFor >= rules.unfollowFor) {
        // He gives up on you, not on the noise: the last place he saw you is
        // now the place worth looking at, and the ordinary rules take over.
        entity.target = { x: entity.goal ? entity.goal.x : player.x,
          y: entity.goal ? entity.goal.y : player.y };
        setState(sim, entity, 'searching');
      } else {
        // Re-read where you are when you have moved, or every so often —
        // never every frame, which would be both wasteful and uncanny.
        entity.repathAt += STEP_SECONDS;
        const drifted = !entity.goal
          || Math.hypot(entity.goal.x - player.x, entity.goal.y - player.y) > rules.repathAfter;
        if (drifted || entity.repathAt >= rules.repathEvery) {
          entity.repathAt = 0;
          routeTo(entity, sim.level, player.x, player.y);
        }
      }
    }
  }

  if (!onFootNow || sim.status !== 'running') {
    entity.notice = Math.max(0, entity.notice - STEP_SECONDS * 2);
  }

  // A man half woken by a distant clatter takes his time; one woken by a
  // bookcase going over is on his feet at once.
  const risingFor = tune ? mix(tune.riseLow, tune.riseHigh, alert) : rules.rising;
  // How long getting up is taking *this* time, published for the renderer. It
  // depends on how alarmed he is, so the drawing cannot work it out from the
  // tuning alone — and an animation that runs to a different clock from the
  // state it is animating is the thing that makes a wake-up look like a cut.
  entity.riseFor = risingFor;
  const searchFor = tune ? mix(tune.sweepLow, tune.sweepHigh, alert) : rules.searchFor;

  switch (entity.state) {
    case 'rising':
      if (entity.stateFor >= risingFor) {
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
      if (sim.noise < rules.calmAt || entity.stateFor >= searchFor) {
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
        // A man who sits back down goes back into his own chair. A man with a
        // round to walk stays on his feet where he is — putting him back on the
        // seat would drop him inside his own desk, and the next step of his
        // round would start from inside a solid rectangle.
        if (!sim.patrol) {
          entity.x = entity.home.x;
          entity.y = entity.home.y;
          // The renderer draws between prevX and x; leaving the old value here
          // would slide him back to the couch over one visible frame.
          entity.prevX = entity.x;
          entity.prevY = entity.y;
        }
        entity.vx = 0;
        entity.vy = 0;
      }
      break;
    // --- the round ---------------------------------------------------------
    // Only for the people whose location gives them one. Everywhere else
    // 'asleep' is exactly what it says and nothing below here runs.
    case 'asleep':
      if (sim.patrol && sim.status === 'running') {
        const patrol = sim.patrol;
        if (!entity.nav) entity.nav = navGrid(sim.level, entity.w, entity.h);
        if (!entity.stand) entity.stand = nearestStand(entity.nav, entity.home.x, entity.home.y);
        // The round is measured from where he *stands*, not from where he sits.
        // His desk is furniture and he is inside it: probing outwards from the
        // middle of it walks into his own desk on the first step, every way.
        if (!entity.beats) entity.beats = beatsOf(entity, sim.level, patrol);
        if (entity.beats.length) {
          // He starts the level sitting at his post, and his post is furniture.
          // The first step of the first round has to begin somewhere a person
          // can actually stand, or the physics has nothing to push him out of.
          if (entity.stand && Math.hypot(entity.x - entity.home.x, entity.y - entity.home.y) < 1) {
            entity.x = entity.stand.x;
            entity.y = entity.stand.y;
            entity.prevX = entity.x;
            entity.prevY = entity.y;
          }
          // Post, point, post, next point. A guard who walks his stops in a
          // ring is away from his desk the whole time, and on a floor with one
          // corridor that means the corridor is never clear. Coming back
          // between stops halves what he covers and leaves the far end of the
          // building the windows the player is supposed to be reading.
          const ring = entity.beats;
          const spot = entity.beat % 2 === 0
            ? ring[(entity.beat / 2) % ring.length]
            : (entity.stand || entity.home);
          entity.beat++;
          setState(sim, entity, 'patrolling');
          routeTo(entity, sim.level, spot.x, spot.y);
        }
      }
      break;
    case 'patrolling':
      if (arrived(entity, rules)) setState(sim, entity, 'watching');
      break;
    case 'watching':
      // A pause at each stop, turning his head over the room. This is the part
      // of a round the player actually plays against: it is the window.
      entity.facing += Math.sin(entity.stateFor * 1.9) * 1.8 * STEP_SECONDS;
      if (entity.stateFor >= sim.patrol.pause) setState(sim, entity, 'asleep');
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
  //
  // And not while he is walking his round, either. A man on his beat is not
  // looking for you — bumping into him is how he finds out you are there, which
  // is a very bad moment and is not the same thing as being caught. He turns
  // and comes after you instead, which the `following` rules above then run.
  //
  // And the moment he turns is not the moment you lose. He shouts, he squares
  // up, and *then* he comes — a second of it, which is the second the player
  // uses. Without that grace the bump and the loss are the same frame, and a
  // guard's round stops being something you can be surprised by and recover
  // from, which is the only reason to put one in a level.
  if (entity.grace > 0) entity.grace = Math.max(0, entity.grace - STEP_SECONDS);
  const alerted = entity.state !== 'patrolling' && entity.state !== 'watching';
  if (onFootNow && sim.status === 'running' && gap <= rules.catchAt) {
    if (alerted && entity.grace <= 0) finish(sim, 'lost', 'caught');
    else if (!alerted) {
      entity.lostFor = 0;
      entity.repathAt = 0;
      entity.grace = 1.0;
      setState(sim, entity, 'following');
      routeTo(entity, sim.level, player.x, player.y);
    }
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
    gaitShare: 0,
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
    // The round, if this level is far enough into its location for its person
    // to be walking one. Resolved once, so nothing in the tick has to know that
    // a patrol is a property of the location *and* of how far in you are.
    patrol: rules.patrol && (level.tier || 1) >= (rules.patrol.from || 1)
      ? rules.patrol : null,
    // What this level's person can see, and whether the thief is currently out
    // of sight in one of the places the map says you can be.
    vision: visionOf(rules, level),
    hidden: false,
    hideIn: null,
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
    // Whether a guard has raised the alarm, and the floor it puts under the
    // meter for the rest of the level. Zero everywhere the person is asleep
    // rather than paid to be awake.
    alarmed: false,
    noiseFloor: 0,
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
  if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
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
  if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
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
  if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
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

  // Out of sight, if the map offers anywhere to be. Resolved before anyone
  // looks for you and after you have moved, so stepping into a doorway is worth
  // exactly the frame you are in it for.
  const wasHidden = sim.hidden;
  sim.hideIn = hidingIn(sim, player);
  sim.hidden = !!sim.hideIn;
  if (sim.hidden !== wasHidden) {
    sim.events.push({ type: 'hide', hidden: sim.hidden, x: player.x, y: player.y });
  }

  // How sensitive this spot is. Distance is measured to where the person
  // actually is, so once Mr. Vrána is up and walking the quiet end of the
  // corridor moves with him — which is the point.
  if (sim.rules.proximity) {
    const listener = sim.investigator || sim.level.watcher;
    const awake = !!(sim.investigator && sim.investigator.state !== 'asleep');
    sim.proximity = proximityScale(
      sim.rules, Math.hypot(player.x - listener.x, player.y - listener.y), awake
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
        if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
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
      if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
    }
  }

  // Being seen. A watcher who can see raises the meter when you move inside
  // their range — in complete silence. Standing still inside it costs nothing,
  // so freezing is a real answer, and it plays against the clock.
  if (sim.watches && sim.status === 'running') {
    const speedShare = player.speed / TUNING.player.speed;
    // His eyes are where he is, not where his desk is. A guard walking his
    // round who cannot see anything but his own chair is a guard who may as
    // well be a wall — and it is the one thing that makes a round dangerous.
    const w = sim.investigator;
    const eyes = w && w.state !== 'asleep'
      ? { kind: sim.level.watcher.kind, sees: sim.level.watcher.sees, x: w.x, y: w.y }
      : sim.level.watcher;
    const rate = detectionRate(eyes, player, speedShare);
    if (rate > 0) {
      sim.seen = Math.min(1, sim.seen + STEP_SECONDS * 3);
      sim.noise = addNoise(sim.noise, rate * STEP_SECONDS);
      if (endsAtCap(sim)) finish(sim, 'lost', 'seen');
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
    if (endsAtCap(sim)) finish(sim, 'lost', 'awake');
    sim.bumpCooldown = TUNING.hazards.bumpCooldown;
  }

  // ...and so does the alarm. It holds the meter up for a hard few seconds and
  // then winds down, so being seen is expensive rather than terminal.
  if (sim.noiseFloor > 0) {
    const alarm = sim.rules.alarm;
    sim.noiseFloor = Math.max(0, sim.noiseFloor - (alarm ? alarm.fade : 5) * STEP_SECONDS);
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
    if (sim.stillFor > settle.delay && sim.noise > sim.noiseFloor) {
      sim.noise = Math.max(sim.noiseFloor, sim.noise - settle.rate * STEP_SECONDS);
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
    // Getting out counts wherever the meter is, in a building where the meter
    // is how alert he is rather than whether he is awake. Everywhere else a
    // full meter still means he is up and the haul is forfeit.
    if (atExit && (sim.rules.alertness || canBank(sim.noise))) {
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
