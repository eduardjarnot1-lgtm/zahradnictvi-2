// Sets each level's clock from how long a careful, efficient run of it actually
// takes, then writes the result next to maps.js for the builder to bake in.
//
// Within a location, difficulty is *pressure*, not raw seconds: the slack a
// level allows over a good run tightens from level 1 to level 5. A bigger map
// may still get more seconds than a smaller one — walking further genuinely
// takes longer — while being tighter to play, which is the honest reading of
// "time goes down as difficulty goes up".
import { writeFileSync } from 'node:fs';
import { LEVELS } from '../src/levels.js';
import { playEfficiently } from '../test/harness.mjs';

// How much room to breathe each level allows, as a multiple of the time the
// map actually takes to work. This is the difficulty curve: the same building,
// less and less slack.
const SLACK = [2.15, 1.88, 1.65, 1.45, 1.28];   // level 1 → level 5
// Seconds to work a window-sized room. Everything scales off this by the map's
// diagonal, so a bigger building gets proportionally longer — the clock is set
// by the walk the map demands, not by a number that happens to fit.
const PER_WINDOW = 24;
const WINDOW = Math.hypot(400, 620);
// Never less than this multiple of a measured good run, whatever the formula
// says: a level has to be winnable before it is anything else.
const FLOOR = 1.35;
const clocks = {};
let worst = 0;

for (const level of LEVELS) {
  // Measure how long the map takes to *work* — the full efficient haul and the
  // walk out — with the clock lifted and nothing held back. Measuring against
  // the level's own clock would be circular: the bot reserves a share of it,
  // so a tight clock produces a short run and an even tighter clock.
  const real = level.clock;
  level.clock = 9999;
  let seconds = 0;
  for (const seed of [5, 11]) {
    const { run, result } = playEfficiently(level.id, { budget: 70, reserve: 0, seed });
    if (result.status !== 'won') { seconds = Math.max(seconds, 9999); break; }
    seconds = Math.max(seconds, run.sim.frame / 60);
  }
  level.clock = real;
  if (seconds > 900) { console.log(`L${level.id} ${level.name} ${level.tier}/5  COULD NOT FINISH`); continue; }
  // Size sets the clock; the measured run only ever raises it.
  const size = Math.hypot(level.width, level.height) / WINDOW;
  const demand = PER_WINDOW * size;
  const clock = Math.max(20, Math.round(demand * SLACK[level.tier - 1]),
    Math.round(seconds * FLOOR));
  clocks[level.id] = clock;
  worst = Math.max(worst, seconds);
  console.log(`L${String(level.id).padStart(2)} ${level.name.padEnd(10)} ${level.tier}/5  ` +
    `${String(level.tiles.cols) + 'x' + level.tiles.rows}`.padEnd(7) +
    `  run ${seconds.toFixed(1)}s  clock ${clock}s  slack ${(clock / seconds).toFixed(2)}`);
}
writeFileSync(new URL('../src/maps.js.clocks', import.meta.url), JSON.stringify(clocks, null, 1));
console.log(`\nwrote ${Object.keys(clocks).length} clocks; slowest efficient run ${worst.toFixed(1)}s`);
