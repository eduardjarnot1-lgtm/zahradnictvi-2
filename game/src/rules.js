// Pure game rules. No DOM, no canvas, no timers, no randomness.
import { TUNING } from './tuning.js';

// Six visual states, from dead to the world to sitting bolt upright.
export const SLEEP_DEEP = 0;
export const SLEEP_LIGHT = 1;
export const SLEEP_DISTURBED = 2;
export const SLEEP_ALMOST = 3;
export const SLEEP_CRITICAL = 4;
export const SLEEP_AWAKE = 5;
export const SLEEP_ASLEEP = SLEEP_DEEP;   // kept: reads better at call sites
export const SLEEP_STIRRING = SLEEP_LIGHT;

export const SLEEP_LABELS = [
  'Deep sleep', 'Light sleep', 'Stirring', 'Almost awake', 'About to wake', 'Awake'
];

// Deterministic per-position jitter. Shared by the classifier below and by the
// renderer's decoration, so what you see is what you collide with.
export function hash(x, y) {
  let h = Math.imul((Math.round(x) | 0) + 0x9e3779b9, 374761393);
  h = Math.imul(h ^ ((Math.round(y) | 0) + 0x85ebca6b), 668265263);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const STYLE_GROUPS = {
  tall: ['wardrobe', 'bookshelf'],
  wide: ['sofa', 'tvBench'],
  mid: ['table', 'chest'],
  small: ['nightstand', 'table']
};

// A workplace has no sofas in its desk rows. Only the themes introduced with
// these locations override anything, so no existing level's furniture — or the
// noise it costs to walk into — moves.
const THEME_GROUPS = {
  officefloor: { wide: ['tvBench', 'table'] },
  school:      { wide: ['tvBench', 'table'] }
};

// What a piece of furniture *is*, derived from its shape and position. The
// renderer draws it and the simulation charges for bumping it from this same
// answer, so a sofa is always soft and a bookshelf is always loud.
export function furnitureStyle(c) {
  if (c.type === 'bed') return 'bed';
  // A hand-drawn map names what each piece is; only the older generated rooms
  // fall through to inferring it from the shape.
  if (c.style) return c.style;
  const ratio = c.w / c.h;
  // A gallery's small squares are plinths, not nightstands. The museum reads the
  // same way — without this its display blocks drew as brown bedroom furniture.
  if ((c.theme === 'gallery' || c.theme === 'museum') && c.w <= 52
      && ratio > 0.75 && ratio < 1.35) return 'plinth';
  const group = c.h >= 100 ? 'tall' : ratio >= 2.3 ? 'wide' : ratio >= 1.35 ? 'mid' : 'small';
  const options = (THEME_GROUPS[c.theme] || {})[group] || STYLE_GROUPS[group];
  return options[Math.floor(hash(c.x + 7, c.y + 13) * options.length) % options.length];
}

// Walls are the room, not furniture: brushing one costs nothing. Interior
// partitions are walls too — they are the building, not something standing in it.
export function bumpNoise(collider) {
  if (!collider || collider.type === 'wall' || collider.type === 'partition') return 0;
  return TUNING.hazards.bump[furnitureStyle(collider)] || 0;
}

// Seconds on the clock for a level: a gentle slope with a floor, plus whatever
// allowance a larger, partitioned map declares for itself.
export function timeLimit(level) {
  // A level may state its clock outright. That is how the location levels are
  // balanced — against how long the map actually takes to work, not against a
  // campaign-wide slope that stopped meaning anything at fifty-five levels.
  if (level.clock) return level.clock;
  const { base, perLevel, floor } = TUNING.time;
  return Math.max(floor, base - Math.floor((level.id - 1) * perLevel)) + (level.extraTime || 0);
}

// --- location-specific mechanics -------------------------------------------
// A level either belongs to a location that asks for extra rules or it does
// not. Everywhere else in the game asks this one question and gets an empty
// object back, which is how eleven locations share one simulation.
const NO_RULES = Object.freeze({});

export function locationRules(level) {
  return (level && TUNING.locations[level.location]) || NO_RULES;
}

// How much louder a noise is for being made near the person listening to it.
//
// One continuous curve, not a set of bands: a threshold you can step across
// without noticing is a trap, and this has to be something the player learns to
// feel rather than something that catches them out. The far end is deliberately
// close to 1 — being at the other end of the school is quieter, never silent.
//
// `awake` multiplies a second, tighter curve on top, centred on the same
// person. A man on his feet is listening, and he takes that with him: it is
// what stops "he woke up" being answered by carrying on in the next room.
export function proximityScale(rules, distance, awake = false) {
  const p = rules.proximity;
  if (!p) return 1;
  const base = distance <= p.near ? p.nearScale
    : distance >= p.far ? p.farScale
      : (() => {
        const t = (distance - p.near) / (p.far - p.near);
        return p.nearScale + (p.farScale - p.nearScale) * (t * t * (3 - 2 * t));
      })();
  const a = rules.awake;
  if (!awake || !a || distance >= a.radius) return base;
  const t = distance / a.radius;
  return base * (a.boost + (1 - a.boost) * (t * t * (3 - 2 * t)));
}

// How long a step is at this speed, expressed as walk-cycle phase per unit of
// ground covered. Short steps when creeping means more of them; long strides
// when running means fewer. Driving the animation from distance rather than
// from time is what keeps the feet on the floor at every speed.
export function stridePerUnit(share) {
  const g = TUNING.player.gait;
  if (share <= g.creepAt) return g.strideCreep;
  if (share >= g.walkAt) {
    if (share <= TUNING.player.runAt) return g.strideWalk;
    const t = Math.min(1, (share - TUNING.player.runAt) / (1 - TUNING.player.runAt));
    return g.strideWalk + (g.strideRun - g.strideWalk) * t;
  }
  const t = (share - g.creepAt) / (g.walkAt - g.creepAt);
  return g.strideCreep + (g.strideWalk - g.strideCreep) * t;
}

// The three gaits, as blend weights rather than as a mode: a character halfway
// between a creep and a walk should look halfway between them, not snap.
//
// `stride` is the one that makes the animation honest. Step length and cadence
// multiply to speed, and the cadence is already fixed by stridePerUnit — so if
// the drawn step is not the reciprocal of that, the feet are lying about how
// far they carried him. Expressed relative to a normal walk, it is exactly
// that reciprocal, which is why it is derived here rather than picked by eye.
export function gaitBlend(share) {
  const g = TUNING.player.gait;
  const runAt = TUNING.player.runAt;
  const creep = share <= 0 ? 0
    : share <= g.creepAt ? 1
      : Math.max(0, 1 - (share - g.creepAt) / (g.walkAt - g.creepAt));
  const run = share <= runAt ? 0 : Math.min(1, (share - runAt) / (1 - runAt)) ** 2;
  return {
    creep,
    run,
    walk: Math.min(1, share),
    // Whether the legs are cycling at all. Reaches full weight quickly: a slow
    // creep is a short step, not a barely-there twitch, and the old code's
    // habit of using raw speed as the amplitude made a quarter-speed walk look
    // like standing still while covering ground.
    moving: Math.min(1, share / 0.12),
    stride: g.strideWalk / stridePerUnit(share)
  };
}

export function itemStats(type) {
  const stats = TUNING.items[type];
  if (!stats) throw new Error(`unknown item type: ${type}`);
  return stats;
}

export function addNoise(current, amount) {
  return Math.max(0, Math.min(TUNING.noise.max, current + amount));
}

export function isAwake(noise) {
  return noise >= TUNING.noise.max;
}

export function sleepStage(noise) {
  if (isAwake(noise)) return SLEEP_AWAKE;
  let stage = 0;
  for (const threshold of TUNING.noise.bands) if (noise >= threshold) stage++;
  return stage;
}

// Escaping is only worth anything while he is still asleep.
export function canBank(noise) {
  return !isAwake(noise);
}

// What a level is worth if you somehow took everything (used by the validator
// and by balance reporting, never by the running game).
// Everything a level holds, floor and furniture alike. Where most of the loot
// is inside the furniture — which is the school now — counting only what is
// lying about would set the star targets against a fraction of the level.
export function lootOf(level) {
  const hidden = (level.stashes || []).filter((s) => s.item).map((s) => ({ type: s.item }));
  return hidden.length ? level.items.concat(hidden) : level.items;
}

export function levelTotals(level) {
  return lootOf(level).reduce(
    (acc, item) => {
      const stats = itemStats(item.type);
      acc.value += stats.value;
      acc.noise += stats.noise;
      return acc;
    },
    { value: 0, noise: 0 }
  );
}

// True when a level forces the core decision: you cannot take everything.
export function forcesChoice(level) {
  return levelTotals(level).noise > TUNING.noise.max;
}

// Input shaping, kept pure so it can be tested without a browser.
//
// A dead zone that re-stretches the remaining range is the usual approach, but
// it means a stick pushed a quarter of the way gives noticeably less than a
// quarter speed. Here the magnitude passes through *unchanged* above the dead
// zone, so displacement maps one-to-one onto speed, and only the first sliver
// past the threshold is ramped — enough to remove the step, too small to feel.
export function shapeStick(x, y, deadZone = TUNING.player.deadZone) {
  let length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  if (length > 1) { x /= length; y /= length; length = 1; }
  if (length < deadZone) return { x: 0, y: 0 };
  const ramp = Math.min(1, (length - deadZone) / 0.06);
  return { x: x * ramp, y: y * ramp };
}

// Who is in this room and how they behave. One lookup, so nothing else in the
// game has to branch on the kind.
export function watcherConfig(kind) {
  return TUNING.watchers[kind] || TUNING.watchers.sleeper;
}

// How much a watcher who can see notices you this instant: nothing if they
// cannot see, nothing if you are outside their range, and nothing if you are
// standing still. Falls off with distance, and scales with how fast you move.
export function detectionRate(watcher, player, speedShare) {
  const config = watcherConfig(watcher.kind);
  if (config.sees <= 0 || speedShare <= 0.02) return 0;
  // The level may hold this guard's range below his kind's ceiling.
  const range = watcher.sees || config.sees;
  const distance = Math.hypot(player.x - watcher.x, player.y - watcher.y);
  if (distance >= range) return 0;
  // Linear falloff. A squared one looked reasonable but made detection
  // irrelevant anywhere but point-blank — three seconds of running across the
  // edge of his vision raised the meter by one.
  const closeness = 1 - distance / range;
  return config.seeRate * closeness * Math.min(1, speedShare);
}

export function rarityOf(type) {
  const { value } = itemStats(type);
  return TUNING.rarity.bands.find((band) => value <= band.upTo);
}

export const isBigScore = (value) => value >= TUNING.rarity.bigScoreAt;

// The most valuable haul this room can give up inside a noise budget. Items are
// few, so this is an exact search rather than a greedy guess — and it matters,
// because the star targets are read off it. Setting targets against the room's
// raw total would demand hauls that wake him every time.
export function bestHaul(level, budget = TUNING.stars.budget) {
  const items = lootOf(level).map((item) => itemStats(item.type));
  let best = 0;
  const walk = (index, noise, value) => {
    if (noise > budget) return;
    if (value > best) best = value;
    if (index >= items.length) return;
    walk(index + 1, noise + items[index].noise, value + items[index].value);
    walk(index + 1, noise, value);
  };
  walk(0, 0, 0);
  return best;
}

// Stars are earned on the raw haul, never on the upgraded payout — otherwise
// buying the Velvet Bag would quietly hand you three stars everywhere.
export function starThresholds(level) {
  const reachable = bestHaul(level);
  return {
    two: Math.max(1, Math.round(reachable * TUNING.stars.two)),
    three: Math.max(2, Math.round(reachable * TUNING.stars.three)),
    reachable
  };
}

export function starsFor(level, haul) {
  if (haul <= 0) return 1;
  const marks = starThresholds(level);
  if (haul >= marks.three) return 3;
  if (haul >= marks.two) return 2;
  return 1;
}

// What the level asks of you, in words, for the results and level-select screens.
export function objectivesFor(level) {
  const marks = starThresholds(level);
  return [
    { stars: 1, text: 'Escape the room' },
    { stars: 2, text: `Escape with $${marks.two.toLocaleString()}` },
    { stars: 3, text: `Escape with $${marks.three.toLocaleString()}` }
  ];
}

// How the escape itself went. Presentation, not points — except the small
// bonus for leaving quietly with time to spare.
export function gradeEscape({ noise, timeLeft, limit }) {
  const { perfectNoise, perfectTimeShare, perfectBonus, closeCallNoise, closeCallTime } = TUNING.escape;
  if (noise < perfectNoise && timeLeft > limit * perfectTimeShare) {
    return { grade: 'perfect', label: 'PERFECT ESCAPE!', bonus: perfectBonus };
  }
  if (noise >= closeCallNoise || timeLeft <= closeCallTime) {
    return { grade: 'close', label: 'CLOSE CALL!', bonus: 0 };
  }
  return { grade: 'clean', label: '', bonus: 0 };
}

// A streak pays a little extra for stealing without dawdling.
export function comboBonus(streak) {
  let bonus = 0;
  for (const tier of TUNING.combo.tiers) if (streak >= tier.at) bonus = tier.bonus;
  return bonus;
}

// Turn owned upgrade levels into the multipliers the simulation applies.
export function resolveUpgrades(owned = {}) {
  const pick = (key) => {
    const table = TUNING.upgrades[key].effect;
    const level = Math.max(0, Math.min(table.length - 1, Math.floor(owned[key] || 0)));
    return table[level];
  };
  return { speed: pick('feet'), hazardNoise: pick('shoes'), payout: pick('bag') };
}

export function upgradeCost(key, ownedLevel) {
  const costs = TUNING.upgrades[key].costs;
  return ownedLevel >= costs.length ? null : costs[ownedLevel];
}
