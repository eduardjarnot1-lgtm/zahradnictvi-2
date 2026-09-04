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

// What a piece of furniture *is*, derived from its shape and position. The
// renderer draws it and the simulation charges for bumping it from this same
// answer, so a sofa is always soft and a bookshelf is always loud.
export function furnitureStyle(c) {
  if (c.type === 'bed') return 'bed';
  const ratio = c.w / c.h;
  const group = c.h >= 100 ? 'tall' : ratio >= 2.3 ? 'wide' : ratio >= 1.35 ? 'mid' : 'small';
  const options = STYLE_GROUPS[group];
  return options[Math.floor(hash(c.x + 7, c.y + 13) * options.length) % options.length];
}

// Walls are the room, not furniture: brushing one costs nothing.
export function bumpNoise(collider) {
  if (!collider || collider.type === 'wall') return 0;
  return TUNING.hazards.bump[furnitureStyle(collider)] || 0;
}

// Seconds on the clock for a level. Gentle slope, with a floor.
export function timeLimit(level) {
  const { base, perLevel, floor } = TUNING.time;
  return Math.max(floor, base - Math.floor((level.id - 1) * perLevel));
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
export function levelTotals(level) {
  return level.items.reduce(
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

// Stars are earned on the raw haul, never on the upgraded payout — otherwise
// buying the Velvet Bag would quietly hand you three stars everywhere.
export function starsFor(level, haul) {
  if (haul <= 0) return 1;
  const share = haul / levelTotals(level).value;
  if (share >= TUNING.stars.three) return 3;
  if (share >= TUNING.stars.two) return 2;
  return 1;
}

export function starThresholds(level) {
  const total = levelTotals(level).value;
  return {
    two: Math.ceil(total * TUNING.stars.two),
    three: Math.ceil(total * TUNING.stars.three)
  };
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
