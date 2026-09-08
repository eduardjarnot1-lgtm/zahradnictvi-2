// What every building actually has in it, measured rather than asserted.
//
// The school was brought up to a standard first and the other ten were brought
// up to the school; this prints the numbers that were used to decide when that
// was true, so the next person to change a room grammar can see in one screen
// whether they have quietly hollowed a building out. Run it with
// `node tools/audit-locations.mjs`.
//
// Columns, in the order the work happened:
//
//   furn/room   pieces of furniture per 100x100 of floor
//   dress/room  pieces of dressing per the same
//   lights      fittings across the location's five levels
//   proud       furniture standing a tile off the wall behind it, which is the
//               tell that a room was generated rather than built
//   hides       places to be out of sight; two a level where the map has two
//   stash       furniture you can look inside
//   floor       things underfoot that cost noise to walk on
//   doors       doorways, all of which are shut until opened
//   react/gait5/hide  whether the location gets the reacting room, the
//               five-band walk, and the hiding rules — all three shared now
//   the last    what this building has in it that no other building has
import { LEVELS } from '../src/levels.js';
import { createSim } from '../src/sim.js';

const LOCS = [...new Set(LEVELS.map((l) => l.location))];
const at = (loc) => LEVELS.filter((l) => l.location === loc);
const sum = (a) => a.reduce((x, y) => x + y, 0);

const rows = [];
for (const loc of LOCS) {
  const ls = at(loc);
  const sims = ls.map((l) => createSim({ level: l }));
  const furniture = ls.map((l) => l.colliders.filter((c) => c.type === 'furniture').length);
  const lights = ls.map((l) => (l.decor || []).filter(
    (d) => ['ceiling', 'lamp', 'desklamp'].includes(d.kind)).length);
  const dressing = ls.map((l) => (l.decor || []).length);
  const area = ls.map((l) => (l.width * l.height) / 10000);
  // §3-5: a piece standing a tile off the wall behind it
  let proud = 0, pieces = 0;
  for (const l of ls) {
    const walls = l.colliders.filter((c) => c.type === 'wall' || c.type === 'partition');
    for (const f of l.colliders.filter((c) => c.type === 'furniture')) {
      pieces++;
      const tile = (g) => g > 12 && g < 28;
      if (walls.some((w) => {
        const ax = f.x < w.x + w.w - 4 && w.x < f.x + f.w - 4;
        const ay = f.y < w.y + w.h - 4 && w.y < f.y + f.h - 4;
        return (ax && (tile(f.y - (w.y + w.h)) || tile(w.y - (f.y + f.h))))
          || (ay && (tile(f.x - (w.x + w.w)) || tile(w.x - (f.x + f.w))));
      })) proud++;
    }
  }
  rows.push({
    loc,
    furniturePerRoom: (sum(furniture) / sum(area)).toFixed(1),
    dressingPerRoom: (sum(dressing) / sum(area)).toFixed(1),
    lights: sum(lights),
    proud: pieces ? Math.round((proud / pieces) * 100) + '%' : '-',
    hides: sum(ls.map((l) => l.hides.length)),
    stashes: sum(ls.map((l) => l.stashes.length)),
    underfoot: sum(ls.map((l) => l.creaks.length)),
    doors: sum(sims.map((s) => s.doors.length)),
    story: [...new Set(ls.flatMap((l) => (l.decor || [])
      .filter((d) => ['luggage', 'barrier', 'till', 'drip', 'meal', 'toys', 'crate', 'glasses']
        .includes(d.kind)).map((d) => d.kind)))].sort().join('+') || '(the school\'s own)',
    reacts: sims.every((s) => s.rules.reacts) ? 'y' : 'N',
    gait: sims.every((s) => s.rules.gait && s.rules.gait.bands
      ? s.rules.gait.bands.length === 5 : !!s.rules.gait) ? 'y' : 'N',
    hideRules: sims.every((s) => !!s.rules.hide) ? 'y' : 'N'
  });
}

const cols = ['loc', 'furniturePerRoom', 'dressingPerRoom', 'lights', 'proud', 'hides',
  'stashes', 'underfoot', 'doors', 'reacts', 'gait', 'hideRules', 'story'];
const head = ['location', 'furn/room', 'dress/room', 'lights', 'proud', 'hides',
  'stash', 'floor', 'doors', 'react', 'gait5', 'hide', 'what says who was here'];
const w = cols.map((c, i) => Math.max(head[i].length, ...rows.map((r) => String(r[c]).length)));
console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
console.log(w.map((n) => '-'.repeat(n)).join('  '));
for (const r of rows) console.log(cols.map((c, i) => String(r[c]).padEnd(w[i])).join('  '));
