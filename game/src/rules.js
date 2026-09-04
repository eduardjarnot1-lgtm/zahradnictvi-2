// Pure game rules. No DOM, no canvas, no timers, no randomness.
import { TUNING } from './tuning.js';

export const SLEEP_ASLEEP = 0;
export const SLEEP_STIRRING = 1;
export const SLEEP_ALMOST = 2;
export const SLEEP_AWAKE = 3;

export function itemStats(type) {
  const stats = TUNING.items[type];
  if (!stats) throw new Error(`unknown item type: ${type}`);
  return stats;
}

export function addNoise(current, amount) {
  return Math.min(TUNING.noise.max, current + amount);
}

export function isAwake(noise) {
  return noise >= TUNING.noise.max;
}

export function sleepStage(noise) {
  if (isAwake(noise)) return SLEEP_AWAKE;
  if (noise >= TUNING.noise.almostAt) return SLEEP_ALMOST;
  if (noise >= TUNING.noise.stirringAt) return SLEEP_STIRRING;
  return SLEEP_ASLEEP;
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
