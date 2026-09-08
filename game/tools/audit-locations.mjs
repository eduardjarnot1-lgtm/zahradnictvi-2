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
//   bare        the biggest patch of indoor floor with nothing standing in
//               it, in tiles a side, across the location's five levels — the
//               number that answers "is there a grey rectangle in this
//               building". Some open floor is the point of a stealth game; a
//               hall you could park a bus in is not.
//   furn/room   pieces of furniture per 100x100 of the whole plot, grounds
//               included, so a location with big yards scores lower here
//               without being any emptier indoors
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

// The biggest patch of indoor floor with nothing standing in it, in tiles a
// side. This is the number that answers "does this building have a grey
// rectangle in it": density per square metre is not it, because a plot with a
// big lawn on it scores badly while every room inside is full, and a floor with
// one enormous bare hall in the middle of it scores well.
//
// Indoors is worked out the way the generator works it out: flood in from the
// edge of the map over everything that is not the building's masonry, and
// whatever that does not reach is a room.
const TILE = 20;
function barePatch(level) {
  const cols = Math.ceil(level.width / TILE);
  const rows = Math.ceil(level.height / TILE);
  const wall = [];
  const full = [];
  for (let y = 0; y < rows; y++) {
    wall.push(new Array(cols).fill(false));
    full.push(new Array(cols).fill(false));
  }
  for (const c of level.colliders) {
    const masonry = c.type === 'wall' || c.type === 'partition';
    for (let ty = Math.floor(c.y / TILE); ty < Math.ceil((c.y + c.h) / TILE); ty++) {
      for (let tx = Math.floor(c.x / TILE); tx < Math.ceil((c.x + c.w) / TILE); tx++) {
        if (ty < 0 || ty >= rows || tx < 0 || tx >= cols) continue;
        if (masonry && !c.fence) wall[ty][tx] = true;
        full[ty][tx] = true;
      }
    }
  }
  // Doorways stop the flood, the way they do in the generator: they are where
  // the building is open to the yard.
  for (const d of level.doors) {
    for (let ty = Math.floor(d.y / TILE); ty < Math.ceil((d.y + d.h) / TILE); ty++) {
      for (let tx = Math.floor(d.x / TILE); tx < Math.ceil((d.x + d.w) / TILE); tx++) {
        if (ty >= 0 && ty < rows && tx >= 0 && tx < cols) wall[ty][tx] = true;
      }
    }
  }
  const out = [];
  for (let y = 0; y < rows; y++) out.push(new Array(cols).fill(false));
  const stack = [];
  for (let x = 0; x < cols; x++) { stack.push([x, 0], [x, rows - 1]); }
  for (let y = 0; y < rows; y++) { stack.push([0, y], [cols - 1, y]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= cols || y >= rows || out[y][x] || wall[y][x]) continue;
    out[y][x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Largest square of indoor tiles with nothing standing in them.
  const sq = [];
  for (let y = 0; y < rows; y++) sq.push(new Array(cols).fill(0));
  let best = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const open = !wall[y][x] && !full[y][x] && !out[y][x];
      sq[y][x] = !open ? 0
        : (y === 0 || x === 0) ? 1
          : 1 + Math.min(sq[y - 1][x], sq[y][x - 1], sq[y - 1][x - 1]);
      if (sq[y][x] > best) best = sq[y][x];
    }
  }
  return best;
}

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
    bare: Math.max(...ls.map(barePatch)),
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

const cols = ['loc', 'bare', 'furniturePerRoom', 'dressingPerRoom', 'lights', 'proud', 'hides',
  'stashes', 'underfoot', 'doors', 'reacts', 'gait', 'hideRules', 'story'];
const head = ['location', 'bare', 'furn/room', 'dress/room', 'lights', 'proud', 'hides',
  'stash', 'floor', 'doors', 'react', 'gait5', 'hide', 'what says who was here'];
const w = cols.map((c, i) => Math.max(head[i].length, ...rows.map((r) => String(r[c]).length)));
console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
console.log(w.map((n) => '-'.repeat(n)).join('  '));
for (const r of rows) console.log(cols.map((c, i) => String(r[c]).padEnd(w[i])).join('  '));
