// A run is (level id, seed, input log). Input is quantised before it ever
// reaches the simulation, so what is recorded is exactly what was played.
import { createSim, stepSim, snapshot } from './sim.js';
import { LEVELS } from './levels.js';

const Q = 127;

export function quantise(input) {
  return {
    x: Math.round(Math.max(-1, Math.min(1, input.x)) * Q) / Q,
    y: Math.round(Math.max(-1, Math.min(1, input.y)) * Q) / Q,
    take: !!input.take
  };
}

const pack = (input) => [Math.round(input.x * Q), Math.round(input.y * Q), input.take ? 1 : 0];
const unpack = ([x, y, take]) => ({ x: x / Q, y: y / Q, take: take === 1 });

export function createRecorder(levelId, seed) {
  return { v: 1, levelId, seed, frames: [] }; // frames: [count, x, y, take] runs
}

// Run-length encoded: a held direction costs one entry, not one per frame.
export function recordFrame(recording, input) {
  const [x, y, take] = pack(input);
  const last = recording.frames[recording.frames.length - 1];
  if (last && last[1] === x && last[2] === y && last[3] === take) last[0]++;
  else recording.frames.push([1, x, y, take]);
}

export function expand(recording) {
  const out = [];
  for (const [count, x, y, take] of recording.frames) {
    for (let i = 0; i < count; i++) out.push(unpack([x, y, take]));
  }
  return out;
}

export function frameCount(recording) {
  return recording.frames.reduce((n, f) => n + f[0], 0);
}

// Replay a recording headlessly and return the final snapshot.
export function replay(recording, levels = LEVELS) {
  const level = levels.find((l) => l.id === recording.levelId);
  if (!level) throw new Error(`replay references unknown level ${recording.levelId}`);
  const sim = createSim({ level, seed: recording.seed });
  for (const input of expand(recording)) stepSim(sim, input);
  return snapshot(sim);
}
