// Seeded PRNG (mulberry32). The simulation never calls Math.random, so a run is
// fully reproducible from (level, seed, input log).
export function createRng(seed) {
  let state = seed >>> 0;
  return {
    get seed() { return state; },
    // [0, 1)
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + this.next() * (max - min); },
    clone() { return createRng(state); }
  };
}
