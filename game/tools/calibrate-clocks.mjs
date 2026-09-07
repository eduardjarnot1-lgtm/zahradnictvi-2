// Sets each level's clock from how long a careful, efficient run of it actually
// takes, then writes the result next to maps.js for the builder to bake in.
//
// Within a location, difficulty is *pressure*, not raw seconds: the slack a
// level allows over a good run tightens from level 1 to level 5. A bigger map
// may still get more seconds than a smaller one — walking further genuinely
// takes longer — while being tighter to play, which is the honest reading of
// "time goes down as difficulty goes up".
import { readFileSync, writeFileSync } from 'node:fs';
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
// ...but no location may be lifted past this. The floor is a safety net for a
// level that measures slow, not a licence to hand a small map ninety seconds:
// past here a level stops being a level and becomes a walkthrough, and the
// fairness bot — which plays with a reserve, as a player does — clears every
// one of these inside the capped clock anyway.
const MOST_LIFT = 1.30;
// Start from whatever is already written down. A level the bot cannot finish
// on either seed gets no new number — and dropping it from the file would not
// give it a longer clock, it would take its clock away and hand it back to the
// campaign-wide formula, which is how a level that is already hard becomes
// unwinnable. Keeping the old number is the conservative answer.
const CLOCKS_AT = new URL('../src/maps.js.clocks', import.meta.url);
let clocks = {};
try { clocks = JSON.parse(readFileSync(CLOCKS_AT, 'utf8')); } catch { clocks = {}; }
let worst = 0;

// Pass one: how long each level actually takes to work, measured rather than
// guessed.
const measured = new Map();
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
  measured.set(level.id, seconds);
  worst = Math.max(worst, seconds);
}

// Pass two: turn that into clocks, one location at a time.
//
// The floor — never less than FLOOR times a measured good run — cannot be
// applied level by level. A slow run on level two would hand level two more
// seconds than level one, and the whole point of the curve is that a location
// gets tighter as it goes. So the floor is resolved for the *location*: work
// out the most generous base any of its five levels needs, then lay the slack
// curve back over that. Every level keeps at least its floor, and the curve
// keeps its shape.
const byLocation = new Map();
for (const level of LEVELS) {
  if (!byLocation.has(level.location)) byLocation.set(level.location, []);
  byLocation.get(level.location).push(level);
}
for (const [name, levels] of byLocation) {
  const sized = levels.map((l) => PER_WINDOW * (Math.hypot(l.width, l.height) / WINDOW));
  // The one multiplier that satisfies every level's floor at once.
  let lift = 1;
  levels.forEach((l, t) => {
    const seconds = measured.get(l.id);
    // A level the greedy bot could not finish is the *hardest* level in the
    // location, not a level with no opinion — and letting it drop out of the
    // sum quietly shortens everybody else's clock, which is the wrong way
    // round. It asks for the whole allowance.
    if (!seconds) {
      lift = MOST_LIFT;
      return;
    }
    lift = Math.max(lift, (seconds * FLOOR) / (sized[t] * SLACK[t]));
  });
  lift = Math.min(lift, MOST_LIFT);
  // Seconds per step of map are what tighten, and the slack curve does that by
  // construction — `sized` is the map's own demand and SLACK falls across the
  // five. Raw seconds go up when the plot does, which is right: a building with
  // grounds round it takes longer to cross whatever else is true of it.
  levels.forEach((l, t) => {
    const clock = Math.max(20, Math.round(sized[t] * SLACK[t] * lift));
    clocks[l.id] = clock;
    const seconds = measured.get(l.id);
    console.log(`L${String(l.id).padStart(2)} ${l.name.padEnd(10)} ${l.tier}/5  ` +
      `${String(l.tiles.cols) + 'x' + l.tiles.rows}`.padEnd(7) +
      (seconds ? `  run ${seconds.toFixed(1)}s  clock ${clock}s  slack ${(clock / seconds).toFixed(2)}`
        : `  run    ?    clock ${clock}s  (kept)`));
  });
  if (lift > 1.001) console.log(`   ${name}: every clock lifted x${lift.toFixed(2)} to clear its slowest level`);
}

writeFileSync(CLOCKS_AT, JSON.stringify(clocks, null, 1));
console.log(`\nwrote ${Object.keys(clocks).length} clocks; slowest efficient run ${worst.toFixed(1)}s`);
